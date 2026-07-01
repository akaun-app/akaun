import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { sql } from 'drizzle-orm';
import { appSequences, SEQUENCE_DOCUMENT_TYPE, type SequenceDocumentType } from './db/schema.js';
import { getSetting, SETTING_KEYS } from './settings.js';
import { renderTemplate, deriveBucketKey, validateTemplate, DEFAULT_SEQUENCE_TEMPLATE } from '$lib/sequence-template.js';

/**
 * Generates the next document number for `documentType` on `date`
 * ("YYYY-MM-DD"), using the shared saved template (or its built-in default).
 * Atomic: the UPSERT + RETURNING is a single statement, so concurrent callers
 * against the same (documentType, bucketKey) still serialize correctly
 * through SQLite's row-level write lock.
 */
export function nextNumber(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	documentType: SequenceDocumentType,
	date: string
): string {
	const typeCode = SEQUENCE_DOCUMENT_TYPE[documentType];
	const stored = getSetting(db, SETTING_KEYS.sequenceTemplate) ?? DEFAULT_SEQUENCE_TEMPLATE;
	// Defensive guard against a hand-edited/corrupted DB row: fall back to the
	// default rather than silently generating collision-prone numbers.
	const template = validateTemplate(stored) ? DEFAULT_SEQUENCE_TEMPLATE : stored;
	const bucketKey = deriveBucketKey(template, documentType, date);

	const result = db
		.insert(appSequences)
		.values({ documentType: typeCode, bucketKey, lastSequence: 1 })
		.onConflictDoUpdate({
			target: [appSequences.documentType, appSequences.bucketKey],
			set: { lastSequence: sql`${appSequences.lastSequence} + 1` }
		})
		.returning({ seq: appSequences.lastSequence })
		.get();

	return renderTemplate(template, documentType, date, result!.seq);
}
