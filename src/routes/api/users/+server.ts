import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types.js';
import { hash } from 'argon2';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { users, userGroups, groups, userPermissions } from '$lib/server/db/schema.js';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const allUsers = db.select().from(users).all();

	const result = allUsers.map((u) => {
		const memberships = db
			.select({ groupId: userGroups.groupId, groupName: groups.name, isSuperuser: groups.isSuperuser })
			.from(userGroups)
			.innerJoin(groups, eq(userGroups.groupId, groups.id))
			.where(eq(userGroups.userId, u.id))
			.all();
		const isSuperuser = memberships.some((m) => m.isSuperuser);
		const permRows = db.select().from(userPermissions).where(eq(userPermissions.userId, u.id)).all();
		const permOverrides: Record<string, { view: boolean; add: boolean; change: boolean; delete: boolean }> = {};
		for (const row of permRows) {
			permOverrides[row.resource] = { view: !!row.canView, add: !!row.canAdd, change: !!row.canChange, delete: !!row.canDelete };
		}
		return {
			id: u.id,
			name: u.name,
			email: u.email,
			username: u.username,
			hasBearerToken: !!u.bearerToken,
			groups: memberships.map((m) => ({ id: m.groupId, name: m.groupName })),
			isSuperuser,
			permOverrides,
			createdAt: u.createdAt
		};
	});

	return json(result);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.isSuperuser) return new Response('Forbidden', { status: 403 });

	const body = await request.json();
	const { name, email, username, password, groupIds = [] } = body;

	if (!email || !username || !password) {
		return json({ error: 'email, username and password are required' }, { status: 400 });
	}

	const existing = db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
	if (existing) return json({ error: 'Email already in use' }, { status: 409 });

	const passwordHash = await hash(password);
	const [newUser] = db
		.insert(users)
		.values({ email, username, name: name || null, passwordHash, role: 'user' })
		.returning({ id: users.id })
		.all();

	if (groupIds.length > 0) {
		db.insert(userGroups)
			.values(groupIds.map((gid: number) => ({ userId: newUser.id, groupId: gid })))
			.run();
	}

	return json({ id: newUser.id }, { status: 201 });
};
