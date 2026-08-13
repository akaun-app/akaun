import { describe, expect, it } from "vitest";
import { ReconItemType, StatementDirection } from "$lib/enums.js";
import type { StatementDirectionCode } from "$lib/enums.js";
import { directionFor, suggestLinesForRecord } from "./suggestions.js";
import type { SuggestionLine } from "./suggestions.js";

const line = (
  id: number,
  amount: number,
  direction: StatementDirectionCode = StatementDirection.Out,
  date = "2026-03-10",
): SuggestionLine => ({ id, date, direction, remainingAmount: amount });

describe("reconciliation suggestions", () => {
  it("points expenses and claims at money out, income at money in", () => {
    expect(directionFor(ReconItemType.Expense)).toBe(StatementDirection.Out);
    expect(directionFor(ReconItemType.Claim)).toBe(StatementDirection.Out);
    expect(directionFor(ReconItemType.Income)).toBe(StatementDirection.In);
  });

  it("ignores lines moving money the wrong way", () => {
    const record = {
      itemType: ReconItemType.Expense,
      date: "2026-03-10",
      remainingAmount: 100,
    };
    expect(
      suggestLinesForRecord(record, [line(1, 100, StatementDirection.In)]),
    ).toEqual([]);
    expect(
      suggestLinesForRecord(record, [line(2, 100, StatementDirection.Out)]),
    ).toEqual([2]);
  });

  it("drops a line an earlier record already consumed", () => {
    const record = {
      itemType: ReconItemType.Expense,
      date: "2026-03-10",
      remainingAmount: 100,
    };
    expect(suggestLinesForRecord(record, [line(1, 100)])).toEqual([1]);
    // Same call once line 1 has been spent: nothing left that sums to 100.
    expect(suggestLinesForRecord(record, [line(1, 0)])).toEqual([]);
  });

  it("keeps a spent line eligible for the record it is already allocated to", () => {
    const record = {
      itemType: ReconItemType.Income,
      date: "2026-03-10",
      remainingAmount: 0,
    };
    // A fully allocated record has nothing left to suggest for.
    expect(
      suggestLinesForRecord(
        record,
        [line(1, 0, StatementDirection.In)],
        new Set([1]),
      ),
    ).toEqual([]);
  });

  it("combines lines that sum exactly and gives up when none do", () => {
    const record = {
      itemType: ReconItemType.Expense,
      date: "2026-03-10",
      remainingAmount: 75.5,
    };
    expect(
      suggestLinesForRecord(record, [line(1, 50.25), line(2, 25.25)]),
    ).toEqual([1, 2]);
    expect(
      suggestLinesForRecord(record, [line(1, 50.25), line(2, 20)]),
    ).toEqual([]);
  });

  it("prefers the line closest in date when several match exactly", () => {
    const record = {
      itemType: ReconItemType.Expense,
      date: "2026-03-10",
      remainingAmount: 100,
    };
    expect(
      suggestLinesForRecord(record, [
        line(1, 100, StatementDirection.Out, "2026-03-25"),
        line(2, 100, StatementDirection.Out, "2026-03-11"),
      ]),
    ).toEqual([2]);
  });
});
