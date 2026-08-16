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
import {
  findByLegacy,
  getRecord,
  getRecordRow,
  listRecords,
} from "$lib/server/queries/ledger.js";
import { removeRecord } from "$lib/server/services/ledger.js";
import {
  getUserPreference,
  USER_PREF_KEYS,
} from "$lib/server/userPreferences.js";
import { mainCurrencyCode } from "$lib/server/currency/form.js";
import { resourceForKind } from "$lib/server/ledger/record-permissions.js";
import type { LegacyKind } from "$lib/server/ledger/types.js";
import {
  AccountRole,
  LedgerRecordKind,
  type AccountRoleCode,
} from "$lib/enums.js";

/**
 * The one load and one set of actions behind both `/expenses` and `/income`.
 *
 * The two screens differ in exactly three things — which kind of record they
 * list, which accounts they offer as a category, and which bare list a stale
 * deep link falls back to — so they are three expressions here rather than two
 * files that drift apart.
 */

/** The kinds of record that have a screen of their own. */
export type LedgerScreenKind =
  | typeof LedgerRecordKind.Expense
  | typeof LedgerRecordKind.Income;

/**
 * What each screen calls a category.
 *
 * Equipment sits in the expense screen's list so buying something the business
 * keeps is recorded from the same place as buying something it uses up, with no
 * extra concept to learn — the difference is which account it lands in, not
 * which screen it is entered on (FR-006b). It is deliberately absent from the
 * income list: equipment is bought, never earned.
 */
const CATEGORY_ROLES: Record<LedgerScreenKind, AccountRoleCode[]> = {
  [LedgerRecordKind.Expense]: [
    AccountRole.ExpenseCategory,
    AccountRole.Equipment,
  ],
  [LedgerRecordKind.Income]: [AccountRole.IncomeCategory],
};

const LIST_PATH: Record<LedgerScreenKind, string> = {
  [LedgerRecordKind.Expense]: "/expenses",
  [LedgerRecordKind.Income]: "/income",
};

/** Which old table a screen's own records came from, for the fallback below. */
const LEGACY_KIND_OF: Record<LedgerScreenKind, LegacyKind> = {
  [LedgerRecordKind.Expense]: "expense",
  [LedgerRecordKind.Income]: "income",
};

/** The old tables a stale id is looked up in, tried in this order. */
const LEGACY_KINDS: LegacyKind[] = ["expense", "income", "claim"];

/**
 * Where a link written before the update now points, or null when nothing
 * answers to that id.
 *
 * Expenses kept their original id through the update, so an `/expenses/[id]`
 * link resolves on its own and never gets here. Income did not — every income
 * was given a new id — so an old `/income/[id]` link has to be looked up by
 * where it came from and sent on to the record's current address (D-14).
 *
 * Every old table is tried, not only this screen's own, because an id in a
 * stale link says nothing about which table wrote it. A reimbursement resolves
 * to the payment it became, and a payment is read from the expenses it paid off
 * rather than from a screen of its own, so that one lands on the expenses list:
 * reimbursement links are the one kind this release deliberately does not keep
 * (FR-036a), and the list someone can find the record from beats a page telling
 * them it is gone.
 */
function legacyDestination(
  staleId: number,
  fromKind: LedgerScreenKind,
): string | null {
  const own = LEGACY_KIND_OF[fromKind];
  const order = [own, ...LEGACY_KINDS.filter((k) => k !== own)];

  for (const legacyKind of order) {
    const recordId = findByLegacy(db, legacyKind, staleId);
    if (recordId === null) continue;

    const record = getRecordRow(db, recordId);
    if (record === null) continue;

    const listPath =
      record.kind === LedgerRecordKind.Expense ||
      record.kind === LedgerRecordKind.Income
        ? LIST_PATH[record.kind]
        : null;
    // A kind with no screen of its own — a payment, a transfer, an opening
    // balance — is reached through the expenses it touched.
    if (listPath === null) return LIST_PATH[LedgerRecordKind.Expense];

    const destination = `${listPath}/${recordId}`;
    // The address we are already on: redirecting there would loop.
    if (destination === `${LIST_PATH[fromKind]}/${staleId}`) return null;
    return destination;
  }

  return null;
}

/**
 * How many records the screen holds. Both screens filter, search and sort in
 * the browser, so the page is loaded in one go rather than a round trip per
 * filter change; `total` says whether anything was left behind.
 */
const PAGE_LIMIT = 1000;

export function loadLedgerPage(
  locals: App.Locals,
  kind: LedgerScreenKind,
  openId: number | null,
) {
  const resource = resourceForKind(kind);
  if (!hasPermission(locals, resource, "view"))
    throw redirect(302, "/dashboard");

  const { records, total } = listRecords(db, { kind, limit: PAGE_LIMIT });

  // A link to a record that has been deleted, that never existed, or that
  // belongs to the other screen lands on the list rather than an empty drawer —
  // unless it is a link written before the update, in which case it is sent on
  // to wherever that record lives now (D-14).
  if (openId !== null && !records.some((r) => r.id === openId)) {
    throw redirect(302, legacyDestination(openId, kind) ?? LIST_PATH[kind]);
  }

  return {
    kind,
    records,
    total,
    accounts: listAccounts(db, { role: MONEY_POT_ROLES }),
    categories: listAccounts(db, { role: CATEGORY_ROLES[kind] }),
    contacts: listContacts(db, { limit: 500 }).map((c) => ({
      id: c.id,
      legalName: c.legalName,
    })),
    defaultAccountId: defaultAccountId(db),
    mainCurrency: mainCurrencyCode(db),
    // The last foreign currency this user recorded in, so someone who buys from
    // the same supplier every month does not re-pick it every time. Per screen,
    // because what you buy abroad and what you sell abroad are rarely the same.
    lastForeignCurrency:
      getUserPreference(
        db,
        locals.user!.id,
        kind === LedgerRecordKind.Expense
          ? USER_PREF_KEYS.lastForeignCurrencyExpense
          : USER_PREF_KEYS.lastForeignCurrencyIncome,
      ) ?? null,
    openId,
    perms: {
      add: hasPermission(locals, resource, "add"),
      change: hasPermission(locals, resource, "change"),
      delete: hasPermission(locals, resource, "delete"),
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

export const ledgerActions: Actions = {
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

    const userId = locals.user!.id;
    let deleted = 0;
    let refusedReason: string | null = null;

    for (const id of parsed.data) {
      const record = getRecord(db, id);
      if (!record) continue;
      if (!hasPermission(locals, resourceForKind(record.kind), "delete")) {
        return fail(403, { error: "Forbidden" });
      }

      const result = removeRecord(db, id, userId);
      if (result.ok) deleted++;
      else refusedReason ??= result.reason;
    }

    if (deleted === 0 && refusedReason)
      return fail(409, { error: refusedReason });
    return { success: true, deleted, refusedReason };
  },
};
