import { and, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { expenses, incomes, importQueue, contacts } from '../db/schema.js';
import { ImportState, DuplicateSignal } from '$lib/enums.js';

type JobSnapshot = {
	originalFilename: string;
	itemName: string | null;
	supplier: string | null;
	amount: number | null;
	date: string | null;
	reference: string | null;
};

type DuplicateResult = {
	duplicateOf: number;
	duplicateSignal: number;
} | null;

// Shared ledger: no per-user filtering — a duplicate is a duplicate for everyone.
export function detectDuplicate(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	job: JobSnapshot
): DuplicateResult {
	// 1. Filename — another imported queue row with the same original filename.
	const byFilename = db
		.select({ id: importQueue.resultId })
		.from(importQueue)
		.where(
			and(
				eq(importQueue.originalFilename, job.originalFilename),
				eq(importQueue.state, ImportState.Imported)
			)
		)
		.get();
	if (byFilename?.id != null) {
		return { duplicateOf: byFilename.id, duplicateSignal: DuplicateSignal.Filename };
	}

	// 2. Reference — non-empty reference match in expenses or incomes.
	if (job.reference && job.reference.trim()) {
		const ref = job.reference.trim();
		const byExpRef = db.select({ id: expenses.id }).from(expenses).where(eq(expenses.reference, ref)).get();
		if (byExpRef) return { duplicateOf: byExpRef.id, duplicateSignal: DuplicateSignal.Reference };

		const byIncRef = db.select({ id: incomes.id }).from(incomes).where(eq(incomes.reference, ref)).get();
		if (byIncRef) return { duplicateOf: byIncRef.id, duplicateSignal: DuplicateSignal.Reference };
	}

	// 3. Amount + date + supplier (matched via the linked contact's legal name).
	if (job.amount && job.date && job.supplier) {
		const byTriple = db
			.select({ id: expenses.id })
			.from(expenses)
			.leftJoin(contacts, eq(contacts.id, expenses.contactId))
			.where(
				and(
					eq(expenses.amount, job.amount),
					eq(expenses.date, job.date),
					eq(contacts.legalName, job.supplier)
				)
			)
			.get();
		if (byTriple) return { duplicateOf: byTriple.id, duplicateSignal: DuplicateSignal.AmountDateSupplier };

		const byIncTriple = db
			.select({ id: incomes.id })
			.from(incomes)
			.leftJoin(contacts, eq(contacts.id, incomes.contactId))
			.where(
				and(
					eq(incomes.amount, job.amount),
					eq(incomes.date, job.date),
					eq(contacts.legalName, job.supplier)
				)
			)
			.get();
		if (byIncTriple) return { duplicateOf: byIncTriple.id, duplicateSignal: DuplicateSignal.AmountDateSupplier };
	}

	return null;
}
