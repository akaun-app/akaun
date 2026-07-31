import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getExpense } from '$lib/server/queries/expenses.js';
import { resolveOrCreateContact } from '$lib/server/queries/contacts.js';
import { canEditAmount } from '$lib/server/locking.js';
import { patchExpense, removeExpense } from '$lib/server/services/expenses.js';
import { hasPermission } from '$lib/server/permissions.js';
import { Role } from '$lib/enums.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'expenses', 'view')) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);

	const expense = getExpense(db, id);
	if (!expense) return Response.json({ error: 'Not found' }, { status: 404 });

	return Response.json(expense);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'expenses', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const expense = getExpense(db, id);
	if (!expense) return Response.json({ error: 'Not found' }, { status: 404 });

	const body = await request.json();

	const editsLockedFields =
		body.amount !== undefined ||
		body.status !== undefined ||
		body.currency !== undefined ||
		body.exchangeRate !== undefined;
	if (editsLockedFields && !canEditAmount(expense)) {
		return Response.json(
			{ error: 'Amount and status cannot be edited on a claimed expense' },
			{ status: 403 }
		);
	}

	const descriptiveFields = ['itemName', 'contactId', 'reference', 'remark', 'category', 'date'];
	const patch: Record<string, unknown> = {};
	for (const field of [...descriptiveFields, 'amount', 'status', 'currency', 'exchangeRate']) {
		if (body[field] !== undefined) patch[field] = body[field];
	}
	// Allow a raw supplier name on PATCH too (resolve to a contact).
	if (patch.contactId === undefined && typeof body.supplier === 'string' && body.supplier.trim()) {
		patch.contactId = resolveOrCreateContact(db, body.supplier, Role.Supplier, user.id);
	}

	const updated = patchExpense(db, id, user.id, patch);

	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'expenses', 'delete')) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);

	const expense = getExpense(db, id);
	if (!expense) return Response.json({ error: 'Not found' }, { status: 404 });

	if (!canEditAmount(expense)) {
		return Response.json(
			{
				error: `Expense "${expense.expenseNumber}" is linked to claim ${expense.claimNumber} and cannot be deleted until it's removed from the claim.`
			},
			{ status: 409 }
		);
	}

	removeExpense(db, id, locals.user!.id);
	return new Response(null, { status: 204 });
};
