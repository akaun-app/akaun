import { redirect, type Handle } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db, ensureDefaultAdmin } from '$lib/server/db/client.js';
import { getSessionUser } from '$lib/server/auth.js';
import { users } from '$lib/server/db/schema.js';
import { API_BEARER_TOKEN } from '$lib/server/env.js';

export const init = async () => {
	await ensureDefaultAdmin();
};

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (pathname.startsWith('/api/')) {
		const header = event.request.headers.get('Authorization');
		if (header !== `Bearer ${API_BEARER_TOKEN}`) {
			return new Response('Unauthorized', { status: 401 });
		}
		const apiUser = db
			.select({ id: users.id, username: users.username, role: users.role })
			.from(users)
			.where(eq(users.role, 'owner'))
			.get();
		event.locals.user = apiUser ?? null;
		return resolve(event);
	}

	const sessionId = event.cookies.get('session');
	event.locals.user = sessionId ? getSessionUser(db, sessionId) : null;

	if (!event.locals.user && pathname !== '/login') {
		throw redirect(302, '/login');
	}

	return resolve(event);
};
