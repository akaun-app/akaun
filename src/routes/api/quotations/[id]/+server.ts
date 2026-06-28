import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getQuotation } from '$lib/server/queries/quotations.js';
import { canEditQuotation } from '$lib/server/locking.js';
import { patchQuotation, removeQuotation } from '$lib/server/services/quotations.js';
import { resolveOrCreateContact } from '$lib/server/queries/contacts.js';
import { Role } from '$lib/enums.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'quotations', 'view')) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);
	const quotation = getQuotation(db, id);
	if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 });
	return Response.json(quotation);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'quotations', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const quotation = getQuotation(db, id);
	if (!quotation) return Response.json({ error: 'Not found' }, { status: 404 });

	if (!canEditQuotation(quotation)) {
		return Response.json({ error: 'Converted quotations cannot be edited.' }, { status: 409 });
	}

	const body = await request.json();
	const patch: Record<string, unknown> = {};
	const fields = ['contactId', 'reference', 'issueDate', 'expiryDate', 'currency', 'exchangeRate', 'notes', 'terms', 'status', 'lines'];
	for (const f of fields) {
		if (body[f] !== undefined) patch[f] = body[f];
	}
	if (!patch.contactId && body.newContactName) {
		patch.contactId = resolveOrCreateContact(db, body.newContactName, Role.Customer, user.id);
	}

	const updated = patchQuotation(db, id, user.id, patch);
	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'quotations', 'delete')) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);

	const result = removeQuotation(db, id);
	if (!result.ok) {
		if (result.reason === 'not_found') return Response.json({ error: 'Not found' }, { status: 404 });
		if (result.reason === 'converted') return Response.json({ error: 'Converted quotations cannot be deleted.' }, { status: 409 });
	}
	return new Response(null, { status: 204 });
};
