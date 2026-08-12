# Tasks: Bank Reconciliation

**Input**: Design documents from `/specs/001-bank-reconciliation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md),
[contracts/events.md](./contracts/events.md), [quickstart.md](./quickstart.md)

**Tests**: Governed by Constitution Principle V. Test-first tasks are included **only** for the five
pure rule modules (`balance`, `session-rules`, `statement-parse`, `matching`, `drift`) — the financial
arithmetic, state-transition rules, and duplicate/match detection that can be silently wrong. No test
tasks are generated for Svelte components, route wiring, thin CRUD passthroughs, or the schema and
migration (constitution's explicit carve-out). No coverage target exists or is introduced.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and
demoed independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: `US1`–`US4`, mapping to the user stories in spec.md
- **[SA]**: Safe to hand to a **subagent** (self-contained file set, contract fixed before it starts)
- Tasks with neither `[P]` nor `[SA]` are **main-context** work — they touch shared files
  (`schema.ts`, `queries/reconciliation.ts`, `services/reconciliation.ts`, `loaders/reconciliation.ts`)
  or require cross-file integration judgement.

## Path Conventions

Single SvelteKit codebase (Constitution Principle I) — no backend/frontend split.

- **Routes & pages**: `src/routes/(app)/reconciliation/`, API at `src/routes/api/reconciliation/`
- **Shared page components**: `src/lib/components/reconciliation/`
- **Pure rule modules**: `src/lib/server/reconciliation/`
- **Business logic**: `src/lib/server/services/reconciliation.ts`
- **Queries & loaders**: `src/lib/server/queries/reconciliation.ts`, `src/lib/server/loaders/reconciliation.ts`
- **Schema & migrations**: `src/lib/server/db/schema.ts` → `drizzle/`
- **Tests**: colocated `*.spec.ts` next to the module under test (Vitest `server` project)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Enums, schema, migration, and the permission/nav registrations every later phase reads.

**Execution**: T001–T004 are **main context** (shared union types and the schema file — serialising
them avoids merge conflicts). T005–T008 are a subagent batch once T004 lands.

- [x] T001 Add the five reconciliation enums (`ReconItemType`, `ReconSessionStatus`, `StatementDirection`, `LeftoverAnnotation`, `StatementExtractionState`) and their label maps to `src/lib/enums.ts`, following the shape of the existing enum + label-map pairs (data-model.md "Enums")
- [x] T002 Add the `reconciliationSessions`, `bankStatementLines`, and `reconciliationItemState` tables to `src/lib/server/db/schema.ts` with the exact columns, defaults, FK actions (`cascade` on `bank_statement_lines.session_id`; `set null` on all three `reconciliation_item_state` session/line FKs) and the four indexes specified in data-model.md
- [x] T003 Generate and commit the migration with `bun run db:generate` (produces `drizzle/0009_*.sql`); verify it creates 3 tables + 4 indexes and alters nothing on `expenses`, `incomes`, or `claims` (depends on T002)
- [x] T004 Add `'reconciliation'` to `ResourceName` and `ALL_RESOURCES` in `src/lib/server/permissions.ts`
- [x] T005 [P] [SA] Add `'reconciliation'` to the `RecordType` union in `src/lib/server/audit.ts` and to `RESOURCE_BY_RECORD_TYPE` in `src/routes/api/audit/[recordType]/[recordId]/+server.ts` (depends on T004)
- [x] T006 [P] [SA] Add `reconciliation` view/add/change/delete entries to `SEED_GROUPS` in `src/lib/server/db/client.ts`, using the same defaults as the comparable read-write resources — no special casing (research.md D-11)
- [x] T007 [P] [SA] Add `{ id: 'reconciliation', label: 'Reconciliation' }` to the `RESOURCES` grid in `src/routes/(app)/users-groups/+page.svelte` (leave the pre-existing `quotations`/`invoices` gap alone — research.md "Non-blocking observation")
- [x] T008 [P] [SA] Add the Reconciliation nav item (`resource: 'reconciliation'`, `Scale` icon) to `src/lib/nav-config.ts` and add its `@lucide/svelte/icons/scale` subpath to `optimizeDeps.include` in `vite.config.ts`

**Checkpoint**: schema migrated, permission resource exists, nav entry gated by `reconciliation.view`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared type contract every pure module and every subagent codes against, the
extraction/LLM modules moved down out of `import/` (Principle IV), and the SSE emitter.

**⚠️ CRITICAL**: T009 is the contract file for the parallel wave in Phases 3–6. Nothing may be
delegated before it lands. T010–T012 are file **moves** whose call sites overlap — keep them in main
context and sequential.

- [x] T009 Create `src/lib/server/reconciliation/types.ts` declaring the plain row/result types every pure module and the service share: `SessionRow`, `StatementLineRow`, `ItemStateRow`, `BankFacingItem` (`{ itemType, itemId, label, date, amount, exchangeRate?, contactName?, claimId? }`), `RankedCandidate`, `Step1Result`, `BalanceComparison`, `DriftReport`, `ParsedLine`, `SessionSummary`, plus the `EPSILON = 0.005`, `MATCH_DATE_WINDOW_DAYS = 7` constants (research.md D-03, D-04). No logic — types and constants only
- [x] T010 Move `src/lib/server/import/extractor.ts` → `src/lib/server/extraction/document-text.ts` unchanged, repoint every importer (`src/lib/server/import/worker.ts` and any other caller found by grep), and delete the original (research.md D-02)
- [x] T011 Move `createModel()` → `src/lib/server/llm/model-factory.ts` and `withRetry()` → `src/lib/server/llm/retry.ts` out of `src/lib/server/import/providers/index.ts`, repoint `providers/index.ts` and `import/llm.ts` at the new modules, no behaviour change (depends on T010)
- [x] T012 Move `src/lib/server/import/rate-limiter.ts` → `src/lib/server/llm/rate-limiter.ts`, repoint its callers, delete the original (depends on T011)
- [x] T013 [P] [SA] Create `src/lib/server/reconciliation/events.ts` exporting `reconciliationEvents = new EventEmitter()`, mirroring `src/lib/server/import/events.ts` (contracts/events.md "Emitter")
- [x] T014 Run `bun run check` and `bun run test` to confirm the extraction/LLM moves broke nothing in the auto-import feature before any reconciliation code depends on them (depends on T010–T012)

**Checkpoint**: shared types frozen, shared utilities relocated, emitter live — parallel wave can start.

---

## Phase 3: User Story 1 - Check the balance ties out (Priority: P1) 🎯 MVP

**Goal**: A user opens Reconciliation, enters four numbers, and learns in under a minute whether the
books tie out — with no statement upload anywhere in the path.

**Independent Test**: With existing records, start a session with the exactly-correct ending balance
and confirm it reports a match and closes as reconciled with Step 2 never offered. Re-run with a wrong
ending balance and confirm the exact difference and direction are shown with an escalate action.

### Tests for User Story 1 (Principle V in-scope) ⚠️

> Write these first and confirm they FAIL before implementing.

- [x] T015 [P] [SA] [US1] Write `src/lib/server/reconciliation/balance.spec.ts` covering: a claim's total counted once with none of its member expenses counted separately (US1 AC3); a foreign-currency expense participating at `amount × exchangeRate` (US1 AC5); an uncleared record dated before the period still counted (US1 AC6, SC-010); a record cleared in an earlier session excluded (US1 AC7); a `WillNotClear`-annotated record excluded (SC-009); per-row rounding to 2 dp before summing; and `compareBalances` reporting `matched: true` for a float-noise difference under 0.005 and the signed difference otherwise (research.md D-03)
- [x] T016 [P] [SA] [US1] Write `src/lib/server/reconciliation/session-rules.spec.ts` covering: `canStartSession` false while any session is `Open` and true otherwise (US1 AC8, FR-010); `canMutateSession` true only for the highest-id session (US4 AC5, FR-036); `prefillFromLastClosed` returning the most recently **closed** session's `statementEndingBalance` and `periodEndDate`, and sane defaults when there is no closed session (US1 AC4, FR-008)

### Implementation for User Story 1

- [x] T017 [P] [SA] [US1] Implement `src/lib/server/reconciliation/balance.ts` — `computeExpectedBalance({ startingBalance, incomes, directExpenses, claims }) → Step1Result` and `compareBalances(expected, entered) → BalanceComparison`, pure over the `types.ts` rows, no `db` handle (research.md D-03, D-09); make T015 pass
- [x] T018 [P] [SA] [US1] Implement `src/lib/server/reconciliation/session-rules.ts` — `canStartSession(sessions)`, `canMutateSession(session, newestId)`, `prefillFromLastClosed(sessions)`; make T016 pass
- [x] T019 [US1] Create `src/lib/server/queries/reconciliation.ts` with the session reads/writes and the in-scope item fetchers: `listSessions`, `getSession`, `getOpenSession`, `insertSession`, `updateSession`, and `getInScopeItems(periodEndDate)` returning bank-facing incomes, direct expenses (`expenses.claim_id IS NULL`), and claims (total derived as `Σ amount × exchangeRate` over member expenses, reusing `getClaim`'s derivation) filtered to `date <= periodEndDate`, no `cleared_session_id`, and not annotated `WillNotClear` (data-model.md "Derived concept", FR-002 – FR-004)
- [x] T020 [US1] Create `src/lib/server/services/reconciliation.ts` with `createSession`, `getSessionDetail`, `updateSessionFields`, and `closeSession` — each doing its `hasPermission` check, composing `balance.ts`/`session-rules.ts` over `queries/reconciliation.ts` rows, writing `computed_balance` and the count snapshots on close, choosing `ClosedMatched` vs `ClosedWithLeftovers` from the arithmetic and **ignoring** the client-submitted status, then calling `recordAudit`/`diffRecords` and `reconciliationEvents.emit('session-update')` (contracts/api.md `POST`/`PATCH` rules)
- [x] T021 [US1] Create `src/routes/api/reconciliation/+server.ts` — `GET` (history list, `view`) and `POST` (create, `add`, Zod-validated, `periodEndDate >= startingDate`, `409 { error, openSessionId }` when a session is already open), following `src/routes/api/income/+server.ts` as the reference shape
- [x] T022 [US1] Create `src/routes/api/reconciliation/[id]/+server.ts` — `GET` (session + live `step1` while `Open`, stored snapshot once closed) and `PATCH` (edit balances / close), returning `404` for unknown ids and `409` when the status forbids the operation
- [x] T023 [US1] Create `src/routes/api/reconciliation/stream/+server.ts` — SSE returning a `ReadableStream` with `text/event-stream`, `401`/`403` guards, 15 s heartbeat comment frames, a `snapshot` frame on connect carrying `{ openSession, lines }`, listeners registered in `start()` and removed in `cancel()`; model it on `src/routes/api/import/stream/+server.ts` (contracts/events.md)
- [x] T024 [US1] Create `src/lib/server/loaders/reconciliation.ts` exporting `loadReconciliationPage(locals, openSessionId)` — `view` check with `redirect(302, '/dashboard')` on failure, history + open session + `prefillFromLastClosed()` defaults, and a redirect to `/reconciliation` when `openSessionId` is not among the loaded sessions (CLAUDE.md deep-link pattern)
- [x] T025 [P] [SA] [US1] Create `src/lib/components/reconciliation/StartSessionSheet.svelte` — the four-field create form on the shared `Sheet` standard (`gap:0`, 22px header with close-only right side, scrollable body, sticky `.sheet-foot` with `.sheet-btn` / `.sheet-btn-primary`), prefilled from the loader's defaults and still editable, `panelSide = isMobile ? 'bottom' : 'right'`
- [x] T026 [P] [SA] [US1] Create `src/lib/components/reconciliation/SessionDetailSheet.svelte` — Step 1 result on the shared `Sheet` standard: hero `.detail-amount` for the difference, `StatusBadge` for `ReconSessionStatus` in `.detail-statusrow` under the hero (add the new tones/labels to `StatusBadge.svelte`'s `byLabel`/`byCode` maps rather than hand-rolling a span), a totals breakdown, `<AuditTrail recordType="reconciliation" recordId={...} />` last in the body with a `bind:this` ref refreshed after each save, and footer actions Close / Escalate to line-by-line
- [x] T027 [US1] Create `src/lib/components/reconciliation/ReconciliationPage.svelte` — the shared module home: open-session card, history list, `openSessionId` prop, `createResourceStream('/api/reconciliation/stream', …)` subscribed in `onMount` (never `$effect`), `mergeById` merges, **no** optimistic local inserts, plus `openDetail`/`closeDetail` shallow routing via `pushState` / `page.state.viaPush` → `history.back()` (CLAUDE.md deep-link pattern; `ExpensesPage.svelte` is the reference)
- [x] T028 [US1] Create `src/routes/(app)/reconciliation/+page.svelte` (`openSessionId={null}`) and `+page.server.ts` (→ `loadReconciliationPage`)
- [x] T029 [US1] Create `src/routes/(app)/reconciliation/[id]/+page.svelte` (`openSessionId={data.openSessionId}`) and `+page.server.ts` (→ the same shared loader)

**Checkpoint**: US1 is fully functional and demoable — SC-001 and SC-008's no-upload path both hold.

---

## Phase 4: User Story 2 - Import a bank statement into statement lines (Priority: P2)

**Goal**: One uploaded statement becomes many editable statement lines belonging to the session — and
nothing else in the app changes.

**Independent Test**: Upload a multi-transaction statement PDF into a session; confirm many lines are
produced from the one file, that they are editable and deletable, that a line can be added by hand,
and that `expenses`, `incomes`, and `import_queue` row counts are unchanged.

### Tests for User Story 2 (Principle V in-scope) ⚠️

- [x] T030 [P] [SA] [US2] Write `src/lib/server/reconciliation/statement-parse.spec.ts` covering: a running-balance column and a summary/total row dropped from the extracted set; a negative amount normalised to a positive `amount` + `direction: Out`; a date coerced to `YYYY-MM-DD`; a malformed row rejected by the Zod parse **without** discarding the valid rows alongside it; and rows dated after `periodEnd` still returned (they are the user's to delete) — FR-011, FR-015, spec edge case "running balances mixed in"

### Implementation for User Story 2

- [x] T031 [P] [SA] [US2] Implement `src/lib/server/reconciliation/statement-parse.ts` — the `StatementLinesSchema` Zod schema for multi-line LLM output plus `normaliseExtractedLines(raw, periodEnd) → ParsedLine[]`, pure and reusing nothing from `import/providers/shared.ts` (research.md D-02); make T030 pass
- [x] T032 [US2] Create `src/lib/server/reconciliation/statement-llm.ts` — the reconciliation-owned multi-line statement prompt and the provider call, built on `$lib/server/llm/model-factory`, `retry`, and `rate-limiter` (never on `import/`), parsing the response through `StatementLinesSchema`
- [x] T033 [US2] Create `src/lib/server/reconciliation/statement-import.ts` — orchestration `file → document-text → statement-llm → normaliseExtractedLines → insert lines`, setting `statement_state` `Extracting → Ready | Failed` with a user-facing `statement_error` on failure, running in-process after the `202` and emitting `session-update` then `lines-added` (research.md D-06, FR-015)
- [x] T034 [US2] Extend `src/lib/server/queries/reconciliation.ts` with statement-line reads/writes: `listLines(sessionId)` (ordered by date), `insertLines`, `insertLine`, `updateLine`, `deleteLine`, `getLine`
- [x] T035 [US2] Extend `src/lib/server/services/reconciliation.ts` with `uploadStatement`, `addLineManually`, `updateLine`, and `deleteLine` — permission checks (`add` for upload, `change` for add/edit, `delete` for delete), `status === Open` guard, `recordAudit`, and `line-update` / `line-deleted` / `lines-added` emits; `deleteLine` un-clears any item the line had cleared in the same transaction
- [x] T036 [US2] Create `src/routes/api/reconciliation/[id]/statement/+server.ts` — `POST` multipart upload validated with the existing `sniffAllowedType()` and `MAX_UPLOAD_BYTES` (`400`/`413`), stored via `file-storage.ts` under `reconciliation/{id}/`, `202 { statementState: 2 }`, and `409 { error, manualEntryAvailable: true }` when `getEnabledProviders()` is empty (FR-014, SC-008)
- [x] T037 [US2] Create `src/routes/api/reconciliation/[id]/lines/+server.ts` (`GET` list + `POST` manual add) and `src/routes/api/reconciliation/[id]/lines/[lineId]/+server.ts` (`PATCH`, `DELETE`) per contracts/api.md, each with permission + Zod + audit + emit
- [x] T038 [P] [SA] [US2] Create `src/lib/components/reconciliation/StatementLineSheet.svelte` — add/edit one statement line (date, description, amount, direction, note) on the shared `Sheet` standard, with the `.sheet-btn-delete` action pinned left via `margin-right:auto` routed through `ConfirmDialog.svelte` (`danger`)
- [x] T039 [US2] Wire the upload affordance into `SessionDetailSheet.svelte`: file picker held in a plain `Map` (never a `File` in `$state`), `Extracting` progress and `Failed` + `statement_error` states rendered from the SSE `session-update`, and a manual-entry path that stays available in every state (FR-014, FR-015)

**Checkpoint**: US1 and US2 both work independently. SC-003 and SC-005 are verifiable.

---

## Phase 5: User Story 3 - Tick off lines and see what is left over (Priority: P3)

**Goal**: Each statement line gets a ranked suggestion; the user accepts, replaces, or rejects it; the
leftovers on each side name the problem.

**Independent Test**: Build a session where one Akaun expense has no bank line and one bank line has
no Akaun record; work the screen; confirm exactly those two remain as leftovers on the correct sides
and that their totals account for the Step 1 difference.

### Tests for User Story 3 (Principle V in-scope) ⚠️

- [x] T040 [P] [SA] [US3] Write `src/lib/server/reconciliation/matching.spec.ts` covering: the direction filter as a hard filter (a money-out line never suggests an income); exact amount scoring 100 and a 1 %-relative near-match scoring 55; the `−2 × |days|` date penalty making a same-day candidate outrank a 6-day-old identical amount; candidates outside ±7 days excluded; the `+8` description-token bonus breaking ties; a **claimed** expense never appearing as a candidate (US3 AC6); and `findDuplicateLines` flagging same date + amount (within 0.005) + case/whitespace-normalised description within one session (FR-016) — research.md D-04

### Implementation for User Story 3

- [x] T041 [P] [SA] [US3] Implement `src/lib/server/reconciliation/matching.ts` — `rankCandidates(line, items) → RankedCandidate[]` and `findDuplicateLines(lines) → Set<number>`, with the window/score constants declared as commented module constants (not settings); make T040 pass
- [x] T042 [US3] Extend `src/lib/server/queries/reconciliation.ts` with `getCandidates(sessionId)` (in-scope bank-facing items, excluding anything cleared in an **earlier** session, including and marking items cleared in _this_ session) and the `reconciliation_item_state` upsert/delete helpers that maintain the row-lifecycle rule (a row carrying neither a `cleared_session_id` nor an `annotation` is deleted, not kept as a tombstone)
- [x] T043 [US3] Extend `src/lib/server/services/reconciliation.ts` with `acceptMatch`, `undoMatch`, and `setAnnotation` — `change` permission, `status === Open`, the four `409` rejections (claimed expense; cleared in an earlier session; annotated `WillNotClear`; already matched to a different line in this session), `cleared_amount` written as the item's current main-currency value (the FR-035 baseline), an amount mismatch explicitly **allowed**, audit on both the session and the item (`cleared: false → true`), and emits of `line-update` + `item-state-update` + the item's ledger emitter — for a claim, also its member expenses via the existing `emitLinkedExpenses` pattern in `services/claims.ts`
- [x] T044 [US3] Create `src/routes/api/reconciliation/[id]/lines/[lineId]/match/+server.ts` — `PUT` (accept, `200 { line, item }`) and `DELETE` (undo, `204`) per contracts/api.md
- [x] T045 [US3] Create `src/routes/api/reconciliation/[id]/annotations/+server.ts` — `PUT` setting or clearing a `LeftoverAnnotation` with an optional ≤500-char note, `409` when the item is cleared (FR-029)
- [x] T046 [P] [SA] [US3] Extend the projection in `src/lib/server/queries/expenses.ts` with a `LEFT JOIN reconciliation_item_state` yielding `cleared`, `clearedSessionId`, and — for an expense with a `claimId` — the parent claim's state as `clearedViaClaimId` (research.md D-10, FR-024)
- [x] T047 [P] [SA] [US3] Extend the projection in `src/lib/server/queries/claims.ts` with the same `LEFT JOIN` yielding `cleared` and `clearedSessionId`
- [x] T048 [P] [SA] [US3] Extend the projection in `src/lib/server/queries/income.ts` with the same `LEFT JOIN` yielding `cleared` and `clearedSessionId`
- [x] T049 [US3] Add `loadMatchWorkspace(locals, id)` to `src/lib/server/loaders/reconciliation.ts` — session + lines + candidates + per-line suggestions from `rankCandidates`, `view` to read, and a redirect to `/reconciliation/[id]` when the session has no statement lines yet
- [x] T050 [P] [SA] [US3] Create `src/lib/components/reconciliation/MatchPickerSheet.svelte` — ranked candidates plus a manual search over all eligible items, on the shared `Sheet` standard; each candidate row uses the list-of-many relation shape with the shared `related-link` class and a trailing `ChevronRight`
- [x] T051 [US3] Create `src/lib/components/reconciliation/MatchWorkspace.svelte` — the two-column workspace (statement lines | candidates) that collapses to a tabbed single column below the mobile breakpoint via `useIsMobile()`, per-line suggestion accept/reject, duplicate-line flags, leftover columns with counts and totals reconciling to the Step 1 difference (FR-027), annotation controls, SSE subscription with `mergeById` and no optimistic inserts, and all mutating controls disabled without `reconciliation.change`
- [x] T052 [US3] Create `src/routes/(app)/reconciliation/[id]/match/+page.svelte` and `+page.server.ts` (→ `loadMatchWorkspace`) — the recorded workspace-route exception to the Sheet standard (plan.md Complexity Tracking)
- [x] T053 [P] [SA] [US3] Add the client-side mirrors of `isBankFacing()` and `canMutateSession()` for the components that must disable controls, each carrying the required `// Mirrors src/lib/server/reconciliation/<file>.ts's <fn> — …` comment (CLAUDE.md gotcha; `ExpensesPage.svelte` is the reference)
- [x] T054 [P] [SA] [US3] Add the cleared control to the expense detail sheet in `src/lib/components/expenses/ExpensesPage.svelte` — a direct (unclaimed) expense gets its own cleared toggle (US3 AC5); a claimed expense gets a read-only "cleared via claim" badge that follows the single-record relation-card contract (icon box, subline, `related-link`, trailing `ChevronRight`, `goto` deep-link to the claim) and **no** checkbox of its own (FR-024, US3 AC4)
- [x] T055 [P] [SA] [US3] Add the reimbursement-level cleared control to the claim detail sheet in `src/lib/components/claims/ClaimsPage.svelte` (FR-025)
- [x] T056 [P] [SA] [US3] Add the cleared control to the income detail sheet in `src/lib/components/income/` (FR-023)

