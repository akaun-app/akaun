import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  accounts,
  contacts,
  ledgerMovements,
  ledgerRecords,
} from "../db/schema.js";
import {
  AccountRole,
  type AccountRoleCode,
  type LedgerRecordKindCode,
} from "$lib/enums.js";
import { accountTypeFor } from "../ledger/account-type.js";
import type {
  AccountHistoryEntry,
  AccountHistoryReport,
  AccountRef,
  AccountRow,
  AccountView,
  LedgerDb,
  Minor,
  SystemAccountIds,
} from "../ledger/types.js";
import { getSetting, SETTING_KEYS } from "../settings.js";

/**
 * Reading the chart of accounts.
 *
 * An account's balance is `SUM(amount_minor)` over its movements — nothing is
 * stored, so the chart of accounts and a report can never disagree (FR-031).
 * The type shown beside each account is looked up from its role, never read
 * from a column (D-05).
 */

/** A row as it comes back from the table, with the enum widened to its code type. */
function toAccountRow(row: typeof accounts.$inferSelect): AccountRow {
  return {
    id: row.id,
    role: row.role as AccountRoleCode,
    name: row.name,
    contactId: row.contactId,
    isSystem: row.isSystem,
    rank: row.rank,
    archivedAt: row.archivedAt,
  };
}

/** Why an account cannot be deleted, or null when it can (FR-009). */
function cannotDeleteReason(
  row: AccountRow,
  movementCount: number,
): string | null {
  if (row.isSystem) {
    return "This is one of the accounts the app needs to work, so it cannot be deleted.";
  }
  if (movementCount > 0) {
    return movementCount === 1
      ? "One record uses this account. Archive it instead — it will stop being offered for new records and its history stays."
      : `${movementCount} records use this account. Archive it instead — it will stop being offered for new records and its history stays.`;
  }
  return null;
}

export type AccountFilters = {
  role?: AccountRoleCode | AccountRoleCode[];
  includeArchived?: boolean;
  contactId?: number;
};

function accountConditions(filters: AccountFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.role !== undefined) {
    conditions.push(
      Array.isArray(filters.role)
        ? inArray(accounts.role, filters.role)
        : eq(accounts.role, filters.role),
    );
  }
  if (filters.contactId !== undefined) {
    conditions.push(eq(accounts.contactId, filters.contactId));
  }
  if (!filters.includeArchived) conditions.push(isNull(accounts.archivedAt));
  return conditions;
}

/**
 * The chart of accounts with each account's balance, how many records use it,
 * and whether it can be deleted.
 *
 * One grouped aggregate over the movements table rather than a per-account
 * query, so the screen is two statements however many accounts there are.
 */
export function listAccounts(
  db: LedgerDb,
  filters: AccountFilters = {},
): AccountView[] {
  const conditions = accountConditions(filters);
  const rows = db
    .select()
    .from(accounts)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(accounts.role), asc(accounts.rank))
    .all();

  if (rows.length === 0) return [];

  const totals = db
    .select({
      accountId: ledgerMovements.accountId,
      balanceMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
      movementCount: sql<number>`count(*)`,
    })
    .from(ledgerMovements)
    .where(
      inArray(
        ledgerMovements.accountId,
        rows.map((r) => r.id),
      ),
    )
    .groupBy(ledgerMovements.accountId)
    .all();

  const byId = new Map(totals.map((t) => [t.accountId, t]));

  return rows.map((raw) => {
    const row = toAccountRow(raw);
    const totalsFor = byId.get(row.id);
    const movementCount = totalsFor?.movementCount ?? 0;
    const reason = cannotDeleteReason(row, movementCount);
    return {
      ...row,
      type: accountTypeFor(row.role),
      balanceMinor: totalsFor?.balanceMinor ?? 0,
      movementCount,
      canDelete: reason === null,
      cannotDeleteReason: reason,
    };
  });
}

