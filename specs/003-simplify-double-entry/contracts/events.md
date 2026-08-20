# Contract: SSE Streams

**Feature**: `specs/003-simplify-double-entry` | **Date**: 2026-08-17

Live updates are Server-Sent Events, never polling. One emitter per domain; every server action that
changes state emits after the database write. The client opens its `EventSource` in `onMount` and
closes it in `onDestroy` — never in `$effect`, which would reopen the connection on every dependency
change.

---

## What changes

Three streams become one, and the one is new.

| Before | After |
|---|---|
| `GET /api/expenses/stream` — `record-update` filtered to kind Expense | retired |
| `GET /api/income/stream` — `record-update` filtered to kind Income | retired |
| `GET /api/journal/stream` — `record-update` filtered to kind Journal, **no** `settlement-changed` | retired |
| — | `GET /api/records/stream` — every kind, unfiltered |

All three existing streams already read the **same** `ledgerEvents` emitter and differ only by the kind
they filter for. So the emitters do not change at all: `ledgerEvents` and `accountEvents`
(`$lib/server/ledger/events.ts`) and `reconciliationEvents`
(`$lib/server/reconciliation/events.ts`) keep their events, their payloads and every `emit` call site.

Only the filtering goes. That is the whole of FR-005: one connection per screen instead of three
endpoints that each drop most of what they receive.

---

## `GET /api/records/stream`

Permission: `records` view. `401` without a session, `403` without the ability.

| Event | Payload | When |
|---|---|---|
| `record-update` | the full `RecordView` | a record is created or changed, of **any** kind |
| `record-deleted` | `{ id }` | a record is deleted |
| `settlement-changed` | `{ recordIds }` | a settlement is added or undone, so derived paid state moved on every record named |

**No snapshot on connect.** Records is a paginated list, so SSR gives the first state and the stream
carries only changes. If the connection drops, `EventSource` reconnects and the next event corrects the
row; a reload gets the correct state. This follows `CLAUDE.md`'s rule that only the import queue — a
small set of active jobs — sends a full snapshot.

Two consequences of dropping the kind filter:

- **`settlement-changed` now reaches a screen showing journal records.** The journal stream omitted it
  deliberately, because a hand-entered record has no derived paid state for a settlement to move. On
  one merged screen that reasoning no longer holds: the same list shows expenses whose paid state does
  move, so the event must arrive. A journal row simply has nothing to update.
- **The outstanding-count badge moves with it.** `unpaidCount` in `(app)/+layout.server.ts:18–22`
  already derives from settlement state rather than a stored column, so the figure is unchanged
  (FR-024). What changes is where it is drawn: `badgeFor()` in `Sidebar.svelte:25` and
  `BottomNav.svelte:19` hard-code `item.id === 'expenses'`, and that id no longer exists.

---

## Client merge behaviour

`RecordsPage.svelte` follows the merge pattern `mergeServerJobs` established, as `ExpensesPage.svelte`
already does:

- Update rows already held; insert a row arriving from another tab at the start of the list.
- **Never** add a row to local `$state` from the create action's own response. The SSE event adds it.
  This is what removes the race between the fetch response and the event.
- Keep no `File` or `Blob` in Svelte 5 `$state` — attachments in flight live in a plain `Map` beside
  the reactive array.

`ExpensesPage.svelte` additionally calls `loadOwed()` on both `record-update` and
`settlement-changed`, to refresh the "Still owed" panel. The merged screen keeps that, because it keeps
the panel.

---

## Unchanged streams

| Stream | Emitter | Note |
|---|---|---|
| `GET /api/accounts/stream` | `accountEvents` | `account-update`, `account-deleted`. The flat list needs no new event — a rename or an archive already emits. |
| `GET /api/reconciliation/stream` | `reconciliationEvents` | Sends a full snapshot on connect and keeps doing so. Both new reconciliation surfaces are scoped to one account, so each filters the snapshot it receives rather than asking for a narrower one. |
| `GET /api/dashboard/stream` | `ledgerEvents`, `quotationEvents`, `invoiceEvents` | No per-kind wiring, so nothing to change (FR-032). |
| `GET /api/contacts/stream`, `/api/invoices/stream`, `/api/quotations/stream`, `/api/import/stream`, `/api/search-rebuild/stream` | own emitters | Untouched. |

---

## The obligation that does not change

Every mutating action still emits after its database write. A change that adds a mutating endpoint
without all four of permission check, Zod validation, audit record and SSE emit is incomplete.

This feature adds no mutating endpoint. It moves one (`POST …/statements` gains its account from the
path) and retires ten, so the obligation is discharged by keeping every existing `emit` call site
exactly where it is — the reason the three streams could be replaced by one without touching a single
service.
