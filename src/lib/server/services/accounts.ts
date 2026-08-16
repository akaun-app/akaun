import { eq } from "drizzle-orm";
import { accounts } from "../db/schema.js";
import {
  AccountRole,
  LedgerRecordKind,
  type AccountRoleCode,
} from "$lib/enums.js";
import { diffRecords, recordAudit } from "../audit.js";
import { accountEvents } from "../ledger/events.js";
import { buildMovements } from "../ledger/entry-builder.js";
import { rankAfter } from "../ledger/rank.js";
import { fromMinor } from "../ledger/money.js";
import { mainCurrencyCode } from "../currency/form.js";
import type {
  AccountCreate,
  AccountPatch,
  AccountView,
  LedgerDb,
  Minor,
  Refusable,
} from "../ledger/types.js";
import {
  accountNameTaken,
  accountRefs,
  canDeleteAccount,
  getAccount,
  lastRankFor,
  systemAccounts,
} from "../queries/accounts.js";
import {
  deleteRecord,
  getRecordRow,
  insertRecord,
  listRecords,
  lockStateFor,
  updateRecord,
} from "../queries/ledger.js";

/**
 * Writing to the chart of accounts.
 *
 * Every path here records an audit entry and emits on `accountEvents`, so a
 * second open tab sees a new or renamed account without a refresh (FR-042).
 * Deleting is the one operation with a real rule behind it: an account holding
 * any record cannot be removed, only archived, because removing it would leave
 * movements pointing at nothing (FR-009).
 */

function emitAccount(db: LedgerDb, id: number): AccountView | null {
  const account = getAccount(db, id);
  if (account) accountEvents.emit("account-update", { account });
  return account;
}

export function createAccount(
  db: LedgerDb,
  actingUserId: number,
  data: AccountCreate,
): Refusable<AccountView> {
  const name = data.name.trim();
  if (!name) return { ok: false, reason: "Give the account a name." };

  if (accountNameTaken(db, data.role, name)) {
    return {
      ok: false,
      reason: `There is already an account called “${name}” of that kind.`,
    };
  }

  const row = db
    .insert(accounts)
    .values({
      role: data.role,
      name,
      rank: data.rank ?? rankAfter(lastRankFor(db, data.role)),
      createdBy: actingUserId,
      updatedBy: actingUserId,
    })
    .returning()
    .get()!;

  recordAudit(db, {
    recordType: "account",
    recordId: row.id,
    userId: actingUserId,
    action: "create",
  });

  const account = emitAccount(db, row.id)!;
  return { ok: true, value: account };
}

/**
 * Renames, reorders or archives an account.
 *
 * A role cannot change: an account that has been a bank account cannot become
 * an expense category without rewriting the meaning of every movement already
 * against it.
 */
export function patchAccount(
  db: LedgerDb,
  id: number,
  actingUserId: number,
  patch: AccountPatch,
): Refusable<AccountView> {
  const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!existing) return { ok: false, reason: "That account no longer exists." };

  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) {
    return { ok: false, reason: "Give the account a name." };
  }
  if (
    name &&
    accountNameTaken(db, existing.role as AccountRoleCode, name, id)
  ) {
    return {
      ok: false,
      reason: `There is already an account called “${name}” of that kind.`,
    };
  }

  if (patch.archived === true && existing.isSystem) {
    return {
      ok: false,
      reason:
        "This is one of the accounts the app needs to work, so it cannot be archived.",
    };
  }

  const updated = db
    .update(accounts)
    .set({
      ...(name ? { name } : {}),
      ...(patch.rank !== undefined ? { rank: patch.rank } : {}),
      ...(patch.archived !== undefined
        ? { archivedAt: patch.archived ? new Date().toISOString() : null }
        : {}),
      updatedBy: actingUserId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(accounts.id, id))
    .returning()
    .get()!;

  recordAudit(db, {
    recordType: "account",
    recordId: id,
    userId: actingUserId,
    action: "update",
    changes: diffRecords(existing, updated),
  });

  return { ok: true, value: emitAccount(db, id)! };
}

export function removeAccount(
  db: LedgerDb,
  id: number,
  actingUserId: number,
): Refusable<null> {
  const check = canDeleteAccount(db, id);
  if (!check.ok) {
    return {
      ok: false,
      reason: check.reason ?? "That account cannot be deleted.",
    };
  }

  const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!existing) return { ok: false, reason: "That account no longer exists." };

  db.delete(accounts).where(eq(accounts.id, id)).run();

  recordAudit(db, {
    recordType: "account",
    recordId: id,
    userId: actingUserId,
    action: "delete",
    changes: diffRecords(existing, null),
  });
  accountEvents.emit("account-deleted", { id });
  return { ok: true, value: null };
}

/**
 * Creates or replaces the account's single opening balance — what was already
 * there on the day the books start (FR-010).
 *
 * There is at most one per account, so setting it again replaces the record
 * rather than adding a second. Refused once that record has been settled or
 * matched to a bank line, like any other record.
 */
