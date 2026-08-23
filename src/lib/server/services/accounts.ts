import { eq, sql } from "drizzle-orm";
import { accountDefaults, accounts, bankStatements, ledgerMovements } from "../db/schema.js";
import {
  AccountSubType,
  AccountSubTypesByType,
  AccountType,
  DefaultAccountPurpose,
  LedgerRecordKind,
  type AccountSubTypeCode,
  type AccountTypeCode,
} from "$lib/enums.js";
import { diffRecords, recordAudit } from "../audit.js";
import { accountEvents } from "../ledger/events.js";
import { buildMovements } from "../ledger/entry-builder.js";
import { rankAfter } from "../ledger/rank.js";
import { lowestFreeAccountCode } from "../ledger/account-code.js";
import {
  legacyRoleForAccountType,
  NEEDS_REVIEW_TYPES,
} from "../ledger/account-type.js";
import { canAddAccountChild, canChangeAccountSubType, canChangeAccountType, canDeactivateAccount, canDeleteAccount as deletionEligibility } from "../ledger/account-eligibility.js";
import { descendantsOf, validateAccountParent } from "../ledger/account-hierarchy.js";
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
  accountRefs,
  getAccount,
  openingBalanceFor,
} from "../queries/accounts.js";
import { requireAccountDefault } from "./account-defaults.js";
import {
  deleteRecord,
  getRecordRow,
  insertRecord,
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

  {
    const allowed = AccountSubTypesByType[data.type];
    if (allowed === undefined) {
      if (data.subType !== undefined) {
        return {
          ok: false,
          reason: "A sub-type does not apply to this account type.",
        };
      }
    } else {
      if (
        data.type === AccountType.Asset &&
        data.subType === AccountSubType.Equipment
      ) {
        return {
          ok: false,
          reason:
            "Equipment is chosen on the record form as what money was spent on, not set here.",
        };
      }
      if (data.subType !== undefined && !allowed.includes(data.subType)) {
        return {
          ok: false,
          reason: "That sub-type does not belong to this account type.",
        };
      }
      if (
        data.subType === undefined &&
        NEEDS_REVIEW_TYPES.includes(data.type)
      ) {
        return { ok: false, reason: "Choose what kind of account this is." };
      }
    }
  }

  let row: typeof accounts.$inferSelect;
  try {
    row = db.transaction((tx) => {
      const hierarchy = tx.select({ id: accounts.id, type: accounts.type, parentId: accounts.parentId }).from(accounts).all()
        .filter((item): item is { id: number; type: AccountTypeCode; parentId: number | null } => item.type != null);
      const temporaryId = -1;
      const parentCheck = validateAccountParent([...hierarchy, { id: temporaryId, type: data.type, parentId: null }], temporaryId, data.parentId ?? null);
      if (!parentCheck.ok) throw new AccountRefusal(parentCheck.reason);
      if (data.parentId != null) {
        const eligibility = canAddAccountChild(dependencyState(tx, data.parentId));
        if (!eligibility.ok) throw new AccountRefusal(eligibility.reason);
      }
      const codes = tx.select({ code: accounts.code }).from(accounts).all().flatMap((item) => item.code == null ? [] : [item.code]);
      const inserted = tx.insert(accounts).values({
        role: legacyRoleForAccountType(data.type), type: data.type,
        subType: AccountSubTypesByType[data.type] !== undefined ? (data.subType ?? null) : null,
        code: lowestFreeAccountCode(data.type, codes), name,
        parentId: data.parentId ?? null, rank: rankAfter(null),
        createdBy: actingUserId, updatedBy: actingUserId,
      }).returning().get()!;
      recordAudit(tx, { recordType: "account", recordId: inserted.id, userId: actingUserId, action: "create" });
      return inserted;
    });
  } catch (error) {
    if (error instanceof AccountRefusal) return { ok: false, reason: error.message };
    throw error;
  }

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
  if (patch.active === false && existing.isSystem) {
    return {
      ok: false,
      reason:
        "This is one of the accounts the app needs to work, so it cannot be archived.",
    };
  }

  const effectiveType = patch.type ?? (existing.type as AccountTypeCode);
  if (patch.subType !== undefined) {
    const allowed = AccountSubTypesByType[effectiveType];
    if (allowed === undefined) {
      return {
        ok: false,
        reason: "A sub-type does not apply to this account type.",
      };
    }
    if (
      effectiveType === AccountType.Asset &&
      patch.subType === AccountSubType.Equipment
    ) {
      return {
        ok: false,
        reason:
          "Equipment is chosen on the record form as what money was spent on, not set here.",
      };
    }
    if (!allowed.includes(patch.subType)) {
      return {
        ok: false,
        reason: "That sub-type does not belong to this account type.",
      };
    }
  }

  // A type change without an explicit new sub-type leaves the old sub-type's
  // *value* in place; once it no longer belongs to `effectiveType`'s allowed
  // set (e.g. an Asset's `Cash` code becoming a Liability), it must be
  // cleared to "needs review" rather than silently misread by a report.
  const staleSubType =
    patch.type !== undefined &&
    patch.type !== existing.type &&
    patch.subType === undefined &&
    existing.subType !== null &&
    !(AccountSubTypesByType[effectiveType] ?? []).includes(
      existing.subType as AccountSubTypeCode,
    );

  const state = dependencyState(db, id);
  if (patch.type !== undefined && patch.type !== existing.type) {
    const check = canChangeAccountType(state);
    if (!check.ok) return check;
  }
  if (patch.subType !== undefined && patch.subType !== existing.subType) {
    const check = canChangeAccountSubType({
      canChange: true,
      isSystem: existing.isSystem,
      archived: existing.archivedAt !== null,
    });
    if (!check.ok) return check;
  }
  if (patch.active === false) {
    const check = canDeactivateAccount(state);
    if (!check.ok) return check;
  }
  const hierarchy = hierarchyRows(db);
  if (patch.parentId !== undefined) {
    const check = validateAccountParent(hierarchy, id, patch.parentId);
    if (!check.ok) return check;
    if (patch.parentId != null) {
      const parentState = dependencyState(db, patch.parentId);
      const parentCheck = canAddAccountChild(parentState);
      if (!parentCheck.ok) return parentCheck;
    }
  }

  try {
    db.transaction((tx) => {
      let code = existing.code;
      if (patch.type !== undefined && patch.type !== existing.type) {
        const codes = tx.select({ code: accounts.code }).from(accounts).all().flatMap((item) => item.code == null ? [] : [item.code]);
        code = lowestFreeAccountCode(patch.type, codes);
      }
      const result = tx.update(accounts).set({
        ...(name ? { name } : {}),
        ...(patch.type !== undefined ? { type: patch.type, role: legacyRoleForAccountType(patch.type), code } : {}),
        ...(patch.subType !== undefined
          ? { subType: patch.subType }
          : staleSubType
            ? { subType: null }
            : {}),
        ...(patch.parentId !== undefined ? { parentId: patch.parentId } : {}),
        ...(patch.active !== undefined ? { archivedAt: patch.active ? null : new Date().toISOString() } : {}),
        updatedBy: actingUserId, updatedAt: new Date().toISOString(),
      }).where(eq(accounts.id, id)).returning().get()!;
      recordAudit(tx, { recordType: "account", recordId: id, userId: actingUserId, action: "update", changes: diffRecords(existing, result) });
    });
  } catch (error) {
    if (error instanceof AccountRefusal) return { ok: false, reason: error.message };
    throw error;
  }

  const account = emitAccount(db, id)!;
  if (patch.parentId !== undefined || (patch.type !== undefined && patch.type !== existing.type)) {
    accountEvents.emit("accounts-refresh", { reason: "hierarchy" });
  }
  return { ok: true, value: account };
}

