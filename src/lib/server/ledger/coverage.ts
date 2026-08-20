import type { Minor } from "./types.js";

/**
 * How much of a record bank lines account for, and whether that is all of it.
 *
 * Two different questions get two different answers, and the difference is
 * load-bearing (research.md R-08, data-model.md §6 invariant 10):
 *
 *  - **`reconciled`** — existence. Any bank line points at this record. That is
 *    the right answer for *locking*: if a bank line points at a record, its
 *    amount must not change, covered or not. Computed elsewhere, by
 *    `matchedMovements()`, and read by `locked`.
 *  - **`cleared`** — coverage. Bank lines account for the whole of it. That is
 *    the right answer for a *worklist*: FR-056's "not yet cleared" filter must
 *    not disagree with the reconciliation workspace it replaces, and that
 *    workspace lists a part-matched movement as still needing attention.
 *
 * The codebase computed both under one name in two places that disagreed. Each
 * now keeps its own field, named for what it answers.
 *
 * Pure, whole cents, no float arithmetic (D-02).
 */

/** One bank match against one of the record's sides. */
export type AllocationRow = {
  movementId: number;
  /** What this bank line covers, in cents. */
  amountMinor: Minor;
};

export type CoverageInput = {
  /** The record's own figure in cents. */
  amountMinor: Minor;
  allocations: AllocationRow[];
};

export type Coverage = {
  /** How much bank lines account for, in cents. Never more than the record. */
  clearedMinor: Minor;
  /** True exactly when `clearedMinor` equals the record's own size. */
  cleared: boolean;
};

export function coverageFor(input: CoverageInput): Coverage {
  // Compared by size, never by sign. A record's own figure and its movements
  // carry opposite signs by construction — value leaves one account and arrives
  // at another — so a signed comparison would make a fully covered record read
  // as doubly uncovered.
  const owed = Math.abs(input.amountMinor);

  const covered = input.allocations.reduce(
    (sum, allocation) => sum + Math.abs(allocation.amountMinor),
    0,
  );

  // Invariant 10: never report more cover than the record is worth. An
  // over-allocation is a data problem for reconciliation to refuse at the point
  // it is made; here it must not make a worklist claim more than it can.
  const clearedMinor = Math.min(covered, owed);

  return {
    clearedMinor,
    // A record worth nothing is never "cleared by nothing" — that would put
    // every zero-value row into the cleared half of the filter for no reason.
    cleared: owed > 0 && clearedMinor === owed,
  };
}
