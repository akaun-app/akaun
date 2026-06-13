import { json } from '@sveltejs/kit';
import { eq, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { saveToTemp } from '$lib/server/file-storage.js';
import { importEvents } from '$lib/server/import/events.js';
import type { RequestHandler } from './$types.js';

const ACTIVE_STATES = ['queued', 'extracting', 'processing'];

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const activeOnly = url.searchParams.get('active') === '1';

	const conditions = [eq(importQueue.userId, locals.user.id)];
	if (activeOnly) {
		conditions.push(inArray(importQueue.state, ACTIVE_STATES));
	}

	const rows = db
		.select()
		.from(importQueue)
		.where(and(...conditions))
		.all();

	// Sort: active first, then by createdAt desc
	rows.sort((a, b) => {
		const aActive = ACTIVE_STATES.includes(a.state) ? 0 : 1;
		const bActive = ACTIVE_STATES.includes(b.state) ? 0 : 1;
		if (aActive !== bActive) return aActive - bActive;
		return b.createdAt.localeCompare(a.createdAt);
	});

	return json(rows);
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const formData = await request.formData();
	const file = formData.get('file');

	if (!(file instanceof File)) {
		return json({ error: 'No file provided' }, { status: 400 });
	}

	const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
	const allowedExtensions = /\.(pdf|jpe?g|png)$/i;
	if (!allowedTypes.includes(file.type) && !allowedExtensions.test(file.name)) {
		return json({ error: 'Unsupported file type. Upload a PDF, JPG, or PNG.' }, { status: 400 });
	}

	const buffer = Buffer.from(await file.arrayBuffer());
	const tempFilePath = saveToTemp(buffer, file.name);

	const jobId = randomUUID();
	db.insert(importQueue)
		.values({
			id: jobId,
			userId: locals.user.id,
			state: 'queued',
			tempFilePath,
			originalFilename: file.name
		})
		.run();

	const newJob = db.select().from(importQueue).where(eq(importQueue.id, jobId)).get();
	importEvents.emit('job-update', { userId: locals.user.id, job: newJob });

	return json({ jobId }, { status: 202 });
};
