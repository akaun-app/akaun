import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db/client.js';
import { createLogger } from '$lib/server/logger.js';
import { importEvents } from '$lib/server/import/events.js';

const log = createLogger('import:confirm');
import {
	importQueue,
	expenseAttachments,
	incomeAttachments
} from '$lib/server/db/schema.js';
import { moveToFinal, displayName } from '$lib/server/file-storage.js';
import { normalizeDate } from '$lib/server/date.js';
import { createExpense } from '$lib/server/services/expenses.js';
import { createIncome } from '$lib/server/services/income.js';
import { resolveOrCreateContact } from '$lib/server/queries/contacts.js';
import { ImportState, DocumentType, Role, documentTypeEnum } from '$lib/enums.js';
import type { RequestHandler } from './$types.js';
import { hasPermission } from '$lib/server/permissions.js';

export const POST: RequestHandler = async ({ locals, params, request }) => {
	if (!locals.user) return new Response('Unauthorized', { status: 401 });
	// Shared ledger: any user with import.change may confirm, not just the uploader.
	if (!hasPermission(locals, 'import', 'change')) return new Response('Forbidden', { status: 403 });

	const row = db.select().from(importQueue).where(eq(importQueue.id, params.jobId)).get();

	if (!row) return new Response('Not found', { status: 404 });
	if (row.state !== ImportState.PendingReview) {
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

	// Resolve the document type → DocumentType code (overrides may be a label or a code).
	let docCode: number;
	if (typeof overrides.document_type === 'number') docCode = overrides.document_type;
	else if (typeof overrides.document_type === 'string')
		docCode = documentTypeEnum.fromLabel(overrides.document_type) ?? row.documentType ?? DocumentType.Expense;
	else docCode = row.documentType ?? DocumentType.Expense;
	const isIncome = docCode === DocumentType.Income;

	// Merge: start from queue row, apply only the overridden fields
	const itemName = (overrides.item_name as string) ?? row.itemName ?? '';
	const supplier = (overrides.supplier as string) ?? row.supplier ?? '';
	const date = normalizeDate((overrides.date as string) ?? row.date);
	const amount = (overrides.amount as number) ?? row.amount ?? 0;
	const reference = (overrides.reference as string) ?? row.reference ?? '';
	const category = (overrides.category as string) ?? row.category ?? 'Other';
	const remark = (overrides.remark as string) ?? row.remark ?? '';

	// Resolve the contact party. createdBy = the uploader (audit), not the confirmer.
	// Priority: explicit contactId → typed new name → confident match → raw extracted name.
	const role = isIncome ? Role.Customer : Role.Supplier;
	const partyRawName = isIncome ? itemName : supplier;
	// If the user edited the party name as free text, don't let a stale fuzzy match win.
	const partyEdited = isIncome ? overrides.item_name !== undefined : overrides.supplier !== undefined;
	const uploader = row.createdBy;
	let contactId: number | null = null;
	if (typeof overrides.contactId === 'number') {
		contactId = overrides.contactId;
	} else if (typeof overrides.newContactName === 'string' && overrides.newContactName.trim()) {
		contactId = resolveOrCreateContact(db, overrides.newContactName, role, uploader);
	} else if (row.matchedContactId && !partyEdited) {
		contactId = row.matchedContactId;
	} else if (partyRawName.trim()) {
		contactId = resolveOrCreateContact(db, partyRawName, role, uploader);
	}

	const now = new Date().toISOString();

	// Mark as confirmed before insert
	db.update(importQueue)
		.set({ state: ImportState.Confirmed, confirmedAt: now })
		.where(eq(importQueue.id, params.jobId))
		.run();

	let resultId: number;
	let number: string;

	if (isIncome) {
		const inserted = createIncome(db, uploader, {
			contactId,
			descriptionText: supplier,
			reference,
			remark,
			category,
			date,
			amount
		});
		resultId = inserted.id;
		number = inserted.incomeNumber;

		db.insert(incomeAttachments)
			.values({
				incomeId: resultId,
				filename: row.tempFilePath,
				displayName: displayName(row.tempFilePath),
				addedDate: date
			})
			.run();
	} else {
		const inserted = createExpense(db, uploader, {
			itemName,
			contactId,
			reference,
			remark,
			category,
			date,
			amount
		});
		resultId = inserted.id;
		number = inserted.expenseNumber;

		db.insert(expenseAttachments)
			.values({
				expenseId: resultId,
				filename: row.tempFilePath,
				displayName: displayName(row.tempFilePath),
				addedDate: date
			})
			.run();
	}

	// Move file from temp to final location (after insert)
	try {
		const finalPath = moveToFinal(row.tempFilePath, isIncome ? 'income' : 'expenses', date);
		if (isIncome) {
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
		.set({ state: ImportState.Imported, resultId, resultType: docCode, completedAt: new Date().toISOString() })
		.where(eq(importQueue.id, params.jobId))
		.run();

	const updated = db.select().from(importQueue).where(eq(importQueue.id, params.jobId)).get();
	importEvents.emit('job-update', { userId: locals.user.id, job: updated });

	return json({ id: resultId, number }, { status: 201 });
};
