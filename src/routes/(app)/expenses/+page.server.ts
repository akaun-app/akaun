import type { PageServerLoad, Actions } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { listExpenses } from '$lib/server/queries/expenses.js';
import { resolveOrCreateContact } from '$lib/server/queries/contacts.js';
import { createExpense, patchExpense } from '$lib/server/services/expenses.js';
import { createClaim } from '$lib/server/services/claims.js';
import { getSetting, SETTING_KEYS } from '$lib/server/settings.js';
import { ExpenseStatus, Role } from '$lib/enums.js';
import { fail, redirect } from '@sveltejs/kit';
import { hasPermission } from '$lib/server/permissions.js';

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
	if (!hasPermission(locals, 'expenses', 'view')) throw redirect(302, '/dashboard');
	const allExpenses = listExpenses(db, { limit: 1000 });

	const counts = { all: allExpenses.length, unpaid: 0, pending: 0, paid: 0 };
	allExpenses.forEach((e) => {
		if (e.status === ExpenseStatus.Unpaid) counts.unpaid++;
		else if (e.status === ExpenseStatus.Pending) counts.pending++;
		else if (e.status === ExpenseStatus.Paid) counts.paid++;
	});

	const catSetting = getSetting(db, SETTING_KEYS.expenseCategories);
	const categories: string[] = catSetting ? JSON.parse(catSetting) : DEFAULT_CATEGORIES;

	return { expenses: allExpenses, counts, categories };
};

/** Resolve the submitted contact intent (numeric id or a typed new name) → contactId. */
function resolveContactFromForm(data: FormData, userId: number): number | null {
	const contactIdRaw = String(data.get('contactId') ?? '').trim();
	const newName = String(data.get('newContactName') ?? '').trim();
	if (contactIdRaw) return parseInt(contactIdRaw);
	if (newName) return resolveOrCreateContact(db, newName, Role.Supplier, userId);
	return null;
}

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const itemName = String(data.get('itemName') ?? '').trim();
		const category = String(data.get('category') ?? 'Other').trim();
		const date = String(data.get('date') ?? '').trim();
		const amount = parseFloat(String(data.get('amount') ?? '0'));
		const reference = String(data.get('reference') ?? '').trim();
		const remark = String(data.get('remark') ?? '').trim();

		if (!itemName) return fail(400, { error: 'Item name is required' });
		if (!date) return fail(400, { error: 'Date is required' });
		if (isNaN(amount) || amount <= 0) return fail(400, { error: 'Valid amount is required' });

		const contactId = resolveContactFromForm(data, userId);
		const expense = createExpense(db, userId, {
			itemName,
			contactId,
			category,
			date,
			amount,
			reference,
			remark
		});

		return { success: true, id: expense.id };
	},

	markPaid: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const ids = String(data.get('ids') ?? '').split(',').map(Number).filter(Boolean);
		for (const id of ids) {
			patchExpense(db, id, userId, { status: ExpenseStatus.Paid });
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
