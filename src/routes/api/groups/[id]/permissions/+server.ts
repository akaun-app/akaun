import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { groups, groupPermissions } from '$lib/server/db/schema.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const groupId = parseInt(params.id);
	const perms = db.select().from(groupPermissions).where(eq(groupPermissions.groupId, groupId)).all();
	const grid: Record<string, { view: boolean; add: boolean; change: boolean; delete: boolean }> = {};
	for (const p of perms) {
		grid[p.resource] = { view: !!p.canView, add: !!p.canAdd, change: !!p.canChange, delete: !!p.canDelete };
	}
	return json(grid);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const groupId = parseInt(params.id);
	const group = db.select().from(groups).where(eq(groups.id, groupId)).get();
	if (!group) return new Response('Not Found', { status: 404 });

	// Superuser groups have all permissions implicitly — ignore grid changes
	if (group.isSuperuser) return json({ success: true });

	const body = await request.json();
	// body: { [resource]: { view, add, change, delete } }

	db.delete(groupPermissions).where(eq(groupPermissions.groupId, groupId)).run();

	const rows = Object.entries(body).map(([resource, perms]) => {
		const p = perms as { view?: boolean; add?: boolean; change?: boolean; delete?: boolean };
		return {
			groupId,
			resource,
			canView: p.view ?? false,
			canAdd: p.add ?? false,
			canChange: p.change ?? false,
			canDelete: p.delete ?? false
		};
	});

	if (rows.length > 0) {
		db.insert(groupPermissions).values(rows).run();
	}

	return json({ success: true });
};
