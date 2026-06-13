import {
	createIncome as _create,
	updateIncome as _update,
	deleteIncome as _delete,
	type IncomeCreate,
	type IncomePatch
} from '$lib/server/queries/income.js';
import { incomeEvents } from '$lib/server/finance/events.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BetterSQLite3Database<any>;

export function createIncome(db: Db, userId: number, data: IncomeCreate) {
	const income = _create(db, userId, data);
	incomeEvents.emit('income-update', { userId, item: income });
	return income;
}

export function patchIncome(db: Db, id: number, userId: number, patch: IncomePatch) {
	const income = _update(db, id, userId, patch);
	if (income) incomeEvents.emit('income-update', { userId, item: income });
	return income;
}

export function removeIncome(db: Db, id: number, userId: number) {
	const ok = _delete(db, id, userId);
	if (ok) incomeEvents.emit('income-delete', { userId, id });
	return ok;
}
