import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getClaim } from '$lib/server/queries/claims.js';
import { patchClaim, removeClaim } from '$lib/server/services/claims.js';
import { hasPermission } from '$lib/server/permissions.js';
import { isValidDate } from '$lib/server/date.js';
import { canEditClaimData } from '$lib/server/locking.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'claims', 'view')) return new Response('Forbidden', { status: 403 });
	const id = parseInt(params.id!);

	const claim = getClaim(db, id);
	if (!claim) return Response.json({ error: 'Not found' }, { status: 404 });

	return Response.json(claim);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'claims', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const claim = getClaim(db, id);
	if (!claim) return Response.json({ error: 'Not found' }, { status: 404 });

	const body = await request.json();
	const patch: { status?: number; date?: string; expenseIds?: number[] } = {};
	if (body.status !== undefined) patch.status = Number(body.status);
	if (body.date !== undefined) {
		if (!isValidDate(body.date)) {
			return Response.json({ error: 'date must be in YYYY-MM-DD format' }, { status: 400 });
		}
		patch.date = body.date;
	}
	if (body.expenseIds !== undefined) {
		patch.expenseIds = (body.expenseIds as unknown[]).map(Number).filter(Boolean);
	}

	// Editing a reconciled claim's date or linked expenses is never allowed.
	if ((patch.date !== undefined || patch.expenseIds !== undefined) && !canEditClaimData(claim)) {
		return Response.json(
			{ error: 'This claim is reimbursed and its date/expenses can no longer be edited.' },
			{ status: 403 }
		);
	}

	const updated = patchClaim(db, id, user.id, patch);
	if (!updated) return Response.json({ error: 'Not found' }, { status: 404 });

	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'claims', 'delete')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);

	const claim = getClaim(db, id);
	if (!claim) return Response.json({ error: 'Not found' }, { status: 404 });

	if (!canEditClaimData(claim)) {
		return Response.json(
			{ error: 'This claim is reimbursed and cannot be deleted.' },
			{ status: 403 }
		);
	}

	const deleted = removeClaim(db, id, user.id);
	if (!deleted) return Response.json({ error: 'Not found' }, { status: 404 });

	return new Response(null, { status: 204 });
};
