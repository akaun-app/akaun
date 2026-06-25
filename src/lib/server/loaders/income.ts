import type { Actions } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listIncomes } from '$lib/server/queries/income.js';
import { resolveOrCreateContact } from '$lib/server/queries/contacts.js';
import { createIncome, removeIncome } from '$lib/server/services/income.js';
import { getSetting, SETTING_KEYS } from '$lib/server/settings.js';
import { resolveRecordCurrency } from '$lib/server/currency/form.js';
import { Role } from '$lib/enums.js';
import { fail, redirect } from '@sveltejs/kit';
import { hasPermission } from '$lib/server/permissions.js';

const DEFAULT_INCOME_CATEGORIES = [
	'Client Project',
	'Product Sales',
	'Consulting',
	'Salary',
	'Investment',
	'Rental',
	'Other'
];

export function loadIncomePage(locals: App.Locals, openIncomeId: number | null) {
	if (!hasPermission(locals, 'income', 'view')) throw redirect(302, '/dashboard');
	const allIncomes = listIncomes(db, { limit: 1000 });

	const catSetting = getSetting(db, SETTING_KEYS.incomeCategories);
	const categories: string[] = catSetting ? JSON.parse(catSetting) : DEFAULT_INCOME_CATEGORIES;

	const now = new Date();
	const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
	const qStart = `${now.getFullYear()}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2, '0')}-01`;

	const stats = {
		thisMonth: allIncomes.filter((i) => i.date.startsWith(monthKey)).reduce((s, i) => s + i.mainAmount, 0),
		thisQuarter: allIncomes.filter((i) => i.date >= qStart).reduce((s, i) => s + i.mainAmount, 0),
		largest: allIncomes.length > 0 ? Math.max(...allIncomes.map((i) => i.mainAmount)) : 0,
		allTotal: allIncomes.reduce((s, i) => s + i.mainAmount, 0),
		count: allIncomes.length
	};

	if (openIncomeId !== null && !allIncomes.some((i) => i.id === openIncomeId)) {
		throw redirect(302, '/income');
	}

	return { incomes: allIncomes, categories, stats, openIncomeId };
}

export const incomeActions: Actions = {
	create: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const category = String(data.get('category') ?? 'Other').trim();
		const date = String(data.get('date') ?? '').trim();
		const amount = parseFloat(String(data.get('amount') ?? '0'));
		const reference = String(data.get('reference') ?? '').trim();
		const descriptionText = String(data.get('descriptionText') ?? '').trim();

		// Customer party: numeric contactId or a typed new name.
		const contactIdRaw = String(data.get('contactId') ?? '').trim();
		const newName = String(data.get('newContactName') ?? '').trim();
		let contactId: number | null = null;
		if (contactIdRaw) contactId = parseInt(contactIdRaw);
		else if (newName) contactId = resolveOrCreateContact(db, newName, Role.Customer, userId);

		if (!contactId) return fail(400, { error: 'Customer is required' });
		if (!date) return fail(400, { error: 'Date is required' });
		if (isNaN(amount) || amount <= 0) return fail(400, { error: 'Valid amount is required' });

		const cur = await resolveRecordCurrency(db, data, date);
		if (!cur.ok) return fail(400, { error: cur.message });

		const income = createIncome(db, userId, {
			contactId,
			category,
			date,
			amount,
			currency: cur.currency,
			exchangeRate: cur.exchangeRate,
			reference,
			descriptionText
		});

		return { success: true, id: income.id };
	},

	delete: async ({ locals, request }) => {
		if (!hasPermission(locals, 'income', 'delete')) return fail(403, { error: 'Forbidden' });
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid income' });

		const ok = removeIncome(db, id);
		if (!ok) return fail(404, { error: 'Income not found' });

		return { success: true };
	}
};
