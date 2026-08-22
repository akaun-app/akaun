import {
  and,
  desc,
  eq,
  exists,
  gte,
  isNotNull,
  lt,
  lte,
  ne,
  not,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  accounts,
  accountDefaults,
  contacts,
  invoices,
  ledgerMovements,
  ledgerRecords,
  settlements,
} from "../db/schema.js";
import {
  AccountRole,
  AccountType,
  DefaultAccountPurpose,
  InvoiceStatus,
  LedgerRecordKind,
  type AccountTypeCode,
  type LedgerRecordKindCode,
} from "$lib/enums.js";
import type { LedgerDb, Minor } from "../ledger/types.js";
import {
  fundsFlow,
  type FundsFlowReport,
} from "../ledger/reports/funds-flow.js";
import { balanceSheetReport, ledgerTrackingStartDate } from "./reports.js";

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
function toDisplayAmount(amountMinor: number, type: AccountTypeCode): number {
  const sign =
    type === AccountType.Asset || type === AccountType.Expense ? 1 : -1;
  return (amountMinor * sign) / 100;
}

/** SUM + COUNT over one role's accounts within [from, to] (inclusive). */
function typeTotals(
  db: LedgerDb,
  type: AccountTypeCode,
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
        eq(accounts.type, type),
        gte(ledgerRecords.date, from),
        lte(ledgerRecords.date, to),
      ),
    )
    .get();
  return {
    total: toDisplayAmount(row?.totalMinor ?? 0, type),
    count: row?.count ?? 0,
  };
}

/** What was spent in [from, to] — the expense categories' movements. */
export function expenseTotals(
  db: LedgerDb,
  from: string,
  to: string,
): PeriodTotals {
  return typeTotals(db, AccountType.Expense, from, to);
}

/** What was earned in [from, to] — the income categories' movements. */
export function incomeTotals(
  db: LedgerDb,
  from: string,
  to: string,
): PeriodTotals {
  return typeTotals(db, AccountType.Revenue, from, to);
}

/**
 * What the business still owes, all time — the balance of the one we-owe
 * account. An expense is outstanding exactly while its side of that account is
 * unsettled, so this figure and the who-owes-what screens read the same rows.
 */
export function outstandingTotal(db: LedgerDb): number {
  const payableAccountId =
    db
      .select({ accountId: accountDefaults.accountId })
      .from(accountDefaults)
      .where(eq(accountDefaults.purpose, DefaultAccountPurpose.Payable))
      .get()?.accountId ?? null;
  if (payableAccountId === null) return 0;
  const row = db
    .select({
      totalMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
    })
    .from(ledgerMovements)
    .where(eq(ledgerMovements.accountId, payableAccountId))
    .get();
  return toDisplayAmount(row?.totalMinor ?? 0, AccountType.Liability);
}

/** Monthly totals for one role keyed by 'YYYY-MM', for records dated on/after `from`. */
function monthlyTotals(
  db: LedgerDb,
  type: AccountTypeCode,
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
    .where(and(eq(accounts.type, type), gte(ledgerRecords.date, from)))
    .groupBy(month)
    .all();
  return Object.fromEntries(
    rows.map((r) => [r.month, toDisplayAmount(r.totalMinor, type)]),
  );
}

export const monthlyExpenseTotals = (db: LedgerDb, from: string) =>
  monthlyTotals(db, AccountType.Expense, from);
export const monthlyIncomeTotals = (db: LedgerDb, from: string) =>
  monthlyTotals(db, AccountType.Revenue, from);

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
        eq(accounts.type, AccountType.Expense),
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
      value: toDisplayAmount(r.totalMinor, AccountType.Expense),
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
  type: AccountTypeCode,
  limit: number,
) {
  // Which side of the record carries the figure to show. An expense record can
  // name equipment, which is an asset (002 FR-006b), so a plain type test leaves
  // those rows reading 0.00 — the one place the row set is chosen by `kind` and
  // the figure by the account. The period totals above stay type-only on
  // purpose: they must agree with the profit and loss, which equipment leaves.
  const onCategorySide =
    type === AccountType.Expense
      ? sql`(${accounts.type} = ${type} or ${accounts.role} = ${AccountRole.Equipment})`
      : sql`${accounts.type} = ${type}`;
  return db
    .select({
      date: ledgerRecords.date,
      description: ledgerRecords.description,
      contactName: contacts.legalName,
      totalMinor: sql<number>`coalesce(sum(case when ${onCategorySide} then ${ledgerMovements.amountMinor} else 0 end), 0)`,
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
      amount: toDisplayAmount(r.totalMinor, type),
    }));
}

