import { json } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { convertToInvoice } from '$lib/server/services/quotations.js';
import { getQuotation } from '$lib/server/queries/quotations.js';
import { getInvoice } from '$lib/server/queries/invoices.js';
import { hasPermission } from '$lib/server/permissions.js';

export const POST: RequestHandler = async ({ locals, params }) => {
	// Requires only invoices:add to convert
	if (!hasPermission(locals, 'invoices', 'add')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const result = convertToInvoice(db, id, user.id);
	if (!result.ok) {
		if (result.reason === 'not_found') return Response.json({ error: 'Quotation not found' }, { status: 404 });
		if (result.reason === 'already_converted') return Response.json({ error: 'Quotation is already converted to an invoice.' }, { status: 409 });
	}

	const quotation = getQuotation(db, result.quotationId!);
	const invoice = getInvoice(db, result.invoiceId!);
	return json({ quotation, invoice }, { status: 201 });
};
