import { and, eq, gte, lte, sql } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { incomes, incomeAttachments, incomeSearchText } from '../db/schema.js';
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
	source?: string;
	descriptionText?: string;
	reference?: string;
	remark?: string;
	category?: string;
	date: string;
	amount: number;
};

export type IncomePatch = Partial<IncomeCreate>;

function buildSearchText(i: {
	source: string;
	descriptionText: string;
	reference: string;
	remark: string;
	category: string;
}): string {
	return [i.source, i.descriptionText, i.reference, i.remark, i.category]
		.filter(Boolean)
		.join(' ');
}

export function listIncomes(db: Db, userId: number, filters: IncomeFilters = {}) {
	const {
		category,
		dateFrom,
		dateTo,
		amountMin,
		amountMax,
		search,
		limit = 100,
		offset = 0
	} = filters;

	const conditions = [eq(incomes.userId, userId)];
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
		.select()
		.from(incomes)
		.where(and(...conditions))
		.limit(limit)
		.offset(offset)
		.all();
}

export function getIncome(db: Db, id: number, userId: number) {
	const income = db
		.select()
		.from(incomes)
		.where(and(eq(incomes.id, id), eq(incomes.userId, userId)))
		.get();

	if (!income) return null;

	const attachments = db
		.select()
		.from(incomeAttachments)
		.where(eq(incomeAttachments.incomeId, id))
		.all();

	return { ...income, attachments };
}

export function createIncome(db: Db, userId: number, data: IncomeCreate) {
	const incomeNumber = nextNumber(db, 'IN', data.date, userId);

	const row = db
		.insert(incomes)
		.values({
			incomeNumber,
			source: data.source ?? '',
			descriptionText: data.descriptionText ?? '',
			reference: data.reference ?? '',
			remark: data.remark ?? '',
			category: data.category ?? 'Other',
			date: data.date,
			amount: data.amount,
			userId
		})
		.returning()
		.get()!;

	const text = buildSearchText(row);
	db.insert(incomeSearchText)
		.values({ incomeId: row.id, text })
		.onConflictDoUpdate({
			target: incomeSearchText.incomeId,
			set: { text }
		})
		.run();

	return row;
}

export function updateIncome(db: Db, id: number, userId: number, patch: IncomePatch) {
	const existing = db
		.select()
		.from(incomes)
		.where(and(eq(incomes.id, id), eq(incomes.userId, userId)))
		.get();

	if (!existing) return null;

	const updated = db
		.update(incomes)
		.set(patch)
		.where(and(eq(incomes.id, id), eq(incomes.userId, userId)))
		.returning()
		.get()!;

	const text = buildSearchText(updated);
	db.insert(incomeSearchText)
		.values({ incomeId: id, text })
		.onConflictDoUpdate({
			target: incomeSearchText.incomeId,
			set: { text }
		})
		.run();

	return updated;
}

export function deleteIncome(db: Db, id: number, userId: number): boolean {
	const result = db
		.delete(incomes)
		.where(and(eq(incomes.id, id), eq(incomes.userId, userId)))
		.returning({ id: incomes.id })
		.get();

	return !!result;
}
