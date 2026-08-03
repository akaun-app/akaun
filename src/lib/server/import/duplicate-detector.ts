import { and, eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { expenses, incomes, importQueue, contacts } from '../db/schema.js';
import { ImportState, DuplicateSignal } from '$lib/enums.js';

type JobSnapshot = {
	originalFilename: string;
	fileHash: string | null;
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
	// 1. File hash — byte-identical re-upload of a file already imported. Strongest
	// possible signal: two files are the same document regardless of filename/rename.
	if (job.fileHash) {
		const byHash = db
			.select({ id: importQueue.resultId })
			.from(importQueue)
			.where(
				and(eq(importQueue.fileHash, job.fileHash), eq(importQueue.state, ImportState.Imported))
			)
			.get();
		if (byHash?.id != null) {
			return { duplicateOf: byHash.id, duplicateSignal: DuplicateSignal.FileHash };
		}
	}

	// 2. Reference — non-empty reference match in expenses or incomes.
	if (job.reference && job.reference.trim()) {
		const ref = job.reference.trim();
		const byExpRef = db.select({ id: expenses.id }).from(expenses).where(eq(expenses.reference, ref)).get();
		if (byExpRef) return { duplicateOf: byExpRef.id, duplicateSignal: DuplicateSignal.Reference };

		const byIncRef = db.select({ id: incomes.id }).from(incomes).where(eq(incomes.reference, ref)).get();
		if (byIncRef) return { duplicateOf: byIncRef.id, duplicateSignal: DuplicateSignal.Reference };
	}

	// 3. Filename + amount + date. A shared filename alone isn't a reliable signal —
	// scanners commonly reuse generic names (e.g. "scan0001.pdf") for unrelated
	// documents — but combined with a matching extracted amount and date it's a strong
	// corroborated signal. Reference is deliberately not part of this OR: a reference
	// match already returns above, so requiring it here would only mask the exact
	// scanner false-positive (same filename, different reference) this replaces.
	if (job.amount && job.date) {
		const byFilename = db
			.select({ id: importQueue.resultId })
			.from(importQueue)
			.where(
				and(
					eq(importQueue.originalFilename, job.originalFilename),
					eq(importQueue.amount, job.amount),
					eq(importQueue.date, job.date),
					eq(importQueue.state, ImportState.Imported)
				)
			)
			.get();
		if (byFilename?.id != null) {
			return { duplicateOf: byFilename.id, duplicateSignal: DuplicateSignal.Filename };
		}
	}

	// 4. Amount + date + supplier (matched via the linked contact's legal name).
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
