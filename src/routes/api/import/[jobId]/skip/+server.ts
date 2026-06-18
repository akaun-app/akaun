import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { deleteFile } from '$lib/server/file-storage.js';
import { importEvents } from '$lib/server/import/events.js';
import { ImportState } from '$lib/enums.js';
import type { RequestHandler } from './$types.js';
import { hasPermission } from '$lib/server/permissions.js';

export const POST: RequestHandler = async ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'import', 'change')) return new Response('Forbidden', { status: 403 });

	const row = db.select().from(importQueue).where(eq(importQueue.id, params.jobId)).get();

	if (!row) return new Response('Not found', { status: 404 });
	if (row.state !== ImportState.PendingReview) {
		return json({ error: 'Job is not in pending_review state' }, { status: 400 });
	}

	deleteFile(row.tempFilePath);
	db.update(importQueue)
		.set({ state: ImportState.Skipped })
		.where(eq(importQueue.id, params.jobId))
		.run();

	const updated = db.select().from(importQueue).where(eq(importQueue.id, params.jobId)).get();
	importEvents.emit('job-update', { userId: locals.user.id, job: updated });

	return new Response(null, { status: 204 });
};
