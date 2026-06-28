import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { convertToInvoice } from '$lib/server/services/quotations.js';
import { hasPermission } from '$lib/server/permissions.js';

export const POST: RequestHandler = async ({ locals, params }) => {
	// Requires both quotations:change and invoices:add
	if (!hasPermission(locals, 'quotations', 'change')) return new Response('Forbidden', { status: 403 });
	if (!hasPermission(locals, 'invoices', 'add')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const result = convertToInvoice(db, id, user.id);
	if (!result.ok) {
		if (result.reason === 'not_found') return Response.json({ error: 'Quotation not found' }, { status: 404 });
		if (result.reason === 'already_converted') return Response.json({ error: 'Quotation is already converted to an invoice.' }, { status: 409 });
	}
	return Response.json({ quotationId: result.quotationId, invoiceId: result.invoiceId }, { status: 201 });
};
