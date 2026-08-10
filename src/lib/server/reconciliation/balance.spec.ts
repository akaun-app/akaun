// Step 1 balance arithmetic (research.md D-03). These tests exist because this
// module can be silently wrong: a mis-rounded or double-counted row produces a
// plausible-looking number that no other test would catch.
//
// Scope boundary: the three in-scope filters — dated `<= periodEndDate`, no
// cleared marker in any session, not annotated `WillNotClear` — belong to the
// query layer, not to this module (data-model.md, "Derived concept: bank-facing
// item"). The tests below therefore build the arrays the caller would produce
// and assert the arithmetic over them; where a case is about an exclusion, the
// fixture applies the documented filter explicitly so the contract is visible.

import { describe, expect, it } from "vitest";
import { LeftoverAnnotation, ReconItemType } from "$lib/enums.js";
import { compareBalances, computeExpectedBalance } from "./balance.js";
import { EPSILON, mainAmount, type BankFacingItem } from "./types.js";

const PERIOD_END = "2026-07-31";

function item(
  overrides: Partial<BankFacingItem> & { itemId: number },
): BankFacingItem {
  return {
    itemType: ReconItemType.Expense,
    label: `item-${overrides.itemId}`,
    date: "2026-07-15",
    amount: 0,
    exchangeRate: 1,
    ...overrides,
  };
}

/**
 * Mirrors the query layer's in-scope rule so the exclusion tests below show
 * exactly which rows the caller hands to `computeExpectedBalance` and which it
 * withholds. Not production logic — the real filter is SQL.
 */
function inScope(rows: BankFacingItem[]): BankFacingItem[] {
  return rows.filter(
    (row) =>
      row.date <= PERIOD_END &&
      row.clearedSessionId == null &&
      row.annotation !== LeftoverAnnotation.WillNotClear,
  );
}

