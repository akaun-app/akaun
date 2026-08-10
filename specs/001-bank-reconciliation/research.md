# Phase 0 Research: Bank Reconciliation

**Feature**: `specs/001-bank-reconciliation` | **Date**: 2026-08-10

The spec carries no `[NEEDS CLARIFICATION]` markers — four were resolved in the
`/speckit-clarify` session recorded in spec.md. What follows resolves the *technical* unknowns the
Technical Context raised, plus the two items the requirements checklist explicitly deferred to
planning (match date window, seed-group defaults).

---

## D-01 — Where cleared state lives

**Decision**: A single reconciliation-owned table, `reconciliation_item_state`, with a unique
`(item_type, item_id)` key and no foreign key to the referenced record. It holds both the cleared
marker (`cleared_session_id`, `cleared_line_id`, `cleared_amount`, `cleared_at`) and the leftover
annotation (`annotation`, `annotation_session_id`, `annotation_note`).

**Rationale**:

- FR-023 restricts cleared state to direct expenses, claims, and incomes — three tables that would
  otherwise each need four columns of reconciliation bookkeeping. One table keeps reconciliation's
  data in reconciliation's storage, exactly as the development plan requires of statement lines.
- FR-037 ("deleting a session returns every record it cleared to uncleared") becomes one `UPDATE …
  WHERE cleared_session_id = ?` instead of three.
- FR-035 needs to notice that a *deleted* record was cleared in a closed session. A row with no FK
  survives that deletion and reports the drift; an FK with `cascade` would silently erase the
  evidence, and `restrict` would block deleting ledger records outright.
- Clearing and annotation share one lifecycle owner and one lookup — an item is either cleared, or
  annotated, or neither — so splitting them into two tables would mean two joins on every list query
  to answer one question.
- `audit_log` already uses `(record_type, record_id)` polymorphically for the same
  survive-the-delete reason, so this follows an established precedent rather than inventing one.

**Alternatives considered**:

- *Columns on `expenses` / `incomes` / `claims`* — rejected: 12 columns across three tables, a
  destructive-in-intent migration on the ledger's core tables, and no clean way to unclear a whole
  session.
- *Two tables (clearings + annotations)* — rejected: doubles the join count for a strictly
  one-row-per-item concept.
- *Three nullable FK columns with a one-of check* — rejected under Complexity Tracking; see plan.md.

---

## D-02 — Reusing extraction and LLM plumbing without depending on the import feature

**Decision**: Move the genuinely shared pieces **down** into new shared modules and repoint the
import feature at them:

| From | To |
|------|-----|
| `src/lib/server/import/extractor.ts` | `src/lib/server/extraction/document-text.ts` |
| `createModel()` in `import/providers/index.ts` | `src/lib/server/llm/model-factory.ts` |
| `withRetry()` in `import/providers/index.ts` | `src/lib/server/llm/retry.ts` |
| `src/lib/server/import/rate-limiter.ts` | `src/lib/server/llm/rate-limiter.ts` |

Reconciliation keeps its **own** prompt and Zod schema (`reconciliation/statement-parse.ts`,
`statement-llm.ts`). Nothing from `import/providers/shared.ts` (the single-receipt
`LLMResultSchema`, `buildSystemPrompt`, `postProcess`) is reused — a bank statement is a different
document shape with a different output contract.

**Rationale**: Principle IV states shared logic "moves down into `$lib`, never sideways between
features"; importing `$lib/server/import/extractor.js` from reconciliation would be exactly the
sideways dependency that rule forbids. Principle III's "extract on the second or third concrete use"
is satisfied — this is the second real consumer of both the text extractor and the provider factory,
and both are extracted from real cases rather than anticipated ones. The moves are mechanical
(file relocation + import-path updates, no behavior change), and `getEnabledProviders()` in
`llmProviders.ts` is already feature-neutral and needs no move.

**Alternatives considered**:

- *Import directly from `import/`* — rejected: violates the dependency-direction rule and makes the
  reconciliation module break whenever auto-import is refactored.
