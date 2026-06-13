import type { PageServerLoad, Actions } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { getSetting, setSetting, SETTING_KEYS } from '$lib/server/settings.js';
import { fail } from '@sveltejs/kit';

const DEFAULT_EXPENSE_CATEGORIES = [
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

	const expCatRaw = getSetting(db, userId, SETTING_KEYS.expenseCategories);
	const incCatRaw = getSetting(db, userId, SETTING_KEYS.incomeCategories);
	const currency = getSetting(db, userId, SETTING_KEYS.currencyCode) ?? 'MYR';

	const expenseCategories: string[] = expCatRaw ? JSON.parse(expCatRaw) : DEFAULT_EXPENSE_CATEGORIES;
	const incomeCategories: string[] = incCatRaw ? JSON.parse(incCatRaw) : DEFAULT_INCOME_CATEGORIES;

	const autoImportApiKey = getSetting(db, userId, SETTING_KEYS.autoImportApiKey) ?? '';
	const autoImportModel = getSetting(db, userId, SETTING_KEYS.autoImportModel) ?? 'anthropic/claude-3.5-sonnet';
	const autoImportParallelTasks = parseInt(getSetting(db, userId, SETTING_KEYS.autoImportParallelTasks) ?? '3', 10);
	const autoImportCategoryHints = (getSetting(db, userId, SETTING_KEYS.autoImportCategoryHints) ?? 'true') === 'true';

	return {
		expenseCategories,
		incomeCategories,
		currency,
		username: locals.user!.username,
		autoImportApiKey,
		autoImportModel,
		autoImportParallelTasks,
		autoImportCategoryHints
	};
};

export const actions: Actions = {
	saveExpenseCategories: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const raw = String(data.get('categories') ?? '[]');
		try {
			const cats = JSON.parse(raw);
			if (!Array.isArray(cats)) throw new Error('not array');
			setSetting(db, userId, SETTING_KEYS.expenseCategories, JSON.stringify(cats));
			return { success: true };
		} catch {
			return fail(400, { error: 'Invalid categories data' });
		}
	},

	saveIncomeCategories: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const raw = String(data.get('categories') ?? '[]');
		try {
			const cats = JSON.parse(raw);
			if (!Array.isArray(cats)) throw new Error('not array');
			setSetting(db, userId, SETTING_KEYS.incomeCategories, JSON.stringify(cats));
			return { success: true };
		} catch {
			return fail(400, { error: 'Invalid categories data' });
		}
	},

	saveIntelligence: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();

		const apiKey = String(data.get('apiKey') ?? '').trim();
		const model = String(data.get('model') ?? 'anthropic/claude-3.5-sonnet').trim();
		const parallelTasks = Math.min(10, Math.max(1, parseInt(String(data.get('parallelTasks') ?? '3'), 10)));
		const categoryHints = data.get('categoryHints') === 'true';

		if (!model) return fail(400, { error: 'Model is required' });

		if (apiKey) setSetting(db, userId, SETTING_KEYS.autoImportApiKey, apiKey);
		setSetting(db, userId, SETTING_KEYS.autoImportModel, model);
		setSetting(db, userId, SETTING_KEYS.autoImportParallelTasks, String(parallelTasks));
		setSetting(db, userId, SETTING_KEYS.autoImportCategoryHints, String(categoryHints));

		return { success: true };
	}
};
