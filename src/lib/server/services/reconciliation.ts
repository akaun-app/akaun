import {
  ReconItemType,
  StatementDirection,
  StatementExtractionState,
} from "$lib/enums.js";
import type { ReconItemTypeCode } from "$lib/enums.js";
import { diffRecords, recordAudit } from "$lib/server/audit.js";
import { deleteFile } from "$lib/server/file-storage.js";
import { hasPermission } from "$lib/server/permissions.js";
import { reconciliationEvents } from "$lib/server/reconciliation/events.js";
import {
  EPSILON,
  mainAmount,
  round2,
} from "$lib/server/reconciliation/types.js";
import {
  deleteLine as deleteLineQuery,
  deleteStatement as deleteStatementQuery,
  getLine,
  getStatement,
  insertStatement,
  listAllocations,
  listBankFacingItems,
  listItemAllocations,
  listLines,
  listStatements,
  replaceItemAllocations,
  updateLine as updateLineQuery,
  updateStatement,
} from "$lib/server/queries/reconciliation.js";
import type { ReconciliationDb } from "$lib/server/queries/reconciliation.js";

export class ReconciliationError extends Error {
  constructor(
    message: string,
    public status = 400,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
function authorize(
  locals: App.Locals,
  action: "view" | "add" | "change" | "delete",
) {
  if (!locals.user) throw new ReconciliationError("Unauthorized", 401);
  if (!hasPermission(locals, "reconciliation", action))
    throw new ReconciliationError("Forbidden", 403);
  return locals.user.id;
}

function lineRemainders(db: ReconciliationDb) {
  const allocations = listAllocations(db);
  return listLines(db).map((line) => {
    const allocated = allocations
      .filter((a) => a.lineId === line.id)
      .reduce((s, a) => s + a.amount, 0);
    return {
      ...line,
      allocatedAmount: round2(allocated),
      remainingAmount: round2(line.amount - allocated),
    };
  });
}
function statementSummary(
  db: ReconciliationDb,
  statement: NonNullable<ReturnType<typeof getStatement>>,
) {
  const lines = lineRemainders(db).filter(
    (l) => l.statementId === statement.id,
  );
  const remaining = lines.filter((l) => l.remainingAmount >= EPSILON);
  return {
    ...statement,
    dateFrom: lines[0]?.date ?? null,
    dateTo: lines.at(-1)?.date ?? null,
    totalLines: lines.length,
    matchedCount: lines.length - remaining.length,
    remainingCount: remaining.length,
    remainingAmount: round2(
      remaining.reduce((s, l) => s + l.remainingAmount, 0),
    ),
    completed:
      statement.extractionState === StatementExtractionState.Ready &&
      remaining.length === 0,
  };
}
export function listStatementSummaries(
  db: ReconciliationDb,
  locals: App.Locals,
) {
  authorize(locals, "view");
  return listStatements(db).map((s) => statementSummary(db, s));
}
export function getStatementDetail(
  db: ReconciliationDb,
  locals: App.Locals,
  id: number,
) {
  authorize(locals, "view");
  const s = getStatement(db, id);
  if (!s) throw new ReconciliationError("Bank statement not found", 404);
  return {
    statement: statementSummary(db, s),
    lines: lineRemainders(db).filter((l) => l.statementId === id),
  };
}
export function createStatement(
  db: ReconciliationDb,
  locals: App.Locals,
  input: { originalFilename: string; storedFilePath: string },
) {
  const userId = authorize(locals, "add");
  const s = insertStatement(db, {
    ...input,
    extractionState: StatementExtractionState.Extracting,
    uploadedBy: userId,
  });
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: s.id,
    userId,
    action: "create",
  });
  reconciliationEvents.emit("statement-update", {
    statement: statementSummary(db, s),
  });
  return s;
}
export function setStatementExtraction(
  db: ReconciliationDb,
  id: number,
  state: number,
  error: string | null = null,
) {
  const before = getStatement(db, id);
  const s = updateStatement(db, id, {
    extractionState: state,
    extractionError: error,
  });
  if (s) {
    recordAudit(db, {
      recordType: "reconciliation",
      recordId: id,
      userId: s.uploadedBy,
      action: "update",
      changes: diffRecords(before, s),
    });
    reconciliationEvents.emit("statement-update", {
      statement: statementSummary(db, s),
    });
  }
  return s;
}
export function editLine(
  db: ReconciliationDb,
  locals: App.Locals,
  id: number,
  patch: Parameters<typeof updateLineQuery>[2],
) {
  const userId = authorize(locals, "change"),
    before = getLine(db, id);
  if (!before) throw new ReconciliationError("Statement line not found", 404);
  const after = updateLineQuery(db, id, patch)!;
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: before.statementId,
    userId,
    action: "update",
    changes: diffRecords(before, after),
  });
  reconciliationEvents.emit("line-update", {
    line: after,
    statementId: before.statementId,
  });
  return after;
}
export function removeLine(
  db: ReconciliationDb,
  locals: App.Locals,
  id: number,
) {
  const userId = authorize(locals, "delete"),
    before = getLine(db, id);
  if (!before) throw new ReconciliationError("Statement line not found", 404);
  deleteLineQuery(db, id);
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: before.statementId,
    userId,
    action: "update",
    changes: [{ field: "line", before, after: null }],
  });
  reconciliationEvents.emit("line-deleted", {
    id,
    statementId: before.statementId,
  });
}
export function removeStatement(
  db: ReconciliationDb,
  locals: App.Locals,
  id: number,
) {
  const userId = authorize(locals, "delete"),
    before = getStatement(db, id);
  if (!before) throw new ReconciliationError("Bank statement not found", 404);
  deleteStatementQuery(db, id);
  deleteFile(before.storedFilePath);
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: id,
    userId,
    action: "delete",
  });
  reconciliationEvents.emit("statement-deleted", { id });
}
export function workspace(
  db: ReconciliationDb,
  locals: App.Locals,
  from?: string | null,
  to?: string | null,
) {
  authorize(locals, "view");
  const records = listBankFacingItems(db, from, to);
  const lines = lineRemainders(db);
  const statements = listStatements(db).map((s) => statementSummary(db, s));
  return { records, lines, statements, allocations: listAllocations(db) };
}
export function replaceRecordAllocations(
  db: ReconciliationDb,
  locals: App.Locals,
  itemType: ReconItemTypeCode,
  itemId: number,
  inputs: { lineId: number; amount: number }[],
) {
  const userId = authorize(locals, "change");
  const item = listBankFacingItems(db).find(
    (i) => i.itemType === itemType && i.itemId === itemId,
  );
  if (!item)
    throw new ReconciliationError("Reconciliation record not found", 404);
  const seen = new Set<number>();
  const all = listAllocations(db);
  for (const input of inputs) {
    if (seen.has(input.lineId))
      throw new ReconciliationError(
        "A statement line can only appear once",
        409,
      );
    seen.add(input.lineId);
    if (!Number.isFinite(input.amount) || input.amount <= 0)
      throw new ReconciliationError("Allocation amounts must be positive", 409);
    const line = getLine(db, input.lineId);
    if (!line) throw new ReconciliationError("Statement line not found", 404);
    const direction =
      itemType === ReconItemType.Income
        ? StatementDirection.In
        : StatementDirection.Out;
    if (line.direction !== direction)
      throw new ReconciliationError(
        "This statement line has the wrong money direction",
        409,
      );
    const occupied = all
      .filter(
        (a) =>
          a.lineId === line.id &&
          !(a.itemType === itemType && a.itemId === itemId),
      )
      .reduce((s, a) => s + a.amount, 0);
    if (input.amount - (line.amount - occupied) > EPSILON)
      throw new ReconciliationError(
        "An allocation exceeds the statement line's remaining balance",
        409,
      );
  }
  const total = inputs.reduce((s, a) => s + a.amount, 0);
  if (total - mainAmount(item) > EPSILON)
    throw new ReconciliationError(
      "Allocations cannot exceed the Akaun record's amount",
      409,
    );
  const before = listItemAllocations(db, itemType, itemId);
  const saved = replaceItemAllocations(
    db,
    itemType,
    itemId,
    mainAmount(item),
    inputs.map((i) => ({ ...i, amount: round2(i.amount) })),
    userId,
  );
  recordAudit(db, {
    recordType: "reconciliation",
    recordId: itemId,
    userId,
    action: "update",
    changes: [
      { field: `allocations:${itemType}:${itemId}`, before, after: saved },
    ],
  });
  reconciliationEvents.emit("allocation-update", {
    itemType,
    itemId,
    lineIds: [...new Set([...before, ...saved].map((a) => a.lineId))],
  });
  return {
    record: listBankFacingItems(db).find(
      (i) => i.itemType === itemType && i.itemId === itemId,
    ),
    allocations: saved,
  };
}
