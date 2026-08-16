import { LedgerRecordKind } from "$lib/enums.js";
import { diffRecords, recordAudit } from "../audit.js";
import { buildMovements } from "../ledger/entry-builder.js";
import { ledgerEvents } from "../ledger/events.js";
import { canDeleteRecord, canEditField } from "../ledger/locking.js";
import { toMinor } from "../ledger/money.js";
import type {
  BuildInput,
  LedgerDb,
  MovementDraft,
  RecordCreate,
  RecordPatch,
  RecordView,
  Refusable,
} from "../ledger/types.js";
import { accountRefs, systemAccounts } from "../queries/accounts.js";
import {
  deleteRecord,
  getRecord,
  getRecordRow,
  insertRecord,
  kindCodeFor,
  lockStateFor,
  snapshotForAudit,
  updateRecord,
} from "../queries/ledger.js";
import { touchAccounts } from "./accounts.js";

/**
 * Creating, changing and removing a record.
 *
 * This is where the everyday description a screen sends — "an expense someone
 * else paid", "a withdrawal from the Shopee wallet" — becomes movements, by way
 * of `entry-builder.ts`, which is the only code allowed to construct them. The
 * service adds what a route must not do inline: the locking rules, the audit
 * entry, and the one emit that tells every open view something moved.
 */

/** Which accounts an input names, so the builder can check their roles. */
function accountIdsIn(sides: RecordCreate | BuildInput): number[] {
  switch (sides.kind) {
    case "expense":
      return [sides.categoryAccountId, sides.paidFromAccountId ?? -1];
    case "income":
      return [sides.categoryAccountId, sides.receivedIntoAccountId];
    case "transfer":
      return [sides.fromAccountId, sides.toAccountId];
    case "payment":
      return [sides.paidFromAccountId];
    case "opening-balance":
      return [sides.accountId];
    case "invoice-issue":
      return [sides.incomeAccountId];
    case "journal":
      return sides.movements.map((m) => m.accountId);
  }
}

/** Gathers everything `buildMovements` needs, in one place. */
function contextFor(db: LedgerDb, sides: RecordCreate | BuildInput) {
  const system = systemAccounts(db);
  return {
    accounts: accountRefs(db, [
      ...accountIdsIn(sides),
      system.receivableAccountId,
      system.payableAccountId,
      system.openingBalancesAccountId,
    ]),
    receivableAccountId: system.receivableAccountId,
    payableAccountId: system.payableAccountId,
    openingBalancesAccountId: system.openingBalancesAccountId,
  };
}

function emitRecord(db: LedgerDb, id: number): RecordView | null {
  const record = getRecord(db, id);
  if (record) {
    ledgerEvents.emit("record-update", { record });
    // An account's balance is the sum of its movements, so a record write moves
    // every account it touched — the accounts screen has to hear about it too.
    touchAccounts(
      db,
      record.movements.map((m) => m.accountId),
    );
  }
  return record;
}

export function createRecord(
  db: LedgerDb,
  actingUserId: number,
  data: RecordCreate & {
    /** Supplied only by the upgrade — see queries/ledger.ts. */
    id?: number;
    legacyKind?: "expense" | "income" | "claim" | null;
    legacyId?: number | null;
  },
): Refusable<RecordView> {
  const amountMinor = toMinor(data.amount, data.exchangeRate);

  const built = buildMovements(
    { ...data, amountMinor } as BuildInput,
    contextFor(db, data),
  );
  if (!built.ok) return built;

  const row = insertRecord(
    db,
    actingUserId,
    {
      kind: kindCodeFor(data.kind),
      date: data.date,
      description: data.description,
      amount: data.amount,
      currency: data.currency,
      exchangeRate: data.exchangeRate,
      contactId: data.contactId ?? null,
      reference: data.reference,
      remark: data.remark,
      extractedText: data.extractedText,
      recordNumber: data.recordNumber,
      id: data.id,
      legacyKind: data.legacyKind,
      legacyId: data.legacyId,
    },
    built.value,
  );

  recordAudit(db, {
    recordType: "record",
    recordId: row.id,
    userId: actingUserId,
    action: "create",
  });

  return { ok: true, value: emitRecord(db, row.id)! };
}

/**
 * Changes a record.
 *
 * A record whose money has already been settled or matched to a bank line
 * refuses its amount, its date and any account, and says what to undo first;
 * what it *says* stays editable, because correcting a description cannot make
 * another record wrong (FR-017a).
 */
