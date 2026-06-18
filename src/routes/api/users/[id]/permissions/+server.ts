import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { users, userPermissions } from '$lib/server/db/schema.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const userId = parseInt(params.id);
	const rows = db.select().from(userPermissions).where(eq(userPermissions.userId, userId)).all();

	const grid: Record<string, { view: boolean; add: boolean; change: boolean; delete: boolean }> = {};
	for (const row of rows) {
		grid[row.resource] = {
			view: !!row.canView,
			add: !!row.canAdd,
			change: !!row.canChange,
			delete: !!row.canDelete
		};
	}
	return json(grid);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const userId = parseInt(params.id);
	const user = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
	if (!user) return new Response('Not Found', { status: 404 });

	// body: { [resource]: { view, add, change, delete } | null }
	// null = remove override for that resource
	const body = await request.json() as Record<string, { view?: boolean; add?: boolean; change?: boolean; delete?: boolean } | null>;

	db.delete(userPermissions).where(eq(userPermissions.userId, userId)).run();

	const rows = Object.entries(body)
		.filter(([, perms]) => perms !== null)
		.map(([resource, perms]) => {
			const p = perms as { view?: boolean; add?: boolean; change?: boolean; delete?: boolean };
			return {
				userId,
				resource,
				canView: p.view ?? false,
				canAdd: p.add ?? false,
				canChange: p.change ?? false,
				canDelete: p.delete ?? false
			};
		});

	if (rows.length > 0) {
		db.insert(userPermissions).values(rows).run();
	}

	return json({ success: true });
};
