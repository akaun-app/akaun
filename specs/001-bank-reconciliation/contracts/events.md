# SSE Contract: Bank Reconciliation

**Feature**: `specs/001-bank-reconciliation` | **Date**: 2026-08-10

Satisfies FR-034 ("changes made in one open view appear in other open views without a manual
refresh") under the SSE-only architecture in `CLAUDE.md`. Reference implementation for the endpoint
shape: `src/routes/api/import/stream/+server.ts`.

## Emitter

`src/lib/server/reconciliation/events.ts`:

```ts
import { EventEmitter } from 'node:events';
export const reconciliationEvents = new EventEmitter();
```

Every mutating service function in `services/reconciliation.ts` emits **after** its DB write. When
the mutation changed an item's cleared state it additionally emits on that item's existing ledger
emitter (`expenseEvents` / `claimEvents` / `incomeEvents` in `lib/server/finance/events.ts`) so the
expenses, claims, and income lists update live without subscribing to this stream (D-10).

## Endpoint

`GET /api/reconciliation/stream` → `text/event-stream`.

- `401` when `!locals.user`; `403` when `!hasPermission(locals, 'reconciliation', 'view')`.
- Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`.
- 15 s `: heartbeat` comment frames.
- Listeners registered in `start()`, removed in `cancel()`.

**Snapshot policy**: this stream sends a **snapshot on connect**, following the import queue's
precedent rather than the paginated-list precedent — the live state is one open session plus its
statement lines, a small finite set, and a reconnect mid-extraction must catch up on a
`statement_state` transition it may have missed.

```jsonc
{ "type": "snapshot", "openSession": { /* SessionSummary | null */ }, "lines": [ /* lines of the open session */ ] }
```

## Events

| `type` | Payload | Emitted by | Consumers |
|--------|---------|-----------|-----------|
| `session-update` | `{ session: SessionSummary }` | create, patch (edit/close/reopen), statement upload state transitions | module home (history + open-session card), session detail sheet, match workspace header |
| `session-deleted` | `{ id }` | delete | module home; the match workspace navigates back to `/reconciliation` |
| `line-update` | `{ line: StatementLine }` | manual add, edit, match accept/undo | match workspace |
| `line-deleted` | `{ id, sessionId }` | line delete | match workspace |
| `lines-added` | `{ sessionId, lines: StatementLine[] }` | statement extraction completing | match workspace — replaces the "extracting…" placeholder in one paint rather than N `line-update`s |
| `item-state-update` | `{ itemType, itemId, cleared, clearedSessionId, clearedLineId, annotation }` | match accept/undo, annotation set/clear, session delete | match workspace candidate column; expense/claim/income detail sheets that are open |

`StatementLine` and `SessionSummary` are the shapes defined in [api.md](./api.md).

## Client rules

Per `CLAUDE.md` and `src/lib/sse.ts`:

- Subscribe with `createResourceStream('/api/reconciliation/stream', handler)` — it is `onMount`-bound
  and shares one `EventSource` per URL across components and navigations. Never open the stream in
  `$effect`.
- Merge with `mergeById` for the session history and the line list.
- **No optimistic local insert.** A manually added line, an accepted match, and a completed extraction
  all reach the UI through the stream only — the fetch response is used for error handling, not for
  state (the import page's `mergeServerJobs` rule).
- The match workspace holds no `File` object in `$state`; the pending upload lives in a plain `Map`
  beside the reactive array.
