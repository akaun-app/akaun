import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { groups, groupPermissions, userGroups } from '$lib/server/db/schema.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const groupId = parseInt(params.id);
	const group = db.select().from(groups).where(eq(groups.id, groupId)).get();
	if (!group) return new Response('Not Found', { status: 404 });

	const perms = db.select().from(groupPermissions).where(eq(groupPermissions.groupId, groupId)).all();
	const permGrid: Record<string, { view: boolean; add: boolean; change: boolean; delete: boolean }> = {};
	for (const p of perms) {
		permGrid[p.resource] = { view: !!p.canView, add: !!p.canAdd, change: !!p.canChange, delete: !!p.canDelete };
	}

	const memberCount = db.select({ userId: userGroups.userId }).from(userGroups).where(eq(userGroups.groupId, groupId)).all().length;

	return json({
		id: group.id,
		name: group.name,
		description: group.description,
		isSuperuser: !!group.isSuperuser,
		locked: group.name === 'Administrators',
		permissions: permGrid,
		memberCount
	});
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const groupId = parseInt(params.id);
	const group = db.select().from(groups).where(eq(groups.id, groupId)).get();
	if (!group) return new Response('Not Found', { status: 404 });
	if (group.name === 'Administrators') {
		return json({ error: 'Administrators group cannot be modified' }, { status: 400 });
	}

	const body = await request.json();
	const patch: Record<string, unknown> = {};
	if (body.name !== undefined) patch.name = body.name;
	if (body.description !== undefined) patch.description = body.description;
	if (body.isSuperuser !== undefined) patch.isSuperuser = body.isSuperuser;

	if (Object.keys(patch).length > 0) {
		db.update(groups).set(patch).where(eq(groups.id, groupId)).run();
	}

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const groupId = parseInt(params.id);
	const group = db.select().from(groups).where(eq(groups.id, groupId)).get();
	if (!group) return new Response('Not Found', { status: 404 });
	if (group.name === 'Administrators') {
		return json({ error: 'Administrators group cannot be deleted' }, { status: 400 });
	}

	const members = db.select({ userId: userGroups.userId }).from(userGroups).where(eq(userGroups.groupId, groupId)).all();
	if (members.length > 0) {
		return json({ error: 'Cannot delete a group with members. Remove all members first.' }, { status: 400 });
	}

	db.delete(groups).where(eq(groups.id, groupId)).run();
	return json({ success: true });
};
