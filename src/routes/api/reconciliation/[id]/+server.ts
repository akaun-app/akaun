import type { RequestHandler } from "./$types.js";
import { z } from "zod";
import { ReconSessionStatus } from "$lib/enums.js";
import { db } from "$lib/server/db/client.js";
import { isValidDate } from "$lib/server/date.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  closeSession,
  deleteSession,
  getSessionDetail,
  ReconciliationError,
  reopenSession,
  updateSessionFields,
} from "$lib/server/services/reconciliation.js";

const PatchSessionSchema = z
  .object({
    startingBalance: z.number().finite().optional(),
    startingDate: z
      .string()
      .refine(isValidDate, "startingDate must be in YYYY-MM-DD format")
      .optional(),
    periodEndDate: z
      .string()
      .refine(isValidDate, "periodEndDate must be in YYYY-MM-DD format")
      .optional(),
    statementEndingBalance: z.number().finite().optional(),
    status: z
      .union([
        z.literal(ReconSessionStatus.Open),
        z.literal(ReconSessionStatus.ClosedMatched),
        z.literal(ReconSessionStatus.ClosedWithLeftovers),
      ])
      .optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    {
      message: "At least one field is required",
    },
  );

function parseId(value: string | undefined): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function errorResponse(error: unknown): Response {
  if (error instanceof ReconciliationError) {
    return Response.json(
      { error: error.message, ...error.details },
      { status: error.status },
    );
  }
  throw error;
}

export const GET: RequestHandler = ({ locals, params }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "reconciliation", "view")) {
    return new Response("Forbidden", { status: 403 });
  }
  const id = parseId(params.id);
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    return Response.json(getSessionDetail(db, locals, id));
  } catch (error) {
    return errorResponse(error);
  }
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "reconciliation", "change")) {
    return new Response("Forbidden", { status: 403 });
  }
  const id = parseId(params.id);
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });
  const parsed = PatchSessionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.status === ReconSessionStatus.Open) {
      return Response.json(reopenSession(db, locals, id));
    }
    if (parsed.data.status !== undefined)
      return Response.json(closeSession(db, locals, id));
    const fields = {
      startingBalance: parsed.data.startingBalance,
      startingDate: parsed.data.startingDate,
      periodEndDate: parsed.data.periodEndDate,
      statementEndingBalance: parsed.data.statementEndingBalance,
    };
    return Response.json(updateSessionFields(db, locals, id, fields));
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: RequestHandler = ({ locals, params }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "reconciliation", "delete")) {
    return new Response("Forbidden", { status: 403 });
  }
  const id = parseId(params.id);
  if (!id) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    deleteSession(db, locals, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
