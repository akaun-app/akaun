import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { listClaims } from '$lib/server/queries/claims.js';
import { createClaim } from '$lib/server/services/claims.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = async ({ locals }) => {
	if (!hasPermission(locals, 'claims', 'view')) return new Response('Forbidden', { status: 403 });
	const results = listClaims(db);
	return Response.json(results);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!hasPermission(locals, 'claims', 'add')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const body = await request.json();

	if (!body.date) {
		return Response.json({ error: 'date is required' }, { status: 400 });
	}

	const claim = createClaim(db, user.id, {
		date: body.date,
		expenseIds: Array.isArray(body.expenseIds) ? body.expenseIds : []
	});

	return Response.json(claim, { status: 201 });
};
