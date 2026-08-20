import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { forbidden, notFound, refused } from "$lib/server/api-response.js";
import { undoSettlement } from "$lib/server/services/settlements.js";

/**
 * Undoes one allocation. Both sides return to outstanding, and any field the
 * settlement was locking becomes editable again (FR-017).
 */
export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!hasPermission(locals, "records", "delete")) return forbidden();

  const id = Number((params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return notFound("That settlement no longer exists.");
  }

  const result = undoSettlement(db, id, locals.user!.id);
  if (!result.ok) return refused(result.reason);
  return new Response(null, { status: 204 });
};
