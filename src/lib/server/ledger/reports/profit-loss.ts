import { AccountType, type AccountTypeCode } from "$lib/enums.js";
import { expenseBucket, revenueBucket } from "../account-type.js";
import type {
  AccountTotal,
  Minor,
  ProfitLossReport,
  ReportLine,
} from "../types.js";
import { historyGapNotes } from "./notes.js";

/**
 * What came in, what went out, and what is left, over a date range (FR-025).
 *
 * Pure: the totals arrive already narrowed to the range by `queries/reports.ts`,
 * so this module never sees a date on a movement and never touches a database.
 * That is what lets the rule below be checked without one.
 *
 * The rule is short. A line of the breakdown is a category account's total over
 * the period, because a category *is* an account (FR-006a) — so the report and
 * the figure the same category shows on any other screen are the same
 * arithmetic over the same rows and can never disagree (FR-031). Everything
 * that is not a category is dropped, which is precisely why moving money
 * between two of the business's own accounts appears nowhere here: neither side
 * is a category (FR-007).
 */

export type ProfitLossInput = {
  dateFrom: string;
  dateTo: string;
  /** Every account's total over the range, from `accountTotalsBetween`. */
  totals: AccountTotal[];
  /** The day the ledger began, so a report reaching further back says so (FR-030). */
  trackingStartedOn?: string | null;
};

/**
 * One category's total, the way round a reader expects to see it.
 *
 * Money coming in accumulates at a negative balance under the one sign
 * convention, so `displaySign` flips it; money going out already reads
 * positive. Neither report invents its own rule (D-03).
 */
function signFor(type: AccountTypeCode): 1 | -1 {
  return type === AccountType.Asset || type === AccountType.Expense ? 1 : -1;
}

function linesForType(
  totals: AccountTotal[],
  type: AccountTypeCode,
): ReportLine[] {
  const typed = totals.filter((total) => total.type === type);
  const byId = new Map(typed.map((total) => [total.accountId, total]));
  const children = new Map<number, AccountTotal[]>();
  for (const total of typed) {
    if (total.parentId === null || !byId.has(total.parentId)) continue;
    const siblings = children.get(total.parentId) ?? [];
    siblings.push(total);
    children.set(total.parentId, siblings);
  }
  const rolled = (id: number, seen = new Set<number>()): Minor => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const own = byId.get(id)?.amountMinor ?? 0;
    return (
      own +
      (children.get(id) ?? []).reduce(
        (sum, child) => sum + rolled(child.accountId, new Set(seen)),
        0,
      )
    );
  };
  const depth = (total: AccountTotal): number => {
    let value = 0;
    let parentId = total.parentId;
    const seen = new Set([total.accountId]);
    while (parentId !== null && byId.has(parentId) && !seen.has(parentId)) {
      seen.add(parentId);
      value += 1;
      parentId = byId.get(parentId)!.parentId;
    }
    return value;
  };
  const subtreeHasActivity = (id: number, seen = new Set<number>()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return (
      (byId.get(id)?.amountMinor ?? 0) !== 0 ||
      (children.get(id) ?? []).some((child) =>
        subtreeHasActivity(child.accountId, new Set(seen)),
      )
    );
  };
  return typed.flatMap((total) => {
    const signedAmount = rolled(total.accountId) * signFor(type);
    const amountMinor = signedAmount === 0 ? 0 : signedAmount;
    if (!subtreeHasActivity(total.accountId)) return [];
    return [
      {
        accountId: total.accountId,
        accountName: total.accountName,
        amountMinor,
        parentId: total.parentId,
        depth: depth(total),
        isSubtotal: (children.get(total.accountId)?.length ?? 0) > 0,
      },
    ];
  });
}

function sum(lines: ReportLine[]): Minor {
  return lines.reduce((running, line) => running + line.amountMinor, 0);
}

export function profitLoss(input: ProfitLossInput): ProfitLossReport {
  const income = linesForType(input.totals, AccountType.Revenue);
  const expenses = linesForType(input.totals, AccountType.Expense);
  const leafLines = (lines: ReportLine[]) =>
    lines.filter((line) => !line.isSubtotal);
  const totalIncomeMinor = sum(leafLines(income));
  const totalExpensesMinor = sum(leafLines(expenses));

  const subTypeById = new Map(
    input.totals.map((total) => [total.accountId, total.subType]),
  );
  const subTypeOf = (line: ReportLine) => subTypeById.get(line.accountId) ?? null;

  const cogsMinor = sum(
    leafLines(expenses).filter((line) => expenseBucket(subTypeOf(line)) === "cogs"),
  );
  const operatingExpenseMinor = sum(
    leafLines(expenses).filter(
      (line) => expenseBucket(subTypeOf(line)) === "operating",
    ),
  );
  const operatingRevenueMinor = sum(
    leafLines(income).filter(
      (line) => revenueBucket(subTypeOf(line)) === "operating",
    ),
  );
  const grossProfitMinor = operatingRevenueMinor - cogsMinor;
  const operatingIncomeMinor = grossProfitMinor - operatingExpenseMinor;

  return {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    income,
    totalIncomeMinor,
    expenses,
    totalExpensesMinor,
    resultMinor: totalIncomeMinor - totalExpensesMinor,
    subtotals: [
      { label: "Gross profit", amountMinor: grossProfitMinor },
      { label: "Operating income", amountMinor: operatingIncomeMinor },
    ],
    notes: historyGapNotes(input.dateFrom, input.trackingStartedOn),
  };
}
