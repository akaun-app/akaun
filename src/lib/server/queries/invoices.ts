import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  sql,
  getTableColumns,
  type SQL,
} from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "../db/schema.js";
import {
  accounts,
  invoices,
  invoiceLines,
  invoiceSearchText,
  contacts,
  ledgerMovements,
} from "../db/schema.js";
import { nextNumber } from "../running-number.js";
import { AccountRole, InvoiceStatus } from "$lib/enums.js";
import {
  upsertSearchText,
  searchTextExists,
  joinSearchText,
} from "../search-text.js";
import { recordAudit, diffRecords } from "../audit.js";
import { toMinor } from "../ledger/money.js";
import { outstandingOf } from "../ledger/settlement-rules.js";
import { settledMinorFor, settlementsForRecord } from "./settlements.js";
import type { LedgerDb, Minor, SettlementSide } from "../ledger/types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type InvoiceLineInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  sortOrder?: number; // defaults to array index if omitted
};

export type InvoiceCreate = {
  contactId?: number | null;
  reference?: string | null;
  issueDate: string; // YYYY-MM-DD, required
  dueDate?: string | null;
  currency?: string; // defaults to 'USD'
  exchangeRate?: number; // defaults to 1
  notes?: string | null;
  terms?: string | null;
  lines: InvoiceLineInput[]; // required, non-empty
  // For conversion from quotation (optional, set by service layer):
  sourceQuotationId?: number | null;
};

export type InvoicePatch = Partial<Omit<InvoiceCreate, "lines">> & {
  lines?: InvoiceLineInput[];
};

