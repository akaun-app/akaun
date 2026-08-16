import { describe, expect, it } from "vitest";
import { allocateMinor, fromMinor, toMinor } from "./money.js";

describe("converting an entered amount to cents", () => {
  it("converts at the record's own stored rate", () => {
    // RM 123.45 entered against a rate of 4.7 main-currency units per RM.
    expect(toMinor(123.45, 4.7)).toBe(58022);
  });

  it("converts exactly at a rate of 1", () => {
    expect(toMinor(123.45, 1)).toBe(12345);
    expect(toMinor(0.1, 1)).toBe(10);
    expect(toMinor(0.07, 1)).toBe(7);
  });

  it("is not fooled by binary floating point", () => {
    // 0.1 + 0.2 style error: 1.005 * 100 is 100.49999999999999 in IEEE 754,
    // which a naive Math.round would take down to 100 instead of 101.
    expect(toMinor(1.005, 1)).toBe(101);
    expect(toMinor(8.165, 1)).toBe(817);
  });

  it("keeps the sign of a negative amount", () => {
    expect(toMinor(-12.34, 1)).toBe(-1234);
  });

  it("rounds back to a decimal for display", () => {
    expect(fromMinor(12345)).toBe(123.45);
    expect(fromMinor(-1234)).toBe(-12.34);
    expect(fromMinor(0)).toBe(0);
  });
});

describe("splitting a payment across what it covers", () => {
  it("splits three ways and still sums to the original", () => {
    // 100.00 across three equal items cannot divide evenly in cents.
    const parts = allocateMinor(10000, [10000, 10000, 10000]);
    expect(parts).toEqual([3334, 3333, 3333]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it("splits in proportion to what each item is owed", () => {
    const parts = allocateMinor(9000, [6000, 3000]);
    expect(parts).toEqual([6000, 3000]);
  });

  it("hands the rounding remainder to the largest weights first", () => {
    // 10 cents over weights 1:1:1 leaves one cent spare after 3 each.
    expect(allocateMinor(10, [5, 3, 2])).toEqual([5, 3, 2]);
    expect(allocateMinor(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("returns nothing for no weights, and everything for one", () => {
    expect(allocateMinor(500, [])).toEqual([]);
    expect(allocateMinor(500, [999])).toEqual([500]);
  });

  it("gives zero-weight items nothing", () => {
    const parts = allocateMinor(500, [500, 0]);
    expect(parts).toEqual([500, 0]);
  });
});
