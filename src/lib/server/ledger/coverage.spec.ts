import { describe, expect, it } from "vitest";
import {
  coverageFor,
  type AllocationRow,
  type CoverageInput,
} from "./coverage.js";

/**
 * Principle V: money arithmetic is silent when it is wrong. Nothing on screen
 * says "this record is 3 cents short of cleared" — it simply sits in, or out
 * of, a worklist it should not be in.
 *
 * Invariant 10 (data-model.md §6): `clearedMinor` never exceeds a record's own
 * `amountMinor`, and `cleared` is true **exactly** when they are equal.
 *
 * `cleared` is coverage-based, and deliberately different from `reconciled`,
 * which is existence-based and drives `locked`. A part-matched record is
 * `reconciled` (its amount must not change) and not `cleared` (it still needs
 * work) — the two answer different questions and the codebase used to compute
 * both under one name in two places that disagreed (research.md R-08).
 */

function input(
  amountMinor: number,
  allocations: AllocationRow[],
): CoverageInput {
  return { amountMinor, allocations };
}

const on = (movementId: number, amountMinor: number): AllocationRow => ({
  movementId,
  amountMinor,
});

describe("coverageFor", () => {
  it("is not cleared when nothing is allocated", () => {
    const result = coverageFor(input(10_000, []));
    expect(result.clearedMinor).toBe(0);
    expect(result.cleared).toBe(false);
  });

  it("is not cleared when only part is allocated", () => {
    const result = coverageFor(input(10_000, [on(1, 4_000)]));
    expect(result.clearedMinor).toBe(4_000);
    expect(result.cleared).toBe(false);
  });

  it("is cleared exactly when the whole amount is covered", () => {
    const result = coverageFor(input(10_000, [on(1, 10_000)]));
    expect(result.clearedMinor).toBe(10_000);
    expect(result.cleared).toBe(true);
  });

  it("adds several allocations up to clear a record", () => {
    const result = coverageFor(input(10_000, [on(1, 6_000), on(2, 4_000)]));
    expect(result.clearedMinor).toBe(10_000);
    expect(result.cleared).toBe(true);
  });

  // Invariant 10, the half that stops a worklist lying.
  it("never reports more cover than the record is worth", () => {
    const result = coverageFor(input(10_000, [on(1, 9_000), on(2, 6_000)]));
    expect(result.clearedMinor).toBe(10_000);
    expect(result.cleared).toBe(true);
  });

  it("counts both sides when a record touches one account twice", () => {
    // Two movements on the same account, each matched to its own bank line.
    const result = coverageFor(input(10_000, [on(1, 5_000), on(2, 5_000)]));
    expect(result.clearedMinor).toBe(10_000);
    expect(result.cleared).toBe(true);
  });

  it("reads an allocation's size, never its sign, so a negative side still covers", () => {
    const result = coverageFor(input(10_000, [on(1, -10_000)]));
    expect(result.clearedMinor).toBe(10_000);
    expect(result.cleared).toBe(true);
  });

  it("compares against the size of a negative record too", () => {
    const result = coverageFor(input(-10_000, [on(1, 10_000)]));
    expect(result.clearedMinor).toBe(10_000);
    expect(result.cleared).toBe(true);
  });

  it("a record worth nothing is never cleared by nothing", () => {
    const result = coverageFor(input(0, []));
    expect(result.cleared).toBe(false);
    expect(result.clearedMinor).toBe(0);
  });

  it("works in whole cents, with no float drift", () => {
    // Three allocations that would not add to the total in floating point.
    const result = coverageFor(
      input(1_000, [on(1, 333), on(2, 333), on(3, 334)]),
    );
    expect(result.clearedMinor).toBe(1_000);
    expect(result.cleared).toBe(true);
    expect(Number.isInteger(result.clearedMinor)).toBe(true);
  });

  it("holds invariant 10 across a spread of amounts", () => {
    for (let amount = 1; amount <= 500; amount += 7) {
      for (let covered = 0; covered <= amount * 2; covered += 13) {
        const result = coverageFor(input(amount, [on(1, covered)]));
        expect(result.clearedMinor).toBeLessThanOrEqual(Math.abs(amount));
        expect(result.cleared).toBe(result.clearedMinor === Math.abs(amount));
      }
    }
  });
});