describe("computeExpectedBalance", () => {
  it("applies expected = starting + incomes − direct expenses − claims", () => {
    const result = computeExpectedBalance({
      startingBalance: 1000,
      incomes: [
        item({ itemId: 1, itemType: ReconItemType.Income, amount: 250 }),
      ],
      directExpenses: [item({ itemId: 2, amount: 40 })],
      claims: [item({ itemId: 3, itemType: ReconItemType.Claim, amount: 110 })],
    });

    expect(result.incomeTotal).toBe(250);
    expect(result.expenseTotal).toBe(40);
    expect(result.claimTotal).toBe(110);
    expect(result.expected).toBe(1100);
    expect(result.inScopeCounts).toEqual({
      incomes: 1,
      directExpenses: 1,
      claims: 1,
    });
  });

  it("returns the starting balance untouched when nothing is in scope", () => {
    const result = computeExpectedBalance({
      startingBalance: 842.37,
      incomes: [],
      directExpenses: [],
      claims: [],
    });

    expect(result.expected).toBe(842.37);
    expect(result.incomeTotal).toBe(0);
    expect(result.expenseTotal).toBe(0);
    expect(result.claimTotal).toBe(0);
    expect(result.inScopeCounts).toEqual({
      incomes: 0,
      directExpenses: 0,
      claims: 0,
    });
  });

  // US1 AC3 / FR-003 — a claimed expense is never bank-facing; it rides inside
  // its claim, which carries the members' total as its own `amount`.
  it("counts a claim once and none of its member expenses separately", () => {
    const memberExpenses = [
      item({ itemId: 10, amount: 60.25, claimId: 7 }),
      item({ itemId: 11, amount: 89.75, claimId: 7 }),
    ];
    const claimTotal = memberExpenses.reduce(
      (sum, expense) => sum + mainAmount(expense),
      0,
    );
    expect(claimTotal).toBe(150);

    const allExpenses = [...memberExpenses, item({ itemId: 12, amount: 20 })];
    // The query hands over only unclaimed expenses.
    const directExpenses = allExpenses.filter(
      (expense) => expense.claimId == null,
    );
    expect(directExpenses.map((expense) => expense.itemId)).toEqual([12]);

    const result = computeExpectedBalance({
      startingBalance: 1000,
      incomes: [],
      directExpenses,
      claims: [
        item({
          itemId: 7,
          itemType: ReconItemType.Claim,
          amount: claimTotal,
          exchangeRate: 1,
        }),
      ],
    });

    // 150 appears once, via claimTotal — not again inside expenseTotal.
    expect(result.claimTotal).toBe(150);
    expect(result.expenseTotal).toBe(20);
    expect(result.expected).toBe(830);
    expect(result.inScopeCounts).toEqual({
      incomes: 0,
      directExpenses: 1,
      claims: 1,
    });
  });

  // US1 AC5 — a foreign-currency row participates at its main-currency value.
  it("converts a foreign-currency expense at amount × exchangeRate", () => {
    const result = computeExpectedBalance({
      startingBalance: 1000,
      incomes: [],
      directExpenses: [item({ itemId: 20, amount: 100, exchangeRate: 4.72 })],
      claims: [],
    });

    expect(result.expenseTotal).toBe(472);
    expect(result.expected).toBe(528);
  });

  it("converts a foreign-currency income at amount × exchangeRate", () => {
    const result = computeExpectedBalance({
      startingBalance: 0,
      incomes: [
        item({
          itemId: 21,
          itemType: ReconItemType.Income,
          amount: 30.5,
          exchangeRate: 3.4,
        }),
      ],
      directExpenses: [],
      claims: [],
    });

    // 30.5 × 3.4 = 103.7
    expect(result.incomeTotal).toBe(103.7);
    expect(result.expected).toBe(103.7);
  });

  // US1 AC6 / SC-010 — there is no lower date bound. Only the `<= periodEndDate`
  // upper bound exists, and it is the caller's filter, so this module must sum
  // whatever it is given no matter how old.
  it("counts an uncleared record dated long before the period", () => {
    const rows = [
      item({ itemId: 30, amount: 75, date: "2019-01-15" }),
      item({ itemId: 31, amount: 25, date: "2026-07-30" }),
    ];
    const directExpenses = inScope(rows);
    expect(directExpenses).toHaveLength(2);

    const result = computeExpectedBalance({
      startingBalance: 1000,
      incomes: [],
      directExpenses,
      claims: [],
    });

    expect(result.expenseTotal).toBe(100);
    expect(result.expected).toBe(900);
    expect(result.inScopeCounts.directExpenses).toBe(2);
  });

  // US1 AC7 / FR-021 — a row cleared in any earlier session is out of scope.
  it("excludes a record cleared in an earlier session", () => {
    const rows = [
      item({ itemId: 40, amount: 75 }),
      item({ itemId: 41, amount: 500, clearedSessionId: 3, cleared: true }),
    ];
    const directExpenses = inScope(rows);
    expect(directExpenses.map((expense) => expense.itemId)).toEqual([40]);

    const result = computeExpectedBalance({
      startingBalance: 1000,
      incomes: [],
      directExpenses,
      claims: [],
    });

    expect(result.expenseTotal).toBe(75);
    expect(result.expected).toBe(925);
    expect(result.inScopeCounts.directExpenses).toBe(1);
  });

  // SC-009 / FR-029 — `WillNotClear` removes a row from the arithmetic for good;
  // `NotYetCleared` is only a note and leaves it in scope.
  it("excludes a WillNotClear row while keeping a NotYetCleared one", () => {
    const rows = [
      item({
        itemId: 50,
        amount: 75,
        annotation: LeftoverAnnotation.NotYetCleared,
      }),
      item({
        itemId: 51,
        amount: 500,
        annotation: LeftoverAnnotation.WillNotClear,
      }),
    ];
    const directExpenses = inScope(rows);
    expect(directExpenses.map((expense) => expense.itemId)).toEqual([50]);

    const result = computeExpectedBalance({
      startingBalance: 1000,
      incomes: [],
      directExpenses,
      claims: [],
    });

    expect(result.expenseTotal).toBe(75);
    expect(result.expected).toBe(925);
    expect(result.inScopeCounts.directExpenses).toBe(1);
  });

  // D-03 — rounding per row before summing matches what the screen shows.
  it("rounds each row to 2 dp before summing, not the sum", () => {
    const incomes = [
      item({ itemId: 60, itemType: ReconItemType.Income, amount: 33.333 }),
      item({ itemId: 61, itemType: ReconItemType.Income, amount: 33.333 }),
      item({ itemId: 62, itemType: ReconItemType.Income, amount: 33.333 }),
    ];

    const result = computeExpectedBalance({
      startingBalance: 0,
      incomes,
      directExpenses: [],
      claims: [],
    });

    // Per row: 33.33 × 3 = 99.99. Summing raw and rounding once would give 100.
    expect(result.incomeTotal).toBe(99.99);
    expect(result.expected).toBe(99.99);
    expect(result.expected).not.toBe(100);
  });

  it("rounds each foreign-currency row before summing", () => {
    // 2.005 × 3 = 6.015 raw → 6.02 if rounded once; 2.01 × 3 = 6.03 per row.
    const directExpenses = [
      item({ itemId: 70, amount: 1.337, exchangeRate: 1.5 }),
      item({ itemId: 71, amount: 1.337, exchangeRate: 1.5 }),
      item({ itemId: 72, amount: 1.337, exchangeRate: 1.5 }),
    ];
    expect(mainAmount(directExpenses[0])).toBe(2.01);

    const result = computeExpectedBalance({
      startingBalance: 100,
      incomes: [],
      directExpenses,
      claims: [],
    });

    expect(result.expenseTotal).toBe(6.03);
    expect(result.expected).toBe(93.97);
  });

  it("keeps totals free of binary-float residue", () => {
    const result = computeExpectedBalance({
      startingBalance: 0,
      incomes: [
        item({ itemId: 80, itemType: ReconItemType.Income, amount: 0.1 }),
        item({ itemId: 81, itemType: ReconItemType.Income, amount: 0.2 }),
      ],
      directExpenses: [],
      claims: [],
    });

    expect(result.incomeTotal).toBe(0.3);
    expect(result.expected).toBe(0.3);
  });
});

describe("compareBalances", () => {
  it("matches when the difference is float noise below EPSILON", () => {
    const result = compareBalances(830, 830 + 1e-12);

    expect(result.matched).toBe(true);
    expect(result.difference).toBe(0);
  });

  it("matches on an exact equality", () => {
    expect(compareBalances(1204.55, 1204.55)).toEqual({
      matched: true,
      difference: 0,
    });
  });

  it("reports a positive difference when the books show more than the statement", () => {
    const result = compareBalances(1000, 950.25);

    expect(result.matched).toBe(false);
    expect(result.difference).toBe(49.75);
  });

  it("reports a negative difference when the statement shows more than the books", () => {
    const result = compareBalances(950.25, 1000);

    expect(result.matched).toBe(false);
    expect(result.difference).toBe(-49.75);
  });

  it("treats a difference of exactly EPSILON as unmatched", () => {
    const result = compareBalances(100 + EPSILON, 100);

    expect(result.matched).toBe(false);
    expect(result.difference).not.toBe(0);
  });

  it("treats a one-cent difference as unmatched", () => {
    expect(compareBalances(100.01, 100)).toEqual({
      matched: false,
      difference: 0.01,
    });
  });
});
