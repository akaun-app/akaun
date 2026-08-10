import type { RequestHandler } from './$types.js';
import { z } from 'zod';
import { StatementDirection } from '$lib/enums.js';
import { db } from '$lib/server/db/client.js';
import { isValidDate } from '$lib/server/date.js';
import { hasPermission } from '$lib/server/permissions.js';
import {
	deleteLine,
	ReconciliationError,
	updateLine
} from '$lib/server/services/reconciliation.js';

const PatchLineSchema = z
	.object({
		date: z.string().refine(isValidDate, 'date must be in YYYY-MM-DD format').optional(),
		description: z.string().max(500).optional(),
		amount: z.number().finite().positive().optional(),
		direction: z.union([z.literal(StatementDirection.In), z.literal(StatementDirection.Out)]).optional(),
		note: z.string().max(500).optional()
	})
	.refine((value) => Object.values(value).some((entry) => entry !== undefined), {
		message: 'At least one field is required'
	});

function ids(params: { id?: string; lineId?: string }): { id: number; lineId: number } | null {
	const id = Number(params.id);
	const lineId = Number(params.lineId);
	return Number.isInteger(id) && id > 0 && Number.isInteger(lineId) && lineId > 0 ? { id, lineId } : null;
}

function failure(error: unknown): Response {
	if (error instanceof ReconciliationError) return Response.json({ error: error.message }, { status: error.status });
	throw error;
}

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'reconciliation', 'change')) return new Response('Forbidden', { status: 403 });
	const parsedIds = ids(params);
	if (!parsedIds) return Response.json({ error: 'Not found' }, { status: 404 });
	const parsed = PatchLineSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
	try {
		return Response.json(updateLine(db, locals, parsedIds.id, parsedIds.lineId, parsed.data));
	} catch (error) {
		return failure(error);
	}
};

export const DELETE: RequestHandler = ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'reconciliation', 'delete')) return new Response('Forbidden', { status: 403 });
	const parsedIds = ids(params);
	if (!parsedIds) return Response.json({ error: 'Not found' }, { status: 404 });
	try {
		deleteLine(db, locals, parsedIds.id, parsedIds.lineId);
		return new Response(null, { status: 204 });
	} catch (error) {
		return failure(error);
	}
};
