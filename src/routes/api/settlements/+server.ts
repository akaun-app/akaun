import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { badRequest, forbidden, refused } from "$lib/server/api-response.js";
import { outstandingAgeing } from "$lib/server/queries/settlements.js";
import { isValidDate } from "$lib/server/date.js";
import { createSettlements } from "$lib/server/services/settlements.js";

const createSchema = z
  .object({
    paymentMovementId: z.number().int().positive(),
    allocations: z
      .array(
        z.object({
          owedMovementId: z.number().int().positive(),
          amountMinor: z.number().int().positive(),
        }),
      )
      .min(1),
  })
  .strict();

/**
 * What is still outstanding, in one direction.
 *
 * Both the payment screen's "what does this cover?" list and User Story 6's
 * who-owes-what views read this, because they are the same question — the
 * views only group the answer differently. So the reply carries `items` and
 * `totalOutstandingMinor` for the payment screen and the same items grouped
 * into age bands for the views; neither caller has to ask twice.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  if (!hasPermission(locals, "expenses", "view")) return forbidden();

  const p = url.searchParams;
  const direction =
    p.get("direction") === "owed-to-us" ? "owed-to-us" : "we-owe";
  const contactIdRaw = p.get("contactId");
  const contactId = contactIdRaw ? Number(contactIdRaw) : undefined;
  // A report of a past date ages against that date rather than against now.
  const asOf = p.get("asOf");

  return Response.json(
    outstandingAgeing(db, {
      direction,
      contactId: Number.isInteger(contactId) ? contactId : undefined,
      openOnly: p.get("openOnly") !== "false",
      asOf: isValidDate(asOf) ? asOf : undefined,
    }),
  );
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!hasPermission(locals, "expenses", "add")) return forbidden();

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);

  const result = createSettlements(
    db,
    locals.user!.id,
    parsed.data.paymentMovementId,
    parsed.data.allocations,
  );
  if (!result.ok) return refused(result.reason);

  return Response.json({ settlementIds: result.value }, { status: 201 });
};
