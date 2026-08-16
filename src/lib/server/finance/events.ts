import { EventEmitter } from "events";

// `expenseEvents`, `incomeEvents` and `claimEvents` are gone. One store of
// records means one emitter — `ledgerEvents` in $lib/server/ledger/events.ts —
// which carries the record's kind, so the service layer never has to remember
// which of several to fire. Forgetting one was silent, and silence is exactly
// the failure FR-042 is written against (D-21). The `/api/expenses/stream` and
// `/api/income/stream` URLs are unchanged; each filters `ledgerEvents` down to
// its own kind.
export const contactEvents = new EventEmitter();
export const quotationEvents = new EventEmitter();
export const invoiceEvents = new EventEmitter();

// Each open SSE connection registers 2 listeners (an `*-update` + an `*-delete`
// handler) and removes both on disconnect (see the stream endpoints' `cancel()`).
// So the ceiling is connections × 2; this caps each domain at ~100 concurrent
// streams before Node's leak warning. Listeners are cleaned up reliably, so the
// limit only guards against a genuine leak, not normal load.
const MAX_LISTENERS = 200;
for (const emitter of [contactEvents, quotationEvents, invoiceEvents]) {
  emitter.setMaxListeners(MAX_LISTENERS);
}
