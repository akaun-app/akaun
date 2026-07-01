import { json } from '@sveltejs/kit';
import { eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { saveToTemp, sniffAllowedType, MAX_UPLOAD_BYTES } from '$lib/server/file-storage.js';
import { importEvents } from '$lib/server/import/events.js';
import { ImportState } from '$lib/enums.js';
import type { RequestHandler } from './$types.js';
import { hasPermission } from '$lib/server/permissions.js';

const ACTIVE_STATES: number[] = [ImportState.Queued, ImportState.Extracting, ImportState.Processing];

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'import', 'view')) return new Response('Forbidden', { status: 403 });

	const activeOnly = url.searchParams.get('active') === '1';

	// Shared ledger — list every job, not just the caller's uploads.
	const rows = (
		activeOnly
			? db.select().from(importQueue).where(inArray(importQueue.state, ACTIVE_STATES))
			: db.select().from(importQueue)
	).all();

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
	if (!hasPermission(locals, 'import', 'add')) return new Response('Forbidden', { status: 403 });

	const formData = await request.formData();
	const file = formData.get('file');

	if (!(file instanceof File)) {
		return json({ error: 'No file provided' }, { status: 400 });
	}

	// Optional: caller already ran its own OCR/extraction (e.g. Apple Vision Framework
	// via a client-side Shortcut) and wants the server to skip its own OCR.
	const MAX_EXTRACTED_TEXT_LENGTH = 50_000;
	const rawExtractedText = formData.get('extractedText');
	let preExtractedText: string | null = null;
	if (typeof rawExtractedText === 'string') {
		const trimmed = rawExtractedText.trim();
		if (trimmed.length > MAX_EXTRACTED_TEXT_LENGTH) {
			return json(
				{ error: `extractedText too long. Maximum length is ${MAX_EXTRACTED_TEXT_LENGTH} characters.` },
				{ status: 400 }
			);
		}
		if (trimmed.length > 0) preExtractedText = trimmed;
	}

	const allowedExtensions = /\.(pdf|jpe?g|png)$/i;
	if (!allowedExtensions.test(file.name)) {
		return json({ error: 'Unsupported file type. Upload a PDF, JPG, or PNG.' }, { status: 400 });
	}

	if (file.size > MAX_UPLOAD_BYTES) {
		return json(
			{ error: `File too large. Maximum size is ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.` },
			{ status: 413 }
		);
	}

	const buffer = Buffer.from(await file.arrayBuffer());

	// Validate by content, not just the client-supplied name/MIME.
	if (!sniffAllowedType(buffer)) {
		return json({ error: 'File content is not a valid PDF, JPG, or PNG.' }, { status: 400 });
	}

	const tempFilePath = saveToTemp(buffer, file.name);

	const jobId = randomUUID();
	db.insert(importQueue)
		.values({
			id: jobId,
			createdBy: locals.user.id,
			state: ImportState.Queued,
			tempFilePath,
			originalFilename: file.name,
			preExtractedText
		})
		.run();

	const newJob = db.select().from(importQueue).where(eq(importQueue.id, jobId)).get();
	importEvents.emit('job-update', { userId: locals.user.id, job: newJob });

	return json({ jobId }, { status: 202 });
};
