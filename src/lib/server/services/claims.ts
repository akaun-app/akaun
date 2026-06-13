import { eq, inArray } from 'drizzle-orm';
import { expenses as expensesTable } from '$lib/server/db/schema.js';
import {
	createClaim as _create,
	getClaim,
	updateClaim as _update,
	deleteClaim as _delete
} from '$lib/server/queries/claims.js';
import { claimEvents, expenseEvents } from '$lib/server/finance/events.js';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BetterSQLite3Database<any>;

function emitLinkedExpenses(db: Db, claimId: number, userId: number) {
	const linked = db.select().from(expensesTable).where(eq(expensesTable.claimId, claimId)).all();
	for (const exp of linked) expenseEvents.emit('expense-update', { userId, item: exp });
}

export function createClaim(db: Db, userId: number, data: { date: string; expenseIds: number[] }) {
	const claim = _create(db, userId, data);
	const enriched = getClaim(db, claim.id, userId);
	claimEvents.emit('claim-update', { userId, item: enriched });
	emitLinkedExpenses(db, claim.id, userId);
	return claim;
}

export function patchClaim(
	db: Db,
	id: number,
	userId: number,
	patch: { status?: string; date?: string }
) {
	const updated = _update(db, id, userId, patch);
	if (!updated) return null;
	const enriched = getClaim(db, id, userId);
	claimEvents.emit('claim-update', { userId, item: enriched });
	if (patch.status === 'done') emitLinkedExpenses(db, id, userId);
	return updated;
}

export function removeClaim(db: Db, id: number, userId: number) {
	const toRevert = db
		.select({ id: expensesTable.id })
		.from(expensesTable)
		.where(eq(expensesTable.claimId, id))
		.all();

	const deleted = _delete(db, id, userId);
	if (!deleted) return false;

	claimEvents.emit('claim-delete', { userId, id });

	if (toRevert.length > 0) {
		const reverted = db
			.select()
			.from(expensesTable)
			.where(inArray(expensesTable.id, toRevert.map((e) => e.id)))
			.all();
		for (const exp of reverted) expenseEvents.emit('expense-update', { userId, item: exp });
	}

	return true;
}
