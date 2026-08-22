import { describe, expect, it } from "vitest";
import { AccountType } from "$lib/enums.js";
import {
  descendantsOf,
  validateAccountParent,
  type HierarchyAccount,
} from "./account-hierarchy.js";

const rows: HierarchyAccount[] = [
  { id: 1, type: AccountType.Asset, parentId: null },
  { id: 2, type: AccountType.Asset, parentId: 1 },
  { id: 3, type: AccountType.Asset, parentId: 2 },
  { id: 4, type: AccountType.Expense, parentId: null },
];

describe("account hierarchy", () => {
  it("Parent_WhenTypesDiffer_ShouldRefuse", () => {
    expect(validateAccountParent(rows, 2, 4)).toEqual({
      ok: false,
      reason: "A parent and child must have the same account type.",
    });
  });

  it("Parent_WhenItIsSelfOrDescendant_ShouldRefuseCycle", () => {
    expect(validateAccountParent(rows, 2, 2).ok).toBe(false);
    expect(validateAccountParent(rows, 1, 3).ok).toBe(false);
  });

  it("Descendants_WhenNested_ShouldReturnEachOnce", () => {
    expect(descendantsOf(rows, 1)).toEqual([2, 3]);
  });
});
