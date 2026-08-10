import {
  and,
  eq,
  gte,
  lte,
  inArray,
  sql,
  getTableColumns,
  type SQL,
} from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { alias } from "drizzle-orm/sqlite-core";
import * as schema from "../db/schema.js";
import {
  expenses,
  expenseAttachments,
  expenseSearchText,
  contacts,
  claims,
  reconciliationItemState,
} from "../db/schema.js";
import { nextNumber } from "../running-number.js";
import { ExpenseStatus, ReconItemType } from "$lib/enums.js";
import {
  upsertSearchText,
  searchTextExists,
  joinSearchText,
} from "../search-text.js";
import { recordAudit, diffRecords } from "../audit.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

export type ExpenseFilters = {
  status?: number;
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  search?: string;
  limit?: number;
  offset?: number;
};

export type ExpenseCreate = {
  itemName: string;
  contactId?: number | null;
  reference?: string;
  remark?: string;
  category?: string;
  status?: number;
  date: string;
  amount: number;
  // Currency `amount` is in, and the rate to the main currency. Default to main/1 in
  // callers; when omitted here the DB column defaults apply.
  currency?: string;
  exchangeRate?: number;
  // Raw OCR/PDF text from auto-import (or a search-rebuild re-extraction). See schema.ts.
  extractedText?: string | null;
};

export type ExpensePatch = Partial<ExpenseCreate & { claimId: number | null }>;

function contactNameFor(db: Db, contactId: number | null | undefined): string {
  if (!contactId) return "";
  const row = db
    .select({ legalName: contacts.legalName })
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .get();
  return row?.legalName ?? "";
}

function buildSearchText(
  e: {
    itemName: string;
    reference: string;
    remark: string;
    category: string;
    extractedText: string | null;
  },
  contactName: string,
): string {
  return joinSearchText(
    e.itemName,
    contactName,
    e.reference,
    e.remark,
    e.category,
    e.extractedText,
  );
}

/** Recomputes and upserts expense_search_text for one expense. Also used by the search-rebuild worker. */
export function reindexExpense(db: Db, expenseId: number, row: ExpenseRow) {
  const text = buildSearchText(row, contactNameFor(db, row.contactId));
  upsertSearchText(
    db,
    expenseSearchText,
    expenseSearchText.expenseId,
    expenseSearchText.text,
    expenseId,
    text,
  );
}

/**
 * Sets just the extracted-text column and re-indexes, without touching updatedBy/updatedAt —
 * used by the search-rebuild worker so a bulk re-extraction doesn't look like a user edit.
 */
export function setExtractedText(
  db: Db,
  expenseId: number,
  text: string | null,
) {
  const row = db
    .update(expenses)
    .set({ extractedText: text })
    .where(eq(expenses.id, expenseId))
    .returning()
    .get();
  if (row) reindexExpense(db, expenseId, row);
}

type ExpenseRow = typeof expenses.$inferSelect;

const expenseReconciliationState = alias(
  reconciliationItemState,
  "expense_reconciliation_state",
);
const claimReconciliationState = alias(
  reconciliationItemState,
  "claim_reconciliation_state",
);

// `mainAmount` is the converted main-currency value (amount × exchangeRate). All
// display and aggregation use it; `amount`/`currency` are kept for the "original" line.
const expenseWithContact = {
  ...getTableColumns(expenses),
  contactName: contacts.legalName,
  mainAmount: sql<number>`${expenses.amount} * ${expenses.exchangeRate}`,
  cleared:
    sql<boolean>`${expenseReconciliationState.clearedSessionId} is not null`.mapWith(
      Boolean,
    ),
  clearedSessionId: expenseReconciliationState.clearedSessionId,
  clearedViaClaimId: sql<
    number | null
  >`case when ${claimReconciliationState.clearedSessionId} is not null then ${expenses.claimId} else null end`,
};

const expenseReconciliationJoin = and(
  eq(expenseReconciliationState.itemType, ReconItemType.Expense),
  eq(expenseReconciliationState.itemId, expenses.id),
);

const claimReconciliationJoin = and(
  eq(claimReconciliationState.itemType, ReconItemType.Claim),
  eq(claimReconciliationState.itemId, expenses.claimId),
);

