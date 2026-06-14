import type { PageServerLoad, Actions } from './$types.js';
import { fail } from '@sveltejs/kit';
import { hash, verify } from 'argon2';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { users } from '$lib/server/db/schema.js';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	const user = db
		.select({ bearerToken: users.bearerToken })
		.from(users)
		.where(eq(users.id, userId))
		.get();

	const token = user?.bearerToken;

	return {
		name: locals.user!.name,
		email: locals.user!.email,
		username: locals.user!.username,
		hasBearerToken: !!token,
		maskedToken: token ? 'akn_live_••' + token.slice(-4) : null
	};
};

export const actions: Actions = {
	updateProfile: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();

		const name = String(data.get('name') ?? '').trim() || null;
		const email = String(data.get('email') ?? '').trim();
		const username = String(data.get('username') ?? '').trim();

		if (!email) return fail(400, { action: 'profile', error: 'Email is required.' });
		if (!username) return fail(400, { action: 'profile', error: 'Username is required.' });
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
			return fail(400, { action: 'profile', error: 'Enter a valid email address.' });

		try {
			db.update(users).set({ name, email, username }).where(eq(users.id, userId)).run();
		} catch {
			return fail(400, { action: 'profile', error: 'Email or username is already taken.' });
		}

		return { action: 'profile', success: true };
	},

	changePassword: async ({ locals, request }) => {
		const userId = locals.user!.id;
		const data = await request.formData();

		const currentPassword = String(data.get('currentPassword') ?? '');
		const newPassword = String(data.get('newPassword') ?? '');
		const confirmPassword = String(data.get('confirmPassword') ?? '');

		if (!currentPassword)
			return fail(400, { action: 'security', error: 'Current password is required.' });
		if (newPassword.length < 8)
			return fail(400, { action: 'security', error: 'New password must be at least 8 characters.' });
		if (newPassword !== confirmPassword)
			return fail(400, { action: 'security', error: 'Passwords do not match.' });

		const row = db
			.select({ passwordHash: users.passwordHash })
			.from(users)
			.where(eq(users.id, userId))
			.get();

		if (!row) return fail(400, { action: 'security', error: 'User not found.' });

		const valid = await verify(row.passwordHash, currentPassword);
		if (!valid)
			return fail(400, { action: 'security', error: 'Current password is incorrect.' });

		const passwordHash = await hash(newPassword);
		db.update(users).set({ passwordHash }).where(eq(users.id, userId)).run();

		return { action: 'security', success: true };
	},

	regenerateToken: async ({ locals }) => {
		const userId = locals.user!.id;
		const newToken = 'akn_' + randomBytes(24).toString('hex');
		db.update(users).set({ bearerToken: newToken }).where(eq(users.id, userId)).run();
		return { action: 'token', success: true, newToken };
	},

	revokeToken: async ({ locals }) => {
		const userId = locals.user!.id;
		db.update(users).set({ bearerToken: null }).where(eq(users.id, userId)).run();
		return { action: 'token', success: true };
	}
};
