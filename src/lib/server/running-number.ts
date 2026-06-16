import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { appSequences } from './db/schema.js';
import { sql } from 'drizzle-orm';

export function nextNumber(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	prefix: string,
	date: string
): string {
	const dateKey = date.replace(/-/g, '');

	const result = db
		.insert(appSequences)
		.values({ prefix, dateKey, lastSequence: 1 })
		.onConflictDoUpdate({
			target: [appSequences.prefix, appSequences.dateKey],
			set: { lastSequence: sql`${appSequences.lastSequence} + 1` }
		})
		.returning({ seq: appSequences.lastSequence })
		.get();

	const seq = String(result!.seq).padStart(3, '0');
	return `${prefix}${dateKey}-${seq}`;
}
