import { and, desc, eq, gte, isNotNull, lt, lte, sql } from "drizzle-orm";
import {
  accounts,
  contacts,
  invoices,
  ledgerMovements,
  ledgerRecords,
  settlements,
} from "../db/schema.js";
import {
  AccountRole,
  InvoiceStatus,
  LedgerRecordKind,
  type AccountRoleCode,
  type LedgerRecordKindCode,
} from "$lib/enums.js";
import { displaySign } from "../ledger/account-type.js";
import { systemAccountId } from "./accounts.js";
import type { LedgerDb } from "../ledger/types.js";

export type PeriodTotals = { total: number; count: number };

/**
 * Dashboard aggregates computed in SQL (SUM / COUNT / GROUP BY) instead of
 * loading every row into JS. The dashboard is the PWA start_url, so keeping this
 * load cheap directly improves cold-start time. (SQLite here is synchronous, so
 * streaming / Promise.all would not help — doing less work is the win.)
 *
 * Every figure is the sum of `ledger_movements.amount_minor` over a window of
 * record dates — the same rows, and the same arithmetic, the profit and loss
 * runs (FR-031). Because a category is an account (FR-006a), "income" and
 * "expenses" here mean the movements on income-category and expense-category
 * accounts, so money moved between two places the business holds touches
 * neither and can never show up as either (FR-007).
 *
 * Movement amounts are whole cents, positive when value goes into the account.
 * Income therefore accumulates negative and is turned the right way up by
 * `displaySign`, in the same one place every report uses (D-03). The figures
 * leave here in whole currency units, which is what the dashboard formats.
 */

/** Cents, turned the way a reader expects, in whole currency units. */
function toDisplayAmount(amountMinor: number, role: AccountRoleCode): number {
  return (amountMinor * displaySign(role)) / 100;
}

/** SUM + COUNT over one role's accounts within [from, to] (inclusive). */
function roleTotals(
  db: LedgerDb,
  role: AccountRoleCode,
  from: string,
  to: string,
): PeriodTotals {
  const row = db
    .select({
      totalMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
      // One record can touch two categories; the dashboard counts records,
      // not sides.
      count: sql<number>`count(distinct ${ledgerMovements.recordId})`,
    })
    .from(ledgerMovements)
    .innerJoin(ledgerRecords, eq(ledgerRecords.id, ledgerMovements.recordId))
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(
      and(
        eq(accounts.role, role),
        gte(ledgerRecords.date, from),
        lte(ledgerRecords.date, to),
      ),
    )
    .get();
  return {
    total: toDisplayAmount(row?.totalMinor ?? 0, role),
    count: row?.count ?? 0,
  };
}

/** What was spent in [from, to] — the expense categories' movements. */
export function expenseTotals(
  db: LedgerDb,
  from: string,
  to: string,
): PeriodTotals {
  return roleTotals(db, AccountRole.ExpenseCategory, from, to);
}

/** What was earned in [from, to] — the income categories' movements. */
export function incomeTotals(
  db: LedgerDb,
  from: string,
  to: string,
): PeriodTotals {
  return roleTotals(db, AccountRole.IncomeCategory, from, to);
}

/**
 * What the business still owes, all time — the balance of the one we-owe
 * account. An expense is outstanding exactly while its side of that account is
 * unsettled, so this figure and the who-owes-what screens read the same rows.
 */
export function outstandingTotal(db: LedgerDb): number {
  const payableAccountId = systemAccountId(db, AccountRole.Payable);
  if (payableAccountId === null) return 0;
  const row = db
    .select({
      totalMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
    })
    .from(ledgerMovements)
    .where(eq(ledgerMovements.accountId, payableAccountId))
    .get();
  return toDisplayAmount(row?.totalMinor ?? 0, AccountRole.Payable);
}

/** Monthly totals for one role keyed by 'YYYY-MM', for records dated on/after `from`. */
function monthlyTotals(
  db: LedgerDb,
  role: AccountRoleCode,
  from: string,
): Record<string, number> {
  const month = sql<string>`substr(${ledgerRecords.date}, 1, 7)`;
  const rows = db
    .select({
      month,
      totalMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
    })
    .from(ledgerMovements)
    .innerJoin(ledgerRecords, eq(ledgerRecords.id, ledgerMovements.recordId))
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(and(eq(accounts.role, role), gte(ledgerRecords.date, from)))
    .groupBy(month)
    .all();
  return Object.fromEntries(
    rows.map((r) => [r.month, toDisplayAmount(r.totalMinor, role)]),
  );
}

export const monthlyExpenseTotals = (db: LedgerDb, from: string) =>
  monthlyTotals(db, AccountRole.ExpenseCategory, from);
export const monthlyIncomeTotals = (db: LedgerDb, from: string) =>
  monthlyTotals(db, AccountRole.IncomeCategory, from);

/**
 * Top expense categories within [from, to], descending.
 *
 * Each line is one expense-category account's movement over the period, which
 * is exactly what the same line of the profit and loss is (FR-025).
 */
