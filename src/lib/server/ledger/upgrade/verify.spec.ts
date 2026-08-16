import { describe, expect, it } from "vitest";
import { compareSnapshots } from "./verify.js";
import type { UpgradeSnapshot } from "../types.js";

function snapshot(overrides: Partial<UpgradeSnapshot> = {}): UpgradeSnapshot {
  return {
    expenseTotalMinor: 1_234_56,
    incomeTotalMinor: 900_00,
    claimTotalMinor: 400_00,
    expenseCount: 192,
    incomeCount: 7,
    claimCount: 34,
    referenceNumbers: ["EX20250101-001", "IN20250101-001", "CL20250101-001"],
    attachmentCount: 2,
    attachmentHashes: {
      "expenses/2025/01/a.pdf": "aaa",
      "income/2025/01/b.pdf": "bbb",
    },
    categoryTotalsMinor: { Transport: 500_00, "Food & Beverage": 734_56 },
    ...overrides,
  };
}

/** What the "after" side looks like when nothing went wrong. */
function faithfulAfter(before: UpgradeSnapshot): UpgradeSnapshot {
  return {
    ...before,
    // Files move, so the paths change while the content must not.
    attachmentHashes: {
      "records/2025/01/a.pdf": "aaa",
      "records/2025/01/b.pdf": "bbb",
    },
  };
}

describe("an upgrade that changed nothing it should not have", () => {
  it("passes", () => {
    const before = snapshot();
    const result = compareSnapshots(before, faithfulAfter(before));
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("passes over an empty installation", () => {
    const empty: UpgradeSnapshot = {
      expenseTotalMinor: 0,
      incomeTotalMinor: 0,
      claimTotalMinor: 0,
      expenseCount: 0,
      incomeCount: 0,
      claimCount: 0,
      referenceNumbers: [],
      attachmentCount: 0,
      attachmentHashes: {},
      categoryTotalsMinor: {},
    };
    expect(compareSnapshots(empty, empty).ok).toBe(true);
  });
});

describe("a deliberately corrupted result is reported, not passed", () => {
  it("catches a total that moved, even by one cent", () => {
    const before = snapshot();
    const after = { ...faithfulAfter(before), expenseTotalMinor: 1_234_57 };
    const result = compareSnapshots(before, after);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => /expense/i.test(f.what))).toBe(true);
  });

  it("catches a record that went missing", () => {
    const before = snapshot();
    const after = { ...faithfulAfter(before), expenseCount: 191 };
    const result = compareSnapshots(before, after);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => /count/i.test(f.what))).toBe(true);
  });

  it("catches a reference number that changed a single character", () => {
    const before = snapshot();
    const after = {
      ...faithfulAfter(before),
      referenceNumbers: ["EX20250101-002", "IN20250101-001", "CL20250101-001"],
    };
    const result = compareSnapshots(before, after);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => /reference/i.test(f.what))).toBe(true);
  });

  it("does not care what order the reference numbers come back in", () => {
    const before = snapshot();
    const after = {
      ...faithfulAfter(before),
      referenceNumbers: ["CL20250101-001", "EX20250101-001", "IN20250101-001"],
    };
    expect(compareSnapshots(before, after).ok).toBe(true);
  });

  it("catches a category total that moved", () => {
    const before = snapshot();
    const after = {
      ...faithfulAfter(before),
      categoryTotalsMinor: { Transport: 400_00, "Food & Beverage": 834_56 },
    };
    const result = compareSnapshots(before, after);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => /Transport/.test(f.what))).toBe(true);
  });

  it("catches a category that disappeared entirely", () => {
    const before = snapshot();
    const after = {
      ...faithfulAfter(before),
      categoryTotalsMinor: { "Food & Beverage": 734_56 },
    };
    expect(compareSnapshots(before, after).ok).toBe(false);
  });

  it("catches an attachment that lost a file", () => {
    const before = snapshot();
    const after = { ...faithfulAfter(before), attachmentCount: 1 };
    const result = compareSnapshots(before, after);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => /attachment/i.test(f.what))).toBe(true);
  });

  it("catches a file whose contents changed, even though its path is new", () => {
    // The whole point of hashing by content rather than by path: a move is
    // expected to change every path and must change no bytes (SC-014).
    const before = snapshot();
    const after = {
      ...faithfulAfter(before),
      attachmentHashes: {
        "records/2025/01/a.pdf": "aaa",
        "records/2025/01/b.pdf": "CHANGED",
      },
    };
    const result = compareSnapshots(before, after);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => /file/i.test(f.what))).toBe(true);
  });

  it("reports every problem at once rather than stopping at the first", () => {
    const before = snapshot();
    const after = {
      ...faithfulAfter(before),
      expenseTotalMinor: 1,
      incomeTotalMinor: 2,
      expenseCount: 3,
    };
    expect(
      compareSnapshots(before, after).findings.length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("says what each figure was before and what it became", () => {
    const before = snapshot();
    const after = { ...faithfulAfter(before), expenseCount: 191 };
    const finding = compareSnapshots(before, after).findings.find((f) =>
      /count/i.test(f.what),
    );
    expect(finding?.before).toBe("192");
    expect(finding?.after).toBe("191");
  });
});
