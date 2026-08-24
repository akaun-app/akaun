import {
  AccountSubType,
  AccountType,
  type AccountSubTypeCode,
} from "$lib/enums.js";
import type { AccountView } from "../ledger/types.js";
import { isPurchaseAssetAccount } from "../ledger/account-type.js";

const TRANSACTION_ASSET_SUBTYPES = new Set<AccountSubTypeCode>([
  AccountSubType.Cash,
  AccountSubType.Bank,
  AccountSubType.Wallet,
  AccountSubType.Card,
  AccountSubType.Clearing,
]);

function posting(account: AccountView): boolean {
  return account.postingEligible === true && (account.active ?? true);
}

export function isImportTransactionAsset(account: AccountView): boolean {
  return (
    posting(account) &&
    account.type === AccountType.Asset &&
    account.subType !== null &&
    TRANSACTION_ASSET_SUBTYPES.has(account.subType)
  );
}

export function isImportPurchaseSource(
  account: AccountView,
  payableAccountId: number | null,
): boolean {
  return (
    isImportTransactionAsset(account) ||
    (posting(account) && account.id === payableAccountId) ||
    (posting(account) &&
      account.type === AccountType.Liability &&
      account.subType === AccountSubType.CreditCard)
  );
}

export function isImportPurchaseTarget(account: AccountView): boolean {
  return (
    posting(account) &&
    (account.type === AccountType.Expense || isPurchaseAssetAccount(account))
  );
}

export function isImportIncomeSource(account: AccountView): boolean {
  return posting(account) && account.type === AccountType.Revenue;
}

export function isImportIncomeTarget(
  account: AccountView,
  receivableAccountId: number | null,
): boolean {
  return (
    isImportTransactionAsset(account) ||
    (posting(account) && account.id === receivableAccountId)
  );
}
