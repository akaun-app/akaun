import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listQuotations } from '$lib/server/queries/quotations.js';
import { createQuotation } from '$lib/server/services/quotations.js';
import { resolveOrCreateContact } from '$lib/server/queries/contacts.js';
import { Role } from '$lib/enums.js';
import { hasPermission } from '$lib/server/permissions.js';
import { isValidDate } from '$lib/server/date.js';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!hasPermission(locals, 'quotations', 'view')) return new Response('Forbidden', { status: 403 });
	const p = url.searchParams;
	const statusRaw = p.get('status');
	const contactIdRaw = p.get('contactId');
	const limitRaw = p.get('limit');
	const offsetRaw = p.get('offset');

	const results = listQuotations(db, {
		status: statusRaw ? parseInt(statusRaw) : undefined,
		contactId: contactIdRaw ? parseInt(contactIdRaw) : undefined,
		search: p.get('search') ?? undefined,
		dateFrom: p.get('dateFrom') ?? undefined,
		dateTo: p.get('dateTo') ?? undefined,
		limit: limitRaw ? parseInt(limitRaw) : undefined,
		offset: offsetRaw ? parseInt(offsetRaw) : undefined
	});
	return Response.json(results);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!hasPermission(locals, 'quotations', 'add')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const body = await request.json();

	if (!body.issueDate || !isValidDate(body.issueDate)) {
		return Response.json({ error: 'issueDate is required (YYYY-MM-DD)' }, { status: 400 });
	}
	if (!Array.isArray(body.lines) || body.lines.length === 0) {
		return Response.json({ error: 'lines must be a non-empty array' }, { status: 400 });
	}

	let contactId: number | null = body.contactId ?? null;
	if (!contactId && body.newContactName) {
		contactId = resolveOrCreateContact(db, body.newContactName, Role.Customer, user.id);
	}

	const quotation = createQuotation(db, user.id, {
		contactId,
		reference: body.reference ?? null,
		issueDate: body.issueDate,
		expiryDate: body.expiryDate ?? null,
		currency: body.currency,
		exchangeRate: body.exchangeRate,
		notes: body.notes ?? null,
		terms: body.terms ?? null,
		lines: body.lines
	});
	return Response.json(quotation, { status: 201 });
};
