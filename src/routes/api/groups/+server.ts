import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { db } from '$lib/server/db/client.js';
import { groups, groupPermissions, userGroups } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

function buildGroupResponse(groupRow: typeof groups.$inferSelect) {
	const perms = db
		.select()
		.from(groupPermissions)
		.where(eq(groupPermissions.groupId, groupRow.id))
		.all();

	const permGrid: Record<string, { view: boolean; add: boolean; change: boolean; delete: boolean }> = {};
	for (const p of perms) {
		permGrid[p.resource] = {
			view: !!p.canView,
			add: !!p.canAdd,
			change: !!p.canChange,
			delete: !!p.canDelete
		};
	}

	const memberCount = db
		.select({ userId: userGroups.userId })
		.from(userGroups)
		.where(eq(userGroups.groupId, groupRow.id))
		.all().length;

	return {
		id: groupRow.id,
		name: groupRow.name,
		description: groupRow.description,
		isSuperuser: !!groupRow.isSuperuser,
		locked: groupRow.name === 'Administrators',
		permissions: permGrid,
		memberCount
	};
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const allGroups = db.select().from(groups).all();
	return json(allGroups.map(buildGroupResponse));
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const body = await request.json();
	const { name, description = '', isSuperuser = false } = body;
	if (!name) return json({ error: 'name is required' }, { status: 400 });

	const [group] = db
		.insert(groups)
		.values({ name, description, isSuperuser })
		.returning({ id: groups.id })
		.all();

	return json({ id: group.id }, { status: 201 });
};
