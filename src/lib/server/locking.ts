import { QuotationStatus } from "$lib/enums.js";

// A record's own locking rules live with the ledger, in
// $lib/server/ledger/locking.ts: a record is fixed once a payment has settled it
// or a bank line has been matched to it (FR-017a). The claim rules that used to
// live here are gone with claims themselves — a claim is now a payment plus the
// settlements saying what it covered, and "settled" is what locks the records it
// covered.
//
// Re-exported here so the document-lifecycle rules below and the record rules
// stay one import for a caller that needs both.
export {
  ALWAYS_EDITABLE_FIELDS,
  canDeleteRecord,
  canEditField,
  lockStateOf,
  LOCKED_FIELDS,
} from "./ledger/locking.js";

export function canEditQuotation(quotation: { status: number }): boolean {
  return quotation.status !== QuotationStatus.Converted;
}

// `canEditInvoice` used to live here. It gated on `InvoiceStatus.Paid`, and
// nothing writes that status any more — whether an invoice is paid is worked out
// from the settlements against its side on the shared owed account (D-10), and
// `invoices.status` now carries only the document lifecycle: draft, sent,
// cancelled. A rule that tests a value nothing sets describes nothing, so it and
// its test are gone rather than left to look load-bearing. What it used to do —
// sealing an issued invoice's amount, date, customer and lines — is enforced in
// `PATCH /api/invoices/[id]`, against `ledger_record_id` being set.