export function getAccount(db: LedgerDb, id: number): AccountView | null {
  const raw = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!raw) return null;
  const row = toAccountRow(raw);

  const totals = db
    .select({
      balanceMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
      movementCount: sql<number>`count(*)`,
    })
    .from(ledgerMovements)
    .where(eq(ledgerMovements.accountId, id))
    .get();

  const movementCount = totals?.movementCount ?? 0;
  const reason = cannotDeleteReason(row, movementCount);
  return {
    ...row,
    type: accountTypeFor(row.role),
    balanceMinor: totals?.balanceMinor ?? 0,
    movementCount,
    canDelete: reason === null,
    cannotDeleteReason: reason,
  };
}

/** One account's balance, without the rest of the chart. */
export function accountBalanceMinor(db: LedgerDb, id: number): Minor {
  const row = db
    .select({
      balanceMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
    })
    .from(ledgerMovements)
    .where(eq(ledgerMovements.accountId, id))
    .get();
  return row?.balanceMinor ?? 0;
}

export function movementCountFor(db: LedgerDb, id: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(ledgerMovements)
    .where(eq(ledgerMovements.accountId, id))
    .get();
  return row?.n ?? 0;
}

/** Whether an account may be deleted outright, and why not when it may not. */
export function canDeleteAccount(
  db: LedgerDb,
  id: number,
): { ok: boolean; reason: string | null } {
  const raw = db.select().from(accounts).where(eq(accounts.id, id)).get();
  if (!raw) return { ok: false, reason: "That account no longer exists." };
  const reason = cannotDeleteReason(
    toAccountRow(raw),
    movementCountFor(db, id),
  );
  return { ok: reason === null, reason };
}

/**
 * Just enough about the accounts an entry names for `entry-builder.ts` to check
 * a role without reaching for the database itself.
 */
export function accountRefs(
  db: LedgerDb,
  ids: number[],
): Map<number, AccountRef> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id)))];
  if (unique.length === 0) return new Map();
  const rows = db
    .select({ id: accounts.id, role: accounts.role })
    .from(accounts)
    .where(inArray(accounts.id, unique))
    .all();
  return new Map(
    rows.map((r) => [r.id, { id: r.id, role: r.role as AccountRoleCode }]),
  );
}

/** The one account of a system role, or null before the upgrade has seeded it. */
export function systemAccountId(
  db: LedgerDb,
  role: AccountRoleCode,
): number | null {
  const row = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.role, role), eq(accounts.isSystem, true)))
    .orderBy(asc(accounts.id))
    .get();
  return row?.id ?? null;
}

/**
 * The system accounts every write path needs, resolved once per request.
 *
 * Throws rather than returning nulls: every one of these is seeded before the
 * first request is served, so a missing one is a broken installation and not a
 * case any caller can sensibly handle.
 */
export function systemAccounts(db: LedgerDb): SystemAccountIds {
  const receivableAccountId = systemAccountId(db, AccountRole.Receivable);
  const payableAccountId = systemAccountId(db, AccountRole.Payable);
  const openingBalancesAccountId = systemAccountId(
    db,
    AccountRole.OpeningBalances,
  );
  const uncategorisedAccountId = systemAccountId(
    db,
    AccountRole.ExpenseCategory,
  );

  if (
    receivableAccountId === null ||
    payableAccountId === null ||
    openingBalancesAccountId === null ||
    uncategorisedAccountId === null
  ) {
    throw new Error(
      "The chart of accounts is missing one of the accounts the app needs. Restart the app so it can finish setting itself up.",
    );
  }

  return {
    defaultAccountId: defaultAccountId(db) ?? 0,
    receivableAccountId,
    payableAccountId,
    openingBalancesAccountId,
    uncategorisedAccountId,
  };
}

/**
 * The account new records pre-select (FR-011). Falls back to the first bank
 * account so a database whose setting was cleared by hand still works.
 */
export function defaultAccountId(db: LedgerDb): number | null {
  const stored = getSetting(db, SETTING_KEYS.ledgerDefaultAccountId);
  if (stored) {
    const id = Number(stored);
    const exists = db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.id, id))
      .get();
    if (exists) return exists.id;
  }
  return systemAccountId(db, AccountRole.Bank);
}

