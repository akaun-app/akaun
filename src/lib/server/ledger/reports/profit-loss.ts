import { AccountRole } from "$lib/enums.js";
import { displaySign, isProfitAndLossRole } from "../account-type.js";
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
function lineFor(total: AccountTotal): ReportLine {
  return {
    accountId: total.accountId,
    accountName: total.accountName,
    amountMinor: total.amountMinor * displaySign(total.role),
  };
}

function sum(lines: ReportLine[]): Minor {
  return lines.reduce((running, line) => running + line.amountMinor, 0);
}

export function profitLoss(input: ProfitLossInput): ProfitLossReport {
  const income: ReportLine[] = [];
  const expenses: ReportLine[] = [];

  for (const total of input.totals) {
    if (!isProfitAndLossRole(total.role)) continue;
    // An account that moved nothing over the period is not a line — a report
    // listing every category the business has ever had is harder to read, not
    // more complete.
    if (total.amountMinor === 0) continue;

    const target =
      total.role === AccountRole.IncomeCategory ? income : expenses;
    target.push(lineFor(total));
  }

  const totalIncomeMinor = sum(income);
  const totalExpensesMinor = sum(expenses);

  return {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    income,
    totalIncomeMinor,
    expenses,
    totalExpensesMinor,
    resultMinor: totalIncomeMinor - totalExpensesMinor,
    notes: historyGapNotes(input.dateFrom, input.trackingStartedOn),
  };
}
