import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { StatementDirection } from "$lib/enums.js";
import {
  editLine,
  removeLine,
  ReconciliationError,
} from "$lib/server/services/reconciliation.js";
const schema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    description: z.string().max(500).optional(),
    amount: z.number().positive().optional(),
    direction: z
      .union([
        z.literal(StatementDirection.In),
        z.literal(StatementDirection.Out),
      ])
      .optional(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => Object.keys(v).length > 0);
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const p = schema.safeParse(await request.json().catch(() => null));
  if (!p.success)
    return Response.json(
      { error: p.error.issues[0]?.message },
      { status: 400 },
    );
  try {
    return Response.json(editLine(db, locals, Number(params.lineId), p.data));
  } catch (e) {
    if (e instanceof ReconciliationError)
      return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
};
export const DELETE: RequestHandler = ({ locals, params }) => {
  try {
    removeLine(db, locals, Number(params.lineId));
    return new Response(null, { status: 204 });
  } catch (e) {
    if (e instanceof ReconciliationError)
      return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
};
