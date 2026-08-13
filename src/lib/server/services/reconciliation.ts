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
import { suggestLinesForRecord } from "$lib/server/reconciliation/suggestions.js";
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
/**
 * Put a failed statement back in the extraction queue. The uploaded file is
 * still on disk, so a retry is just a re-run against the same
 * `storedFilePath` — the caller kicks off `processStatementImport` with the
 * statement this returns.
 *
 * Gated on `add`, the same capability that started the original import.
 */
export function retryStatementExtraction(
  db: ReconciliationDb,
  locals: App.Locals,
  id: number,
) {
  authorize(locals, "add");
  const statement = getStatement(db, id);
  if (!statement)
    throw new ReconciliationError("Bank statement not found", 404);
  if (statement.extractionState !== StatementExtractionState.Failed)
    throw new ReconciliationError(
      "Only a failed statement can be retried",
      409,
    );
  // A failed run never reaches the insert step, so there should be nothing
  // here. Refuse rather than re-run if that ever stops holding — a second
  // pass would duplicate every transaction.
  if (listLines(db, id).length)
    throw new ReconciliationError(
      "This statement already has transactions. Delete it and upload the file again.",
      409,
    );
  return setStatementExtraction(
    db,
    id,
    StatementExtractionState.Extracting,
    null,
  )!;
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
/**
 * Save the suggested exact-match allocations for many records in one pass.
 *
 * Suggestions are computed per record and independently, so two records can
 * both propose the same statement line. Walking the list against a live
 * remainder map — rather than the snapshot each record was suggested from —
 * lets an already-consumed line drop out of the next record's candidate set:
 * that record is reported as skipped and left for review instead of failing
 * the whole batch with a 409.
 *
 * Deliberately not wrapped in an outer transaction: `replaceItemAllocations`
 * opens its own, so every record's write is atomic on its own. A throw
 * mid-batch leaves the earlier records legitimately saved.
 */
export function autoMatchRecords(
  db: ReconciliationDb,
  locals: App.Locals,
  targets: { itemType: ReconItemTypeCode; itemId: number }[],
) {
  const userId = authorize(locals, "change");
  const items = listBankFacingItems(db);
  const lines = lineRemainders(db);
  const remainingByLine = new Map(
    lines.map((line) => [line.id, line.remainingAmount]),
  );
  let matched = 0;
  let skipped = 0;
  const matchedKeys: string[] = [];

  for (const target of targets) {
    const item = items.find(
      (candidate) =>
        candidate.itemType === target.itemType &&
        candidate.itemId === target.itemId,
    );
    // Bulk matching only ever fills in untouched records — an existing
    // allocation is somebody's decision and is never overwritten here.
    if (
      !item ||
      (item.allocatedAmount ?? 0) >= EPSILON ||
      (item.remainingAmount ?? 0) < EPSILON
    ) {
      skipped += 1;
      continue;
    }
    const suggested = suggestLinesForRecord(
      item,
      lines.map((line) => ({
        ...line,
        remainingAmount: remainingByLine.get(line.id) ?? 0,
      })),
    );
    if (!suggested.length) {
      skipped += 1;
      continue;
    }
    let remaining = item.remainingAmount ?? 0;
    const allocations: { lineId: number; amount: number }[] = [];
    for (const lineId of suggested) {
      const amount = round2(
        Math.min(remainingByLine.get(lineId) ?? 0, remaining),
      );
      if (amount < EPSILON) continue;
      remaining = round2(remaining - amount);
      allocations.push({ lineId, amount });
    }
    if (!allocations.length) {
      skipped += 1;
      continue;
    }
    const before = listItemAllocations(db, item.itemType, item.itemId);
    const saved = replaceItemAllocations(
      db,
      item.itemType,
      item.itemId,
      mainAmount(item),
      allocations,
      userId,
    );
    for (const allocation of allocations) {
      remainingByLine.set(
        allocation.lineId,
        round2(
          (remainingByLine.get(allocation.lineId) ?? 0) - allocation.amount,
        ),
      );
    }
    recordAudit(db, {
      recordType: "reconciliation",
      recordId: item.itemId,
      userId,
      action: "update",
      changes: [
        {
          field: `allocations:${item.itemType}:${item.itemId}`,
          before,
          after: saved,
        },
      ],
    });
    matched += 1;
    matchedKeys.push(`${item.itemType}:${item.itemId}`);
  }

  // One event for the whole batch: every connected client reloads the
  // workspace on any allocation event, so emitting per record would cost
  // each open tab N redundant round-trips.
  if (matched)
    reconciliationEvents.emit("allocations-bulk-update", { matched });
  return { matched, skipped, matchedKeys };
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
