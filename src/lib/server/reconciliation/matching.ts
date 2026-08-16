import { StatementDirection } from "$lib/enums.js";
import { toMinor } from "$lib/server/ledger/money.js";
import {
  MATCH_DATE_WINDOW_DAYS,
  type MovementCandidate,
  type RankedCandidate,
  type StatementLineRow,
} from "./types.js";

// D-04 scoring constants are deliberately code-level tuning parameters, not
// user settings: changing them changes what constitutes the best suggestion.
const EXACT_AMOUNT_SCORE = 100;
const NEAR_AMOUNT_SCORE = 55;
/** One percent, expressed so the comparison stays in whole cents. */
const NEAR_AMOUNT_TOLERANCE_DIVISOR = 100;
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

/** A line's amount in whole cents. It is always positive; `direction` holds the sign. */
function lineMinor(line: StatementLineRow): number {
  return toMinor(line.amount, 1);
}

/**
 * Money out of the bank is a negative movement on that account, money in is a
 * positive one. That is the whole direction rule — there is no record type to
 * consult and nothing to guess, because a movement already says which way the
 * money went (D-11).
 */
function directionMatches(
  line: StatementLineRow,
  movement: MovementCandidate,
): boolean {
  if (line.direction === StatementDirection.In) return movement.amountMinor > 0;
  if (line.direction === StatementDirection.Out)
    return movement.amountMinor < 0;
  return false;
}

/**
 * Both figures are whole cents, so "the same amount" is integer equality rather
 * than a tolerance. The near-amount band is one percent of the line, compared
 * without dividing so it stays integer arithmetic (D-02).
 */
function amountScore(lineCents: number, movementCents: number): number | null {
  const difference = Math.abs(lineCents - Math.abs(movementCents));
  if (difference === 0) return EXACT_AMOUNT_SCORE;
  if (
    lineCents > 0 &&
    difference * NEAR_AMOUNT_TOLERANCE_DIVISOR <= lineCents
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
  movement: MovementCandidate,
): boolean {
  const descriptionTokens = tokens(description);
  if (descriptionTokens.size === 0) return false;
  const movementTokens = tokens(
    `${movement.label} ${movement.description} ${movement.contactName ?? ""}`,
  );
  return [...descriptionTokens].some((token) => movementTokens.has(token));
}

/**
 * Return eligible suggestions in descending score order; this never clears.
 *
 * `statementAccountId` is the account the statement belongs to (FR-021), and a
 * movement on any other account is dropped before anything else is considered.
 * That is the original bug fixed at the root: money sitting in a wallet has no
 * movement on the bank account, so it can never be offered against a bank line.
 */
export function rankCandidates(
  line: StatementLineRow,
  statementAccountId: number,
  movements: readonly MovementCandidate[],
): RankedCandidate[] {
  const lineDay = parseDay(line.date);
  if (lineDay == null) return [];
  const lineCents = lineMinor(line);

  return movements
    .map((movement, inputIndex) => {
      if (movement.accountId !== statementAccountId) return null;
      if (!directionMatches(line, movement)) return null;

      const movementDay = parseDay(movement.date);
      if (movementDay == null) return null;
      const daysApart = Math.abs(lineDay - movementDay);
      if (daysApart > MATCH_DATE_WINDOW_DAYS) return null;

      const baseScore = amountScore(lineCents, movement.amountMinor);
      if (baseScore == null) return null;

      const score =
        baseScore -
        DATE_PENALTY_PER_DAY * daysApart +
        (sharesDescriptionToken(line.description, movement)
          ? DESCRIPTION_TOKEN_BONUS
          : 0);
      return {
        candidate: {
          movementId: movement.movementId,
          recordId: movement.recordId,
          label: movement.label,
          date: movement.date,
          amountMinor: movement.amountMinor,
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
        lineMinor(left) === lineMinor(right) &&
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
