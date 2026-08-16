import { AccountRole, AccountType } from "$lib/enums.js";
import type { AccountRoleCode, AccountTypeCode } from "$lib/enums.js";

/**
 * What kind of thing an account is, and which way round a report shows it.
 *
 * An account's type is NEVER stored. It is looked up from the role by the one
 * map below, so the two can never disagree — storing both is exactly the drift
 * FR-006a exists to prevent (D-05).
 */

const TYPE_BY_ROLE: Record<AccountRoleCode, AccountTypeCode> = {
  // Places money sits, and things the business owns and keeps.
  [AccountRole.Bank]: AccountType.Asset,
  [AccountRole.Wallet]: AccountType.Asset,
  [AccountRole.Cash]: AccountType.Asset,
  [AccountRole.Card]: AccountType.Asset,
  [AccountRole.Equipment]: AccountType.Asset,
  // Money owed to us is something the business owns — a promise of cash.
  [AccountRole.Receivable]: AccountType.Asset,
  // Money we owe is the one thing the business owes.
  [AccountRole.Payable]: AccountType.Liability,
  // What the owners have in it.
  [AccountRole.OpeningBalances]: AccountType.Equity,
  [AccountRole.PartnerCapital]: AccountType.Equity,
  [AccountRole.PartnerDrawings]: AccountType.Equity,
  // What everyday screens call a category — the profit and loss is made of these.
  [AccountRole.IncomeCategory]: AccountType.Income,
  [AccountRole.ExpenseCategory]: AccountType.Expense,
};

export function accountTypeFor(role: AccountRoleCode): AccountTypeCode {
  return TYPE_BY_ROLE[role];
}

/**
 * What a report multiplies a balance by before showing it.
 *
 * Under the one sign convention — positive when value goes in — money we owe,
 * income earned and owner capital all accumulate at a negative balance. A
 * reader expects to see "we owe 1,200", not "-1,200", so every report flips
 * those in this one place rather than each report inventing its own rule (D-03).
 *
 * Money a partner takes out is the exception among the owners' accounts: it
 * accumulates positive and reads positive.
 */
const NEGATIVE_BY_NATURE = new Set<AccountRoleCode>([
  AccountRole.Payable,
  AccountRole.IncomeCategory,
  AccountRole.OpeningBalances,
  AccountRole.PartnerCapital,
]);

export function displaySign(role: AccountRoleCode): 1 | -1 {
  return NEGATIVE_BY_NATURE.has(role) ? -1 : 1;
}

/**
 * The two accounts everybody's owed money runs through. A record touching one
 * of them must name who it is owed to or by (FR-008), which is the rule
 * `entry-builder.ts` enforces and `integrity.ts` sweeps for.
 */
export function isSharedOwedRole(role: AccountRoleCode): boolean {
  return role === AccountRole.Receivable || role === AccountRole.Payable;
}

/**
 * Everywhere money actually sits — what "paid from" / "received into" offers,
 * and what "how much do we hold?" adds up.
 *
 * Lives here, beside the other role groupings, because three screens need the
 * same list: the expense/income loader, the settings default-account picker and
 * the import review screen. Three concrete uses is where Principle III says the
 * abstraction is earned.
 */
export const MONEY_POT_ROLES: AccountRoleCode[] = [
  AccountRole.Bank,
  AccountRole.Wallet,
  AccountRole.Cash,
  AccountRole.Card,
];

/** What the everyday screens call a category. */
export function isCategoryRole(role: AccountRoleCode): boolean {
  return (
    role === AccountRole.ExpenseCategory || role === AccountRole.IncomeCategory
  );
}

/**
 * Whether an account belongs on the profit and loss. Only the category roles
 * do, which is precisely why a transfer — two accounts, neither a category —
 * can never show up as income or an expense (FR-007, FR-025).
 */
export function isProfitAndLossRole(role: AccountRoleCode): boolean {
  return isCategoryRole(role);
}

/** Whether an account belongs on the balance sheet: everything that is not a category. */
export function isBalanceSheetRole(role: AccountRoleCode): boolean {
  return !isCategoryRole(role);
}
