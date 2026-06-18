# Akaun Web — Claude Code Notes

## Architecture Decisions

### Real-Time Updates: SSE-Only

All features that need live UI updates must use **Server-Sent Events (SSE)**, not polling.

**Pattern:**
- Create a `GET` endpoint at `src/routes/api/<feature>/stream/+server.ts` that returns a `ReadableStream` with `Content-Type: text/event-stream`
- Use the singleton `importEvents` EventEmitter pattern (`src/lib/server/import/events.ts`) — create a parallel `<feature>Events` emitter for each domain
- Every server action (POST, PATCH, DELETE) that mutates state must call `events.emit(...)` after the DB write so all connected clients see the change
- On the client, open the EventSource in `onMount` and close it in `onDestroy` — never in `$effect` (which re-runs on reactive dependency changes and would tear down the connection)

**Client merge pattern** (`mergeServerJobs` in the import page is the reference implementation):
- On connect, the stream sends a full snapshot of current state
- Subsequent events are incremental updates (`item-update`, `item-deleted`, etc.)
- `mergeServerJobs`-style merge: update existing items, prepend brand-new items from other tabs
- Do **not** add items to local `$state` optimistically from the upload/create action — let the SSE event be the sole driver. This eliminates race conditions between the fetch response and the SSE event arriving on the same connection.
- Do **not** store non-plain objects (e.g. `File`, `Blob`) in Svelte 5 `$state` — keep them in a plain `Map` alongside the reactive array

**Snapshot vs. no-snapshot:**
- Import queue (small, finite set of active jobs): send a full snapshot on connect so reconnects catch up automatically.
- Paginated lists (income, expenses, claims): **no snapshot**. SSR provides the initial state; SSE provides incremental updates only. If the connection drops briefly, `EventSource` auto-reconnects and the next event re-syncs the affected item. A full page reload re-fetches the correct state.

**Why not polling?**
Polling was considered and rejected. SSE gives instant updates, no wasted requests, and simpler client code once the pattern is established.
