import {
  LeftoverAnnotation,
  ReconItemType,
  ReconSessionStatus,
  StatementExtractionState,
} from "$lib/enums.js";
import type {
  LeftoverAnnotationCode,
  ReconItemTypeCode,
} from "$lib/enums.js";
import { diffRecords, recordAudit } from "$lib/server/audit.js";
import { hasPermission, type ActionName } from "$lib/server/permissions.js";
import {
  getCloseCounts,
  getInScopeItems,
  getLine,
  getCandidates,
  getItemState,
  getStatesClearedBySession,
  getOpenSession,
  getSession,
  insertSession,
  insertLine,
  isClaimedExpense,
  listSessions,
  listLines,
  removeEmptyItemState,
  setLineMatch,
  upsertItemState,
  deleteLine as deleteLineQuery,
  deleteSessionData,
  updateLine as updateLineQuery,
  updateSession,
  type ReconciliationDb,
  type LineCreate,
  type LinePatch,
  type SessionCreate,
} from "$lib/server/queries/reconciliation.js";
import {
  compareBalances,
  computeExpectedBalance,
} from "$lib/server/reconciliation/balance.js";
import { reconciliationEvents } from "$lib/server/reconciliation/events.js";
import {
  canMutateSession,
  canStartSession,
} from "$lib/server/reconciliation/session-rules.js";
import type {
  SessionRow,
  SessionSummary,
  Step1Result,
} from "$lib/server/reconciliation/types.js";
import { processStatementImport } from "$lib/server/reconciliation/statement-import.js";
import { mainAmount } from "$lib/server/reconciliation/types.js";
import { claimEvents, expenseEvents, incomeEvents } from "$lib/server/finance/events.js";
import { getClaim } from "$lib/server/queries/claims.js";
import { getExpense } from "$lib/server/queries/expenses.js";
import { getIncome } from "$lib/server/queries/income.js";
import { detectDrift } from "$lib/server/reconciliation/drift.js";
import { deleteReconciliationFolder } from "$lib/server/file-storage.js";

export class ReconciliationError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function authorize(locals: App.Locals, action: ActionName): number {
  if (!hasPermission(locals, "reconciliation", action)) {
    throw new ReconciliationError("Forbidden", 403);
  }
  if (!locals.user) throw new ReconciliationError("Unauthorized", 403);
  return locals.user.id;
}

function summarize(
  db: ReconciliationDb,
  session: SessionRow,
  newestId: number,
): SessionSummary {
  const closed = session.status !== ReconSessionStatus.Open;
  const drift = closed
    ? detectDrift(
        getStatesClearedBySession(db, session.id),
        getCandidates(db, session.id),
      )
    : { changed: [], deleted: [] };
  return {
    ...session,
    difference:
      session.computedBalance == null
        ? null
        : compareBalances(
            session.computedBalance,
            session.statementEndingBalance,
          ).difference,
    hasDrift: drift.changed.length > 0 || drift.deleted.length > 0,
    canReopen: closed && canMutateSession(session, newestId),
    canDelete: canMutateSession(session, newestId),
  };
}

function computeStep1(db: ReconciliationDb, session: SessionRow): Step1Result {
  return computeExpectedBalance({
    startingBalance: session.startingBalance,
    ...getInScopeItems(db, session.periodEndDate),
  });
}

function emitSession(db: ReconciliationDb, id: number): void {
  const session = getSession(db, id);
  if (!session) return;
  const newestId = listSessions(db)[0]?.id ?? session.id;
  reconciliationEvents.emit("session-update", {
    session: summarize(db, session, newestId),
  });
}

export function listSessionSummaries(db: ReconciliationDb, locals: App.Locals) {
  authorize(locals, "view");
  const sessions = listSessions(db);
  const newestId = sessions[0]?.id ?? 0;
  const summaries = sessions.map((session) => summarize(db, session, newestId));
  return {
    openSession:
      summaries.find((session) => session.status === ReconSessionStatus.Open) ??
      null,
    sessions: summaries,
  };
}