**Checkpoint**: the escalation path is complete — SC-002, SC-004, and SC-007 are verifiable.

---

## Phase 6: User Story 4 - Look back at past reconciliations (Priority: P4)

**Goal**: A readable history where the newest session is correctable and everything older is history.

**Independent Test**: Close a session that went to Step 2, navigate away, reopen it from history, and
confirm its lines and match outcomes are intact without re-uploading the statement.

### Tests for User Story 4 (Principle V in-scope) ⚠️

- [x] T057 [P] [SA] [US4] Write `src/lib/server/reconciliation/drift.spec.ts` covering: a cleared item whose current main-currency amount no longer equals `cleared_amount` reported under `changed`; a cleared item that no longer exists reported under `deleted`; an untouched session reporting neither; and the 0.005 epsilon applied so float noise is not reported as drift (FR-035)

### Implementation for User Story 4

- [x] T058 [P] [SA] [US4] Implement `src/lib/server/reconciliation/drift.ts` — `detectDrift(clearedRows, currentItems) → DriftReport`; make T057 pass
- [x] T059 [US4] Extend `src/lib/server/services/reconciliation.ts` with `reopenSession` and `deleteSession` — reopen allowed only when `canMutateSession(session, newestId)` and no other session is open (`409` otherwise), clearing `closed_at` and the count snapshots; delete restricted to the newest session, in one transaction un-clearing every item with `cleared_session_id = id` (nulling `cleared_line_id`/`cleared_amount`/`cleared_at`), clearing annotations made in this session, deleting its lines (FK cascade) and its `reconciliation/{id}/` directory, with one audit `update` per un-cleared item and a `session-deleted` + per-item ledger emit (FR-036, FR-037)
- [x] T060 [US4] Wire reopen into the existing `PATCH` and add `DELETE` to `src/routes/api/reconciliation/[id]/+server.ts` (`delete` permission, `409` when not the newest session, `204` on success), and surface `hasDrift`, `canReopen`, `canDelete` on `SessionSummary` from `session-rules.ts` + `drift.ts`
- [x] T061 [US4] Extend `ReconciliationPage.svelte`'s history list — reverse-id order, period, balances, `ClosedMatched` vs `ClosedWithLeftovers` distinguishable at a glance via `StatusBadge`, cleared/uncleared counts, and a drift banner on any session whose underlying data changed after closing (FR-031, FR-035, US4 AC2)
- [x] T062 [US4] Make a session older than the newest fully read-only in `SessionDetailSheet.svelte` and `MatchWorkspace.svelte` — no reopen, no delete, no match or annotation changes (US4 AC5), driven by the mirrored `canMutateSession` from T053

