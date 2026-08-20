import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types.js";
import { loadAccountStatements } from "$lib/server/loaders/reconciliation.js";

/**
 * The statements for one account (FR-048, FR-050).
 *
 * A full page rather than a drawer: this is a work surface with many steps, the
 * named task-workspace exception in CLAUDE.md. It still has its own real
 * address a user can deep-link and share.
 */
export const load: PageServerLoad = ({ locals, params }) => {
  const accountId = Number(params.id);
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw error(404, "That account no longer exists.");
  }
  return loadAccountStatements(locals, accountId);
};
