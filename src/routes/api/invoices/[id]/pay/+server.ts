import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { payInvoice } from '$lib/server/services/invoices.js';
import { getInvoice } from '$lib/server/queries/invoices.js';
import { getIncome } from '$lib/server/queries/income.js';
import { hasPermission } from '$lib/server/permissions.js';

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'invoices', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const result = payInvoice(db, id, user.id);
	if (!result.ok) {
		if (result.reason === 'not_found') return Response.json({ error: 'Invoice not found' }, { status: 404 });
		if (result.reason === 'already_paid') return Response.json({ error: 'Invoice is already paid.' }, { status: 409 });
	}

	const invoice = getInvoice(db, result.invoiceId!);
	const income = result.incomeId ? getIncome(db, result.incomeId) : null;
	return json({ invoice, income }, { status: 200 });
};
