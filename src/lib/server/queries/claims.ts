import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { claims, claimAttachments, expenses, contacts } from '../db/schema.js';
import { nextNumber } from '../running-number.js';
import { ClaimStatus, ExpenseStatus } from '$lib/enums.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

// Minimal expense projection for the claim view (does not leak full expense detail).
function claimExpensesFor(db: Db, claimId: number) {
	return db
		.select({
			id: expenses.id,
			expenseNumber: expenses.expenseNumber,
			itemName: expenses.itemName,
			contactId: expenses.contactId,
			contactName: contacts.legalName,
			status: expenses.status,
			amount: expenses.amount,
			currency: expenses.currency,
			exchangeRate: expenses.exchangeRate,
			// Converted main-currency value; claim totals sum this so a claim mixing
			// currencies still totals correctly in the main currency.
			mainAmount: sql<number>`${expenses.amount} * ${expenses.exchangeRate}`,
			date: expenses.date
		})
		.from(expenses)
		.leftJoin(contacts, eq(contacts.id, expenses.contactId))
		.where(eq(expenses.claimId, claimId))
		.all();
}

export function listClaims(db: Db) {
	const rows = db.select().from(claims).orderBy(desc(claims.date)).all();

	return rows.map((claim) => {
		const claimExpenses = claimExpensesFor(db, claim.id);
		const total = claimExpenses.reduce((sum, e) => sum + e.mainAmount, 0);

		return { ...claim, total, expenseCount: claimExpenses.length, expenses: claimExpenses };
	});
}

export function getClaim(db: Db, id: number) {
	const claim = db.select().from(claims).where(eq(claims.id, id)).get();
	if (!claim) return null;

	const claimExpenses = claimExpensesFor(db, id);

	const attachments = db
		.select()
		.from(claimAttachments)
		.where(eq(claimAttachments.claimId, id))
		.all();

	const total = claimExpenses.reduce((sum, e) => sum + e.amount, 0);
	const expenseCount = claimExpenses.length;

	return { ...claim, expenses: claimExpenses, attachments, total, expenseCount };
}

export function createClaim(db: Db, actingUserId: number, data: { date: string; expenseIds: number[] }) {
	return db.transaction(() => {
		const claimNumber = nextNumber(db, 'CL', data.date);

		const claim = db
			.insert(claims)
			.values({
				claimNumber,
				date: data.date,
				status: ClaimStatus.Pending,
				createdBy: actingUserId,
				updatedBy: actingUserId
			})
			.returning()
			.get()!;

		if (data.expenseIds.length > 0) {
			db.update(expenses)
				.set({ status: ExpenseStatus.Pending, claimId: claim.id })
				.where(inArray(expenses.id, data.expenseIds))
				.run();
		}

		return claim;
	});
}

export function markClaimDone(db: Db, id: number, actingUserId: number) {
	return db.transaction(() => {
		const claim = db
			.update(claims)
			.set({ status: ClaimStatus.Done, updatedBy: actingUserId })
			.where(eq(claims.id, id))
			.returning()
			.get();

		if (!claim) return null;

		db.update(expenses).set({ status: ExpenseStatus.Paid }).where(eq(expenses.claimId, id)).run();

		return claim;
	});
}

export function updateClaim(
	db: Db,
	id: number,
	actingUserId: number,
	patch: { status?: number; date?: string }
) {
	if (patch.status === ClaimStatus.Done) {
		return markClaimDone(db, id, actingUserId);
	}

	return (
		db
			.update(claims)
			.set({ ...patch, updatedBy: actingUserId })
			.where(eq(claims.id, id))
			.returning()
			.get() ?? null
	);
}

export function deleteClaim(db: Db, id: number): boolean {
	return db.transaction(() => {
		const claim = db.select({ id: claims.id }).from(claims).where(eq(claims.id, id)).get();
		if (!claim) return false;

		db.update(expenses)
			.set({ status: ExpenseStatus.Unpaid, claimId: null })
			.where(eq(expenses.claimId, id))
			.run();

		db.delete(claims).where(eq(claims.id, id)).run();
		return true;
	});
}