export function patchRecord(
  db: LedgerDb,
  id: number,
  actingUserId: number,
  patch: RecordPatch,
): Refusable<RecordView> {
  const existing = getRecord(db, id);
  if (!existing) return { ok: false, reason: "That record no longer exists." };

  const lock = lockStateFor(db, id);
  for (const field of Object.keys(patch) as (keyof RecordPatch)[]) {
    if (patch[field] === undefined) continue;
    if (!canEditField(field, lock)) {
      return {
        ok: false,
        reason: existing.lockedReason ?? "That cannot be changed.",
      };
    }
  }

  const before = snapshotForAudit(db, id);

  // Any change to what the money did means rebuilding the sides from scratch —
  // there is no partial edit of a movement, because the balance rule is a
  // property of the whole set.
  const rebuild = touchesMoney(patch);
  let movements: MovementDraft[] | undefined;

  if (rebuild) {
    const sides = sidesFor(existing, patch);
    if (!sides.ok) return sides;
    const amount = patch.amount ?? existing.amount;
    const exchangeRate = patch.exchangeRate ?? existing.exchangeRate;
    const built = buildMovements(
      {
        ...sides.value,
        amountMinor: toMinor(amount, exchangeRate),
        contactId:
          patch.contactId !== undefined ? patch.contactId : existing.contactId,
      } as BuildInput,
      contextFor(db, sides.value),
    );
    if (!built.ok) return built;
    movements = built.value;
  }

  updateRecord(
    db,
    id,
    actingUserId,
    {
      date: patch.date,
      description: patch.description,
      amount: patch.amount,
      currency: patch.currency,
      exchangeRate: patch.exchangeRate,
      contactId: patch.contactId,
      reference: patch.reference,
      remark: patch.remark,
    },
    movements,
  );

  recordAudit(db, {
    recordType: "record",
    recordId: id,
    userId: actingUserId,
    action: "update",
    changes: diffRecords(before, snapshotForAudit(db, id)),
  });

  const updated = emitRecord(db, id)!;
  // The accounts it moved *away* from need their balances refreshed too.
  touchAccounts(
    db,
    existing.movements.map((m) => m.accountId),
  );
  return { ok: true, value: updated };
}

const MONEY_FIELDS: (keyof RecordPatch)[] = [
  "amount",
  "exchangeRate",
  "categoryAccountId",
  "paidFromAccountId",
  "receivedIntoAccountId",
  "fromAccountId",
  "toAccountId",
];

function touchesMoney(patch: RecordPatch): boolean {
  return MONEY_FIELDS.some((f) => patch[f] !== undefined);
}

/**
 * The sides a patched record should be rebuilt from: what the patch says where
 * it says anything, and what the record already does where it does not.
 *
 * Reading the existing sides back out of the movements — rather than storing
 * them a second time on the record — is what keeps the movements the single
 * account of where the money went.
 */
function sidesFor(
  existing: RecordView,
  patch: RecordPatch,
): Refusable<RecordCreate> {
  const base = {
    date: patch.date ?? existing.date,
    description: patch.description ?? existing.description,
    amount: patch.amount ?? existing.amount,
    currency: patch.currency ?? existing.currency,
    exchangeRate: patch.exchangeRate ?? existing.exchangeRate,
  };

  const into = existing.movements.find((m) => m.amountMinor > 0);
  const outOf = existing.movements.find((m) => m.amountMinor < 0);
  if (!into || !outOf) {
    return {
      ok: false,
      reason:
        "This record's sides cannot be worked out automatically. Edit it on the journal screen instead.",
    };
  }

  switch (existing.kind) {
    case LedgerRecordKind.Expense:
      return {
        ok: true,
        value: {
          ...base,
          kind: "expense",
          categoryAccountId: patch.categoryAccountId ?? into.accountId,
          paidFromAccountId:
            patch.paidFromAccountId !== undefined
              ? patch.paidFromAccountId
              : outOf.accountId,
        },
      };
    case LedgerRecordKind.Income:
      return {
        ok: true,
        value: {
          ...base,
          kind: "income",
          categoryAccountId: patch.categoryAccountId ?? outOf.accountId,
          receivedIntoAccountId: patch.receivedIntoAccountId ?? into.accountId,
        },
      };
    case LedgerRecordKind.Transfer:
      return {
        ok: true,
        value: {
          ...base,
          kind: "transfer",
          fromAccountId: patch.fromAccountId ?? outOf.accountId,
          toAccountId: patch.toAccountId ?? into.accountId,
        },
      };
    default:
      return {
        ok: false,
        reason:
          "The amount and accounts on this kind of record cannot be changed after it is created. Delete it and record it again.",
      };
  }
}

export function removeRecord(
  db: LedgerDb,
  id: number,
  actingUserId: number,
): Refusable<null> {
  const existing = getRecord(db, id);
  if (!existing) return { ok: false, reason: "That record no longer exists." };

  const allowed = canDeleteRecord(lockStateFor(db, id));
  if (!allowed.ok) return allowed;

  const before = snapshotForAudit(db, id);
  const touched = existing.movements.map((m) => m.accountId);

  if (!deleteRecord(db, id)) {
    return { ok: false, reason: "That record no longer exists." };
  }

  recordAudit(db, {
    recordType: "record",
    recordId: id,
    userId: actingUserId,
    action: "delete",
    changes: diffRecords(before, null),
  });
  ledgerEvents.emit("record-deleted", { id });
  touchAccounts(db, touched);
  return { ok: true, value: null };
}

/**
 * Tells every open view that a record's derived paid state may have moved,
 * without anyone having edited it. Settling is the one action that does that,
 * which is why it has its own event (contracts/events.md).
 */
export function emitSettlementChanged(db: LedgerDb, recordIds: number[]): void {
  ledgerEvents.emit("settlement-changed", { recordIds });
  for (const id of recordIds) {
    const record = getRecord(db, id);
    if (record) ledgerEvents.emit("record-update", { record });
  }
}

/** Re-emits one record, for a caller that changed something around it. */
export function emitRecordUpdate(db: LedgerDb, id: number): void {
  emitRecord(db, id);
}

export { getRecordRow };
