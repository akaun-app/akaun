import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { workspace } from "$lib/server/services/reconciliation.js";
import { suggestLinesForRecord } from "$lib/server/reconciliation/suggestions.js";
export function loadReconciliationPage(
  locals: App.Locals,
  from?: string | null,
  to?: string | null,
) {
  if (!hasPermission(locals, "reconciliation", "view"))
    throw redirect(302, "/dashboard");
  const result = workspace(db, locals, from, to);
  const statementById = new Map(
    result.statements.map((statement) => [statement.id, statement]),
  );
  const lines = result.lines.map((line) => ({
    ...line,
    statementFilename:
      statementById.get(line.statementId)?.originalFilename ?? "Bank statement",
  }));
  const records = result.records.map((record) => {
    const savedLineIds = new Set(
      result.allocations
        .filter(
          (allocation) =>
            allocation.itemType === record.itemType &&
            allocation.itemId === record.itemId,
        )
        .map((allocation) => allocation.lineId),
    );
    return {
      ...record,
      suggestedLineIds: suggestLinesForRecord(record, lines, savedLineIds),
    };
  });
  return {
    ...result,
    records,
    lines,
    permissions: locals.permissions?.reconciliation ?? {
      view: false,
      add: false,
      change: false,
      delete: false,
    },
  };
}
