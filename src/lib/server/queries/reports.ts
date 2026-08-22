import { and, asc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  accounts,
  contactRoles,
  contacts,
  ledgerMovements,
  ledgerRecords,
} from "../db/schema.js";
import {
  Role,
  type AccountRoleCode,
  type AccountTypeCode,
} from "$lib/enums.js";
import { balanceSheet } from "../ledger/reports/balance-sheet.js";
import type { PartnerContact } from "../ledger/reports/partner-statement.js";
import { partnerStatement } from "../ledger/reports/partner-statement.js";
import { profitLoss } from "../ledger/reports/profit-loss.js";
import type {
  AccountTotal,
  BalanceSheetReport,
  LedgerDb,
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
