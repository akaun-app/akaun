# Implementation Plan: Bank Reconciliation

**Branch**: `001-bank-reconciliation` | **Date**: 2026-08-10 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-bank-reconciliation/spec.md`

## Summary

Add a Reconciliation module that checks Akaun's ledger against a bank statement without changing the
cash-basis single-entry model. A **reconciliation session** records a starting balance, a period end
date, and the statement's ending balance; Step 1 computes
`starting + uncleared bank-facing income − uncleared bank-facing expenses and claims` (everything
still uncleared and dated on or before the period end) and reports match or difference. On a
mismatch the user escalates to Step 2: a bank statement is uploaded, turned into many **statement
lines** by the existing PDF/OCR extraction plus an LLM pass, and each line is ticked off against a
suggested Akaun item. Leftovers on each side are the diagnosis.

Technical approach:

- **Three new tables** — `reconciliation_sessions`, `bank_statement_lines`, and
  `reconciliation_item_state`. Cleared state and leftover annotations live in the reconciliation-owned
  `reconciliation_item_state` table keyed polymorphically by `(itemType, itemId)`, mirroring the
  existing `audit_log` shape. No column is added to `expenses`, `incomes`, or `claims`, and no
  payment-method field is introduced — "bank-facing" is derived from `expenses.claim_id IS NULL`.
- **Extraction is reused as a library, not as a pipeline.** `import/extractor.ts` and the LLM
  model/retry/throttle helpers move down to shared `$lib/server/extraction/` and `$lib/server/llm/`
  modules. Reconciliation owns its own multi-line prompt and Zod schema and writes only to
  `bank_statement_lines` — never to `import_queue`, `expenses`, or `incomes`.
- **Financial and rule logic is pure and tested first**: balance computation, match ranking,
  duplicate-line detection, session chain rules (one open, newest-only mutable), and post-close drift
  detection are pure functions over already-fetched rows, developed red-green per Constitution
  Principle V. Routes parse + authorize + delegate; the service layer owns permission-checked writes
  with audit + SSE.
- **UI**: `/reconciliation` (module home: open session + history), `/reconciliation/[id]` (session
  detail Sheet, deep-linked via shallow routing), `/reconciliation/[id]/match` (the Step 2 two-column
  workspace, full route because it is a workspace rather than a record detail).

## Technical Context

**Language/Version**: TypeScript (strict) on Bun; Svelte 5 (runes mode forced project-wide)

**Primary Dependencies**: SvelteKit 2, Drizzle ORM 0.45 (`bun:sqlite` driver), Zod 4, bits-ui 2,
Tailwind 4, `unpdf` + `tesseract.js` + `pngjs` (document text extraction, reused), Vercel `ai` SDK 7
with `@ai-sdk/openai` / `@ai-sdk/google` / `@ai-sdk/groq` (statement parsing, optional), `pino`

**Storage**: single SQLite file via Drizzle; three new tables added by one committed
`drizzle-kit generate` migration. Uploaded statement files stored on disk under
`reconciliation/{sessionId}/` through the existing `file-storage.ts` helpers.

**Testing**: Vitest — `server` project (node env, `*.spec.ts`) for the pure rule/calculation modules;
`client` project (headless Chromium, `*.svelte.spec.ts`) not used by this feature. Tests assert on
pure functions taking plain rows, so no test database or DB mocking is needed (see research.md D-09).

**Target Platform**: one SvelteKit app served to browser, installable PWA, Tauri desktop sidecar, and
mobile web — no surface-specific code paths.

**Project Type**: single full-stack web application (`src/routes` + `src/lib` + `src/lib/server`)

**Performance Goals**: Step 1 balance computation is three indexed aggregate queries over uncleared
rows — target < 50 ms on a ledger of ~50k records. Statement extraction (PDF text or OCR + one LLM
call) runs asynchronously in-process; the upload request returns `202` immediately and progress is
reported over SSE.

**Constraints**: must remain fully usable with **no** LLM provider configured (manual statement-line
entry completes the whole flow, FR-014); no new datastore, broker, or worker service; every screen
usable at mobile viewport widths; financial amounts never logged.

**Scale/Scope**: single self-hosted user/team, one bank account, statements of ~20–200 transactions;
3 tables, 5 enum groups, ~9 API endpoints, 3 routes, 6 new Svelte components.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Principle | Status | Check |
|------|-----------|--------|-------|
| Single codebase | I | **PASS** | No surface-specific fork. Match workspace collapses to a tabbed single column below the mobile breakpoint via the existing `useIsMobile()` hook; sheets use `panelSide = isMobile ? 'bottom' : 'right'` (FR-038). |
| Lightweight | II | **PASS** | No new datastore, broker, or worker service — statement extraction runs in-process and is fire-and-forget with SSE progress, not a queue table. LLM parsing is optional and degrades to manual line entry (FR-014, SC-008). No new runtime dependency: `unpdf`/`tesseract.js`/`ai` are already installed. |
| YAGNI | III | **PASS** | No multi-account entity, no payment-method field, no statement-line→expense creation, no recurring-transaction detection — all explicitly out of scope and left as commented extension points. Logic placed by layer: `routes/` → `services/reconciliation.ts` → `queries/reconciliation.ts` → `db/`. The one deliberate "structure for what's next" call is persisting statement lines (spec's locked decision). |
| SOLID boundaries | IV | **PASS** | Routes parse + `hasPermission` + delegate. Business rules in `lib/server/services/reconciliation.ts`; pure rules in `lib/server/reconciliation/*.ts`; queries in `lib/server/queries/reconciliation.ts`. No `services/` → `routes/` import. Shared extraction/LLM helpers move **down** into `$lib/server/extraction` and `$lib/server/llm` rather than being imported sideways from `import/` (D-02). All request bodies, form data, and LLM output validated with Zod at the boundary. |
| Mutation obligations | IV | **PASS** | Every mutating endpoint in `contracts/api.md` is specified with its `hasPermission` resource+action (403 on fail), Zod schema, `recordAudit` call, and `reconciliationEvents` emit — plus a ledger-side emit (`expenseEvents`/`claimEvents`/`incomeEvents`) whenever an item's cleared state changes. |
| TDD scope | V | **PASS** | In-scope, planned test-first: `balance.ts` (FR-002 – FR-005), `matching.ts` (FR-018, FR-016), `session-rules.ts` (FR-008, FR-010, FR-036, FR-037), `drift.ts` (FR-035), `statement-parse.ts` (LLM output normalization). Out of scope by the constitution's own carve-out: Svelte components, route wiring, schema/migrations. No coverage target introduced. |
| Established patterns | VI | **PASS** (1 recorded deviation) | SSE via a new `reconciliationEvents` emitter, no polling; session detail and all create/edit drawers use the shared `Sheet` standard; `/reconciliation/[id]` deep-links via shallow routing with one shared page component + one shared loader; the linked-item card on a statement line and the linked-claim badge on a cleared expense use the `related-link` contract. **Deviation**: the Step 2 match workspace is a full route, not a Sheet — recorded in Complexity Tracking with the `CLAUDE.md` amendment that accompanies it. |
| Fixed stack | Tech Constraints | **PASS** | Svelte 5 runes, Drizzle + SQLite only, schema change via `drizzle-kit generate` with the migration committed. All new server code under `$lib/server/**`; the client-side copy of `isBankFacing`/`canMutateSession` carries the required `// Mirrors …` comment. |

**Post-Phase-1 re-check**: re-evaluated after `data-model.md` and `contracts/` were written — all gates
hold. Two design choices were tightened by the re-check: (1) the statement line has no stored
`cleared` column (derived from `matchedItemType`) so two fields can never disagree, and (2)
`reconciliation_item_state` FKs use `set null` rather than `cascade`, so deleting a session unclears
its items without destroying their leftover annotations (FR-037 vs FR-029).

## Project Structure

### Documentation (this feature)

```text
specs/001-bank-reconciliation/
├── plan.md              # This file
├── research.md          # Phase 0 output — 12 decisions
├── data-model.md        # Phase 1 output — 3 tables, 5 enums, derivation rules
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/
│   ├── api.md           # HTTP endpoints, Zod shapes, status codes, mutation obligations
│   └── events.md        # SSE stream contract
├── checklists/
│   └── requirements.md  # Existing spec-quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/lib/
├── enums.ts                                   # + ReconItemType, ReconSessionStatus,
│                                              #   StatementDirection, LeftoverAnnotation,
│                                              #   StatementExtractionState (+ label maps)
├── nav-config.ts                              # + Reconciliation nav item (resource: 'reconciliation')
├── components/reconciliation/
│   ├── ReconciliationPage.svelte              # shared module home (open session + history list)
│   ├── StartSessionSheet.svelte               # create form (Sheet standard)
│   ├── SessionDetailSheet.svelte              # Step 1 result, close/reopen/delete (Sheet standard)
│   ├── MatchWorkspace.svelte                  # Step 2 two-column workspace (full route)
│   ├── StatementLineSheet.svelte              # add/edit a statement line (Sheet standard)
│   └── MatchPickerSheet.svelte                # ranked candidates + manual search (Sheet standard)
└── server/
    ├── extraction/
    │   └── document-text.ts                   # MOVED from import/extractor.ts (shared utility)
    ├── llm/
    │   ├── model-factory.ts                   # MOVED from import/providers/index.ts (createModel)
    │   ├── retry.ts                           # MOVED from import/providers/index.ts (withRetry)
    │   └── rate-limiter.ts                    # MOVED from import/rate-limiter.ts
    ├── reconciliation/
    │   ├── events.ts                          # reconciliationEvents EventEmitter
    │   ├── balance.ts                         # PURE — Step 1 arithmetic          [test-first]
    │   ├── matching.ts                        # PURE — ranking + duplicate lines   [test-first]
    │   ├── session-rules.ts                   # PURE — chain/open/mutability rules [test-first]
    │   ├── drift.ts                           # PURE — post-close drift detection  [test-first]
    │   ├── statement-parse.ts                 # PURE — Zod schema + row filtering  [test-first]
    │   ├── statement-llm.ts                   # provider call for statement lines
    │   └── statement-import.ts                # orchestration: file → text → lines
    ├── queries/reconciliation.ts              # all Drizzle reads/writes for the 3 tables
    ├── services/reconciliation.ts             # permission-checked writes + audit + SSE emits
    ├── loaders/reconciliation.ts              # shared SvelteKit load + form actions
    ├── permissions.ts                         # + 'reconciliation' in ResourceName / ALL_RESOURCES
    ├── audit.ts                               # + 'reconciliation' in RecordType
    ├── db/schema.ts                           # + 3 tables
    ├── queries/{expenses,claims,income}.ts    # + left join exposing cleared state
    └── import/{extractor,rate-limiter}.ts     # DELETED — callers repointed to the shared modules

src/routes/
├── (app)/reconciliation/
│   ├── +page.svelte            # openSessionId={null}
│   ├── +page.server.ts         # → loadReconciliationPage
│   ├── [id]/
│   │   ├── +page.svelte        # openSessionId={data.openSessionId}
│   │   ├── +page.server.ts     # → loadReconciliationPage
│   │   └── match/
│   │       ├── +page.svelte    # MatchWorkspace
│   │       └── +page.server.ts # → loadMatchWorkspace
└── api/reconciliation/
    ├── +server.ts                          # GET list, POST create session
    ├── [id]/+server.ts                     # GET, PATCH (edit/close/reopen), DELETE
    ├── [id]/statement/+server.ts           # POST upload (202 + SSE progress)
    ├── [id]/lines/+server.ts               # GET, POST (manual line)
    ├── [id]/lines/[lineId]/+server.ts      # PATCH, DELETE
    ├── [id]/lines/[lineId]/match/+server.ts# PUT (accept match), DELETE (undo)
    ├── [id]/annotations/+server.ts         # PUT (set/clear a leftover annotation)
    └── stream/+server.ts                   # SSE

drizzle/
└── 0009_*.sql                              # generated migration (3 tables + indexes)

src/routes/(app)/users-groups/+page.svelte  # + { id: 'reconciliation', label: 'Reconciliation' }
src/lib/server/db/client.ts                 # + reconciliation perms in SEED_GROUPS
CLAUDE.md                                   # + workspace-route exception to the Sheet standard
```

**Structure Decision**: Single SvelteKit project, extended in place. The feature follows the app's
existing four-layer server split (`routes/` → `services/` → `queries/` → `db/`) with an extra
`lib/server/reconciliation/` directory holding the pure rule modules that the service composes — the
same shape `lib/server/import/` already uses, and what makes the Principle V test-first scope
reachable without a database. Two shared-utility directories (`lib/server/extraction/`,
`lib/server/llm/`) are created by moving existing code down out of `lib/server/import/` so
reconciliation depends on shared modules rather than sideways on another feature (Principle IV).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Step 2 match workspace is a full route (`/reconciliation/[id]/match`) instead of the `CLAUDE.md` Sheet standard | The workspace is a side-by-side working surface — statement lines against candidate Akaun items, worked through in a single pass (FR-018 – FR-027). Its content is a two-column list, not a record's fields. | A 500 px Sheet cannot show two parallel lists on desktop; forcing it there would make the primary escalation path unusable exactly where it matters. The Sheet standard is preserved for everything that *is* a record detail (session detail, statement-line add/edit, match picker), so the drawer chrome stays uniform. `CLAUDE.md` is amended in the same change to record "workspace routes" as a named exception alongside the deep-link pattern. |
| `reconciliation_item_state` references expenses/claims/incomes polymorphically (`item_type`, `item_id`) with no foreign key | One table covers all three clearable kinds, and the row must **survive** deletion of the record it points at — that survival is exactly what makes FR-035 (a closed session whose underlying data changed) detectable. | Three nullable FK columns with a one-of check would need `on delete cascade` (which erases the evidence FR-035 depends on) or `restrict` (which would block deleting a ledger record entirely). The existing `audit_log` table already uses the same `(record_type, record_id)` shape for the same reason, so this is the established precedent, not a new one. |
