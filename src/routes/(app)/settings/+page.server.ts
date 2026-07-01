import type { PageServerLoad, Actions } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { listTemplates } from '$lib/server/queries/templates.js';
import { getSetting, setSetting, SETTING_KEYS, hasAnyDocuments } from '$lib/server/settings.js';
import { getCategories, saveCategories as saveCategoriesDB } from '$lib/server/queries/categories.js';
import { DEFAULT_SEQUENCE_TEMPLATE, validateTemplate } from '$lib/sequence-template.js';
import {
	getAllProviders,
	insertProvider,
	updateProvider,
	deleteProvider,
	reorderProviders
} from '$lib/server/llmProviders.js';
import type { ProviderType } from '$lib/server/import/providers/index.js';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
	const expenseCategories = getCategories(db, 'expense');
	const incomeCategories = getCategories(db, 'income');
	const sequenceTemplate = getSetting(db, SETTING_KEYS.sequenceTemplate) ?? DEFAULT_SEQUENCE_TEMPLATE;
	const currency = getSetting(db, SETTING_KEYS.currencyCode) ?? 'USD';
	const locked = hasAnyDocuments(db);
	const currencyLocked = locked;
	const sequenceTemplateLocked = locked;

	const autoImportParallelTasks = parseInt(
		getSetting(db, SETTING_KEYS.autoImportParallelTasks) ?? '3',
		10
	);
	const autoImportCategoryHints =
		(getSetting(db, SETTING_KEYS.autoImportCategoryHints) ?? 'true') === 'true';
	const autoImportRateLimitMs = parseInt(
		getSetting(db, SETTING_KEYS.autoImportRateLimitMs) ?? '0',
		10
	);
	const autoImportCustomInstructions = getSetting(db, SETTING_KEYS.autoImportCustomInstructions) ?? '';

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
		sequenceTemplate,
		currency,
		currencyLocked,
		sequenceTemplateLocked,
		username: locals.user!.username,
		autoImportParallelTasks,
		autoImportCategoryHints,
		autoImportRateLimitMs,
		autoImportCustomInstructions,
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

		if (code) {
			const currentCode = getSetting(db, SETTING_KEYS.currencyCode) ?? 'USD';
			if (hasAnyDocuments(db)) {
				if (code !== currentCode) {
					return fail(400, {
						error: 'Currency is locked once any document exists — changing it would corrupt historical amounts.'
					});
				}
			} else if (/^[A-Z]{3}$/.test(code)) {
				setSetting(db, SETTING_KEYS.currencyCode, code);
			}
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
			const expCats = [...new Set((JSON.parse(expRaw) as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim()))];
			const incCats = [...new Set((JSON.parse(incRaw) as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((s) => s.trim()))];
			if (expCats.length === 0 || incCats.length === 0) return fail(400, { error: 'At least one category per type is required' });
			saveCategoriesDB(db, 'expense', expCats);
			saveCategoriesDB(db, 'income', incCats);
			return { success: true, action: 'saveCategories' };
		} catch {
			return fail(400, { error: 'Invalid categories data' });
		}
	},

	saveSequenceTemplate: async ({ request }) => {
		if (hasAnyDocuments(db)) {
			return fail(400, {
				error: 'Sequence number format is locked once any document exists — changing it would break historical document numbering.'
			});
		}
		const data = await request.formData();
		const template = String(data.get('template') ?? '').trim();
		const err = validateTemplate(template);
		if (err) return fail(400, { error: err });
		setSetting(db, SETTING_KEYS.sequenceTemplate, template);
		return { success: true, action: 'saveSequenceTemplate' };
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
		const rateLimitMs = Math.min(
			30000,
			Math.max(0, parseInt(String(data.get('rateLimitMs') ?? '0'), 10) || 0)
		);
		const customInstructions = String(data.get('customInstructions') ?? '').trim().slice(0, 2000);

		setSetting(db, SETTING_KEYS.autoImportParallelTasks, String(parallelTasks));
		setSetting(db, SETTING_KEYS.autoImportCategoryHints, String(categoryHints));
		setSetting(db, SETTING_KEYS.autoImportRateLimitMs, String(rateLimitMs));
		setSetting(db, SETTING_KEYS.autoImportCustomInstructions, customInstructions);

		return { success: true, action: 'saveIntelligenceGlobal' };
	},

	saveAdvanced: async ({ request }) => {
		const data = await request.formData();
		const godMode = data.get('godMode') === 'true';
		setSetting(db, SETTING_KEYS.godModeEnabled, String(godMode));
		return { success: true };
	}
};
