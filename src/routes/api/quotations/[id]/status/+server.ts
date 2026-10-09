import { z } from "zod";
import type { RequestHandler } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { getQuotation } from "$lib/server/queries/quotations.js";
import { setQuotationStatus } from "$lib/server/services/quotations.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  badRequest,
  forbidden,
  notFound,
  refused,
} from "$lib/server/api-response.js";
import { QuotationStatus } from "$lib/enums.js";

/**
 * Moving a quotation along by hand: sent, accepted, declined, or back again.
 * Converted is not on the list — it is reached only by converting — and
 * `setQuotationStatus` refuses any move out of it, so a converted quotation
 * cannot be pulled away from the invoice it became.
 */

const STATUS_BY_NAME = {
  draft: QuotationStatus.Draft,
  sent: QuotationStatus.Sent,
  accepted: QuotationStatus.Accepted,
  declined: QuotationStatus.Declined,
} as const;

const statusSchema = z.object({
  status: z.enum(["draft", "sent", "accepted", "declined"]),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!hasPermission(locals, "quotations", "change")) return forbidden();

  const raw = await request.json().catch(() => ({}));
  const parsed = statusSchema.safeParse(raw ?? {});
  if (!parsed.success) return badRequest(parsed.error);

  const id = parseInt(params.id!);
  if (!getQuotation(db, id))
    return notFound("That quotation no longer exists.");

  const result = setQuotationStatus(
    db,
    id,
    locals.user!.id,
    STATUS_BY_NAME[parsed.data.status],
  );
  if (!result.ok) return refused(result.reason);

  return Response.json(result.value);
};
