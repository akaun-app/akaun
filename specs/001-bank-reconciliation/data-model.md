# Phase 1 Data Model: Bank Reconciliation

**Feature**: `specs/001-bank-reconciliation` | **Date**: 2026-08-10

Three new tables in `src/lib/server/db/schema.ts`, one generated migration
(`drizzle-kit generate` → `drizzle/0009_*.sql`). No column is added to `expenses`, `incomes`, or
`claims`. Decisions behind these shapes are in [research.md](./research.md) (D-01, D-07, D-08, D-12).

---

## Enums

Appended to `src/lib/enums.ts` (INTEGER in the DB, append-only codes, with label maps beside the
existing ones).

```ts
// --- reconciliation ---
export const ReconItemType = { Expense: 1, Claim: 2, Income: 3 } as const;
export const ReconSessionStatus = { Open: 1, ClosedMatched: 2, ClosedWithLeftovers: 3 } as const;
export const StatementDirection = { In: 1, Out: 2 } as const;
export const LeftoverAnnotation = { NotYetCleared: 1, WillNotClear: 2 } as const;
export const StatementExtractionState = { Idle: 1, Extracting: 2, Ready: 3, Failed: 4 } as const;
```

| Enum | Meaning | Notes |
|------|---------|-------|
| `ReconItemType` | Which ledger table a polymorphic reference points at | `Expense` is only ever a **direct** (unclaimed) expense — FR-003, FR-024 |
| `ReconSessionStatus` | Session lifecycle | `ClosedMatched` = tied out at Step 1; `ClosedWithLeftovers` = escalated and closed with leftovers. Distinguishes the two at a glance for FR-031 / US4 AC2 without a second column. Reopen (FR-036) returns to `Open`. |
| `StatementDirection` | Money in / money out on the statement | Amounts are stored positive; direction is the hard filter for candidacy (D-04) |
| `LeftoverAnnotation` | FR-029 | `NotYetCleared` = timing difference, stays a candidate; `WillNotClear` = never a bank transaction, excluded from computation and from leftovers |
| `StatementExtractionState` | Progress of the most recent upload into a session | Replaces a queue table (D-06) |

---

## Table: `reconciliation_sessions`

One reconciliation attempt. Owns its statement lines.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | INTEGER | PK, autoincrement | Also the chain order — "most recent session" = highest id (D-08) |
| `starting_balance` | REAL | NOT NULL | FR-001 |
| `starting_date` | TEXT | NOT NULL | `YYYY-MM-DD`; the date the starting balance is true as of |
| `period_end_date` | TEXT | NOT NULL | `YYYY-MM-DD`; upper bound of the uncleared-to-date sweep (FR-002) |
| `statement_ending_balance` | REAL | NOT NULL | The figure printed on the statement (FR-001) |
| `computed_balance` | REAL | nullable | Snapshot of the Step 1 result at close. Null while open. |
| `status` | INTEGER | NOT NULL, default 1 | `ReconSessionStatus` |
| `cleared_count` | INTEGER | NOT NULL, default 0 | Snapshot at close (FR-028, FR-031) |
| `uncleared_count` | INTEGER | NOT NULL, default 0 | Snapshot at close |
| `unmatched_line_count` | INTEGER | NOT NULL, default 0 | Snapshot at close |
| `statement_state` | INTEGER | NOT NULL, default 1 | `StatementExtractionState` for the latest upload |
| `statement_error` | TEXT | nullable | User-facing failure explanation (FR-015) |
| `closed_at` | TEXT | nullable | Cleared again on reopen |
| `created_by` | INTEGER | → `users.id` | FR-033 / spec entity "who ran it" |
| `updated_by` | INTEGER | → `users.id` | |
| `created_at` | TEXT | NOT NULL, default `datetime('now')` | |

**Indexes**: `reconciliation_sessions_status_idx` on `(status)` — the open-session guard (FR-010) and
the history list's status filter both hit it.

**Counts are snapshots, not derivations.** Re-deriving `uncleared_count` later would give a different
answer once new records dated before the period are added, which would silently rewrite history. The
spec's FR-028 asks for "the final … counts", i.e. as of close.

