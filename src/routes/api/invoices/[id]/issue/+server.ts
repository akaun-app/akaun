import { z } from 'zod';
import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getInvoice } from '$lib/server/queries/invoices.js';
import { issueInvoice } from '$lib/server/services/invoices.js';
import { hasPermission } from '$lib/server/permissions.js';
import { badRequest, forbidden, notFound, refused } from '$lib/server/api-response.js';

/**
 * Sending an invoice. This is the moment it enters the books: the amount goes
 * into Money owed to us tagged with the customer, out of the income account it
 * earns into (FR-018a). Refusing repeats — an already-sent invoice — keeps a
 * double click from recording the same debt twice.
 */

const issueSchema = z.object({
	incomeAccountId: z.number().int().positive().optional()
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'invoices', 'change')) return forbidden();

	// An empty body is the ordinary case — send it into the seeded Sales account.
	const raw = await request.json().catch(() => ({}));
	const parsed = issueSchema.safeParse(raw ?? {});
	if (!parsed.success) return badRequest(parsed.error);

	const id = parseInt(params.id!);
	if (!getInvoice(db, id)) return notFound('That invoice no longer exists.');

	const result = issueInvoice(db, id, locals.user!.id, parsed.data);
	if (!result.ok) return refused(result.reason);

	return Response.json(result.value);
};
