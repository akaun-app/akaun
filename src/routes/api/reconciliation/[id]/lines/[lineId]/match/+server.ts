import type { RequestHandler } from './$types.js';
import { z } from 'zod';
import { ReconItemType } from '$lib/enums.js';
import { db } from '$lib/server/db/client.js';
import { hasPermission } from '$lib/server/permissions.js';
import {
	acceptMatch,
	ReconciliationError,
	undoMatch
} from '$lib/server/services/reconciliation.js';

const MatchSchema = z.object({
	itemType: z.union([
		z.literal(ReconItemType.Expense),
		z.literal(ReconItemType.Claim),
		z.literal(ReconItemType.Income)
	]),
	itemId: z.number().int().positive()
});

function ids(params: { id?: string; lineId?: string }) {
	const id = Number(params.id);
	const lineId = Number(params.lineId);
	return Number.isInteger(id) && id > 0 && Number.isInteger(lineId) && lineId > 0 ? { id, lineId } : null;
}

function failure(error: unknown): Response {
	if (error instanceof ReconciliationError) return Response.json({ error: error.message }, { status: error.status });
	throw error;
}

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'reconciliation', 'change')) return new Response('Forbidden', { status: 403 });
	const parsedIds = ids(params);
	if (!parsedIds) return Response.json({ error: 'Not found' }, { status: 404 });
	const parsed = MatchSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
	try {
		return Response.json(
			acceptMatch(db, locals, parsedIds.id, parsedIds.lineId, parsed.data.itemType, parsed.data.itemId)
		);
	} catch (error) {
		return failure(error);
	}
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'reconciliation', 'change')) return new Response('Forbidden', { status: 403 });
	const parsedIds = ids(params);
	if (!parsedIds) return Response.json({ error: 'Not found' }, { status: 404 });
	try {
		undoMatch(db, locals, parsedIds.id, parsedIds.lineId);
		return new Response(null, { status: 204 });
	} catch (error) {
		return failure(error);
	}
};
