import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { appSequences } from './db/schema.js';
import { sql } from 'drizzle-orm';

export function nextNumber(
	db: BetterSQLite3Database<Record<string, never>>,
	prefix: string,
	date: string,
	userId: number
): string {
	const dateKey = date.replace(/-/g, '');

	const result = db
		.insert(appSequences)
		.values({ prefix, dateKey, lastSequence: 1, userId })
		.onConflictDoUpdate({
			target: [appSequences.prefix, appSequences.dateKey, appSequences.userId],
			set: { lastSequence: sql`${appSequences.lastSequence} + 1` }
		})
		.returning({ seq: appSequences.lastSequence })
		.get();

	const seq = String(result!.seq).padStart(3, '0');
	return `${prefix}${dateKey}-${seq}`;
}
