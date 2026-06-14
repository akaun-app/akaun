import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getClaim } from '$lib/server/queries/claims.js';
import { patchClaim, removeClaim } from '$lib/server/services/claims.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'claims', 'view')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const claim = getClaim(db, id, user.id);
	if (!claim) return Response.json({ error: 'Not found' }, { status: 404 });

	return Response.json(claim);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'claims', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const body = await request.json();
	const patch: { status?: string; date?: string } = {};
	if (body.status !== undefined) patch.status = body.status;
	if (body.date !== undefined) patch.date = body.date;

	const updated = patchClaim(db, id, user.id, patch);
	if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });

	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'claims', 'delete')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const deleted = removeClaim(db, id, user.id);
	if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });

	return new Response(null, { status: 204 });
};
