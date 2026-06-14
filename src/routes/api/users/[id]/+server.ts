import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { hash } from 'argon2';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { users, userGroups, groups } from '$lib/server/db/schema.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const userId = parseInt(params.id);
	const user = db.select().from(users).where(eq(users.id, userId)).get();
	if (!user) return new Response('Not Found', { status: 404 });

	const memberships = db
		.select({ groupId: userGroups.groupId, groupName: groups.name, isSuperuser: groups.isSuperuser })
		.from(userGroups)
		.innerJoin(groups, eq(userGroups.groupId, groups.id))
		.where(eq(userGroups.userId, userId))
		.all();

	return json({
		id: user.id,
		name: user.name,
		email: user.email,
		username: user.username,
		bearerToken: user.bearerToken ? 'akn_live_••' + user.bearerToken.slice(-4) : null,
		hasBearerToken: !!user.bearerToken,
		groups: memberships.map((m) => ({ id: m.groupId, name: m.groupName })),
		isSuperuser: memberships.some((m) => m.isSuperuser),
		createdAt: user.createdAt
	});
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const userId = parseInt(params.id);
	const user = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
	if (!user) return new Response('Not Found', { status: 404 });

	const body = await request.json();
	const patch: Record<string, unknown> = {};

	if (body.name !== undefined) patch.name = body.name || null;
	if (body.email) patch.email = body.email;
	if (body.username) patch.username = body.username;
	if (body.password) patch.passwordHash = await hash(body.password);
	if (body.regenerateToken) {
		patch.bearerToken = 'akn_' + randomBytes(24).toString('hex');
	}
	if (body.revokeToken) {
		patch.bearerToken = null;
	}

	if (Object.keys(patch).length > 0) {
		db.update(users).set(patch).where(eq(users.id, userId)).run();
	}

	// Return full token only on regenerate (one-time reveal)
	const updated = db.select({ bearerToken: users.bearerToken }).from(users).where(eq(users.id, userId)).get();
	const responseBody: Record<string, unknown> = { success: true };
	if (body.regenerateToken && updated?.bearerToken) {
		responseBody.newToken = updated.bearerToken;
	}
	return json(responseBody);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const userId = parseInt(params.id);
	if (locals.user?.id === userId) {
		return json({ error: 'Cannot delete your own account' }, { status: 400 });
	}

	const user = db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
	if (!user) return new Response('Not Found', { status: 404 });

	db.delete(users).where(eq(users.id, userId)).run();
	return json({ success: true });
};
