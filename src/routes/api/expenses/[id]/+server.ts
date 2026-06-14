import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getExpense } from '$lib/server/queries/expenses.js';
import { canEditAmount, canEditDescriptive } from '$lib/server/locking.js';
import { getSetting, SETTING_KEYS } from '$lib/server/settings.js';
import { patchExpense, removeExpense } from '$lib/server/services/expenses.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'expenses', 'view')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const expense = getExpense(db, id, user.id);
	if (!expense) return Response.json({ error: 'Not found' }, { status: 404 });

	return Response.json(expense);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'expenses', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const expense = getExpense(db, id, user.id);
	if (!expense) return Response.json({ error: 'Not found' }, { status: 404 });

	const body = await request.json();
	const godModeRaw = getSetting(db, user.id, SETTING_KEYS.godModeEnabled);
	const godMode = godModeRaw === 'true';

	if (body.amount !== undefined && !canEditAmount(expense)) {
		return Response.json({ error: 'Amount cannot be edited on a claimed expense' }, { status: 403 });
	}

	const descriptiveFields = ['itemName', 'supplier', 'reference', 'remark', 'category', 'date'];
	const editingDescriptive = descriptiveFields.some((f) => body[f] !== undefined);
	if (editingDescriptive && !canEditDescriptive(expense, godMode)) {
		return Response.json(
			{ error: 'Descriptive fields are locked. Enable God Mode to override.' },
			{ status: 403 }
		);
	}

	const patch: Record<string, unknown> = {};
	for (const field of [...descriptiveFields, 'amount', 'status']) {
		if (body[field] !== undefined) patch[field] = body[field];
	}

	const updated = patchExpense(db, id, user.id, patch);

	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'expenses', 'delete')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const deleted = removeExpense(db, id, user.id);
	if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });

	return new Response(null, { status: 204 });
};
