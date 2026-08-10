# API Contract: Bank Reconciliation

**Feature**: `specs/001-bank-reconciliation` | **Date**: 2026-08-10

Every endpoint below is a SvelteKit route handler under `src/routes/api/reconciliation/`. All follow
the reference shape of `src/routes/api/income/+server.ts`: authorize → validate → delegate to
`services/reconciliation.ts` → return JSON.

## Universal rules

| Rule | Applies to |
|------|-----------|
| `if (!locals.user) → 401` | every endpoint (handled by `hooks.server.ts` for page routes; explicit on the SSE stream) |
| `hasPermission(locals, 'reconciliation', <action>)` → `403 Forbidden` on failure | every endpoint. `view` for GET/SSE, `add` for session creation and statement upload, `change` for edits/matching/clearing/close/reopen, `delete` for session and line deletion (FR-032) |
| Request bodies parsed with a Zod schema; failure → `400 { error }` | every mutating endpoint (Principle IV) |
| `recordAudit(db, { recordType: 'reconciliation' \| 'expense' \| 'claim' \| 'income', … })` after the write | every mutating endpoint (FR-033) |
| `reconciliationEvents.emit(...)` after the write; plus the ledger emitter when an item's cleared state changed | every mutating endpoint (FR-034, D-10) |
| Session-scoped endpoints return `404` for an unknown `id`, and `409` when the session's status forbids the operation | all `[id]/**` routes |

Amounts are numbers in the app's main currency unless noted. Dates are `YYYY-MM-DD` strings,
validated with the existing `isValidDate()`.

---

## `GET /api/reconciliation`

History list (FR-031). Permission: `view`.

**Query**: `limit` (default 50), `offset`.

**200**:

```jsonc
{
  "openSession": { /* SessionSummary | null */ },
  "sessions": [ /* SessionSummary[], newest id first */ ]
}
```

`SessionSummary`:

```jsonc
{
  "id": 12,
  "startingBalance": 4210.55,
  "startingDate": "2026-07-01",
  "periodEndDate": "2026-07-31",
  "statementEndingBalance": 5180.10,
  "computedBalance": 5180.10,
  "status": 2,                      // ReconSessionStatus
  "difference": 0,                  // computed - entered; null while open
  "clearedCount": 14,
  "unclearedCount": 0,
  "unmatchedLineCount": 0,
  "statementState": 1,              // StatementExtractionState
  "statementError": null,
  "hasDrift": false,                // FR-035 — drift.ts over this session's cleared items
  "canReopen": true,                // session-rules.ts: newest && closed
  "canDelete": true,
  "closedAt": "2026-08-02 09:11:04",
  "createdBy": 1,
  "createdAt": "2026-08-01 20:40:12"
}
```

---

## `POST /api/reconciliation`

Start a session (FR-001, FR-010). Permission: `add`.

**Body** (Zod):

```ts
{
  startingBalance: z.number().finite(),
  startingDate: z.string().regex(ISO_DATE),
  periodEndDate: z.string().regex(ISO_DATE),
  statementEndingBalance: z.number().finite()
}
```

Additional rule: `periodEndDate >= startingDate` → else `400`.

- **201** → `SessionSummary` plus the Step 1 result (see `GET /api/reconciliation/[id]`).
- **409** `{ error: "A reconciliation session is already open", openSessionId }` when
  `canStartSession()` fails (FR-010, US1 AC8). The client redirects to that session rather than
  surfacing a raw error.

Audit: `reconciliation` / `create`. Emit: `session-update`.

**Prefill helper**: the page loader supplies `prefillFromLastClosed()` values
(`startingBalance` ← last closed session's `statementEndingBalance`, `startingDate` ← its
`periodEndDate`); they are form defaults only and remain editable (FR-008).

---

## `GET /api/reconciliation/[id]`

Session detail with the live Step 1 computation. Permission: `view`.

**200**:

```jsonc
{
  "session": { /* SessionSummary */ },
  "step1": {
    "expected": 5180.10,
    "entered": 5180.10,
    "matched": true,               // |expected - entered| < 0.005
    "difference": 0,
    "incomeTotal": 9000.00,
    "expenseTotal": 3120.45,
    "claimTotal": 910.00,
    "inScopeCounts": { "incomes": 6, "directExpenses": 21, "claims": 2 }
  },
  "drift": { "changed": [], "deleted": [] }   // FR-035, empty unless closed data moved
}
```

