import { asc, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { LexoRank } from 'lexorank';
import { llmProviders } from './db/schema.js';
import type { ProviderType } from './import/providers/types.js';

export type ProviderRow = typeof llmProviders.$inferSelect;

function nextSortKey(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>
): string {
	const last = db
		.select({ sortKey: llmProviders.sortKey })
		.from(llmProviders)
		.orderBy(asc(llmProviders.sortKey))
		.all()
		.at(-1);

	if (!last) return LexoRank.middle().toString();
	return LexoRank.parse(last.sortKey).genNext().toString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getAllProviders(db: BunSQLiteDatabase<any>): ProviderRow[] {
	return db.select().from(llmProviders).orderBy(asc(llmProviders.sortKey)).all();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getEnabledProviders(db: BunSQLiteDatabase<any>): ProviderRow[] {
	return db
		.select()
		.from(llmProviders)
		.where(eq(llmProviders.enabled, true))
		.orderBy(asc(llmProviders.sortKey))
		.all();
}

export function insertProvider(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	data: {
		type: ProviderType;
		name: string;
		apiKey: string;
		model: string;
		baseUrl?: string | null;
	}
): ProviderRow {
	const id = crypto.randomUUID();
	const sortKey = nextSortKey(db);

	db.insert(llmProviders)
		.values({
			id,
			type: data.type,
			name: data.name,
			apiKey: data.apiKey,
			model: data.model,
			baseUrl: data.baseUrl ?? null,
			enabled: true,
			sortKey
		})
		.run();

	return db.select().from(llmProviders).where(eq(llmProviders.id, id)).get()!;
}

export function updateProvider(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	id: string,
	data: Partial<{
		name: string;
		apiKey: string;
		model: string;
		baseUrl: string | null;
		enabled: boolean;
	}>
): void {
	if (Object.keys(data).length === 0) return;
	db.update(llmProviders).set(data).where(eq(llmProviders.id, id)).run();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deleteProvider(db: BunSQLiteDatabase<any>, id: string): void {
	db.delete(llmProviders).where(eq(llmProviders.id, id)).run();
}

export function reorderProviders(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	orderedIds: string[]
): void {
	if (orderedIds.length === 0) return;

	// Assign lexorank keys in ascending sequence
	let rank = LexoRank.min();
	for (const id of orderedIds) {
		rank = rank.genNext();
		db.update(llmProviders).set({ sortKey: rank.toString() }).where(eq(llmProviders.id, id)).run();
	}
}
