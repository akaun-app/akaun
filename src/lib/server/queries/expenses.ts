import { and, eq, gte, lte, inArray, sql, getTableColumns, type SQL } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { expenses, expenseAttachments, expenseSearchText, contacts, claims } from '../db/schema.js';
import { nextNumber } from '../running-number.js';
import { ExpenseStatus } from '$lib/enums.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

export type ExpenseFilters = {
	status?: number;
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
	contactId?: number | null;
	reference?: string;
	remark?: string;
	category?: string;
	status?: number;
	date: string;
	amount: number;
	// Currency `amount` is in, and the rate to the main currency. Default to main/1 in
	// callers; when omitted here the DB column defaults apply.
	currency?: string;
	exchangeRate?: number;
};

export type ExpensePatch = Partial<ExpenseCreate & { claimId: number | null }>;

function contactNameFor(db: Db, contactId: number | null | undefined): string {
	if (!contactId) return '';
	const row = db
		.select({ legalName: contacts.legalName })
		.from(contacts)
		.where(eq(contacts.id, contactId))
		.get();
	return row?.legalName ?? '';
}

function buildSearchText(e: {
	itemName: string;
	reference: string;
	remark: string;
	category: string;
}, contactName: string): string {
	return [e.itemName, contactName, e.reference, e.remark, e.category].filter(Boolean).join(' ');
}

function reindex(db: Db, expenseId: number, row: ExpenseRow) {
	const text = buildSearchText(row, contactNameFor(db, row.contactId));
	db.insert(expenseSearchText)
		.values({ expenseId, text })
		.onConflictDoUpdate({ target: expenseSearchText.expenseId, set: { text } })
		.run();
}

type ExpenseRow = typeof expenses.$inferSelect;

// `mainAmount` is the converted main-currency value (amount × exchangeRate). All
// display and aggregation use it; `amount`/`currency` are kept for the "original" line.
const expenseWithContact = {
	...getTableColumns(expenses),
	contactName: contacts.legalName,
	mainAmount: sql<number>`${expenses.amount} * ${expenses.exchangeRate}`
};

/** Shared WHERE-clause builder for expense list + count queries. */
function expenseConditions(filters: ExpenseFilters): SQL[] {
	const { status, category, dateFrom, dateTo, amountMin, amountMax, search } = filters;
	const conditions: SQL[] = [];
	if (status !== undefined) conditions.push(eq(expenses.status, status));
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
	return conditions;
}

export function listExpenses(db: Db, filters: ExpenseFilters = {}) {
	const { limit = 100, offset = 0 } = filters;
	const conditions = expenseConditions(filters);

	return db
		.select(expenseWithContact)
		.from(expenses)
		.leftJoin(contacts, eq(contacts.id, expenses.contactId))
		.where(conditions.length ? and(...conditions) : undefined)
		.limit(limit)
		.offset(offset)
		.all();
}

/** Count expenses matching the same filters as listExpenses, without fetching rows. */
export function countExpenses(db: Db, filters: ExpenseFilters = {}): number {
	const conditions = expenseConditions(filters);
	const row = db
		.select({ count: sql<number>`count(*)` })
		.from(expenses)
		.where(conditions.length ? and(...conditions) : undefined)
		.get();
	return row?.count ?? 0;
}

export function getExpense(db: Db, id: number) {
	const expense = db
		.select({
			...expenseWithContact,
			claimNumber: claims.claimNumber,
			claimStatus: claims.status,
			claimDate: claims.date
		})
		.from(expenses)
		.leftJoin(contacts, eq(contacts.id, expenses.contactId))
		.leftJoin(claims, eq(claims.id, expenses.claimId))
		.where(eq(expenses.id, id))
		.get();

	if (!expense) return null;

	const attachments = db
		.select()
		.from(expenseAttachments)
		.where(eq(expenseAttachments.expenseId, id))
		.all();

	return { ...expense, attachments };
}

export function createExpense(db: Db, actingUserId: number, data: ExpenseCreate) {
	const expenseNumber = nextNumber(db, 'EX', data.date);

	const row = db
		.insert(expenses)
		.values({
			expenseNumber,
			itemName: data.itemName,
			contactId: data.contactId ?? null,
			reference: data.reference ?? '',
			remark: data.remark ?? '',
			category: data.category ?? 'Other',
			status: data.status ?? ExpenseStatus.Unpaid,
			date: data.date,
			amount: data.amount,
			currency: data.currency ?? undefined,
			exchangeRate: data.exchangeRate ?? undefined,
			createdBy: actingUserId,
			updatedBy: actingUserId
		})
		.returning()
		.get()!;

	reindex(db, row.id, row);
	return row;
}

export function updateExpense(db: Db, id: number, actingUserId: number, patch: ExpensePatch) {
	const existing = db.select().from(expenses).where(eq(expenses.id, id)).get();
	if (!existing) return null;

	const updated = db
		.update(expenses)
		.set({ ...patch, updatedBy: actingUserId, updatedAt: new Date().toISOString() })
		.where(eq(expenses.id, id))
		.returning()
		.get()!;

	reindex(db, id, updated);
	return updated;
}

export function deleteExpense(db: Db, id: number): boolean {
	const result = db
		.delete(expenses)
		.where(eq(expenses.id, id))
		.returning({ id: expenses.id })
		.get();

	return !!result;
}

export function getExpensesByIds(db: Db, ids: number[]) {
	if (ids.length === 0) return [];
	return db.select().from(expenses).where(inArray(expenses.id, ids)).all();
}
