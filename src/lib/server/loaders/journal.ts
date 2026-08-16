import { redirect } from "@sveltejs/kit";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { listAccounts } from "$lib/server/queries/accounts.js";
import { listContacts } from "$lib/server/queries/contacts.js";
import { listRecords } from "$lib/server/queries/ledger.js";
import { LedgerRecordKind } from "$lib/enums.js";

/**
 * The direct-entry screen, shared by `/journal` and `/journal/[id]`.
 *
 * It sits behind its own permission, which no seeded group has, so until
 * someone grants it deliberately there is nothing here to reach and the request
 * lands on the dashboard the same way every other ungranted screen does
 * (FR-040). Entering both sides of a record by hand is how the books can be
 * made to say anything, which is exactly why it is off by default.
 *
 * Writing goes through `POST /api/records`, which is where the balance rule is
 * enforced, so this loader has no actions of its own.
 */

/** How many entries the screen holds; `total` says whether any were left behind. */
const PAGE_LIMIT = 500;

export function loadJournalPage(locals: App.Locals, openId: number | null) {
  if (!hasPermission(locals, "journal", "view"))
    throw redirect(302, "/dashboard");

  const { records, total } = listRecords(db, {
    kind: LedgerRecordKind.Journal,
    limit: PAGE_LIMIT,
  });

  // A link to an entry that has been deleted, or that never existed, lands on
  // the list rather than an empty drawer.
  if (openId !== null && !records.some((r) => r.id === openId)) {
    throw redirect(302, "/journal");
  }

  return {
    records,
    total,
    // The one screen that offers every account there is. Archived accounts stay
    // out of the picker, as they do everywhere else, but nothing else is
    // filtered — naming any two sides yourself is the whole point of it.
    accounts: listAccounts(db, { includeArchived: false }),
    contacts: listContacts(db, { limit: 500 }).map((c) => ({
      id: c.id,
      legalName: c.legalName,
    })),
    openId,
    perms: {
      add: hasPermission(locals, "journal", "add"),
      delete: hasPermission(locals, "journal", "delete"),
    },
  };
}
