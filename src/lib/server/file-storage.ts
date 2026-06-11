import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, basename, join } from 'path';
import { randomUUID } from 'crypto';
import { STORAGE_PATH } from './env.js';

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
	const filename = basename(tempRelPath);
	const rel = `${type}/${year}/${month}/${filename}`;
	const src = join(STORAGE_PATH, tempRelPath);
	const dest = join(STORAGE_PATH, rel);
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
