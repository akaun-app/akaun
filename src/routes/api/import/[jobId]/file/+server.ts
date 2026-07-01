import type { RequestHandler } from './$types.js';
import { existsSync, readFileSync } from 'fs';
import { join, resolve, sep } from 'path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { importQueue } from '$lib/server/db/schema.js';
import { STORAGE_PATH } from '$lib/server/env.js';
import { hasPermission } from '$lib/server/permissions.js';

const MIME: Record<string, string> = {
	pdf: 'application/pdf',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png'
};

export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	if (!hasPermission(locals, 'import', 'view')) return new Response('Forbidden', { status: 403 });

	const row = db.select().from(importQueue).where(eq(importQueue.id, params.jobId)).get();
	if (!row) return new Response('Not found', { status: 404 });

	const storageRoot = resolve(STORAGE_PATH);
	const abs = resolve(join(STORAGE_PATH, row.tempFilePath));
	if (!abs.startsWith(storageRoot + sep) && abs !== storageRoot) {
		return new Response('Forbidden', { status: 403 });
	}
	if (!existsSync(abs)) return new Response('Not found', { status: 404 });

	const content = new Blob([readFileSync(abs)]);
	const ext = row.tempFilePath.split('.').pop()?.toLowerCase() ?? '';
	const contentType = MIME[ext] ?? 'application/octet-stream';

	const displayFilename = row.originalFilename;
	const asciiFallback = displayFilename.replace(/[\x00-\x1f"\\]/g, '_') || 'file';
	const encoded = encodeURIComponent(displayFilename);
	const disposition = `inline; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;

	return new Response(content, {
		headers: {
			'Content-Type': contentType,
			'Content-Disposition': disposition
		}
	});
};
