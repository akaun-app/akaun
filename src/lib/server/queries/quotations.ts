import { and, asc, desc, eq, gte, lte, sql, getTableColumns, type SQL } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { quotations, quotationLines, quotationSearchText, contacts } from '../db/schema.js';
import { nextNumber } from '../running-number.js';
import { QuotationStatus, QuotationStatusLabels } from '$lib/enums.js';
import { addDaysISO, localToday } from '$lib/local-date.js';
import { canConvert, canSetQuotationStatus } from '$lib/sales/status.js';
import { upsertSearchText, searchTextExists, joinSearchText } from '../search-text.js';
import { createInvoice } from './invoices.js';
import { recordAudit, diffRecords } from '../audit.js';
import { documentDefaults } from '../sales/defaults.js';
import type { Refusable } from '../ledger/types.js';
import {
	computeTotals,
	contactNameFor,
	lineRows,
	type SalesLineInput,
	type SalesTotals
} from './sales-doc-shared.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type QuotationLineInput = SalesLineInput;

export type QuotationCreate = {
	contactId?: number | null;
	reference?: string | null;
	issueDate: string; // YYYY-MM-DD, required
	expiryDate?: string | null;
	currency?: string; // defaults to 'USD'
	exchangeRate?: number; // defaults to 1
	notes?: string | null;
	terms?: string | null;
	lines: QuotationLineInput[]; // required, non-empty
};

export type QuotationPatch = Partial<Omit<QuotationCreate, 'lines'>> & {
	lines?: QuotationLineInput[];
};

