import type { RequestHandler } from "./$types.js";
import { hasPermission } from "$lib/server/permissions.js";
import { forbidden } from "$lib/server/api-response.js";
import { eventStream } from "$lib/server/sse-stream.js";
import { ledgerEvents } from "$lib/server/ledger/events.js";
import { LedgerRecordKind } from "$lib/enums.js";
import type { RecordView } from "$lib/server/ledger/types.js";

/**
 * What the Journal screen is told, live.
 *
 * The same shape as the expenses and income streams: one emitter carries every
 * record write, and each stream picks its own kind out of it. A journal entry
 * is the one kind whose sides were typed by hand, so a second person entering
 * one in another tab is exactly the case FR-042 is written for.
 *
 * `record-deleted` carries only an id, so it needs no filter — a list simply
 * drops an id it does not hold, and nothing about another screen's records
 * leaves the server. `settlement-changed` is deliberately absent: a journal
 * entry has no derived paid state for a settlement to move.
 */
export const GET: RequestHandler = ({ locals }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "journal", "view")) return forbidden();

  return eventStream([
    {
      emitter: ledgerEvents,
      events: { "record-update": "record-update" },
      filter: (payload) =>
        (payload.record as RecordView | undefined)?.kind ===
        LedgerRecordKind.Journal,
    },
    {
      emitter: ledgerEvents,
      events: { "record-deleted": "record-deleted" },
    },
  ]);
};
