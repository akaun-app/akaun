import type { LayoutServerLoad } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { getSetting, SETTING_KEYS } from "$lib/server/settings.js";
import { listRecords } from "$lib/server/queries/ledger.js";
import { LedgerRecordKind } from "$lib/enums.js";
import { getUserNavOrder } from "$lib/server/navPreferences.js";
import { DEFAULT_CURRENCY } from "$lib/currency.js";

export const load: LayoutServerLoad = async ({ locals }) => {
  const mainCurrency =
    getSetting(db, SETTING_KEYS.currencyCode) ?? DEFAULT_CURRENCY;

  // The nav badge counts expenses somebody is still owed for. Nothing stores
  // that any more — it is derived from the settlements against each record's
  // side on the shared owed account (FR-012) — so this asks the store the
  // question rather than reading a status column. `limit: 1` because only
  // `total` is wanted; the count is its own aggregate either way.
  const unpaidCount = listRecords(db, {
    kind: LedgerRecordKind.Expense,
    paid: false,
    limit: 1,
  }).total;

  const navItems = getUserNavOrder(db, locals.user!.id).filter(
    (item) =>
      locals.isSuperuser ||
      (locals.permissions?.[item.resource]?.view ?? false),
  );

  return {
    user: locals.user,
    mainCurrency,
    unpaidCount,
    isSuperuser: locals.isSuperuser,
    permissions: locals.permissions,
    navItems,
  };
};
