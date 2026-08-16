import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { badRequest, forbidden, refused } from "$lib/server/api-response.js";
import { getRecord, listRecords } from "$lib/server/queries/ledger.js";
import { createRecord, removeRecord } from "$lib/server/services/ledger.js";
import { createSettlements } from "$lib/server/services/settlements.js";
import {
  resourceForKind,
  resourceForKindName,
} from "$lib/server/ledger/record-permissions.js";
import { isSharedOwedRole } from "$lib/server/ledger/account-type.js";
import { isValidDate } from "$lib/server/date.js";
import { mainCurrencyCode } from "$lib/server/currency/form.js";
import {
  setUserPreference,
  USER_PREF_KEYS,
} from "$lib/server/userPreferences.js";
import type { LedgerRecordKindCode } from "$lib/enums.js";
import type { RecordCreate } from "$lib/server/ledger/types.js";

/**
 * The one record store, over HTTP.
 *
 * The body describes what happened in the everyday terms of whichever screen
 * sent it. The API never asks a caller to construct movements — except for a
 * journal entry, which is the one shape that names its own sides and sits
 * behind its own permission (FR-020, FR-040).
 */

const accountId = z.number().int().positive();
const date = z.string().refine(isValidDate, {
  message: "The date must be in YYYY-MM-DD form.",
});

const common = {
  date,
  description: z.string().trim().max(500).default(""),
  amount: z.number().finite(),
  currency: z.string().trim().length(3).toUpperCase(),
  exchangeRate: z.number().positive().default(1),
  reference: z.string().trim().max(200).optional(),
  remark: z.string().trim().max(2000).optional(),
  contactId: accountId.nullable().optional(),
};

const createSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("expense"),
    categoryAccountId: accountId,
    // Null means someone else paid it, so it is owed to `contactId` (FR-008).
    paidFromAccountId: accountId.nullable(),
  }),
  z.object({
    ...common,
    kind: z.literal("income"),
    categoryAccountId: accountId,
    receivedIntoAccountId: accountId,
  }),
  z.object({
    ...common,
    kind: z.literal("transfer"),
    fromAccountId: accountId,
    toAccountId: accountId,
  }),
  z.object({
    ...common,
    kind: z.literal("payment"),
    paidFromAccountId: accountId,
    contactId: accountId,
    direction: z.enum(["we-pay", "we-receive"]),
    settlements: z
      .array(
        z.object({
          owedMovementId: accountId,
          amountMinor: z.number().int().positive(),
        }),
      )
      .default([]),
  }),
  z.object({
    ...common,
    kind: z.literal("journal"),
    movements: z
      .array(
        z.object({
          accountId,
          amountMinor: z.number().int(),
        }),
      )
      .min(2),
  }),
]);

export const GET: RequestHandler = async ({ locals, url }) => {
  const p = url.searchParams;

  const kindRaw = p.get("kind");
  const kind = kindRaw ? (Number(kindRaw) as LedgerRecordKindCode) : undefined;

  // With no kind asked for, the caller is asking across the store, so it needs
  // to be allowed to see every screen the store feeds.
  const resources = kind
    ? [resourceForKind(kind)]
    : (["expenses", "income"] as const);
  for (const resource of resources) {
    if (!hasPermission(locals, resource, "view")) return forbidden();
  }

  const num = (key: string): number | undefined => {
    const raw = p.get(key);
    if (raw === null) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };

  const paidRaw = p.get("paid");

  return Response.json(
    listRecords(db, {
      kind,
      accountId: num("accountId"),
      contactId: num("contactId"),
      categoryAccountId: num("categoryId") ?? num("categoryAccountId"),
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
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);

  const body = parsed.data;
  if (!hasPermission(locals, resourceForKindName(body.kind), "add")) {
    return forbidden();
  }

  const userId = locals.user!.id;
  const result = createRecord(db, userId, body as RecordCreate);
  if (!result.ok) return refused(result.reason);

  // Remember the foreign currency, so someone buying from the same supplier
  // every month does not re-pick it each time. Per screen, because what a
  // business buys abroad and what it sells abroad are rarely the same.
  if (body.currency !== mainCurrencyCode(db)) {
    setUserPreference(
      db,
      userId,
      body.kind === "income"
        ? USER_PREF_KEYS.lastForeignCurrencyIncome
        : USER_PREF_KEYS.lastForeignCurrencyExpense,
      body.currency,
    );
  }

  // A payment that says what it covers is one action for the user, so the
  // settlements are written in the same request rather than leaving the payment
  // recorded but unapplied if a second call never comes (FR-015).
  if (body.kind === "payment" && body.settlements.length > 0) {
    // The settling side is the one on the shared owed account — the side that
    // clears the debt, whichever direction the money went.
    const paymentMovement = result.value.movements.find((m) =>
      isSharedOwedRole(m.accountRole),
    );

    const settled = paymentMovement
      ? createSettlements(db, userId, paymentMovement.id, body.settlements)
      : ({
          ok: false,
          reason: "This payment does not touch anything that is owed.",
        } as const);

    if (!settled.ok) {
      // The payment was saved a moment ago and covers nothing, which is not
      // what was asked for. Take it back rather than leave a stray record the
      // user did not intend and would have to find and delete themselves.
      removeRecord(db, result.value.id, userId);
      return refused(settled.reason);
    }
  }

  return Response.json(getRecord(db, result.value.id) ?? result.value, {
    status: 201,
  });
};
