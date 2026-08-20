import { describe, expect, it } from "vitest";
import {
  mergeRecordsPermissions,
  type PermissionRow,
} from "./merge-records.js";

/**
 * Principle V names permission resolution as TDD-required, and SC-006 measures
 * invariants 7 and 8 (data-model.md §6):
 *
 *   7. No row names `expenses`, `income` or `journal` after the rewrite.
 *   8. Effective access to records is at least what it was before, for every
 *      owner.
 *
 * The merge is a pure function over plain rows — no database — because a merge
 * expressed as SQL inside a migration cannot be driven red-green.
 */

const ABILITIES = ["canView", "canAdd", "canChange", "canDelete"] as const;

function row(
  ownerId: number,
  resource: string,
  bits: Partial<Record<(typeof ABILITIES)[number], boolean>> = {},
): PermissionRow {
  return {
    ownerId,
    resource,
    canView: bits.canView ?? false,
    canAdd: bits.canAdd ?? false,
    canChange: bits.canChange ?? false,
    canDelete: bits.canDelete ?? false,
  };
}

/** The 16 combinations of one owner's four booleans. */
function combinations(): boolean[][] {
  const out: boolean[][] = [];
  for (let mask = 0; mask < 16; mask++) {
    out.push([
      (mask & 1) !== 0,
      (mask & 2) !== 0,
      (mask & 4) !== 0,
      (mask & 8) !== 0,
    ]);
  }
  return out;
}

function bitsOf(values: boolean[]) {
  return {
    canView: values[0],
    canAdd: values[1],
    canChange: values[2],
    canDelete: values[3],
  };
}

describe("mergeRecordsPermissions", () => {
  it("ORs every one of the 16 × 16 boolean combinations", () => {
    for (const expenseBits of combinations()) {
      for (const incomeBits of combinations()) {
        const result = mergeRecordsPermissions([
          row(1, "expenses", bitsOf(expenseBits)),
          row(1, "income", bitsOf(incomeBits)),
        ]);

        expect(result).toHaveLength(1);
        const merged = result[0]!;
        expect(merged.resource).toBe("records");
        ABILITIES.forEach((ability, index) => {
          expect(merged[ability]).toBe(expenseBits[index] || incomeBits[index]);
        });
      }
    }
  });

  it("treats a missing source row as all-false, so one-sided access is kept whole", () => {
    const onlyIncome = mergeRecordsPermissions([
      row(7, "income", { canView: true, canAdd: true }),
    ]);
    expect(onlyIncome).toEqual([
      row(7, "records", { canView: true, canAdd: true }),
    ]);

    const onlyExpenses = mergeRecordsPermissions([
      row(8, "expenses", { canChange: true }),
    ]);
    expect(onlyExpenses).toEqual([row(8, "records", { canChange: true })]);
  });

  it("leaves an owner holding neither with no records row at all", () => {
    const result = mergeRecordsPermissions([
      row(9, "contacts", { canView: true }),
    ]);
    expect(result.some((r) => r.resource === "records")).toBe(false);
    expect(result).toEqual([row(9, "contacts", { canView: true })]);
  });

  it("renames journal to adjustments unchanged", () => {
    const result = mergeRecordsPermissions([
      row(2, "journal", { canView: true, canAdd: true, canChange: true }),
    ]);
    expect(result).toEqual([
      row(2, "adjustments", { canView: true, canAdd: true, canChange: true }),
    ]);
  });

  it("keeps every other resource untouched", () => {
    const others = [
      row(3, "contacts", { canView: true }),
      row(3, "reports", { canView: true }),
      row(3, "reconciliation", { canView: true, canAdd: true }),
    ];
    expect(mergeRecordsPermissions(others)).toEqual(others);
  });

  it("merges each owner independently", () => {
    const result = mergeRecordsPermissions([
      row(1, "expenses", { canView: true }),
      row(2, "income", { canAdd: true }),
      row(1, "income", { canDelete: true }),
    ]);
    const byOwner = new Map(result.map((r) => [r.ownerId, r]));
    expect(byOwner.get(1)).toEqual(
      row(1, "records", { canView: true, canDelete: true }),
    );
    expect(byOwner.get(2)).toEqual(row(2, "records", { canAdd: true }));
  });

  // Invariant 7 — no retired resource name survives.
  it("leaves no row naming expenses, income or journal (invariant 7)", () => {
    const result = mergeRecordsPermissions([
      row(1, "expenses", { canView: true }),
      row(1, "income", { canAdd: true }),
      row(1, "journal", { canChange: true }),
      row(2, "expenses", { canDelete: true }),
    ]);
    for (const retired of ["expenses", "income", "journal"]) {
      expect(result.some((r) => r.resource === retired)).toBe(false);
    }
  });

  // Invariant 8 — nobody loses access.
  it("never reduces access for any owner (invariant 8)", () => {
    const before = [
      row(1, "expenses", { canView: true, canChange: true }),
      row(1, "income", { canAdd: true }),
      row(2, "income", { canView: true }),
      row(3, "expenses", { canDelete: true }),
    ];
    const after = mergeRecordsPermissions(before);

    for (const source of before) {
      const merged = after.find(
        (r) => r.ownerId === source.ownerId && r.resource === "records",
      );
      expect(merged).toBeDefined();
      for (const ability of ABILITIES) {
        if (source[ability]) expect(merged![ability]).toBe(true);
      }
    }
  });

  it("is idempotent — running it twice changes nothing", () => {
    const before = [
      row(1, "expenses", { canView: true, canAdd: true }),
      row(1, "income", { canChange: true }),
      row(1, "journal", { canAdd: true }),
      row(2, "contacts", { canView: true }),
    ];
    const once = mergeRecordsPermissions(before);
    const twice = mergeRecordsPermissions(once);
    expect(twice).toEqual(once);
  });

  it("merges an already-migrated records row with a leftover source row", () => {
    const result = mergeRecordsPermissions([
      row(1, "records", { canView: true }),
      row(1, "expenses", { canAdd: true }),
    ]);
    expect(result).toEqual([
      row(1, "records", { canView: true, canAdd: true }),
    ]);
  });
});