### Session state transitions

```
              create (guard: no other Open session — FR-010)
                    │
                    ▼
                  Open ──── close, computed == entered ────▶ ClosedMatched
                    │                                              │
                    └──── close, computed != entered ─────▶ ClosedWithLeftovers
                                                                   │
        reopen (only if this is the newest session — FR-036) ◀──────┘
                    │
                    ▼
                  Open
```

`delete` is permitted **only** on the newest session (FR-037) and, in the same transaction:
unclears every item whose `cleared_session_id` is this session, clears annotations whose
`annotation_session_id` is this session, deletes its statement lines (FK cascade), and removes its
`reconciliation/{sessionId}/` file directory.

---

## Table: `bank_statement_lines`

One transaction as printed on the statement. Reference data — never a ledger record (FR-012).

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | INTEGER | PK, autoincrement | |
| `session_id` | INTEGER | NOT NULL, → `reconciliation_sessions.id` **on delete cascade** | FR-012, FR-037 |
| `date` | TEXT | NOT NULL | `YYYY-MM-DD` |
| `description` | TEXT | NOT NULL, default `''` | |
| `amount` | REAL | NOT NULL | Always **positive**; sign is carried by `direction` (D-07) |
| `direction` | INTEGER | NOT NULL | `StatementDirection` |
| `matched_item_type` | INTEGER | nullable | `ReconItemType`; non-null ⟺ the line is cleared (D-07) |
| `matched_item_id` | INTEGER | nullable | No FK — same survive-the-delete reasoning as D-01 |
| `note` | TEXT | NOT NULL, default `''` | Deliberately-unmatched explanation (FR-020, and the many-to-one edge case) |
| `source_file` | TEXT | nullable | Relative path of the uploaded statement; null = added manually (D-12, FR-013) |
| `created_at` | TEXT | NOT NULL, default `datetime('now')` | |

**Indexes**: `bank_statement_lines_session_idx` on `(session_id, date)` — every read is
"all lines of one session, in date order".

**Derived, not stored**:

- `cleared` ⟺ `matched_item_type IS NOT NULL`.
- `isDuplicate` — flagged by `findDuplicateLines()` in `matching.ts`: same `date`, same `amount`
  (within 0.005), and same description after lowercasing and collapsing whitespace, within one
  session (FR-016). Recomputed on read so an edit immediately resolves or creates the flag.

**Retention**: lines are never deleted when a session closes (FR-017, SC-006); they die only with
their session.

---

## Table: `reconciliation_item_state`

The cleared marker and the leftover annotation for one bank-facing Akaun item. At most one row per
item, across all sessions.

| Column | Type | Constraints | Purpose |
|--------|------|-------------|---------|
| `id` | INTEGER | PK, autoincrement | |
| `item_type` | INTEGER | NOT NULL | `ReconItemType` |
| `item_id` | INTEGER | NOT NULL | Polymorphic, **no FK** (D-01, Complexity Tracking) |
| `cleared_session_id` | INTEGER | nullable, → `reconciliation_sessions.id` **on delete set null** | Which session cleared it (FR-021) |
| `cleared_line_id` | INTEGER | nullable, → `bank_statement_lines.id` **on delete set null** | Which statement line cleared it (FR-021) |
| `cleared_amount` | REAL | nullable | Main-currency value **at the moment of clearing** — the baseline for drift detection (FR-035) |
| `cleared_at` | TEXT | nullable | |
| `annotation` | INTEGER | nullable | `LeftoverAnnotation` (FR-029) |
| `annotation_session_id` | INTEGER | nullable, → `reconciliation_sessions.id` **on delete set null** | Which session the note was made in |
| `annotation_note` | TEXT | NOT NULL, default `''` | Free text |
| `updated_by` | INTEGER | → `users.id` | |
| `updated_at` | TEXT | NOT NULL, default `datetime('now')` | |

**Indexes**: `reconciliation_item_state_item_idx` — **UNIQUE** on `(item_type, item_id)`;
`reconciliation_item_state_session_idx` on `(cleared_session_id)` for the un-clear-a-session sweep.

