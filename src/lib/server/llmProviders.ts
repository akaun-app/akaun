import { asc, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { LexoRank } from 'lexorank';
import { llmProviders } from './db/schema.js';
import type { ProviderType } from './import/providers/types.js';
import { ENCRYPTION_KEY } from './env.js';
import { decryptSecret, encryptSecret, looksEncrypted } from './crypto/secret-box.js';

export type ProviderRow = typeof llmProviders.$inferSelect;

/**
 * `apiKey` is encrypted at rest once `ENCRYPTION_KEY` is set (env.ts) — every
 * read here decrypts it back before returning, so no caller outside this file
 * ever needs to know whether a given row is encrypted. A row written before
 * `ENCRYPTION_KEY` was set is still plaintext and is returned as-is; it is
 * re-encrypted the next time it is saved, or by the startup pass in
 * `hooks.server.ts`.
 */
function withDecryptedKey(row: ProviderRow): ProviderRow {
	if (!ENCRYPTION_KEY || !row.apiKey || !looksEncrypted(row.apiKey)) return row;
	return { ...row, apiKey: decryptSecret(row.apiKey, ENCRYPTION_KEY) };
}

/** Encrypts `apiKey` for storage, when a key is configured and one was given. */
function withEncryptedKey<T extends { apiKey?: string }>(data: T): T {
	if (!ENCRYPTION_KEY || !data.apiKey) return data;
	return { ...data, apiKey: encryptSecret(data.apiKey, ENCRYPTION_KEY) };
}

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
	return db
		.select()
		.from(llmProviders)
		.orderBy(asc(llmProviders.sortKey))
		.all()
		.map(withDecryptedKey);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getEnabledProviders(db: BunSQLiteDatabase<any>): ProviderRow[] {
	return db
		.select()
		.from(llmProviders)
		.where(eq(llmProviders.enabled, true))
		.orderBy(asc(llmProviders.sortKey))
		.all()
		.map(withDecryptedKey);
}

/** Single-row equivalent of `getAllProviders` — never read `llmProviders` directly. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getProvider(db: BunSQLiteDatabase<any>, id: string): ProviderRow | undefined {
	const row = db.select().from(llmProviders).where(eq(llmProviders.id, id)).get();
	return row ? withDecryptedKey(row) : undefined;
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
			...withEncryptedKey({ apiKey: data.apiKey }),
			model: data.model,
			baseUrl: data.baseUrl ?? null,
			enabled: true,
			sortKey
		})
		.run();

	return getProvider(db, id)!;
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
	db.update(llmProviders)
		.set(withEncryptedKey(data))
		.where(eq(llmProviders.id, id))
		.run();
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
