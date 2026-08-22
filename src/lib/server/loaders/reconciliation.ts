import { error, redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { workspace } from "$lib/server/services/reconciliation.js";
import { suggestLinesForMovement } from "$lib/server/reconciliation/suggestions.js";
import { getAccount } from "$lib/server/queries/accounts.js";

/**
 * What each of the two reconciliation surfaces loads.
 *
 * Reconciling is reached from the account it belongs to, so both loaders are
 * scoped to one account and the matching surface to one statement as well
 * (FR-048, FR-052). Each surface loads only what it shows, rather than the
 * whole cross-account workspace the single page used to need.
 *
 * Nothing about reconciling's behaviour changes (FR-057). The candidate rule in
 * particular is untouched: only movements on the statement's own account are
 * ever offered, enforced in `listMovementCandidates` and again in
 * `suggestLinesForMovement`.
 */

function permissionsOf(locals: App.Locals) {
  return (
    locals.permissions?.reconciliation ?? {
      view: false,
      add: false,
      change: false,
      delete: false,
    }
  );
}

/** The account whose statements these are, or a refusal (FR-049). */
function postingAccountOr404(accountId: number) {
  const account = getAccount(db, accountId);
  if (!account) throw error(404, "That account no longer exists.");
  if (!account.active || !account.postingEligible) {
    throw error(
      400,
      "Only an active account without children can be checked against a statement.",
    );
  }
  return account;
}

/** The statements for one account, and how far each has got (FR-050). */
export function loadAccountStatements(locals: App.Locals, accountId: number) {
  if (!hasPermission(locals, "reconciliation", "view"))
    throw redirect(302, "/dashboard");

  const account = postingAccountOr404(accountId);
  const result = workspace(db, locals);

  return {
    account,
    statements: result.statements.filter((s) => s.accountId === accountId),
    // Every money-holding account, so a statement uploaded against the wrong
    // one can be moved to the right one (FR-054).
    accounts: result.accounts,
    permissions: permissionsOf(locals),
  };
}

/** One statement's lines, its account's movements, and what is matched (FR-052). */
export function loadStatementMatch(
  locals: App.Locals,
  accountId: number,
  statementId: number,
  from?: string | null,
  to?: string | null,
) {
  if (!hasPermission(locals, "reconciliation", "view"))
    throw redirect(302, "/dashboard");

  const account = postingAccountOr404(accountId);
  const result = workspace(db, locals, from, to);

  const statement = result.statements.find((s) => s.id === statementId);
  if (!statement) throw error(404, "That statement no longer exists.");
  // The address says which account, and the statement says which account. If
  // they disagree the link is stale — the statement was moved (FR-054).
  if (statement.accountId !== accountId) {
    throw redirect(
      302,
      `/accounts/${statement.accountId}/reconcile/${statementId}`,
    );
  }

  const lines = result.lines
    .filter((line) => line.statementId === statementId)
    .map((line) => ({
      ...line,
      statementFilename: statement.originalFilename ?? "Bank statement",
      accountName: statement.accountName ?? null,
    }));

  const allocations = result.allocations.filter((allocation) =>
    lines.some((line) => line.id === allocation.lineId),
  );

  const movements = result.movements.map((movement) => {
    const savedLineIds = new Set(
      allocations
        .filter((allocation) => allocation.movementId === movement.movementId)
        .map((allocation) => allocation.lineId),
    );
    return {
      ...movement,
      suggestedLineIds: suggestLinesForMovement(movement, lines, savedLineIds),
    };
  });

  return {
    account,
    statement,
    statements: [statement],
    lines,
    movements,
    allocations,
    accounts: result.accounts,
    permissions: permissionsOf(locals),
  };
}
