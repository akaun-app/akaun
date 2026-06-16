import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import {
	contacts,
	contactRoles,
	contactSearchText,
	expenses,
	incomes
} from '../db/schema.js';
import { EntityType, Role, RoleLabels, EntityTypeLabels } from '$lib/enums.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

export type ContactFilters = {
	role?: number;
	entityType?: number;
	search?: string;
	includeInactive?: boolean;
	limit?: number;
	offset?: number;
};

export type ContactCreate = {
	entityType: number;
	legalName: string;
	registrationNo?: string | null;
	email?: string | null;
	phone?: string | null;
	address?: string | null;
	remark?: string | null;
	roles?: number[];
};

export type ContactPatch = Partial<Omit<ContactCreate, 'roles'>> & { isActive?: boolean };

/** Lowercase, trim, collapse punctuation/whitespace — used for dedupe + matching. */
export function normalizeName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function buildSearchText(c: {
	legalName: string;
	registrationNo?: string | null;
	email?: string | null;
	phone?: string | null;
}): string {
	return [c.legalName, c.registrationNo, c.email, c.phone].filter(Boolean).join(' ');
}

function reindex(db: Db, contactId: number, row: Parameters<typeof buildSearchText>[0]) {
	const text = buildSearchText(row);
	db.insert(contactSearchText)
		.values({ contactId, text })
		.onConflictDoUpdate({ target: contactSearchText.contactId, set: { text } })
		.run();
}

/** Resolve the role codes attached to a set of contacts → { [contactId]: number[] }. */
export function rolesForContacts(db: Db, ids: number[]): Record<number, number[]> {
	if (ids.length === 0) return {};
	const rows = db
		.select()
		.from(contactRoles)
		.where(inArray(contactRoles.contactId, ids))
		.all();
	const map: Record<number, number[]> = {};
	for (const r of rows) {
		(map[r.contactId] ??= []).push(r.role);
	}
	return map;
}

function withLabels<T extends { entityType: number }>(c: T, roles: number[]) {
	return {
		...c,
		roles,
		entityTypeLabel: EntityTypeLabels[c.entityType] ?? null,
		roleLabels: roles.map((r) => RoleLabels[r]).filter(Boolean)
	};
}

export function listContacts(db: Db, filters: ContactFilters = {}) {
	const { role, entityType, search, includeInactive = false, limit = 200, offset = 0 } = filters;

	const conditions = [];
	if (!includeInactive) conditions.push(eq(contacts.isActive, true));
	if (entityType !== undefined) conditions.push(eq(contacts.entityType, entityType));
	if (role !== undefined) {
		conditions.push(
			sql`EXISTS (SELECT 1 FROM ${contactRoles} WHERE ${contactRoles.contactId} = ${contacts.id} AND ${contactRoles.role} = ${role})`
		);
	}
	if (search) {
		const term = `%${search}%`;
		conditions.push(
			sql`EXISTS (SELECT 1 FROM ${contactSearchText} WHERE ${contactSearchText.contactId} = ${contacts.id} AND ${contactSearchText.text} LIKE ${term})`
		);
	}

	const rows = db
		.select()
		.from(contacts)
		.where(conditions.length ? and(...conditions) : undefined)
		.limit(limit)
		.offset(offset)
		.all();

	const roleMap = rolesForContacts(db, rows.map((r) => r.id));
	return rows.map((r) => withLabels(r, roleMap[r.id] ?? []));
}

export function getContact(db: Db, id: number) {
	const contact = db.select().from(contacts).where(eq(contacts.id, id)).get();
	if (!contact) return null;
	const roles = (rolesForContacts(db, [id])[id] ?? []).sort((a, b) => a - b);
	return withLabels(contact, roles);
}

export function getContactRoles(db: Db, id: number): number[] {
	return (rolesForContacts(db, [id])[id] ?? []).sort((a, b) => a - b);
}

/** Replace a contact's full role set with the given codes (may be empty). */
export function setContactRoles(db: Db, id: number, roles: number[]) {
	const unique = [...new Set(roles)];
	db.delete(contactRoles).where(eq(contactRoles.contactId, id)).run();
	if (unique.length > 0) {
		db.insert(contactRoles)
			.values(unique.map((role) => ({ contactId: id, role })))
			.run();
	}
	return unique.sort((a, b) => a - b);
}

