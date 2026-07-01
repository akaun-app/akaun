import { eq, asc, and, desc } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { LexoRank } from 'lexorank';
import { categories, CATEGORY_TYPE } from '../db/schema.js';

export function generateRanks(count: number): string[] {
	if (count === 0) return [];
	const ranks: string[] = [LexoRank.middle().toString()];
	for (let i = 1; i < count; i++) {
		ranks.push(LexoRank.parse(ranks[i - 1]).genNext().toString());
	}
	return ranks;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getCategories(db: BunSQLiteDatabase<any>, type: 'expense' | 'income'): string[] {
	return db
		.select({ name: categories.name })
		.from(categories)
		.where(eq(categories.type, CATEGORY_TYPE[type]))
		.orderBy(asc(categories.rank))
		.all()
		.map((r) => r.name);
}

/** Inserts `name` into the type's registry if it isn't already there; leaves everything else untouched. */
export function resolveOrCreateCategory(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	type: 'expense' | 'income',
	name: string
): void {
	const typeInt = CATEGORY_TYPE[type];
	const trimmed = name.trim();
	if (!trimmed) return;
	const existing = db
		.select({ id: categories.id })
		.from(categories)
		.where(and(eq(categories.type, typeInt), eq(categories.name, trimmed)))
		.get();
	if (existing) return;
	const last = db
		.select({ rank: categories.rank })
		.from(categories)
		.where(eq(categories.type, typeInt))
		.orderBy(desc(categories.rank))
		.limit(1)
		.get();
	const rank = last ? LexoRank.parse(last.rank).genNext().toString() : LexoRank.middle().toString();
	db.insert(categories).values({ type: typeInt, name: trimmed, rank }).run();
}

export function saveCategories(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	type: 'expense' | 'income',
	names: string[]
): void {
	const typeInt = CATEGORY_TYPE[type];
	db.transaction((tx) => {
		const existing = tx.select().from(categories).where(eq(categories.type, typeInt)).all();
		const existingByName = new Map(existing.map((r) => [r.name, r]));
		const newSet = new Set(names);
		const ranks = generateRanks(names.length);

		for (const row of existing) {
			if (!newSet.has(row.name)) {
				tx.delete(categories).where(eq(categories.id, row.id)).run();
			}
		}
		names.forEach((name, i) => {
			const found = existingByName.get(name);
			if (found) {
				tx.update(categories).set({ rank: ranks[i] }).where(eq(categories.id, found.id)).run();
			} else {
				tx.insert(categories).values({ type: typeInt, name, rank: ranks[i] }).run();
			}
		});
	});
}
