import type { RequestHandler } from '@sveltejs/kit';
import { readFileSync } from 'fs';
import { join, resolve, sep } from 'path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import {
	expenseAttachments,
	incomeAttachments,
	claimAttachments
} from '$lib/server/db/schema.js';
import { STORAGE_PATH } from '$lib/server/env.js';

const MIME: Record<string, string> = {
	pdf: 'application/pdf',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif'
};

export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const filePath = params.path!;
	const storageRoot = resolve(STORAGE_PATH);
	const abs = resolve(join(STORAGE_PATH, filePath));

	if (!abs.startsWith(storageRoot + sep) && abs !== storageRoot) {
		return new Response('Forbidden', { status: 403 });
	}

	// Shared ledger — any authenticated user may read a file that belongs to a record.
	const owned =
		db
			.select({ id: expenseAttachments.id })
			.from(expenseAttachments)
			.where(eq(expenseAttachments.filename, filePath))
			.get() ??
		db
			.select({ id: incomeAttachments.id })
			.from(incomeAttachments)
			.where(eq(incomeAttachments.filename, filePath))
			.get() ??
		db
			.select({ id: claimAttachments.id })
			.from(claimAttachments)
			.where(eq(claimAttachments.filename, filePath))
			.get();

	if (!owned) return new Response('Forbidden', { status: 403 });

	let content: Blob;
	try {
		content = new Blob([readFileSync(abs)]);
	} catch {
		return new Response('Not Found', { status: 404 });
	}

	const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
	const contentType = MIME[ext] ?? 'application/octet-stream';
	const filename = filePath.split('/').pop() ?? 'file';
	const displayFilename = filename.replace(/^[0-9a-f-]{36}_/i, '');

	// Sanitize before placing the user-supplied name into a header value: strip control
	// chars and quotes for the ASCII fallback, and provide an RFC 5987 encoded variant.
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
