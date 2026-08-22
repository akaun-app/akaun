import {
  createInvoice as _create,
  updateInvoice as _update,
  deleteInvoice as _delete,
  markInvoiceIssued,
  getInvoice,
  type InvoiceCreate,
  type InvoicePatch,
} from "$lib/server/queries/invoices.js";
import { createRecord } from "$lib/server/services/ledger.js";
import { requireAccountDefault } from "$lib/server/services/account-defaults.js";
import { invoiceEvents } from "$lib/server/finance/events.js";
import { DefaultAccountPurpose, InvoiceStatus } from "$lib/enums.js";
import type { LedgerDb, Refusable } from "$lib/server/ledger/types.js";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<any>;

export function createInvoice(
  db: Db,
  actingUserId: number,
  data: InvoiceCreate,
) {
  const invoice = _create(db, actingUserId, data);
  invoiceEvents.emit("invoice-update", { item: getInvoice(db, invoice.id) });
  return invoice;
}

export function patchInvoice(
  db: Db,
  id: number,
  actingUserId: number,
  patch: InvoicePatch,
) {
  const invoice = _update(db, id, actingUserId, patch);
  if (invoice)
    invoiceEvents.emit("invoice-update", { item: getInvoice(db, id) });
  return invoice;
}

export function removeInvoice(db: Db, id: number, actingUserId: number) {
  const result = _delete(db, id, actingUserId);
  if (result.ok) invoiceEvents.emit("invoice-delete", { id });
  return result;
}

/**
 * Sending an invoice to the customer.
 *
 * Issuing is what puts the invoice into the books: its amount goes into Money
 * owed to us tagged with that customer, and out of the income account it earns
 * into. From then on the customer's payment is an ordinary payment settling
 * that amount, exactly like any other debt — so instalments and part payments
 * need nothing invoice-specific (FR-018a).
 */
export function issueInvoice(
  db: Db,
  id: number,
  actingUserId: number,
  options: { incomeAccountId?: number } = {},
): Refusable<NonNullable<ReturnType<typeof getInvoice>>> {
  const invoice = getInvoice(db, id);
  if (!invoice) return { ok: false, reason: "That invoice no longer exists." };

  if (
    invoice.ledgerRecordId !== null ||
    invoice.status !== InvoiceStatus.Draft
  ) {
    return { ok: false, reason: "This invoice has already been sent." };
  }
  if (invoice.contactId === null) {
    return {
      ok: false,
      reason:
        "Choose a customer first — sending the invoice records that they owe you this amount.",
    };
  }

  const savedIncome =
    options.incomeAccountId === undefined
      ? requireAccountDefault(
          db as LedgerDb,
          DefaultAccountPurpose.SalesRevenue,
        )
      : ({ ok: true, value: options.incomeAccountId } as const);
  if (!savedIncome.ok) return savedIncome;
  const incomeAccountId = savedIncome.value;

  const record = createRecord(db as LedgerDb, actingUserId, {
    kind: "invoice-issue",
    date: invoice.issueDate,
    description: `Invoice ${invoice.invoiceNumber}`,
    amount: invoice.total,
    currency: invoice.currency,
    exchangeRate: invoice.exchangeRate,
    contactId: invoice.contactId,
    reference: invoice.invoiceNumber,
    incomeAccountId,
  });
  if (!record.ok) return record;

  const issued = markInvoiceIssued(db, id, actingUserId, {
    ledgerRecordId: record.value.id,
    incomeAccountId,
  });
  invoiceEvents.emit("invoice-update", { item: issued });
  return { ok: true, value: issued };
}
