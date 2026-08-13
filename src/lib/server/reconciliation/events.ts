import { EventEmitter } from "node:events";

// Bank reconciliation live-update bus: every mutating function in
// services/reconciliation.ts emits on this after its DB write, and the
// /api/reconciliation/stream SSE endpoint is the only consumer. Event types
// (see specs/001-bank-reconciliation/contracts/events.md): `statement-update`,
// `statement-deleted`, `line-update`, `line-deleted`, `lines-added`,
// `item-state-update`, `allocations-bulk-update`.
export const reconciliationEvents = new EventEmitter();
// Each open SSE connection registers one listener per event type above (7) and
// removes them all on disconnect — cap at ~100 concurrent streams. See the
// matching note in $lib/server/finance/events.ts.
reconciliationEvents.setMaxListeners(600);
