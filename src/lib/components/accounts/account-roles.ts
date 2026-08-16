import { AccountRole, type AccountRoleCode } from '$lib/enums.js';

/**
 * How the chart of accounts talks about itself on screen.
 *
 * The labels here are the everyday words, not the accounting ones (Principle
 * VII): a person picking where their money sits should not have to know what an
 * "asset" is. The technical role codes keep their own names in `enums.ts`.
 */
export const ROLE_LABELS: Record<AccountRoleCode, string> = {
	[AccountRole.Bank]: 'Bank account',
	[AccountRole.Wallet]: 'Wallet',
	[AccountRole.Cash]: 'Cash',
	[AccountRole.Card]: 'Card',
	[AccountRole.Equipment]: 'Equipment',
	[AccountRole.Receivable]: 'Money owed to us',
	[AccountRole.Payable]: 'Money we owe',
	[AccountRole.OpeningBalances]: 'Opening balances',
	[AccountRole.PartnerCapital]: 'Money put in',
	[AccountRole.PartnerDrawings]: 'Money taken out',
	[AccountRole.ExpenseCategory]: 'Expense category',
	[AccountRole.IncomeCategory]: 'Income category'
};

export function roleLabel(role: number): string {
	return ROLE_LABELS[role as AccountRoleCode] ?? 'Account';
}

/**
 * The kinds someone may create, in the order the picker offers them. Mirrors
 * CREATABLE_ROLES in src/routes/api/accounts/+server.ts, which is the rule —
 * the shared owed accounts and Opening balances are seeded once, and a
 * partner's pair comes from granting that contact the Partner role.
 */
export const CREATABLE_ROLES: AccountRoleCode[] = [
	AccountRole.Bank,
	AccountRole.Wallet,
	AccountRole.Cash,
	AccountRole.Card,
	AccountRole.Equipment,
	AccountRole.ExpenseCategory,
	AccountRole.IncomeCategory
];

/** How the chart of accounts groups its rows, top to bottom. */
export const ROLE_GROUPS: { title: string; sub: string; roles: AccountRoleCode[] }[] = [
	{
		title: 'Where the money is',
		sub: 'Every place the business holds money',
		roles: [AccountRole.Bank, AccountRole.Wallet, AccountRole.Cash, AccountRole.Card]
	},
	{
		title: 'What the business owns',
		sub: 'Things bought and kept, rather than used up',
		roles: [AccountRole.Equipment]
	},
	{
		title: 'Owed either way',
		sub: 'What people owe the business, and what it owes them',
		roles: [AccountRole.Receivable, AccountRole.Payable]
	},
	{
		title: 'The owners',
		sub: 'What each partner has put in and taken out',
		roles: [
			AccountRole.OpeningBalances,
			AccountRole.PartnerCapital,
			AccountRole.PartnerDrawings
		]
	},
	{
		title: 'Expense categories',
		sub: 'What money is spent on',
		roles: [AccountRole.ExpenseCategory]
	},
	{
		title: 'Income categories',
		sub: 'Where money is earned from',
		roles: [AccountRole.IncomeCategory]
	}
];
