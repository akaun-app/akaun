# Contract: Live Updates (SSE)

**Feature**: `specs/002-double-entry-ledger` | **Date**: 2026-08-15

FR-042 requires a change made in one open view to appear in other open views of the same data without
a manual refresh. The app's settled answer is Server-Sent Events, never polling (`CLAUDE.md`,
constitution Principle VI). This feature adds one emitter for the ledger and one for the chart of
accounts, and retires three.

## Emitters

`src/lib/server/ledger/events.ts`

| Emitter | Replaces | Emitted after |
|---|---|---|
| `ledgerEvents` | `expenseEvents`, `incomeEvents`, `claimEvents` | Any write to a record, its movements, its attachments, or a settlement |
| `accountEvents` | — | Any write to an account, including archiving and an opening balance |

`contactEvents`, `quotationEvents`, `invoiceEvents` and `reconciliationEvents` are unchanged.
`claimEvents` is deleted with the claims screen (FR-036a).

**One write, one emit.** A single record change can alter what the Expenses list, the Income list, an
account balance and a report all show. One emitter carrying the record's `kind` means the service
layer never has to remember which of several emitters to fire — forgetting one is silent, and silence
is exactly the failure FR-042 is written against (D-21).

Both emitters set `setMaxListeners(200)`, matching the existing ceiling and its reasoning: each open
connection registers a small fixed number of listeners and removes them all on disconnect, so the cap
guards against a genuine leak rather than normal load.

## Streams

| Endpoint | Sends | Permission |
|---|---|---|
| `GET /api/expenses/stream` | `ledgerEvents` filtered to `kind = expense`, plus payments that changed an expense's paid state | `expenses` view |
| `GET /api/income/stream` | `ledgerEvents` filtered to `kind = income` | `income` view |
| `GET /api/accounts/stream` | `accountEvents`, plus a balance update whenever a movement touches an account | `accounts` view |
| `GET /api/reconciliation/stream` | unchanged | `reconciliation` view |
| `GET /api/claims/stream` | **deleted** | — |

The two existing stream URLs are kept so no open client breaks across the upgrade.

## Event payloads

```
event: record-update      data: { record: <the shape GET /api/records returns for one record> }
event: record-deleted     data: { id }
event: settlement-changed data: { recordIds: [ ... ] }   // both sides, so each view refreshes its own
event: account-update     data: { account: { id, name, role, balanceMinor, archivedAt } }
event: account-deleted    data: { id }
```

`settlement-changed` carries the ids of every record whose derived paid state may have moved, because
settling is the one action that changes a record no one edited.

## Client rules (unchanged from the established pattern)

- Open the `EventSource` in `onMount`, close it in `onDestroy` — never in `$effect`, which re-runs on
  reactive changes and would tear the connection down.
- **No snapshot on connect** for these streams. The paginated Expenses, Income and Accounts lists get
  their initial state from SSR; SSE carries incremental updates only. A dropped connection
  auto-reconnects and the next event re-syncs the affected row.
- Merge with the `mergeServerJobs` shape: update rows already on screen, prepend rows that are brand
  new from another tab, drop rows on `record-deleted`.
- Nothing is added to local `$state` optimistically from a create action — the SSE event is the sole
  driver, which is what removes the race between the fetch response and the event arriving on the
  same connection.
