import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { ReconItemType } from "$lib/enums.js";
import {
  replaceRecordAllocations,
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
export const PUT: RequestHandler = async ({ locals, params, request }) => {
  const p = schema.safeParse(await request.json().catch(() => null)),
    type = Number(params.itemType),
    item = Number(params.itemId);
  if (
    !p.success ||
    ![
      ReconItemType.Expense,
      ReconItemType.Claim,
      ReconItemType.Income,
    ].includes(type as never) ||
    !Number.isInteger(item)
  )
    return Response.json(
      { error: p.success ? "Invalid record" : "Invalid allocations" },
      { status: 400 },
    );
  try {
    return Response.json(
      replaceRecordAllocations(
        db,
        locals,
        type as never,
        item,
        p.data.allocations,
      ),
    );
  } catch (e) {
    if (e instanceof ReconciliationError)
      return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
};
