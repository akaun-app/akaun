import { extractDocumentSource, extractText, inferMimeType, isSpreadsheetMimeType } from './document-text.js';
import { urlForFile } from '../file-storage.js';
import { createLogger } from '../logger.js';

const log = createLogger('attachment-text');

/**
 * Runs local OCR/PDF extraction against a set of stored attachment files, best-effort.
 *
 * A spreadsheet is a record's file only when Auto Import made the record from
 * it (006 FR-050), and it is turned into text the way that reading saw it
 * (FR-051), so the record is found by what the sheet says. The callers leave
 * out a file shared by several records, so the file of a group is never
 * indexed (FR-029).
 */
export async function extractAttachmentsText(filenames: string[]): Promise<string | null> {
	const parts: string[] = [];
	for (const filename of filenames) {
		try {
			const absPath = urlForFile(filename);
			const mimeType = inferMimeType(filename);
			const text = isSpreadsheetMimeType(mimeType)
				? (await extractDocumentSource(absPath, mimeType)).plain
				: await extractText(absPath, mimeType);
			if (text) parts.push(text);
		} catch (err) {
			log.warn({ err, filename }, 'Extraction failed for attachment; skipping');
		}
	}
	return parts.length ? parts.join('\n') : null;
}
