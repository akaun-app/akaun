import type { Actions } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getQuotation, listQuotations } from '$lib/server/queries/quotations.js';
import { removeQuotation } from '$lib/server/services/quotations.js';
import { QuotationStatus } from '$lib/enums.js';
import { fail, redirect } from '@sveltejs/kit';
import { hasPermission } from '$lib/server/permissions.js';

export function loadQuotationsPage(locals: App.Locals) {
	if (!hasPermission(locals, 'quotations', 'view')) throw redirect(302, '/dashboard');
	const allQuotations = listQuotations(db, { limit: 1000 });

	const counts = { all: 0, draft: 0, sent: 0, accepted: 0, declined: 0, converted: 0 };
	allQuotations.forEach((q) => {
		counts.all++;
		if (q.status === QuotationStatus.Draft) counts.draft++;
		else if (q.status === QuotationStatus.Sent) counts.sent++;
		else if (q.status === QuotationStatus.Accepted) counts.accepted++;
		else if (q.status === QuotationStatus.Declined) counts.declined++;
		else if (q.status === QuotationStatus.Converted) counts.converted++;
	});

	return {
		quotations: allQuotations,
		counts,
		perms: { add: hasPermission(locals, 'quotations', 'add') }
	};
}

/**
 * The blank form, for `/quotations/new`.
 *
 * Gated on `add`, not `view` — a create page's whole reason to exist fails
 * without it, so a user who lacks it is sent back rather than shown a form
 * that would 403 on submit.
 */
export function loadQuotationNew(locals: App.Locals) {
	if (!hasPermission(locals, 'quotations', 'add')) throw redirect(302, '/quotations');
	return {};
}

/**
 * One quotation, for `/quotations/[id]`.
 *
 * Server-rendered with its line items, which the drawer used to fetch after
 * opening — so the table a reader came for arrived a moment after the panel.
 */
export function loadQuotationDetail(locals: App.Locals, id: number) {
	if (!hasPermission(locals, 'quotations', 'view')) throw redirect(302, '/dashboard');

	const quotation = getQuotation(db, id);
	if (!quotation) throw redirect(302, '/quotations');

	return {
		quotation,
		perms: {
			change: hasPermission(locals, 'quotations', 'change'),
			delete: hasPermission(locals, 'quotations', 'delete')
		}
	};
}

export const quotationsActions: Actions = {
	delete: async ({ locals, request }) => {
		if (!hasPermission(locals, 'quotations', 'delete')) return fail(403, { error: 'Forbidden' });
		const userId = locals.user!.id;
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid quotation' });
		const result = removeQuotation(db, id, userId);
		if (!result.ok) {
			if (result.reason === 'converted')
				return fail(409, { error: 'Converted quotations cannot be deleted.' });
			return fail(404, { error: 'Not found' });
		}
		return { success: true };
	}
};
