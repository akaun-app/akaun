import { QuotationStatus, InvoiceStatus, ClaimStatus } from '$lib/enums.js';

export function canEditAmount(expense: { claimId: number | null }): boolean {
	return expense.claimId === null;
}

export function canEditDescriptive(
	expense: { claimId: number | null },
	godMode: boolean
): boolean {
	return expense.claimId === null || godMode;
}

// Attachments are supporting documents, not accounting data — god mode may bypass this lock,
// same as claim/claim-attachment deletion.
export function canDeleteExpenseAttachment(
	expense: { claimId: number | null; claimStatus: number | null },
	godMode: boolean
): boolean {
	return expense.claimId === null || expense.claimStatus !== ClaimStatus.Done || godMode;
}

// A reconciled (Done) claim's date and linked expenses are immutable — no god-mode override.
// Editing settled accounting data (unlike deleting it) is never allowed.
export function canEditClaimData(claim: { status: number }): boolean {
	return claim.status !== ClaimStatus.Done;
}

// Deleting a Done claim/its attachments is a guarded action — god mode may bypass this lock.
export function canDeleteClaim(claim: { status: number }, godMode: boolean): boolean {
	return claim.status !== ClaimStatus.Done || godMode;
}

export function canEditQuotation(quotation: { status: number }): boolean {
	return quotation.status !== QuotationStatus.Converted;
}

export function canEditInvoice(invoice: { status: number }): boolean {
	return invoice.status !== InvoiceStatus.Paid && invoice.status !== InvoiceStatus.Cancelled;
}
