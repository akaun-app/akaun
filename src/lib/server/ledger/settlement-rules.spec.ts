import { describe, expect, it } from "vitest";
import {
  afterUndo,
  checkAllocations,
  isFullySettled,
  outstandingOf,
  recordSettlementState,
  settlementDirectionForAccount,
} from "./settlement-rules.js";
import type { SettlementSide } from "./types.js";

/** An item owed to someone: a negative movement on the shared "money we owe" account. */
function owed(
  movementId: number,
  amountMinor: number,
  settledMinor = 0,
): SettlementSide {
  return { movementId, amountMinor: -amountMinor, settledMinor };
}

describe("how much is still outstanding", () => {
  it("is the whole amount when nothing has been paid", () => {
    expect(outstandingOf(owed(1, 5000))).toBe(5000);
  });

  it("is the remainder after a part payment", () => {
    expect(outstandingOf(owed(1, 5000, 2000))).toBe(3000);
  });

  it("is nothing once it is covered", () => {
    expect(outstandingOf(owed(1, 5000, 5000))).toBe(0);
    expect(isFullySettled(owed(1, 5000, 5000))).toBe(true);
    expect(isFullySettled(owed(1, 5000, 4999))).toBe(false);
  });

  it("reads the same whichever way the movement faces", () => {
    // Money owed TO us is a positive movement on the receivable account; the
    // arithmetic is the same.
    expect(
      outstandingOf({ movementId: 1, amountMinor: 5000, settledMinor: 2000 }),
    ).toBe(3000);
  });
});

describe("saved receivable and payable classification", () => {
  const defaults = { receivableAccountId: 20, payableAccountId: 30 };

  it("classifies only the two saved account IDs", () => {
    expect(settlementDirectionForAccount(20, defaults)).toBe("owed-to-us");
    expect(settlementDirectionForAccount(30, defaults)).toBe("we-owe");
    expect(settlementDirectionForAccount(31, defaults)).toBeNull();
  });
});

describe("whether a record reads paid", () => {
  it("reads paid when it never owed anyone — it was paid straight from an account", () => {
    expect(recordSettlementState([])).toEqual({
      paid: true,
      outstandingMinor: 0,
    });
  });

  it("reads owed while its outstanding side is uncovered", () => {
    expect(recordSettlementState([owed(1, 5000)])).toEqual({
      paid: false,
      outstandingMinor: 5000,
    });
  });

  it("reads owed for the remainder after a part payment", () => {
    expect(recordSettlementState([owed(1, 5000, 2000)])).toEqual({
      paid: false,
      outstandingMinor: 3000,
    });
  });

  it("reads paid once every outstanding side is covered", () => {
    expect(recordSettlementState([owed(1, 5000, 5000)])).toEqual({
      paid: true,
      outstandingMinor: 0,
    });
  });
});

describe("allocating a payment across what it covers", () => {
  const items = new Map<number, SettlementSide>([
    [1, owed(1, 5000)],
    [2, owed(2, 3000)],
    [3, owed(3, 2000, 500)],
  ]);

  it("accepts allocations that fit inside both the payment and each item", () => {
    const result = checkAllocations(
      [
        { owedMovementId: 1, amountMinor: 5000 },
        { owedMovementId: 2, amountMinor: 3000 },
      ],
      items,
      8000,
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a part payment, leaving the rest owed", () => {
    const result = checkAllocations(
      [{ owedMovementId: 1, amountMinor: 2000 }],
      items,
      2000,
    );
    expect(result.ok).toBe(true);
    expect(outstandingOf({ ...owed(1, 5000), settledMinor: 2000 })).toBe(3000);
  });

  it("refuses an allocation larger than what is left, and says what is left", () => {
    const result = checkAllocations(
      [{ owedMovementId: 3, amountMinor: 2000 }],
      items,
      2000,
    );
    expect(result.ok).toBe(false);
    // 20.00 owed, 5.00 already covered — 15.00 is still available.
    if (!result.ok) expect(result.reason).toContain("15.00");
  });

  it("refuses allocations that together exceed the payment itself", () => {
    const result = checkAllocations(
      [
        { owedMovementId: 1, amountMinor: 5000 },
        { owedMovementId: 2, amountMinor: 3000 },
      ],
      items,
      6000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/payment/i);
  });

  it("refuses an allocation of nothing, or of a negative amount", () => {
    expect(
      checkAllocations([{ owedMovementId: 1, amountMinor: 0 }], items, 5000).ok,
    ).toBe(false);
    expect(
      checkAllocations([{ owedMovementId: 1, amountMinor: -100 }], items, 5000)
        .ok,
    ).toBe(false);
  });

  it("refuses an allocation against an item it was not given", () => {
    const result = checkAllocations(
      [{ owedMovementId: 99, amountMinor: 100 }],
      items,
      5000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.reason).toMatch(/cannot be found|no longer|not found/i);
  });

  it("refuses the same item twice in one payment", () => {
    const result = checkAllocations(
      [
        { owedMovementId: 1, amountMinor: 1000 },
        { owedMovementId: 1, amountMinor: 1000 },
      ],
      items,
      5000,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/twice|more than once|once/i);
  });
});

describe("two payments settling one item", () => {
  it("lets a second payment cover what the first left", () => {
    const item = owed(1, 5000);
    const first = checkAllocations(
      [{ owedMovementId: 1, amountMinor: 2000 }],
      new Map([[1, item]]),
      2000,
    );
    expect(first.ok).toBe(true);

    const afterFirst = { ...item, settledMinor: 2000 };
    const second = checkAllocations(
      [{ owedMovementId: 1, amountMinor: 3000 }],
      new Map([[1, afterFirst]]),
      3000,
    );
    expect(second.ok).toBe(true);
    expect(outstandingOf({ ...afterFirst, settledMinor: 5000 })).toBe(0);
  });

  it("refuses a second payment that would take it past the total", () => {
    const afterFirst = owed(1, 5000, 2000);
    const second = checkAllocations(
      [{ owedMovementId: 1, amountMinor: 3001 }],
      new Map([[1, afterFirst]]),
      3001,
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toContain("30.00");
  });
});

describe("undoing a settlement", () => {
  it("returns both sides to outstanding", () => {
    const item = owed(1, 5000, 5000);
    const payment: SettlementSide = {
      movementId: 9,
      amountMinor: 5000,
      settledMinor: 5000,
    };

    const itemAfter = afterUndo(item, 5000);
    const paymentAfter = afterUndo(payment, 5000);

    expect(outstandingOf(itemAfter)).toBe(5000);
    expect(outstandingOf(paymentAfter)).toBe(5000);
    expect(isFullySettled(itemAfter)).toBe(false);
  });

  it("returns only what that one settlement covered", () => {
    const item = owed(1, 5000, 5000);
    expect(outstandingOf(afterUndo(item, 2000))).toBe(2000);
  });

  it("never leaves a side covered for less than nothing", () => {
    const item = owed(1, 5000, 1000);
    expect(afterUndo(item, 4000).settledMinor).toBe(0);
  });
});
