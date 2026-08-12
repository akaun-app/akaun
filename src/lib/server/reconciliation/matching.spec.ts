import { describe, expect, it } from "vitest";
import { ReconItemType, StatementDirection } from "$lib/enums.js";
import { findDuplicateLines, rankCandidates } from "./matching.js";
import type { BankFacingItem, StatementLineRow } from "./types.js";

function line(overrides: Partial<StatementLineRow> = {}): StatementLineRow {
  return {
    id: 1,
    statementId: 10,
    date: "2026-07-15",
    description: "Grab ride",
    amount: 100,
    direction: StatementDirection.Out,
    note: "",
    createdAt: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

function item(
  overrides: Partial<BankFacingItem> & { itemId: number },
): BankFacingItem {
  return {
    itemType: ReconItemType.Expense,
    label: `item-${overrides.itemId}`,
    date: "2026-07-15",
    amount: 100,
    exchangeRate: 1,
    ...overrides,
  };
}

describe("rankCandidates", () => {
  it("uses statement direction as a hard filter", () => {
    const ranked = rankCandidates(line(), [
      item({ itemId: 1, itemType: ReconItemType.Income }),
      item({ itemId: 2, itemType: ReconItemType.Expense }),
      item({ itemId: 3, itemType: ReconItemType.Claim }),
    ]);

    expect(ranked.map((candidate) => candidate.itemId)).toEqual([2, 3]);
  });

  it("scores exact amounts at 100 and amounts within one percent at 55", () => {
    const ranked = rankCandidates(line({ description: "unrelated" }), [
      item({ itemId: 1, label: "exact" }),
      item({ itemId: 2, label: "near", amount: 100.99 }),
      item({ itemId: 3, label: "outside", amount: 101.01 }),
    ]);

    expect(ranked.map(({ itemId, score }) => ({ itemId, score }))).toEqual([
      { itemId: 1, score: 100 },
      { itemId: 2, score: 55 },
    ]);
  });

  it("subtracts two points per day and excludes candidates outside seven days", () => {
    const ranked = rankCandidates(line({ description: "unrelated" }), [
      item({ itemId: 1, label: "six days ago", date: "2026-07-09" }),
      item({ itemId: 2, label: "same day" }),
      item({ itemId: 3, label: "eight days ago", date: "2026-07-07" }),
    ]);

    expect(ranked.map(({ itemId, score }) => ({ itemId, score }))).toEqual([
      { itemId: 2, score: 100 },
      { itemId: 1, score: 88 },
    ]);
  });

  it("adds eight points when a normalised description token breaks a tie", () => {
    const ranked = rankCandidates(
      line({ description: "PAYMENT, ACME STORE" }),
      [
        item({ itemId: 1, label: "Other merchant" }),
        item({ itemId: 2, label: "Invoice", contactName: "Acme" }),
      ],
    );

    expect(ranked.map(({ itemId, score }) => ({ itemId, score }))).toEqual([
      { itemId: 2, score: 108 },
      { itemId: 1, score: 100 },
    ]);
  });

  it("never offers an expense that belongs to a claim", () => {
    const ranked = rankCandidates(line(), [
      item({ itemId: 1, claimId: 42 }),
      item({ itemId: 2, claimId: null }),
    ]);

    expect(ranked.map((candidate) => candidate.itemId)).toEqual([2]);
  });
});

describe("findDuplicateLines", () => {
  it("flags every line sharing session, date, near-equal amount, and normalised description", () => {
    const duplicates = findDuplicateLines([
      line({ id: 11, description: "  Grab   RIDE ", amount: 25 }),
      line({ id: 12, description: "grab ride", amount: 25.004 }),
      line({ id: 13, statementId: 11, description: "grab ride", amount: 25 }),
      line({ id: 14, description: "grab food", amount: 25 }),
      line({ id: 15, description: "grab ride", amount: 25.01 }),
      line({
        id: 16,
        date: "2026-07-16",
        description: "grab ride",
        amount: 25,
      }),
    ]);

    expect(duplicates).toEqual(new Set([11, 12]));
  });
});