export function createSession(
  db: ReconciliationDb,
  locals: App.Locals,
  data: Omit<SessionCreate, "createdBy">,
) {
  const userId = authorize(locals, "add");
  const sessions = listSessions(db);
  if (!canStartSession(sessions)) {
    const openSessionId = getOpenSession(db)?.id;
    throw new ReconciliationError(
      "A reconciliation session is already open",
      409,
      {
        openSessionId,
      },
    );
  }

  const session = insertSession(db, { ...data, createdBy: userId });
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: session.id,
    userId,
    action: "create",
  });
  emitSession(db, session.id);
  return getSessionDetail(db, locals, session.id);
}

export function getSessionDetail(
  db: ReconciliationDb,
  locals: App.Locals,
  id: number,
) {
  authorize(locals, "view");
  const session = getSession(db, id);
  if (!session)
    throw new ReconciliationError("Reconciliation session not found", 404);
  const newestId = listSessions(db)[0]?.id ?? session.id;

  if (session.status === ReconSessionStatus.Open) {
    const result = computeStep1(db, session);
    const comparison = compareBalances(
      result.expected,
      session.statementEndingBalance,
    );
    return {
      session: summarize(db, session, newestId),
      step1: {
        ...result,
        entered: session.statementEndingBalance,
        ...comparison,
      },
      drift: { changed: [], deleted: [] },
    };
  }

  const expected = session.computedBalance ?? session.startingBalance;
  const comparison = compareBalances(expected, session.statementEndingBalance);
  return {
    session: summarize(db, session, newestId),
    step1: {
      expected,
      entered: session.statementEndingBalance,
      ...comparison,
      incomeTotal: 0,
      expenseTotal: 0,
      claimTotal: 0,
      inScopeCounts: {
        incomes: 0,
        directExpenses: session.unclearedCount,
        claims: 0,
      },
    },
    drift: { changed: [], deleted: [] },
  };
}

export type EditableSessionFields = Partial<
  Pick<
    SessionRow,
    | "startingBalance"
    | "startingDate"
    | "periodEndDate"
    | "statementEndingBalance"
  >
>;

export function updateSessionFields(
  db: ReconciliationDb,
  locals: App.Locals,
  id: number,
  patch: EditableSessionFields,
) {
  const userId = authorize(locals, "change");
  const before = getSession(db, id);
  if (!before)
    throw new ReconciliationError("Reconciliation session not found", 404);
  if (before.status !== ReconSessionStatus.Open) {
    throw new ReconciliationError(
      "Closed reconciliation sessions cannot be edited",
      409,
    );
  }

  const after = updateSession(db, id, { ...patch, updatedBy: userId })!;
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: id,
    userId,
    action: "update",
    changes: diffRecords(before, after),
  });
  emitSession(db, id);
  return getSessionDetail(db, locals, id);
}

export function closeSession(
  db: ReconciliationDb,
  locals: App.Locals,
  id: number,
) {
  const userId = authorize(locals, "change");
  const before = getSession(db, id);
  if (!before)
    throw new ReconciliationError("Reconciliation session not found", 404);
  if (before.status !== ReconSessionStatus.Open) {
    throw new ReconciliationError(
      "Reconciliation session is already closed",
      409,
    );
  }

  const step1 = computeStep1(db, before);
  const comparison = compareBalances(
    step1.expected,
    before.statementEndingBalance,
  );
  const inScopeCount =
    step1.inScopeCounts.incomes +
    step1.inScopeCounts.directExpenses +
    step1.inScopeCounts.claims;
  const counts = getCloseCounts(db, id, inScopeCount);
  const after = updateSession(db, id, {
    computedBalance: step1.expected,
    status: comparison.matched
      ? ReconSessionStatus.ClosedMatched
      : ReconSessionStatus.ClosedWithLeftovers,
    ...counts,
    closedAt: new Date().toISOString(),
    updatedBy: userId,
  })!;

  recordAudit(db, {
    recordType: "reconciliation",
    recordId: id,
    userId,
    action: "update",
    changes: diffRecords(before, after),
  });
  emitSession(db, id);
  return getSessionDetail(db, locals, id);
}

