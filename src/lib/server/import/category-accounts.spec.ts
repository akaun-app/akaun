import { describe, expect, it } from "vitest";
import {
  categoryAccountForImport,
  matchCategoryAccount,
  resolvePaidFromAccountId,
  type CategoryChoice,
} from "./category-accounts.js";

const CHOICES: CategoryChoice[] = [
  { id: 11, name: "Office Supplies" },
  { id: 12, name: "Travel" },
  { id: 13, name: "Meals & Entertainment" },
];

describe("the category an imported document is filed under", () => {
  it("finds the account whose name the document names", () => {
    expect(matchCategoryAccount(CHOICES, "Travel")).toBe(12);
  });

  it("ignores case and surrounding spaces", () => {
    expect(matchCategoryAccount(CHOICES, "office supplies")).toBe(11);
    expect(matchCategoryAccount(CHOICES, "  TRAVEL ")).toBe(12);
  });

  it("matches a name with punctuation in it exactly as written", () => {
    expect(matchCategoryAccount(CHOICES, "Meals & Entertainment")).toBe(13);
    expect(matchCategoryAccount(CHOICES, "Meals and Entertainment")).toBeNull();
  });

  it("says nothing matched rather than guessing at a near miss", () => {
    expect(matchCategoryAccount(CHOICES, "Travelling")).toBeNull();
    expect(matchCategoryAccount(CHOICES, "Stationery")).toBeNull();
  });

  it("says nothing matched when no category could be read at all", () => {
    expect(matchCategoryAccount(CHOICES, "")).toBeNull();
    expect(matchCategoryAccount(CHOICES, "   ")).toBeNull();
    expect(matchCategoryAccount(CHOICES, null)).toBeNull();
    expect(matchCategoryAccount(CHOICES, undefined)).toBeNull();
  });

  it("says nothing matched when there is nothing to match against", () => {
    expect(matchCategoryAccount([], "Travel")).toBeNull();
  });
});

describe("the saved fallback for imported categories", () => {
  it("uses the saved uncategorised expense account when no expense name matches", () => {
    expect(categoryAccountForImport("expense", CHOICES, "Unknown", 91)).toEqual(
      {
        ok: true,
        value: { accountId: 91, uncategorised: true },
      },
    );
  });

  it("refuses an unmatched expense before writing when its saved default is invalid", () => {
    const result = categoryAccountForImport(
      "expense",
      CHOICES,
      "Unknown",
      null,
    );
    expect(result.ok).toBe(false);
  });

  it("does not put unmatched income into an expense account", () => {
    const result = categoryAccountForImport("income", CHOICES, "Unknown", 91);
    expect(result.ok).toBe(false);
  });
});

describe("resolvePaidFromAccountId", () => {
  it("passes the picked account through unchanged for an ordinary expense", () => {
    expect(resolvePaidFromAccountId(7, false, 99)).toBe(7);
  });

  it("reads picking Accounts Payable as owed, not already paid", () => {
    expect(resolvePaidFromAccountId(99, false, 99)).toBeNull();
  });

  it("never translates the account for income, even if it matches Payable's id", () => {
    expect(resolvePaidFromAccountId(99, true, 99)).toBe(99);
  });

  it("passes the account through when Payable isn't configured", () => {
    expect(resolvePaidFromAccountId(7, false, null)).toBe(7);
  });
});
