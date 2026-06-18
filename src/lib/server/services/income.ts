import {
	createIncome as _create,
	updateIncome as _update,
	deleteIncome as _delete,
	getIncome,
	type IncomeCreate,
	type IncomePatch
} from '$lib/server/queries/income.js';
import { incomeEvents } from '$lib/server/finance/events.js';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export function createIncome(db: Db, actingUserId: number, data: IncomeCreate) {
	const income = _create(db, actingUserId, data);
	incomeEvents.emit('income-update', { item: getIncome(db, income.id) });
	return income;
}

export function patchIncome(db: Db, id: number, actingUserId: number, patch: IncomePatch) {
	const income = _update(db, id, actingUserId, patch);
	if (income) incomeEvents.emit('income-update', { item: getIncome(db, id) });
	return income;
}

export function removeIncome(db: Db, id: number) {
	const ok = _delete(db, id);
	if (ok) incomeEvents.emit('income-delete', { id });
	return ok;
}
