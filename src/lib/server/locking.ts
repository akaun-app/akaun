import { QuotationStatus, InvoiceStatus } from '$lib/enums.js';

export function canEditAmount(expense: { claimId: number | null }): boolean {
	return expense.claimId === null;
}

export function canEditDescriptive(
	expense: { claimId: number | null },
	godMode: boolean
): boolean {
	return expense.claimId === null || godMode;
}

export function canEditQuotation(quotation: { status: number }): boolean {
	return quotation.status !== QuotationStatus.Converted;
}

export function canEditInvoice(invoice: { status: number }): boolean {
	return invoice.status !== InvoiceStatus.Paid && invoice.status !== InvoiceStatus.Cancelled;
}
