import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listIncomes } from '$lib/server/queries/income.js';
import { resolveOrCreateContact } from '$lib/server/queries/contacts.js';
import { createIncome } from '$lib/server/services/income.js';
import { hasPermission } from '$lib/server/permissions.js';
import { isValidDate, today } from '$lib/server/date.js';
import { Role } from '$lib/enums.js';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!hasPermission(locals, 'income', 'view')) return new Response('Forbidden', { status: 403 });
	const p = url.searchParams;

	const amountMinRaw = p.get('amountMin');
	const amountMaxRaw = p.get('amountMax');
	const limitRaw = p.get('limit');
	const offsetRaw = p.get('offset');

	const results = listIncomes(db, {
		category: p.get('category') ?? undefined,
		dateFrom: p.get('dateFrom') ?? undefined,
		dateTo: p.get('dateTo') ?? undefined,
		amountMin: amountMinRaw ? parseFloat(amountMinRaw) : undefined,
		amountMax: amountMaxRaw ? parseFloat(amountMaxRaw) : undefined,
		search: p.get('search') ?? undefined,
		limit: limitRaw ? parseInt(limitRaw) : undefined,
		offset: offsetRaw ? parseInt(offsetRaw) : undefined
	});

	return Response.json(results);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!hasPermission(locals, 'income', 'add')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const body = await request.json();

	if (body.amount == null) {
		return Response.json({ error: 'amount is required' }, { status: 400 });
	}

	if (body.date !== undefined && !isValidDate(body.date)) {
		return Response.json({ error: 'date must be in YYYY-MM-DD format' }, { status: 400 });
	}

	// Resolve the customer party: numeric contactId bypasses; raw `source` name
	// is matched-then-created among Role.Customer contacts.
	let contactId: number | null = null;
	if (typeof body.contactId === 'number') {
		contactId = body.contactId;
	} else if (typeof body.source === 'string' && body.source.trim()) {
		contactId = resolveOrCreateContact(db, body.source, Role.Customer, user.id);
	}

	const income = createIncome(db, user.id, {
		contactId,
		descriptionText: body.descriptionText,
		reference: body.reference,
		remark: body.remark,
		category: body.category,
		date: body.date ?? today(),
		amount: body.amount
	});

	return Response.json(income, { status: 201 });
};