/** The last rank in a role's list, so a new account sorts after it. */
export function lastRankFor(
  db: LedgerDb,
  role: AccountRoleCode,
): string | null {
  const row = db
    .select({ rank: accounts.rank })
    .from(accounts)
    .where(eq(accounts.role, role))
    .orderBy(desc(accounts.rank))
    .limit(1)
    .get();
  return row?.rank ?? null;
}

/**
 * One account's full history with a running balance (FR-028).
 *
 * The running balance is cumulative from the beginning of the account, not from
 * the start of the window, so a page showing March still says what the account
 * actually held on each of those days. That is why the opening figure is a
 * separate aggregate over everything before `dateFrom` rather than a total of
 * the rows on screen.
 *
 * There is deliberately NO `offset`. It is the one parameter that cannot simply
 * be passed through: the opening figure covers everything before `dateFrom`, so
 * skipping rows inside the window would leave every running balance — and the
 * closing balance — counted from the wrong starting point, silently. Narrowing
 * the window with `dateFrom`/`dateTo` is the way to look at part of a long
 * history, and it is the affordance the screen already offers. If real paging is
 * ever wanted, this function has to fold the skipped movements into
 * `openingBalanceMinor` first; until then the caller is told what it is not
 * seeing rather than shown something wrong.
 */
export function accountHistory(
  db: LedgerDb,
  accountId: number,
  options: {
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  } = {},
): AccountHistoryReport | null {
  const account = getAccount(db, accountId);
  if (!account) return null;

  const window: SQL[] = [eq(ledgerMovements.accountId, accountId)];
  if (options.dateFrom) window.push(gte(ledgerRecords.date, options.dateFrom));
  if (options.dateTo) window.push(lte(ledgerRecords.date, options.dateTo));

  const openingBalanceMinor = options.dateFrom
    ? (db
        .select({
          total: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
        })
        .from(ledgerMovements)
        .innerJoin(
          ledgerRecords,
          eq(ledgerRecords.id, ledgerMovements.recordId),
        )
        .where(
          and(
            eq(ledgerMovements.accountId, accountId),
            lt(ledgerRecords.date, options.dateFrom),
          ),
        )
        .get()?.total ?? 0)
    : 0;

  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(ledgerMovements)
      .innerJoin(ledgerRecords, eq(ledgerRecords.id, ledgerMovements.recordId))
      .where(and(...window))
      .get()?.n ?? 0;

  const rows = db
    .select({
      movementId: ledgerMovements.id,
      amountMinor: ledgerMovements.amountMinor,
      recordId: ledgerRecords.id,
      recordNumber: ledgerRecords.recordNumber,
      date: ledgerRecords.date,
      kind: ledgerRecords.kind,
      description: ledgerRecords.description,
      contactName: contacts.legalName,
    })
    .from(ledgerMovements)
    .innerJoin(ledgerRecords, eq(ledgerRecords.id, ledgerMovements.recordId))
    .leftJoin(contacts, eq(contacts.id, ledgerRecords.contactId))
    .where(and(...window))
    .orderBy(asc(ledgerRecords.date), asc(ledgerMovements.id))
    .limit(options.limit ?? 500)
    .all();

  let running = openingBalanceMinor;
  const entries: AccountHistoryEntry[] = rows.map((row) => {
    running += row.amountMinor;
    return {
      movementId: row.movementId,
      recordId: row.recordId,
      recordNumber: row.recordNumber,
      date: row.date,
      kind: row.kind as LedgerRecordKindCode,
      description: row.description,
      contactName: row.contactName ?? null,
      amountMinor: row.amountMinor,
      runningBalanceMinor: running,
    };
  });

  return {
    account,
    entries,
    openingBalanceMinor,
    closingBalanceMinor: running,
    total,
    notes: [],
  };
}

/** Whether an account of this role and name already exists (the unique index). */
export function accountNameTaken(
  db: LedgerDb,
  role: AccountRoleCode,
  name: string,
  exceptId?: number,
): boolean {
  const row = db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.role, role), eq(accounts.name, name)))
    .get();
  return row !== undefined && row.id !== exceptId;
}
