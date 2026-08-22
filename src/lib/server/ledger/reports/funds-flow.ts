import { AccountType, type AccountTypeCode } from "$lib/enums.js";
import { isEquipmentAccount } from "../account-type.js";
import type { Minor } from "../types.js";
import { historyGapNotes } from "./notes.js";

/**
 * Where the period's funds came from and what they went on.
 *
 * Pure: the rows arrive already narrowed by `queries/dashboard.ts`, so this
 * module never sees a date on a movement and never touches a database — the
 * same split the other three report modules keep.
 *
 * **"Funds" here means current assets**, not cash, and the panel says so. A
 * cash-only figure cannot be produced from this chart: `seed-accounts.ts` sets
 * `role` as a compatibility shadow of `type`, so every asset that is not
 * equipment carries `AccountRole.Bank` whether it is a bank account, a
 * receivable or inventory. `isMoneyPotAccount` (asset, not equipment) is the one
 * live definition of that side, and because equipment is the only non-current
 * asset in the chart, it is exactly the current assets. Calling this a cash flow
 * statement would be wrong twice over — the base is not cash, and `/reports`
 * already owns the statement names.
 *
 * Why the lines always add up to the movement, rather than "we hope they do":
 * every record's movements sum to zero, so for any record
 * `Σ(current-asset sides) = −Σ(everything else)`. Take the records that touched
 * a current asset, negate their other sides, and you have the movement in funds
 * split by what caused it — exactly, with nothing left over. So `ties` is not a
 * second calculation checking the first; like `balances` on the balance sheet it
 * is the one place a broken database shows itself, which is why `closingMinor`
 * is read independently rather than derived from `openingMinor + netMinor`.
 *
 * Two consequences worth stating, because both look like omissions:
 *
 * A record whose sides are *both* current assets contributes nothing. A transfer
 * between two bank accounts, or a customer settling an invoice (bank up,
 * receivable down), changes the shape of the funds and not their size.
 *
 * And the base is asymmetric: receivables are inside it, payables are not. So
 * revenue lands here when it is invoiced, while a cost taken on credit lands
 * only when it is paid — under trade payables rather than under operating
 * expenses. **Operating expenses on this statement therefore does not equal
 * expenses on the profit and loss** whenever bills are outstanding, and the
 * panel says so rather than leaving the reader to find out.
 *
 * The obvious fix — using working capital (current assets less current
 * liabilities) as the base, which is the classical funds-flow statement — is not
 * available: it needs current liabilities told apart from long-term ones, and
 * this chart cannot do that any more than it can tell cash from receivables.
 * Drawing down a loan would then explain away to nothing instead of reading as
 * financing, which is worse than the asymmetry.
 */

export type FundsFlowActivityKey =
  | "operating"
  | "investing"
  | "financing"
  | "unclassified";

/**
 * One cause of the movement, signed the way a reader of this statement expects:
 * **positive is a source of funds and negative is a use of them.**
 *
 * That is the sign the movements already carry, negated. Revenue accumulates as
 * a credit and comes out positive here; an expense is a debit and comes out
 * negative. Supplier credit reads as a source, which is what it is — the money
 * stayed in the business because someone else waited for it.
 */
export type FundsFlowLine = {
  key: string;
  label: string;
  amountMinor: Minor;
};

export type FundsFlowActivity = {
  key: FundsFlowActivityKey;
  label: string;
  lines: FundsFlowLine[];
  totalMinor: Minor;
};

export type FundsFlowReport = {
  dateFrom: string;
  dateTo: string;
  /** Current assets at the close of the day before `dateFrom`. */
  openingMinor: Minor;
  /** Current assets as at `dateTo`, read independently so `ties` means something. */
  closingMinor: Minor;
  /** What the lines add up to: the movement they explain. */
  netMinor: Minor;
  activities: FundsFlowActivity[];
  /** False only when the lines do not explain the movement. */
  ties: boolean;
  differenceMinor: Minor;
  notes: string[];
};

/** One side of a record that is not on a current-asset account. */
export type FundsFlowRow = {
  accountId: number;
  type: AccountTypeCode;
  /** Plain `number`, matching `AccountRow.role` in the frozen `types.ts`. */
  role: number;
  amountMinor: Minor;
};

export type FundsFlowInput = {
  dateFrom: string;
  dateTo: string;
  openingMinor: Minor;
  closingMinor: Minor;
  /**
   * The shared we-owe account, so trade credit is read as operating rather than
   * financing. Null when no default is set, which puts every liability under
   * financing — the same fallback `outstandingTotal` takes.
   */
  payableAccountId: number | null;
  /** Every non-current-asset side of the records that touched a current asset. */
  rows: FundsFlowRow[];
  /** The day the ledger began, so a period reaching further back says so (FR-030). */
  trackingStartedOn?: string | null;
};

