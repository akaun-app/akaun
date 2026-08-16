import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import {
  replaceMovementAllocations,
  ReconciliationError,
} from "$lib/server/services/reconciliation.js";

const schema = z.object({
  allocations: z.array(
    z.object({
      lineId: z.number().int().positive(),
      amount: z.number().positive(),
    }),
  ),
});

/** Replace every bank line matched against one movement (D-11). */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const movementId = Number(params.movementId);
  if (!parsed.success || !Number.isInteger(movementId) || movementId <= 0)
    return Response.json(
      { error: parsed.success ? "Invalid movement" : "Invalid allocations" },
      { status: 400 },
    );
  try {
    return Response.json(
      replaceMovementAllocations(
        db,
        locals,
        movementId,
        parsed.data.allocations,
      ),
    );
  } catch (e) {
    if (e instanceof ReconciliationError)
      return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
};