export function createContact(db: Db, actingUserId: number, data: ContactCreate) {
	const row = db
		.insert(contacts)
		.values({
			entityType: data.entityType,
			legalName: data.legalName,
			registrationNo: data.registrationNo ?? null,
			email: data.email ?? null,
			phone: data.phone ?? null,
			address: data.address ?? null,
			remark: data.remark ?? null,
			createdBy: actingUserId,
			updatedBy: actingUserId
		})
		.returning()
		.get()!;

	const roles = setContactRoles(db, row.id, data.roles ?? []);
	reindex(db, row.id, row);
	return withLabels(row, roles);
}

export function updateContact(db: Db, id: number, actingUserId: number, patch: ContactPatch) {
	const existing = db.select().from(contacts).where(eq(contacts.id, id)).get();
	if (!existing) return null;

	const updated = db
		.update(contacts)
		.set({ ...patch, updatedBy: actingUserId, updatedAt: new Date().toISOString() })
		.where(eq(contacts.id, id))
		.returning()
		.get()!;

	reindex(db, id, updated);
	const roles = getContactRoles(db, id);
	return withLabels(updated, roles);
}

/** Is this contact referenced by any financial record? Blocks hard delete. */
export function isContactReferenced(db: Db, id: number): boolean {
	const e = db.select({ id: expenses.id }).from(expenses).where(eq(expenses.contactId, id)).get();
	if (e) return true;
	const i = db.select({ id: incomes.id }).from(incomes).where(eq(incomes.contactId, id)).get();
	return !!i;
}

/** Soft-deactivate (normal retire path). */
export function softDeleteContact(db: Db, id: number, actingUserId: number) {
	return updateContact(db, id, actingUserId, { isActive: false });
}

/** Hard delete — refuses if referenced. Returns false when blocked / missing. */
export function hardDeleteContact(db: Db, id: number): boolean {
	if (isContactReferenced(db, id)) return false;
	const result = db.delete(contacts).where(eq(contacts.id, id)).returning({ id: contacts.id }).get();
	return !!result;
}

/** Cluster contacts whose normalized legal_name collides (the cleanup tool). */
export function findDuplicates(db: Db) {
	const rows = db.select().from(contacts).where(eq(contacts.isActive, true)).all();
	const clusters = new Map<string, typeof rows>();
	for (const r of rows) {
		const key = normalizeName(r.legalName);
		if (!key) continue;
		(clusters.get(key) ?? clusters.set(key, []).get(key)!).push(r);
	}
	const roleMap = rolesForContacts(db, rows.map((r) => r.id));
	return [...clusters.entries()]
		.filter(([, group]) => group.length > 1)
		.map(([normalized, group]) => ({
			normalized,
			contacts: group.map((c) => withLabels(c, roleMap[c.id] ?? []))
		}));
}

/**
 * Transactional merge. Picks a survivor, repoints every contact-referencing table
 * onto it, unions roles, optionally backfills blank fields, then hard-deletes losers.
 *
 * EVERY future table that FKs contacts MUST be added to the "repoint references" block.
 */
export function mergeContacts(
	db: Db,
	survivorId: number,
	loserIds: number[],
	actingUserId: number
) {
	const losers = loserIds.filter((id) => id !== survivorId);
	if (losers.length === 0) return getContact(db, survivorId);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(db as any).transaction((tx: Db) => {
		// a/b. Repoint references — extend this block per new contact FK (invoices, payroll…).
		tx.update(expenses).set({ contactId: survivorId }).where(inArray(expenses.contactId, losers)).run();
		tx.update(incomes).set({ contactId: survivorId }).where(inArray(incomes.contactId, losers)).run();

		// c. Union losers' roles into survivor BEFORE the delete (cascade would wipe them).
		tx.run(
			sql`INSERT OR IGNORE INTO ${contactRoles} (contact_id, role)
			    SELECT ${survivorId}, role FROM ${contactRoles} WHERE contact_id IN (${sql.join(
					losers.map((id) => sql`${id}`),
					sql`, `
				)})`
		);

		// d. Backfill survivor's blank descriptive fields from a loser (survivor's values win).
		const survivor = tx.select().from(contacts).where(eq(contacts.id, survivorId)).get();
		if (survivor) {
			const fill: Record<string, unknown> = {};
			const fields = ['registrationNo', 'email', 'phone', 'address'] as const;
			for (const id of losers) {
				const loser = tx.select().from(contacts).where(eq(contacts.id, id)).get();
				if (!loser) continue;
				for (const f of fields) {
					if (!survivor[f] && !fill[f] && loser[f]) fill[f] = loser[f];
				}
			}
			if (Object.keys(fill).length > 0) {
				tx.update(contacts)
					.set({ ...fill, updatedBy: actingUserId, updatedAt: new Date().toISOString() })
					.where(eq(contacts.id, survivorId))
					.run();
			}
		}

		// e. Delete losers — their contact_roles + search_text cascade away.
		tx.delete(contacts).where(inArray(contacts.id, losers)).run();
	});

	// Re-index survivor name in case a backfill changed searchable fields.
	const survivor = db.select().from(contacts).where(eq(contacts.id, survivorId)).get();
	if (survivor) reindex(db, survivorId, survivor);
	return getContact(db, survivorId);
}