function requireOpenSession(
  db: ReconciliationDb,
  id: number,
): SessionRow {
  const session = getSession(db, id);
  if (!session)
    throw new ReconciliationError("Reconciliation session not found", 404);
  if (session.status !== ReconSessionStatus.Open) {
    throw new ReconciliationError("Reconciliation session is closed", 409);
  }
  return session;
}

export function uploadStatement(
  db: ReconciliationDb,
  locals: App.Locals,
  sessionId: number,
  file: { relativePath: string; originalFilename: string },
) {
  const userId = authorize(locals, "add");
  const before = requireOpenSession(db, sessionId);
  const after = updateSession(db, sessionId, {
    statementState: StatementExtractionState.Extracting,
    statementError: null,
    updatedBy: userId,
  })!;
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: sessionId,
    userId,
    action: "update",
    changes: diffRecords(before, after),
  });
  emitSession(db, sessionId);
  void processStatementImport(db, {
    sessionId,
    periodEndDate: after.periodEndDate,
    relativePath: file.relativePath,
    originalFilename: file.originalFilename,
    userId,
  });
  return { statementState: StatementExtractionState.Extracting };
}

export function getSessionLines(
  db: ReconciliationDb,
  locals: App.Locals,
  sessionId: number,
) {
  authorize(locals, "view");
  if (!getSession(db, sessionId)) {
    throw new ReconciliationError("Reconciliation session not found", 404);
  }
  return listLines(db, sessionId);
}

export function addLineManually(
  db: ReconciliationDb,
  locals: App.Locals,
  sessionId: number,
  data: Omit<LineCreate, "sessionId" | "sourceFile">,
) {
  const userId = authorize(locals, "change");
  requireOpenSession(db, sessionId);
  const line = insertLine(db, { ...data, sessionId, sourceFile: null });
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: sessionId,
    userId,
    action: "update",
    changes: [{ field: "statementLine", before: null, after: line.id }],
  });
  reconciliationEvents.emit("line-update", { line });
  return line;
}

export function updateLine(
  db: ReconciliationDb,
  locals: App.Locals,
  sessionId: number,
  lineId: number,
  patch: LinePatch,
) {
  const userId = authorize(locals, "change");
  requireOpenSession(db, sessionId);
  const before = getLine(db, sessionId, lineId);
  if (!before) throw new ReconciliationError("Statement line not found", 404);
  const line = updateLineQuery(db, sessionId, lineId, patch)!;
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: sessionId,
    userId,
    action: "update",
    changes: diffRecords(before, line),
  });
  reconciliationEvents.emit("line-update", { line });
  return line;
}

export function deleteLine(
  db: ReconciliationDb,
  locals: App.Locals,
  sessionId: number,
  lineId: number,
) {
  const userId = authorize(locals, "delete");
  requireOpenSession(db, sessionId);
  const line = deleteLineQuery(db, sessionId, lineId);
  if (!line) throw new ReconciliationError("Statement line not found", 404);
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: sessionId,
    userId,
    action: "update",
    changes: [{ field: "statementLine", before: line.id, after: null }],
  });
  reconciliationEvents.emit("line-deleted", { id: lineId, sessionId });
}

function ledgerRecordType(itemType: ReconItemTypeCode) {
  if (itemType === ReconItemType.Expense) return "expense" as const;
  if (itemType === ReconItemType.Claim) return "claim" as const;
  return "income" as const;
}

function emitLedgerItem(
  db: ReconciliationDb,
  itemType: ReconItemTypeCode,
  itemId: number,
) {
  if (itemType === ReconItemType.Expense) {
    expenseEvents.emit("expense-update", { item: getExpense(db, itemId) });
  } else if (itemType === ReconItemType.Claim) {
    claimEvents.emit("claim-update", { item: getClaim(db, itemId) });
  } else {
    incomeEvents.emit("income-update", { item: getIncome(db, itemId) });
  }
}

