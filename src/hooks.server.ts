import { redirect, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { eq } from 'drizzle-orm';
import { db, ensureDefaultAdmin, ensureGroupSeed } from '$lib/server/db/client.js';
import { getSessionUser } from '$lib/server/auth.js';
import { users } from '$lib/server/db/schema.js';
import { getEffectivePermissions } from '$lib/server/permissions.js';
import { setLogLevel } from '$lib/server/logger.js';
import { startImportWorker } from '$lib/server/import/worker.js';

if (env.LOG_LEVEL) setLogLevel(env.LOG_LEVEL);

export const init = async () => {
	await ensureDefaultAdmin();
	ensureGroupSeed();
	startImportWorker();
};

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (pathname.startsWith('/api/')) {
		const header = event.request.headers.get('Authorization');
		if (header?.startsWith('Bearer ')) {
			const rawToken = header.slice(7);
			const apiUser = db
				.select({ id: users.id, email: users.email, username: users.username, name: users.name, role: users.role })
				.from(users)
				.where(eq(users.bearerToken, rawToken))
				.get();
			if (!apiUser) {
				return new Response('Unauthorized', { status: 401 });
			}
			event.locals.user = apiUser;
			const { permissions, isSuperuser } = getEffectivePermissions(db, apiUser.id);
			event.locals.permissions = permissions;
			event.locals.isSuperuser = isSuperuser;
		} else {
			const sessionId = event.cookies.get('session');
			const sessionUser = sessionId ? getSessionUser(db, sessionId) : null;
			if (!sessionUser) {
				return new Response('Unauthorized', { status: 401 });
			}
			event.locals.user = sessionUser;
			const { permissions, isSuperuser } = getEffectivePermissions(db, sessionUser.id);
			event.locals.permissions = permissions;
			event.locals.isSuperuser = isSuperuser;
		}
		return resolve(event);
	}

	const sessionId = event.cookies.get('session');
	const sessionUser = sessionId ? getSessionUser(db, sessionId) : null;
	event.locals.user = sessionUser;

	if (!sessionUser) {
		if (pathname !== '/login') throw redirect(302, '/login');
		event.locals.permissions = null;
		event.locals.isSuperuser = false;
		return resolve(event);
	}

	const { permissions, isSuperuser } = getEffectivePermissions(db, sessionUser.id);
	event.locals.permissions = permissions;
	event.locals.isSuperuser = isSuperuser;

	return resolve(event);
};