`step1` is recomputed on every read while the session is `Open`; for a closed session it reports the
stored snapshot (`computed_balance`, counts) so history shows what was reconciled, not what would be
reconciled today.

---

## `PATCH /api/reconciliation/[id]`

Edit balances, close, or reopen. Permission: `change`.

**Body** (Zod, all optional; at least one required):

```ts
{
  startingBalance?: number,
  startingDate?: string,
  periodEndDate?: string,
  statementEndingBalance?: number,
  status?: 1 | 2 | 3          // ReconSessionStatus
}
```

Rules:

- Balance/date edits require `status === Open` → else `409`.
- `status` to a closed value = **close** (FR-006, FR-028): the service recomputes Step 1, writes
  `computed_balance`, `cleared_count`, `uncleared_count`, `unmatched_line_count`, `closed_at`, and
  ignores the submitted closed value in favour of the one the arithmetic dictates
  (`ClosedMatched` when it ties out, else `ClosedWithLeftovers`) — the client cannot mislabel history.
- `status: Open` = **reopen** (FR-036): allowed only when `canMutateSession(session, newestId)` and no
  other session is open → else `409`. Clears `closed_at` and the count snapshots.

**200** → the same body as `GET`. Audit: `reconciliation` / `update` with `diffRecords`.
Emit: `session-update`.

---

## `DELETE /api/reconciliation/[id]`

Delete the newest session (FR-037). Permission: `delete`.

- **409** when it is not the newest session.
- **204** otherwise. In one transaction: unclear every item with `cleared_session_id = id` (nulling
  `cleared_line_id`, `cleared_amount`, `cleared_at`), clear annotations made in this session, delete
  its lines (FK cascade), delete `reconciliation/{id}/`.

Audit: `reconciliation` / `delete`, plus one `update` entry per un-cleared item recording
`cleared: true → false`. Emit: `session-deleted` and one ledger emit per affected item.

---

## `POST /api/reconciliation/[id]/statement`

Upload a bank statement (FR-011, FR-012). Permission: `add`. Requires `status === Open` → else `409`.

**Request**: `multipart/form-data`, field `file`. Validated with the existing
`sniffAllowedType()` (pdf/jpeg/png only) and `MAX_UPLOAD_BYTES` (15 MB) — wrong type or oversize →
`400` / `413`.

- **202** `{ statementState: 2 }` — the file is stored under `reconciliation/{id}/`,
  `statement_state` set to `Extracting`, and processing continues in-process (D-06).
- **409** `{ error: "No document extraction provider is configured", manualEntryAvailable: true }`
  when `getEnabledProviders()` is empty (FR-014, SC-008). The UI keeps the manual-entry path open.

Progress and outcome arrive over SSE (`events.md`): `session-update` with `statementState`
`Extracting → Ready | Failed`, then `lines-added` carrying the inserted lines. On failure,
`statement_error` holds a user-facing explanation (FR-015).

**Guarantee (SC-005, FR-012)**: this path writes only to `bank_statement_lines` and the session row.
It never touches `import_queue`, `expenses`, or `incomes`.

---

## `GET /api/reconciliation/[id]/lines`

Permission: `view`. **200**:

```jsonc
{
  "lines": [
    {
      "id": 501,
      "date": "2026-07-14",
      "description": "PYMT GRAB MALAYSIA",
      "amount": 38.40,
      "direction": 2,               // StatementDirection
      "matchedItemType": 1,         // null when unmatched
      "matchedItemId": 88,
      "matchedItemLabel": "EX20260714-002 · Grab ride",  // resolved for display
      "note": "",
      "sourceFile": "reconciliation/12/statement-jul.pdf",
      "isDuplicate": false,         // derived by findDuplicateLines()
      "suggestion": { "itemType": 1, "itemId": 88, "score": 106, "label": "…" }  // null when none
    }
  ],
  "candidates": [ /* in-scope Akaun items for the picker, see below */ ]
}
```

`candidates` are the session's in-scope bank-facing items (data-model.md), each as
`{ itemType, itemId, label, date, amount, cleared, clearedLineId }`. Items already cleared in an
**earlier** session are excluded entirely (FR-026); items cleared in *this* session are included and
marked so the user can undo.

---

## `POST /api/reconciliation/[id]/lines`

Add a line by hand (FR-013, FR-014). Permission: `change`. Requires `status === Open`.

**Body** (Zod): `{ date, description?, amount: z.number().positive(), direction: 1 | 2, note? }`.

