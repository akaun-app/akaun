import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getIncome } from '$lib/server/queries/income.js';
import { patchIncome, removeIncome } from '$lib/server/services/income.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	const user = locals.user!;
	const id = parseInt(params.id!);

	const income = getIncome(db, id, user.id);
	if (!income) return Response.json({ error: 'Not found' }, { status: 404 });

	return Response.json(income);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = locals.user!;
	const id = parseInt(params.id!);

	const income = getIncome(db, id, user.id);
	if (!income) return Response.json({ error: 'Not found' }, { status: 404 });

	const body = await request.json();
	const patch: Record<string, unknown> = {};
	for (const field of ['source', 'descriptionText', 'reference', 'remark', 'category', 'date', 'amount']) {
		if (body[field] !== undefined) patch[field] = body[field];
	}

	const updated = patchIncome(db, id, user.id, patch);

	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = locals.user!;
	const id = parseInt(params.id!);

	const deleted = removeIncome(db, id, user.id);
	if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });

	return new Response(null, { status: 204 });
};