export function expenseCategoryBreakdown(
  db: LedgerDb,
  from: string,
  to: string,
  limit = 6,
): { label: string; value: number }[] {
  return db
    .select({
      label: accounts.name,
      totalMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
    })
    .from(ledgerMovements)
    .innerJoin(ledgerRecords, eq(ledgerRecords.id, ledgerMovements.recordId))
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(
      and(
        eq(accounts.role, AccountRole.ExpenseCategory),
        gte(ledgerRecords.date, from),
        lte(ledgerRecords.date, to),
      ),
    )
    .groupBy(accounts.id)
    .orderBy(desc(sql`sum(${ledgerMovements.amountMinor})`))
    .limit(limit)
    .all()
    .map((r) => ({
      label: r.label,
      value: toDisplayAmount(r.totalMinor, AccountRole.ExpenseCategory),
    }));
}

/**
 * The newest records of one kind with the contact they name and the figure that
 * landed on their category, newest first.
 *
 * One statement however many sides each record has: the movements are joined in
 * and summed per record, counting only the sides on a category account so the
 * figure shown is what was spent or earned rather than every side added up.
 */
function recentRecords(
  db: LedgerDb,
  kind: LedgerRecordKindCode,
  role: AccountRoleCode,
  limit: number,
) {
  return db
    .select({
      date: ledgerRecords.date,
      description: ledgerRecords.description,
      contactName: contacts.legalName,
      totalMinor: sql<number>`coalesce(sum(case when ${accounts.role} = ${role} then ${ledgerMovements.amountMinor} else 0 end), 0)`,
    })
    .from(ledgerRecords)
    .leftJoin(ledgerMovements, eq(ledgerMovements.recordId, ledgerRecords.id))
    .leftJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .leftJoin(contacts, eq(contacts.id, ledgerRecords.contactId))
    .where(eq(ledgerRecords.kind, kind))
    .groupBy(ledgerRecords.id)
    .orderBy(desc(ledgerRecords.date), desc(ledgerRecords.id))
    .limit(limit)
    .all()
    .map((r) => ({
      date: r.date,
      description: r.description,
      contactName: r.contactName,
      amount: toDisplayAmount(r.totalMinor, role),
    }));
}

/** Most recent expenses (with contact name), newest first. */
export function recentExpenses(db: LedgerDb, limit: number) {
  return recentRecords(
    db,
    LedgerRecordKind.Expense,
    AccountRole.ExpenseCategory,
    limit,
  ).map((r) => ({
    date: r.date,
    name: r.description,
    sub: r.contactName,
    amount: r.amount,
  }));
}

/** Most recent incomes (with contact name), newest first. */
export function recentIncomes(db: LedgerDb, limit: number) {
  return recentRecords(
    db,
    LedgerRecordKind.Income,
    AccountRole.IncomeCategory,
    limit,
  ).map((r) => ({
    date: r.date,
    name: r.contactName,
    sub: r.description,
    amount: r.amount,
  }));
}

/**
 * Whether an invoice still has money outstanding against it.
 *
 * NOT `status != Paid`. Nothing writes `InvoiceStatus.Paid` any more — an
 * invoice's status carries only the document lifecycle (draft, sent, cancelled)
 * and whether it is paid is worked out from the settlements against the side it
 * put on the shared owed account (D-10). Reading the status here counted a fully
 * settled invoice as outstanding forever, and a cancelled one as outstanding
 * too, which is the two-screens-disagreeing failure FR-031 exists to prevent.
 *
 * Cancelled invoices are excluded outright: a called-off invoice is owed by
 * nobody, whatever its Receivable side once said.
 */
const OUTSTANDING_INVOICE = sql`
  ${invoices.status} != ${InvoiceStatus.Cancelled}
  AND ${invoices.ledgerRecordId} IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM ${ledgerMovements}
    INNER JOIN ${accounts} ON ${accounts.id} = ${ledgerMovements.accountId}
    WHERE ${ledgerMovements.recordId} = ${invoices.ledgerRecordId}
      AND ${accounts.role} = ${AccountRole.Receivable}
      AND abs(${ledgerMovements.amountMinor}) > coalesce((
        SELECT sum(${settlements.amountMinor}) FROM ${settlements}
        WHERE ${settlements.owedMovementId} = ${ledgerMovements.id}
           OR ${settlements.paymentMovementId} = ${ledgerMovements.id}
      ), 0)
  )`;

/**
 * An invoice sent before the upgrade has no ledger record behind it, so there is
 * nothing to settle against. Its old stored status is the only thing that ever
 * described it, and it is the one place that column is still worth reading.
 */
const OUTSTANDING_PRE_UPGRADE = sql`
  ${invoices.ledgerRecordId} IS NULL
  AND ${invoices.status} = ${InvoiceStatus.Sent}`;

/** COUNT and SUM(total) of every invoice still owing (all time). */
export function outstandingInvoicesSummary(db: LedgerDb): {
  count: number;
  total: number;
} {
  const row = db
    .select({
      count: sql<number>`count(*)`,
      total: sql<number>`coalesce(sum(${invoices.total}), 0)`,
    })
    .from(invoices)
    .where(sql`(${OUTSTANDING_INVOICE}) OR (${OUTSTANDING_PRE_UPGRADE})`)
    .get();
  return { count: row?.count ?? 0, total: row?.total ?? 0 };
}

/** COUNT of invoices past their due date that are still owing. */
export function overdueInvoicesCount(db: LedgerDb): number {
  const today = new Date().toISOString().slice(0, 10);
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(invoices)
    .where(
      and(
        isNotNull(invoices.dueDate),
        lt(invoices.dueDate, today),
        sql`(${OUTSTANDING_INVOICE}) OR (${OUTSTANDING_PRE_UPGRADE})`,
      ),
    )
    .get();
  return row?.count ?? 0;
}
