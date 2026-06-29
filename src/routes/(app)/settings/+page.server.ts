import type { PageServerLoad, Actions } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { listTemplates } from '$lib/server/queries/templates.js';
import { expenses, incomes } from '$lib/server/db/schema.js';
import { getSetting, setSetting, SETTING_KEYS } from '$lib/server/settings.js';
import {
	getAllProviders,
	insertProvider,
	updateProvider,
	deleteProvider,
	reorderProviders
} from '$lib/server/llmProviders.js';
import type { ProviderType } from '$lib/server/import/providers/index.js';
import { fail } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';

function hasAnyTransactions(): boolean {
	const expenseCount = db.select({ n: sql<number>`count(*)` }).from(expenses).get()!.n;
	const incomeCount = db.select({ n: sql<number>`count(*)` }).from(incomes).get()!.n;
	return expenseCount + incomeCount > 0;
}

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
	const currency = getSetting(db, SETTING_KEYS.currencyCode) ?? 'USD';
	const currencyLocked = hasAnyTransactions();

	const expenseCategories: string[] = expCatRaw ? JSON.parse(expCatRaw) : DEFAULT_EXPENSE_CATEGORIES;
	const incomeCategories: string[] = incCatRaw ? JSON.parse(incCatRaw) : DEFAULT_INCOME_CATEGORIES;

	const autoImportParallelTasks = parseInt(
		getSetting(db, SETTING_KEYS.autoImportParallelTasks) ?? '3',
		10
	);
	const autoImportCategoryHints =
		(getSetting(db, SETTING_KEYS.autoImportCategoryHints) ?? 'true') === 'true';

	const godModeEnabled = (getSetting(db, SETTING_KEYS.godModeEnabled) ?? 'false') === 'true';

	const companyName = getSetting(db, SETTING_KEYS.companyName) ?? '';
	const companyAddress = getSetting(db, SETTING_KEYS.companyAddress) ?? '';
	const companyRegistrationNo = getSetting(db, SETTING_KEYS.companyRegistrationNo) ?? '';

	const providers = getAllProviders(db).map((p) => ({
		...p,
		hasApiKey: p.apiKey.length > 0,
		apiKey: '' // never send actual key to browser
	}));

	return {
		expenseCategories,
		incomeCategories,
		currency,
		currencyLocked,
		username: locals.user!.username,
		autoImportParallelTasks,
		autoImportCategoryHints,
		godModeEnabled,
		companyName,
		companyAddress,
		companyRegistrationNo,
		providers,
		templates: listTemplates(db)
	};
};

export const actions: Actions = {
	saveGeneral: async ({ request }) => {
		const data = await request.formData();
		const code = String(data.get('currencyCode') ?? '').trim().toUpperCase();
		const companyName = String(data.get('companyName') ?? '').trim();
		const companyAddress = String(data.get('companyAddress') ?? '').trim();
		const companyRegistrationNo = String(data.get('companyRegistrationNo') ?? '').trim();

		if (!hasAnyTransactions() && /^[A-Z]{3}$/.test(code)) {
			setSetting(db, SETTING_KEYS.currencyCode, code);
		}
		setSetting(db, SETTING_KEYS.companyName, companyName);
		setSetting(db, SETTING_KEYS.companyAddress, companyAddress);
		setSetting(db, SETTING_KEYS.companyRegistrationNo, companyRegistrationNo);

		return { success: true, action: 'saveGeneral' };
	},

	saveCategories: async ({ request }) => {
		const data = await request.formData();
		const expRaw = String(data.get('expenseCategories') ?? '[]');
		const incRaw = String(data.get('incomeCategories') ?? '[]');
		try {
			const expCats = JSON.parse(expRaw);
			const incCats = JSON.parse(incRaw);
			if (!Array.isArray(expCats) || !Array.isArray(incCats)) throw new Error('not array');
			setSetting(db, SETTING_KEYS.expenseCategories, JSON.stringify(expCats));
			setSetting(db, SETTING_KEYS.incomeCategories, JSON.stringify(incCats));
			return { success: true, action: 'saveCategories' };
		} catch {
			return fail(400, { error: 'Invalid categories data' });
		}
	},

	addProvider: async ({ request }) => {
		const data = await request.formData();
		const type = String(data.get('type') ?? '').trim();
		const name = String(data.get('name') ?? '').trim();
		const apiKey = String(data.get('apiKey') ?? '').trim();
		const model = String(data.get('model') ?? '').trim();
		const baseUrl = String(data.get('baseUrl') ?? '').trim() || null;

		const VALID_TYPES: ProviderType[] = ['openrouter', 'google_ai_studio', 'groq'];
		if (!VALID_TYPES.includes(type as ProviderType))
			return fail(400, { error: 'Invalid provider type' });
		if (!name) return fail(400, { error: 'Name is required' });
		if (!model) return fail(400, { error: 'Model is required' });

		insertProvider(db, {
			type: type as ProviderType,
			name,
			apiKey,
			model,
			baseUrl: baseUrl ?? undefined
		});

		return { success: true, action: 'addProvider' };
	},

	updateProvider: async ({ request }) => {
		const data = await request.formData();
		const id = String(data.get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Provider ID is required' });

		const updates: Record<string, unknown> = {};
		const name = String(data.get('name') ?? '').trim();
		const apiKey = String(data.get('apiKey') ?? '').trim();
		const model = String(data.get('model') ?? '').trim();
		const baseUrlRaw = data.get('baseUrl');
		const enabledRaw = data.get('enabled');

		if (name) updates.name = name;
		if (model) updates.model = model;
		if (apiKey) updates.apiKey = apiKey;
		if (baseUrlRaw !== null) updates.baseUrl = String(baseUrlRaw).trim() || null;
		if (enabledRaw !== null) updates.enabled = enabledRaw === 'true';

		updateProvider(db, id, updates as Parameters<typeof updateProvider>[2]);

		return { success: true, action: 'updateProvider' };
	},

	deleteProvider: async ({ request }) => {
		const data = await request.formData();
		const id = String(data.get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Provider ID is required' });

		deleteProvider(db, id);

		return { success: true, action: 'deleteProvider' };
	},

	reorderProviders: async ({ request }) => {
		const data = await request.formData();
		const raw = String(data.get('orderedIds') ?? '[]');
		try {
			const ids = JSON.parse(raw);
			if (!Array.isArray(ids)) throw new Error('not array');
			reorderProviders(db, ids as string[]);
			return { success: true, action: 'reorderProviders' };
		} catch {
			return fail(400, { error: 'Invalid order data' });
		}
	},

	saveIntelligenceGlobal: async ({ request }) => {
		const data = await request.formData();
		const parallelTasks = Math.min(
			10,
			Math.max(1, parseInt(String(data.get('parallelTasks') ?? '3'), 10))
		);
		const categoryHints = data.get('categoryHints') === 'true';

		setSetting(db, SETTING_KEYS.autoImportParallelTasks, String(parallelTasks));
		setSetting(db, SETTING_KEYS.autoImportCategoryHints, String(categoryHints));

		return { success: true, action: 'saveIntelligenceGlobal' };
	},

	saveAdvanced: async ({ request }) => {
		const data = await request.formData();
		const godMode = data.get('godMode') === 'true';
		setSetting(db, SETTING_KEYS.godModeEnabled, String(godMode));
		return { success: true };
	},

};
