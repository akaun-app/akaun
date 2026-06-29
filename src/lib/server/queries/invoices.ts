import { and, asc, desc, eq, gte, like, lte, or, sql, getTableColumns, type SQL } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../db/schema.js';
import { invoices, invoiceLines, contacts, incomes } from '../db/schema.js';
import { nextNumber } from '../running-number.js';
import { InvoiceStatus } from '$lib/enums.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type InvoiceLineInput = {
	description: string;
	quantity: number;
	unitPrice: number;
	sortOrder?: number; // defaults to array index if omitted
};

export type InvoiceCreate = {
	contactId?: number | null;
	reference?: string | null;
	issueDate: string; // YYYY-MM-DD, required
	dueDate?: string | null;
	currency?: string; // defaults to 'USD'
	exchangeRate?: number; // defaults to 1
	notes?: string | null;
	terms?: string | null;
	lines: InvoiceLineInput[]; // required, non-empty
	// For conversion from quotation (optional, set by service layer):
	sourceQuotationId?: number | null;
};

export type InvoicePatch = Partial<Omit<InvoiceCreate, 'lines'>> & {
	lines?: InvoiceLineInput[];
};

export type InvoiceFilters = {
	status?: number;
	contactId?: number;
	overdueOnly?: boolean; // when true, only return rows where isOverdue===true
	search?: string; // matches invoice_number or reference or contact name
	dateFrom?: string;
	dateTo?: string;
	limit?: number;
	offset?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeTotals(lines: InvoiceLineInput[]): {
	subtotal: number;
	taxAmount: 0;
	total: number;
} {
	const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
	return { subtotal, taxAmount: 0, total: subtotal };
}

export function deriveOverdue(inv: { dueDate: string | null; status: number }): boolean {
	if (!inv.dueDate) return false;
	const today = new Date().toISOString().slice(0, 10);
	return (
		inv.dueDate < today &&
		inv.status !== InvoiceStatus.Paid &&
		inv.status !== InvoiceStatus.Cancelled
	);
}

// ---------------------------------------------------------------------------
// Shared select shape
// ---------------------------------------------------------------------------

const invoiceWithContact = {
	...getTableColumns(invoices),
	contactName:           contacts.legalName,
	contactAddress:        contacts.address,
	contactRegistrationNo: contacts.registrationNo,
	contactPhone:          contacts.phone,
	mainAmount: sql<number>`${invoices.subtotal} * ${invoices.exchangeRate}`
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function listInvoices(db: Db, filters: InvoiceFilters = {}) {
	const { limit = 100, offset = 0, status, contactId, overdueOnly, search, dateFrom, dateTo } =
		filters;

	const conditions: SQL[] = [];
	if (status !== undefined) conditions.push(eq(invoices.status, status));
	if (contactId !== undefined) conditions.push(eq(invoices.contactId, contactId));
	if (dateFrom) conditions.push(gte(invoices.issueDate, dateFrom));
	if (dateTo) conditions.push(lte(invoices.issueDate, dateTo));
	if (overdueOnly) {
		const today = new Date().toISOString().slice(0, 10);
		conditions.push(sql`${invoices.dueDate} < ${today}`);
		conditions.push(
			sql`${invoices.status} NOT IN (${InvoiceStatus.Paid}, ${InvoiceStatus.Cancelled})`
		);
	}
	if (search) {
		const term = `%${search}%`;
		conditions.push(
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			or(
				like(invoices.invoiceNumber, term),
				like(invoices.reference, term),
				like(contacts.legalName, term)
			)!
		);
	}

	const rows = db
		.select(invoiceWithContact)
		.from(invoices)
		.leftJoin(contacts, eq(contacts.id, invoices.contactId))
		.where(conditions.length ? and(...conditions) : undefined)
		.orderBy(desc(invoices.issueDate), desc(invoices.id))
		.limit(limit)
		.offset(offset)
		.all();

	return rows.map((row) => ({ ...row, isOverdue: deriveOverdue(row) }));
}

// ---------------------------------------------------------------------------
// Get single
// ---------------------------------------------------------------------------

export function getInvoice(db: Db, id: number) {
	const row = db
		.select(invoiceWithContact)
		.from(invoices)
		.leftJoin(contacts, eq(contacts.id, invoices.contactId))
		.where(eq(invoices.id, id))
		.get();

	if (!row) return null;

	const lines = db
		.select()
		.from(invoiceLines)
		.where(eq(invoiceLines.invoiceId, id))
		.orderBy(asc(invoiceLines.sortOrder))
		.all();

	return { ...row, lines, isOverdue: deriveOverdue(row) };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function createInvoice(db: Db, userId: number, data: InvoiceCreate) {
	return db.transaction((tx) => {
		if (!data.lines || data.lines.length === 0) {
			throw new Error('Invoice must have at least one line');
		}

		const totals = computeTotals(data.lines);
		const invoiceNumber = nextNumber(tx, 'IV', data.issueDate);

		const { id: newId } = tx
			.insert(invoices)
			.values({
				invoiceNumber,
				contactId: data.contactId ?? null,
				reference: data.reference ?? null,
				issueDate: data.issueDate,
				dueDate: data.dueDate ?? null,
				currency: data.currency ?? 'USD',
				exchangeRate: data.exchangeRate ?? 1,
				subtotal: totals.subtotal,
				taxAmount: totals.taxAmount,
				total: totals.total,
				notes: data.notes ?? null,
				terms: data.terms ?? null,
				sourceQuotationId: data.sourceQuotationId ?? null,
				createdBy: userId,
				updatedBy: userId
			})
			.returning({ id: invoices.id })
			.get()!;

		tx.insert(invoiceLines)
			.values(
				data.lines.map((line, i) => ({
					invoiceId: newId,
					description: line.description,
					quantity: line.quantity,
					unitPrice: line.unitPrice,
					lineTotal: line.quantity * line.unitPrice,
					sortOrder: line.sortOrder ?? i
				}))
			)
			.run();

		return getInvoice(tx, newId)!;
	});
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateInvoice(db: Db, id: number, userId: number, patch: InvoicePatch) {
	return db.transaction((tx) => {
		const existing = tx.select().from(invoices).where(eq(invoices.id, id)).get();
		if (!existing) return null;

		let totalsUpdate: { subtotal: number; taxAmount: 0; total: number } | null = null;
		if (patch.lines) {
			totalsUpdate = computeTotals(patch.lines);
			tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id)).run();
			tx.insert(invoiceLines)
				.values(
					patch.lines.map((line, i) => ({
						invoiceId: id,
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

		tx.update(invoices).set(setValues).where(eq(invoices.id, id)).run();

		return getInvoice(tx, id)!;
	});
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function deleteInvoice(
	db: Db,
	id: number
): { ok: boolean; reason?: 'paid' | 'not_found' } {
	return db.transaction((tx) => {
		const existing = tx
			.select({ status: invoices.status })
			.from(invoices)
			.where(eq(invoices.id, id))
			.get();
		if (!existing) return { ok: false, reason: 'not_found' };
		if (existing.status === InvoiceStatus.Paid) return { ok: false, reason: 'paid' };
		tx.delete(invoices).where(eq(invoices.id, id)).run();
		return { ok: true };
	});
}

// ---------------------------------------------------------------------------
// Mark as Paid (creates linked income record)
// ---------------------------------------------------------------------------

export function markInvoicePaid(
	db: Db,
	id: number,
	userId: number
): {
	ok: boolean;
	reason?: 'not_found' | 'already_paid';
	invoiceId?: number;
	incomeId?: number;
} {
	return db.transaction((tx) => {
		const invoice = tx.select().from(invoices).where(eq(invoices.id, id)).get();
		if (!invoice) return { ok: false, reason: 'not_found' };
		if (invoice.status === InvoiceStatus.Paid) return { ok: false, reason: 'already_paid' };

		const incomeNumber = nextNumber(tx, 'IN', invoice.issueDate);

		const { id: newIncomeId } = tx
			.insert(incomes)
			.values({
				incomeNumber,
				contactId: invoice.contactId ?? null,
				date: invoice.issueDate,
				amount: invoice.total,
				currency: invoice.currency,
				exchangeRate: invoice.exchangeRate,
				descriptionText: invoice.invoiceNumber,
				reference: invoice.invoiceNumber,
				createdBy: userId,
				updatedBy: userId
			})
			.returning({ id: incomes.id })
			.get()!;

		tx.update(invoices)
			.set({
				status: InvoiceStatus.Paid,
				amountPaid: invoice.total,
				resultIncomeId: newIncomeId,
				updatedBy: userId,
				updatedAt: new Date().toISOString()
			})
			.where(eq(invoices.id, id))
			.run();

		return { ok: true, invoiceId: id, incomeId: newIncomeId };
	});
}