**201** → the created line. Audit: `reconciliation` / `update` on the session. Emit: `line-update`.

## `PATCH /api/reconciliation/[id]/lines/[lineId]`

Correct a misread line (FR-013, US2 AC3). Permission: `change`. Same field set, all optional.
Editing amount/date/direction of a **matched** line is allowed and re-validates nothing — the match
stands until the user changes it, but the response recomputes `isDuplicate`.

**200** → the updated line. Emit: `line-update`.

## `DELETE /api/reconciliation/[id]/lines/[lineId]`

Remove a junk or duplicate row (FR-013, FR-016). Permission: `delete`. If the line cleared an item,
that item is returned to uncleared in the same transaction.

**204**. Emit: `line-deleted`, plus a ledger emit if an item was un-cleared.

---

## `PUT /api/reconciliation/[id]/lines/[lineId]/match`

Accept a match — the only path that clears anything (FR-019, FR-021). Permission: `change`.
Requires `status === Open` → else `409`.

**Body** (Zod): `{ itemType: 1 | 2 | 3, itemId: z.number().int().positive() }`.

Rejections (`409`, with `error`):

- the item is a **claimed** expense (not bank-facing — FR-003, US3 AC6);
- the item was cleared in an **earlier** session (FR-026);
- the item is annotated `WillNotClear`;
- the item is already matched to a **different** line in this session.

A mismatch between the line's amount and the item's value is **not** an error — the difference is
allowed and surfaces as a leftover (spec edge case: partial or combined reimbursement).

**200** → `{ line, item }`. Writes `matched_item_type`/`matched_item_id` on the line and upserts
`reconciliation_item_state` with `cleared_session_id`, `cleared_line_id`, `cleared_amount` (the item's
current main-currency value — the FR-035 baseline), `cleared_at`.

Audit: `reconciliation`/`update` on the session **and** `expense`/`claim`/`income` `update` on the item
with `cleared: false → true` (FR-033). Emit: `line-update` + `item-state-update` +
the item's ledger emitter (for a claim, also its member expenses, so their "cleared via claim" badge
updates — the existing `emitLinkedExpenses` pattern in `services/claims.ts`).

## `DELETE /api/reconciliation/[id]/lines/[lineId]/match`

Undo a match (FR-022). Permission: `change`. Returns both sides to uncleared and deletes the
`reconciliation_item_state` row if it now carries no annotation either.

**204**. Same audit and emit obligations, inverted.

---

## `PUT /api/reconciliation/[id]/annotations`

Set or clear a leftover annotation (FR-029). Permission: `change`.

**Body** (Zod):

```ts
{
  itemType: 1 | 2 | 3,
  itemId: z.number().int().positive(),
  annotation: z.union([z.literal(1), z.literal(2), z.null()]),  // LeftoverAnnotation | null to remove
  note: z.string().max(500).optional()
}
```

`WillNotClear` removes the item from the Step 1 computation and from every future leftover list
(FR-004, SC-009). `NotYetCleared` is purely a record that the user has seen it; the item stays in
scope (FR-029, SC-010). Annotating an item that is **cleared** → `409`.

**200** → the item's state row. Audit: on the item (`update`, `annotation` change). Emit:
`item-state-update` + the item's ledger emitter.

---

## `GET /api/reconciliation/stream`

SSE. Permission: `view` — see [events.md](./events.md).

---

## Page routes

| Route | Loader | Permission | Notes |
|-------|--------|------------|-------|
| `/reconciliation` | `loadReconciliationPage(locals, null)` | `view`, else `redirect(302, '/dashboard')` | Renders `ReconciliationPage.svelte` with `openSessionId={null}` |
| `/reconciliation/[id]` | `loadReconciliationPage(locals, id)` | `view` | Same component, `openSessionId={data.openSessionId}`; redirects to `/reconciliation` when the id is not among the loaded sessions (deep-link pattern) |
| `/reconciliation/[id]/match` | `loadMatchWorkspace(locals, id)` | `view` to read; the workspace's actions require `change` and are disabled without it | Step 2 workspace; redirects to `/reconciliation/[id]` when the session has no statement lines yet |

Both `+page.server.ts` files call the one shared loader in
`src/lib/server/loaders/reconciliation.ts`, per the deep-link pattern in `CLAUDE.md`. A user without
`reconciliation.view` never sees the nav item (`nav-config.ts` carries the resource) and is redirected
away from the routes — the "behaves as if the area does not exist" requirement of FR-032.
