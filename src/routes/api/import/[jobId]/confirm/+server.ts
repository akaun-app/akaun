import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { createLogger } from '$lib/server/logger.js';
import { importEvents } from '$lib/server/import/events.js';

const log = createLogger('import:confirm');
import {
	importQueue,
	expenses,
	expenseAttachments,
	expenseSearchText,
	incomes,
	incomeAttachments,
	incomeSearchText
} from '$lib/server/db/schema.js';
import { moveToFinal, displayName } from '$lib/server/file-storage.js';
import { nextNumber } from '$lib/server/running-number.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });

	const row = db
		.select()
		.from(importQueue)
		.where(and(eq(importQueue.id, params.jobId), eq(importQueue.userId, locals.user.id)))
		.get();

	if (!row) return new Response('Not found', { status: 404 });
	if (row.state !== 'pending_review') {
		return json({ error: 'Job is not in pending_review state' }, { status: 400 });
	}

	// Parse optional correction body — only present fields override extracted values
	let overrides: Record<string, unknown> = {};
	const ct = request.headers.get('content-type') ?? '';
	if (ct.includes('application/json')) {
		try {
			overrides = await request.json();
		} catch {
			// ignore parse errors — treat as no overrides
		}
	}

	// Merge: start from queue row, apply only the overridden fields
	const docType = (overrides.document_type as string) || row.documentType || 'expense';
	const itemName = (overrides.item_name as string) ?? row.itemName ?? '';
	const supplier = (overrides.supplier as string) ?? row.supplier ?? '';
	const date = (overrides.date as string) ?? row.date ?? new Date().toISOString().slice(0, 10);
	const amount = (overrides.amount as number) ?? row.amount ?? 0;
	const reference = (overrides.reference as string) ?? row.reference ?? '';
	const category = (overrides.category as string) ?? row.category ?? 'Other';
	const remark = (overrides.remark as string) ?? row.remark ?? '';

	const now = new Date().toISOString();

	// Mark as confirmed before DB transaction
	db.update(importQueue)
		.set({ state: 'confirmed', confirmedAt: now })
		.where(eq(importQueue.id, params.jobId))
		.run();

	let resultId: number;
	let resultType: string;
	let number: string;

	if (docType === 'income') {
		const incomeNumber = nextNumber(db, 'IN', date, locals.user.id);
		const searchText = [itemName, supplier, reference, remark, category].filter(Boolean).join(' ');

		const inserted = db
			.insert(incomes)
			.values({
				incomeNumber,
				source: itemName,
				descriptionText: supplier,
				reference,
				remark,
				category,
				date,
				amount,
				userId: locals.user.id
			})
			.returning({ id: incomes.id })
			.get();

		resultId = inserted!.id;
		resultType = 'income';
		number = incomeNumber;

		db.insert(incomeAttachments)
			.values({
				incomeId: resultId,
				filename: row.tempFilePath,
				displayName: displayName(row.tempFilePath),
				addedDate: date
			})
			.run();

		db.insert(incomeSearchText)
			.values({ incomeId: resultId, text: searchText })
			.onConflictDoUpdate({
				target: [incomeSearchText.incomeId],
				set: { text: searchText }
			})
			.run();
	} else {
		const expenseNumber = nextNumber(db, 'EX', date, locals.user.id);
		const searchText = [itemName, supplier, reference, remark, category].filter(Boolean).join(' ');

		const inserted = db
			.insert(expenses)
			.values({
				expenseNumber,
				itemName,
				supplier,
				reference,
				remark,
				category,
				date,
				amount,
				status: 'unpaid',
				userId: locals.user.id
			})
			.returning({ id: expenses.id })
			.get();

		resultId = inserted!.id;
		resultType = 'expense';
		number = expenseNumber;

		db.insert(expenseAttachments)
			.values({
				expenseId: resultId,
				filename: row.tempFilePath,
				displayName: displayName(row.tempFilePath),
				addedDate: date
			})
			.run();

		db.insert(expenseSearchText)
			.values({ expenseId: resultId, text: searchText })
			.onConflictDoUpdate({
				target: [expenseSearchText.expenseId],
				set: { text: searchText }
			})
			.run();
	}

	// Move file from temp to final location (after DB commit)
	try {
		const finalPath = moveToFinal(
			row.tempFilePath,
			docType === 'income' ? 'income' : 'expenses',
			date
		);
		// Update attachment record with final path
		if (docType === 'income') {
			db.update(incomeAttachments)
				.set({ filename: finalPath })
				.where(and(eq(incomeAttachments.incomeId, resultId), eq(incomeAttachments.filename, row.tempFilePath)))
				.run();
		} else {
			db.update(expenseAttachments)
				.set({ filename: finalPath })
				.where(and(eq(expenseAttachments.expenseId, resultId), eq(expenseAttachments.filename, row.tempFilePath)))
				.run();
		}
	} catch (err) {
		log.error({ err, jobId: params.jobId }, 'File move failed (temp file remains recoverable)');
	}

	db.update(importQueue)
		.set({ state: 'imported', resultId, resultType, completedAt: new Date().toISOString() })
		.where(eq(importQueue.id, params.jobId))
		.run();

	const updated = db.select().from(importQueue).where(eq(importQueue.id, params.jobId)).get();
	importEvents.emit('job-update', { userId: locals.user.id, job: updated });

	return json({ id: resultId, number }, { status: 201 });
};
