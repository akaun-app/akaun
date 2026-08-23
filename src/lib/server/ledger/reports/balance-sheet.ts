import { AccountType } from "$lib/enums.js";
import type { AccountSubTypeCode } from "$lib/enums.js";
import { assetBucket, liabilityBucket } from "../account-type.js";
import type {
  AccountTotal,
  BalanceSheetReport,
  BalanceSheetSection,
  BalanceSheetSubsection,
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
 * The one line that is not an account: revenue less expenses, from the first
 * record up to this date. Id 0 marks it as having nothing to open — no account
 * holds it, it is the revenue and expense accounts' running total brought
 * across.
 *
 * "Current earnings", not "Retained earnings": the seeded chart has a real
 * Retained Earnings account (code 3100) for results that have been closed off,
 * and two lines with one name on the same statement would be read as a
 * duplicate.
 */
const ACCUMULATED_RESULT_ACCOUNT_ID = 0;
const ACCUMULATED_RESULT_LABEL = "Current earnings";

function sectionFrom(
  lines: ReportLine[],
  subsections?: BalanceSheetSubsection[],
): BalanceSheetSection {
  return {
    lines,
    totalMinor: lines
      .filter((line) => !line.isSubtotal)
      .reduce((running, line) => running + line.amountMinor, 0),
    ...(subsections ? { subsections } : {}),
  };
}

const SUBSECTION_ORDER: {
  key: "current" | "nonCurrent" | "needsReview";
  label: BalanceSheetSubsection["label"];
}[] = [
  { key: "current", label: "Current" },
  { key: "nonCurrent", label: "Non-current" },
  { key: "needsReview", label: "Needs review" },
];

/**
 * Buckets a flat, already-filtered `lines` list (one account type, depth 0
 * upward) into Current / Non-current / Needs review, using each top-level
 * account's own leaf descendants to decide. A heading whose leaves span more
 * than one bucket lands in "Needs review" rather than guessing — a rule
 * worth revisiting once tested against a real multi-level chart.
 */
function subsectionsFor(
  lines: ReportLine[],
  subTypeById: Map<number, AccountSubTypeCode | null>,
  bucketFor: (
    subType: AccountSubTypeCode | null,
  ) => "current" | "nonCurrent" | "needsReview",
): BalanceSheetSubsection[] {
  const byId = new Map(lines.map((line) => [line.accountId, line]));
  const childrenById = new Map<number, ReportLine[]>();
  for (const line of lines) {
    if (line.parentId == null || !byId.has(line.parentId)) continue;
    const siblings = childrenById.get(line.parentId) ?? [];
    siblings.push(line);
    childrenById.set(line.parentId, siblings);
  }

  const leafBuckets = (
    id: number,
    seen = new Set<number>(),
  ): Set<"current" | "nonCurrent" | "needsReview"> => {
    if (seen.has(id)) return new Set();
    seen.add(id);
    const kids = childrenById.get(id) ?? [];
    if (kids.length === 0) {
      return new Set([bucketFor(subTypeById.get(id) ?? null)]);
    }
    const result = new Set<"current" | "nonCurrent" | "needsReview">();
    for (const child of kids) {
      for (const bucket of leafBuckets(child.accountId, new Set(seen))) {
        result.add(bucket);
      }
    }
    return result;
  };

  const groups = new Map<string, ReportLine[]>();
  for (const line of lines.filter((l) => l.depth === 0)) {
    const distinct = leafBuckets(line.accountId);
    const bucket = distinct.size === 1 ? [...distinct][0] : "needsReview";
    const group = groups.get(bucket) ?? [];
    const collect = (id: number, seen = new Set<number>()): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const self = byId.get(id);
      if (self) group.push(self);
      for (const child of childrenById.get(id) ?? []) {
        collect(child.accountId, seen);
      }
    };
    collect(line.accountId);
    groups.set(bucket, group);
  }

  return SUBSECTION_ORDER.filter(({ key }) => groups.has(key)).map(
    ({ key, label }) => {
      const groupLines = groups.get(key)!;
      return {
        label,
        lines: groupLines,
        totalMinor: groupLines
          .filter((line) => !line.isSubtotal)
          .reduce((sum, line) => sum + line.amountMinor, 0),
      };
    },
  );
}

function reportLines(totals: AccountTotal[], type: number): ReportLine[] {
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
    return (
      (byId.get(id)?.amountMinor ?? 0) +
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
  const sign = type === AccountType.Asset ? 1 : -1;
  return typed.flatMap((total) => {
    const signedAmount = rolled(total.accountId) * sign;
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

export function balanceSheet(input: BalanceSheetInput): BalanceSheetReport {
  const owned: ReportLine[] = [];
  const owed: ReportLine[] = [];
  const ownersStake: ReportLine[] = [];
  let categoriesMinor: Minor = 0;

  for (const total of input.totals) {
    const type = total.type;

    // The categories never get a line of their own here. Their running total is
    // the accumulated result, which the owners' stake carries as one figure.
    if (type === AccountType.Revenue || type === AccountType.Expense) {
      categoriesMinor += total.amountMinor;
      continue;
    }

    // An account holding nothing at this date is not worth a line.
    if (total.amountMinor === 0) continue;
  }

  owned.push(...reportLines(input.totals, AccountType.Asset));
  owed.push(...reportLines(input.totals, AccountType.Liability));
  ownersStake.push(...reportLines(input.totals, AccountType.Equity));

  const accumulatedResultMinor = -categoriesMinor;
  ownersStake.push({
    accountId: ACCUMULATED_RESULT_ACCOUNT_ID,
    accountName: ACCUMULATED_RESULT_LABEL,
    amountMinor: accumulatedResultMinor,
  });

  const subTypeById = new Map(
    input.totals.map((total) => [total.accountId, total.subType]),
  );

  const ownedSection = sectionFrom(
    owned,
    subsectionsFor(owned, subTypeById, assetBucket),
  );
  const owedSection = sectionFrom(
    owed,
    subsectionsFor(owed, subTypeById, liabilityBucket),
  );
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
