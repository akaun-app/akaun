import { goto } from "$app/navigation";
import { resolve } from "$app/paths";

/**
 * Where a report row points, when it points anywhere.
 *
 * Every one of these is an in-app navigation to another feature's own URL, per
 * the relation-card contract (CLAUDE.md § Cross-Feature Relation Cards): a
 * report never renders another feature's detail sheet itself.
 */

/**
 * The account behind a report line.
 *
 * Opens its drawer, whose "see every movement" card leads on to
 * `/records?account=` — the statement view that replaced the separate
 * account-history page (FR-047, D-05). The name is kept because that is still
 * what a reader clicking a report line is after.
 */
export function openAccountHistory(accountId: number): Promise<void> {
  return goto(resolve("/(app)/accounts/[id]", { id: String(accountId) }));
}

/**
 * The category behind a profit-and-loss line.
 *
 * Every line of a P&L breakdown *is* a category account — `profitLoss()` drops
 * anything that is not — so those open on the Categories screen rather than on
 * Accounts, which no longer lists them. `/accounts/[id]` still opens any
 * account, categories included, so an older link never breaks.
 */
export function openCategory(accountId: number): Promise<void> {
  return goto(resolve("/(app)/categories/[id]", { id: String(accountId) }));
}

/** What a debt is: the invoice that raised it, or the record that recorded it. */
export type RecordRef = {
  kind: number;
  recordId: number;
  invoiceId: number | null;
};

/**
 * The record behind an outstanding debt.
 *
 * Every kind now has one list and one deep link, so this never returns null for
 * a record any more: a payment, a transfer and a hand-made entry each open at
 * `/records/[id]` like everything else. An invoice still goes to the invoice,
 * because that is the document the debt came from (FR-027, FR-047).
 */
export function recordPathFor(item: RecordRef): string | null {
  if (item.invoiceId !== null) {
    return resolve("/(app)/invoices/[id]", { id: String(item.invoiceId) });
  }
  return resolve("/(app)/records/[id]", { id: String(item.recordId) });
}

/** Opens that record, and does nothing for one that has no screen of its own. */
export function openRecord(item: RecordRef): void {
  const path = recordPathFor(item);
  if (!path) return;
  // eslint-disable-next-line svelte/no-navigation-without-resolve -- recordPathFor returns a resolved route.
  goto(path);
}
