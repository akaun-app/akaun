import { fail, redirect } from '@sveltejs/kit';
import * as argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { users } from '$lib/server/db/schema.js';
import { createSession } from '$lib/server/auth.js';
import { hit, reset } from '$lib/server/rate-limit.js';
import type { Actions, PageServerLoad } from './$types.js';

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(302, '/');
};

export const actions: Actions = {
	default: async ({ request, cookies, getClientAddress }) => {
		const data = await request.formData();
		const username = String(data.get('username') ?? '');
		const password = String(data.get('password') ?? '');

		if (!username || !password) {
			return fail(400, { error: 'Username and password are required' });
		}

		const rateKey = `login:${getClientAddress()}:${username.toLowerCase()}`;
		const limit = hit(rateKey, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
		if (limit.limited) {
			return fail(429, {
				error: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`
			});
		}

		const user = db.select().from(users).where(eq(users.username, username)).get();
		if (!user || !(await argon2.verify(user.passwordHash, password))) {
			return fail(400, { error: 'Invalid username or password' });
		}

		reset(rateKey);
		const sessionId = createSession(db, user.id);
		cookies.set('session', sessionId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: process.env.NODE_ENV === 'production',
			maxAge: 60 * 60 * 24 * 30
		});

		redirect(302, '/');
	}
};
