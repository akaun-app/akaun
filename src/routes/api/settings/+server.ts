import type { RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { settings } from '$lib/server/db/schema.js';
import { setSetting } from '$lib/server/settings.js';

export const GET: RequestHandler = async ({ locals }) => {
	const user = locals.user!;

	const rows = db
		.select({ key: settings.key, value: settings.value })
		.from(settings)
		.where(eq(settings.userId, user.id))
		.all();

	const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
	return Response.json(map);
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const user = locals.user!;
	const body = await request.json();

	for (const [key, value] of Object.entries(body)) {
		setSetting(db, user.id, key, String(value));
	}

	const rows = db
		.select({ key: settings.key, value: settings.value })
		.from(settings)
		.where(eq(settings.userId, user.id))
		.all();

	const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
	return Response.json(map);
};
