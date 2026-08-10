import type { RequestHandler } from './$types.js';
import { z } from 'zod';
import { LeftoverAnnotation, ReconItemType } from '$lib/enums.js';
import { db } from '$lib/server/db/client.js';
import { hasPermission } from '$lib/server/permissions.js';
import { ReconciliationError, setAnnotation } from '$lib/server/services/reconciliation.js';

const AnnotationSchema = z.object({
	itemType: z.union([
		z.literal(ReconItemType.Expense),
		z.literal(ReconItemType.Claim),
		z.literal(ReconItemType.Income)
	]),
	itemId: z.number().int().positive(),
	annotation: z.union([
		z.literal(LeftoverAnnotation.NotYetCleared),
		z.literal(LeftoverAnnotation.WillNotClear),
		z.null()
	]),
	note: z.string().max(500).optional()
});

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'reconciliation', 'change')) return new Response('Forbidden', { status: 403 });
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'Not found' }, { status: 404 });
	const parsed = AnnotationSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
	try {
		return Response.json(
			setAnnotation(
				db,
				locals,
				id,
				parsed.data.itemType,
				parsed.data.itemId,
				parsed.data.annotation,
				parsed.data.note
			)
		);
	} catch (error) {
		if (error instanceof ReconciliationError) {
			return Response.json({ error: error.message }, { status: error.status });
		}
		throw error;
	}
};
