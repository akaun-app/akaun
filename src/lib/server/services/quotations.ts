import {
	createQuotation as _create,
	updateQuotation as _update,
	deleteQuotation as _delete,
	getQuotation,
	convertQuotationToInvoice as _convert,
	type QuotationCreate,
	type QuotationPatch
} from '$lib/server/queries/quotations.js';
import { getInvoice } from '$lib/server/queries/invoices.js';
import { quotationEvents, invoiceEvents } from '$lib/server/finance/events.js';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export function createQuotation(db: Db, actingUserId: number, data: QuotationCreate) {
	const quotation = _create(db, actingUserId, data);
	quotationEvents.emit('quotation-update', { item: getQuotation(db, quotation.id) });
	return quotation;
}

export function patchQuotation(db: Db, id: number, actingUserId: number, patch: QuotationPatch) {
	const quotation = _update(db, id, actingUserId, patch);
	if (quotation) quotationEvents.emit('quotation-update', { item: getQuotation(db, id) });
	return quotation;
}

export function removeQuotation(db: Db, id: number) {
	const result = _delete(db, id);
	if (result.ok) quotationEvents.emit('quotation-delete', { id });
	return result;
}

export function convertToInvoice(db: Db, quotationId: number, userId: number) {
	const result = _convert(db, quotationId, userId);
	if (result.ok) {
		const updatedQuotation = getQuotation(db, result.quotationId!);
		const newInvoice = getInvoice(db, result.invoiceId!);
		if (updatedQuotation) quotationEvents.emit('quotation-update', { item: updatedQuotation });
		if (newInvoice) invoiceEvents.emit('invoice-update', { item: newInvoice });
	}
	return result;
}
