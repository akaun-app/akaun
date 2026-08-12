import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { workspace } from "$lib/server/services/reconciliation.js";
export const GET: RequestHandler = ({ locals, url }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "reconciliation", "view"))
    return new Response("Forbidden", { status: 403 });
  return Response.json(
    workspace(
      db,
      locals,
      url.searchParams.get("from"),
      url.searchParams.get("to"),
    ),
  );
};
