import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { ReconItemType } from "$lib/enums.js";
import type { ReconItemTypeCode } from "$lib/enums.js";
import {
  autoMatchRecords,
  ReconciliationError,
} from "$lib/server/services/reconciliation.js";

const schema = z.object({
  records: z
    .array(
      z.object({
        itemType: z
          .number()
          .int()
          .refine((value) =>
            (
              [
                ReconItemType.Expense,
                ReconItemType.Claim,
                ReconItemType.Income,
              ] as number[]
            ).includes(value),
          ),
        itemId: z.number().int().positive(),
      }),
    )
    // Mirrors BULK_MATCH_CHUNK in ReconciliationPage.svelte, which slices
    // larger selections into requests of this size.
    .max(500),
});

export const POST: RequestHandler = async ({ locals, request }) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "Invalid records" }, { status: 400 });
  try {
    return Response.json(
      autoMatchRecords(
        db,
        locals,
        parsed.data.records as {
          itemType: ReconItemTypeCode;
          itemId: number;
        }[],
      ),
    );
  } catch (e) {
    if (e instanceof ReconciliationError)
      return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
};
