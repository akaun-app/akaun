import {
	createInvoice as _create,
	updateInvoice as _update,
	deleteInvoice as _delete,
	getInvoice,
	markInvoicePaid as _pay,
	type InvoiceCreate,
	type InvoicePatch
} from '$lib/server/queries/invoices.js';
import { getIncome } from '$lib/server/queries/income.js';
import { invoiceEvents, incomeEvents } from '$lib/server/finance/events.js';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export function createInvoice(db: Db, actingUserId: number, data: InvoiceCreate) {
	const invoice = _create(db, actingUserId, data);
	invoiceEvents.emit('invoice-update', { item: getInvoice(db, invoice.id) });
	return invoice;
}

export function patchInvoice(db: Db, id: number, actingUserId: number, patch: InvoicePatch) {
	const invoice = _update(db, id, actingUserId, patch);
	if (invoice) invoiceEvents.emit('invoice-update', { item: getInvoice(db, id) });
	return invoice;
}

export function removeInvoice(db: Db, id: number) {
	const result = _delete(db, id);
	if (result.ok) invoiceEvents.emit('invoice-delete', { id });
	return result;
}

export function payInvoice(db: Db, id: number, userId: number) {
	const result = _pay(db, id, userId);
	if (result.ok) {
		const updatedInvoice = getInvoice(db, result.invoiceId!);
		const incomeRow = result.incomeId ? getIncome(db, result.incomeId) : null;
		if (updatedInvoice) invoiceEvents.emit('invoice-update', { item: updatedInvoice });
		if (incomeRow) incomeEvents.emit('income-update', { item: incomeRow });
	}
	return result;
}
