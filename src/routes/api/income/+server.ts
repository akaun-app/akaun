import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listIncomes } from '$lib/server/queries/income.js';
import { createIncome } from '$lib/server/services/income.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!hasPermission(locals, 'income', 'view')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const p = url.searchParams;

	const amountMinRaw = p.get('amountMin');
	const amountMaxRaw = p.get('amountMax');
	const limitRaw = p.get('limit');
	const offsetRaw = p.get('offset');

	const results = listIncomes(db, user.id, {
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

	const income = createIncome(db, user.id, {
		source: body.source,
		descriptionText: body.descriptionText,
		reference: body.reference,
		remark: body.remark,
		category: body.category,
		date: body.date ?? new Date().toISOString().slice(0, 10),
		amount: body.amount
	});

	return Response.json(income, { status: 201 });
};
