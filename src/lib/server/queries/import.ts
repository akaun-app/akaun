import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { importQueue } from "../db/schema.js";
import type { LedgerDb } from "../ledger/types.js";

export type ImportJobFilters = {
  states?: number[];
  dateFrom?: string;
  dateTo?: string;
  duplicateOnly?: boolean;
  limit: number;
  offset: number;
};

// Queue reads never include internal storage paths, hashes or provider keys.
const jobFields = {
  id: importQueue.id,
  state: importQueue.state,
  originalFilename: importQueue.originalFilename,
  documentType: importQueue.documentType,
  description: importQueue.itemName,
  supplier: importQueue.supplier,
  matchedContactId: importQueue.matchedContactId,
  matchCandidates: importQueue.matchCandidates,
  date: importQueue.date,
  amount: importQueue.amount,
  currency: importQueue.currency,
  exchangeRate: importQueue.exchangeRate,
  reference: importQueue.reference,
  category: importQueue.category,
  categoryAccountId: importQueue.categoryAccountId,
  accountId: importQueue.accountId,
  duplicateOf: importQueue.duplicateOf,
  duplicateConfidence: importQueue.duplicateConfidence,
  duplicateReasons: importQueue.duplicateReasons,
  resultId: importQueue.resultId,
  resultType: importQueue.resultType,
  error: importQueue.error,
  createdAt: importQueue.createdAt,
  processedAt: importQueue.processedAt,
  confirmedAt: importQueue.confirmedAt,
  completedAt: importQueue.completedAt,
};

export function listImportJobs(db: LedgerDb, filters: ImportJobFilters) {
  const conditions: SQL[] = [];
  if (filters.states)
    conditions.push(inArray(importQueue.state, filters.states));
  // Date filters refer to upload dates, not the document transaction date.
  if (filters.dateFrom)
    conditions.push(
      gte(sql`substr(${importQueue.createdAt}, 1, 10)`, filters.dateFrom),
    );
  if (filters.dateTo)
    conditions.push(
      lte(sql`substr(${importQueue.createdAt}, 1, 10)`, filters.dateTo),
    );
  if (filters.duplicateOnly)
    conditions.push(isNotNull(importQueue.duplicateOf));
  const where = conditions.length ? and(...conditions) : undefined;
  const total =
    db
      .select({ total: sql<number>`count(*)` })
      .from(importQueue)
      .where(where)
      .get()?.total ?? 0;
  const jobs = db
    .select({
      id: importQueue.id,
      state: importQueue.state,
      originalFilename: importQueue.originalFilename,
      description: importQueue.itemName,
      date: importQueue.date,
      amount: importQueue.amount,
      currency: importQueue.currency,
      duplicateOf: importQueue.duplicateOf,
      duplicateConfidence: importQueue.duplicateConfidence,
      duplicateReasons: importQueue.duplicateReasons,
      resultId: importQueue.resultId,
      error: importQueue.error,
      createdAt: importQueue.createdAt,
    })
    .from(importQueue)
    .where(where)
    .orderBy(desc(importQueue.createdAt), desc(importQueue.id))
    .limit(filters.limit)
    .offset(filters.offset)
    .all();
  return { jobs, total };
}

export function getImportJob(
  db: LedgerDb,
  id: string,
  includeEvidence: boolean,
) {
  const fields = includeEvidence
    ? { ...jobFields, extractedText: importQueue.extractedText }
    : jobFields;
  return (
    db.select(fields).from(importQueue).where(eq(importQueue.id, id)).get() ??
    null
  );
}
