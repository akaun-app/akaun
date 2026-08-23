import { inArray } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { deleteFile } from '$lib/server/file-storage.js';
import { importEvents } from '$lib/server/import/events.js';
import { ImportState } from '$lib/enums.js';
import type { RequestHandler } from './$types.js';
import { hasPermission } from '$lib/server/permissions.js';

const HISTORY_STATES = [ImportState.Confirmed, ImportState.Imported, ImportState.Skipped];

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'import', 'delete'))
		return new Response('Forbidden', { status: 403 });

	const rows = db
		.select()
		.from(importQueue)
		.where(inArray(importQueue.state, HISTORY_STATES))
		.all();

	for (const row of rows) deleteFile(row.tempFilePath);
	db.delete(importQueue).where(inArray(importQueue.state, HISTORY_STATES)).run();

	for (const row of rows) {
		importEvents.emit('job-deleted', { userId: row.createdBy, jobId: row.id });
	}

	return new Response(null, { status: 204 });
};
