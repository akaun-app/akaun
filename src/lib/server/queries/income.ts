import { and, eq, gte, lte, sql, getTableColumns } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "../db/schema.js";
import {
  incomes,
  incomeAttachments,
  incomeSearchText,
  contacts,
} from "../db/schema.js";
import { nextNumber } from "../running-number.js";
import {
  upsertSearchText,
  searchTextExists,
  joinSearchText,
} from "../search-text.js";
import { recordAudit, diffRecords } from "../audit.js";
import { ReconItemType } from "$lib/enums.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BunSQLiteDatabase<typeof schema> | BunSQLiteDatabase<any>;

export type IncomeFilters = {
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  amountMin?: number;
  amountMax?: number;
  search?: string;
  limit?: number;
  offset?: number;
};

export type IncomeCreate = {
  contactId?: number | null;
  descriptionText?: string;
  reference?: string;
  remark?: string;
  category?: string;
  date: string;
  amount: number;
  // See ExpenseCreate.currency / exchangeRate.
  currency?: string;
  exchangeRate?: number;
  // See ExpenseCreate.extractedText.
  extractedText?: string | null;
};

export type IncomePatch = Partial<IncomeCreate>;

type IncomeRow = typeof incomes.$inferSelect;

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
  i: {
    descriptionText: string;
    reference: string;
    remark: string;
    category: string;
    extractedText: string | null;
  },
  contactName: string,
): string {
  return joinSearchText(
    contactName,
    i.descriptionText,
    i.reference,
    i.remark,
    i.category,
    i.extractedText,
  );
}

/** Recomputes and upserts income_search_text for one income. Also used by the search-rebuild worker. */
export function reindexIncome(db: Db, incomeId: number, row: IncomeRow) {
  const text = buildSearchText(row, contactNameFor(db, row.contactId));
  upsertSearchText(
    db,
    incomeSearchText,
    incomeSearchText.incomeId,
    incomeSearchText.text,
    incomeId,
    text,
  );
}

/**
 * Sets just the extracted-text column and re-indexes, without touching updatedBy/updatedAt —
 * used by the search-rebuild worker so a bulk re-extraction doesn't look like a user edit.
 */
export function setExtractedText(
  db: Db,
  incomeId: number,
  text: string | null,
) {
  const row = db
    .update(incomes)
    .set({ extractedText: text })
    .where(eq(incomes.id, incomeId))
    .returning()
    .get();
  if (row) reindexIncome(db, incomeId, row);
}

// `mainAmount` = amount × exchangeRate (converted main-currency value). See expenses.ts.
const incomeWithContact = {
  ...getTableColumns(incomes),
  contactName: contacts.legalName,
  mainAmount: sql<number>`${incomes.amount} * ${incomes.exchangeRate}`,
  cleared:
    sql<boolean>`coalesce((select sum(amount) from reconciliation_allocations where item_type=${ReconItemType.Income} and item_id=${incomes.id}),0) >= round(${incomes.amount}*${incomes.exchangeRate},2)`.mapWith(
      Boolean,
    ),
  clearedSessionId: sql<number | null>`null`,
};

export function listIncomes(db: Db, filters: IncomeFilters = {}) {
  const {
    category,
    dateFrom,
    dateTo,
    amountMin,
    amountMax,
    search,
    limit = 100,
    offset = 0,
  } = filters;

  const conditions = [];
  if (category) conditions.push(eq(incomes.category, category));
  if (dateFrom) conditions.push(gte(incomes.date, dateFrom));
  if (dateTo) conditions.push(lte(incomes.date, dateTo));
  if (amountMin !== undefined) conditions.push(gte(incomes.amount, amountMin));
  if (amountMax !== undefined) conditions.push(lte(incomes.amount, amountMax));
  if (search) {
    const term = `%${search}%`;
    conditions.push(
      searchTextExists(
        incomeSearchText,
        incomeSearchText.incomeId,
        incomeSearchText.text,
        incomes.id,
        term,
      ),
    );
  }

  return db
    .select(incomeWithContact)
    .from(incomes)
    .leftJoin(contacts, eq(contacts.id, incomes.contactId))
    .where(conditions.length ? and(...conditions) : undefined)
    .limit(limit)
    .offset(offset)
    .all();
}

export function getIncome(db: Db, id: number) {
  const income = db
    .select(incomeWithContact)
    .from(incomes)
    .leftJoin(contacts, eq(contacts.id, incomes.contactId))
    .where(eq(incomes.id, id))
    .get();

  if (!income) return null;

  const attachments = db
    .select()
    .from(incomeAttachments)
    .where(eq(incomeAttachments.incomeId, id))
    .all();

  return { ...income, attachments };
}

export function createIncome(db: Db, actingUserId: number, data: IncomeCreate) {
  const incomeNumber = nextNumber(db, "income", data.date);

  const row = db
    .insert(incomes)
    .values({
      incomeNumber,
      contactId: data.contactId ?? null,
      descriptionText: data.descriptionText ?? "",
      reference: data.reference ?? "",
      remark: data.remark ?? "",
      category: data.category ?? "Other",
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

  reindexIncome(db, row.id, row);
  recordAudit(db, {
    recordType: "income",
    recordId: row.id,
    userId: actingUserId,
    action: "create",
  });
  return row;
}

export function updateIncome(
  db: Db,
  id: number,
  actingUserId: number,
  patch: IncomePatch,
) {
  const existing = db.select().from(incomes).where(eq(incomes.id, id)).get();
  if (!existing) return null;

  const updated = db
    .update(incomes)
    .set({ ...patch, updatedBy: actingUserId })
    .where(eq(incomes.id, id))
    .returning()
    .get()!;

  reindexIncome(db, id, updated);
  recordAudit(db, {
    recordType: "income",
    recordId: id,
    userId: actingUserId,
    action: "update",
    changes: diffRecords(existing, updated),
  });
  return updated;
}

export function deleteIncome(
  db: Db,
  id: number,
  actingUserId: number,
): boolean {
  const result = db.delete(incomes).where(eq(incomes.id, id)).returning().get();

  if (!result) return false;
  recordAudit(db, {
    recordType: "income",
    recordId: id,
    userId: actingUserId,
    action: "delete",
    changes: diffRecords(result, null),
  });
  return true;
}
