import { and, eq, gte, lte, sql, getTableColumns } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { incomes, incomeAttachments, incomeSearchText, contacts } from '../db/schema.js';
import { nextNumber } from '../running-number.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

export type IncomeFilters = {
	category?: string;
	dateFrom?: string;
	dateTo?: string;
	amountMin?: number;
	amountMax?: number;
	search?: string;
	limit?: number;
	offset?: number;
};

export type IncomeCreate = {
	contactId?: number | null;
	descriptionText?: string;
	reference?: string;
	remark?: string;
	category?: string;
	date: string;
	amount: number;
	// See ExpenseCreate.currency / exchangeRate.
	currency?: string;
	exchangeRate?: number;
};

export type IncomePatch = Partial<IncomeCreate>;

type IncomeRow = typeof incomes.$inferSelect;

function contactNameFor(db: Db, contactId: number | null | undefined): string {
	if (!contactId) return '';
	const row = db
		.select({ legalName: contacts.legalName })
		.from(contacts)
		.where(eq(contacts.id, contactId))
		.get();
	return row?.legalName ?? '';
}

function buildSearchText(i: {
	descriptionText: string;
	reference: string;
	remark: string;
	category: string;
}, contactName: string): string {
	return [contactName, i.descriptionText, i.reference, i.remark, i.category]
		.filter(Boolean)
		.join(' ');
}

function reindex(db: Db, incomeId: number, row: IncomeRow) {
	const text = buildSearchText(row, contactNameFor(db, row.contactId));
	db.insert(incomeSearchText)
		.values({ incomeId, text })
		.onConflictDoUpdate({ target: incomeSearchText.incomeId, set: { text } })
		.run();
}

// `mainAmount` = amount × exchangeRate (converted main-currency value). See expenses.ts.
const incomeWithContact = {
	...getTableColumns(incomes),
	contactName: contacts.legalName,
	mainAmount: sql<number>`${incomes.amount} * ${incomes.exchangeRate}`
};

export function listIncomes(db: Db, filters: IncomeFilters = {}) {
	const { category, dateFrom, dateTo, amountMin, amountMax, search, limit = 100, offset = 0 } =
		filters;

	const conditions = [];
	if (category) conditions.push(eq(incomes.category, category));
	if (dateFrom) conditions.push(gte(incomes.date, dateFrom));
	if (dateTo) conditions.push(lte(incomes.date, dateTo));
	if (amountMin !== undefined) conditions.push(gte(incomes.amount, amountMin));
	if (amountMax !== undefined) conditions.push(lte(incomes.amount, amountMax));
	if (search) {
		const term = `%${search}%`;
		conditions.push(
			sql`EXISTS (SELECT 1 FROM ${incomeSearchText} WHERE ${incomeSearchText.incomeId} = ${incomes.id} AND ${incomeSearchText.text} LIKE ${term})`
		);
	}

	return db
		.select(incomeWithContact)
		.from(incomes)
		.leftJoin(contacts, eq(contacts.id, incomes.contactId))
		.where(conditions.length ? and(...conditions) : undefined)
		.limit(limit)
		.offset(offset)
		.all();
}

export function getIncome(db: Db, id: number) {
	const income = db
		.select(incomeWithContact)
		.from(incomes)
		.leftJoin(contacts, eq(contacts.id, incomes.contactId))
		.where(eq(incomes.id, id))
		.get();

	if (!income) return null;

	const attachments = db
		.select()
		.from(incomeAttachments)
		.where(eq(incomeAttachments.incomeId, id))
		.all();

	return { ...income, attachments };
}

export function createIncome(db: Db, actingUserId: number, data: IncomeCreate) {
	const incomeNumber = nextNumber(db, 'IN', data.date);

	const row = db
		.insert(incomes)
		.values({
			incomeNumber,
			contactId: data.contactId ?? null,
			descriptionText: data.descriptionText ?? '',
			reference: data.reference ?? '',
			remark: data.remark ?? '',
			category: data.category ?? 'Other',
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

export function updateIncome(db: Db, id: number, actingUserId: number, patch: IncomePatch) {
	const existing = db.select().from(incomes).where(eq(incomes.id, id)).get();
	if (!existing) return null;

	const updated = db
		.update(incomes)
		.set({ ...patch, updatedBy: actingUserId })
		.where(eq(incomes.id, id))
		.returning()
		.get()!;

	reindex(db, id, updated);
	return updated;
}

export function deleteIncome(db: Db, id: number): boolean {
	const result = db
		.delete(incomes)
		.where(eq(incomes.id, id))
		.returning({ id: incomes.id })
		.get();

	return !!result;
}
