import { and, eq, or } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { expenses, incomes, importQueue } from '../db/schema.js';

type Db = BunSQLiteDatabase<Record<string, never>>;

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
	duplicateSignal: string;
} | null;

export function detectDuplicate(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	db: BunSQLiteDatabase<any>,
	userId: number,
	job: JobSnapshot
): DuplicateResult {
	// 1. Filename — another imported queue row with same original filename
	const byFilename = db
		.select({ id: importQueue.resultId })
		.from(importQueue)
		.where(
			and(
				eq(importQueue.userId, userId),
				eq(importQueue.originalFilename, job.originalFilename),
				eq(importQueue.state, 'imported')
			)
		)
		.get();
	if (byFilename?.id != null) {
		return { duplicateOf: byFilename.id, duplicateSignal: 'filename' };
	}

	// 2. Reference — non-empty reference match in expenses or incomes
	if (job.reference && job.reference.trim()) {
		const ref = job.reference.trim();
		const byExpRef = db
			.select({ id: expenses.id })
			.from(expenses)
			.where(and(eq(expenses.userId, userId), eq(expenses.reference, ref)))
			.get();
		if (byExpRef) return { duplicateOf: byExpRef.id, duplicateSignal: 'reference' };

		const byIncRef = db
			.select({ id: incomes.id })
			.from(incomes)
			.where(and(eq(incomes.userId, userId), eq(incomes.reference, ref)))
			.get();
		if (byIncRef) return { duplicateOf: byIncRef.id, duplicateSignal: 'reference' };
	}

	// 3. Amount + date + supplier
	if (job.amount && job.date && job.supplier) {
		const byTriple = db
			.select({ id: expenses.id })
			.from(expenses)
			.where(
				and(
					eq(expenses.userId, userId),
					eq(expenses.amount, job.amount),
					eq(expenses.date, job.date),
					or(eq(expenses.supplier, job.supplier), eq(expenses.itemName, job.itemName ?? ''))
				)
			)
			.get();
		if (byTriple) return { duplicateOf: byTriple.id, duplicateSignal: 'amount_date_supplier' };

		const byIncTriple = db
			.select({ id: incomes.id })
			.from(incomes)
			.where(
				and(
					eq(incomes.userId, userId),
					eq(incomes.amount, job.amount),
					eq(incomes.date, job.date),
					eq(incomes.source, job.itemName ?? '')
				)
			)
			.get();
		if (byIncTriple) return { duplicateOf: byIncTriple.id, duplicateSignal: 'amount_date_supplier' };
	}

	return null;
}
