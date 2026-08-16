import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { badRequest, forbidden, refused } from "$lib/server/api-response.js";
import { listAccounts } from "$lib/server/queries/accounts.js";
import { createAccount } from "$lib/server/services/accounts.js";
import { AccountRole, type AccountRoleCode } from "$lib/enums.js";

/**
 * The kinds of account a person may create.
 *
 * The shared owed accounts and Opening balances are seeded once and are the
 * app's own plumbing; a partner's pair comes from granting that contact the
 * Partner role (FR-008b). Neither is offered here.
 */
const CREATABLE_ROLES: number[] = [
  AccountRole.Bank,
  AccountRole.Wallet,
  AccountRole.Cash,
  AccountRole.Card,
  AccountRole.Equipment,
  AccountRole.ExpenseCategory,
  AccountRole.IncomeCategory,
];

const createSchema = z
  .object({
    role: z
      .number()
      .int()
      .refine((value) => CREATABLE_ROLES.includes(value), {
        message: "That is not a kind of account you can create.",
      }),
    name: z.string().trim().min(1).max(120),
    rank: z.string().trim().min(1).optional(),
    // Only granting the Partner role creates a contact-linked account
    // (FR-008a), so naming a contact here is refused rather than ignored.
    contactId: z.never().optional(),
  })
  .strict();

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!hasPermission(locals, "accounts", "view")) return forbidden();

  const roleRaw = url.searchParams.get("role");
  const role = roleRaw ? Number(roleRaw) : undefined;

  return Response.json({
    accounts: listAccounts(db, {
      role: Number.isFinite(role) ? (role as AccountRoleCode) : undefined,
      includeArchived: url.searchParams.get("includeArchived") === "true",
    }),
  });
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!hasPermission(locals, "accounts", "add")) return forbidden();

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);

  const result = createAccount(db, locals.user!.id, {
    role: parsed.data.role as AccountRoleCode,
    name: parsed.data.name,
    rank: parsed.data.rank,
  });
  if (!result.ok) return refused(result.reason);

  return Response.json(result.value, { status: 201 });
};
