import { describe, expect, it } from "vitest";
import { StatementDirection } from "$lib/enums.js";
import type { StatementDirectionCode } from "$lib/enums.js";
import { directionFor, suggestLinesForMovement } from "./suggestions.js";
import type { SuggestionLine, SuggestionMovement } from "./suggestions.js";

const BANK = 7;
const WALLET = 8;

const line = (
  id: number,
  amount: number,
  direction: StatementDirectionCode = StatementDirection.Out,
  date = "2026-03-10",
  accountId: number | null = BANK,
): SuggestionLine => ({
  id,
  accountId,
  date,
  direction,
  remainingAmount: amount,
});

const movement = (
  overrides: Partial<SuggestionMovement> = {},
): SuggestionMovement => ({
  accountId: BANK,
  amountMinor: -10_000,
  date: "2026-03-10",
  remainingAmount: 100,
  ...overrides,
});

describe("reconciliation suggestions", () => {
  it("reads the direction off the movement's sign", () => {
    expect(directionFor(-10_000)).toBe(StatementDirection.Out);
    expect(directionFor(10_000)).toBe(StatementDirection.In);
  });

  it("ignores lines moving money the wrong way", () => {
    expect(
      suggestLinesForMovement(movement(), [
        line(1, 100, StatementDirection.In),
      ]),
    ).toEqual([]);
    expect(
      suggestLinesForMovement(movement(), [
        line(2, 100, StatementDirection.Out),
      ]),
    ).toEqual([2]);
  });

  it("never offers a line from a statement on another account", () => {
    expect(
      suggestLinesForMovement(movement(), [
        line(1, 100, StatementDirection.Out, "2026-03-10", WALLET),
      ]),
    ).toEqual([]);
    // A statement the upgrade has not assigned an account to offers nothing.
    expect(
      suggestLinesForMovement(movement(), [
        line(2, 100, StatementDirection.Out, "2026-03-10", null),
      ]),
    ).toEqual([]);
  });

  it("scopes suggestions by account even when both accounts share a fixed type", () => {
    expect(suggestLinesForMovement(movement(), [line(1, 100), line(2, 100, StatementDirection.Out, "2026-03-10", WALLET)])).toEqual([1]);
  });

  it("drops a line an earlier movement already consumed", () => {
    expect(suggestLinesForMovement(movement(), [line(1, 100)])).toEqual([1]);
    // Same call once line 1 has been spent: nothing left that sums to 100.
    expect(suggestLinesForMovement(movement(), [line(1, 0)])).toEqual([]);
  });

  it("keeps a spent line eligible for the movement it is already allocated to", () => {
    // A fully allocated movement has nothing left to suggest for.
    expect(
      suggestLinesForMovement(
        movement({ amountMinor: 10_000, remainingAmount: 0 }),
        [line(1, 0, StatementDirection.In)],
        new Set([1]),
      ),
    ).toEqual([]);
  });

  it("combines lines that sum exactly and gives up when none do", () => {
    const target = movement({ amountMinor: -7550, remainingAmount: 75.5 });
    expect(
      suggestLinesForMovement(target, [line(1, 50.25), line(2, 25.25)]),
    ).toEqual([1, 2]);
    expect(
      suggestLinesForMovement(target, [line(1, 50.25), line(2, 20)]),
    ).toEqual([]);
  });

  it("prefers the line closest in date when several match exactly", () => {
    expect(
      suggestLinesForMovement(movement(), [
        line(1, 100, StatementDirection.Out, "2026-03-25"),
        line(2, 100, StatementDirection.Out, "2026-03-11"),
      ]),
    ).toEqual([2]);
  });
});
