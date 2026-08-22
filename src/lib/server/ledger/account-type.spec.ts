import { describe, expect, it } from "vitest";
import {
  AccountRole,
  AccountType,
  AccountTypeLabels,
  type AccountRoleCode,
} from "$lib/enums.js";
import {
  accountTypeFor,
  accountTypeForLegacyRole,
  financialStatementFor,
  normalBalanceFor,
} from "./account-type.js";

describe("fixed account types", () => {
  it("AccountType_WhenEnumerated_ShouldContainExactlyFiveStableTypes", () => {
    expect(AccountType).toEqual({
      Asset: 1,
      Liability: 2,
      Equity: 3,
      Revenue: 4,
      Expense: 5,
    });
    expect(AccountTypeLabels).toEqual({
      1: "asset",
      2: "liability",
      3: "equity",
      4: "revenue",
      5: "expense",
    });
  });

  it("NormalBalance_WhenTypeVaries_ShouldFollowAccountingRules", () => {
    expect(normalBalanceFor(AccountType.Asset)).toBe("debit");
    expect(normalBalanceFor(AccountType.Expense)).toBe("debit");
    expect(normalBalanceFor(AccountType.Liability)).toBe("credit");
    expect(normalBalanceFor(AccountType.Equity)).toBe("credit");
    expect(normalBalanceFor(AccountType.Revenue)).toBe("credit");
  });

  it("FinancialStatement_WhenTypeVaries_ShouldUseFixedPlacement", () => {
    expect(financialStatementFor(AccountType.Asset)).toBe("balance_sheet");
    expect(financialStatementFor(AccountType.Liability)).toBe("balance_sheet");
    expect(financialStatementFor(AccountType.Equity)).toBe("balance_sheet");
    expect(financialStatementFor(AccountType.Revenue)).toBe("income_statement");
    expect(financialStatementFor(AccountType.Expense)).toBe("income_statement");
  });
});

describe("legacy role conversion", () => {
  it("LegacyRole_WhenConverted_ShouldMapEveryRetiredRoleDeterministically", () => {
    const expected = new Map<AccountRoleCode, number>([
      [AccountRole.Bank, AccountType.Asset],
      [AccountRole.Wallet, AccountType.Asset],
      [AccountRole.Cash, AccountType.Asset],
      [AccountRole.Card, AccountType.Asset],
      [AccountRole.Equipment, AccountType.Asset],
      [AccountRole.Receivable, AccountType.Asset],
      [AccountRole.Payable, AccountType.Liability],
      [AccountRole.OpeningBalances, AccountType.Equity],
      [AccountRole.PartnerCapital, AccountType.Equity],
      [AccountRole.PartnerDrawings, AccountType.Equity],
      [AccountRole.IncomeCategory, AccountType.Revenue],
      [AccountRole.ExpenseCategory, AccountType.Expense],
    ]);

    for (const [role, type] of expected) {
      expect(accountTypeForLegacyRole(role)).toBe(type);
      expect(accountTypeFor(role)).toBe(type);
    }
  });
});
