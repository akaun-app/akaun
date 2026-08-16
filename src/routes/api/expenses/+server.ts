import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { badRequest, forbidden, refused } from "$lib/server/api-response.js";
import { listRecords } from "$lib/server/queries/ledger.js";
import { createRecord } from "$lib/server/services/ledger.js";
import { isValidDate } from "$lib/server/date.js";
import { LedgerRecordKind } from "$lib/enums.js";

/**
 * Money going out, over HTTP.
 *
 * There is one record store behind every screen now, so this is `/api/records`
 * with `kind` already answered. The URL is kept because callers outside the app
 * use it (contracts/api.md); everything it does happens in the records service,
 * which is where the permission-independent rules, the audit entry and the one
 * event live.
 */

const accountId = z.number().int().positive();

const createSchema = z
  .object({
    date: z.string().refine(isValidDate, {
      message: "The date must be in YYYY-MM-DD form.",
    }),
    description: z.string().trim().max(500).default(""),
    amount: z.number().finite(),
    currency: z.string().trim().length(3).toUpperCase(),
    exchangeRate: z.number().positive().default(1),
    reference: z.string().trim().max(200).optional(),
    remark: z.string().trim().max(2000).optional(),
    contactId: accountId.nullable().optional(),
    categoryAccountId: accountId,
    /** Null means someone else paid, so it is owed to `contactId` (FR-008). */
    paidFromAccountId: accountId.nullable(),
  })
  .strict();

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!hasPermission(locals, "expenses", "view")) return forbidden();
  const p = url.searchParams;

  const num = (key: string): number | undefined => {
    const raw = p.get(key);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };

  const paidRaw = p.get("paid");

  return Response.json(
    listRecords(db, {
      kind: LedgerRecordKind.Expense,
      accountId: num("accountId"),
      contactId: num("contactId"),
      categoryAccountId: num("categoryAccountId"),
      dateFrom: p.get("dateFrom") ?? undefined,
      dateTo: p.get("dateTo") ?? undefined,
      amountMin: num("amountMin"),
      amountMax: num("amountMax"),
      paid: paidRaw === null ? undefined : paidRaw === "true",
      search: p.get("search") ?? undefined,
      limit: num("limit"),
      offset: num("offset"),
    }),
  );
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!hasPermission(locals, "expenses", "add")) return forbidden();

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);

  const result = createRecord(db, locals.user!.id, {
    ...parsed.data,
    kind: "expense",
  });
  if (!result.ok) return refused(result.reason);

  return Response.json(result.value, { status: 201 });
};