**Checkpoint**: all four stories independently functional. SC-006, SC-009, SC-010 verifiable.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T063 [P] [SA] Amend `CLAUDE.md` to record "workspace routes" as a named exception to the Drawer/Detail Sheet standard, alongside the deep-link pattern, citing `/reconciliation/[id]/match` (Constitution Principle VI requires the amendment in the same change as the deviation)
- [x] T064 [P] [SA] Add the `reconciliation` `StatusBadge` tones/labels to `StatusBadge.svelte`'s `byLabel`/`byCode` maps if T026 left any inline (audit for hand-rolled `<span class="statusbadge">` in the new components and replace them)
- [x] T065 Walk every new screen at a mobile viewport width: sheets `panelSide='bottom'` with square corners for full-height and rounded for partial-height, the match workspace collapsed to a tabbed single column (FR-038, Constitution Principle I)
- [x] T066 Confirm the four mutation obligations on all nine endpoints — `hasPermission` + `403`, Zod at the boundary, `recordAudit`, SSE emit — by re-reading each `+server.ts` against contracts/api.md's "Universal rules" table
- [x] T067 Verify no financial amount is logged by any new `pino` call (Constitution Technology Constraints)
- [x] T068 [P] Delete any test written during the build that no longer describes a real rule (Principle V)
- [ ] T069 Run the gates: `bun run check`, `bun run lint`, `bun run test` — all must pass
- [x] T070 Hand the user [quickstart.md](./quickstart.md) scenarios 1–10 for behavioural and visual confirmation (agents do not drive the running app — CLAUDE.md Verification Policy)

