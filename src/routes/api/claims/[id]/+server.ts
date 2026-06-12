import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getClaim, updateClaim, deleteClaim } from '$lib/server/queries/claims.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	const user = locals.user!;
	const id = parseInt(params.id!);

	const claim = getClaim(db, id, user.id);
	if (!claim) return Response.json({ error: 'Not found' }, { status: 404 });

	return Response.json(claim);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const user = locals.user!;
	const id = parseInt(params.id!);

	const body = await request.json();
	const patch: Record<string, unknown> = {};
	if (body.status !== undefined) patch.status = body.status;
	if (body.date !== undefined) patch.date = body.date;

	const updated = updateClaim(db, id, user.id, patch);
	if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });

	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const user = locals.user!;
	const id = parseInt(params.id!);

	const deleted = deleteClaim(db, id, user.id);
	if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });

	return new Response(null, { status: 204 });
};
