import {
  EPSILON,
  mainAmount,
  round2,
  type BalanceComparison,
  type BalanceInput,
  type BankFacingItem,
  type Step1Result,
} from "./types.js";

/** Sum bank-facing rows after converting and rounding each row individually. */
function total(items: BankFacingItem[]): number {
  return items.reduce((sum, item) => round2(sum + mainAmount(item)), 0);
}

/**
 * Compute the Step 1 book balance over rows already selected by the query
 * layer. Date, cleared-state, annotation, and claimed-expense filtering are
 * deliberately outside this pure arithmetic boundary.
 */
export function computeExpectedBalance(input: BalanceInput): Step1Result {
  const incomeTotal = total(input.incomes);
  const expenseTotal = total(input.directExpenses);
  const claimTotal = total(input.claims);
  const expected = round2(
    input.startingBalance + incomeTotal - expenseTotal - claimTotal,
  );

  return {
    expected,
    incomeTotal,
    expenseTotal,
    claimTotal,
    inScopeCounts: {
      incomes: input.incomes.length,
      directExpenses: input.directExpenses.length,
      claims: input.claims.length,
    },
  };
}

/** Compare the computed book balance with the statement's entered balance. */
export function compareBalances(
  expected: number,
  entered: number,
): BalanceComparison {
  const rawDifference = expected - entered;
  // Normalise to thousandths for the half-cent boundary so a binary
  // representation such as 0.004999999 does not turn exact EPSILON into a
  // match. Monetary differences returned to callers remain cent-rounded.
  const thresholdDifference = Math.round(rawDifference * 1000) / 1000;
  const matched = Math.abs(thresholdDifference) < EPSILON;
  const roundedDifference = round2(rawDifference);

  return {
    matched,
    difference: matched ? 0 : roundedDifference || thresholdDifference,
  };
}
