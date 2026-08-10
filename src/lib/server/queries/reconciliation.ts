import { and, desc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { alias } from "drizzle-orm/sqlite-core";
import {
  LeftoverAnnotation,
  ReconItemType,
  ReconSessionStatus,
} from "$lib/enums.js";
import type { LeftoverAnnotationCode } from "$lib/enums.js";
import type { ReconItemTypeCode } from "$lib/enums.js";
import * as schema from "../db/schema.js";
import {
  claims,
  contacts,
  bankStatementLines,
  expenses,
  incomes,
  reconciliationItemState,
  reconciliationSessions,
} from "../db/schema.js";
import type {
  BankFacingItem,
  ItemStateRow,
  SessionRow,
  StatementLineRow,
} from "../reconciliation/types.js";

export type ReconciliationDb = BunSQLiteDatabase<typeof schema>;

export type SessionCreate = Pick<
  SessionRow,
  | "startingBalance"
  | "startingDate"
  | "periodEndDate"
  | "statementEndingBalance"
> & { createdBy: number };

export type SessionPatch = Partial<
  Pick<
    SessionRow,
    | "startingBalance"
    | "startingDate"
    | "periodEndDate"
    | "statementEndingBalance"
    | "computedBalance"
    | "status"
    | "clearedCount"
    | "unclearedCount"
    | "unmatchedLineCount"
    | "statementState"
    | "statementError"
    | "closedAt"
  >
> & { updatedBy: number };

function asSessionRow(
  row: typeof reconciliationSessions.$inferSelect,
): SessionRow {
  return row as SessionRow;
}

export function listSessions(db: ReconciliationDb): SessionRow[] {
  return db
    .select()
    .from(reconciliationSessions)
    .orderBy(desc(reconciliationSessions.id))
    .all()
    .map(asSessionRow);
}

export function getSession(
  db: ReconciliationDb,
  id: number,
): SessionRow | null {
  const row = db
    .select()
    .from(reconciliationSessions)
    .where(eq(reconciliationSessions.id, id))
    .get();
  return row ? asSessionRow(row) : null;
}

export function getOpenSession(db: ReconciliationDb): SessionRow | null {
  const row = db
    .select()
    .from(reconciliationSessions)
    .where(eq(reconciliationSessions.status, ReconSessionStatus.Open))
    .orderBy(desc(reconciliationSessions.id))
    .get();
  return row ? asSessionRow(row) : null;
}

export function insertSession(
  db: ReconciliationDb,
  data: SessionCreate,
): SessionRow {
  return asSessionRow(
    db.insert(reconciliationSessions).values(data).returning().get()!,
  );
}

export function updateSession(
  db: ReconciliationDb,
  id: number,
  patch: SessionPatch,
): SessionRow | null {
  const row = db
    .update(reconciliationSessions)
    .set(patch)
    .where(eq(reconciliationSessions.id, id))
    .returning()
    .get();
  return row ? asSessionRow(row) : null;
}

export function getCloseCounts(
  db: ReconciliationDb,
  sessionId: number,
  unclearedCount: number,
): {
  clearedCount: number;
  unclearedCount: number;
  unmatchedLineCount: number;
} {
  const clearedCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(reconciliationItemState)
      .where(eq(reconciliationItemState.clearedSessionId, sessionId))
      .get()?.count ?? 0;
  const unmatchedLineCount =
    db
      .select({ count: sql<number>`count(*)` })
      .from(bankStatementLines)
      .where(
        and(
          eq(bankStatementLines.sessionId, sessionId),
          isNull(bankStatementLines.matchedItemType),
        ),
      )
      .get()?.count ?? 0;
  return { clearedCount, unclearedCount, unmatchedLineCount };
}

export function listLines(
  db: ReconciliationDb,
  sessionId: number,
): StatementLineRow[] {
  return db
    .select()
    .from(bankStatementLines)
    .where(eq(bankStatementLines.sessionId, sessionId))
    .orderBy(bankStatementLines.date, bankStatementLines.id)
    .all() as StatementLineRow[];
}

export type LineCreate = Pick<
  StatementLineRow,
  "sessionId" | "date" | "description" | "amount" | "direction"
> &
  Partial<Pick<StatementLineRow, "note" | "sourceFile">>;

export type LinePatch = Partial<
  Pick<
    StatementLineRow,
    | "date"
    | "description"
    | "amount"
    | "direction"
    | "note"
    | "matchedItemType"
    | "matchedItemId"
  >
>;

export function insertLines(
  db: ReconciliationDb,
  rows: LineCreate[],
): StatementLineRow[] {
  if (rows.length === 0) return [];
  return db.insert(bankStatementLines).values(rows).returning().all() as StatementLineRow[];
}

export function insertLine(
  db: ReconciliationDb,
  row: LineCreate,
): StatementLineRow {
  return db.insert(bankStatementLines).values(row).returning().get() as StatementLineRow;
}

export function getLine(
  db: ReconciliationDb,
  sessionId: number,
  lineId: number,
): StatementLineRow | null {
  return (
    (db
      .select()
      .from(bankStatementLines)
      .where(
        and(
          eq(bankStatementLines.id, lineId),
          eq(bankStatementLines.sessionId, sessionId),
        ),
      )
      .get() as StatementLineRow | undefined) ?? null
  );
}

export function updateLine(
  db: ReconciliationDb,
  sessionId: number,
  lineId: number,
  patch: LinePatch,
): StatementLineRow | null {
  return (
    (db
      .update(bankStatementLines)
      .set(patch)
      .where(
        and(
          eq(bankStatementLines.id, lineId),
          eq(bankStatementLines.sessionId, sessionId),
        ),
      )
      .returning()
      .get() as StatementLineRow | undefined) ?? null
  );
}

export function deleteLine(
  db: ReconciliationDb,
  sessionId: number,
  lineId: number,
): StatementLineRow | null {
  return db.transaction(() => {
    const line = getLine(db, sessionId, lineId);
    if (!line) return null;
    if (line.matchedItemType !== null && line.matchedItemId !== null) {
      const state = db
        .select()
        .from(reconciliationItemState)
        .where(
          and(
            eq(reconciliationItemState.itemType, line.matchedItemType),
            eq(reconciliationItemState.itemId, line.matchedItemId),
            eq(reconciliationItemState.clearedLineId, lineId),
          ),
        )
        .get();
      if (state && state.annotation == null) {
        db.delete(reconciliationItemState)
          .where(eq(reconciliationItemState.id, state.id))
          .run();
      } else if (state) {
        db.update(reconciliationItemState)
          .set({
            clearedSessionId: null,
            clearedLineId: null,
            clearedAmount: null,
            clearedAt: null,
          })
          .where(eq(reconciliationItemState.id, state.id))
          .run();
      }
    }
    db.delete(bankStatementLines).where(eq(bankStatementLines.id, lineId)).run();
    return line;
  });
}

const expenseState = alias(
  reconciliationItemState,
  "reconciliation_scope_expense_state",
);
const incomeState = alias(
  reconciliationItemState,
  "reconciliation_scope_income_state",
);
const claimState = alias(
  reconciliationItemState,
  "reconciliation_scope_claim_state",
);

/**
 * Returns every uncleared bank-facing item dated on or before the session end.
 * There is deliberately no lower date bound: old uncleared records remain in scope.
 */
export function getInScopeItems(
  db: ReconciliationDb,
  periodEndDate: string,
  includeClearedSessionId?: number,
): {
  incomes: BankFacingItem[];
  directExpenses: BankFacingItem[];
  claims: BankFacingItem[];
} {
  const directExpenses = db
    .select({
      itemId: expenses.id,
      label: sql<string>`${expenses.expenseNumber} || ' · ' || ${expenses.itemName}`,
      date: expenses.date,
      amount: expenses.amount,
      exchangeRate: expenses.exchangeRate,
      contactName: contacts.legalName,
      annotation: expenseState.annotation,
      clearedSessionId: expenseState.clearedSessionId,
      clearedLineId: expenseState.clearedLineId,
    })
    .from(expenses)
    .leftJoin(contacts, eq(contacts.id, expenses.contactId))
    .leftJoin(
      expenseState,
      and(
        eq(expenseState.itemType, ReconItemType.Expense),
        eq(expenseState.itemId, expenses.id),
      ),
    )
    .where(
      and(
        isNull(expenses.claimId),
        lte(expenses.date, periodEndDate),
        includeClearedSessionId === undefined
          ? isNull(expenseState.clearedSessionId)
          : or(
              isNull(expenseState.clearedSessionId),
              eq(expenseState.clearedSessionId, includeClearedSessionId),
            ),
        or(
          isNull(expenseState.annotation),
          ne(expenseState.annotation, LeftoverAnnotation.WillNotClear),
        ),
      ),
    )
    .all()
    .map(
      (row): BankFacingItem => ({
        ...row,
        annotation: row.annotation as LeftoverAnnotationCode | null,
        itemType: ReconItemType.Expense,
        claimId: null,
        cleared: row.clearedSessionId !== null,
      }),
    );

  const scopedIncomes = db
    .select({
      itemId: incomes.id,
      label: sql<string>`${incomes.incomeNumber} || case when ${incomes.descriptionText} = '' then '' else ' · ' || ${incomes.descriptionText} end`,
      date: incomes.date,
      amount: incomes.amount,
      exchangeRate: incomes.exchangeRate,
      contactName: contacts.legalName,
      annotation: incomeState.annotation,
      clearedSessionId: incomeState.clearedSessionId,
      clearedLineId: incomeState.clearedLineId,
    })
    .from(incomes)
    .leftJoin(contacts, eq(contacts.id, incomes.contactId))
    .leftJoin(
      incomeState,
      and(
        eq(incomeState.itemType, ReconItemType.Income),
        eq(incomeState.itemId, incomes.id),
      ),
    )
    .where(
      and(
        lte(incomes.date, periodEndDate),
        includeClearedSessionId === undefined
          ? isNull(incomeState.clearedSessionId)
          : or(
              isNull(incomeState.clearedSessionId),
              eq(incomeState.clearedSessionId, includeClearedSessionId),
            ),
        or(
          isNull(incomeState.annotation),
          ne(incomeState.annotation, LeftoverAnnotation.WillNotClear),
        ),
      ),
    )
    .all()
    .map(
      (row): BankFacingItem => ({
        ...row,
        annotation: row.annotation as LeftoverAnnotationCode | null,
        itemType: ReconItemType.Income,
        cleared: row.clearedSessionId !== null,
      }),
    );

  const scopedClaims = db
    .select({
      itemId: claims.id,
      label: claims.claimNumber,
      date: claims.date,
      amount: sql<number>`coalesce(sum(round(${expenses.amount} * ${expenses.exchangeRate}, 2)), 0)`,
      annotation: claimState.annotation,
      clearedSessionId: claimState.clearedSessionId,
      clearedLineId: claimState.clearedLineId,
    })
    .from(claims)
    .leftJoin(expenses, eq(expenses.claimId, claims.id))
    .leftJoin(
      claimState,
      and(
        eq(claimState.itemType, ReconItemType.Claim),
        eq(claimState.itemId, claims.id),
      ),
    )
    .where(
      and(
        lte(claims.date, periodEndDate),
        includeClearedSessionId === undefined
          ? isNull(claimState.clearedSessionId)
          : or(
              isNull(claimState.clearedSessionId),
              eq(claimState.clearedSessionId, includeClearedSessionId),
            ),
        or(
          isNull(claimState.annotation),
          ne(claimState.annotation, LeftoverAnnotation.WillNotClear),
        ),
      ),
    )
    .groupBy(claims.id)
    .all()
    .map(
      (row): BankFacingItem => ({
        ...row,
        annotation: row.annotation as LeftoverAnnotationCode | null,
        itemType: ReconItemType.Claim,
        exchangeRate: 1,
        cleared: row.clearedSessionId !== null,
      }),
    );

  return { incomes: scopedIncomes, directExpenses, claims: scopedClaims };
}

export function getCandidates(
  db: ReconciliationDb,
  sessionId: number,
): BankFacingItem[] {
  const session = getSession(db, sessionId);
  if (!session) return [];
  const scoped = getInScopeItems(db, session.periodEndDate, sessionId);
  return [...scoped.incomes, ...scoped.directExpenses, ...scoped.claims];
}

export function getItemState(
  db: ReconciliationDb,
  itemType: number,
  itemId: number,
): ItemStateRow | null {
  return (
    (db
      .select()
      .from(reconciliationItemState)
      .where(
        and(
          eq(reconciliationItemState.itemType, itemType),
          eq(reconciliationItemState.itemId, itemId),
        ),
      )
      .get() as ItemStateRow | undefined) ?? null
  );
}

export function upsertItemState(
  db: ReconciliationDb,
  values: Omit<ItemStateRow, "id" | "updatedAt">,
): ItemStateRow {
  return db
    .insert(reconciliationItemState)
    .values(values)
    .onConflictDoUpdate({
      target: [reconciliationItemState.itemType, reconciliationItemState.itemId],
      set: values,
    })
    .returning()
    .get() as ItemStateRow;
}

export function removeEmptyItemState(
  db: ReconciliationDb,
  itemType: number,
  itemId: number,
): ItemStateRow | null {
  const state = getItemState(db, itemType, itemId);
  if (!state) return null;
  if (state.clearedSessionId === null && state.annotation === null) {
    db.delete(reconciliationItemState)
      .where(eq(reconciliationItemState.id, state.id))
      .run();
    return null;
  }
  return state;
}

export function setLineMatch(
  db: ReconciliationDb,
  sessionId: number,
  lineId: number,
  match: { itemType: ReconItemTypeCode; itemId: number } | null,
): StatementLineRow | null {
  return updateLine(db, sessionId, lineId, {
    matchedItemType: match?.itemType ?? null,
    matchedItemId: match?.itemId ?? null,
  });
}

export function isClaimedExpense(
  db: ReconciliationDb,
  itemId: number,
): boolean {
  return (
    db
      .select({ claimId: expenses.claimId })
      .from(expenses)
      .where(eq(expenses.id, itemId))
      .get()?.claimId != null
  );
}

export function getStatesClearedBySession(
  db: ReconciliationDb,
  sessionId: number,
): ItemStateRow[] {
  return db
    .select()
    .from(reconciliationItemState)
    .where(eq(reconciliationItemState.clearedSessionId, sessionId))
    .all() as ItemStateRow[];
}

export function deleteSessionData(
  db: ReconciliationDb,
  sessionId: number,
): { before: ItemStateRow; after: ItemStateRow | null }[] {
  return db.transaction(() => {
    const states = db
      .select()
      .from(reconciliationItemState)
      .where(
        or(
          eq(reconciliationItemState.clearedSessionId, sessionId),
          eq(reconciliationItemState.annotationSessionId, sessionId),
        ),
      )
      .all() as ItemStateRow[];
    const changes = states.map((before) => {
      const clearMatch = before.clearedSessionId === sessionId;
      const clearAnnotation = before.annotationSessionId === sessionId;
      const values = {
        clearedSessionId: clearMatch ? null : before.clearedSessionId,
        clearedLineId: clearMatch ? null : before.clearedLineId,
        clearedAmount: clearMatch ? null : before.clearedAmount,
        clearedAt: clearMatch ? null : before.clearedAt,
        annotation: clearAnnotation ? null : before.annotation,
        annotationSessionId: clearAnnotation ? null : before.annotationSessionId,
        annotationNote: clearAnnotation ? "" : before.annotationNote,
      };
      if (values.clearedSessionId === null && values.annotation === null) {
        db.delete(reconciliationItemState)
          .where(eq(reconciliationItemState.id, before.id))
          .run();
        return { before, after: null };
      }
      const after = db
        .update(reconciliationItemState)
        .set(values)
        .where(eq(reconciliationItemState.id, before.id))
        .returning()
        .get() as ItemStateRow;
      return { before, after };
    });
    db.delete(reconciliationSessions)
      .where(eq(reconciliationSessions.id, sessionId))
      .run();
    return changes;
  });
}
