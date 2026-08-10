import type { RequestHandler } from "./$types.js";
import { z } from "zod";
import { db } from "$lib/server/db/client.js";
import { isValidDate } from "$lib/server/date.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  createSession,
  listSessionSummaries,
  ReconciliationError,
} from "$lib/server/services/reconciliation.js";

const CreateSessionSchema = z
  .object({
    startingBalance: z.number().finite(),
    startingDate: z
      .string()
      .refine(isValidDate, "startingDate must be in YYYY-MM-DD format"),
    periodEndDate: z
      .string()
      .refine(isValidDate, "periodEndDate must be in YYYY-MM-DD format"),
    statementEndingBalance: z.number().finite(),
  })
  .refine((value) => value.periodEndDate >= value.startingDate, {
    message: "periodEndDate must be on or after startingDate",
    path: ["periodEndDate"],
  });

function errorResponse(error: unknown): Response {
  if (error instanceof ReconciliationError) {
    return Response.json(
      { error: error.message, ...error.details },
      { status: error.status },
    );
  }
  throw error;
}

export const GET: RequestHandler = ({ locals, url }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "reconciliation", "view")) {
    return new Response("Forbidden", { status: 403 });
  }
  try {
    const result = listSessionSummaries(db, locals);
    const limit = Math.max(0, Number(url.searchParams.get("limit") ?? 50));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
    return Response.json({
      ...result,
      sessions: result.sessions.slice(offset, offset + limit),
    });
  } catch (error) {
    return errorResponse(error);
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "reconciliation", "add")) {
    return new Response("Forbidden", { status: 403 });
  }
  const parsed = CreateSessionSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }
  try {
    return Response.json(createSession(db, locals, parsed.data), {
      status: 201,
    });
  } catch (error) {
    return errorResponse(error);
  }
};