---

## Agent Delegation Plan

Independent tasks are batched into subagent waves; everything else stays in main context. **Never
run two tasks that write the same file in different agents.** The four contended files are
`src/lib/server/db/schema.ts`, `queries/reconciliation.ts`, `services/reconciliation.ts`, and
`loaders/reconciliation.ts` — all four are main-context only.

### Wave 0 — main context (serial)

T001 → T002 → T003 → T004, then T009 → T010 → T011 → T012 → T014.
`types.ts` (T009) is the contract every subagent codes against; it must be final before Wave 1.

### Wave 1 — 4 subagents, fully parallel (after T004)

| Agent | Tasks       | Files touched                                                 |
| ----- | ----------- | ------------------------------------------------------------- |
| SA-1  | T005        | `audit.ts`, audit route                                       |
| SA-2  | T006        | `db/client.ts`                                                |
| SA-3  | T007        | `users-groups/+page.svelte`                                   |
| SA-4  | T008 + T013 | `nav-config.ts`, `vite.config.ts`, `reconciliation/events.ts` |

### Wave 2 — 5 subagents, fully parallel (after T009). The highest-value delegation.

Each agent owns one pure module and its spec file, writes the test first, watches it fail, then
implements. No shared files, no ordering between them.

| Agent | Tasks       | Files owned                                                    |
| ----- | ----------- | -------------------------------------------------------------- |
| SA-A  | T015 + T017 | `reconciliation/balance.spec.ts`, `balance.ts`                 |
| SA-B  | T016 + T018 | `reconciliation/session-rules.spec.ts`, `session-rules.ts`     |
| SA-C  | T030 + T031 | `reconciliation/statement-parse.spec.ts`, `statement-parse.ts` |
| SA-D  | T040 + T041 | `reconciliation/matching.spec.ts`, `matching.ts`               |
| SA-E  | T057 + T058 | `reconciliation/drift.spec.ts`, `drift.ts`                     |

