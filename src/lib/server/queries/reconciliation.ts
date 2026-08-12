import { and, asc, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { ReconItemType } from "$lib/enums.js";
import type { ReconItemTypeCode } from "$lib/enums.js";
import * as schema from "../db/schema.js";
import {
  bankStatements,
  bankStatementLines,
  claims,
  contacts,
  expenses,
  incomes,
  reconciliationAllocations,
} from "../db/schema.js";
import type {
  BankFacingItem,
  BankStatementRow,
  ReconciliationAllocation,
  StatementLineRow,
} from "../reconciliation/types.js";
import { mainAmount, round2 } from "../reconciliation/types.js";

export type ReconciliationDb = BunSQLiteDatabase<typeof schema>;

export const listAllocations = (db: ReconciliationDb) =>
  db
    .select()
    .from(reconciliationAllocations)
    .all() as ReconciliationAllocation[];
export const listLineAllocations = (db: ReconciliationDb, lineId: number) =>
  db
    .select()
    .from(reconciliationAllocations)
    .where(eq(reconciliationAllocations.lineId, lineId))
    .all() as ReconciliationAllocation[];
export const listItemAllocations = (
  db: ReconciliationDb,
  itemType: number,
  itemId: number,
) =>
  db
    .select()
    .from(reconciliationAllocations)
    .where(
      and(
        eq(reconciliationAllocations.itemType, itemType),
        eq(reconciliationAllocations.itemId, itemId),
      ),
    )
    .all() as ReconciliationAllocation[];

export function replaceItemAllocations(
  db: ReconciliationDb,
  itemType: ReconItemTypeCode,
  itemId: number,
  snapshot: number,
  values: { lineId: number; amount: number }[],
  createdBy: number,
) {
  return db.transaction(() => {
    db.delete(reconciliationAllocations)
      .where(
        and(
          eq(reconciliationAllocations.itemType, itemType),
          eq(reconciliationAllocations.itemId, itemId),
        ),
      )
      .run();
    if (!values.length) return [];
    return db
      .insert(reconciliationAllocations)
      .values(
        values.map((v) => ({
          ...v,
          itemType,
          itemId,
          itemAmountSnapshot: snapshot,
          createdBy,
        })),
      )
      .returning()
      .all() as ReconciliationAllocation[];
  });
}

export const listStatements = (db: ReconciliationDb) =>
  db
    .select()
    .from(bankStatements)
    .orderBy(desc(bankStatements.id))
    .all() as BankStatementRow[];
export const getStatement = (db: ReconciliationDb, id: number) =>
  db.select().from(bankStatements).where(eq(bankStatements.id, id)).get() as
    | BankStatementRow
    | undefined;
export const insertStatement = (
  db: ReconciliationDb,
  data: typeof bankStatements.$inferInsert,
) =>
  db.insert(bankStatements).values(data).returning().get() as BankStatementRow;
export const updateStatement = (
  db: ReconciliationDb,
  id: number,
  data: Partial<typeof bankStatements.$inferInsert>,
) =>
  db
    .update(bankStatements)
    .set({ ...data, updatedAt: sql`datetime('now')` })
    .where(eq(bankStatements.id, id))
    .returning()
    .get() as BankStatementRow | undefined;
export const deleteStatement = (db: ReconciliationDb, id: number) =>
  db
    .delete(bankStatements)
    .where(eq(bankStatements.id, id))
    .returning()
    .get() as BankStatementRow | undefined;
export const listLines = (db: ReconciliationDb, statementId?: number) => {
  const q = db.select().from(bankStatementLines);
  return (
    statementId == null
      ? q
          .orderBy(asc(bankStatementLines.date), asc(bankStatementLines.id))
          .all()
      : q
          .where(eq(bankStatementLines.statementId, statementId))
          .orderBy(asc(bankStatementLines.date), asc(bankStatementLines.id))
          .all()
  ) as StatementLineRow[];
};
export const getLine = (db: ReconciliationDb, id: number) =>
  db
    .select()
    .from(bankStatementLines)
    .where(eq(bankStatementLines.id, id))
    .get() as StatementLineRow | undefined;
export const insertLines = (
  db: ReconciliationDb,
  values: (typeof bankStatementLines.$inferInsert)[],
) =>
  values.length
    ? (db
        .insert(bankStatementLines)
        .values(values)
        .returning()
        .all() as StatementLineRow[])
    : [];
export const updateLine = (
  db: ReconciliationDb,
  id: number,
  data: Partial<
    Pick<
      StatementLineRow,
      "date" | "description" | "amount" | "direction" | "note"
    >
  >,
) =>
  db
    .update(bankStatementLines)
    .set(data)
    .where(eq(bankStatementLines.id, id))
    .returning()
    .get() as StatementLineRow | undefined;
export const deleteLine = (db: ReconciliationDb, id: number) =>
  db
    .delete(bankStatementLines)
    .where(eq(bankStatementLines.id, id))
    .returning()
    .get() as StatementLineRow | undefined;

export function listBankFacingItems(
  db: ReconciliationDb,
  from?: string | null,
  to?: string | null,
): BankFacingItem[] {
  const dateWhere = <T>(column: T) =>
    and(
      from ? gte(column as never, from) : undefined,
      to ? lte(column as never, to) : undefined,
    );
  const incomeRows = db
    .select({
      id: incomes.id,
      label: incomes.incomeNumber,
      date: incomes.date,
      amount: incomes.amount,
      exchangeRate: incomes.exchangeRate,
      contactName: contacts.legalName,
    })
    .from(incomes)
    .leftJoin(contacts, eq(incomes.contactId, contacts.id))
    .where(dateWhere(incomes.date))
    .all()
    .map((r) => ({ ...r, itemType: ReconItemType.Income, itemId: r.id }));
  const expenseRows = db
    .select({
      id: expenses.id,
      label: expenses.expenseNumber,
      date: expenses.date,
      amount: expenses.amount,
      exchangeRate: expenses.exchangeRate,
      contactName: contacts.legalName,
    })
    .from(expenses)
    .leftJoin(contacts, eq(expenses.contactId, contacts.id))
    .where(and(isNull(expenses.claimId), dateWhere(expenses.date)))
    .all()
    .map((r) => ({ ...r, itemType: ReconItemType.Expense, itemId: r.id }));
  const claimRows = db
    .select({
      id: claims.id,
      label: claims.claimNumber,
      date: claims.date,
      amount: sql<number>`coalesce(sum(round(${expenses.amount} * ${expenses.exchangeRate}, 2)), 0)`,
    })
    .from(claims)
    .leftJoin(expenses, eq(expenses.claimId, claims.id))
    .where(dateWhere(claims.date))
    .groupBy(claims.id)
    .all()
    .map((r) => ({
      ...r,
      itemType: ReconItemType.Claim,
      itemId: r.id,
      exchangeRate: 1,
      contactName: null,
    }));
  const coverage = new Map<string, { amount: number; count: number }>();
  for (const a of listAllocations(db)) {
    const k = `${a.itemType}:${a.itemId}`,
      v = coverage.get(k) ?? { amount: 0, count: 0 };
    v.amount = round2(v.amount + a.amount);
    v.count++;
    coverage.set(k, v);
  }
  return [...incomeRows, ...expenseRows, ...claimRows].map((r) => {
    const c = coverage.get(`${r.itemType}:${r.itemId}`) ?? {
      amount: 0,
      count: 0,
    };
    const total = mainAmount(r);
    return {
      ...r,
      allocatedAmount: c.amount,
      remainingAmount: round2(total - c.amount),
      allocationCount: c.count,
    };
  });
}
