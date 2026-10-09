import {
  InvoiceStatus,
  QuotationStatus,
  QuotationStatusLabels,
} from "$lib/enums.js";

/**
 * The status rules for quotations and invoices, written once for both sides.
 *
 * Outside `$lib/server` on purpose: the screens and the endpoints import this
 * same file, so there is no `// Mirrors` copy to keep in step by hand.
 *
 * Each key is one of `StatusBadge.svelte`'s lowercase `byLabel` keys. A badge
 * given anything else falls back to "Unpaid", which is how both detail pages
 * came to show the wrong chip.
 */

export type InvoiceStatusKey =
  | "cancelled"
  | "draft"
  | "paid"
  | "part-paid"
  | "overdue"
  | "sent";

/**
 * What an invoice's chip says. The stored status only ever says draft, sent or
 * cancelled; paid and part-paid come from what has been settled against it, and
 * overdue from its due date (D-10).
 */
export function invoiceStatusKey(inv: {
  status: number;
  paid: boolean;
  paidMinor: number;
  isOverdue: boolean;
}): InvoiceStatusKey {
  if (inv.status === InvoiceStatus.Cancelled) return "cancelled";
  if (inv.status === InvoiceStatus.Draft) return "draft";
  if (inv.paid) return "paid";
  if (inv.isOverdue) return "overdue";
  if (inv.paidMinor > 0) return "part-paid";
  return "sent";
}

/** What a quotation's chip says. Expired is worked out from the date, never stored. */
export function quotationStatusKey(q: {
  status: number;
  isExpired: boolean;
}): string {
  if (
    q.isExpired &&
    (q.status === QuotationStatus.Draft || q.status === QuotationStatus.Sent)
  ) {
    return "expired";
  }
  return QuotationStatusLabels[q.status] ?? "draft";
}

const QUOTATION_CODES = new Set<number>(Object.values(QuotationStatus));

/**
 * Whether a quotation may be moved from one status to another by hand.
 *
 * Converted is reached only by converting, and left only by deleting the
 * invoice it became, so it is never a choice on either end.
 */
export function canSetQuotationStatus(from: number, to: number): boolean {
  if (!QUOTATION_CODES.has(from) || !QUOTATION_CODES.has(to)) return false;
  if (from === QuotationStatus.Converted || to === QuotationStatus.Converted) {
    return false;
  }
  return from !== to;
}

/** A quote becomes an invoice once it has gone to the customer: Sent or Accepted. */
export function canConvert(q: { status: number }): boolean {
  return (
    q.status === QuotationStatus.Sent || q.status === QuotationStatus.Accepted
  );
}

/**
 * Whether an invoice can be voided: it was sent, and nothing has been paid
 * against it. An invoice cancelled before voiding removed its posting still
 * carries one, and can be finished the same way.
 */
export function canCancelInvoice(inv: {
  status: number;
  ledgerRecordId: number | null;
  paidMinor: number;
}): boolean {
  if (inv.paidMinor > 0) return false;
  if (inv.status === InvoiceStatus.Sent) return true;
  return inv.status === InvoiceStatus.Cancelled && inv.ledgerRecordId !== null;
}