### Wave 3 — 3 subagents, parallel (after Wave 0; independent of Wave 2)

| Agent | Tasks | Files owned           |
| ----- | ----- | --------------------- |
| SA-F  | T046  | `queries/expenses.ts` |
| SA-G  | T047  | `queries/claims.ts`   |
| SA-H  | T048  | `queries/income.ts`   |

### Wave 4 — 4 subagents, parallel (after the sheet/props contract exists, i.e. after T024)

| Agent | Tasks | Files owned                 |
| ----- | ----- | --------------------------- |
| SA-I  | T025  | `StartSessionSheet.svelte`  |
| SA-J  | T038  | `StatementLineSheet.svelte` |
| SA-K  | T050  | `MatchPickerSheet.svelte`   |
| SA-L  | T026  | `SessionDetailSheet.svelte` |

Each agent gets the Drawer/Detail Sheet Standard section of `CLAUDE.md` and the component's exact
prop signature in its brief — the sheets must be indistinguishable from each other's chrome.

### Wave 5 — 3 subagents, parallel (after T043 and T053)

| Agent | Tasks | Files owned                               |
| ----- | ----- | ----------------------------------------- |
| SA-M  | T054  | `components/expenses/ExpensesPage.svelte` |
| SA-N  | T055  | `components/claims/ClaimsPage.svelte`     |
| SA-O  | T056  | `components/income/…`                     |

