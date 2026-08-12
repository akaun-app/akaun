import { ReconItemType, StatementDirection } from "$lib/enums.js";
import {
  EPSILON,
  MATCH_DATE_WINDOW_DAYS,
  mainAmount,
  type BankFacingItem,
  type RankedCandidate,
  type StatementLineRow,
} from "./types.js";

// D-04 scoring constants are deliberately code-level tuning parameters, not
// user settings: changing them changes what constitutes the best suggestion.
const EXACT_AMOUNT_SCORE = 100;
const NEAR_AMOUNT_SCORE = 55;
const NEAR_AMOUNT_RELATIVE_TOLERANCE = 0.01;
const DATE_PENALTY_PER_DAY = 2;
const DESCRIPTION_TOKEN_BONUS = 8;
const MILLISECONDS_PER_DAY = 86_400_000;

function parseDay(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return timestamp / MILLISECONDS_PER_DAY;
}

function directionMatches(
  line: StatementLineRow,
  item: BankFacingItem,
): boolean {
  if (line.direction === StatementDirection.In) {
    return item.itemType === ReconItemType.Income;
  }
  if (line.direction === StatementDirection.Out) {
    return (
      item.itemType === ReconItemType.Expense ||
      item.itemType === ReconItemType.Claim
    );
  }
  return false;
}

function amountScore(lineAmount: number, itemAmount: number): number | null {
  const difference = Math.abs(lineAmount - itemAmount);
  if (difference < EPSILON) return EXACT_AMOUNT_SCORE;
  if (
    lineAmount > 0 &&
    difference / lineAmount <= NEAR_AMOUNT_RELATIVE_TOLERANCE
  ) {
    return NEAR_AMOUNT_SCORE;
  }
  return null;
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  );
}

function sharesDescriptionToken(
  description: string,
  item: BankFacingItem,
): boolean {
  const descriptionTokens = tokens(description);
  if (descriptionTokens.size === 0) return false;
  const itemTokens = tokens(`${item.label} ${item.contactName ?? ""}`);
  return [...descriptionTokens].some((token) => itemTokens.has(token));
}

/** Return eligible suggestions in descending score order; this never clears. */
export function rankCandidates(
  line: StatementLineRow,
  items: BankFacingItem[],
): RankedCandidate[] {
  const lineDay = parseDay(line.date);
  if (lineDay == null) return [];

  return items
    .map((item, inputIndex) => {
      if (!directionMatches(line, item)) return null;
      if (item.itemType === ReconItemType.Expense && item.claimId != null) {
        return null;
      }

      const itemDay = parseDay(item.date);
      if (itemDay == null) return null;
      const daysApart = Math.abs(lineDay - itemDay);
      if (daysApart > MATCH_DATE_WINDOW_DAYS) return null;

      const amount = mainAmount(item);
      const baseScore = amountScore(line.amount, amount);
      if (baseScore == null) return null;

      const score =
        baseScore -
        DATE_PENALTY_PER_DAY * daysApart +
        (sharesDescriptionToken(line.description, item)
          ? DESCRIPTION_TOKEN_BONUS
          : 0);
      return {
        candidate: {
          itemType: item.itemType,
          itemId: item.itemId,
          label: item.label,
          date: item.date,
          amount,
          score,
        },
        inputIndex,
      };
    })
    .filter(
      (entry): entry is { candidate: RankedCandidate; inputIndex: number } =>
        entry != null,
    )
    .sort(
      (left, right) =>
        right.candidate.score - left.candidate.score ||
        left.inputIndex - right.inputIndex,
    )
    .map(({ candidate }) => candidate);
}

function normaliseDuplicateDescription(description: string): string {
  return description.toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

/** Return the IDs of every line that belongs to a duplicate group. */
export function findDuplicateLines(lines: StatementLineRow[]): Set<number> {
  const duplicateIds = new Set<number>();

  for (let leftIndex = 0; leftIndex < lines.length; leftIndex += 1) {
    const left = lines[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < lines.length;
      rightIndex += 1
    ) {
      const right = lines[rightIndex];
      if (
        left.statementId === right.statementId &&
        left.date === right.date &&
        Math.abs(left.amount - right.amount) < EPSILON &&
        normaliseDuplicateDescription(left.description) ===
          normaliseDuplicateDescription(right.description)
      ) {
        duplicateIds.add(left.id);
        duplicateIds.add(right.id);
      }
    }
  }

  return duplicateIds;
}
