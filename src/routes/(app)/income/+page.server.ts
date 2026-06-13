import type { PageServerLoad, Actions } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { listIncomes } from '$lib/server/queries/income.js';
import { createIncome } from '$lib/server/services/income.js';
import { getSetting, SETTING_KEYS } from '$lib/server/settings.js';
import { fail } from '@sveltejs/kit';

const DEFAULT_INCOME_CATEGORIES = [
	'Client Project',
	'Product Sales',
	'Consulting',
	'Salary',
	'Investment',
	'Rental',
	'Other'
];

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const allIncomes = listIncomes(db, userId, { limit: 1000 });

	const catSetting = getSetting(db, userId, SETTING_KEYS.incomeCategories);
	const categories: string[] = catSetting ? JSON.parse(catSetting) : DEFAULT_INCOME_CATEGORIES;

	const now = new Date();
	const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	const qStart = `${now.getFullYear()}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;

	const stats = {
		thisMonth: allIncomes.filter((i) => i.date.startsWith(monthKey)).reduce((s, i) => s + i.amount, 0),
		thisQuarter: allIncomes.filter((i) => i.date >= qStart).reduce((s, i) => s + i.amount, 0),
		largest: allIncomes.length > 0 ? Math.max(...allIncomes.map((i) => i.amount)) : 0,
		allTotal: allIncomes.reduce((s, i) => s + i.amount, 0),
		count: allIncomes.length
	};

	return { incomes: allIncomes, categories, stats };
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const source = String(data.get('source') ?? '').trim();
		const category = String(data.get('category') ?? 'Other').trim();
		const date = String(data.get('date') ?? '').trim();
		const amount = parseFloat(String(data.get('amount') ?? '0'));
		const reference = String(data.get('reference') ?? '').trim();
		const descriptionText = String(data.get('descriptionText') ?? '').trim();

		if (!source) return fail(400, { error: 'Source is required' });
		if (!date) return fail(400, { error: 'Date is required' });
		if (isNaN(amount) || amount <= 0) return fail(400, { error: 'Valid amount is required' });

		const income = createIncome(db, userId, { source, category, date, amount, reference, descriptionText });

		return { success: true, id: income.id };
	}
};
