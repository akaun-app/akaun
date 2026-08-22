import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInvoice: vi.fn(),
  markInvoiceIssued: vi.fn(),
  createRecord: vi.fn(),
  requireAccountDefault: vi.fn(),
}));

vi.mock("$lib/server/queries/invoices.js", () => ({
  createInvoice: vi.fn(),
  updateInvoice: vi.fn(),
  deleteInvoice: vi.fn(),
  getInvoice: mocks.getInvoice,
  markInvoiceIssued: mocks.markInvoiceIssued,
}));
vi.mock("$lib/server/services/ledger.js", () => ({
  createRecord: mocks.createRecord,
}));
vi.mock("$lib/server/services/account-defaults.js", () => ({
  requireAccountDefault: mocks.requireAccountDefault,
}));

import { issueInvoice } from "./invoices.js";

describe("issuing an invoice with saved defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getInvoice.mockReturnValue({
      id: 1,
      ledgerRecordId: null,
      status: 1,
      contactId: 5,
      issueDate: "2026-08-21",
      invoiceNumber: "INV-1",
      total: 125,
      currency: "MYR",
      exchangeRate: 1,
    });
    mocks.requireAccountDefault.mockReturnValue({ ok: true, value: 44 });
    mocks.createRecord.mockReturnValue({ ok: true, value: { id: 99 } });
    mocks.markInvoiceIssued.mockReturnValue({ id: 1, ledgerRecordId: 99 });
  });

  it("uses the saved sales revenue account when no override is supplied", () => {
    expect(issueInvoice({} as never, 1, 7).ok).toBe(true);
    expect(mocks.createRecord).toHaveBeenCalledWith(
      expect.anything(),
      7,
      expect.objectContaining({ incomeAccountId: 44 }),
    );
  });

  it("does not create a partial record when the saved account is missing or invalid", () => {
    mocks.requireAccountDefault.mockReturnValue({
      ok: false,
      reason: "Choose a valid default.",
    });
    expect(issueInvoice({} as never, 1, 7)).toEqual({
      ok: false,
      reason: "Choose a valid default.",
    });
    expect(mocks.createRecord).not.toHaveBeenCalled();
    expect(mocks.markInvoiceIssued).not.toHaveBeenCalled();
  });
});
