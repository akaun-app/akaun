import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listExpenses } from '$lib/server/queries/expenses.js';
import { resolveOrCreateContact } from '$lib/server/queries/contacts.js';
import { createExpense } from '$lib/server/services/expenses.js';
import { hasPermission } from '$lib/server/permissions.js';
import { isValidDate, today } from '$lib/server/date.js';
import { Role } from '$lib/enums.js';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!hasPermission(locals, 'expenses', 'view')) return new Response('Forbidden', { status: 403 });
	const p = url.searchParams;

	const amountMinRaw = p.get('amountMin');
	const amountMaxRaw = p.get('amountMax');
	const limitRaw = p.get('limit');
	const offsetRaw = p.get('offset');
	const statusRaw = p.get('status');

	const results = listExpenses(db, {
		status: statusRaw ? parseInt(statusRaw) : undefined,
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
	if (!hasPermission(locals, 'expenses', 'add')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const body = await request.json();

	if (!body.itemName || body.amount == null) {
		return Response.json({ error: 'itemName and amount are required' }, { status: 400 });
	}

	if (body.date !== undefined && !isValidDate(body.date)) {
		return Response.json({ error: 'date must be in YYYY-MM-DD format' }, { status: 400 });
	}

	// Resolve the supplier party: a numeric contactId bypasses resolution; a raw
	// `supplier` name is matched-then-created among Role.Supplier contacts.
	let contactId: number | null = null;
	if (typeof body.contactId === 'number') {
		contactId = body.contactId;
	} else if (typeof body.supplier === 'string' && body.supplier.trim()) {
		contactId = resolveOrCreateContact(db, body.supplier, Role.Supplier, user.id);
	}

	const expense = createExpense(db, user.id, {
		itemName: body.itemName,
		contactId,
		reference: body.reference,
		remark: body.remark,
		category: body.category,
		status: body.status,
		date: body.date ?? today(),
		amount: body.amount
	});

	return Response.json(expense, { status: 201 });
};
