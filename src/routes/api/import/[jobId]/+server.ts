import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { deleteFile } from '$lib/server/file-storage.js';
import { importEvents } from '$lib/server/import/events.js';
import { ImportState } from '$lib/enums.js';
import type { RequestHandler } from './$types.js';
import { hasPermission } from '$lib/server/permissions.js';

export const GET: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'import', 'view')) return new Response('Forbidden', { status: 403 });

	const row = db.select().from(importQueue).where(eq(importQueue.id, params.jobId)).get();

	if (!row) return new Response('Not found', { status: 404 });
	return json(row);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'import', 'delete')) return new Response('Forbidden', { status: 403 });

	const row = db.select().from(importQueue).where(eq(importQueue.id, params.jobId)).get();

	if (!row) return new Response('Not found', { status: 404 });
	const deletable: number[] = [ImportState.Queued, ImportState.Failed, ImportState.PendingReview];
	if (!deletable.includes(row.state)) {
		return json({ error: 'Can only delete queued, failed, or pending_review jobs' }, { status: 400 });
	}

	importEvents.emit('job-deleted', { userId: row.createdBy, jobId: params.jobId });
	deleteFile(row.tempFilePath);
	db.delete(importQueue).where(eq(importQueue.id, params.jobId)).run();

	return new Response(null, { status: 204 });
};