- *Duplicate a small model factory inside reconciliation* — rejected: the constitution's duplicate-
  twice-extract-on-the-third rule applies to speculative abstraction, not to a helper that already
  has two concrete callers; two copies of provider-fallback and retry logic would drift.

---

## D-03 — Step 1 balance arithmetic

**Decision**: `expected = startingBalance + Σ incomes − Σ direct expenses − Σ claims`, where each sum
covers rows that are (a) dated `<= periodEndDate`, (b) have **no** cleared marker in any session, and
(c) are not annotated `WillNotClear`. Amounts participate at their main-currency value
`amount * exchangeRate`, rounded to 2 dp per row before summing. A claim's value is
`Σ (expense.amount * expense.exchangeRate)` over its member expenses. Comparison to the entered
ending balance uses an epsilon of **0.005** (half a cent).

**Rationale**: This is the spec's uncleared-to-date rule (FR-002, FR-004, SC-010) stated as
arithmetic. Rounding per row before summing matches how the amounts are displayed, so the difference
the user sees on screen is the difference the system computed. `amount` is stored as SQLite `REAL`,
so an exact `===` comparison would occasionally report a phantom difference of 1e-15; half a cent is
below any real-world discrepancy and above float noise. Claims have no amount column of their own —
`getClaim` already derives the total from member expenses, and reusing that derivation keeps one
definition of "what a claim is worth" (FR-003, US1 AC3).

**Alternatives considered**: integer minor units — correct in principle, but would require converting
the entire existing ledger and is squarely out of this feature's scope. Exact float comparison —
rejected as above.

---

## D-04 — Match candidate ranking and the date window

