import type { RequestHandler } from "./$types.js";
import { hasPermission } from "$lib/server/permissions.js";
import { forbidden } from "$lib/server/api-response.js";
import { eventStream } from "$lib/server/sse-stream.js";
import { ledgerEvents } from "$lib/server/ledger/events.js";
import { LedgerRecordKind } from "$lib/enums.js";
import type { RecordView } from "$lib/server/ledger/types.js";

/**
 * What the Expenses list is told, live.
 *
 * One emitter carries every record write now, so this stream picks its own out
 * of it: expense records, plus the two events that carry no record of their own.
 * `record-deleted` names an id and `settlement-changed` names ids — a list drops
 * an id it does not hold, and nothing about another screen's records leaves the
 * server, which matters because seeing expenses does not mean being allowed to
 * see income (contracts/events.md).
 *
 * A payment changes an expense's paid state without anyone editing it, which is
 * why `settlement-changed` is here at all.
 */
export const GET: RequestHandler = ({ locals }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  if (!hasPermission(locals, "expenses", "view")) return forbidden();

  return eventStream([
    {
      emitter: ledgerEvents,
      events: { "record-update": "record-update" },
      filter: (payload) =>
        (payload.record as RecordView | undefined)?.kind ===
        LedgerRecordKind.Expense,
    },
    {
      emitter: ledgerEvents,
      events: {
        "record-deleted": "record-deleted",
        "settlement-changed": "settlement-changed",
      },
    },
  ]);
};
