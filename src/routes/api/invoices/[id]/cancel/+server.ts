import type { RequestHandler } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { getInvoice } from "$lib/server/queries/invoices.js";
import { cancelInvoice } from "$lib/server/services/invoices.js";
import { hasPermission } from "$lib/server/permissions.js";
import { forbidden, notFound, refused } from "$lib/server/api-response.js";

/**
 * Voiding a sent invoice. It keeps its number and is marked Cancelled, and its
 * issue posting leaves the books — including the reports for the period it was
 * issued in. Refused while anything has been paid against it, and for a draft,
 * which is deleted instead. The refusal's own sentence is what the screen shows.
 */
export const POST: RequestHandler = async ({ locals, params }) => {
  if (!hasPermission(locals, "invoices", "change")) return forbidden();

  const id = parseInt(params.id!);
  if (!getInvoice(db, id)) return notFound("That invoice no longer exists.");

  const result = cancelInvoice(db, id, locals.user!.id);
  if (!result.ok) return refused(result.reason);

  return Response.json(result.value);
};
