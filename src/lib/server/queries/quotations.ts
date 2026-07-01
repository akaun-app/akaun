import { and, asc, desc, eq, gte, like, lte, or, sql, getTableColumns, type SQL } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { quotations, quotationLines, invoices, invoiceLines, contacts } from '../db/schema.js';
import { nextNumber } from '../running-number.js';
import { QuotationStatus, InvoiceStatus } from '$lib/enums.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type QuotationLineInput = {
	description: string;
	quantity: number;
	unitPrice: number;
	sortOrder?: number; // defaults to array index if omitted
};

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

function computeTotals(lines: QuotationLineInput[]): {
	subtotal: number;
	taxAmount: 0;
	total: number;
} {
	const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
	return { subtotal, taxAmount: 0, total: subtotal };
}

export function deriveExpired(q: { expiryDate: string | null; status: number }): boolean {
	if (!q.expiryDate) return false;
	const today = new Date().toISOString().slice(0, 10);
	return (
		q.expiryDate < today &&
		(q.status === QuotationStatus.Draft || q.status === QuotationStatus.Sent)
	);
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
	mainAmount: sql<number>`${quotations.subtotal} * ${quotations.exchangeRate}`
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
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			or(
				like(quotations.quotationNumber, term),
				like(quotations.reference, term),
				like(contacts.legalName, term)
			)!
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
			.values(
				data.lines.map((line, i) => ({
					quotationId: newId,
					description: line.description,
					quantity: line.quantity,
					unitPrice: line.unitPrice,
					lineTotal: line.quantity * line.unitPrice,
					sortOrder: line.sortOrder ?? i
				}))
			)
			.run();

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

		let totalsUpdate: { subtotal: number; taxAmount: 0; total: number } | null = null;
		if (patch.lines) {
			totalsUpdate = computeTotals(patch.lines);
			tx.delete(quotationLines).where(eq(quotationLines.quotationId, id)).run();
			tx.insert(quotationLines)
				.values(
					patch.lines.map((line, i) => ({
						quotationId: id,
						description: line.description,
						quantity: line.quantity,
						unitPrice: line.unitPrice,
						lineTotal: line.quantity * line.unitPrice,
						sortOrder: line.sortOrder ?? i
					}))
				)
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

		return getQuotation(tx, id)!;
	});
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function deleteQuotation(db: Db, id: number): { ok: boolean; reason?: 'converted' | 'not_found' } {
	return db.transaction((tx) => {
		const existing = tx.select({ status: quotations.status }).from(quotations).where(eq(quotations.id, id)).get();
		if (!existing) return { ok: false, reason: 'not_found' };
		if (existing.status === QuotationStatus.Converted) return { ok: false, reason: 'converted' };
		tx.delete(quotations).where(eq(quotations.id, id)).run();
		return { ok: true };
	});
}

// ---------------------------------------------------------------------------
// Convert to Invoice
// ---------------------------------------------------------------------------

export function convertQuotationToInvoice(
	db: Db,
	quotationId: number,
	userId: number
): {
	ok: boolean;
	reason?: 'not_found' | 'already_converted';
	quotationId?: number;
	invoiceId?: number;
} {
	return db.transaction((tx) => {
		const quotation = getQuotation(tx, quotationId);
		if (!quotation) return { ok: false, reason: 'not_found' };
		if (quotation.status === QuotationStatus.Converted) {
			return { ok: false, reason: 'already_converted' };
		}

		const invoiceNumber = nextNumber(tx, 'invoice', quotation.issueDate);

		const { id: newInvoiceId } = tx
			.insert(invoices)
			.values({
				invoiceNumber,
				contactId: quotation.contactId ?? null,
				status: InvoiceStatus.Draft,
				issueDate: quotation.issueDate,
				currency: quotation.currency,
				exchangeRate: quotation.exchangeRate,
				subtotal: quotation.subtotal,
				taxAmount: quotation.taxAmount,
				total: quotation.total,
				sourceQuotationId: quotationId,
				createdBy: userId,
				updatedBy: userId
			})
			.returning({ id: invoices.id })
			.get()!;

		tx.insert(invoiceLines)
			.values(
				quotation.lines.map((line) => ({
					invoiceId: newInvoiceId,
					description: line.description,
					quantity: line.quantity,
					unitPrice: line.unitPrice,
					lineTotal: line.lineTotal,
					sortOrder: line.sortOrder
				}))
			)
			.run();

		tx.update(quotations)
			.set({
				status: QuotationStatus.Converted,
				convertedInvoiceId: newInvoiceId,
				updatedBy: userId,
				updatedAt: new Date().toISOString()
			})
			.where(eq(quotations.id, quotationId))
			.run();

		return { ok: true, quotationId, invoiceId: newInvoiceId };
	});
}
