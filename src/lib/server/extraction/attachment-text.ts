import { extractText, inferMimeType } from './document-text.js';
import { urlForFile } from '../file-storage.js';
import { createLogger } from '../logger.js';

const log = createLogger('attachment-text');

/** Runs local OCR/PDF extraction against a set of stored attachment files, best-effort. */
export async function extractAttachmentsText(filenames: string[]): Promise<string | null> {
	const parts: string[] = [];
	for (const filename of filenames) {
		try {
			const text = await extractText(urlForFile(filename), inferMimeType(filename));
			if (text) parts.push(text);
		} catch (err) {
			log.warn({ err, filename }, 'Extraction failed for attachment; skipping');
		}
	}
	return parts.length ? parts.join('\n') : null;
}
