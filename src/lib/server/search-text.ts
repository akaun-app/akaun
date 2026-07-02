import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn, AnySQLiteTable } from 'drizzle-orm/sqlite-core';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

/**
 * Shared upsert for the per-entity `*_search_text` tables (expense_search_text,
 * income_search_text, quotation_search_text, invoice_search_text, contact_search_text).
 * Each table has the same 2-column shape (an entity id PK/FK + a `text` column) — this
 * replaces the identical insert/onConflictDoUpdate snippet that used to be duplicated
 * per feature file.
 */
export function upsertSearchText(
	db: Db,
	table: AnySQLiteTable,
	idColumn: AnySQLiteColumn,
	textColumn: AnySQLiteColumn,
	id: number,
	text: string
) {
	db.insert(table)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.values({ [idColumn.name]: id, [textColumn.name]: text } as any)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.onConflictDoUpdate({ target: idColumn, set: { [textColumn.name]: text } as any })
		.run();
}

/** Builds the `EXISTS (...)` clause used by list-search filters against a `*_search_text` table. */
export function searchTextExists(
	table: AnySQLiteTable,
	idColumn: AnySQLiteColumn,
	textColumn: AnySQLiteColumn,
	matchColumn: AnySQLiteColumn,
	term: string
): SQL {
	return sql`EXISTS (SELECT 1 FROM ${table} WHERE ${idColumn} = ${matchColumn} AND ${textColumn} LIKE ${term})`;
}

/** Joins search-text parts, dropping empty/null/undefined values. */
export function joinSearchText(...parts: (string | null | undefined)[]): string {
	return parts.filter(Boolean).join(' ');
}
