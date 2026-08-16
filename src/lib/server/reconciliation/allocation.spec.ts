import { describe, expect, it } from "vitest";
import {
  allocationState,
  allocationTotal,
  availableForLine,
  remainingAmount,
  suggestExactAllocationSet,
} from "./allocation.js";

describe("reconciliation allocations", () => {
  it("adds several bank allocations without float noise", () => {
    expect(allocationTotal([{ amount: 40.1 }, { amount: 59.9 }])).toBe(100);
  });

  it("derives unmatched, partial, matched, and overallocated states", () => {
    expect(allocationState(100, 0)).toBe("unmatched");
    expect(allocationState(100, 60)).toBe("partial");
    expect(allocationState(100, 100)).toBe("matched");
    expect(allocationState(100, 110)).toBe("overallocated");
  });

  // These two are about drift: a record was matched to a bank line, and its own
  // amount has since changed. `item_amount_snapshot` is what makes that
  // detectable at all, and these say what the difference should read as. Claims
  // used to be the way an amount moved after matching; a record's amount can
  // still be corrected while nothing has settled or reconciled it, so the rule
  // outlived the concept that named it.
  it("exposes only the uncovered amount when a matched record grows", () => {
    expect(remainingAmount(150, 100)).toBe(50);
  });

  it("exposes an overpayment when a matched record shrinks", () => {
    expect(remainingAmount(80, 100)).toBe(-20);
  });

  it("keeps partially allocated records available for their remaining balance", () => {
    expect(availableForLine(40, 0)).toBe(40);
  });

  it("restores the current line allocation while that line is being corrected", () => {
    expect(availableForLine(0, 75)).toBe(75);
  });

  it("suggests one exact statement line before a multi-line combination", () => {
    expect(
      suggestExactAllocationSet(100, [
        { id: 1, amount: 40, score: 100 },
        { id: 2, amount: 60, score: 100 },
        { id: 3, amount: 100, score: 10 },
      ]),
    ).toEqual([3]);
  });

  it("suggests a deterministic exact combination in integer cents", () => {
    expect(
      suggestExactAllocationSet(100.1, [
        { id: 4, amount: 40.1, score: 20 },
        { id: 5, amount: 60, score: 20 },
        { id: 6, amount: 50.05, score: 5 },
        { id: 7, amount: 50.05, score: 5 },
      ]),
    ).toEqual([4, 5]);
  });

  it("does not suggest a near-total set", () => {
    expect(
      suggestExactAllocationSet(100, [
        { id: 1, amount: 40, score: 1 },
        { id: 2, amount: 59.99, score: 1 },
      ]),
    ).toEqual([]);
  });
});