export function removeAccount(
  db: LedgerDb,
  id: number,
  actingUserId: number,
): Refusable<null> {
  const existing = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!existing) return { ok: false, reason: "That account no longer exists." };
  if (existing.isSystem) return { ok: false, reason: "This is one of the accounts the app needs to work, so it cannot be deleted." };
  const check = deletionEligibility(dependencyState(db, id));
  if (!check.ok) {
    return {
      ok: false,
      reason: check.reason ?? "That account cannot be deleted.",
    };
  }

  db.transaction((tx) => {
    tx.delete(accounts).where(eq(accounts.id, id)).run();
    recordAudit(tx, {
      recordType: "account",
      recordId: id,
      userId: actingUserId,
      action: "delete",
      changes: diffRecords(existing, null),
    });
  });
  accountEvents.emit("account-deleted", { id });
  return { ok: true, value: null };
}

class AccountRefusal extends Error {}

function hierarchyRows(db: LedgerDb) {
  return db.select({ id: accounts.id, type: accounts.type, parentId: accounts.parentId }).from(accounts).all()
    .filter((row): row is { id: number; type: AccountTypeCode; parentId: number | null } => row.type != null);
}

function dependencyState(db: LedgerDb, id: number) {
  const hierarchy = hierarchyRows(db);
  const descendants = descendantsOf(hierarchy, id);
  const childCount = hierarchy.filter((row) => row.parentId === id).length;
  const activeDescendantCount = descendants.filter((descendantId) => {
    const row = db.select({ archivedAt: accounts.archivedAt }).from(accounts).where(eq(accounts.id, descendantId)).get();
    return row?.archivedAt == null;
  }).length;
  return {
    movementCount:
      db
        .select({ n: sql<number>`count(*)` })
        .from(ledgerMovements)
        .where(eq(ledgerMovements.accountId, id))
        .get()?.n ?? 0,
    childCount,
    statementCount:
      db
        .select({ n: sql<number>`count(*)` })
        .from(bankStatements)
        .where(eq(bankStatements.accountId, id))
        .get()?.n ?? 0,
    defaultCount:
      db
        .select({ n: sql<number>`count(*)` })
        .from(accountDefaults)
        .where(eq(accountDefaults.accountId, id))
        .get()?.n ?? 0,
    otherDependencyCount: 0,
    activeDescendantCount,
  };
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

  const opening = requireAccountDefault(db, DefaultAccountPurpose.OpeningBalances);
  if (!opening.ok) return opening;
  const receivable = requireAccountDefault(db, DefaultAccountPurpose.Receivable);
  if (!receivable.ok) return receivable;
  const payable = requireAccountDefault(db, DefaultAccountPurpose.Payable);
  if (!payable.ok) return payable;
  const existing = openingBalanceFor(db, accountId)?.recordId ?? null;

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
      accounts: accountRefs(db, [accountId, opening.value]),
      receivableAccountId: receivable.value,
      payableAccountId: payable.value,
      openingBalancesAccountId: opening.value,
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
  // Contact roles remain contact metadata. They no longer create accounts;
  // partner capital/drawings are ordinary Equity accounts in the fixed chart.
  void db; void contactId; void contactName; void actingUserId;
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
  // Removing a contact's Partner role must not mutate the independent chart.
  void db; void contactId; void actingUserId;
}

/** Re-emits an account so a balance change from a record write reaches open tabs. */
export function touchAccounts(db: LedgerDb, accountIds: number[]): void {
  for (const id of new Set(accountIds)) emitAccount(db, id);
}
