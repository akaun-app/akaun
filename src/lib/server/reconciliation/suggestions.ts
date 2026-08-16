import { StatementDirection } from "$lib/enums.js";
import type { StatementDirectionCode } from "$lib/enums.js";
import type { Minor } from "$lib/server/ledger/types.js";
import { suggestExactAllocationSet } from "./allocation.js";
import { EPSILON } from "./types.js";

const MILLISECONDS_PER_DAY = 86_400_000;
/** Suggestion relevance decays one point per day between the movement and the line. */
const DATE_PROXIMITY_SCORE = 30;

/** The side of a record that a statement line could be, on that statement's account. */
export type SuggestionMovement = {
  accountId: number;
  /** Signed whole cents. Positive = money in. */
  amountMinor: Minor;
  date: string;
  remainingAmount?: number;
};
export type SuggestionLine = {
  id: number;
  /** The account the line's statement belongs to; null until the upgrade assigns one. */
  accountId: number | null;
  date: string;
  direction: StatementDirectionCode;
  remainingAmount: number;
};

/**
 * A movement that took money out of the account is a money-out line on that
 * account's statement, and vice versa. Nothing about *what kind of record* it
 * was enters into it — that is what makes a wallet purchase impossible to
 * suggest against a bank statement (D-11).
 */
export function directionFor(amountMinor: Minor): StatementDirectionCode {
  return amountMinor > 0 ? StatementDirection.In : StatementDirection.Out;
}

/**
 * Pick the statement lines whose remaining balances sum to exactly what this
 * movement still needs. Shared by the page loader (so the UI can label a
 * movement "exact match") and the bulk auto-match service (so it saves the same
 * set the UI promised) — keep it the only definition of that rule.
 *
 * Lines from a statement on a *different* account are never eligible, which is
 * FR-021 enforced on the suggestion side as well as on the candidate side.
 *
 * `savedLineIds` are lines already allocated to *this* movement: they stay
 * eligible even with no remaining balance, since re-saving reclaims them.
 */
export function suggestLinesForMovement(
  movement: SuggestionMovement,
  lines: readonly SuggestionLine[],
  savedLineIds: ReadonlySet<number> = new Set(),
): number[] {
  const direction = directionFor(movement.amountMinor);
  const movementTime = Date.parse(movement.date);
  return suggestExactAllocationSet(
    movement.remainingAmount ?? 0,
    lines
      .filter(
        (line) =>
          line.accountId === movement.accountId &&
          line.direction === direction &&
          (line.remainingAmount >= EPSILON || savedLineIds.has(line.id)),
      )
      .map((line) => ({
        id: line.id,
        amount: line.remainingAmount,
        score: Math.max(
          0,
          DATE_PROXIMITY_SCORE -
            Math.abs(movementTime - Date.parse(line.date)) /
              MILLISECONDS_PER_DAY,
        ),
      })),
  );
}