### Wave 6 — 2 subagents, parallel (Phase 7)

SA-P: T063 (`CLAUDE.md`). SA-Q: T064 + T068.

### Main context keeps

T001–T004, T009–T012, T014 (setup + moves), T019–T024, T027–T029 (query/service/route/loader/page
layer for US1), T032–T037, T039 (US2 orchestration and endpoints), T042–T045, T049, T051, T052
(US3 service, endpoints, workspace), T059–T062 (US4 lifecycle), T065–T067, T069, T070 (gates).

Rationale: these either write one of the four contended files, wire several files together, or need
judgement about how the layers compose — the work where a cold-start agent would re-derive context
you already hold.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — starts immediately
- **Foundational (Phase 2)**: depends on Phase 1 — **blocks every user story**
- **US1 (Phase 3)**: depends on Phase 2. No dependency on any other story
- **US2 (Phase 4)**: depends on Phase 2 + US1's session/query/service skeleton (T019, T020) — lines belong to a session
- **US3 (Phase 5)**: depends on Phase 2 + US2's statement lines (there is nothing to tick off without them)
- **US4 (Phase 6)**: depends on Phase 2 + US1. Its history view is richer once US3 exists, but reopen/delete/drift are independently testable against US1-only sessions
- **Polish (Phase 7)**: depends on every story that is being shipped

