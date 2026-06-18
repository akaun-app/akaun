import {
	createExpense as _create,
	updateExpense as _update,
	deleteExpense as _delete,
	getExpense,
	type ExpenseCreate,
	type ExpensePatch
} from '$lib/server/queries/expenses.js';
import { expenseEvents } from '$lib/server/finance/events.js';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export function createExpense(db: Db, actingUserId: number, data: ExpenseCreate) {
	const expense = _create(db, actingUserId, data);
	expenseEvents.emit('expense-update', { item: getExpense(db, expense.id) });
	return expense;
}

export function patchExpense(db: Db, id: number, actingUserId: number, patch: ExpensePatch) {
	const expense = _update(db, id, actingUserId, patch);
	if (expense) expenseEvents.emit('expense-update', { item: getExpense(db, id) });
	return expense;
}

export function removeExpense(db: Db, id: number) {
	const ok = _delete(db, id);
	if (ok) expenseEvents.emit('expense-delete', { id });
	return ok;
}
