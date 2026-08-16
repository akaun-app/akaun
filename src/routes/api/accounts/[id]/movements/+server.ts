import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { forbidden, notFound } from "$lib/server/api-response.js";
import { accountHistory } from "$lib/server/queries/accounts.js";

/**
 * The full history of one account with a running balance (FR-028).
 *
 * Narrow it with `dateFrom`/`dateTo`, not with an offset — see the note on
 * `accountHistory` for why paging by offset would report wrong balances.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!hasPermission(locals, "accounts", "view")) return forbidden();

  const id = Number((params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return notFound("That account no longer exists.");
  }

  const p = url.searchParams;
  const limitRaw = p.get("limit");

  const history = accountHistory(db, id, {
    dateFrom: p.get("dateFrom") ?? undefined,
    dateTo: p.get("dateTo") ?? undefined,
    limit: limitRaw ? Number(limitRaw) : undefined,
  });
  if (!history) return notFound("That account no longer exists.");

  return Response.json(history);
};
