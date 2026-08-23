import {
  and,
  asc,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  accounts,
  contactRoles,
  contacts,
  ledgerMovements,
  ledgerRecords,
} from "../db/schema.js";
import {
  AccountType,
  Role,
  type AccountRoleCode,
  type AccountSubTypeCode,
  type AccountTypeCode,
} from "$lib/enums.js";
import { CASH_AND_EQUIVALENT_SUBTYPES } from "../ledger/account-type.js";
import { balanceSheet } from "../ledger/reports/balance-sheet.js";
import { cashFlow, type CashFlowRow } from "../ledger/reports/cash-flow.js";
import type { PartnerContact } from "../ledger/reports/partner-statement.js";
import { partnerStatement } from "../ledger/reports/partner-statement.js";
import { profitLoss } from "../ledger/reports/profit-loss.js";
import type {
  AccountTotal,
  BalanceSheetReport,
  CashFlowReport,
  LedgerDb,
  Minor,
  PartnerStatementReport,
  ProfitLossReport,
  UpgradeState,
} from "../ledger/types.js";
import { getSetting, SETTING_KEYS } from "../settings.js";

/**
 * The aggregate reads the three report modules consume.
 *
 * Everything a report shows is `SUM(amount_minor)` grouped by account over a
 * window of dates — nothing is stored, so a category's figure on a report and
 * the same category's figure anywhere else in the app are the same arithmetic
 * over the same rows (FR-031).
 *
 * The reports themselves stay pure: this file does the reading and hands plain
 * rows to `ledger/reports/*`, which is what lets those rules be tested without
 * a database at all.
 */

/**
 * Every account's total over a window, archived accounts included.
 *
 * Archived is about what is offered for *new* records (FR-009); a report of a
 * period an account was live in still has to show what went through it.
 *
 * `dateFrom` of null means "from the first record there is", which is what a
 * balance sheet as at a date needs.
 */
function accountTotals(
  db: LedgerDb,
  dateFrom: string | null,
  dateTo: string,
): AccountTotal[] {
  const window: SQL[] = [lte(ledgerRecords.date, dateTo)];
  if (dateFrom !== null) window.push(gte(ledgerRecords.date, dateFrom));

  const chart = db
    .select({
      accountId: accounts.id,
      code: accounts.code,
      accountName: accounts.name,
      type: accounts.type,
      parentId: accounts.parentId,
      role: accounts.role,
      subType: accounts.subType,
      contactId: accounts.contactId,
    })
    .from(accounts)
    .orderBy(asc(accounts.type), asc(accounts.code))
    .all();
  const totals = db
    .select({
      accountId: accounts.id,
      amountMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
    })
    .from(ledgerMovements)
    .innerJoin(ledgerRecords, eq(ledgerRecords.id, ledgerMovements.recordId))
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(and(...window))
    .groupBy(accounts.id)
    .all();
  const amountByAccount = new Map(
    totals.map((row) => [row.accountId, row.amountMinor]),
  );
  return chart.map((row) => ({
    ...row,
    code: row.code ?? row.accountId,
    type: row.type as AccountTypeCode,
    role: row.role as AccountRoleCode,
    subType: row.subType as AccountSubTypeCode | null,
    amountMinor: amountByAccount.get(row.accountId) ?? 0,
  }));
}

/** Every account's total over a date range, both ends included. */
export function accountTotalsBetween(
  db: LedgerDb,
  dateFrom: string,
  dateTo: string,
): AccountTotal[] {
  return accountTotals(db, dateFrom, dateTo);
}

/** Every account's total from the first record up to and including a date. */
export function accountTotalsUpTo(db: LedgerDb, asAt: string): AccountTotal[] {
  return accountTotals(db, null, asAt);
}

/** Exactly the contacts holding the Partner role — the statement's list (FR-008b). */
export function partnerContacts(db: LedgerDb): PartnerContact[] {
  return db
    .select({ contactId: contacts.id, contactName: contacts.legalName })
    .from(contactRoles)
    .innerJoin(contacts, eq(contacts.id, contactRoles.contactId))
    .where(eq(contactRoles.role, Role.Partner))
    .orderBy(asc(contacts.legalName))
    .all();
}

/**
 * The day the app started keeping these books, or null when it always has.
 *
 * This is the upgrade's finishing date: invoices sent before it were never
 * recorded as money owed by a customer, which is the one gap the reports have
 * to own up to (FR-030, FR-018a). An installation that never ran an upgrade has
 * no gap, and neither has one whose upgrade has not finished — there is nothing
 * to compare a report against yet.
 */
export function ledgerTrackingStartDate(db: LedgerDb): string | null {
  const stored = getSetting(db, SETTING_KEYS.ledgerUpgradeState);
  if (!stored) return null;
  try {
    const state = JSON.parse(stored) as Partial<UpgradeState>;
    return state.finishedAt ? state.finishedAt.slice(0, 10) : null;
  } catch {
    // A hand-edited setting is not worth failing a report over; the worst case
    // is a report that says nothing about the gap, which is where it started.
    return null;
  }
}

// ---------------------------------------------------------------------------
// The three reports, read and assembled. The rules stay in `ledger/reports/*`;
// all this does is give them their rows.
// ---------------------------------------------------------------------------

export function profitLossReport(
  db: LedgerDb,
  dateFrom: string,
  dateTo: string,
): ProfitLossReport {
  return profitLoss({
    dateFrom,
    dateTo,
    totals: accountTotalsBetween(db, dateFrom, dateTo),
    trackingStartedOn: ledgerTrackingStartDate(db),
  });
}

