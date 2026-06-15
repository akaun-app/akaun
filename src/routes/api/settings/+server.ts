import type { RequestHandler } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { settings } from '$lib/server/db/schema.js';
import { setSetting, SETTING_KEYS } from '$lib/server/settings.js';

// Only these keys may be written through the API — prevents arbitrary keys being
// injected into a user's settings namespace.
const ALLOWED_KEYS = new Set<string>(Object.values(SETTING_KEYS));

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

	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		return Response.json({ error: 'Body must be a JSON object' }, { status: 400 });
	}

	const entries = Object.entries(body);
	const unknown = entries.filter(([key]) => !ALLOWED_KEYS.has(key)).map(([key]) => key);
	if (unknown.length > 0) {
		return Response.json({ error: `Unknown setting key(s): ${unknown.join(', ')}` }, { status: 400 });
	}

	for (const [key, value] of entries) {
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
