import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types.js";
import { loadStatementMatch } from "$lib/server/loaders/reconciliation.js";

/**
 * Matching one statement's lines against the account's movements (FR-052).
 *
 * Its own shareable address, which the matching surface has never had: it used
 * to be a tab inside one page, so there was no way to send somebody the
 * statement you were part-way through.
 */
export const load: PageServerLoad = ({ locals, params, url }) => {
  const accountId = Number(params.id);
  const statementId = Number(params.statementId);
  if (!Number.isInteger(accountId) || !Number.isInteger(statementId)) {
    throw error(404, "That statement no longer exists.");
  }
  return loadStatementMatch(
    locals,
    accountId,
    statementId,
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
};
