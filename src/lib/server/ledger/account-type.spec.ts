import { describe, expect, it } from "vitest";
import { AccountRole, AccountType, type AccountRoleCode } from "$lib/enums.js";
import {
  accountTypeFor,
  displaySign,
  isCategoryRole,
  isProfitAndLossRole,
  isSharedOwedRole,
} from "./account-type.js";

const EVERY_ROLE = Object.values(AccountRole) as AccountRoleCode[];

describe("what kind of thing an account is", () => {
  it("maps every role to a type", () => {
    for (const role of EVERY_ROLE) {
      expect(
        Object.values(AccountType),
        `role ${role} has no type`,
      ).toContain(accountTypeFor(role));
    }
  });

  it("treats every place money sits, and everything the business keeps, as owned", () => {
    expect(accountTypeFor(AccountRole.Bank)).toBe(AccountType.Asset);
    expect(accountTypeFor(AccountRole.Wallet)).toBe(AccountType.Asset);
    expect(accountTypeFor(AccountRole.Cash)).toBe(AccountType.Asset);
    expect(accountTypeFor(AccountRole.Card)).toBe(AccountType.Asset);
    expect(accountTypeFor(AccountRole.Equipment)).toBe(AccountType.Asset);
    expect(accountTypeFor(AccountRole.Receivable)).toBe(AccountType.Asset);
  });

  it("treats money we owe as owed, and the owners' side as their stake", () => {
    expect(accountTypeFor(AccountRole.Payable)).toBe(AccountType.Liability);
    expect(accountTypeFor(AccountRole.OpeningBalances)).toBe(AccountType.Equity);
    expect(accountTypeFor(AccountRole.PartnerCapital)).toBe(AccountType.Equity);
    expect(accountTypeFor(AccountRole.PartnerDrawings)).toBe(AccountType.Equity);
  });

  it("treats the two category roles as what the profit and loss is made of", () => {
    expect(accountTypeFor(AccountRole.IncomeCategory)).toBe(AccountType.Income);
    expect(accountTypeFor(AccountRole.ExpenseCategory)).toBe(AccountType.Expense);
  });
});

describe("the sign a report shows a balance with", () => {
  it("gives a display sign to every role", () => {
    for (const role of EVERY_ROLE) {
      expect([1, -1], `role ${role} has no sign`).toContain(displaySign(role));
    }
  });

  it("shows what is owned as it is stored", () => {
    // Value going into a bank account is stored positive, and a reader expects
    // a positive figure — no flip.
    expect(displaySign(AccountRole.Bank)).toBe(1);
    expect(displaySign(AccountRole.Equipment)).toBe(1);
    expect(displaySign(AccountRole.Receivable)).toBe(1);
    expect(displaySign(AccountRole.ExpenseCategory)).toBe(1);
  });

  it("flips what sits at a negative balance so a reader sees a positive figure", () => {
    // Money we owe, income earned and owner capital all accumulate negative
    // under the one sign convention; every report flips them in this one place.
    expect(displaySign(AccountRole.Payable)).toBe(-1);
    expect(displaySign(AccountRole.IncomeCategory)).toBe(-1);
    expect(displaySign(AccountRole.PartnerCapital)).toBe(-1);
    expect(displaySign(AccountRole.OpeningBalances)).toBe(-1);
  });

  it("shows money a partner took out as a positive figure", () => {
    expect(displaySign(AccountRole.PartnerDrawings)).toBe(1);
  });
});

describe("the groupings the rules ask about", () => {
  it("knows the two shared owed accounts and nothing else", () => {
    const shared = EVERY_ROLE.filter(isSharedOwedRole);
    expect(shared).toEqual([AccountRole.Receivable, AccountRole.Payable]);
  });

  it("knows the two category roles and nothing else", () => {
    const cats = EVERY_ROLE.filter(isCategoryRole);
    expect(cats).toEqual([
      AccountRole.ExpenseCategory,
      AccountRole.IncomeCategory,
    ]);
  });

  it("puts only the category roles on the profit and loss", () => {
    const pl = EVERY_ROLE.filter(isProfitAndLossRole);
    expect(pl).toEqual([
      AccountRole.ExpenseCategory,
      AccountRole.IncomeCategory,
    ]);
    expect(isProfitAndLossRole(AccountRole.Bank)).toBe(false);
    // A transfer touches two non-category accounts, which is exactly why it can
    // never appear on a profit and loss (FR-007).
    expect(isProfitAndLossRole(AccountRole.Wallet)).toBe(false);
  });
});
