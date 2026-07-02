import { QuotationStatus, InvoiceStatus, ClaimStatus } from '$lib/enums.js';

// Amount and status are settled accounting data — locked permanently once the expense is
// linked to a claim. No override.
export function canEditAmount(expense: { claimId: number | null }): boolean {
	return expense.claimId === null;
}

// Attachments are supporting documents, not accounting data, but once their claim is
// reconciled (Done) they're locked permanently — same protection as the claim itself.
export function canDeleteExpenseAttachment(expense: {
	claimId: number | null;
	claimStatus: number | null;
}): boolean {
	return expense.claimId === null || expense.claimStatus !== ClaimStatus.Done;
}

// A reconciled (Done) claim's date and linked expenses are immutable, and so is the claim
// itself — editing or deleting settled accounting data is never allowed.
export function canEditClaimData(claim: { status: number }): boolean {
	return claim.status !== ClaimStatus.Done;
}

export function canEditQuotation(quotation: { status: number }): boolean {
	return quotation.status !== QuotationStatus.Converted;
}

export function canEditInvoice(invoice: { status: number }): boolean {
	return invoice.status !== InvoiceStatus.Paid && invoice.status !== InvoiceStatus.Cancelled;
}
