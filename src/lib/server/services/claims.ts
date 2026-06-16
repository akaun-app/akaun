import { eq } from 'drizzle-orm';
import { expenses as expensesTable } from '$lib/server/db/schema.js';
import {
	createClaim as _create,
	getClaim,
	updateClaim as _update,
	deleteClaim as _delete
} from '$lib/server/queries/claims.js';
import { getExpense } from '$lib/server/queries/expenses.js';
import { ClaimStatus } from '$lib/enums.js';
import { claimEvents, expenseEvents } from '$lib/server/finance/events.js';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

function emitLinkedExpenses(db: Db, claimId: number) {
	const linked = db.select({ id: expensesTable.id }).from(expensesTable).where(eq(expensesTable.claimId, claimId)).all();
	for (const exp of linked) expenseEvents.emit('expense-update', { item: getExpense(db, exp.id) });
}

export function createClaim(db: Db, actingUserId: number, data: { date: string; expenseIds: number[] }) {
	const claim = _create(db, actingUserId, data);
	claimEvents.emit('claim-update', { item: getClaim(db, claim.id) });
	emitLinkedExpenses(db, claim.id);
	return claim;
}

export function patchClaim(
	db: Db,
	id: number,
	actingUserId: number,
	patch: { status?: number; date?: string }
) {
	const updated = _update(db, id, actingUserId, patch);
	if (!updated) return null;
	claimEvents.emit('claim-update', { item: getClaim(db, id) });
	if (patch.status === ClaimStatus.Done) emitLinkedExpenses(db, id);
	return updated;
}

export function removeClaim(db: Db, id: number) {
	const toRevert = db
		.select({ id: expensesTable.id })
		.from(expensesTable)
		.where(eq(expensesTable.claimId, id))
		.all();

	const deleted = _delete(db, id);
	if (!deleted) return false;

	claimEvents.emit('claim-delete', { id });

	for (const e of toRevert) {
		expenseEvents.emit('expense-update', { item: getExpense(db, e.id) });
	}
	return true;
}
