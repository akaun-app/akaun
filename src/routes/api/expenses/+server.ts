import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listExpenses } from '$lib/server/queries/expenses.js';
import { createExpense } from '$lib/server/services/expenses.js';

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = locals.user!;
	const p = url.searchParams;

	const amountMinRaw = p.get('amountMin');
	const amountMaxRaw = p.get('amountMax');
	const limitRaw = p.get('limit');
	const offsetRaw = p.get('offset');

	const results = listExpenses(db, user.id, {
		status: p.get('status') ?? undefined,
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
	const user = locals.user!;
	const body = await request.json();

	if (!body.itemName || body.amount == null) {
		return Response.json({ error: 'itemName and amount are required' }, { status: 400 });
	}

	const expense = createExpense(db, user.id, {
		itemName: body.itemName,
		supplier: body.supplier,
		reference: body.reference,
		remark: body.remark,
		category: body.category,
		status: body.status,
		date: body.date ?? new Date().toISOString().slice(0, 10),
		amount: body.amount
	});

	return Response.json(expense, { status: 201 });
};
