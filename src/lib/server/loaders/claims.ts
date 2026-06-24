import type { Actions } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listClaims } from '$lib/server/queries/claims.js';
import { listExpenses } from '$lib/server/queries/expenses.js';
import { createClaim, patchClaim, removeClaim } from '$lib/server/services/claims.js';
import { ClaimStatus, ExpenseStatus } from '$lib/enums.js';
import { fail, redirect } from '@sveltejs/kit';
import { hasPermission } from '$lib/server/permissions.js';

export function loadClaimsPage(locals: App.Locals, openClaimId: number | null) {
	if (!hasPermission(locals, 'claims', 'view')) throw redirect(302, '/dashboard');
	const allClaims = listClaims(db);
	const unpaidExpenses = listExpenses(db, { status: ExpenseStatus.Unpaid, limit: 500 });

	if (openClaimId !== null && !allClaims.some((c) => c.id === openClaimId)) {
		throw redirect(302, '/claims');
	}

	return { claims: allClaims, unpaidExpenses, openClaimId };
}

export const claimsActions: Actions = {
	markDone: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid claim ID' });

		const result = patchClaim(db, id, userId, { status: ClaimStatus.Done });
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

		const claim = createClaim(db, userId, { date, expenseIds });

		return { success: true, id: claim.id };
	},

	delete: async ({ locals, request }) => {
		if (!hasPermission(locals, 'claims', 'delete')) return fail(403, { error: 'Forbidden' });
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid claim ID' });

		const ok = removeClaim(db, id);
		if (!ok) return fail(404, { error: 'Claim not found' });

		return { success: true };
	}
};
