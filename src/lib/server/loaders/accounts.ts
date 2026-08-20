import { fail, redirect, type Actions } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  listAccounts,
  defaultAccountId,
} from "$lib/server/queries/accounts.js";
import {
  createAccount,
  patchAccount,
  removeAccount,
  setOpeningBalance,
} from "$lib/server/services/accounts.js";
import { toMinor } from "$lib/server/ledger/money.js";
import { listStatementSummaries } from "$lib/server/services/reconciliation.js";
import { isValidDate } from "$lib/server/date.js";
import type { AccountRoleCode } from "$lib/enums.js";

/**
 * The chart of accounts, shared by `/accounts` and `/accounts/[id]` so the two
 * routes stay thin wrappers over one load and one set of actions.
 */
export function loadAccountsPage(
  locals: App.Locals,
  openAccountId: number | null,
) {
  if (!hasPermission(locals, "accounts", "view"))
    throw redirect(302, "/dashboard");

  const accounts = listAccounts(db, { includeArchived: true });

  /**
   * How many statements each account has still to finish (FR-053).
   *
   * The drawer's "Check against the bank" card needs this because there is no
   * longer a top-level Reconciliation list where a half-done statement would be
   * noticed — if the only way in is through the account, the account has to say
   * whether there is anything waiting.
   *
   * Only read when the user may reconcile at all; there is nothing to tell
   * somebody who cannot open the surface it points at.
   */
  const unfinishedStatements = new Map<number, number>();
  if (hasPermission(locals, "reconciliation", "view")) {
    for (const statement of listStatementSummaries(db, locals)) {
      if (statement.completed || statement.accountId == null) continue;
      unfinishedStatements.set(
        statement.accountId,
        (unfinishedStatements.get(statement.accountId) ?? 0) + 1,
      );
    }
  }

  // A link to an account that has been deleted, or that never existed, lands on
  // the list rather than an empty drawer.
  if (openAccountId !== null && !accounts.some((a) => a.id === openAccountId)) {
    throw redirect(302, "/accounts");
  }

  return {
    accounts,
    openAccountId,
    defaultAccountId: defaultAccountId(db),
    // Plain object, because a Map does not survive the trip to the browser.
    unfinishedStatements: Object.fromEntries(unfinishedStatements),
    perms: {
      add: hasPermission(locals, "accounts", "add"),
      change: hasPermission(locals, "accounts", "change"),
      delete: hasPermission(locals, "accounts", "delete"),
      // Whether to offer the way in to reconciling at all (FR-049).
      reconcile: hasPermission(locals, "reconciliation", "view"),
    },
  };
}

/**
 * The other half of the chart: what money was earned and spent on.
 *
 * Same table, same service, same actions as `loadAccountsPage` — a category is
 * an account underneath (002 FR-006a). What differs is only which rows the
 * screen lists, because a list of 22 categories beside 4 accounts read as
 * nothing but categories.
 */
export function loadCategoriesPage(
  locals: App.Locals,
  openAccountId: number | null,
) {
  if (!hasPermission(locals, "accounts", "view"))
    throw redirect(302, "/dashboard");

  const accounts = listAccounts(db, { includeArchived: true });

  // A link to a category that has been deleted, or that never existed, lands on
  // the list rather than on an empty drawer.
  if (openAccountId !== null && !accounts.some((a) => a.id === openAccountId)) {
    throw redirect(302, "/categories");
  }

  return {
    accounts,
    openAccountId,
    defaultAccountId: defaultAccountId(db),
    perms: {
      add: hasPermission(locals, "accounts", "add"),
      change: hasPermission(locals, "accounts", "change"),
      delete: hasPermission(locals, "accounts", "delete"),
    },
  };
}

export const accountsActions: Actions = {
  create: async ({ locals, request }) => {
    if (!hasPermission(locals, "accounts", "add"))
      return fail(403, { error: "Forbidden" });
    const data = await request.formData();

    const role = parseInt(String(data.get("role") ?? "0"));
    const name = String(data.get("name") ?? "").trim();
    if (!role)
      return fail(400, { error: "Choose what kind of account this is." });
    if (!name) return fail(400, { error: "Give the account a name." });

    const result = createAccount(db, locals.user!.id, {
      role: role as AccountRoleCode,
      name,
    });
    if (!result.ok) return fail(409, { error: result.reason });
    return { success: true, id: result.value.id };
  },

  update: async ({ locals, request }) => {
    if (!hasPermission(locals, "accounts", "change"))
      return fail(403, { error: "Forbidden" });
    const data = await request.formData();
    const id = parseInt(String(data.get("id") ?? "0"));
    if (!id) return fail(400, { error: "That account no longer exists." });

    const archivedRaw = data.get("archived");
    const result = patchAccount(db, id, locals.user!.id, {
      name: data.has("name")
        ? String(data.get("name") ?? "").trim()
        : undefined,
      archived: archivedRaw === null ? undefined : archivedRaw === "true",
    });
    if (!result.ok) return fail(409, { error: result.reason });
    return { success: true, id };
  },

  delete: async ({ locals, request }) => {
    if (!hasPermission(locals, "accounts", "delete"))
      return fail(403, { error: "Forbidden" });
    const data = await request.formData();
    const id = parseInt(String(data.get("id") ?? "0"));
    if (!id) return fail(400, { error: "That account no longer exists." });

    const result = removeAccount(db, id, locals.user!.id);
    if (!result.ok) return fail(409, { error: result.reason });
    return { success: true, deleted: true };
  },

  openingBalance: async ({ locals, request }) => {
    if (!hasPermission(locals, "accounts", "change"))
      return fail(403, { error: "Forbidden" });
    const data = await request.formData();
    const id = parseInt(String(data.get("id") ?? "0"));
    if (!id) return fail(400, { error: "That account no longer exists." });

    const date = String(data.get("date") ?? "").trim();
    if (!isValidDate(date))
      return fail(400, { error: "Pick a date for the opening balance." });

    const amount = parseFloat(String(data.get("amount") ?? "0"));
    if (Number.isNaN(amount)) return fail(400, { error: "Enter an amount." });

    // An opening balance is always in the main currency, so the rate is 1.
    const result = setOpeningBalance(db, id, locals.user!.id, {
      date,
      amountMinor: toMinor(amount, 1),
    });
    if (!result.ok) return fail(409, { error: result.reason });
    return { success: true, id };
  },
};
