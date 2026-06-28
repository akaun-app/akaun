import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listInvoices } from '$lib/server/queries/invoices.js';
import { createInvoice } from '$lib/server/services/invoices.js';
import { hasPermission } from '$lib/server/permissions.js';
import { isValidDate } from '$lib/server/date.js';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!hasPermission(locals, 'invoices', 'view')) return new Response('Forbidden', { status: 403 });
	const p = url.searchParams;
	const statusRaw = p.get('status');
	const contactIdRaw = p.get('contactId');
	const limitRaw = p.get('limit');
	const offsetRaw = p.get('offset');

	const results = listInvoices(db, {
		status: statusRaw ? parseInt(statusRaw) : undefined,
		contactId: contactIdRaw ? parseInt(contactIdRaw) : undefined,
		overdueOnly: p.get('overdueOnly') === 'true' ? true : undefined,
		search: p.get('search') ?? undefined,
		dateFrom: p.get('dateFrom') ?? undefined,
		dateTo: p.get('dateTo') ?? undefined,
		limit: limitRaw ? parseInt(limitRaw) : undefined,
		offset: offsetRaw ? parseInt(offsetRaw) : undefined
	});
	return Response.json(results);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!hasPermission(locals, 'invoices', 'add')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const body = await request.json();

	if (!body.issueDate || !isValidDate(body.issueDate)) {
		return Response.json({ error: 'issueDate is required (YYYY-MM-DD)' }, { status: 400 });
	}
	if (!Array.isArray(body.lines) || body.lines.length === 0) {
		return Response.json({ error: 'lines must be a non-empty array' }, { status: 400 });
	}

	const invoice = createInvoice(db, user.id, {
		contactId: body.contactId ?? null,
		reference: body.reference ?? null,
		issueDate: body.issueDate,
		dueDate: body.dueDate ?? null,
		currency: body.currency,
		exchangeRate: body.exchangeRate,
		notes: body.notes ?? null,
		terms: body.terms ?? null,
		lines: body.lines,
		sourceQuotationId: body.sourceQuotationId ?? null
	});
	return Response.json(invoice, { status: 201 });
};
