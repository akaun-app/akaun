import { describe, expect, it } from "vitest";
import { AccountSubType, AccountType } from "$lib/enums.js";
import type { AccountView } from "../ledger/types.js";
import {
  isImportIncomeSource,
  isImportIncomeTarget,
  isImportPurchaseSource,
  isImportPurchaseTarget,
} from "./account-policy.js";

function account(
  id: number,
  type: number,
  subType: number | null,
  postingEligible = true,
): AccountView {
  return { id, type, subType, postingEligible, active: true } as AccountView;
}

describe("auto-import account policy", () => {
  const bank = account(1, AccountType.Asset, AccountSubType.Bank);
  const clearing = account(2, AccountType.Asset, AccountSubType.Clearing);
  const inventory = account(3, AccountType.Asset, AccountSubType.Inventory);
  const fixedAsset = account(4, AccountType.Asset, AccountSubType.FixedAsset);
  const intangible = account(
    5,
    AccountType.Asset,
    AccountSubType.IntangibleAsset,
  );
  const receivable = account(6, AccountType.Asset, AccountSubType.Receivable);
  const payable = account(
    7,
    AccountType.Liability,
    AccountSubType.AccountsPayable,
  );
  const creditCard = account(
    8,
    AccountType.Liability,
    AccountSubType.CreditCard,
  );
  const loan = account(9, AccountType.Liability, AccountSubType.ShortTermLoan);
  const expense = account(
    10,
    AccountType.Expense,
    AccountSubType.OperatingExpense,
  );
  const revenue = account(
    11,
    AccountType.Revenue,
    AccountSubType.OperatingRevenue,
  );

  it("offers safe purchase funding accounts", () => {
    expect(isImportPurchaseSource(bank, payable.id)).toBe(true);
    expect(isImportPurchaseSource(clearing, payable.id)).toBe(true);
    expect(isImportPurchaseSource(payable, payable.id)).toBe(true);
    expect(isImportPurchaseSource(creditCard, payable.id)).toBe(true);
    expect(isImportPurchaseSource(loan, payable.id)).toBe(false);
    expect(isImportPurchaseSource(inventory, payable.id)).toBe(false);
  });

  it("offers expenses and purchasable assets as purchase targets", () => {
    expect(isImportPurchaseTarget(expense)).toBe(true);
    expect(isImportPurchaseTarget(inventory)).toBe(true);
    expect(isImportPurchaseTarget(fixedAsset)).toBe(true);
    expect(isImportPurchaseTarget(intangible)).toBe(true);
    expect(isImportPurchaseTarget(bank)).toBe(false);
    expect(isImportPurchaseTarget(receivable)).toBe(false);
  });

  it("offers revenue into transaction assets or the configured receivable", () => {
    expect(isImportIncomeSource(revenue)).toBe(true);
    expect(isImportIncomeSource(expense)).toBe(false);
    expect(isImportIncomeTarget(bank, receivable.id)).toBe(true);
    expect(isImportIncomeTarget(clearing, receivable.id)).toBe(true);
    expect(isImportIncomeTarget(receivable, receivable.id)).toBe(true);
    expect(isImportIncomeTarget(inventory, receivable.id)).toBe(false);
  });

  it("never offers headings", () => {
    expect(
      isImportPurchaseTarget(
        account(20, AccountType.Asset, AccountSubType.FixedAsset, false),
      ),
    ).toBe(false);
  });
});
