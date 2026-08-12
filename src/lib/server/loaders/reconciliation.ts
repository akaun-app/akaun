import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { workspace } from "$lib/server/services/reconciliation.js";
import { suggestExactAllocationSet } from "$lib/server/reconciliation/allocation.js";
import { ReconItemType, StatementDirection } from "$lib/enums.js";
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
    const direction =
      record.itemType === ReconItemType.Income
        ? StatementDirection.In
        : StatementDirection.Out;
    const savedLineIds = new Set(
      result.allocations
        .filter(
          (allocation) =>
            allocation.itemType === record.itemType &&
            allocation.itemId === record.itemId,
        )
        .map((allocation) => allocation.lineId),
    );
    const compatible = lines.filter(
      (line) =>
        line.direction === direction &&
        (line.remainingAmount >= 0.005 || savedLineIds.has(line.id)),
    );
    const suggestedLineIds = suggestExactAllocationSet(
      record.remainingAmount ?? 0,
      compatible.map((line) => ({
        id: line.id,
        amount: line.remainingAmount,
        score: Math.max(
          0,
          30 -
            Math.abs(Date.parse(record.date) - Date.parse(line.date)) /
              86_400_000,
        ),
      })),
    );
    return { ...record, suggestedLineIds };
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
