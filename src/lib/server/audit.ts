import { and, desc, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { auditLog, users } from './db/schema.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export type RecordType = 'expense' | 'income' | 'claim' | 'contact' | 'quotation' | 'invoice';
export type AuditAction = 'create' | 'update' | 'delete';
export type FieldChange = { field: string; before: unknown; after: unknown };

// Bookkeeping columns, not user-visible edits — never worth showing in a diff.
const IGNORED_FIELDS = new Set(['id', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy']);

/**
 * Shallow-compares two flat row objects and returns the fields whose value changed.
 * Arrays/nested values (e.g. a contact's `roles`, a claim's linked-expense ids) are
 * compared as opaque JSON — the entry shows the old array vs. the new one, not an
 * itemized diff.
 */
export function diffRecords(
	before: Record<string, unknown> | null | undefined,
	after: Record<string, unknown> | null | undefined
): FieldChange[] {
	const changes: FieldChange[] = [];
	const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
	for (const key of keys) {
		if (IGNORED_FIELDS.has(key)) continue;
		const b = before?.[key] ?? null;
		const a = after?.[key] ?? null;
		if (JSON.stringify(b) !== JSON.stringify(a)) changes.push({ field: key, before: b, after: a });
	}
	return changes;
}

export function recordAudit(
	db: Db,
	opts: {
		recordType: RecordType;
		recordId: number;
		userId: number | null;
		action: AuditAction;
		changes?: FieldChange[];
	}
): void {
	// Don't log a save that changed nothing.
	if (opts.action === 'update' && (!opts.changes || opts.changes.length === 0)) return;

	db.insert(auditLog)
		.values({
			recordType: opts.recordType,
			recordId: opts.recordId,
			userId: opts.userId,
			action: opts.action,
			changes: opts.changes && opts.changes.length > 0 ? JSON.stringify(opts.changes) : null
		})
		.run();
}

export type AuditEntry = {
	id: number;
	action: AuditAction;
	changes: FieldChange[] | null;
	createdAt: string;
	userId: number | null;
	userName: string | null;
};

export function getAuditTrail(db: Db, recordType: RecordType, recordId: number): AuditEntry[] {
	const rows = db
		.select({
			id: auditLog.id,
			action: auditLog.action,
			changes: auditLog.changes,
			createdAt: auditLog.createdAt,
			userId: auditLog.userId,
			userName: users.name,
			username: users.username
		})
		.from(auditLog)
		.leftJoin(users, eq(users.id, auditLog.userId))
		.where(and(eq(auditLog.recordType, recordType), eq(auditLog.recordId, recordId)))
		.orderBy(desc(auditLog.id))
		.all();

	return rows.map((r) => ({
		id: r.id,
		action: r.action as AuditAction,
		changes: r.changes ? (JSON.parse(r.changes) as FieldChange[]) : null,
		createdAt: r.createdAt,
		userId: r.userId,
		userName: r.userName ?? r.username ?? null
	}));
}