type LineSpec = {
  activity: FundsFlowActivityKey;
  key: string;
  label: string;
};

const UNCLASSIFIED: LineSpec = {
  activity: "unclassified",
  key: "unclassified",
  label: "Unclassified",
};

/**
 * Which line a side belongs on.
 *
 * Equipment is tested first and through `isEquipmentAccount`, never a type
 * check: it is an asset, so by type alone a laptop purchase is indistinguishable
 * from money moving between two pots (002 FR-006b). Capitalised equipment is the
 * whole reason this statement exists, so putting it on the wrong line would
 * defeat the point.
 */
function lineFor(row: FundsFlowRow, payableAccountId: number | null): LineSpec {
  if (isEquipmentAccount(row))
    return {
      activity: "investing",
      key: "capital-expenditure",
      label: "Capital expenditure",
    };
  switch (row.type) {
    case AccountType.Revenue:
      return { activity: "operating", key: "revenue", label: "Revenue" };
    case AccountType.Expense:
      // Cost of sales included: the chart does not separate it from overheads.
      return {
        activity: "operating",
        key: "operating-expenses",
        label: "Operating expenses",
      };
    case AccountType.Liability:
      return row.accountId === payableAccountId
        ? {
            activity: "operating",
            key: "trade-payables",
            label: "Trade payables",
          }
        : {
            activity: "financing",
            key: "borrowings",
            label: "Loans and other liabilities",
          };
    case AccountType.Equity:
      return {
        activity: "financing",
        key: "owners-equity",
        label: "Owner's equity",
      };
    default:
      // An asset that is neither a current asset nor equipment cannot exist —
      // the two predicates partition them. A row here means the chart is broken,
      // and it is better seen on its own line than folded into a real one.
      return UNCLASSIFIED;
  }
}

const ACTIVITY_ORDER: { key: FundsFlowActivityKey; label: string }[] = [
  { key: "operating", label: "Operating activities" },
  { key: "investing", label: "Investing activities" },
  { key: "financing", label: "Financing activities" },
  { key: "unclassified", label: "Unclassified" },
];

/** The order lines read in within their activity, once they have amounts. */
const LINE_ORDER = [
  "revenue",
  "operating-expenses",
  "trade-payables",
  "capital-expenditure",
  "borrowings",
  "owners-equity",
  "unclassified",
];

export function fundsFlow(input: FundsFlowInput): FundsFlowReport {
  const totals = new Map<string, FundsFlowLine & { activity: LineSpec }>();

  for (const row of input.rows) {
    const spec = lineFor(row, input.payableAccountId);
    const existing = totals.get(spec.key);
    // Negated: a side that took value out of a category put funds in, and the
    // other way round. See the sign note on `FundsFlowLine`.
    const contribution = -row.amountMinor;
    if (existing) existing.amountMinor += contribution;
    else
      totals.set(spec.key, {
        key: spec.key,
        label: spec.label,
        amountMinor: contribution,
        activity: spec,
      });
  }

  const activities: FundsFlowActivity[] = ACTIVITY_ORDER.map(
    ({ key, label }) => {
      const lines = [...totals.values()]
        .filter((line) => line.activity.activity === key)
        // A line that nets to nothing is not worth a row: an account used twice
        // in opposite directions over the period says nothing about the funds.
        .filter((line) => line.amountMinor !== 0)
        .sort((a, b) => LINE_ORDER.indexOf(a.key) - LINE_ORDER.indexOf(b.key))
        .map(({ key: lineKey, label: lineLabel, amountMinor }) => ({
          key: lineKey,
          label: lineLabel,
          amountMinor,
        }));
      return {
        key,
        label,
        lines,
        totalMinor: lines.reduce((sum, line) => sum + line.amountMinor, 0),
      };
    },
  ).filter((activity) => activity.lines.length > 0);

  const netMinor = activities.reduce(
    (sum, activity) => sum + activity.totalMinor,
    0,
  );
  const differenceMinor = input.closingMinor - (input.openingMinor + netMinor);
  const ties = differenceMinor === 0;

  const notes = historyGapNotes(input.dateFrom, input.trackingStartedOn);
  if (!ties)
    notes.unshift(
      "These figures do not add up: what came in and went out does not explain " +
        "the change in what the business holds. Something is wrong in the " +
        "records — run the balance check before relying on this.",
    );

  return {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    openingMinor: input.openingMinor,
    closingMinor: input.closingMinor,
    netMinor,
    activities,
    ties,
    differenceMinor,
    notes,
  };
}
