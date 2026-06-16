import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getIncome } from '$lib/server/queries/income.js';
import { resolveOrCreateContact } from '$lib/server/queries/contacts.js';
import { patchIncome, removeIncome } from '$lib/server/services/income.js';
import { hasPermission } from '$lib/server/permissions.js';
import { Role } from '$lib/enums.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'income', 'view')) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);

	const income = getIncome(db, id);
	if (!income) return Response.json({ error: 'Not found' }, { status: 404 });

	return Response.json(income);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'income', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const income = getIncome(db, id);
	if (!income) return Response.json({ error: 'Not found' }, { status: 404 });

	const body = await request.json();
	const patch: Record<string, unknown> = {};
	for (const field of ['contactId', 'descriptionText', 'reference', 'remark', 'category', 'date', 'amount']) {
		if (body[field] !== undefined) patch[field] = body[field];
	}
	if (patch.contactId === undefined && typeof body.source === 'string' && body.source.trim()) {
		patch.contactId = resolveOrCreateContact(db, body.source, Role.Customer, user.id);
	}

	const updated = patchIncome(db, id, user.id, patch);

	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'income', 'delete')) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);

	const deleted = removeIncome(db, id);
	if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });

	return new Response(null, { status: 204 });
};
