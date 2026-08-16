import { AccountType } from "$lib/enums.js";
import { accountTypeFor, displaySign } from "../account-type.js";
import type {
  AccountTotal,
  BalanceSheetReport,
  BalanceSheetSection,
  Minor,
  ReportLine,
} from "../types.js";
import { historyGapNotes } from "./notes.js";

/**
 * What the business owns, what it owes, and what the owners have in it, as at a
 * date (FR-026).
 *
 * Pure: the totals arrive already narrowed to everything up to `asAt` by
 * `queries/reports.ts`.
 *
 * Why it balances, rather than "we hope it balances": every movement is
 * positive into an account and negative out of it, and every record's movements
 * add up to zero, so the sum across *all* accounts is zero. Rearranged, that is
 * exactly "what it owns = what it owes + what the owners have in it", with the
 * categories' running total standing in as the accumulated result. So the
 * `balances` flag is not a second calculation checking the first — it is the
 * one place a broken database shows itself (SC-007, FR-003).
 */

export type BalanceSheetInput = {
  asAt: string;
  /** Every account's total up to and including `asAt`, from `accountTotalsUpTo`. */
  totals: AccountTotal[];
  /** The day the ledger began, so a sheet reaching back past it says so (FR-030). */
  trackingStartedOn?: string | null;
};

/**
 * The one line that is not an account: everything the business has earned and
 * kept, from the first record up to this date. Id 0 marks it as having nothing
 * to open — no account holds it, it is the categories' running total brought
 * across.
 */
const ACCUMULATED_RESULT_ACCOUNT_ID = 0;
const ACCUMULATED_RESULT_LABEL = "What the business has made and kept";

function sectionFrom(lines: ReportLine[]): BalanceSheetSection {
  return {
    lines,
    totalMinor: lines.reduce((running, line) => running + line.amountMinor, 0),
  };
}

export function balanceSheet(input: BalanceSheetInput): BalanceSheetReport {
  const owned: ReportLine[] = [];
  const owed: ReportLine[] = [];
  const ownersStake: ReportLine[] = [];
  let categoriesMinor: Minor = 0;

  for (const total of input.totals) {
    const type = accountTypeFor(total.role);

    // The categories never get a line of their own here. Their running total is
    // the accumulated result, which the owners' stake carries as one figure.
    if (type === AccountType.Income || type === AccountType.Expense) {
      categoriesMinor += total.amountMinor;
      continue;
    }

    // An account holding nothing at this date is not worth a line.
    if (total.amountMinor === 0) continue;

    if (type === AccountType.Asset) {
      owned.push({
        accountId: total.accountId,
        accountName: total.accountName,
        amountMinor: total.amountMinor * displaySign(total.role),
      });
      continue;
    }

    if (type === AccountType.Liability) {
      owed.push({
        accountId: total.accountId,
        accountName: total.accountName,
        amountMinor: total.amountMinor * displaySign(total.role),
      });
      continue;
    }

    // What the owners have in it. This section negates every raw balance rather
    // than asking `displaySign`, and the difference matters for exactly one
    // role. `displaySign` answers "which way round does this account read on
    // its own", and a partner's drawings account genuinely reads positive —
    // 300 taken out is 300. This section asks a different question: what does
    // this add to what the owners have in it? Money taken out subtracts. Every
    // other equity role gives the same answer either way; negating uniformly is
    // what makes each section's total the sum of the lines printed above it.
    ownersStake.push({
      accountId: total.accountId,
      accountName: total.accountName,
      amountMinor: -total.amountMinor,
    });
  }

  const accumulatedResultMinor = -categoriesMinor;
  ownersStake.push({
    accountId: ACCUMULATED_RESULT_ACCOUNT_ID,
    accountName: ACCUMULATED_RESULT_LABEL,
    amountMinor: accumulatedResultMinor,
  });

  const ownedSection = sectionFrom(owned);
  const owedSection = sectionFrom(owed);
  const ownersStakeSection = sectionFrom(ownersStake);

  const differenceMinor =
    ownedSection.totalMinor -
    (owedSection.totalMinor + ownersStakeSection.totalMinor);
  const balances = differenceMinor === 0;

  const notes = historyGapNotes(null, input.trackingStartedOn);
  if (!balances) {
    notes.unshift(
      "These figures do not add up: what the business owns is not what it owes plus " +
        "what the owners have in it. Something is wrong in the records — run the " +
        "balance check before sending this to anyone.",
    );
  }

  return {
    asAt: input.asAt,
    owned: ownedSection,
    owed: owedSection,
    ownersStake: ownersStakeSection,
    accumulatedResultMinor,
    balances,
    differenceMinor,
    notes,
  };
}
