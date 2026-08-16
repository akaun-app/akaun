import { describe, expect, it } from "vitest";
import { QuotationStatus } from "$lib/enums.js";
import { canEditQuotation } from "./locking.js";

// Two sets of rules used to be covered here and are gone, both because the thing
// they described stopped existing:
//
//   - the claim-correction rules — a claim is now a payment plus the settlements
//     saying what it covered, and what locks a record is a settlement or a bank
//     match. Covered by ledger/locking.spec.ts.
//   - `canEditInvoice` — it gated on `InvoiceStatus.Paid`, which nothing writes
//     now that paid is derived from settlements (D-10).
//
// A test that pins a rule nothing enforces is worse than no test: it passes
// forever and implies cover that is not there (Constitution V). What survives is
// the one document-lifecycle rule still in force.

describe("a quotation stops being editable once it has become an invoice", () => {
  it("is editable in every state before that", () => {
    expect(canEditQuotation({ status: QuotationStatus.Draft })).toBe(true);
    expect(canEditQuotation({ status: QuotationStatus.Sent })).toBe(true);
    expect(canEditQuotation({ status: QuotationStatus.Accepted })).toBe(true);
    expect(canEditQuotation({ status: QuotationStatus.Declined })).toBe(true);
  });

  it("is not editable once converted, because the invoice now depends on it", () => {
    expect(canEditQuotation({ status: QuotationStatus.Converted })).toBe(false);
  });
});
