import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getContact, getContactUsageCounts } from '$lib/server/queries/contacts.js';
import { hasPermission } from '$lib/server/permissions.js';

// Backs the manual multi-select merge flow: an arbitrary, user-picked id list
// has no pre-computed cluster, so the comparison view fetches contacts + usage here.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!hasPermission(locals, 'contacts', 'change') || !hasPermission(locals, 'contacts', 'delete')) {
		return new Response('Forbidden', { status: 403 });
	}
	const body = await request.json();
	const contactIds: number[] = Array.isArray(body.contactIds) ? body.contactIds.map(Number) : [];
	if (contactIds.length < 2 || contactIds.some(Number.isNaN)) {
		return Response.json({ error: 'Need at least 2 valid contactIds' }, { status: 400 });
	}

	const usage = getContactUsageCounts(db, contactIds);
	const contacts = contactIds
		.map((id) => getContact(db, id))
		.filter((c): c is NonNullable<typeof c> => c !== null)
		.map((c) => ({ ...c, usage: usage[c.id] ?? { expenses: 0, incomes: 0 } }));

	if (contacts.length < 2) {
		return Response.json({ error: 'Fewer than 2 contacts found' }, { status: 404 });
	}
	return Response.json({ contacts });
};