export type InvoiceFilters = {
  status?: number;
  contactId?: number;
  overdueOnly?: boolean; // when true, only return rows where isOverdue===true
  search?: string; // matches invoice_number or reference or contact name
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeTotals(lines: InvoiceLineInput[]): {
  subtotal: number;
  taxAmount: 0;
  total: number;
} {
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  return { subtotal, taxAmount: 0, total: subtotal };
}

export function deriveOverdue(
  inv: { dueDate: string | null; status: number },
  paid: boolean,
): boolean {
  if (!inv.dueDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return inv.dueDate < today && !paid && inv.status !== InvoiceStatus.Cancelled;
}

// ---------------------------------------------------------------------------
// How much of an invoice is paid — always computed, never stored (D-10)
// ---------------------------------------------------------------------------

export type InvoicePaymentState = {
  /** The invoice total in whole cents of the main currency. */
  totalMinor: Minor;
  paidMinor: Minor;
  outstandingMinor: Minor;
  paid: boolean;
};

/**
 * What an invoice's payment state is, given the movement issuing it created.
 *
 * Issuing an invoice puts its amount on the Money-owed-to-us account, and a
 * customer's payment is an ordinary settlement against that movement — so how
 * much is paid is that movement's amount less what settlements cover, and
 * nothing needs storing (FR-018a, D-10).
 *
 * An invoice with no movement was either never issued or was issued before the
 * upgrade, which left no ledger history behind it (FR-030). All that is left to
 * read in that case is the document's own status, so that is what is used.
 */
export function invoicePaymentState(
  totalMinor: Minor,
  status: number,
  owedSide: SettlementSide | null,
): InvoicePaymentState {
  if (owedSide) {
    const outstandingMinor = outstandingOf(owedSide);
    return {
      totalMinor,
      paidMinor: Math.abs(owedSide.amountMinor) - outstandingMinor,
      outstandingMinor,
      paid: outstandingMinor === 0,
    };
  }

  if (status === InvoiceStatus.Paid) {
    return {
      totalMinor,
      paidMinor: totalMinor,
      outstandingMinor: 0,
      paid: true,
    };
  }
  // Sent before the upgrade: owed, but with nothing recorded against it.
  if (status === InvoiceStatus.Sent) {
    return {
      totalMinor,
      paidMinor: 0,
      outstandingMinor: totalMinor,
      paid: false,
    };
  }
  // Still a draft, or cancelled — nobody owes anything yet.
  return { totalMinor, paidMinor: 0, outstandingMinor: 0, paid: false };
}

type InvoiceRow = {
  id: number;
  status: number;
  total: number;
  exchangeRate: number;
  ledgerRecordId: number | null;
};

/**
 * The payment state of a whole page of invoices, in two statements however many
 * invoices there are.
 */
function paymentStatesFor(
  db: Db,
  rows: InvoiceRow[],
): Map<number, InvoicePaymentState> {
  const recordIds = rows
    .map((r) => r.ledgerRecordId)
    .filter((id): id is number => id !== null);

  const owedMovements = recordIds.length
    ? db
        .select({
          recordId: ledgerMovements.recordId,
          movementId: ledgerMovements.id,
          amountMinor: ledgerMovements.amountMinor,
        })
        .from(ledgerMovements)
        .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
        .where(
          and(
            inArray(ledgerMovements.recordId, recordIds),
            eq(accounts.role, AccountRole.Receivable),
          ),
        )
        .all()
    : [];

  const settled = settledMinorFor(
    db as LedgerDb,
    owedMovements.map((m) => m.movementId),
  );
  const byRecord = new Map(owedMovements.map((m) => [m.recordId, m]));

  const out = new Map<number, InvoicePaymentState>();
  for (const row of rows) {
    const movement =
      row.ledgerRecordId === null
        ? undefined
        : byRecord.get(row.ledgerRecordId);
    const owedSide: SettlementSide | null = movement
      ? {
          movementId: movement.movementId,
          amountMinor: movement.amountMinor,
          settledMinor: settled.get(movement.movementId) ?? 0,
        }
      : null;
    out.set(
      row.id,
      invoicePaymentState(
        toMinor(row.total, row.exchangeRate),
        row.status,
        owedSide,
      ),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Search text
// ---------------------------------------------------------------------------

function contactNameFor(db: Db, contactId: number | null | undefined): string {
  if (!contactId) return "";
  const row = db
    .select({ legalName: contacts.legalName })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .get();
  return row?.legalName ?? "";
}

/** Recomputes and upserts invoice_search_text for one invoice. Also used by the search-rebuild worker. */
export function reindexInvoice(db: Db, invoiceId: number) {
  const row = db
    .select()
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .get();
  if (!row) return;
  const lines = db
    .select({ description: invoiceLines.description })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .all();
  const text = joinSearchText(
    row.invoiceNumber,
    contactNameFor(db, row.contactId),
    row.reference,
    row.notes,
    row.terms,
    ...lines.map((l) => l.description),
  );
  upsertSearchText(
    db,
    invoiceSearchText,
    invoiceSearchText.invoiceId,
    invoiceSearchText.text,
    invoiceId,
    text,
  );
}

// ---------------------------------------------------------------------------
// Shared select shape
// ---------------------------------------------------------------------------

const invoiceWithContact = {
  ...getTableColumns(invoices),
  contactName: contacts.legalName,
  contactAddress: contacts.address,
  contactRegistrationNo: contacts.registrationNo,
  contactPhone: contacts.phone,
  mainAmount: sql<number>`${invoices.subtotal} * ${invoices.exchangeRate}`,
};

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function listInvoices(db: Db, filters: InvoiceFilters = {}) {
  const {
    limit = 100,
    offset = 0,
    status,
    contactId,
    overdueOnly,
    search,
    dateFrom,
    dateTo,
  } = filters;

  const conditions: SQL[] = [];
  if (status !== undefined) conditions.push(eq(invoices.status, status));
  if (contactId !== undefined)
    conditions.push(eq(invoices.contactId, contactId));
  if (dateFrom) conditions.push(gte(invoices.issueDate, dateFrom));
  if (dateTo) conditions.push(lte(invoices.issueDate, dateTo));
  if (overdueOnly) {
    // Past due is a column, but "still unpaid" is derived from settlements, so
    // the query narrows to what it can and the final filter happens below.
    const today = new Date().toISOString().slice(0, 10);
    conditions.push(sql`${invoices.dueDate} < ${today}`);
    conditions.push(sql`${invoices.status} != ${InvoiceStatus.Cancelled}`);
  }
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      searchTextExists(
        invoiceSearchText,
        invoiceSearchText.invoiceId,
        invoiceSearchText.text,
        invoices.id,
        term,
      ),
    );
  }

  const rows = db
    .select(invoiceWithContact)
    .from(invoices)
    .leftJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(invoices.issueDate), desc(invoices.id))
    .limit(limit)
    .offset(offset)
    .all();

  const states = paymentStatesFor(db, rows);
  const withState = rows.map((row) => {
    const state = states.get(row.id)!;
    return { ...row, ...state, isOverdue: deriveOverdue(row, state.paid) };
  });

  return overdueOnly ? withState.filter((row) => row.isOverdue) : withState;
}

// ---------------------------------------------------------------------------
// Get single
// ---------------------------------------------------------------------------

export function getInvoice(db: Db, id: number) {
  const row = db
    .select(invoiceWithContact)
    .from(invoices)
    .leftJoin(contacts, eq(contacts.id, invoices.contactId))
    .where(eq(invoices.id, id))
    .get();

  if (!row) return null;

  const lines = db
    .select()
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, id))
    .orderBy(asc(invoiceLines.sortOrder))
    .all();

  const state = paymentStatesFor(db, [row]).get(id)!;
  // What has actually been paid against it, for the "payments" list on the
  // detail sheet. Empty until the invoice is sent — there is nothing to pay yet.
  const settlements =
    row.ledgerRecordId === null
      ? []
      : settlementsForRecord(db as LedgerDb, row.ledgerRecordId);

  return {
    ...row,
    ...state,
    lines,
    settlements,
    isOverdue: deriveOverdue(row, state.paid),
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function createInvoice(db: Db, userId: number, data: InvoiceCreate) {
  return db.transaction((tx) => {
    if (!data.lines || data.lines.length === 0) {
      throw new Error("Invoice must have at least one line");
    }

    const totals = computeTotals(data.lines);
    const invoiceNumber = nextNumber(tx, "invoice", data.issueDate);

    const { id: newId } = tx
      .insert(invoices)
      .values({
        invoiceNumber,
        contactId: data.contactId ?? null,
        reference: data.reference ?? null,
        issueDate: data.issueDate,
        dueDate: data.dueDate ?? null,
        currency: data.currency ?? "USD",
        exchangeRate: data.exchangeRate ?? 1,
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        total: totals.total,
        notes: data.notes ?? null,
        terms: data.terms ?? null,
        sourceQuotationId: data.sourceQuotationId ?? null,
        createdBy: userId,
        updatedBy: userId,
      })
      .returning({ id: invoices.id })
      .get()!;

    tx.insert(invoiceLines)
      .values(
        data.lines.map((line, i) => ({
          invoiceId: newId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          lineTotal: line.quantity * line.unitPrice,
          sortOrder: line.sortOrder ?? i,
        })),
      )
      .run();

    reindexInvoice(tx, newId);
    recordAudit(tx, {
      recordType: "invoice",
      recordId: newId,
      userId,
      action: "create",
    });
    return getInvoice(tx, newId)!;
  });
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export function updateInvoice(
  db: Db,
  id: number,
  userId: number,
  patch: InvoicePatch,
) {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .get();
    if (!existing) return null;

    let totalsUpdate: { subtotal: number; taxAmount: 0; total: number } | null =
      null;
    if (patch.lines) {
      totalsUpdate = computeTotals(patch.lines);
      tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id)).run();
      tx.insert(invoiceLines)
        .values(
          patch.lines.map((line, i) => ({
            invoiceId: id,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            lineTotal: line.quantity * line.unitPrice,
            sortOrder: line.sortOrder ?? i,
          })),
        )
        .run();
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { lines: _lines, ...headerPatch } = patch;
    const setValues = {
      ...headerPatch,
      ...(totalsUpdate ?? {}),
      updatedBy: userId,
      updatedAt: new Date().toISOString(),
    };

    tx.update(invoices).set(setValues).where(eq(invoices.id, id)).run();

    reindexInvoice(tx, id);
    const updatedRow = tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .get();
    recordAudit(tx, {
      recordType: "invoice",
      recordId: id,
      userId,
      action: "update",
      changes: diffRecords(existing, updatedRow),
    });
    return getInvoice(tx, id)!;
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export function deleteInvoice(
  db: Db,
  id: number,
  userId: number,
): { ok: boolean; reason?: "issued" | "not_found" } {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .get();
    if (!existing) return { ok: false, reason: "not_found" };
    // Once it has been sent, its amount sits in Money owed to us. Deleting the
    // document would leave that behind with nothing to explain it, so a sent
    // invoice is cancelled rather than deleted.
    if (existing.ledgerRecordId !== null)
      return { ok: false, reason: "issued" };
    tx.delete(invoices).where(eq(invoices.id, id)).run();
    recordAudit(tx, {
      recordType: "invoice",
      recordId: id,
      userId,
      action: "delete",
      changes: diffRecords(existing, null),
    });
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Issue (FR-018a)
// ---------------------------------------------------------------------------

/**
 * Records that the invoice has been sent and which record and income account
 * that produced. The record itself is created by `services/invoices.ts`, which
 * owns the rule; this is only the write.
 */
export function markInvoiceIssued(
  db: Db,
  id: number,
  userId: number,
  issued: { ledgerRecordId: number; incomeAccountId: number },
) {
  return db.transaction((tx) => {
    const existing = tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, id))
      .get()!;
    tx.update(invoices)
      .set({
        status: InvoiceStatus.Sent,
        ledgerRecordId: issued.ledgerRecordId,
        incomeAccountId: issued.incomeAccountId,
        updatedBy: userId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(invoices.id, id))
      .run();
    const updated = tx.select().from(invoices).where(eq(invoices.id, id)).get();
    recordAudit(tx, {
      recordType: "invoice",
      recordId: id,
      userId,
      action: "update",
      changes: diffRecords(existing, updated),
    });
    return getInvoice(tx, id)!;
  });
}