// ---------------------------------------------------------------------------
// Name → contact resolution, shared by the programmatic create path and import.
// ---------------------------------------------------------------------------

/**
 * Programmatic create helper: resolve a name string to a contact id among the
 * role-appropriate set (exact-then-normalized), else auto-create a Business
 * contact with that role. Used by POST /api/expenses & /api/income.
 */
export function resolveOrCreateContact(
	db: Db,
	name: string,
	role: number,
	actingUserId: number
): number {
	const trimmed = name.trim();
	if (!trimmed) {
		// Never silently fail — create a placeholder business contact with the role.
		return createContact(db, actingUserId, {
			entityType: EntityType.Business,
			legalName: name,
			roles: [role]
		}).id;
	}
	const match = findContactByName(db, trimmed, role);
	if (match) return match.id;
	return createContact(db, actingUserId, {
		entityType: EntityType.Business,
		legalName: trimmed,
		roles: [role]
	}).id;
}

/** Exact-then-normalized lookup within a role. Returns the contact row or null. */
export function findContactByName(db: Db, name: string, role: number) {
	const roleContacts = db
		.select({
			id: contacts.id,
			legalName: contacts.legalName,
			entityType: contacts.entityType,
			isActive: contacts.isActive
		})
		.from(contacts)
		.innerJoin(contactRoles, eq(contactRoles.contactId, contacts.id))
		.where(and(eq(contactRoles.role, role), eq(contacts.isActive, true)))
		.all();

	// Exact match first.
	const exact = roleContacts.find((c) => c.legalName === name);
	if (exact) return exact;
	// Normalized match next.
	const norm = normalizeName(name);
	return roleContacts.find((c) => normalizeName(c.legalName) === norm) ?? null;
}

export type ContactCandidate = { id: number; legalName: string; score: number };

/**
 * Import worker helper. Returns a confident exact-normalized match (matchedId)
 * and/or a ranked fuzzy candidate list. NEVER auto-links on a fuzzy guess.
 */
export function resolveContactCandidates(
	db: Db,
	name: string,
	role: number
): { matchedId: number | null; candidates: ContactCandidate[] } {
	const trimmed = (name ?? '').trim();
	if (!trimmed) return { matchedId: null, candidates: [] };

	const roleContacts = db
		.select({ id: contacts.id, legalName: contacts.legalName })
		.from(contacts)
		.innerJoin(contactRoles, eq(contactRoles.contactId, contacts.id))
		.where(and(eq(contactRoles.role, role), eq(contacts.isActive, true)))
		.all();

	const norm = normalizeName(trimmed);

	// Confident exact-normalized hit.
	const exact = roleContacts.find((c) => normalizeName(c.legalName) === norm);
	if (exact) return { matchedId: exact.id, candidates: [] };

	// Fuzzy candidates above threshold (top 5).
	const THRESHOLD = 0.55;
	const candidates = roleContacts
		.map((c) => ({ id: c.id, legalName: c.legalName, score: similarity(norm, normalizeName(c.legalName)) }))
		.filter((c) => c.score >= THRESHOLD)
		.sort((a, b) => b.score - a.score)
		.slice(0, 5);

	return { matchedId: null, candidates };
}

/** Token-overlap (Dice) similarity on normalized names, 0..1. */
function similarity(a: string, b: string): number {
	if (!a || !b) return 0;
	if (a === b) return 1;
	const ta = new Set(a.split(' '));
	const tb = new Set(b.split(' '));
	let inter = 0;
	for (const t of ta) if (tb.has(t)) inter++;
	return (2 * inter) / (ta.size + tb.size);
}
