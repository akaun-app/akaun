import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { claims, claimAttachments, expenses } from '../db/schema.js';
import { nextNumber } from '../running-number.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

export function listClaims(db: Db, userId: number) {
	const rows = db
		.select()
		.from(claims)
		.where(eq(claims.userId, userId))
		.orderBy(desc(claims.date))
		.all();

	return rows.map((claim) => {
		const claimExpenses = db
			.select({
				id: expenses.id,
				expenseNumber: expenses.expenseNumber,
				itemName: expenses.itemName,
				supplier: expenses.supplier,
				status: expenses.status,
				amount: expenses.amount
			})
			.from(expenses)
			.where(eq(expenses.claimId, claim.id))
			.all();

		const total = claimExpenses.reduce((sum, e) => sum + e.amount, 0);
		const suppliers = [...new Set(claimExpenses.map((e) => e.supplier).filter(Boolean))];

		return { ...claim, total, expenseCount: claimExpenses.length, suppliers, expenses: claimExpenses };
	});
}

export function getClaim(db: Db, id: number, userId: number) {
	const claim = db
		.select()
		.from(claims)
		.where(and(eq(claims.id, id), eq(claims.userId, userId)))
		.get();

	if (!claim) return null;

	const claimExpenses = db
		.select()
		.from(expenses)
		.where(eq(expenses.claimId, id))
		.all();

	const attachments = db
		.select()
		.from(claimAttachments)
		.where(eq(claimAttachments.claimId, id))
		.all();

	const total = claimExpenses.reduce((sum, e) => sum + e.amount, 0);
	const expenseCount = claimExpenses.length;
	const suppliers = [...new Set(claimExpenses.map((e) => e.supplier).filter(Boolean))];

	return { ...claim, expenses: claimExpenses, attachments, total, expenseCount, suppliers };
}

export function createClaim(
	db: Db,
	userId: number,
	data: { date: string; expenseIds: number[] }
) {
	return db.transaction(() => {
		const claimNumber = nextNumber(
			db,
			'CL',
			data.date,
			userId
		);

		const claim = db
			.insert(claims)
			.values({ claimNumber, date: data.date, status: 'pending', userId })
			.returning()
			.get()!;

		if (data.expenseIds.length > 0) {
			db.update(expenses)
				.set({ status: 'pending', claimId: claim.id })
				.where(and(inArray(expenses.id, data.expenseIds), eq(expenses.userId, userId)))
				.run();
		}

		return claim;
	});
}

export function markClaimDone(db: Db, id: number, userId: number) {
	return db.transaction(() => {
		const claim = db
			.update(claims)
			.set({ status: 'done' })
			.where(and(eq(claims.id, id), eq(claims.userId, userId)))
			.returning()
			.get();

		if (!claim) return null;

		db.update(expenses)
			.set({ status: 'paid' })
			.where(eq(expenses.claimId, id))
			.run();

		return claim;
	});
}

export function updateClaim(db: Db, id: number, userId: number, patch: { status?: string }) {
	if (patch.status === 'done') {
		return markClaimDone(db, id, userId);
	}

	return db
		.update(claims)
		.set(patch)
		.where(and(eq(claims.id, id), eq(claims.userId, userId)))
		.returning()
		.get() ?? null;
}

export function deleteClaim(db: Db, id: number, userId: number): boolean {
	return db.transaction(() => {
		const claim = db
			.select({ id: claims.id })
			.from(claims)
			.where(and(eq(claims.id, id), eq(claims.userId, userId)))
			.get();

		if (!claim) return false;

		db.update(expenses)
			.set({ status: 'unpaid', claimId: null })
			.where(eq(expenses.claimId, id))
			.run();

		db.delete(claims).where(eq(claims.id, id)).run();
		return true;
	});
}
