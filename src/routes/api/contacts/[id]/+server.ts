import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getContact } from '$lib/server/queries/contacts.js';
import { patchContact, deactivateContact, deleteContact } from '$lib/server/services/contacts.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'contacts', 'view')) return new Response('Not Found', { status: 404 });
	const id = parseInt(params.id!);
	const contact = getContact(db, id);
	if (!contact) return Response.json({ error: 'Not found' }, { status: 404 });
	return Response.json(contact);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'contacts', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);
	if (!getContact(db, id)) return Response.json({ error: 'Not found' }, { status: 404 });

	const body = await request.json();
	const patch: Record<string, unknown> = {};
	for (const f of ['entityType', 'legalName', 'registrationNo', 'email', 'phone', 'address', 'remark', 'isActive']) {
		if (body[f] !== undefined) patch[f] = body[f];
	}

	const updated = patchContact(db, id, user.id, patch);
	return Response.json(updated);
};

export const DELETE: RequestHandler = async ({ locals, params, url }) => {
	if (!hasPermission(locals, 'contacts', 'delete')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);
	if (!getContact(db, id)) return Response.json({ error: 'Not found' }, { status: 404 });

	if (url.searchParams.get('hard') === '1') {
		const ok = deleteContact(db, id);
		if (!ok) {
			return Response.json(
				{ error: 'Contact is referenced by existing records; deactivate instead.' },
				{ status: 409 }
			);
		}
		return new Response(null, { status: 204 });
	}

	// Soft delete (default): deactivate.
	deactivateContact(db, id, user.id);
	return new Response(null, { status: 204 });
};