export function acceptMatch(
  db: ReconciliationDb,
  locals: App.Locals,
  sessionId: number,
  lineId: number,
  itemType: ReconItemTypeCode,
  itemId: number,
) {
  const userId = authorize(locals, "change");
  requireOpenSession(db, sessionId);
  const line = getLine(db, sessionId, lineId);
  if (!line) throw new ReconciliationError("Statement line not found", 404);
  if (itemType === ReconItemType.Expense && isClaimedExpense(db, itemId)) {
    throw new ReconciliationError("A claimed expense must be matched through its claim", 409);
  }
  const state = getItemState(db, itemType, itemId);
  if (state?.clearedSessionId != null && state.clearedSessionId !== sessionId) {
    throw new ReconciliationError("This item was cleared in an earlier session", 409);
  }
  if (state?.annotation === LeftoverAnnotation.WillNotClear) {
    throw new ReconciliationError("This item is marked as never clearing", 409);
  }
  if (state?.clearedLineId != null && state.clearedLineId !== lineId) {
    throw new ReconciliationError("This item is already matched to another statement line", 409);
  }
  const item = getCandidates(db, sessionId).find(
    (candidate) => candidate.itemType === itemType && candidate.itemId === itemId,
  );
  if (!item) throw new ReconciliationError("Reconciliation item not found", 404);

  const clearedAmount = mainAmount(item);
  const now = new Date().toISOString();
  const updatedLine = db.transaction(() => {
    upsertItemState(db, {
      itemType,
      itemId,
      clearedSessionId: sessionId,
      clearedLineId: lineId,
      clearedAmount,
      clearedAt: now,
      annotation: state?.annotation ?? null,
      annotationSessionId: state?.annotationSessionId ?? null,
      annotationNote: state?.annotationNote ?? "",
      updatedBy: userId,
    });
    return setLineMatch(db, sessionId, lineId, { itemType, itemId })!;
  });

  recordAudit(db, {
    recordType: "reconciliation",
    recordId: sessionId,
    userId,
    action: "update",
    changes: [{ field: "matchedLine", before: null, after: lineId }],
  });
  recordAudit(db, {
    recordType: ledgerRecordType(itemType),
    recordId: itemId,
    userId,
    action: "update",
    changes: [{ field: "cleared", before: false, after: true }],
  });
  reconciliationEvents.emit("line-update", { line: updatedLine });
  reconciliationEvents.emit("item-state-update", {
    itemType,
    itemId,
    cleared: true,
    clearedSessionId: sessionId,
    clearedLineId: lineId,
    annotation: state?.annotation ?? null,
  });
  emitLedgerItem(db, itemType, itemId);
  return { line: updatedLine, item: { ...item, cleared: true, clearedLineId: lineId } };
}

export function undoMatch(
  db: ReconciliationDb,
  locals: App.Locals,
  sessionId: number,
  lineId: number,
) {
  const userId = authorize(locals, "change");
  requireOpenSession(db, sessionId);
  const line = getLine(db, sessionId, lineId);
  if (!line) throw new ReconciliationError("Statement line not found", 404);
  if (line.matchedItemType === null || line.matchedItemId === null) return;
  const itemType = line.matchedItemType;
  const itemId = line.matchedItemId;
  const state = getItemState(db, itemType, itemId);
  const updatedLine = db.transaction(() => {
    setLineMatch(db, sessionId, lineId, null);
    if (state) {
      upsertItemState(db, {
        itemType,
        itemId,
        clearedSessionId: null,
        clearedLineId: null,
        clearedAmount: null,
        clearedAt: null,
        annotation: state.annotation,
        annotationSessionId: state.annotationSessionId,
        annotationNote: state.annotationNote,
        updatedBy: userId,
      });
      removeEmptyItemState(db, itemType, itemId);
    }
    return getLine(db, sessionId, lineId)!;
  });
  recordAudit(db, {
    recordType: ledgerRecordType(itemType),
    recordId: itemId,
    userId,
    action: "update",
    changes: [{ field: "cleared", before: true, after: false }],
  });
  reconciliationEvents.emit("line-update", { line: updatedLine });
  reconciliationEvents.emit("item-state-update", {
    itemType,
    itemId,
    cleared: false,
    clearedSessionId: null,
    clearedLineId: null,
    annotation: state?.annotation ?? null,
  });
  emitLedgerItem(db, itemType, itemId);
}

