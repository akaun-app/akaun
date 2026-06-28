import { and, gte, lte, eq, ne, lt, isNotNull, sql, desc } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { expenses, incomes, contacts, invoices } from '../db/schema.js';
import { ExpenseStatus, InvoiceStatus } from '$lib/enums.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

export type PeriodTotals = { total: number; count: number };

/**
 * Dashboard aggregates computed in SQL (SUM / COUNT / GROUP BY) instead of
 * loading every row into JS. The dashboard is the PWA start_url, so keeping this
 * load cheap directly improves cold-start time. (SQLite here is synchronous, so
 * streaming / Promise.all would not help — doing less work is the win.)
 */

/** SUM(amount) + COUNT of expenses dated within [from, to] (inclusive). */
export function expenseTotals(db: Db, from: string, to: string): PeriodTotals {
	const row = db
		.select({
			total: sql<number>`coalesce(sum(${expenses.amount} * ${expenses.exchangeRate}), 0)`,
			count: sql<number>`count(*)`
		})
		.from(expenses)
		.where(and(gte(expenses.date, from), lte(expenses.date, to)))
		.get();
	return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

/** SUM(amount) + COUNT of incomes dated within [from, to] (inclusive). */
export function incomeTotals(db: Db, from: string, to: string): PeriodTotals {
	const row = db
		.select({
			total: sql<number>`coalesce(sum(${incomes.amount} * ${incomes.exchangeRate}), 0)`,
			count: sql<number>`count(*)`
		})
		.from(incomes)
		.where(and(gte(incomes.date, from), lte(incomes.date, to)))
		.get();
	return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

/** Total unpaid expense amount (all time). */
export function outstandingTotal(db: Db): number {
	const row = db
		.select({ total: sql<number>`coalesce(sum(${expenses.amount} * ${expenses.exchangeRate}), 0)` })
		.from(expenses)
		.where(eq(expenses.status, ExpenseStatus.Unpaid))
		.get();
	return row?.total ?? 0;
}

/** Monthly SUM(amount) keyed by 'YYYY-MM', for rows dated on/after `from`. */
function monthlyTotals(db: Db, table: typeof expenses | typeof incomes, from: string) {
	const month = sql<string>`substr(${table.date}, 1, 7)`;
	const rows = db
		.select({ month, total: sql<number>`coalesce(sum(${table.amount} * ${table.exchangeRate}), 0)` })
		.from(table)
		.where(gte(table.date, from))
		.groupBy(month)
		.all();
	return Object.fromEntries(rows.map((r) => [r.month, r.total])) as Record<string, number>;
}

export const monthlyExpenseTotals = (db: Db, from: string) => monthlyTotals(db, expenses, from);
export const monthlyIncomeTotals = (db: Db, from: string) => monthlyTotals(db, incomes, from);

/** Top expense categories by SUM(amount) within [from, to], descending. */
export function expenseCategoryBreakdown(
	db: Db,
	from: string,
	to: string,
	limit = 6
): { label: string; value: number }[] {
	return db
		.select({
			label: expenses.category,
			value: sql<number>`coalesce(sum(${expenses.amount} * ${expenses.exchangeRate}), 0)`
		})
		.from(expenses)
		.where(and(gte(expenses.date, from), lte(expenses.date, to)))
		.groupBy(expenses.category)
		.orderBy(desc(sql`sum(${expenses.amount} * ${expenses.exchangeRate})`))
		.limit(limit)
		.all();
}

/** Most recent expenses (with contact name), newest first. */
export function recentExpenses(db: Db, limit: number) {
	return db
		.select({
			date: expenses.date,
			name: expenses.itemName,
			sub: contacts.legalName,
			amount: sql<number>`${expenses.amount} * ${expenses.exchangeRate}`,
			status: expenses.status
		})
		.from(expenses)
		.leftJoin(contacts, eq(contacts.id, expenses.contactId))
		.orderBy(desc(expenses.date))
		.limit(limit)
		.all();
}

/** Most recent incomes (with contact name), newest first. */
export function recentIncomes(db: Db, limit: number) {
	return db
		.select({
			date: incomes.date,
			name: contacts.legalName,
			sub: incomes.descriptionText,
			amount: sql<number>`${incomes.amount} * ${incomes.exchangeRate}`
		})
		.from(incomes)
		.leftJoin(contacts, eq(contacts.id, incomes.contactId))
		.orderBy(desc(incomes.date))
		.limit(limit)
		.all();
}

/** COUNT and SUM(total) of all non-Paid invoices (all time). */
export function outstandingInvoicesSummary(db: Db): { count: number; total: number } {
	const row = db
		.select({
			count: sql<number>`count(*)`,
			total: sql<number>`coalesce(sum(${invoices.total}), 0)`
		})
		.from(invoices)
		.where(ne(invoices.status, InvoiceStatus.Paid))
		.get();
	return { count: row?.count ?? 0, total: row?.total ?? 0 };
}

/** COUNT of overdue invoices (due_date < today AND status != Paid AND due_date IS NOT NULL). */
export function overdueInvoicesCount(db: Db): number {
	const today = new Date().toISOString().slice(0, 10);
	const row = db
		.select({ count: sql<number>`count(*)` })
		.from(invoices)
		.where(
			and(
				isNotNull(invoices.dueDate),
				lt(invoices.dueDate, today),
				ne(invoices.status, InvoiceStatus.Paid)
			)
		)
		.get();
	return row?.count ?? 0;
}