/** Shared WHERE-clause builder for expense list + count queries. */
function expenseConditions(filters: ExpenseFilters): SQL[] {
  const { status, category, dateFrom, dateTo, amountMin, amountMax, search } =
    filters;
  const conditions: SQL[] = [];
  if (status !== undefined) conditions.push(eq(expenses.status, status));
  if (category) conditions.push(eq(expenses.category, category));
  if (dateFrom) conditions.push(gte(expenses.date, dateFrom));
  if (dateTo) conditions.push(lte(expenses.date, dateTo));
  if (amountMin !== undefined) conditions.push(gte(expenses.amount, amountMin));
  if (amountMax !== undefined) conditions.push(lte(expenses.amount, amountMax));
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      searchTextExists(
        expenseSearchText,
        expenseSearchText.expenseId,
        expenseSearchText.text,
        expenses.id,
        term,
      ),
    );
  }
  return conditions;
}

export function listExpenses(db: Db, filters: ExpenseFilters = {}) {
  const { limit = 100, offset = 0 } = filters;
  const conditions = expenseConditions(filters);

  return db
    .select(expenseWithContact)
    .from(expenses)
    .leftJoin(contacts, eq(contacts.id, expenses.contactId))
    .leftJoin(expenseReconciliationState, expenseReconciliationJoin)
    .leftJoin(claimReconciliationState, claimReconciliationJoin)
    .where(conditions.length ? and(...conditions) : undefined)
    .limit(limit)
    .offset(offset)
    .all();
}

/** Count expenses matching the same filters as listExpenses, without fetching rows. */
export function countExpenses(db: Db, filters: ExpenseFilters = {}): number {
  const conditions = expenseConditions(filters);
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(expenses)
    .where(conditions.length ? and(...conditions) : undefined)
    .get();
  return row?.count ?? 0;
}

export function getExpense(db: Db, id: number) {
  const expense = db
    .select({
      ...expenseWithContact,
      claimNumber: claims.claimNumber,
      claimStatus: claims.status,
      claimDate: claims.date,
    })
    .from(expenses)
    .leftJoin(contacts, eq(contacts.id, expenses.contactId))
    .leftJoin(claims, eq(claims.id, expenses.claimId))
    .leftJoin(expenseReconciliationState, expenseReconciliationJoin)
    .leftJoin(claimReconciliationState, claimReconciliationJoin)
    .where(eq(expenses.id, id))
    .get();

  if (!expense) return null;

  const attachments = db
    .select()
    .from(expenseAttachments)
    .where(eq(expenseAttachments.expenseId, id))
    .all();

  return { ...expense, attachments };
}

export function createExpense(
  db: Db,
  actingUserId: number,
  data: ExpenseCreate,
) {
  const expenseNumber = nextNumber(db, "expense", data.date);

  const row = db
    .insert(expenses)
    .values({
      expenseNumber,
      itemName: data.itemName,
      contactId: data.contactId ?? null,
      reference: data.reference ?? "",
      remark: data.remark ?? "",
      category: data.category ?? "Other",
      status: data.status ?? ExpenseStatus.Unpaid,
      date: data.date,
      amount: data.amount,
      extractedText: data.extractedText ?? null,
      currency: data.currency ?? undefined,
      exchangeRate: data.exchangeRate ?? undefined,
      createdBy: actingUserId,
      updatedBy: actingUserId,
    })
    .returning()
    .get()!;

  reindexExpense(db, row.id, row);
  recordAudit(db, {
    recordType: "expense",
    recordId: row.id,
    userId: actingUserId,
    action: "create",
  });
  return row;
}

export function updateExpense(
  db: Db,
  id: number,
  actingUserId: number,
  patch: ExpensePatch,
) {
  const existing = db.select().from(expenses).where(eq(expenses.id, id)).get();
  if (!existing) return null;

  const updated = db
    .update(expenses)
    .set({
      ...patch,
      updatedBy: actingUserId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(expenses.id, id))
    .returning()
    .get()!;

  reindexExpense(db, id, updated);
  recordAudit(db, {
    recordType: "expense",
    recordId: id,
    userId: actingUserId,
    action: "update",
    changes: diffRecords(existing, updated),
  });
  return updated;
}

export function deleteExpense(
  db: Db,
  id: number,
  actingUserId: number,
): boolean {
  const result = db
    .delete(expenses)
    .where(eq(expenses.id, id))
    .returning()
    .get();

  if (!result) return false;
  recordAudit(db, {
    recordType: "expense",
    recordId: id,
    userId: actingUserId,
    action: "delete",
    changes: diffRecords(result, null),
  });
  return true;
}

export function getExpensesByIds(db: Db, ids: number[]) {
  if (ids.length === 0) return [];
  return db.select().from(expenses).where(inArray(expenses.id, ids)).all();
}
