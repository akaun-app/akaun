import { z } from "zod";
import type { RequestHandler } from "./$types.js";
import { db } from "$lib/server/db/client.js";
import { hasPermission } from "$lib/server/permissions.js";
import { badRequest, forbidden, notFound } from "$lib/server/api-response.js";
import { accountHistoryCsv } from "$lib/server/ledger/reports/csv.js";
import { historyGapNotes } from "$lib/server/ledger/reports/notes.js";
import { accountHistory } from "$lib/server/queries/accounts.js";
import { ledgerTrackingStartDate } from "$lib/server/queries/reports.js";
import {
  accountHistoryQuery,
  formatFrom,
  queryValues,
  reportResponse,
} from "../report-endpoint.js";

/**
 * How many movements to return. There is deliberately no `offset`: the running
 * balance is worked out from the opening balance forward, so a request that
 * skipped the first movements would restate every balance from the wrong
 * starting point. `total` tells the caller when it has not seen everything, and
 * the answer to that is narrower dates, not a second page.
 */
const historyQuery = accountHistoryQuery.extend({
  limit: z.coerce.number().int().positive().max(5000).optional(),
});

/** Every movement on one account with a running balance (FR-028). */
export const GET: RequestHandler = async ({ locals, url }) => {
  if (!hasPermission(locals, "reports", "view")) return forbidden();

  const parsed = historyQuery.safeParse(
    queryValues(url, ["accountId", "dateFrom", "dateTo", "limit"]),
  );
  if (!parsed.success) return badRequest(parsed.error);

  const { accountId, ...options } = parsed.data;
  const history = accountHistory(db, accountId, options);
  if (!history) return notFound("That account no longer exists.");

  // `accountHistory` reads rows and says nothing about what is missing from
  // them, so the gap sentence is added here — same wording, same rule, as the
  // three period reports carry (FR-030).
  const report = {
    ...history,
    notes: [
      ...history.notes,
      ...historyGapNotes(options.dateFrom ?? null, ledgerTrackingStartDate(db)),
    ],
  };

  return reportResponse(
    formatFrom(url),
    report,
    () => accountHistoryCsv(report),
    `account-history-${report.account.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
  );
};
