import type { RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { getContact, getContactRoles } from '$lib/server/queries/contacts.js';
import { replaceContactRoles } from '$lib/server/services/contacts.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!hasPermission(locals, 'contacts', 'view')) return new Response('Not Found', { status: 404 });
	const id = parseInt(params.id!);
	if (!getContact(db, id)) return Response.json({ error: 'Not found' }, { status: 404 });
	return Response.json({ roles: getContactRoles(db, id) });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!hasPermission(locals, 'contacts', 'change')) return new Response('Forbidden', { status: 403 });
	const user = locals.user!;
	const id = parseInt(params.id!);
	if (!getContact(db, id)) return Response.json({ error: 'Not found' }, { status: 404 });

	const body = await request.json();
	const roles = Array.isArray(body.roles) ? body.roles.map(Number) : [];
	const contact = replaceContactRoles(db, id, user.id, roles);
	return Response.json(contact);
};