export function balanceSheetReport(
  db: LedgerDb,
  asAt: string,
): BalanceSheetReport {
  return balanceSheet({
    asAt,
    totals: accountTotalsUpTo(db, asAt),
    trackingStartedOn: ledgerTrackingStartDate(db),
  });
}

export function partnerStatementReport(
  db: LedgerDb,
  dateFrom: string,
  dateTo: string,
): PartnerStatementReport {
  // One read, two reports. The share each partner takes is a share of the
  // result for the same period, so it is worked out from the very same totals —
  // the statement and the profit and loss cannot drift apart.
  const totals = accountTotalsBetween(db, dateFrom, dateTo);
  return partnerStatement({
    dateFrom,
    dateTo,
    partners: partnerContacts(db),
    totals,
    resultMinor: profitLoss({ dateFrom, dateTo, totals }).resultMinor,
    trackingStartedOn: ledgerTrackingStartDate(db),
  });
}

/** An Asset account holding cash or a cash equivalent (FR-006). */
const IS_CASH_AND_EQUIVALENT = and(
  eq(accounts.type, AccountType.Asset),
  inArray(accounts.subType, CASH_AND_EQUIVALENT_SUBTYPES),
)!;

/**
 * Cash-and-equivalent, or a needs-review Asset account (`subType` not yet
 * set) — until an account is classified there is no way to tell which side of
 * the Cash Flow Statement its movement belongs on, so `cashFlowReport`'s row
 * query has to admit it the same way it admits real cash (research.md §5).
 */
const IS_FUND_ACCOUNT = and(
  eq(accounts.type, AccountType.Asset),
  or(isNull(accounts.subType), inArray(accounts.subType, CASH_AND_EQUIVALENT_SUBTYPES)),
)!;

/** Cash and cash equivalents summed over the records a comparator admits. */
function cashAndEquivalentMinor(db: LedgerDb, window: SQL): Minor {
  const row = db
    .select({
      totalMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
    })
    .from(ledgerMovements)
    .innerJoin(ledgerRecords, eq(ledgerRecords.id, ledgerMovements.recordId))
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(and(IS_CASH_AND_EQUIVALENT, window))
    .get();
  return row?.totalMinor ?? 0;
}

/**
 * Where the period's cash came from and what it went on (FR-006, FR-010).
 *
 * The row set is every side that is **not** cash-and-equivalent, from the
 * records that touched a fund account — the same `exists`/`not` shape
 * `fundsFlowStatement` used, substituting the fund predicate for the
 * current-asset one. `needsReviewMinor` here is read independently, the same
 * way `openingCashMinor`/`closingCashMinor` are — but it covers only the
 * needs-review **Asset** total; `cashFlow()` itself adds the needs-review
 * Liability contribution on top, from `rows`, because that one is not safe to
 * read independently of them (see `ledger/reports/cash-flow.ts`'s doc comment
 * for why, and for why the tie-out is still an identity rather than a
 * coincidence).
 */
export function cashFlowReport(
  db: LedgerDb,
  dateFrom: string,
  dateTo: string,
): CashFlowReport {
  const touchesFund = db
    .select({ one: sql`1` })
    .from(ledgerMovements)
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(and(eq(ledgerMovements.recordId, ledgerRecords.id), IS_FUND_ACCOUNT));

  const rows = db
    .select({
      accountId: accounts.id,
      type: accounts.type,
      subType: accounts.subType,
      amountMinor: ledgerMovements.amountMinor,
    })
    .from(ledgerMovements)
    .innerJoin(ledgerRecords, eq(ledgerRecords.id, ledgerMovements.recordId))
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(
      and(
        gte(ledgerRecords.date, dateFrom),
        lte(ledgerRecords.date, dateTo),
        not(IS_CASH_AND_EQUIVALENT),
        exists(touchesFund),
      ),
    )
    .all();

  // Asset only: a needs-review Asset account's own movement always qualifies,
  // because `IS_FUND_ACCOUNT` already admits it by definition. A needs-review
  // *Liability*'s movement does not — most liability activity never touches a
  // fund account at all (an accrual against an expense, say), so it must not
  // be swept in here unconditionally. `cashFlow()` picks up a needs-review
  // Liability's contribution from `rows` instead, where it is scoped to
  // records that actually touched a fund account.
  const needsReviewMinor = accountTotalsBetween(db, dateFrom, dateTo)
    .filter((total) => total.type === AccountType.Asset && total.subType == null)
    .reduce((sum, total) => sum + total.amountMinor, 0);

  const cashFlowRows: CashFlowRow[] = rows.map((row) => ({
    accountId: row.accountId,
    type: row.type as AccountTypeCode,
    subType: row.subType as AccountSubTypeCode | null,
    amountMinor: row.amountMinor,
  }));

  return cashFlow({
    dateFrom,
    dateTo,
    // Strictly before `dateFrom`, so there is no date arithmetic to get wrong.
    openingCashMinor: cashAndEquivalentMinor(db, lt(ledgerRecords.date, dateFrom)),
    closingCashMinor: cashAndEquivalentMinor(db, lte(ledgerRecords.date, dateTo)),
    needsReviewMinor,
    rows: cashFlowRows,
    trackingStartedOn: ledgerTrackingStartDate(db),
  });
}
