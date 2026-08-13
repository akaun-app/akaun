import { ReconItemType, StatementDirection } from "$lib/enums.js";
import type { ReconItemTypeCode, StatementDirectionCode } from "$lib/enums.js";
import { suggestExactAllocationSet } from "./allocation.js";
import { EPSILON } from "./types.js";

const MILLISECONDS_PER_DAY = 86_400_000;
/** Suggestion relevance decays one point per day between the record and the line. */
const DATE_PROXIMITY_SCORE = 30;

export type SuggestionRecord = {
  itemType: ReconItemTypeCode;
  date: string;
  remainingAmount?: number;
};
export type SuggestionLine = {
  id: number;
  date: string;
  direction: StatementDirectionCode;
  remainingAmount: number;
};

/** Statement lines flow in for income and out for everything else. */
export function directionFor(itemType: ReconItemTypeCode) {
  return itemType === ReconItemType.Income
    ? StatementDirection.In
    : StatementDirection.Out;
}

/**
 * Pick the statement lines whose remaining balances sum to exactly what this
 * record still needs. Shared by the page loader (so the UI can label a record
 * "exact match") and the bulk auto-match service (so it saves the same set the
 * UI promised) — keep it the only definition of that rule.
 *
 * `savedLineIds` are lines already allocated to *this* record: they stay
 * eligible even with no remaining balance, since re-saving reclaims them.
 */
export function suggestLinesForRecord(
  record: SuggestionRecord,
  lines: readonly SuggestionLine[],
  savedLineIds: ReadonlySet<number> = new Set(),
): number[] {
  const direction = directionFor(record.itemType);
  const recordTime = Date.parse(record.date);
  return suggestExactAllocationSet(
    record.remainingAmount ?? 0,
    lines
      .filter(
        (line) =>
          line.direction === direction &&
          (line.remainingAmount >= EPSILON || savedLineIds.has(line.id)),
      )
      .map((line) => ({
        id: line.id,
        amount: line.remainingAmount,
        score: Math.max(
          0,
          DATE_PROXIMITY_SCORE -
            Math.abs(recordTime - Date.parse(line.date)) / MILLISECONDS_PER_DAY,
        ),
      })),
  );
}
