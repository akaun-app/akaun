import { describe, expect, it } from "vitest";
import { AccountSubType, AccountType } from "$lib/enums.js";
import type { AccountView } from "$lib/server/ledger/types.js";
import {
  defaultTargetForImportSource,
  groupImportSourceAccounts,
  syncImportAccountSelection,
  targetAccountsForImportSource,
} from "./import-account-groups.js";

function account(
  id: number,
  type: number,
  subType: number | null,
): AccountView {
  return { id, type, subType } as AccountView;
}

describe("Auto Import direction-driven account groups", () => {
  it("offers revenue and safe payment accounts as sources", () => {
    const bank = account(1, AccountType.Asset, AccountSubType.Bank);
    const payable = account(
      2,
      AccountType.Liability,
      AccountSubType.AccountsPayable,
    );
    const creditCard = account(
      3,
      AccountType.Liability,
      AccountSubType.CreditCard,
    );
    const loan = account(
      4,
      AccountType.Liability,
      AccountSubType.ShortTermLoan,
    );
    const revenue = account(
      5,
      AccountType.Revenue,
      AccountSubType.OperatingRevenue,
    );

    const groups = groupImportSourceAccounts(
      [bank, payable, creditCard, loan, revenue],
      payable.id,
    );

    expect(groups.income).toEqual([revenue]);
    expect(groups.payment).toEqual([bank, payable, creditCard]);
  });

  it("narrows an income target to receipt accounts", () => {
    const revenue = account(
      1,
      AccountType.Revenue,
      AccountSubType.OperatingRevenue,
    );
    const bank = account(2, AccountType.Asset, AccountSubType.Bank);
    const receivable = account(3, AccountType.Asset, AccountSubType.Receivable);
    const inventory = account(4, AccountType.Asset, AccountSubType.Inventory);

    expect(
      targetAccountsForImportSource(
        [revenue, bank, receivable, inventory],
        revenue.id,
        null,
        receivable.id,
      ),
    ).toEqual([bank, receivable]);
  });

  it("narrows a purchase target and keeps assets separate from expenses", () => {
    const bank = account(1, AccountType.Asset, AccountSubType.Bank);
    const fixedAsset = account(2, AccountType.Asset, AccountSubType.FixedAsset);
    const expense = account(
      3,
      AccountType.Expense,
      AccountSubType.OperatingExpense,
    );
    const revenue = account(
      4,
      AccountType.Revenue,
      AccountSubType.OperatingRevenue,
    );

    const targets = targetAccountsForImportSource(
      [bank, fixedAsset, expense, revenue],
      bank.id,
      null,
      null,
    );

    expect(targets).toEqual([fixedAsset, expense]);
  });

  it("defaults corrected directions to unpaid receivable or uncategorised expense", () => {
    const revenue = account(
      1,
      AccountType.Revenue,
      AccountSubType.OperatingRevenue,
    );
    const payable = account(
      2,
      AccountType.Liability,
      AccountSubType.AccountsPayable,
    );

    expect(
      defaultTargetForImportSource([revenue, payable], revenue.id, 8, 9),
    ).toBe(8);
    expect(
      defaultTargetForImportSource([revenue, payable], payable.id, 8, 9),
    ).toBe(9);
  });

  it("replaces an untouched fallback with live LLM detection but preserves reviewer edits", () => {
    const otherExpenses = 9;
    const equipment = 12;
    const reviewerChoice = 14;

    expect(syncImportAccountSelection(otherExpenses, equipment, false)).toBe(
      equipment,
    );
    expect(syncImportAccountSelection(reviewerChoice, equipment, true)).toBe(
      reviewerChoice,
    );
  });
});