export function setOpeningBalance(
  db: LedgerDb,
  accountId: number,
  actingUserId: number,
  data: { date: string; amountMinor: Minor },
): Refusable<null> {
  const account = getAccount(db, accountId);
  if (!account) return { ok: false, reason: "That account no longer exists." };

  const system = systemAccounts(db);
  const existing = findOpeningBalanceRecord(
    db,
    accountId,
    system.openingBalancesAccountId,
  );

  if (existing !== null) {
    const lock = lockStateFor(db, existing);
    if (lock.settled || lock.reconciled) {
      return {
        ok: false,
        reason:
          "This account's opening balance is already settled or matched to a bank line, so it cannot be changed.",
      };
    }
  }

  if (data.amountMinor === 0) {
    // An opening balance of nothing is the absence of one. Removing the record
    // is what "set it to zero" means, and it keeps invariant 3 intact.
    if (existing !== null) {
      deleteRecord(db, existing);
      recordAudit(db, {
        recordType: "record",
        recordId: existing,
        userId: actingUserId,
        action: "delete",
      });
    }
    emitAccount(db, accountId);
    return { ok: true, value: null };
  }

  const built = buildMovements(
    {
      kind: "opening-balance",
      amountMinor: data.amountMinor,
      contactId: null,
      accountId,
    },
    {
      accounts: accountRefs(db, [accountId, system.openingBalancesAccountId]),
      receivableAccountId: system.receivableAccountId,
      payableAccountId: system.payableAccountId,
      openingBalancesAccountId: system.openingBalancesAccountId,
    },
  );
  if (!built.ok) return built;

  // An opening balance is always stated in the main currency — it is a figure
  // about this installation's own books, not a transaction with anyone.
  const amount = fromMinor(data.amountMinor);
  const description = `Opening balance — ${account.name}`;

  if (existing !== null) {
    const before = getRecordRow(db, existing);
    updateRecord(
      db,
      existing,
      actingUserId,
      { date: data.date, amount, description },
      built.value,
    );
    recordAudit(db, {
      recordType: "record",
      recordId: existing,
      userId: actingUserId,
      action: "update",
      changes: diffRecords(before, getRecordRow(db, existing)),
    });
  } else {
    const row = insertRecord(
      db,
      actingUserId,
      {
        kind: LedgerRecordKind.OpeningBalance,
        date: data.date,
        description,
        amount,
        currency: mainCurrencyCode(db),
        exchangeRate: 1,
      },
      built.value,
    );
    recordAudit(db, {
      recordType: "record",
      recordId: row.id,
      userId: actingUserId,
      action: "create",
    });
  }

  emitAccount(db, accountId);
  return { ok: true, value: null };
}

/** The account's one opening-balance record, or null when it has none. */
function findOpeningBalanceRecord(
  db: LedgerDb,
  accountId: number,
  openingBalancesAccountId: number,
): number | null {
  const { records } = listRecords(db, {
    kind: LedgerRecordKind.OpeningBalance,
    accountId,
    limit: 2,
  });
  const match = records.find((r) =>
    r.movements.some((m) => m.accountId === openingBalancesAccountId),
  );
  return match?.id ?? null;
}

/**
 * The pair of accounts a contact gets when they are made a partner, and the
 * archiving of that pair when the role is taken away (FR-008b).
 */
export function ensurePartnerAccounts(
  db: LedgerDb,
  contactId: number,
  contactName: string,
  actingUserId: number,
): void {
  const alreadyOwned = db
    .select({ role: accounts.role })
    .from(accounts)
    .where(eq(accounts.contactId, contactId))
    .all();

  for (const [role, suffix] of [
    [AccountRole.PartnerCapital, "money put in"],
    [AccountRole.PartnerDrawings, "money taken out"],
  ] as const) {
    if (alreadyOwned.some((a) => a.role === role)) continue;

    const row = db
      .insert(accounts)
      .values({
        role,
        name: `${contactName} — ${suffix}`,
        contactId,
        rank: rankAfter(lastRankFor(db, role)),
        createdBy: actingUserId,
        updatedBy: actingUserId,
      })
      .returning()
      .get()!;
    recordAudit(db, {
      recordType: "account",
      recordId: row.id,
      userId: actingUserId,
      action: "create",
    });
    emitAccount(db, row.id);
  }
}

/**
 * Removing the partner role: archive the pair when it holds movements, delete
 * it when it does not (FR-008b). History is never thrown away.
 */
export function retirePartnerAccounts(
  db: LedgerDb,
  contactId: number,
  actingUserId: number,
): void {
  const owned = db
    .select({ id: accounts.id, role: accounts.role })
    .from(accounts)
    .where(eq(accounts.contactId, contactId))
    .all()
    .filter(
      (a) =>
        a.role === AccountRole.PartnerCapital ||
        a.role === AccountRole.PartnerDrawings,
    );

  for (const account of owned) {
    const check = canDeleteAccount(db, account.id);
    if (check.ok) {
      removeAccount(db, account.id, actingUserId);
    } else {
      patchAccount(db, account.id, actingUserId, { archived: true });
    }
  }
}

/** Re-emits an account so a balance change from a record write reaches open tabs. */
export function touchAccounts(db: LedgerDb, accountIds: number[]): void {
  for (const id of new Set(accountIds)) emitAccount(db, id);
}