### Within Each User Story

- Pure-module tests (T015, T016, T030, T040, T057) MUST be written and MUST fail before their implementation (Principle V)
- `types.ts` → pure modules → queries → services → routes → loaders → components → page routes
- No `services/` file may import from `routes/` (Principle IV)

### Parallel Opportunities

- Phase 1: T005–T008 in parallel after T004
- Phase 2: T013 in parallel with T010–T012
- **All five pure modules (Wave 2) in parallel** — the largest single parallel block, and the only one
  that is genuinely test-first
- All three ledger-query joins (T046–T048) in parallel
- All four Sheet components (T025, T026, T038, T050) in parallel
- All three ledger detail-sheet cleared controls (T054–T056) in parallel

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1
2. **STOP and VALIDATE**: quickstart Scenario 1 — a full reconciliation in under 60 seconds with no
   upload, and Scenario 2's no-provider path already holds because nothing in US1 touches an LLM
3. Ship. SC-001 and SC-008 are met by the MVP alone.

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. - US1 → tie-out check works (MVP) → validate with quickstart Scenario 1
3. - US2 → statements become lines → validate Scenario 3 (including the negative: no ledger writes)
4. - US3 → the escalation path finds the missing transaction → validate Scenarios 4, 5, 6, 7
5. - US4 → history, reopen, delete, drift → validate Scenario 8
6. Polish → Scenarios 9 (permissions) and 10 (live updates, mobile)

