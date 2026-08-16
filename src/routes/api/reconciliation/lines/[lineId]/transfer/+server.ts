import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import {
  createTransferForLine,
  ReconciliationError,
} from "$lib/server/services/reconciliation.js";

/**
 * The statement already says which account the line moved, so the only thing
 * left to ask is where the money came from or went (FR-023).
 */
const schema = z.object({
  otherAccountId: z.number().int().positive(),
  description: z.string().max(500).optional(),
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const lineId = Number(params.lineId);
  if (!parsed.success || !Number.isInteger(lineId) || lineId <= 0)
    return Response.json(
      { error: "Choose the other account for this transfer" },
      { status: 400 },
    );
  try {
    return Response.json(
      createTransferForLine(db, locals, lineId, parsed.data),
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ReconciliationError)
      return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
};
