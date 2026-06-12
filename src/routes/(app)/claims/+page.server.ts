import type { PageServerLoad, Actions } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { listClaims, markClaimDone, createClaim, deleteClaim } from '$lib/server/queries/claims.js';
import { listExpenses } from '$lib/server/queries/expenses.js';
import { fail } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const allClaims = listClaims(db, userId);
	const unpaidExpenses = listExpenses(db, userId, { status: 'unpaid', limit: 500 });
	return { claims: allClaims, unpaidExpenses };
};

export const actions: Actions = {
	markDone: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid claim ID' });
		const result = markClaimDone(db, id, userId);
		if (!result) return fail(404, { error: 'Claim not found' });
		return { success: true };
	},

	create: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const date = String(data.get('date') ?? '').trim();
		const idsRaw = String(data.get('expenseIds') ?? '');
		const expenseIds = idsRaw.split(',').map(Number).filter(Boolean);
		if (!date) return fail(400, { error: 'Date is required' });
		if (!expenseIds.length) return fail(400, { error: 'Select at least one expense' });
		createClaim(db, userId, { date, expenseIds });
		return { success: true };
	},

	delete: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid claim ID' });
		const ok = deleteClaim(db, id, userId);
		if (!ok) return fail(404, { error: 'Claim not found' });
		return { success: true };
	}
};
