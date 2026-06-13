import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { deleteFile } from '$lib/server/file-storage.js';
import { importEvents } from '$lib/server/import/events.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const row = db
		.select()
		.from(importQueue)
		.where(and(eq(importQueue.id, params.jobId), eq(importQueue.userId, locals.user.id)))
		.get();

	if (!row) return new Response('Not found', { status: 404 });
	return json(row);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const row = db
		.select()
		.from(importQueue)
		.where(and(eq(importQueue.id, params.jobId), eq(importQueue.userId, locals.user.id)))
		.get();

	if (!row) return new Response('Not found', { status: 404 });
	if (!['queued', 'failed', 'pending_review'].includes(row.state)) {
		return json({ error: 'Can only delete queued, failed, or pending_review jobs' }, { status: 400 });
	}

	importEvents.emit('job-deleted', { userId: row.userId, jobId: params.jobId });
	deleteFile(row.tempFilePath);
	db.delete(importQueue).where(eq(importQueue.id, params.jobId)).run();

	return new Response(null, { status: 204 });
};
