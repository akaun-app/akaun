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

	const expCatRaw = getSetting(db, SETTING_KEYS.expenseCategories);
	const incCatRaw = getSetting(db, SETTING_KEYS.incomeCategories);
	const currency = getSetting(db, SETTING_KEYS.currencyCode) ?? 'MYR';

	const expenseCategories: string[] = expCatRaw ? JSON.parse(expCatRaw) : DEFAULT_EXPENSE_CATEGORIES;
	const incomeCategories: string[] = incCatRaw ? JSON.parse(incCatRaw) : DEFAULT_INCOME_CATEGORIES;

	const autoImportApiKey = getSetting(db, SETTING_KEYS.autoImportApiKey) ?? '';
	const autoImportModel = getSetting(db, SETTING_KEYS.autoImportModel) ?? 'anthropic/claude-3.5-sonnet';
	const autoImportParallelTasks = parseInt(getSetting(db, SETTING_KEYS.autoImportParallelTasks) ?? '3', 10);
	const autoImportCategoryHints = (getSetting(db, SETTING_KEYS.autoImportCategoryHints) ?? 'true') === 'true';

	const godModeEnabled = (getSetting(db, SETTING_KEYS.godModeEnabled) ?? 'false') === 'true';

	return {
		expenseCategories,
		incomeCategories,
		currency,
		username: locals.user!.username,
		autoImportApiKey,
		autoImportModel,
		autoImportParallelTasks,
		autoImportCategoryHints,
		godModeEnabled
	};
};

export const actions: Actions = {
	saveExpenseCategories: async ({ locals, request }) => {
		const data = await request.formData();
		const raw = String(data.get('categories') ?? '[]');
		try {
			const cats = JSON.parse(raw);
			if (!Array.isArray(cats)) throw new Error('not array');
			setSetting(db, SETTING_KEYS.expenseCategories, JSON.stringify(cats));
			return { success: true };
		} catch {
			return fail(400, { error: 'Invalid categories data' });
		}
	},

	saveIncomeCategories: async ({ locals, request }) => {
		const data = await request.formData();
		const raw = String(data.get('categories') ?? '[]');
		try {
			const cats = JSON.parse(raw);
			if (!Array.isArray(cats)) throw new Error('not array');
			setSetting(db, SETTING_KEYS.incomeCategories, JSON.stringify(cats));
			return { success: true };
		} catch {
			return fail(400, { error: 'Invalid categories data' });
		}
	},

	saveIntelligence: async ({ locals, request }) => {
		const data = await request.formData();

		const apiKey = String(data.get('apiKey') ?? '').trim();
		const model = String(data.get('model') ?? 'anthropic/claude-3.5-sonnet').trim();
		const parallelTasks = Math.min(10, Math.max(1, parseInt(String(data.get('parallelTasks') ?? '3'), 10)));
		const categoryHints = data.get('categoryHints') === 'true';

		if (!model) return fail(400, { error: 'Model is required' });

		if (apiKey) setSetting(db, SETTING_KEYS.autoImportApiKey, apiKey);
		setSetting(db, SETTING_KEYS.autoImportModel, model);
		setSetting(db, SETTING_KEYS.autoImportParallelTasks, String(parallelTasks));
		setSetting(db, SETTING_KEYS.autoImportCategoryHints, String(categoryHints));

		return { success: true };
	},

	saveAdvanced: async ({ locals, request }) => {
		const data = await request.formData();
		const godMode = data.get('godMode') === 'true';
		setSetting(db, SETTING_KEYS.godModeEnabled, String(godMode));
		return { success: true };
	},

};