### Parallel Strategy (subagents + main context)

1. Main context completes Wave 0 alone — schema, migration, permission union, `types.ts`, the
   extraction/LLM moves. Nothing is delegated until `types.ts` is frozen.
2. Dispatch Wave 1 (4 agents) and Wave 2 (5 agents) together — 9 concurrent agents, zero file overlap.
   Wave 2 returns five tested pure modules, which is the whole Principle V scope of this feature.
3. Main context builds the query → service → route → loader spine for US1 while Wave 3 (3 agents)
   adds the ledger joins.
4. Dispatch Wave 4 (4 agents) for the Sheets once the loader's data shapes are settled; main context
   assembles `ReconciliationPage.svelte` and the page routes around them.
5. Main context owns US2's orchestration and US3's workspace — the two places where the layers
   genuinely interlock — with Wave 5 handling the three ledger detail sheets in parallel.
6. Main context runs the gates (T069) and hands quickstart to the user (T070).

---

## Notes

- `[P]` = different files, no dependency on an incomplete task. `[SA]` = additionally safe to hand to
  a subagent with a self-contained brief.
- Every subagent brief must include: the task text, the relevant section of `data-model.md` or
  `contracts/api.md`, and — for components — the Drawer/Detail Sheet Standard from `CLAUDE.md`.
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
- Agents do not drive the running app. Verification is `bun run check` / `bun run lint` /
  `bun run test` plus static reading of the diff; behavioural and visual confirmation is the user's
  (CLAUDE.md Verification Policy, Constitution Development Workflow).

---

## Phase 8: Record-First Allocation Redesign

- [x] T071 Write pure allocation tests for exact single-line and deterministic exact multi-line suggestions, with integer-cent arithmetic and no near-total suggestion
- [x] T072 Implement record-first exact-total statement-line suggestions and make T071 pass
- [x] T073 Add query/service support to atomically replace one bank-facing record's continuous allocations while preserving allocations belonging to other records
- [x] T074 Add the Zod-validated record allocation API with reconciliation RBAC, audit, and SSE obligations
- [x] T075 Reshape the reconciliation loader around income, claims, and direct-paid unclaimed expenses, allocations, optional record-date filters, and every compatible remaining line
- [x] T076 Replace the statement-line-first workspace with Needs Review, Matched, and Statement Leftovers record-first views, including responsive accessible multi-line allocation editing
- [x] T077 Remove session, annotation, close/reopen, manual-line, and line-oriented match endpoints after migrating the workspace
- [x] T078 Run Svelte, lint, unit-test, and diff gates and verify the record-first acceptance scenarios