/** Most recent expenses (with contact name), newest first. */
export function recentExpenses(db: LedgerDb, limit: number) {
  return recentRecords(
    db,
    LedgerRecordKind.Expense,
    AccountType.Expense,
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
    AccountType.Revenue,
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
    WHERE ${ledgerMovements.recordId} = ${invoices.ledgerRecordId}
      AND ${ledgerMovements.accountId} = (
        SELECT ${accountDefaults.accountId} FROM ${accountDefaults}
        WHERE ${accountDefaults.purpose} = ${DefaultAccountPurpose.Receivable}
      )
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

// ---------------------------------------------------------------------------
// Financial position, and what moved it.
//
// The dashboard used to answer one of the three statements' questions — "did I
// trade profitably?" — and the standardized chart made that answer incomplete on
// its own. Equipment is capitalised, so a laptop leaves the expense figure
// entirely (002 FR-006b) and a screen showing only revenue and expenses cannot
// say where the money went. What follows adds the other two questions: what the
// business is worth, and what moved the funds it holds.
// ---------------------------------------------------------------------------

/**
 * `isMoneyPotAccount` written in SQL — the one live definition of the money
 * side, and, because equipment is the only non-current asset in the chart,
 * exactly the current assets.
 *
 * It cannot be narrowed to cash: `seed-accounts.ts` stamps `AccountRole.Bank` on
 * every asset as a compatibility value, so a bank account, a receivable and
 * inventory are indistinguishable by role. See the note on
 * `ledger/reports/funds-flow.ts`.
 */
const IS_CURRENT_ASSET = and(
  eq(accounts.type, AccountType.Asset),
  ne(accounts.role, AccountRole.Equipment),
)!;

/** Current assets summed over the records a comparator admits, in whole cents. */
function currentAssetsMinor(db: LedgerDb, window: SQL): Minor {
  const row = db
    .select({
      totalMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
    })
    .from(ledgerMovements)
    .innerJoin(ledgerRecords, eq(ledgerRecords.id, ledgerMovements.recordId))
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(and(IS_CURRENT_ASSET, window))
    .get();
  return row?.totalMinor ?? 0;
}

/** What the business holds and is owed as at a date, in whole currency units. */
export function currentAssetsAsAt(db: LedgerDb, asAt: string): number {
  return toDisplayAmount(
    currentAssetsMinor(db, lte(ledgerRecords.date, asAt)),
    AccountType.Asset,
  );
}

/**
 * What the business owns, owes and is worth, as at a date, in whole units.
 *
 * This calls the balance sheet rather than summing the three types again, so the
 * dashboard's figures and `/reports/balance-sheet` are the same arithmetic over
 * the same rows and cannot drift (FR-031). `balances` comes along for the ride:
 * it is false only when the books do not add up, and a dashboard that showed a
 * net worth without saying so would be the more misleading of the two.
 */
export function positionAsAt(
  db: LedgerDb,
  asAt: string,
): {
  assetsTotal: number;
  liabilitiesTotal: number;
  equityTotal: number;
  balances: boolean;
} {
  const report = balanceSheetReport(db, asAt);
  return {
    assetsTotal: report.owned.totalMinor / 100,
    liabilitiesTotal: report.owed.totalMinor / 100,
    equityTotal: report.ownersStake.totalMinor / 100,
    balances: report.balances,
  };
}

/**
 * Where the period's funds came from and what they went on.
 *
 * Three reads and a pure rule. The rule and the reasoning behind it are in
 * `ledger/reports/funds-flow.ts`; this only fetches its rows.
 *
 * The row set is every side that is **not** on a current asset, from the records
 * that touched one. Both halves matter. Without the `exists`, a bill taken on
 * credit would be counted although no funds moved; without the `not` on the
 * outer side, a transfer between two bank accounts would appear as both a source
 * and a use. Together they are exactly the sides that explain the movement, which
 * is why the statement ties to the cent.
 *
 * The opening and closing figures are read separately rather than derived from
 * the rows, so `ties` is a real check on the database and not a restatement of
 * the sum above it.
 */
export function fundsFlowStatement(
  db: LedgerDb,
  from: string,
  to: string,
): FundsFlowReport {
  const touchesCurrentAssets = db
    .select({ one: sql`1` })
    .from(ledgerMovements)
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(
      and(eq(ledgerMovements.recordId, ledgerRecords.id), IS_CURRENT_ASSET),
    );

  const rows = db
    .select({
      accountId: accounts.id,
      type: accounts.type,
      role: accounts.role,
      amountMinor: ledgerMovements.amountMinor,
    })
    .from(ledgerMovements)
    .innerJoin(ledgerRecords, eq(ledgerRecords.id, ledgerMovements.recordId))
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(
      and(
        gte(ledgerRecords.date, from),
        lte(ledgerRecords.date, to),
        not(IS_CURRENT_ASSET),
        exists(touchesCurrentAssets),
      ),
    )
    .all();

  const payableAccountId =
    db
      .select({ accountId: accountDefaults.accountId })
      .from(accountDefaults)
      .where(eq(accountDefaults.purpose, DefaultAccountPurpose.Payable))
      .get()?.accountId ?? null;

  return fundsFlow({
    dateFrom: from,
    dateTo: to,
    // Strictly before `from`, so there is no date arithmetic to get wrong.
    openingMinor: currentAssetsMinor(db, lt(ledgerRecords.date, from)),
    closingMinor: currentAssetsMinor(db, lte(ledgerRecords.date, to)),
    payableAccountId,
    rows: rows.map((row) => ({
      accountId: row.accountId,
      type: row.type as AccountTypeCode,
      role: row.role,
      amountMinor: row.amountMinor,
    })),
    trackingStartedOn: ledgerTrackingStartDate(db),
  });
}
