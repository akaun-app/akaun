import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  accounts,
  contacts,
  ledgerMovements,
  ledgerRecords,
  recordAttachments,
  recordSearchText,
  reconciliationAllocations,
  settlements,
} from "../db/schema.js";
import {
  AccountRole,
  LedgerRecordKind,
  type AccountRoleCode,
  type LedgerRecordKindCode,
} from "$lib/enums.js";
import { isSharedOwedRole } from "../ledger/account-type.js";
import { lockStateOf } from "../ledger/locking.js";
import { toMinor } from "../ledger/money.js";
import { recordSettlementState } from "../ledger/settlement-rules.js";
import type {
  LedgerDb,
  LedgerRecordRow,
  LegacyKind,
  LockState,
  Minor,
  MovementDraft,
  MovementView,
  RecordAttachmentRow,
  RecordBalanceInput,
  RecordCreate,
  RecordListFilters,
  RecordListResult,
  RecordView,
  SettlementSide,
} from "../ledger/types.js";
import { nextNumber } from "../running-number.js";
import {
  joinSearchText,
  searchTextExists,
  upsertSearchText,
} from "../search-text.js";
import type { SequenceDocumentType } from "../db/schema.js";

/**
 * Every read and write of the one record store.
 *
 * Nothing about payment state is stored. `paid`, `outstandingMinor` and
 * `locked` are computed on the way out of here from settlements and
 * reconciliation allocations, which is what stops two screens disagreeing
 * (FR-012). A list page costs a fixed handful of statements however many rows
 * it holds — the movements, settlements, matches and attachment counts for the
 * whole page are fetched once each and stitched together in memory, rather than
 * a query per row.
 *
 * Movements are only ever written from `entry-builder.ts`'s output, which is
 * where the balance rule is enforced. Nothing here constructs a movement.
 */

/**
 * Which running-number counter issues a record's number, or null for the kinds
 * that carry none (D-13). A transfer, an opening balance and a journal entry
 * are internal bookkeeping, not documents anyone refers to by number; an issued
 * invoice is referred to by the invoice's own number.
 */
function sequenceFor(kind: LedgerRecordKindCode): SequenceDocumentType | null {
  switch (kind) {
    case LedgerRecordKind.Expense:
      return "expense";
    case LedgerRecordKind.Income:
      return "income";
    case LedgerRecordKind.Payment:
      return "payment";
    default:
      return null;
  }
}

const KIND_BY_NAME: Record<RecordCreate["kind"], LedgerRecordKindCode> = {
  expense: LedgerRecordKind.Expense,
  income: LedgerRecordKind.Income,
  transfer: LedgerRecordKind.Transfer,
  payment: LedgerRecordKind.Payment,
  "opening-balance": LedgerRecordKind.OpeningBalance,
  "invoice-issue": LedgerRecordKind.InvoiceIssue,
  journal: LedgerRecordKind.Journal,
};

export function kindCodeFor(kind: RecordCreate["kind"]): LedgerRecordKindCode {
  return KIND_BY_NAME[kind];
}

