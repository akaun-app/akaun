import { redirect } from '@sveltejs/kit';
import { db } from '$lib/server/db/client.js';
import { deleteSession } from '$lib/server/auth.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = ({ cookies }) => {
	const sessionId = cookies.get('session');
	if (sessionId) {
		deleteSession(db, sessionId);
		cookies.delete('session', { path: '/' });
	}
	redirect(302, '/login');
};
