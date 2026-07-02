import { getTableColumns, sql, type SQL } from 'drizzle-orm';
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
	// .values()/.set() key on the TS field name (e.g. "expenseId"), not the SQL column
	// name (e.g. "expense_id") that idColumn.name/textColumn.name hold — resolve those
	// keys from the table's column map instead of guessing from the column objects.
	const columns = getTableColumns(table);
	const idKey = Object.keys(columns).find((k) => columns[k] === idColumn)!;
	const textKey = Object.keys(columns).find((k) => columns[k] === textColumn)!;

	db.insert(table)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.values({ [idKey]: id, [textKey]: text } as any)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		.onConflictDoUpdate({ target: idColumn, set: { [textKey]: text } as any })
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
