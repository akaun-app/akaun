import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getInvoice } from '$lib/server/queries/invoices.js';
import { canEditInvoice } from '$lib/server/locking.js';
import { patchInvoice, removeInvoice } from '$lib/server/services/invoices.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'invoices', 'view')) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);
	const invoice = getInvoice(db, id);
	if (!invoice) return Response.json({ error: 'Not found' }, { status: 404 });
	return Response.json(invoice);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'invoices', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const invoice = getInvoice(db, id);
	if (!invoice) return Response.json({ error: 'Not found' }, { status: 404 });

	if (!canEditInvoice(invoice)) {
		return Response.json({ error: 'Paid or cancelled invoices cannot be edited.' }, { status: 409 });
	}

	const body = await request.json();
	const patch: Record<string, unknown> = {};
	const fields = ['contactId', 'reference', 'issueDate', 'dueDate', 'currency', 'exchangeRate', 'notes', 'terms', 'status', 'lines'];
	for (const f of fields) {
		if (body[f] !== undefined) patch[f] = body[f];
	}

	const updated = patchInvoice(db, id, user.id, patch);
	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'invoices', 'delete')) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);

	const result = removeInvoice(db, id);
	if (!result.ok) {
		if (result.reason === 'not_found') return Response.json({ error: 'Not found' }, { status: 404 });
		if (result.reason === 'paid') return Response.json({ error: 'Paid invoices cannot be deleted.' }, { status: 409 });
	}
	return new Response(null, { status: 204 });
};