**Decision** (resolves the checklist's deferred "exact date window"): a statement line and an Akaun
item are candidates when

1. **Direction agrees** — a money-out line matches direct expenses and claims; a money-in line
   matches incomes. This is a hard filter, never a score.
2. **Amount is within tolerance** — exact within 0.005 (score 100), or within 1 % relative (score 55).
   The 1 % band exists so a foreign-currency record whose stored rate differs slightly from the
   bank's still *appears* as a candidate; it never auto-clears (D-05).
3. **Date is within ±7 days** of the line's date. Score penalty is `−2 × |days|`, so a same-day
   candidate outranks a week-old one of identical amount.

A small description bonus (`+8` when the item's contact name or item text shares a normalised token
with the line's description) breaks ties and is what lifts the top-suggestion hit rate toward SC-004's
80 %. The top-scoring candidate is the suggestion; the rest are offered in the picker, ranked.

**Rationale**: ±7 days absorbs weekend/clearing lag without letting a monthly-recurring payment of
the same amount outrank the right one. The spec explicitly calls the window "an implementation detail
tuned during build, not a user-facing setting", so it is a module constant with a comment, not a
setting. All of this is a pure function over already-fetched rows, so retuning the constants is a
test change, not a migration.

**Alternatives considered**: exact-amount-only candidacy — rejected, it would hide the FX near-matches
the spec's assumptions section says must surface for manual resolution. A configurable window —
rejected by YAGNI and by the spec.

---

## D-05 — Nothing auto-clears

**Decision**: `rankCandidates()` returns suggestions only. Clearing happens exclusively through
`PUT /api/reconciliation/[id]/lines/[lineId]/match`, driven by an explicit user action, even when
exactly one candidate matches on both amount and date.

**Rationale**: FR-019 and the spec's confirmed "matching assistance" assumption. It also keeps the
match suggestion transient (spec's Key Entities: "Never persisted as a decision"), which means there
is no suggestion state to invalidate when a record is edited.

---

## D-06 — Statement upload runs in-process, asynchronously, reported over SSE

**Decision**: `POST /api/reconciliation/[id]/statement` validates and stores the file, sets the
session's `statement_state` to `Extracting`, returns `202`, and continues in-process. Text extraction
(`unpdf`, falling back to Tesseract OCR for scanned pages) then one LLM call produce the lines, which
are inserted and announced as a `lines-added` SSE event. Failure sets `statement_state = Failed` with
`statement_error` and emits `session-update`; the manual-entry path stays open throughout (FR-015).

**Rationale**: Extraction of a scanned multi-page statement can exceed a minute — long enough that a
synchronous request risks proxy timeouts, and long enough that the user needs progress. Constitution
Principle II forbids a new *worker service*, not in-process async work; the auto-import worker is
itself in-process. Reconciliation deliberately does **not** get a queue table: there is at most one
open session (FR-010) and one upload in flight, so the two state columns on the session row carry
everything a queue would have.

**Alternatives considered**: reusing `import_queue` and its worker — explicitly rejected by the
development plan and by FR-012, because that pipeline's terminal state is "insert into the ledger".
A synchronous request — rejected for the timeout and no-progress reasons above.

---

## D-07 — Statement lines: what is stored vs derived

**Decision**: `bank_statement_lines` stores `date`, `description`, `amount` (always positive),
`direction`, `matched_item_type`, `matched_item_id`, `note`, and `source_file`. There is **no**
stored `cleared` column — a line is cleared exactly when `matched_item_type IS NOT NULL`. Duplicate
detection (FR-016) is likewise derived, not stored: a pure function flags lines within a session
sharing the same date, amount, and case/whitespace-normalised description.

**Rationale**: The development plan sketched a `cleared` column alongside `matched_*`; two fields
encoding one fact can disagree after a partial failure, and there is no state where a line is matched
but not cleared. Deriving duplicates keeps the flag correct after an edit (FR-013 lets the user fix a
misread line, which can create or resolve a duplicate) without a recompute-and-rewrite step.

**Signed amounts**: the amount is stored positive with a separate `direction`, matching how statements
print and letting the direction filter in D-04 be an index-friendly equality rather than a sign test.

---

## D-08 — Session chaining, mutability, and the "most recent" definition

**Decision**: chain order is **creation order (`id`)**, not period dates. "The most recent session" is
the one with the highest `id`. Only it may be reopened (`ClosedMatched`/`ClosedWithLeftovers` → `Open`)
or deleted; every older session is read-only. "At most one open session" (FR-010) is enforced in the
service by a guard query, returning a typed conflict the route maps to `409`.

**Rationale**: FR-008 pre-fills from "the most recently closed session", and overlapping periods are
explicitly permitted — so period dates cannot order the chain, but creation order always can. Deleting
the newest session (FR-037) can never orphan a later session's starting balance, which is precisely
why the restriction exists. A partial unique index on `status = Open` was considered as a second
guard; it was dropped because the same rule already lives in a tested pure predicate
(`session-rules.ts`) and a DB-level failure would surface as an opaque constraint error rather than
the "you already have an open session" message the user needs (US1 AC8).

---

## D-09 — Test strategy: pure functions over rows, no test database

**Decision**: every Principle V in-scope module (`balance`, `matching`, `session-rules`, `drift`,
`statement-parse`) is a pure function taking already-fetched plain row objects. Their `*.spec.ts`
files construct those rows as literals. No test database is created and no database is mocked; the
service layer that fetches and writes is verified statically (per the project's verification policy)
rather than by integration test.

**Rationale**: This satisfies the constitution's TDD scope — the financial calculation, the match
ranking, and the state-transition rules are exactly the "silently wrong" logic Principle V targets —
while sidestepping an unresolved runtime question: `bun:sqlite` is a Bun builtin and is externalised
in `vite.config.ts`, but the `server` Vitest project declares `environment: 'node'`, so a
`createTestDb()` helper may or may not be able to open a connection depending on which runtime
executes the suite. Rather than resolve that ambiguity speculatively, the design removes the need for
it. The constitution's "do not mock the database to test a query" rule is honoured by not testing
queries at this layer at all — and by keeping the query layer thin enough that its correctness is
readable.

**Consequence for design**: `computeExpectedBalance(input)` receives arrays of rows, not a `db`
handle. The service does the fetching. This is the boundary Principle IV asks for anyway.

---

## D-10 — Exposing cleared state to the expenses / claims / income views

**Decision**: extend the existing projections in `queries/expenses.ts`, `queries/claims.ts`, and
`queries/income.ts` with a `LEFT JOIN reconciliation_item_state` yielding `cleared: boolean` and
`clearedSessionId`. For an expense with a `claimId`, the join additionally resolves the *parent
claim's* state and returns `clearedViaClaimId`, which drives the "cleared via claim" badge
(FR-024, US3 AC4). Whenever the service changes an item's cleared state it emits on **both**
`reconciliationEvents` and the item's own ledger emitter, so an open expenses list updates live
(FR-034).

**Rationale**: FR-024 and FR-025 place cleared affordances inside the expense, claim, and income
detail sheets, and US3 AC5 requires the direct-expense cleared control to work from either screen.
Those views already fetch their rows; carrying the flag in the same query is one extra join rather
than a second stream subscription and a client-side merge on every list page.

**Alternatives considered**: having ledger pages subscribe to `/api/reconciliation/stream` and merge
cleared state client-side — rejected: the shared `sse.ts` registry makes the extra connection cheap,
but the list rows still need the flag on first paint, so the join is required regardless; adding the
subscription on top would be two sources of truth for one boolean.

---

## D-11 — Permission resource rollout

**Decision** (resolves the checklist's deferred "seed-group defaults"): add `'reconciliation'` to
`ResourceName` and `ALL_RESOURCES` in `permissions.ts`, to the `RESOURCES` grid in
`users-groups/+page.svelte`, and to `SEED_GROUPS` in `db/client.ts` with the **same** grid defaults
the comparable read-write resources get — no special casing, contrary to the development plan's
suggestion that `change`/`delete` might be superuser-only. Also add `'reconciliation'` to the audit
`RecordType` union and to `RESOURCE_BY_RECORD_TYPE` in the audit route.

**Rationale**: FR-032 asks for "the same view / add / change / delete actions as every other
resource", and FR-036/FR-037 give `change` and `delete` real, non-superuser meaning (reopen and
correct the newest session; delete it). Special-casing the grid would make the permission UI
inconsistent for no gain.

**Upgrade note**: `ensureGroupSeed()` only seeds groups that do not already exist, so an existing
install's non-superuser groups will have `reconciliation` permissions all false until an administrator
grants them. That is the correct default (deny) and needs no data migration; superuser groups are
unaffected because `hasPermission` short-circuits on `isSuperuser`.

---

## D-12 — Statement files are retained; no separate attachments table

**Decision**: the uploaded statement is saved through the existing `file-storage.ts` helpers under
`reconciliation/{sessionId}/`, and each line produced from it stores that relative path in
`source_file` (null for manually added lines). Deleting a session deletes its directory. No
`reconciliation_attachments` table and no `AttachmentManager` integration.

**Rationale**: the spec requires *lines* to persist (FR-017, SC-006), not files — but discarding the
source PDF would make "show me the statement this line came from" impossible to add later without
asking the user to re-upload, which is the very trade-off the development plan's persistence decision
was made to avoid. Recording the path on the line costs one nullable column, gives every line
provenance and a real `href` (so the `related-link` contract's anchor exception applies), and needs no
extra table because lines from one upload simply share the path.

**Alternatives considered**: a `reconciliation_statement_files` table — rejected by YAGNI; a session
has no metadata to record about its uploads beyond the path already carried on the lines. Discarding
the file after extraction — rejected as above.

---

## Non-blocking observation

The permission grid in `users-groups/+page.svelte` currently lists six resources and omits
`quotations` and `invoices`, which *are* in `ALL_RESOURCES`. That is a pre-existing gap unrelated to
this feature; it is noted here so it is not mistaken for something reconciliation introduced, and it
is deliberately left unfixed to keep this change's scope honest.
