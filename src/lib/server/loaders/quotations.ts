import type { Actions } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listQuotations } from '$lib/server/queries/quotations.js';
import { removeQuotation } from '$lib/server/services/quotations.js';
import { QuotationStatus } from '$lib/enums.js';
import { fail, redirect } from '@sveltejs/kit';
import { hasPermission } from '$lib/server/permissions.js';

export function loadQuotationsPage(locals: App.Locals, openQuotationId: number | null) {
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

	if (openQuotationId !== null && !allQuotations.some((q) => q.id === openQuotationId)) {
		throw redirect(302, '/quotations');
	}

	return { quotations: allQuotations, counts, openQuotationId };
}

export const quotationsActions: Actions = {
	delete: async ({ locals, request }) => {
		if (!hasPermission(locals, 'quotations', 'delete')) return fail(403, { error: 'Forbidden' });
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? '0'));
		if (!id) return fail(400, { error: 'Invalid quotation' });
		const result = removeQuotation(db, id);
		if (!result.ok) {
			if (result.reason === 'converted')
				return fail(409, { error: 'Converted quotations cannot be deleted.' });
			return fail(404, { error: 'Not found' });
		}
		return { success: true };
	}
};
