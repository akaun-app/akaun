import { describe, expect, it } from "vitest";
import {
  matchCategoryAccount,
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
