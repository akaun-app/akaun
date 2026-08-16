import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  badRequest,
  forbidden,
  notFound,
  refused,
} from "$lib/server/api-response.js";
import { getRecord } from "$lib/server/queries/ledger.js";
import { patchRecord, removeRecord } from "$lib/server/services/ledger.js";
import { isValidDate } from "$lib/server/date.js";
import { LedgerRecordKind } from "$lib/enums.js";

/**
 * One expense. A thin wrapper over the records service, kept at its old URL.
 *
 * Nothing here knows what locks a record: a record a payment has settled or a
 * bank line has been matched to refuses its amount, its date and its accounts
 * inside the service, with the sentence naming what to undo first (FR-017a).
 */

const accountId = z.number().int().positive();

const patchSchema = z
  .object({
    date: z
      .string()
      .refine(isValidDate, { message: "The date must be in YYYY-MM-DD form." })
      .optional(),
    description: z.string().trim().max(500).optional(),
    amount: z.number().finite().optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    exchangeRate: z.number().positive().optional(),
    reference: z.string().trim().max(200).optional(),
    remark: z.string().trim().max(2000).optional(),
    contactId: accountId.nullable().optional(),
    categoryAccountId: accountId.optional(),
    paidFromAccountId: accountId.nullable().optional(),
  })
  .strict();

const MISSING = "That expense no longer exists.";

/** The record at this id, but only when it really is an expense. */
function expenseAt(params: Partial<Record<string, string>>) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const record = getRecord(db, id);
  return record?.kind === LedgerRecordKind.Expense ? record : null;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  if (!hasPermission(locals, "expenses", "view")) return forbidden();

  const record = expenseAt(params);
  if (!record) return notFound(MISSING);
  return Response.json(record);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  if (!hasPermission(locals, "expenses", "change")) return forbidden();

  const record = expenseAt(params);
  if (!record) return notFound(MISSING);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);

  const result = patchRecord(db, record.id, locals.user!.id, parsed.data);
  if (!result.ok) return refused(result.reason);
  return Response.json(result.value);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!hasPermission(locals, "expenses", "delete")) return forbidden();

  const record = expenseAt(params);
  if (!record) return notFound(MISSING);

  const result = removeRecord(db, record.id, locals.user!.id);
  if (!result.ok) return refused(result.reason);
  return new Response(null, { status: 204 });
};