**Why `set null` and not `cascade`**: deleting a session must return its items to uncleared (FR-037)
*without* destroying leftover annotations, which describe the item and outlive any one session
(FR-029, SC-009). The service nulls `cleared_line_id`/`cleared_amount`/`cleared_at` alongside, and
deletes rows left entirely empty.

**Row lifecycle**: created on first clear or first annotation; a row with neither a
`cleared_session_id` nor an `annotation` is deleted rather than kept as a tombstone.

---

## Derived concept: bank-facing item

Not stored anywhere (FR-003, spec Key Entities). A row is bank-facing when:

| Kind | Rule |
|------|------|
| Direct expense | `expenses.claim_id IS NULL` |
| Claim | always (its reimbursement is the bank movement) |
| Income | always |
| Claimed expense | **never** — it rides inside its claim; it is neither counted in Step 1 nor offered as a candidate (FR-003, US3 AC6) |

A claim's main-currency value is `Σ (expense.amount × expense.exchange_rate)` over its member
expenses — the derivation `getClaim` already performs (D-03).

**In scope for a session** = bank-facing **AND** `date <= period_end_date` **AND** no
`cleared_session_id` **AND** `annotation IS NOT LeftoverAnnotation.WillNotClear` (FR-002, FR-004,
FR-026, SC-009, SC-010).

---

## Pure modules over these rows

All take plain rows, return plain results, and are developed test-first (D-09).

| Module | Signature (shape) | Requirements covered |
|--------|-------------------|----------------------|
| `balance.ts` | `computeExpectedBalance({ startingBalance, incomes[], directExpenses[], claims[] }) → { expected, incomeTotal, expenseTotal, claimTotal }`, `compareBalances(expected, entered) → { matched, difference }` | FR-002 – FR-007 |
| `matching.ts` | `rankCandidates(line, items[]) → RankedCandidate[]`, `findDuplicateLines(lines[]) → Set<lineId>` | FR-016, FR-018 |
| `session-rules.ts` | `canStartSession(sessions[])`, `canMutateSession(session, newestId)`, `prefillFromLastClosed(sessions[])` | FR-008, FR-010, FR-036, FR-037 |
| `drift.ts` | `detectDrift(clearedRows[], currentItems[]) → DriftReport` — flags a cleared item that was deleted or whose main-currency amount no longer equals `cleared_amount` | FR-035 |
| `statement-parse.ts` | `StatementLinesSchema` (Zod) + `normaliseExtractedLines(raw, periodEnd) → ParsedLine[]` — drops running-balance and summary rows, coerces dates, splits sign into amount + direction | FR-011, FR-015, edge case "running balances mixed in" |

**Client mirror**: `MatchWorkspace.svelte` and the expense/claim/income detail sheets need
`isBankFacing()` and `canMutateSession()` to disable controls. Per the `CLAUDE.md` gotcha,
hand-duplicate those two functions client-side with a
`// Mirrors src/lib/server/reconciliation/<file>.ts's <fn> — …` comment.

---

## Touched existing artefacts

| File | Change |
|------|--------|
| `src/lib/server/permissions.ts` | `'reconciliation'` added to `ResourceName` and `ALL_RESOURCES` |
| `src/lib/server/audit.ts` | `'reconciliation'` added to `RecordType` |
| `src/routes/api/audit/[recordType]/[recordId]/+server.ts` | `reconciliation: 'reconciliation'` in `RESOURCE_BY_RECORD_TYPE` |
| `src/lib/server/db/client.ts` | `reconciliation` permissions in `SEED_GROUPS` (D-11) |
| `src/routes/(app)/users-groups/+page.svelte` | `{ id: 'reconciliation', label: 'Reconciliation' }` in `RESOURCES` |
| `src/lib/nav-config.ts` | Reconciliation nav item (`resource: 'reconciliation'`, e.g. `Scale` icon; add its `@lucide/svelte/icons/…` subpath to `optimizeDeps.include` in `vite.config.ts`) |
| `src/lib/server/queries/{expenses,claims,income}.ts` | `LEFT JOIN reconciliation_item_state` → `cleared`, `clearedSessionId`, and (expenses) `clearedViaClaimId` (D-10) |
