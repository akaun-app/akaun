import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { expenses, expenseAttachments, expenseSearchText } from '../db/schema.js';
import { nextNumber } from '../running-number.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

export type ExpenseFilters = {
	status?: string;
	category?: string;
	dateFrom?: string;
	dateTo?: string;
	amountMin?: number;
	amountMax?: number;
	search?: string;
	limit?: number;
	offset?: number;
};

export type ExpenseCreate = {
	itemName: string;
	supplier?: string;
	reference?: string;
	remark?: string;
	category?: string;
	status?: string;
	date: string;
	amount: number;
};

export type ExpensePatch = Partial<ExpenseCreate & { claimId: number | null }>;

function buildSearchText(e: {
	itemName: string;
	supplier: string;
	reference: string;
	remark: string;
	category: string;
}): string {
	return [e.itemName, e.supplier, e.reference, e.remark, e.category].filter(Boolean).join(' ');
}

export function listExpenses(db: Db, userId: number, filters: ExpenseFilters = {}) {
	const {
		status,
		category,
		dateFrom,
		dateTo,
		amountMin,
		amountMax,
		search,
		limit = 100,
		offset = 0
	} = filters;

	const conditions = [eq(expenses.userId, userId)];
	if (status) conditions.push(eq(expenses.status, status));
	if (category) conditions.push(eq(expenses.category, category));
	if (dateFrom) conditions.push(gte(expenses.date, dateFrom));
	if (dateTo) conditions.push(lte(expenses.date, dateTo));
	if (amountMin !== undefined) conditions.push(gte(expenses.amount, amountMin));
	if (amountMax !== undefined) conditions.push(lte(expenses.amount, amountMax));
	if (search) {
		const term = `%${search}%`;
		conditions.push(
			sql`EXISTS (SELECT 1 FROM ${expenseSearchText} WHERE ${expenseSearchText.expenseId} = ${expenses.id} AND ${expenseSearchText.text} LIKE ${term})`
		);
	}

	return db
		.select()
		.from(expenses)
		.where(and(...conditions))
		.limit(limit)
		.offset(offset)
		.all();
}

export function getExpense(db: Db, id: number, userId: number) {
	const expense = db
		.select()
		.from(expenses)
		.where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
		.get();

	if (!expense) return null;

	const attachments = db
		.select()
		.from(expenseAttachments)
		.where(eq(expenseAttachments.expenseId, id))
		.all();

	return { ...expense, attachments };
}

export function createExpense(db: Db, userId: number, data: ExpenseCreate) {
	const expenseNumber = nextNumber(db, 'EX', data.date, userId);

	const row = db
		.insert(expenses)
		.values({
			expenseNumber,
			itemName: data.itemName,
			supplier: data.supplier ?? '',
			reference: data.reference ?? '',
			remark: data.remark ?? '',
			category: data.category ?? 'Other',
			status: data.status ?? 'unpaid',
			date: data.date,
			amount: data.amount,
			userId
		})
		.returning()
		.get()!;

	const text = buildSearchText(row);
	db.insert(expenseSearchText)
		.values({ expenseId: row.id, text })
		.onConflictDoUpdate({
			target: expenseSearchText.expenseId,
			set: { text }
		})
		.run();

	return row;
}

export function updateExpense(db: Db, id: number, userId: number, patch: ExpensePatch) {
	const existing = db
		.select()
		.from(expenses)
		.where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
		.get();

	if (!existing) return null;

	const updated = db
		.update(expenses)
		.set({ ...patch, updatedAt: new Date().toISOString() })
		.where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
		.returning()
		.get()!;

	const text = buildSearchText(updated);
	db.insert(expenseSearchText)
		.values({ expenseId: id, text })
		.onConflictDoUpdate({
			target: expenseSearchText.expenseId,
			set: { text }
		})
		.run();

	return updated;
}

export function deleteExpense(db: Db, id: number, userId: number): boolean {
	const result = db
		.delete(expenses)
		.where(and(eq(expenses.id, id), eq(expenses.userId, userId)))
		.returning({ id: expenses.id })
		.get();

	return !!result;
}

export function getExpensesByIds(db: Db, ids: number[], userId: number) {
	if (ids.length === 0) return [];
	return db
		.select()
		.from(expenses)
		.where(and(inArray(expenses.id, ids), eq(expenses.userId, userId)))
		.all();
}
