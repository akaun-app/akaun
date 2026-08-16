import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { workspace } from "$lib/server/services/reconciliation.js";
import { suggestLinesForMovement } from "$lib/server/reconciliation/suggestions.js";

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
  const lines = result.lines.map((line) => {
    const statement = statementById.get(line.statementId);
    return {
      ...line,
      statementFilename: statement?.originalFilename ?? "Bank statement",
      accountName: statement?.accountName ?? null,
    };
  });
  const movements = result.movements.map((movement) => {
    const savedLineIds = new Set(
      result.allocations
        .filter((allocation) => allocation.movementId === movement.movementId)
        .map((allocation) => allocation.lineId),
    );
    return {
      ...movement,
      suggestedLineIds: suggestLinesForMovement(movement, lines, savedLineIds),
    };
  });
  return {
    ...result,
    movements,
    lines,
    permissions: locals.permissions?.reconciliation ?? {
      view: false,
      add: false,
      change: false,
      delete: false,
    },
  };
}
