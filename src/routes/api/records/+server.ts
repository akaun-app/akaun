import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { badRequest, forbidden, refused } from "$lib/server/api-response.js";
import { getRecord, listRecords } from "$lib/server/queries/ledger.js";
import { getAccount } from "$lib/server/queries/accounts.js";
import { sidesFromAccounts } from "$lib/server/ledger/sides-from-accounts.js";
import { toMinor } from "$lib/server/ledger/money.js";
import { createRecord, removeRecord } from "$lib/server/services/ledger.js";
import { createSettlements } from "$lib/server/services/settlements.js";
import { DefaultAccountPurpose } from "$lib/enums.js";
import { requireAccountDefault } from "$lib/server/services/account-defaults.js";
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

/**
 * What the one form sends: two accounts and no kind.
 *
 * The five variants above stay exactly as they are. Auto Import posts
 * `expense` and `income`, and `services/invoices.ts`, `services/accounts.ts`
 * and reconciliation's transfer action construct `RecordCreateSides` in
 * process, so removing any of them would break a caller this feature does not
 * touch (FR-036).
 *
 * This shape carries no `kind` at all, which is what tells the two apart: the
 * union above is discriminated on `kind` and cannot match a body without one.
 */
const fromSidesSchema = z.object({
  ...common,
  fromAccountId: accountId,
  toAccountId: accountId,
  /** Third and later sides. Requires `adjustments` (FR-031). */
  extraSides: z
    .array(z.object({ accountId, amountMinor: z.number().int() }))
    .optional(),
});

const bodySchema = z.union([createSchema, fromSidesSchema]);

/** A number that arrived as a query-string value. */
const numeric = z.coerce.number().finite().optional();

/** `true` / `false` as a query-string value. */
const flag = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

/**
 * Every filter the list accepts, in one place.
 *
 * `kind` takes a single value or a comma-separated list, because the Records
 * screen filters by more than one kind at a time and one store means one query
 * (FR-002).
 */
const querySchema = z.object({
  kind: z
    .string()
    .transform((raw) =>
      raw
        .split(",")
        .map((part) => Number(part.trim()))
        .filter((value) => Number.isInteger(value)),
    )
    .pipe(z.array(z.number().int()).min(1))
    .optional(),
  accountId: numeric,
  contactId: numeric,
  categoryId: numeric,
  categoryAccountId: numeric,
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  amountMin: numeric,
  amountMax: numeric,
  paid: flag,
  /** FR-056 — every account, not just those with a statement. */
  cleared: flag,
  /** FR-043 — the running balance is only offered in date order. */
  sort: z.enum(["date", "amount"]).optional(),
  search: z.string().optional(),
  limit: numeric,
  offset: numeric,
});

export const GET: RequestHandler = async ({ locals, url }) => {
  // One store, one ability, asked once whether or not a kind is named.
  //
  // This used to check `expenses` and `income` when no kind was asked for, and
  // that was a live hole: a record entered by hand is a `journal` kind, so it
  // was never covered by either check, and anyone with expense view read it
  // (research.md R-11).
  if (!hasPermission(locals, "records", "view")) return forbidden();

  const parsed = querySchema.safeParse(
    Object.fromEntries(url.searchParams.entries()),
  );
  if (!parsed.success) return badRequest(parsed.error);
  const q = parsed.data;

  const kind = q.kind as LedgerRecordKindCode[] | undefined;

  return Response.json(
    listRecords(db, {
      // One value stays one value, so an existing caller asking for a single
      // kind is unchanged.
      kind: kind && kind.length === 1 ? kind[0] : kind,
      accountId: q.accountId,
      contactId: q.contactId,
      categoryAccountId: q.categoryId ?? q.categoryAccountId,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      amountMin: q.amountMin,
      amountMax: q.amountMax,
      paid: q.paid,
      cleared: q.cleared,
      sort: q.sort,
      search: q.search,
      limit: q.limit,
      offset: q.offset,
    }),
  );
};

export const POST: RequestHandler = async ({ locals, request }) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);

  const raw = parsed.data;
  if (!hasPermission(locals, "records", "add")) return forbidden();

  // A body with no `kind` came from the one form: two accounts, and the kind
  // derived from them rather than asked for (D-01).
  let body: RecordCreate;
  if ("kind" in raw) {
    body = raw as RecordCreate;
  } else {
    const receivable = requireAccountDefault(db, DefaultAccountPurpose.Receivable);
    if (!receivable.ok) return refused(receivable.reason);
    const payable = requireAccountDefault(db, DefaultAccountPurpose.Payable);
    if (!payable.ok) return refused(payable.reason);
    const opening = requireAccountDefault(db, DefaultAccountPurpose.OpeningBalances);
    if (!opening.ok) return refused(opening.reason);
    const canAdjust = hasPermission(locals, "adjustments", "add");
    const sides = sidesFromAccounts(
      {
        fromAccountId: raw.fromAccountId,
        toAccountId: raw.toAccountId,
        amountMinor: toMinor(raw.amount, raw.exchangeRate),
        contactId: raw.contactId ?? null,
        extraSides: raw.extraSides,
      },
      {
        accountById: (id) => {
          const account = getAccount(db, id);
          return account
            ? {
                id: account.id,
                type: account.type,
                role: account.role,
                archived: account.archivedAt !== null,
              }
            : null;
        },
        // The gate is applied inside the derivation, after it knows what the
        // two accounts mean — whether a record needs the ability is a fact
        // about the accounts it names, not about what the client sent
        // (FR-031c). Enforced here on the server, never by hiding a control.
        canAdjust,
        receivableAccountId: receivable.value,
        payableAccountId: payable.value,
        openingBalancesAccountId: opening.value,
      },
    );
    if (!sides.ok) return refused(sides.reason);

    // Handed to the builder unchanged. `entry-builder.ts` stays the only place
    // movements are constructed, and the only thing that refuses a set of sides
    // that does not cancel — stating by how much it is out (FR-009).
    body = { ...raw, ...sides.value } as RecordCreate;
  }

  const userId = locals.user!.id;
  const result = createRecord(db, userId, body);
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
  // A derived payment carries no settlements — the form records the payment,
  // and what it covers is chosen from the record it settles.
  if (body.kind === "payment" && (body.settlements?.length ?? 0) > 0) {
    // The settling side is the one on the shared owed account — the side that
    // clears the debt, whichever direction the money went.
    const owedDefault = requireAccountDefault(
      db,
      body.direction === "we-pay"
        ? DefaultAccountPurpose.Payable
        : DefaultAccountPurpose.Receivable,
    );
    const paymentMovement = owedDefault.ok
      ? result.value.movements.find((m) => m.accountId === owedDefault.value)
      : undefined;

    const settled = paymentMovement
      ? createSettlements(
          db,
          userId,
          paymentMovement.id,
          body.settlements ?? [],
        )
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