export function setAnnotation(
  db: ReconciliationDb,
  locals: App.Locals,
  sessionId: number,
  itemType: ReconItemTypeCode,
  itemId: number,
  annotation: LeftoverAnnotationCode | null,
  note = "",
) {
  const userId = authorize(locals, "change");
  requireOpenSession(db, sessionId);
  const before = getItemState(db, itemType, itemId);
  if (before?.clearedSessionId != null) {
    throw new ReconciliationError("A cleared item cannot be annotated", 409);
  }
  const state = upsertItemState(db, {
    itemType,
    itemId,
    clearedSessionId: null,
    clearedLineId: null,
    clearedAmount: null,
    clearedAt: null,
    annotation,
    annotationSessionId: annotation === null ? null : sessionId,
    annotationNote: annotation === null ? "" : note,
    updatedBy: userId,
  });
  const after = removeEmptyItemState(db, itemType, itemId);
  recordAudit(db, {
    recordType: ledgerRecordType(itemType),
    recordId: itemId,
    userId,
    action: "update",
    changes: diffRecords(before, after),
  });
  reconciliationEvents.emit("item-state-update", {
    itemType,
    itemId,
    cleared: false,
    clearedSessionId: null,
    clearedLineId: null,
    annotation,
  });
  emitLedgerItem(db, itemType, itemId);
  return annotation === null ? null : state;
}

export function reopenSession(
  db: ReconciliationDb,
  locals: App.Locals,
  id: number,
) {
  const userId = authorize(locals, "change");
  const before = getSession(db, id);
  if (!before)
    throw new ReconciliationError("Reconciliation session not found", 404);
  const sessions = listSessions(db);
  const newestId = sessions[0]?.id ?? 0;
  if (!canMutateSession(before, newestId)) {
    throw new ReconciliationError("Only the newest reconciliation can be reopened", 409);
  }
  const open = getOpenSession(db);
  if (open && open.id !== id) {
    throw new ReconciliationError("Another reconciliation session is already open", 409, {
      openSessionId: open.id,
    });
  }
  const after = updateSession(db, id, {
    status: ReconSessionStatus.Open,
    computedBalance: null,
    clearedCount: 0,
    unclearedCount: 0,
    unmatchedLineCount: 0,
    closedAt: null,
    updatedBy: userId,
  })!;
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: id,
    userId,
    action: "update",
    changes: diffRecords(before, after),
  });
  emitSession(db, id);
  return getSessionDetail(db, locals, id);
}

export function deleteSession(
  db: ReconciliationDb,
  locals: App.Locals,
  id: number,
) {
  const userId = authorize(locals, "delete");
  const session = getSession(db, id);
  if (!session)
    throw new ReconciliationError("Reconciliation session not found", 404);
  const newestId = listSessions(db)[0]?.id ?? 0;
  if (!canMutateSession(session, newestId)) {
    throw new ReconciliationError("Only the newest reconciliation can be deleted", 409);
  }
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: id,
    userId,
    action: "delete",
    changes: diffRecords(session, null),
  });
  const changes = deleteSessionData(db, id);
  deleteReconciliationFolder(id);
  for (const { before, after } of changes) {
    if (before.clearedSessionId === id) {
      recordAudit(db, {
        recordType: ledgerRecordType(before.itemType),
        recordId: before.itemId,
        userId,
        action: "update",
        changes: [{ field: "cleared", before: true, after: false }],
      });
      emitLedgerItem(db, before.itemType, before.itemId);
    }
    reconciliationEvents.emit("item-state-update", {
      itemType: before.itemType,
      itemId: before.itemId,
      cleared: after?.clearedSessionId != null,
      clearedSessionId: after?.clearedSessionId ?? null,
      clearedLineId: after?.clearedLineId ?? null,
      annotation: after?.annotation ?? null,
    });
  }
  reconciliationEvents.emit("session-deleted", { id });
}