export type QuotationFilters = {
	status?: number;
	contactId?: number;
	search?: string; // matches quotation_number or reference or contact name
	dateFrom?: string;
	dateTo?: string;
	limit?: number;
	offset?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Past its expiry date while still open (Draft or Sent). "Today" is the local day. */
export function deriveExpired(
	q: { expiryDate: string | null; status: number },
	today: string = localToday()
): boolean {
	if (!q.expiryDate) return false;
	return (
		q.expiryDate < today &&
		(q.status === QuotationStatus.Draft || q.status === QuotationStatus.Sent)
	);
}

// ---------------------------------------------------------------------------
// Search text
// ---------------------------------------------------------------------------

/** Recomputes and upserts quotation_search_text for one quotation. Also used by the search-rebuild worker. */
export function reindexQuotation(db: Db, quotationId: number) {
	const row = db.select().from(quotations).where(eq(quotations.id, quotationId)).get();
	if (!row) return;
	const lines = db
		.select({ description: quotationLines.description })
		.from(quotationLines)
		.where(eq(quotationLines.quotationId, quotationId))
		.all();
	const text = joinSearchText(
		row.quotationNumber,
		contactNameFor(db, row.contactId),
		row.reference,
		row.notes,
		row.terms,
		...lines.map((l) => l.description)
	);
	upsertSearchText(db, quotationSearchText, quotationSearchText.quotationId, quotationSearchText.text, quotationId, text);
}

// ---------------------------------------------------------------------------
// Shared select shape
// ---------------------------------------------------------------------------

const quotationWithContact = {
	...getTableColumns(quotations),
	contactName:          contacts.legalName,
	contactAddress:       contacts.address,
	contactRegistrationNo: contacts.registrationNo,
	contactPhone:         contacts.phone,
	mainAmount: sql<number>`${quotations.total} * ${quotations.exchangeRate}`
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function listQuotations(db: Db, filters: QuotationFilters = {}) {
	const { limit = 100, offset = 0, status, contactId, search, dateFrom, dateTo } = filters;

	const conditions: SQL[] = [];
	if (status !== undefined) conditions.push(eq(quotations.status, status));
	if (contactId !== undefined) conditions.push(eq(quotations.contactId, contactId));
	if (dateFrom) conditions.push(gte(quotations.issueDate, dateFrom));
	if (dateTo) conditions.push(lte(quotations.issueDate, dateTo));
	if (search) {
		const term = `%${search}%`;
		conditions.push(
			searchTextExists(quotationSearchText, quotationSearchText.quotationId, quotationSearchText.text, quotations.id, term)
		);
	}

	const rows = db
		.select(quotationWithContact)
		.from(quotations)
		.leftJoin(contacts, eq(contacts.id, quotations.contactId))
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(desc(quotations.issueDate), desc(quotations.id))
		.limit(limit)
		.offset(offset)
		.all();

	return rows.map((row) => ({ ...row, isExpired: deriveExpired(row) }));
}

// ---------------------------------------------------------------------------
// Get single
// ---------------------------------------------------------------------------

export function getQuotation(db: Db, id: number) {
	const row = db
		.select(quotationWithContact)
		.from(quotations)
		.leftJoin(contacts, eq(contacts.id, quotations.contactId))
		.where(eq(quotations.id, id))
		.get();

	if (!row) return null;

	const lines = db
		.select()
		.from(quotationLines)
		.where(eq(quotationLines.quotationId, id))
		.orderBy(asc(quotationLines.sortOrder))
		.all();

	return { ...row, lines, isExpired: deriveExpired(row) };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function createQuotation(db: Db, userId: number, data: QuotationCreate) {
	return db.transaction((tx) => {
		if (!data.lines || data.lines.length === 0) {
			throw new Error('Quotation must have at least one line');
		}

		const totals = computeTotals(data.lines);
		const quotationNumber = nextNumber(tx, 'quotation', data.issueDate);

		const { id: newId } = tx
			.insert(quotations)
			.values({
				quotationNumber,
				contactId: data.contactId ?? null,
				reference: data.reference ?? null,
				issueDate: data.issueDate,
				expiryDate: data.expiryDate ?? null,
				currency: data.currency ?? 'USD',
				exchangeRate: data.exchangeRate ?? 1,
				subtotal: totals.subtotal,
				taxAmount: totals.taxAmount,
				total: totals.total,
				notes: data.notes ?? null,
				terms: data.terms ?? null,
				createdBy: userId,
				updatedBy: userId
			})
			.returning({ id: quotations.id })
			.get()!;

		tx.insert(quotationLines)
			.values(lineRows(data.lines).map((row) => ({ ...row, quotationId: newId })))
			.run();

		reindexQuotation(tx, newId);
		recordAudit(tx, { recordType: 'quotation', recordId: newId, userId, action: 'create' });
		return getQuotation(tx, newId)!;
	});
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateQuotation(db: Db, id: number, userId: number, patch: QuotationPatch) {
	return db.transaction((tx) => {
		const existing = tx.select().from(quotations).where(eq(quotations.id, id)).get();
		if (!existing) return null;

		let totalsUpdate: SalesTotals | null = null;
		if (patch.lines) {
			totalsUpdate = computeTotals(patch.lines);
			tx.delete(quotationLines).where(eq(quotationLines.quotationId, id)).run();
			tx.insert(quotationLines)
				.values(lineRows(patch.lines).map((row) => ({ ...row, quotationId: id })))
				.run();
		}

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { lines: _lines, ...headerPatch } = patch;
		const setValues = {
			...headerPatch,
			...(totalsUpdate ?? {}),
			updatedBy: userId,
			updatedAt: new Date().toISOString()
		};

		tx.update(quotations).set(setValues).where(eq(quotations.id, id)).run();

		reindexQuotation(tx, id);
		const updatedRow = tx.select().from(quotations).where(eq(quotations.id, id)).get();
		recordAudit(tx, {
			recordType: 'quotation',
			recordId: id,
			userId,
			action: 'update',
			changes: diffRecords(existing, updatedRow)
		});
		return getQuotation(tx, id)!;
	});
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function deleteQuotation(
	db: Db,
	id: number,
	userId: number
): { ok: boolean; reason?: 'converted' | 'not_found' } {
	return db.transaction((tx) => {
		const existing = tx.select().from(quotations).where(eq(quotations.id, id)).get();
		if (!existing) return { ok: false, reason: 'not_found' };
		if (existing.status === QuotationStatus.Converted) return { ok: false, reason: 'converted' };
		tx.delete(quotations).where(eq(quotations.id, id)).run();
		recordAudit(tx, {
			recordType: 'quotation',
			recordId: id,
			userId,
			action: 'delete',
			changes: diffRecords(existing, null)
		});
		return { ok: true };
	});
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Moves a quotation along by hand: sent to the customer, accepted, declined,
 * or back again. Converted is never a choice here on either side — it is
 * reached by converting and left only by deleting the invoice it became
 * (`canSetQuotationStatus`). Expired is worked out from the date, never set.
 */
export function setQuotationStatus(
	db: Db,
	id: number,
	userId: number,
	to: number
): Refusable<NonNullable<ReturnType<typeof getQuotation>>> {
	return db.transaction((tx) => {
		const existing = tx.select().from(quotations).where(eq(quotations.id, id)).get();
		if (!existing) return { ok: false, reason: 'That quotation no longer exists.' };

		if (existing.status === QuotationStatus.Converted) {
			return {
				ok: false,
				reason:
					'This quotation has become an invoice, so its status no longer changes. Delete the draft invoice to put it back to Accepted.'
			};
		}
		if (to === QuotationStatus.Converted) {
			return { ok: false, reason: 'Use Convert to turn this quotation into an invoice.' };
		}
		if (existing.status === to) {
			return {
				ok: false,
				reason: `This quotation is already ${QuotationStatusLabels[to] ?? 'in that status'}.`
			};
		}
		if (!canSetQuotationStatus(existing.status, to)) {
			return { ok: false, reason: 'A quotation cannot be given that status.' };
		}

		tx.update(quotations)
			.set({ status: to, updatedBy: userId, updatedAt: new Date().toISOString() })
			.where(eq(quotations.id, id))
			.run();
		const updatedRow = tx.select().from(quotations).where(eq(quotations.id, id)).get();
		recordAudit(tx, {
			recordType: 'quotation',
			recordId: id,
			userId,
			action: 'update',
			changes: diffRecords(existing, updatedRow)
		});
		return { ok: true, value: getQuotation(tx, id)! };
	});
}

// ---------------------------------------------------------------------------
// Convert to Invoice
// ---------------------------------------------------------------------------

/** Why a quotation in this status cannot be converted — the sentence the screen shows. */
function convertRefusal(status: number): string {
	switch (status) {
		case QuotationStatus.Converted:
			return 'This quotation has already been converted to an invoice.';
		case QuotationStatus.Draft:
			return 'Mark this quotation as sent before converting it. An invoice follows a quote the customer has seen.';
		case QuotationStatus.Declined:
			return 'This quotation was declined. Reopen it before converting it.';
		default:
			return 'This quotation cannot be converted.';
	}
}

/**
 * Turns a sent or accepted quotation into a draft invoice, and marks the
 * quotation Converted with a link to it — one transaction, so neither half can
 * exist without the other.
 *
 * The invoice is built by `createInvoice`, the same path as one typed in by
 * hand (its numbering, search text and audit entry). It carries the
 * quotation's customer, currency, rate, lines, reference, notes and terms, but
 * is dated the day it is made: the invoice is issued now, not when the quote
 * was. Its due date is that day plus the invoice term setting, or none when the
 * setting is empty (`documentDefaults`).
 *
 * `today` is a parameter only so a test can pin it.
 */
export function convertQuotationToInvoice(
	db: Db,
	quotationId: number,
	userId: number,
	options: { today?: string } = {}
): Refusable<{ quotationId: number; invoiceId: number }> {
	return db.transaction((tx) => {
		const quotation = getQuotation(tx, quotationId);
		if (!quotation) return { ok: false, reason: 'That quotation no longer exists.' };
		if (!canConvert(quotation)) return { ok: false, reason: convertRefusal(quotation.status) };

		const today = options.today ?? localToday();
		const { invoiceDueDays } = documentDefaults(tx);

		// A nested transaction: drizzle runs it as a savepoint inside this one.
		const invoice = createInvoice(tx, userId, {
			contactId: quotation.contactId ?? null,
			reference: quotation.reference,
			issueDate: today,
			dueDate: invoiceDueDays === null ? null : addDaysISO(today, invoiceDueDays),
			currency: quotation.currency,
			exchangeRate: quotation.exchangeRate,
			notes: quotation.notes,
			terms: quotation.terms,
			sourceQuotationId: quotationId,
			lines: quotation.lines.map((line) => ({
				description: line.description,
				quantity: line.quantity,
				unitPrice: line.unitPrice,
				sortOrder: line.sortOrder
			}))
		});

		tx.update(quotations)
			.set({
				status: QuotationStatus.Converted,
				convertedInvoiceId: invoice.id,
				updatedBy: userId,
				updatedAt: new Date().toISOString()
			})
			.where(eq(quotations.id, quotationId))
			.run();
		recordAudit(tx, {
			recordType: 'quotation',
			recordId: quotationId,
			userId,
			action: 'update',
			changes: [
				{ field: 'status', before: quotation.status, after: QuotationStatus.Converted },
				{ field: 'convertedInvoiceId', before: quotation.convertedInvoiceId, after: invoice.id }
			]
		});

		return { ok: true, value: { quotationId, invoiceId: invoice.id } };
	});
}
