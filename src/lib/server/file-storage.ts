import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, basename, join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { STORAGE_PATH } from './env.js';

/** Largest accepted upload, in bytes. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Verify the buffer's leading "magic bytes" identify an allowed type (PDF/JPEG/PNG).
 * This is content-based and cannot be spoofed by the client-supplied MIME or extension.
 */
export function sniffAllowedType(buffer: Buffer): 'pdf' | 'jpeg' | 'png' | null {
	if (buffer.length >= 4 && buffer.toString('ascii', 0, 4) === '%PDF') return 'pdf';
	if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
		return 'jpeg';
	}
	if (
		buffer.length >= 8 &&
		buffer[0] === 0x89 &&
		buffer[1] === 0x50 &&
		buffer[2] === 0x4e &&
		buffer[3] === 0x47 &&
		buffer[4] === 0x0d &&
		buffer[5] === 0x0a &&
		buffer[6] === 0x1a &&
		buffer[7] === 0x0a
	) {
		return 'png';
	}
	return null;
}

export function saveToTemp(buffer: Buffer, originalFilename: string): string {
	const uuid = randomUUID();
	const rel = `import/temp/${uuid}_${originalFilename}`;
	const abs = join(STORAGE_PATH, rel);
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, buffer);
	return rel;
}

export function moveToFinal(
	tempRelPath: string,
	type: 'expenses' | 'income' | 'claims',
	documentDate: string
): string {
	const [year, month] = documentDate.split('-');
	// Defence-in-depth: callers validate the date, but never trust it for path building.
	if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) {
		throw new Error(`Invalid document date for file path: ${documentDate}`);
	}
	const filename = basename(tempRelPath);
	const rel = `${type}/${year}/${month}/${filename}`;
	const src = join(STORAGE_PATH, tempRelPath);
	const dest = join(STORAGE_PATH, rel);
	const storageRoot = resolve(STORAGE_PATH);
	if (!resolve(dest).startsWith(storageRoot + '/')) {
		throw new Error('Resolved destination escapes storage root');
	}
	mkdirSync(dirname(dest), { recursive: true });
	renameSync(src, dest);
	return rel;
}

export function urlForFile(relativePath: string): string {
	return join(STORAGE_PATH, relativePath);
}

export function displayName(relativePath: string): string {
	const filename = basename(relativePath);
	const match = filename.match(/^[0-9a-f-]{36}_(.+)$/i);
	return match ? match[1] : filename;
}

export function deleteFile(relativePath: string): void {
	try {
		unlinkSync(join(STORAGE_PATH, relativePath));
	} catch {
		// ignore missing files
	}
}
