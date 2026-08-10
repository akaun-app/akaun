import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
	expenses,
	expenseAttachments,
	incomes,
	incomeAttachments,
	quotations,
	invoices,
	contacts
} from '../db/schema.js';
import { extractText, inferMimeType } from '../extraction/document-text.js';
import { urlForFile } from '../file-storage.js';
import { createLogger } from '../logger.js';
import { searchRebuildEvents } from './events.js';
import { reindexExpense, setExtractedText as setExpenseExtractedText } from '../queries/expenses.js';
import { reindexIncome, setExtractedText as setIncomeExtractedText } from '../queries/income.js';
import { reindexQuotation } from '../queries/quotations.js';
import { reindexInvoice } from '../queries/invoices.js';
import { reindexContact } from '../queries/contacts.js';

const log = createLogger('search-rebuild');

export type RebuildStatus = {
	running: boolean;
	total: number;
	processed: number;
	startedAt: string | null;
	finishedAt: string | null;
	error: string | null;
};

let status: RebuildStatus = {
	running: false,
	total: 0,
	processed: 0,
	startedAt: null,
	finishedAt: null,
	error: null
};

export function getRebuildStatus(): RebuildStatus {
	return status;
}

const EMIT_THROTTLE_MS = 300;
let lastEmit = 0;

function emitProgress(force = false) {
	const now = Date.now();
	if (!force && now - lastEmit < EMIT_THROTTLE_MS) return;
	lastEmit = now;
	searchRebuildEvents.emit('progress', status);
}

/** Kicks off a rebuild in the background; no-ops if one is already running. */
export function startRebuild(): RebuildStatus {
	if (status.running) return status;
	status = {
		running: true,
		total: 0,
		processed: 0,
		startedAt: new Date().toISOString(),
		finishedAt: null,
		error: null
	};
	emitProgress(true);

	runRebuild().catch((err) => {
		log.error({ err }, 'Search rebuild crashed');
		status = {
			...status,
			running: false,
			finishedAt: new Date().toISOString(),
			error: err instanceof Error ? err.message : String(err)
		};
		emitProgress(true);
	});

	return status;
}

/** Re-runs local OCR/PDF extraction against a set of stored attachment files, best-effort. */
async function reextractAttachmentText(filenames: string[]): Promise<string | null> {
	const parts: string[] = [];
	for (const filename of filenames) {
		try {
			const text = await extractText(urlForFile(filename), inferMimeType(filename));
			if (text) parts.push(text);
		} catch (err) {
			log.warn({ err, filename }, 'Re-extraction failed for attachment; skipping');
		}
	}
	return parts.length ? parts.join('\n') : null;
}

async function rebuildExpense(id: number) {
	const attachments = db
		.select({ filename: expenseAttachments.filename })
		.from(expenseAttachments)
		.where(eq(expenseAttachments.expenseId, id))
		.all();
	const text = await reextractAttachmentText(attachments.map((a) => a.filename));
	if (text != null) {
		setExpenseExtractedText(db, id, text);
	} else {
		const row = db.select().from(expenses).where(eq(expenses.id, id)).get();
		if (row) reindexExpense(db, id, row);
	}
}

async function rebuildIncome(id: number) {
	const attachments = db
		.select({ filename: incomeAttachments.filename })
		.from(incomeAttachments)
		.where(eq(incomeAttachments.incomeId, id))
		.all();
	const text = await reextractAttachmentText(attachments.map((a) => a.filename));
	if (text != null) {
		setIncomeExtractedText(db, id, text);
	} else {
		const row = db.select().from(incomes).where(eq(incomes.id, id)).get();
		if (row) reindexIncome(db, id, row);
	}
}

async function runRebuild() {
	const expenseIds = db.select({ id: expenses.id }).from(expenses).all().map((r) => r.id);
	const incomeIds = db.select({ id: incomes.id }).from(incomes).all().map((r) => r.id);
	const quotationIds = db.select({ id: quotations.id }).from(quotations).all().map((r) => r.id);
	const invoiceIds = db.select({ id: invoices.id }).from(invoices).all().map((r) => r.id);
	const contactIds = db.select({ id: contacts.id }).from(contacts).all().map((r) => r.id);

	status.total =
		expenseIds.length + incomeIds.length + quotationIds.length + invoiceIds.length + contactIds.length;
	emitProgress(true);

	for (const id of expenseIds) {
		try {
			await rebuildExpense(id);
		} catch (err) {
			log.warn({ err, id }, 'Failed to rebuild expense search text');
		}
		status.processed++;
		emitProgress();
	}

	for (const id of incomeIds) {
		try {
			await rebuildIncome(id);
		} catch (err) {
			log.warn({ err, id }, 'Failed to rebuild income search text');
		}
		status.processed++;
		emitProgress();
	}

	for (const id of quotationIds) {
		try {
			reindexQuotation(db, id);
		} catch (err) {
			log.warn({ err, id }, 'Failed to rebuild quotation search text');
		}
		status.processed++;
		emitProgress();
	}

	for (const id of invoiceIds) {
		try {
			reindexInvoice(db, id);
		} catch (err) {
			log.warn({ err, id }, 'Failed to rebuild invoice search text');
		}
		status.processed++;
		emitProgress();
	}

	for (const id of contactIds) {
		try {
			const row = db.select().from(contacts).where(eq(contacts.id, id)).get();
			if (row) reindexContact(db, id, row);
		} catch (err) {
			log.warn({ err, id }, 'Failed to rebuild contact search text');
		}
		status.processed++;
		emitProgress();
	}

	status = { ...status, running: false, finishedAt: new Date().toISOString() };
	emitProgress(true);
	log.info({ total: status.total }, 'Search rebuild completed');
}
