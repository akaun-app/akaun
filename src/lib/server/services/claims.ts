import { eq } from 'drizzle-orm';
import { expenses as expensesTable } from '$lib/server/db/schema.js';
import {
	createClaim as _create,
	getClaim,
	updateClaim as _update,
	deleteClaim as _delete,
	setClaimExpenses
} from '$lib/server/queries/claims.js';
import { getExpense } from '$lib/server/queries/expenses.js';
import { ClaimStatus } from '$lib/enums.js';
import { claimEvents, expenseEvents } from '$lib/server/finance/events.js';
import { recordAudit, diffRecords } from '$lib/server/audit.js';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

function emitLinkedExpenses(db: Db, claimId: number) {
	const linked = db.select({ id: expensesTable.id }).from(expensesTable).where(eq(expensesTable.claimId, claimId)).all();
	for (const exp of linked) expenseEvents.emit('expense-update', { item: getExpense(db, exp.id) });
}

// Diffable projection of a claim for the audit log — date/status plus the resolved set of
// linked expense ids. setClaimExpenses mutates the expenses table, not the claims row itself,
// so a plain diff of the claims row alone would miss expense (re)links.
function auditableClaim(claim: { date: string; status: number; expenses: { id: number }[] } | null) {
	if (!claim) return null;
	return {
		date: claim.date,
		status: claim.status,
		expenseIds: claim.expenses.map((e) => e.id).sort((a, b) => a - b)
	};
}

export function createClaim(db: Db, actingUserId: number, data: { date: string; expenseIds: number[] }) {
	const claim = _create(db, actingUserId, data);
	recordAudit(db, { recordType: 'claim', recordId: claim.id, userId: actingUserId, action: 'create' });
	claimEvents.emit('claim-update', { item: getClaim(db, claim.id) });
	emitLinkedExpenses(db, claim.id);
	return claim;
}

export function patchClaim(
	db: Db,
	id: number,
	actingUserId: number,
	patch: { status?: number; date?: string; expenseIds?: number[] }
) {
	const before = getClaim(db, id);
	const { expenseIds, ...rest } = patch;
	const affectedExpenseIds = expenseIds !== undefined ? setClaimExpenses(db, id, expenseIds) : [];

	const updated = _update(db, id, actingUserId, rest);
	if (!updated) return null;
	const after = getClaim(db, id);
	recordAudit(db, {
		recordType: 'claim',
		recordId: id,
		userId: actingUserId,
		action: 'update',
		changes: diffRecords(auditableClaim(before), auditableClaim(after))
	});

	claimEvents.emit('claim-update', { item: after });
	if (rest.status === ClaimStatus.Done) emitLinkedExpenses(db, id);
	for (const expenseId of affectedExpenseIds) {
		expenseEvents.emit('expense-update', { item: getExpense(db, expenseId) });
	}
	return updated;
}

export function removeClaim(db: Db, id: number, actingUserId: number) {
	const before = getClaim(db, id);
	const toRevert = db
		.select({ id: expensesTable.id })
		.from(expensesTable)
		.where(eq(expensesTable.claimId, id))
		.all();

	const deleted = _delete(db, id);
	if (!deleted) return false;

	recordAudit(db, {
		recordType: 'claim',
		recordId: id,
		userId: actingUserId,
		action: 'delete',
		changes: diffRecords(auditableClaim(before), null)
	});

	claimEvents.emit('claim-delete', { id });

	for (const e of toRevert) {
		expenseEvents.emit('expense-update', { item: getExpense(db, e.id) });
	}
	return true;
}
