import { eq, asc } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { categories } from '../db/schema.js';

export function getCategories(db: BunSQLiteDatabase<any>, type: 'expense' | 'income'): string[] {
	return db
		.select({ name: categories.name })
		.from(categories)
		.where(eq(categories.type, type))
		.orderBy(asc(categories.sortOrder))
		.all()
		.map((r) => r.name);
}

export function saveCategories(
	db: BunSQLiteDatabase<any>,
	type: 'expense' | 'income',
	names: string[]
): void {
	const existing = db.select().from(categories).where(eq(categories.type, type)).all();
	const existingByName = new Map(existing.map((r) => [r.name, r]));
	const newSet = new Set(names);

	// Delete removed
	for (const row of existing) {
		if (!newSet.has(row.name)) {
			db.delete(categories).where(eq(categories.id, row.id)).run();
		}
	}
	// Insert new / update sortOrder for kept
	names.forEach((name, i) => {
		const found = existingByName.get(name);
		if (found) {
			db.update(categories).set({ sortOrder: i }).where(eq(categories.id, found.id)).run();
		} else {
			db.insert(categories).values({ type, name, sortOrder: i }).run();
		}
	});
}