function toRecordRow(row: typeof ledgerRecords.$inferSelect): LedgerRecordRow {
  return {
    id: row.id,
    kind: row.kind as LedgerRecordKindCode,
    date: row.date,
    recordNumber: row.recordNumber,
    description: row.description,
    contactId: row.contactId,
    reference: row.reference,
    remark: row.remark,
    currency: row.currency,
    exchangeRate: row.exchangeRate,
    amount: row.amount,
    extractedText: row.extractedText,
    legacyKind: row.legacyKind as LegacyKind | null,
    legacyId: row.legacyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Search text
// ---------------------------------------------------------------------------

/**
 * Everything a record can be found by. The record number goes in exactly as it
 * was issued, so searching for a reference number someone wrote down still
 * finds the record after the upgrade (SC-013).
 */
export function buildRecordSearchText(parts: {
  recordNumber: string | null;
  description: string;
  reference: string;
  remark: string;
  contactName: string | null;
  accountNames: string[];
  extractedText: string | null;
}): string {
  return joinSearchText(
    parts.recordNumber,
    parts.description,
    parts.contactName,
    parts.reference,
    parts.remark,
    ...parts.accountNames,
    parts.extractedText,
  );
}

/** Recomputes and upserts one record's search text. Also used by the rebuild worker. */
export function reindexRecord(db: LedgerDb, recordId: number): void {
  const row = db
    .select()
    .from(ledgerRecords)
    .where(eq(ledgerRecords.id, recordId))
    .get();
  if (!row) return;

  const contactName = row.contactId
    ? (db
        .select({ legalName: contacts.legalName })
        .from(contacts)
        .where(eq(contacts.id, row.contactId))
        .get()?.legalName ?? null)
    : null;

  const accountNames = db
    .select({ name: accounts.name })
    .from(ledgerMovements)
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(eq(ledgerMovements.recordId, recordId))
    .all()
    .map((r) => r.name);

  upsertSearchText(
    db,
    recordSearchText,
    recordSearchText.recordId,
    recordSearchText.text,
    recordId,
    buildRecordSearchText({
      recordNumber: row.recordNumber,
      description: row.description,
      reference: row.reference,
      remark: row.remark,
      contactName,
      accountNames,
      extractedText: row.extractedText,
    }),
  );
}

/**
 * Sets just the extracted-text column and re-indexes, without touching
 * updatedBy/updatedAt — a bulk re-extraction must not look like a user edit.
 */
export function setExtractedText(
  db: LedgerDb,
  recordId: number,
  text: string | null,
): void {
  db.update(ledgerRecords)
    .set({ extractedText: text })
    .where(eq(ledgerRecords.id, recordId))
    .run();
  reindexRecord(db, recordId);
}

// ---------------------------------------------------------------------------
// Derived state — settlements and bank matches, for a page of records at once
// ---------------------------------------------------------------------------

type DerivedState = {
  movements: Map<number, MovementView[]>;
  paidState: Map<number, { paid: boolean; outstandingMinor: Minor }>;
  lockState: Map<number, LockState>;
  attachmentCount: Map<number, number>;
};

/**
 * How much of each of these movements settlements already cover.
 *
 * A movement counts as covered whether it is the side being paid or the side
 * doing the paying, so undoing a settlement gives both of them back what it
 * took (FR-017).
 */
function settledByMovement(
  db: LedgerDb,
  movementIds: number[],
): Map<number, Minor> {
  const out = new Map<number, Minor>();
  if (movementIds.length === 0) return out;

  const rows = db
    .select({
      paymentMovementId: settlements.paymentMovementId,
      owedMovementId: settlements.owedMovementId,
      amountMinor: settlements.amountMinor,
    })
    .from(settlements)
    .where(
      or(
        inArray(settlements.paymentMovementId, movementIds),
        inArray(settlements.owedMovementId, movementIds),
      ),
    )
    .all();

  const wanted = new Set(movementIds);
  for (const row of rows) {
    for (const id of [row.paymentMovementId, row.owedMovementId]) {
      if (!wanted.has(id)) continue;
      out.set(id, (out.get(id) ?? 0) + row.amountMinor);
    }
  }
  return out;
}

/** Which of these movements a bank line has been matched to. */
function matchedMovements(db: LedgerDb, movementIds: number[]): Set<number> {
  if (movementIds.length === 0) return new Set();
  const rows = db
    .selectDistinct({ movementId: reconciliationAllocations.movementId })
    .from(reconciliationAllocations)
    .where(inArray(reconciliationAllocations.movementId, movementIds))
    .all();
  return new Set(
    rows.map((r) => r.movementId).filter((id): id is number => id !== null),
  );
}

/** Everything derived, for a whole page of records, in a fixed number of queries. */
function deriveFor(db: LedgerDb, recordIds: number[]): DerivedState {
  const empty: DerivedState = {
    movements: new Map(),
    paidState: new Map(),
    lockState: new Map(),
    attachmentCount: new Map(),
  };
  if (recordIds.length === 0) return empty;

  const movementRows = db
    .select({
      id: ledgerMovements.id,
      recordId: ledgerMovements.recordId,
      accountId: ledgerMovements.accountId,
      amountMinor: ledgerMovements.amountMinor,
      sortOrder: ledgerMovements.sortOrder,
      accountName: accounts.name,
      accountRole: accounts.role,
    })
    .from(ledgerMovements)
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(inArray(ledgerMovements.recordId, recordIds))
    .orderBy(asc(ledgerMovements.sortOrder), asc(ledgerMovements.id))
    .all();

  const movementIds = movementRows.map((m) => m.id);
  const settled = settledByMovement(db, movementIds);
  const matched = matchedMovements(db, movementIds);

  const movements = new Map<number, MovementView[]>();
  const owedSides = new Map<number, SettlementSide[]>();
  const lockState = new Map<number, LockState>();

  for (const id of recordIds) {
    movements.set(id, []);
    owedSides.set(id, []);
    lockState.set(id, { settled: false, reconciled: false });
  }

  for (const m of movementRows) {
    const role = m.accountRole as AccountRoleCode;
    movements.get(m.recordId)?.push({
      id: m.id,
      accountId: m.accountId,
      accountName: m.accountName,
      accountRole: role,
      amountMinor: m.amountMinor,
    });

    if (isSharedOwedRole(role)) {
      owedSides.get(m.recordId)?.push({
        movementId: m.id,
        amountMinor: m.amountMinor,
        settledMinor: settled.get(m.id) ?? 0,
      });
    }

    const lock = lockState.get(m.recordId);
    if (lock) {
      if ((settled.get(m.id) ?? 0) > 0) lock.settled = true;
      if (matched.has(m.id)) lock.reconciled = true;
    }
  }

  const paidState = new Map<
    number,
    { paid: boolean; outstandingMinor: Minor }
  >();
  for (const id of recordIds) {
    paidState.set(id, recordSettlementState(owedSides.get(id) ?? []));
  }

  const attachmentRows = db
    .select({
      recordId: recordAttachments.recordId,
      n: sql<number>`count(*)`,
    })
    .from(recordAttachments)
    .where(inArray(recordAttachments.recordId, recordIds))
    .groupBy(recordAttachments.recordId)
    .all();

  return {
    movements,
    paidState,
    lockState,
    attachmentCount: new Map(attachmentRows.map((r) => [r.recordId, r.n])),
  };
}

function toRecordView(
  row: typeof ledgerRecords.$inferSelect,
  contactName: string | null,
  derived: DerivedState,
): RecordView {
  const base = toRecordRow(row);
  const paidState = derived.paidState.get(row.id) ?? {
    paid: true,
    outstandingMinor: 0,
  };
  const lockState = derived.lockState.get(row.id) ?? {
    settled: false,
    reconciled: false,
  };
  const lock = lockStateOf(lockState);
  return {
    ...base,
    contactName,
    amountMinor: toMinor(base.amount, base.exchangeRate),
    movements: derived.movements.get(row.id) ?? [],
    paid: paidState.paid,
    outstandingMinor: paidState.outstandingMinor,
    locked: lock.locked,
    lockedReason: lock.reason,
    reconciled: lockState.reconciled,
    attachmentCount: derived.attachmentCount.get(row.id) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function recordConditions(filters: RecordListFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.kind !== undefined) {
    conditions.push(
      Array.isArray(filters.kind)
        ? inArray(ledgerRecords.kind, filters.kind)
        : eq(ledgerRecords.kind, filters.kind),
    );
  }
  if (filters.contactId !== undefined) {
    conditions.push(eq(ledgerRecords.contactId, filters.contactId));
  }
  if (filters.dateFrom)
    conditions.push(gte(ledgerRecords.date, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(ledgerRecords.date, filters.dateTo));
  if (filters.amountMin !== undefined) {
    conditions.push(gte(ledgerRecords.amount, filters.amountMin));
  }
  if (filters.amountMax !== undefined) {
    conditions.push(lte(ledgerRecords.amount, filters.amountMax));
  }

  // "Records touching this account" and "records in this category" are the same
  // question asked of the movements table, so both are one EXISTS.
  for (const accountId of [filters.accountId, filters.categoryAccountId]) {
    if (accountId === undefined) continue;
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${ledgerMovements} WHERE ${ledgerMovements.recordId} = ${ledgerRecords.id} AND ${ledgerMovements.accountId} = ${accountId})`,
    );
  }

  if (filters.search) {
    conditions.push(
      searchTextExists(
        recordSearchText,
        recordSearchText.recordId,
        recordSearchText.text,
        ledgerRecords.id,
        `%${filters.search}%`,
      ),
    );
  }

  if (filters.paid !== undefined) {
    // Paid means: no side on a shared owed account is still uncovered. Asked of
    // the database rather than of the page, so `paid=false` can be paged
    // through without loading everything first (D-10).
    const stillOwed = sql`EXISTS (
      SELECT 1 FROM ${ledgerMovements}
      INNER JOIN ${accounts} ON ${accounts.id} = ${ledgerMovements.accountId}
      WHERE ${ledgerMovements.recordId} = ${ledgerRecords.id}
        AND ${accounts.role} IN (${AccountRole.Receivable}, ${AccountRole.Payable})
        AND abs(${ledgerMovements.amountMinor}) > coalesce((
          SELECT sum(${settlements.amountMinor}) FROM ${settlements}
          WHERE ${settlements.owedMovementId} = ${ledgerMovements.id}
             OR ${settlements.paymentMovementId} = ${ledgerMovements.id}
        ), 0)
    )`;
    conditions.push(filters.paid ? sql`NOT ${stillOwed}` : stillOwed);
  }

  return conditions;
}

export function listRecords(
  db: LedgerDb,
  filters: RecordListFilters = {},
): RecordListResult {
  const { limit = 100, offset = 0 } = filters;
  const conditions = recordConditions(filters);
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = db
    .select({
      record: ledgerRecords,
      contactName: contacts.legalName,
    })
    .from(ledgerRecords)
    .leftJoin(contacts, eq(contacts.id, ledgerRecords.contactId))
    .where(where)
    .orderBy(desc(ledgerRecords.date), desc(ledgerRecords.id))
    .limit(limit)
    .offset(offset)
    .all();

  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(ledgerRecords)
      .where(where)
      .get()?.n ?? 0;

  const derived = deriveFor(
    db,
    rows.map((r) => r.record.id),
  );

  return {
    records: rows.map((r) =>
      toRecordView(r.record, r.contactName ?? null, derived),
    ),
    total,
  };
}

export function getRecord(db: LedgerDb, id: number): RecordView | null {
  const row = db
    .select({ record: ledgerRecords, contactName: contacts.legalName })
    .from(ledgerRecords)
    .leftJoin(contacts, eq(contacts.id, ledgerRecords.contactId))
    .where(eq(ledgerRecords.id, id))
    .get();
  if (!row) return null;
  return toRecordView(row.record, row.contactName ?? null, deriveFor(db, [id]));
}

/** The raw row, for a caller that needs what is stored rather than what is shown. */
export function getRecordRow(db: LedgerDb, id: number): LedgerRecordRow | null {
  const row = db
    .select()
    .from(ledgerRecords)
    .where(eq(ledgerRecords.id, id))
    .get();
  return row ? toRecordRow(row) : null;
}

/** The record a pre-upgrade link points at, so old URLs keep working (D-14). */
export function findByLegacy(
  db: LedgerDb,
  legacyKind: LegacyKind,
  legacyId: number,
): number | null {
  const row = db
    .select({ id: ledgerRecords.id })
    .from(ledgerRecords)
    .where(
      and(
        eq(ledgerRecords.legacyKind, legacyKind),
        eq(ledgerRecords.legacyId, legacyId),
      ),
    )
    .get();
  return row?.id ?? null;
}

export function getMovements(db: LedgerDb, recordId: number): MovementView[] {
  return deriveFor(db, [recordId]).movements.get(recordId) ?? [];
}

/** Whether a record is settled, matched to a bank line, or both (FR-017a). */
export function lockStateFor(db: LedgerDb, recordId: number): LockState {
  return (
    deriveFor(db, [recordId]).lockState.get(recordId) ?? {
      settled: false,
      reconciled: false,
    }
  );
}

// ---------------------------------------------------------------------------
// Writes — movements always come from entry-builder.ts
// ---------------------------------------------------------------------------

function replaceMovements(
  db: LedgerDb,
  recordId: number,
  movements: MovementDraft[],
): void {
  db.delete(ledgerMovements)
    .where(eq(ledgerMovements.recordId, recordId))
    .run();
  db.insert(ledgerMovements)
    .values(
      movements.map((m) => ({
        recordId,
        accountId: m.accountId,
        amountMinor: m.amountMinor,
        sortOrder: m.sortOrder,
      })),
    )
    .run();
}

export function insertRecord(
  db: LedgerDb,
  actingUserId: number | null,
  data: {
    kind: LedgerRecordKindCode;
    date: string;
    description: string;
    amount: number;
    currency: string;
    exchangeRate: number;
    contactId?: number | null;
    reference?: string;
    remark?: string;
    extractedText?: string | null;
    /** Supplied only by the upgrade, which never regenerates a number (FR-032d). */
    recordNumber?: string | null;
    /** Supplied only by the upgrade, to preserve a migrated expense's id (D-14). */
    id?: number;
    legacyKind?: LegacyKind | null;
    legacyId?: number | null;
  },
  movements: MovementDraft[],
): LedgerRecordRow {
  const sequence = sequenceFor(data.kind);
  const recordNumber =
    data.recordNumber !== undefined
      ? data.recordNumber
      : sequence
        ? nextNumber(db, sequence, data.date)
        : null;

  const row = db
    .insert(ledgerRecords)
    .values({
      ...(data.id !== undefined ? { id: data.id } : {}),
      kind: data.kind,
      date: data.date,
      recordNumber,
      description: data.description,
      contactId: data.contactId ?? null,
      reference: data.reference ?? "",
      remark: data.remark ?? "",
      currency: data.currency,
      exchangeRate: data.exchangeRate,
      amount: data.amount,
      extractedText: data.extractedText ?? null,
      legacyKind: data.legacyKind ?? null,
      legacyId: data.legacyId ?? null,
      createdBy: actingUserId,
      updatedBy: actingUserId,
    })
    .returning()
    .get()!;

  replaceMovements(db, row.id, movements);
  reindexRecord(db, row.id);
  return toRecordRow(row);
}

export function updateRecord(
  db: LedgerDb,
  id: number,
  actingUserId: number | null,
  patch: Partial<{
    date: string;
    description: string;
    amount: number;
    currency: string;
    exchangeRate: number;
    contactId: number | null;
    reference: string;
    remark: string;
    extractedText: string | null;
  }>,
  movements?: MovementDraft[],
): LedgerRecordRow | null {
  const existing = db
    .select()
    .from(ledgerRecords)
    .where(eq(ledgerRecords.id, id))
    .get();
  if (!existing) return null;

  const updated = db
    .update(ledgerRecords)
    .set({
      ...patch,
      updatedBy: actingUserId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(ledgerRecords.id, id))
    .returning()
    .get()!;

  if (movements) replaceMovements(db, id, movements);
  reindexRecord(db, id);
  return toRecordRow(updated);
}

/** The row before a change, for the audit diff. */
export function snapshotForAudit(
  db: LedgerDb,
  id: number,
): Record<string, unknown> | null {
  const row = getRecordRow(db, id);
  if (!row) return null;
  const movements = db
    .select({
      accountId: ledgerMovements.accountId,
      amountMinor: ledgerMovements.amountMinor,
    })
    .from(ledgerMovements)
    .where(eq(ledgerMovements.recordId, id))
    .orderBy(asc(ledgerMovements.sortOrder), asc(ledgerMovements.id))
    .all();
  return { ...row, movements };
}

export function deleteRecord(db: LedgerDb, id: number): boolean {
  // Movements, attachments and search text all cascade from the record.
  const result = db
    .delete(ledgerRecords)
    .where(eq(ledgerRecords.id, id))
    .returning({ id: ledgerRecords.id })
    .get();
  return result !== undefined;
}

// ---------------------------------------------------------------------------
// The whole-books check
// ---------------------------------------------------------------------------

/**
 * Every record reduced to the figures the balance rules need, plus the sum of
 * the whole movements table.
 *
 * Two aggregates, both grouped on indexed columns, so the sweep stays the same
 * shape as the books grow rather than degrading into a scan per record
 * (SC-002). The arithmetic itself is `ledger/integrity.ts`'s, over plain rows.
 */
export function integrityInputs(db: LedgerDb): {
  records: RecordBalanceInput[];
  wholeBooksSumMinor: Minor;
} {
  const rows = db
    .select({
      recordId: ledgerRecords.id,
      kind: ledgerRecords.kind,
      amount: ledgerRecords.amount,
      exchangeRate: ledgerRecords.exchangeRate,
      contactId: ledgerRecords.contactId,
      movementCount: sql<number>`count(${ledgerMovements.id})`,
      movementSumMinor: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
      positiveSumMinor: sql<number>`coalesce(sum(case when ${ledgerMovements.amountMinor} > 0 then ${ledgerMovements.amountMinor} else 0 end), 0)`,
      zeroMovements: sql<number>`coalesce(sum(case when ${ledgerMovements.amountMinor} = 0 then 1 else 0 end), 0)`,
      touchesSharedOwed: sql<number>`coalesce(max(case when ${accounts.role} in (${AccountRole.Receivable}, ${AccountRole.Payable}) then 1 else 0 end), 0)`,
    })
    .from(ledgerRecords)
    .leftJoin(ledgerMovements, eq(ledgerMovements.recordId, ledgerRecords.id))
    .leftJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .groupBy(ledgerRecords.id)
    .all();

  const wholeBooksSumMinor =
    db
      .select({
        total: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
      })
      .from(ledgerMovements)
      .get()?.total ?? 0;

  return {
    records: rows.map((row) => ({
      recordId: row.recordId,
      kind: row.kind as LedgerRecordKindCode,
      movementCount: row.movementCount,
      movementSumMinor: row.movementSumMinor,
      positiveSumMinor: row.positiveSumMinor,
      expectedMinor: toMinor(row.amount, row.exchangeRate),
      hasZeroMovement: row.zeroMovements > 0,
      missingContact: row.touchesSharedOwed === 1 && row.contactId === null,
    })),
    wholeBooksSumMinor,
  };
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export function listAttachments(
  db: LedgerDb,
  recordId: number,
): RecordAttachmentRow[] {
  return db
    .select()
    .from(recordAttachments)
    .where(eq(recordAttachments.recordId, recordId))
    .orderBy(asc(recordAttachments.id))
    .all();
}

export function addAttachment(
  db: LedgerDb,
  recordId: number,
  filename: string,
  displayName: string,
): RecordAttachmentRow {
  return db
    .insert(recordAttachments)
    .values({ recordId, filename, displayName })
    .returning()
    .get()!;
}

export function getAttachment(
  db: LedgerDb,
  attachmentId: number,
): RecordAttachmentRow | null {
  return (
    db
      .select()
      .from(recordAttachments)
      .where(eq(recordAttachments.id, attachmentId))
      .get() ?? null
  );
}

export function deleteAttachment(db: LedgerDb, attachmentId: number): boolean {
  const row = db
    .delete(recordAttachments)
    .where(eq(recordAttachments.id, attachmentId))
    .returning({ id: recordAttachments.id })
    .get();
  return row !== undefined;
}
