import {
	createExpense as _create,
	updateExpense as _update,
	deleteExpense as _delete,
	type ExpenseCreate,
	type ExpensePatch
} from '$lib/server/queries/expenses.js';
import { expenseEvents } from '$lib/server/finance/events.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BetterSQLite3Database<any>;

export function createExpense(db: Db, userId: number, data: ExpenseCreate) {
	const expense = _create(db, userId, data);
	expenseEvents.emit('expense-update', { userId, item: expense });
	return expense;
}

export function patchExpense(db: Db, id: number, userId: number, patch: ExpensePatch) {
	const expense = _update(db, id, userId, patch);
	if (expense) expenseEvents.emit('expense-update', { userId, item: expense });
	return expense;
}

export function removeExpense(db: Db, id: number, userId: number) {
	const ok = _delete(db, id, userId);
	if (ok) expenseEvents.emit('expense-delete', { userId, id });
	return ok;
}
