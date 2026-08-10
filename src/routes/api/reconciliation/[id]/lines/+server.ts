import type { RequestHandler } from './$types.js';
import { z } from 'zod';
import { StatementDirection } from '$lib/enums.js';
import { db } from '$lib/server/db/client.js';
import { isValidDate } from '$lib/server/date.js';
import { hasPermission } from '$lib/server/permissions.js';
import {
	addLineManually,
	getSessionLines,
	ReconciliationError
} from '$lib/server/services/reconciliation.js';

const LineSchema = z.object({
	date: z.string().refine(isValidDate, 'date must be in YYYY-MM-DD format'),
	description: z.string().max(500).default(''),
	amount: z.number().finite().positive(),
	direction: z.union([z.literal(StatementDirection.In), z.literal(StatementDirection.Out)]),
	note: z.string().max(500).default('')
});

function idFrom(value: string | undefined): number | null {
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
}

function failure(error: unknown): Response {
	if (error instanceof ReconciliationError) {
		return Response.json({ error: error.message }, { status: error.status });
	}
	throw error;
}

export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'reconciliation', 'view')) return new Response('Forbidden', { status: 403 });
	const id = idFrom(params.id);
	if (!id) return Response.json({ error: 'Not found' }, { status: 404 });
	try {
		return Response.json({ lines: getSessionLines(db, locals, id) });
	} catch (error) {
		return failure(error);
	}
};

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'reconciliation', 'change')) return new Response('Forbidden', { status: 403 });
	const id = idFrom(params.id);
	if (!id) return Response.json({ error: 'Not found' }, { status: 404 });
	const parsed = LineSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
	try {
		return Response.json(addLineManually(db, locals, id, parsed.data), { status: 201 });
	} catch (error) {
		return failure(error);
	}
};
