import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { AccountType } from "$lib/enums.js";
import {
  AccountCodeRangeExhaustedError,
  accountCodeRangeFor,
  lowestFreeAccountCode,
} from "./account-code.js";

describe("account code allocation", () => {
  it("Range_WhenTypeVaries_ShouldUseItsSeededBounds", () => {
    expect(accountCodeRangeFor(AccountType.Asset)).toEqual({
      start: 1000,
      end: 1999,
    });
    expect(accountCodeRangeFor(AccountType.Liability)).toEqual({
      start: 2000,
      end: 2999,
    });
    expect(accountCodeRangeFor(AccountType.Equity)).toEqual({
      start: 3000,
      end: 3999,
    });
    expect(accountCodeRangeFor(AccountType.Revenue)).toEqual({
      start: 4000,
      end: 4999,
    });
    expect(accountCodeRangeFor(AccountType.Expense)).toEqual({
      start: 5000,
      end: 5999,
    });
  });

  it("Allocation_WhenRangeHasGaps_ShouldReturnLowestFreeCode", () => {
    expect(
      lowestFreeAccountCode(AccountType.Asset, [1000, 1002, 999, 2000]),
    ).toBe(1001);
    expect(
      lowestFreeAccountCode(AccountType.Revenue, new Set([4000, 4001])),
    ).toBe(4002);
  });

  it("Allocation_WhenRangeIsExhausted_ShouldRefusePlainly", () => {
    const used = Array.from({ length: 1000 }, (_, offset) => 5000 + offset);
    expect(() => lowestFreeAccountCode(AccountType.Expense, used)).toThrow(
      AccountCodeRangeExhaustedError,
    );
    expect(() => lowestFreeAccountCode(AccountType.Expense, used)).toThrow(
      "No free Expense account codes remain in range 5000-5999.",
    );
  });

  it("Allocation_WhenReservationFails_ShouldRollBackWithCallerTransaction", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE accounts (code INTEGER NOT NULL UNIQUE)");

    expect(() =>
      sqlite.transaction(() => {
        const used = sqlite.query("SELECT code FROM accounts").all() as {
          code: number;
        }[];
        const code = lowestFreeAccountCode(
          AccountType.Asset,
          used.map((row) => row.code),
        );
        sqlite.query("INSERT INTO accounts (code) VALUES (?)").run(code);
        throw new Error("later write failed");
      })(),
    ).toThrow("later write failed");

    expect(sqlite.query("SELECT code FROM accounts").all()).toEqual([]);
    sqlite.close();
  });
});
