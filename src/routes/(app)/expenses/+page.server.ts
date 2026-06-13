import type { PageServerLoad, Actions } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { listExpenses } from '$lib/server/queries/expenses.js';
import { createExpense, patchExpense } from '$lib/server/services/expenses.js';
import { createClaim } from '$lib/server/services/claims.js';
import { getSetting, SETTING_KEYS } from '$lib/server/settings.js';
import { fail } from '@sveltejs/kit';

const DEFAULT_CATEGORIES = [
	'Food & Beverage',
	'Transport',
	'Accommodation',
	'Equipment',
	'Software & Subscriptions',
	'Office Supplies',
	'Marketing',
	'Professional Services',
	'Other'
];

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const allExpenses = listExpenses(db, userId, { limit: 1000 });

	const counts = { all: allExpenses.length, unpaid: 0, pending: 0, paid: 0 };
	allExpenses.forEach((e) => {
		if (e.status === 'unpaid') counts.unpaid++;
		else if (e.status === 'pending') counts.pending++;
		else if (e.status === 'paid') counts.paid++;
	});

	const catSetting = getSetting(db, userId, SETTING_KEYS.expenseCategories);
	const categories: string[] = catSetting ? JSON.parse(catSetting) : DEFAULT_CATEGORIES;

	return { expenses: allExpenses, counts, categories };
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const itemName = String(data.get('itemName') ?? '').trim();
		const supplier = String(data.get('supplier') ?? '').trim();
		const category = String(data.get('category') ?? 'Other').trim();
		const date = String(data.get('date') ?? '').trim();
		const amount = parseFloat(String(data.get('amount') ?? '0'));
		const reference = String(data.get('reference') ?? '').trim();
		const remark = String(data.get('remark') ?? '').trim();

		if (!itemName) return fail(400, { error: 'Item name is required' });
		if (!date) return fail(400, { error: 'Date is required' });
		if (isNaN(amount) || amount <= 0) return fail(400, { error: 'Valid amount is required' });

		const expense = createExpense(db, userId, { itemName, supplier, category, date, amount, reference, remark });

		return { success: true, id: expense.id };
	},

	markPaid: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const ids = String(data.get('ids') ?? '').split(',').map(Number).filter(Boolean);
		for (const id of ids) {
			patchExpense(db, id, userId, { status: 'paid' });
		}
		return { success: true };
	},

	createClaim: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const ids = String(data.get('ids') ?? '').split(',').map(Number).filter(Boolean);
		const date = new Date().toISOString().slice(0, 10);
		createClaim(db, userId, { date, expenseIds: ids });
		return { success: true };
	}
};
