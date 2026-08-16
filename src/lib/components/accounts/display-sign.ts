import { AccountRole, type AccountRoleCode } from '$lib/enums.js';

// Mirrors src/lib/server/ledger/account-type.ts's displaySign — under the one
// sign convention (positive when value goes into an account) money we owe,
// income earned and owner capital all accumulate at a negative balance, and a
// reader expects to see "we owe 1,200", not "-1,200". Money a partner takes out
// is the exception among the owners' accounts: it accumulates positive and
// reads positive.
//
// Hand-duplicated because $lib/server is stripped from client code at build
// time. Keep the two in step when the rule changes — there is no shared import
// to enforce it (CLAUDE.md § Gotchas).
const NEGATIVE_BY_NATURE = new Set<number>([
	AccountRole.Payable,
	AccountRole.IncomeCategory,
	AccountRole.OpeningBalances,
	AccountRole.PartnerCapital
]);

export function displaySignFor(role: number): 1 | -1 {
	return NEGATIVE_BY_NATURE.has(role) ? -1 : 1;
}

export function isCategoryRole(role: number): boolean {
	return role === AccountRole.ExpenseCategory || role === AccountRole.IncomeCategory;
}

export function isSharedOwedRole(role: number): boolean {
	return role === AccountRole.Receivable || role === AccountRole.Payable;
}

/** Every place money actually sits — what "how much do we hold?" adds up. */
export function isMoneyPotRole(role: number): boolean {
	return (
		role === AccountRole.Bank ||
		role === AccountRole.Wallet ||
		role === AccountRole.Cash ||
		role === AccountRole.Card
	);
}

export type { AccountRoleCode };
