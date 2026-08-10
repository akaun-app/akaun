import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  getCandidates,
  listLines,
  listSessions,
} from "$lib/server/queries/reconciliation.js";
import {
  findDuplicateLines,
  rankCandidates,
} from "$lib/server/reconciliation/matching.js";
import { prefillFromLastClosed } from "$lib/server/reconciliation/session-rules.js";
import {
  getSessionDetail,
  listSessionSummaries,
} from "$lib/server/services/reconciliation.js";

export function loadReconciliationPage(
  locals: App.Locals,
  openSessionId: number | null,
) {
  if (!hasPermission(locals, "reconciliation", "view"))
    throw redirect(302, "/dashboard");

  const overview = listSessionSummaries(db, locals);
  if (
    openSessionId !== null &&
    !overview.sessions.some((session) => session.id === openSessionId)
  ) {
    throw redirect(302, "/reconciliation");
  }

  return {
    ...overview,
    openSessionId,
    selectedSession: openSessionId
      ? getSessionDetail(db, locals, openSessionId)
      : null,
    prefill: prefillFromLastClosed(listSessions(db)),
    permissions: locals.permissions?.reconciliation ?? {
      view: false,
      add: false,
      change: false,
      delete: false,
    },
  };
}

export function loadMatchWorkspace(locals: App.Locals, id: number) {
  if (!hasPermission(locals, "reconciliation", "view")) {
    throw redirect(302, "/dashboard");
  }
  const sessionDetail = getSessionDetail(db, locals, id);
  const rawLines = listLines(db, id);
  if (rawLines.length === 0) throw redirect(302, `/reconciliation/${id}`);
  const candidates = getCandidates(db, id);
  const duplicates = findDuplicateLines(rawLines);
  const lines = rawLines.map((line) => ({
    ...line,
    isDuplicate: duplicates.has(line.id),
    suggestion: rankCandidates(line, candidates)[0] ?? null,
  }));
  return {
    ...sessionDetail,
    lines,
    candidates,
    permissions: locals.permissions?.reconciliation ?? {
      view: false,
      add: false,
      change: false,
      delete: false,
    },
  };
}
