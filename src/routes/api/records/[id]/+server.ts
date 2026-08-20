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
import {
  isReadOnlyKind,
  resourceForKind,
} from "$lib/server/ledger/record-permissions.js";
import { isValidDate } from "$lib/server/date.js";
import { getAccount } from "$lib/server/queries/accounts.js";
import { sidesFromAccounts } from "$lib/server/ledger/sides-from-accounts.js";
import { toMinor } from "$lib/server/ledger/money.js";

const accountId = z.number().int().positive();

/**
 * Only the everyday fields. A settled or reconciled record refuses the amount,
 * the date and any account with a `409` naming what to undo first — the service
 * enforces that, so this schema stays about shape rather than state (FR-017a).
 */
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
    receivedIntoAccountId: accountId.optional(),
    fromAccountId: accountId.optional(),
    toAccountId: accountId.optional(),
  })
  .strict();

function idOf(params: { id: string }): number | null {
  const id = Number(params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const GET: RequestHandler = async ({ locals, params }) => {
  const id = idOf(params as { id: string });
  if (id === null) return notFound("That record no longer exists.");

  const record = getRecord(db, id);
  if (!record) return notFound("That record no longer exists.");
  if (!hasPermission(locals, resourceForKind(record.kind), "view")) {
    return forbidden();
  }
  return Response.json(record);
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
  const id = idOf(params as { id: string });
  if (id === null) return notFound("That record no longer exists.");

  const existing = getRecord(db, id);
  if (!existing) return notFound("That record no longer exists.");
  if (!hasPermission(locals, resourceForKind(existing.kind), "change")) {
    return forbidden();
  }
  if (isReadOnlyKind(existing.kind)) {
    return refused(
      "This record was created by issuing an invoice. Change it on the invoice instead.",
    );
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);

  const patch = parsed.data;

  // Both accounts named means the kind is being re-derived, so the same gate
  // the create path applies is applied here — after the derivation, because
  // whether a record needs the ability is a fact about the accounts it names
  // (FR-031c). The derivation is pure, so the service asking it again below
  // gets the same answer.
  if (patch.fromAccountId !== undefined && patch.toAccountId !== undefined) {
    const derived = sidesFromAccounts(
      {
        fromAccountId: patch.fromAccountId,
        toAccountId: patch.toAccountId,
        amountMinor: toMinor(
          patch.amount ?? existing.amount,
          patch.exchangeRate ?? existing.exchangeRate,
        ),
        contactId:
          patch.contactId !== undefined ? patch.contactId : existing.contactId,
      },
      {
        accountById: (accountId) => {
          const account = getAccount(db, accountId);
          return account
            ? {
                id: account.id,
                role: account.role,
                archived: account.archivedAt !== null,
              }
            : null;
        },
        canAdjust: hasPermission(locals, "adjustments", "change"),
      },
    );
    if (!derived.ok) return refused(derived.reason);
  }

  const result = patchRecord(db, id, locals.user!.id, patch);
  if (!result.ok) return refused(result.reason);
  return Response.json(result.value);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  const id = idOf(params as { id: string });
  if (id === null) return notFound("That record no longer exists.");

  const existing = getRecord(db, id);
  if (!existing) return notFound("That record no longer exists.");
  if (!hasPermission(locals, resourceForKind(existing.kind), "delete")) {
    return forbidden();
  }
  if (isReadOnlyKind(existing.kind)) {
    return refused(
      "This record was created by issuing an invoice. Cancel the invoice instead.",
    );
  }

  const result = removeRecord(db, id, locals.user!.id);
  if (!result.ok) return refused(result.reason);
  return new Response(null, { status: 204 });
};
