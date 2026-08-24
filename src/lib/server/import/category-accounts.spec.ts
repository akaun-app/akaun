import { describe, expect, it } from "vitest";
import {
  categoryAccountForImport,
  resolvePaidFromAccountId,
  type CategoryChoice,
} from "./category-accounts.js";

const CHOICES: CategoryChoice[] = [
  { id: 11, name: "Office Supplies", code: 5100, path: "Office Supplies" },
  { id: 12, name: "Travel", code: 5200, path: "Travel" },
  {
    id: 13,
    name: "Meals & Entertainment",
    code: 5300,
    path: "Meals & Entertainment",
  },
];

describe("the category an imported document is filed under", () => {
  it("accepts only an account id from the choices sent to the LLM", () => {
    expect(categoryAccountForImport("expense", CHOICES, 12, 91)).toEqual({
      ok: true,
      value: { accountId: 12, uncategorised: false },
    });
    expect(categoryAccountForImport("expense", CHOICES, 999, 91)).toEqual({
      ok: true,
      value: { accountId: 91, uncategorised: true },
    });
  });
});

describe("the saved fallback for imported categories", () => {
  it("uses the saved uncategorised expense account when no expense name matches", () => {
    expect(categoryAccountForImport("expense", CHOICES, null, 91)).toEqual({
      ok: true,
      value: { accountId: 91, uncategorised: true },
    });
  });

  it("refuses an unmatched expense before writing when its saved default is invalid", () => {
    const result = categoryAccountForImport("expense", CHOICES, null, null);
    expect(result.ok).toBe(false);
  });

  it("uses the saved uncategorised income account when no income id matches", () => {
    expect(categoryAccountForImport("income", CHOICES, null, 92)).toEqual({
      ok: true,
      value: { accountId: 92, uncategorised: true },
    });
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
