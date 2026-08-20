import { MONEY_POT_ROLES } from "$lib/server/ledger/account-type.js";
import { fail, redirect, type Actions } from "@sveltejs/kit";
import { z } from "zod";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import {
  defaultAccountId,
  listAccounts,
} from "$lib/server/queries/accounts.js";
import { listContacts } from "$lib/server/queries/contacts.js";
import { getRecord, listRecords } from "$lib/server/queries/ledger.js";
import { removeRecord } from "$lib/server/services/ledger.js";
import {
  getUserPreference,
  USER_PREF_KEYS,
} from "$lib/server/userPreferences.js";
import { mainCurrencyCode } from "$lib/server/currency/form.js";
import { AccountRole } from "$lib/enums.js";

/**
 * The one load and one set of actions behind both `/records` and
 * `/records/[id]`.
 *
 * This replaces `loaders/ledger.ts`, which served `/expenses` and `/income` and
 * differed between them in three things: which kind it listed, which accounts it
 * called a category, and which list a stale deep link fell back to. All three
 * differences are gone. There is one list of every kind, one set of accounts,
 * and one list to fall back to (FR-001, FR-004).
 *
 * The legacy lookup went with them. `/expenses/[id]` and `/income/[id]` are
 * retired outright rather than redirected, so there is nothing left to resolve a
 * pre-upgrade id against (FR-025a, D-04). The `legacy_kind` / `legacy_id`
 * columns stay on the record as provenance; only the lookup goes.
 */

/** The everyday categories a record is "for", either direction. */
const CATEGORY_ROLES = [
  AccountRole.ExpenseCategory,
  AccountRole.IncomeCategory,
  // Equipment sits with the categories so buying something the business keeps
  // is recorded from the same place as buying something it uses up (FR-006b).
  AccountRole.Equipment,
];

const LIST_PATH = "/records";

/**
 * How many records the screen holds. The screen filters, searches and sorts in
 * the browser, so the page is loaded in one go rather than a round trip per
 * filter change; `total` says whether anything was left behind.
 */
const PAGE_LIMIT = 1000;

export function loadRecordsPage(locals: App.Locals, openId: number | null) {
  if (!hasPermission(locals, "records", "view"))
    throw redirect(302, "/dashboard");

  // No `kind` filter: one list of everything that happened, newest first
  // (FR-001).
  const { records, total } = listRecords(db, { limit: PAGE_LIMIT });

  // A link to a record that has been deleted, that never existed, or that this
  // user may not see lands on the list rather than on an empty drawer.
  if (openId !== null && !records.some((r) => r.id === openId)) {
    throw redirect(302, LIST_PATH);
  }

  return {
    records,
    total,
    accounts: listAccounts(db, { role: MONEY_POT_ROLES }),
    categories: listAccounts(db, { role: CATEGORY_ROLES }),
    // Every account, for the full list a user with `adjustments` can reach in
    // one step from either side of the form (FR-008a, FR-031).
    allAccounts: listAccounts(db, {}),
    contacts: listContacts(db, { limit: 500 }).map((c) => ({
      id: c.id,
      legalName: c.legalName,
    })),
    defaultAccountId: defaultAccountId(db),
    mainCurrency: mainCurrencyCode(db),
    // Both remembered currencies travel to one screen now. Which one the form
    // offers follows from the accounts the user names, not from which page they
    // are on — the kind is derived, so the currency memory is too.
    lastForeignCurrencyExpense:
      getUserPreference(
        db,
        locals.user!.id,
        USER_PREF_KEYS.lastForeignCurrencyExpense,
      ) ?? null,
    lastForeignCurrencyIncome:
      getUserPreference(
        db,
        locals.user!.id,
        USER_PREF_KEYS.lastForeignCurrencyIncome,
      ) ?? null,
    openId,
    perms: {
      add: hasPermission(locals, "records", "add"),
      change: hasPermission(locals, "records", "change"),
      delete: hasPermission(locals, "records", "delete"),
      // Free choice of account and a third side. The server enforces this at
      // the point of derivation; the screen only stops offering what would be
      // refused (FR-031c).
      adjustments: hasPermission(locals, "adjustments", "add"),
    },
  };
}

/** A comma-separated list of record ids, as the selection bar submits it. */
const idsSchema = z
  .string()
  .transform((raw) =>
    raw
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((id) => Number.isInteger(id) && id > 0),
  )
  .pipe(z.array(z.number().int().positive()).min(1));

export const recordsActions: Actions = {
  /**
   * Removes the selected records.
   *
   * One at a time through the service, so each carries its own audit entry and
   * its own event, and so a record a settlement or a bank line still points at
   * refuses on its own rather than taking the whole selection down with it
   * (FR-017a). The first refusal is handed back to be shown; the rest still go.
   */
  delete: async ({ locals, request }) => {
    const data = await request.formData();
    const parsed = idsSchema.safeParse(String(data.get("ids") ?? ""));
    if (!parsed.success) return fail(400, { error: "Nothing was selected." });

    if (!hasPermission(locals, "records", "delete")) {
      return fail(403, { error: "Forbidden" });
    }

    const userId = locals.user!.id;
    let deleted = 0;
    let refusedReason: string | null = null;

    for (const id of parsed.data) {
      const record = getRecord(db, id);
      if (!record) continue;

      const result = removeRecord(db, id, userId);
      if (result.ok) deleted++;
      else refusedReason ??= result.reason;
    }

    if (deleted === 0 && refusedReason)
      return fail(409, { error: refusedReason });
    return { success: true, deleted, refusedReason };
  },
};
