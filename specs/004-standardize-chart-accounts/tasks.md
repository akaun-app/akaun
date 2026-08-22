# Tasks: Standardized Chart of Accounts

**Input**: Design documents from `/specs/004-standardize-chart-accounts/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

**Tests**: Included before implementation for pure accounting rules, multi-step services, reports,
reconciliation rules, and conversion invariants as required by Constitution Principle V. UI wiring,
thin routes, schema declarations, and generated migrations do not receive ceremonial tests.

**Organization**: Tasks are grouped by user story. The delegation sections define safe sub-agent
work packages; `[P]` means the task can run concurrently because it owns different files and has no
dependency on unfinished work.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the feature vocabulary and operator entry point without changing behavior.

- [x] T001 Add chart-conversion script entry and test commands to `package.json`
- [x] T002 [P] Define the five fixed account types, Revenue label, ranges, and default-purpose types in `src/lib/enums.ts`
- [x] T003 [P] Add shared account/default API view and input types in `src/lib/components/accounts/account-types.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the schema and reusable invariants required by every user story.

**Critical gate**: No user-story implementation starts until T004–T015 are complete and integrated.

### Tests for foundational rules

- [x] T004 [P] Add failing tests for fixed types, normal balances, report placement, and role-to-type conversion in `src/lib/server/ledger/account-type.spec.ts`
- [x] T005 [P] Add failing tests for transactional lowest-free code allocation and range exhaustion in `src/lib/server/ledger/account-code.spec.ts`
- [x] T006 [P] Add failing tests for active-leaf posting eligibility and dependency checks in `src/lib/server/ledger/account-eligibility.spec.ts`

### Foundational implementation

- [x] T007 Implement fixed-type rules and legacy role conversion in `src/lib/server/ledger/account-type.ts`
- [x] T008 Implement type-bounded lowest-free code allocation helpers in `src/lib/server/ledger/account-code.ts`
- [x] T009 Implement common posting-eligibility and protected-lifecycle checks in `src/lib/server/ledger/account-eligibility.ts`
- [x] T010 Extend accounts and add account defaults, migration runs, and merge audits in `src/lib/server/db/schema.ts`
- [x] T011 Generate and review the Drizzle schema migration in `drizzle/0016_standardize_chart_accounts.sql`
- [x] T012 Update the default chart seeds and initial compatible defaults in `src/lib/server/db/seed-accounts.ts`
- [x] T013 Update account query views, canonical merged-ID lookup, paths, child state, and direct/rolled-up balances in `src/lib/server/queries/accounts.ts`
- [x] T014 Update the shared accounts loader to return the new role-free account contract in `src/lib/server/loaders/accounts.ts`
- [x] T015 Run the foundational tests and schema checks configured in `package.json` with `bun run test` and `bun run check`

**Checkpoint**: Fixed types, codes, persistence, canonical account reads, and posting eligibility are stable.

---

## Phase 3: User Story 1 — Build a chart for the actual business (Priority: P1) 🎯 MVP

**Goal**: Administrators manage any account under one of five immutable types on one searchable page.

**Independent Test**: Create one posting account per type without entering a code, search by partial
name/code, change the type of an unused account, and confirm the five sections, paths, codes, and
plain refusals match the specification.

### Tests for User Story 1

- [x] T016 [US1] Add failing service tests for create, edit, type change, archive, delete, code collision, and canonical redirects in `src/lib/server/services/accounts.spec.ts`

### Implementation for User Story 1

- [x] T017 [US1] Replace role-based account CRUD with transactional type/code/lifecycle rules in `src/lib/server/services/accounts.ts`
- [x] T018 [US1] Update list/create and detail/update/delete endpoints with strict Zod, permissions, audit, and SSE in `src/routes/api/accounts/+server.ts` and `src/routes/api/accounts/[id]/+server.ts`
- [x] T019 [P] [US1] Implement the common active-leaf account picker contract in `src/lib/components/accounts/AccountSelect.svelte`
- [x] T020 [US1] Build the searchable five-section account tree in `src/lib/components/accounts/AccountsPage.svelte`
- [x] T021 [US1] Update account create/edit/detail Sheet fields and protected-action errors in `src/lib/components/accounts/AccountSheet.svelte`
- [x] T022 [US1] Update account page loaders and shallow deep-link routing in `src/routes/(app)/accounts/+page.server.ts`, `src/routes/(app)/accounts/+page.svelte`, and `src/routes/(app)/accounts/[id]/+page.server.ts`
- [x] T023 [US1] Emit `account-update`, `account-deleted`, and hierarchy refresh events according to `specs/004-standardize-chart-accounts/contracts/events.md` from `src/lib/server/ledger/events.ts`

**Checkpoint**: US1 is independently usable as the first visible MVP increment.

---

## Phase 4: User Story 2 — Organize accounts without changing the books (Priority: P1)

**Goal**: Same-type parent headings organize leaf accounts and roll up balances exactly once.

**Independent Test**: Create a parent with two posting children, post to both, verify the subtotal,
and verify cross-type parenting, cycles, parent posting, and adding children to used accounts fail.

### Tests for User Story 2

- [x] T024 [P] [US2] Add failing hierarchy tests for same-type ancestry, cycles, moves, and movement/default/statement constraints in `src/lib/server/ledger/account-hierarchy.spec.ts`
- [x] T025 [P] [US2] Add failing query tests for ancestor-aware search and non-double-counted rollups in `src/lib/server/queries/accounts.spec.ts`

### Implementation for User Story 2

- [x] T026 [US2] Implement ancestry validation, cycle detection, descendant traversal, and parent eligibility in `src/lib/server/ledger/account-hierarchy.ts`
- [x] T027 [US2] Integrate hierarchy transitions and descendant archive rules into `src/lib/server/services/accounts.ts`
- [x] T028 [P] [US2] Exclude parent/inactive accounts and show hierarchy paths in existing record pickers in `src/lib/components/ledger/AccountSelect.svelte`
- [x] T029 [US2] Render nested rows, direct balances, and descendant subtotals without double counting in `src/lib/components/accounts/AccountsPage.svelte`

**Checkpoint**: US2 hierarchy can be tested without automatic bookkeeping, reports, or migration.

---

## Phase 5: User Story 3 — Keep automatic bookkeeping predictable (Priority: P1)

**Goal**: Six validated saved accounts replace role/name lookup in every automatic record creator.

**Independent Test**: Save all six compatible defaults, issue an invoice, add an opening balance,
and confirm an imported expense; then invalidate each prerequisite and verify no partial record is made.

### Tests for User Story 3

- [x] T030 [P] [US3] Add failing atomic validation/use tests for all six defaults in `src/lib/server/services/account-defaults.spec.ts`
- [x] T031 [P] [US3] Add failing tests for default-driven invoice and opening-balance entries in `src/lib/server/services/invoices.spec.ts` and `src/lib/server/ledger/entry-builder.spec.ts`
- [x] T032 [P] [US3] Add failing tests for default-driven import categories and receivable/payable settlement classification in `src/lib/server/import/category-accounts.spec.ts` and `src/lib/server/ledger/settlement-rules.spec.ts`

### Implementation for User Story 3

- [x] T033 [US3] Implement atomic get/replace/use validation for the six saved defaults in `src/lib/server/services/account-defaults.ts`
- [x] T034 [US3] Add strict authenticated GET/PUT defaults endpoints with audit and account refresh in `src/routes/api/settings/account-defaults/+server.ts`
- [x] T035 [US3] Replace role/name lookup with saved default IDs in `src/lib/server/services/invoices.ts`, `src/routes/api/accounts/[id]/opening-balance/+server.ts`, and `src/lib/server/import/category-accounts.ts`
- [x] T036 [US3] Replace receivable/payable role checks while preserving contacts and amounts in `src/lib/server/ledger/settlement-rules.ts`, `src/lib/server/services/settlements.ts`, and `src/lib/server/queries/settlements.ts`
- [x] T037 [P] [US3] Build the six-purpose settings editor in `src/lib/components/settings/AccountDefaults.svelte`
- [x] T038 [US3] Load and display the defaults editor on `src/routes/(app)/settings/+page.server.ts` and `src/routes/(app)/settings/+page.svelte`

**Checkpoint**: US3 automatic writes are balanced, explicit, and refuse missing or invalid settings.

---

## Phase 6: User Story 6 — Move existing books safely (Priority: P1, Release Gate)

**Goal**: Convert the verified migration-0005 production shape through double-entry and chart
standardization atomically, preserve every reference/value, and make retries a no-op.

**Independent Test**: Run dry-run, conversion, and retry on a disposable WAL-consistent production
copy; verify legacy reachability counts, exact snapshots, balanced records, redirects, FK integrity,
audits, attention items, and zero retry mutations.

### Tests for User Story 6

- [x] T039 [P] [US6] Add failing tests for deterministic role mapping, seeded matching, conflicts, skips, and direct redirects in `src/lib/server/services/account-migration.spec.ts`
- [x] T040 [P] [US6] Add failing migration-0005 fixture tests for 201 records, claims, attachments, incomplete imports, balance/report snapshots, rollback, and no-op retry in `scripts/migrate-chart-of-accounts.spec.ts`
- [x] T041 [P] [US6] Add failing schema-discovery tests proving every account foreign key is classified and repointed or deliberately retained in `src/lib/server/services/account-reference-map.spec.ts`

### Implementation for User Story 6

- [x] T042 [US6] Recover and isolate the legacy-0005-to-ledger conversion from repository history in `src/lib/server/services/legacy-ledger-migration.ts`
- [x] T043 [US6] Implement exhaustive schema-verified account reference discovery and atomic repointing in `src/lib/server/services/account-reference-map.ts`
- [x] T044 [US6] Implement chart mapping, stable code assignment, gap seeding, defaults, exact-match merges, audits, redirects, and invariant snapshots in `src/lib/server/services/account-migration.ts`
- [x] T045 [US6] Compose legacy conversion and chart standardization with dry-run, JSON output, transaction rollback, input-state refusal, and completed-version verification in `scripts/migrate-chart-of-accounts.ts`
- [x] T046 [US6] Integrate completion state with the legacy table drop guard in `src/lib/server/db/legacy-drop-guard.ts`
- [x] T047 [US6] Run the command twice against a disposable WAL-consistent production copy and record invariant evidence in `specs/004-standardize-chart-accounts/quickstart.md`

**Checkpoint**: The production upgrade path is proven before any release or legacy-table drop.

---

## Phase 7: User Story 4 — Reconcile any posting account (Priority: P2)

**Goal**: Statements and matching work for every active posting account, regardless of fixed type.

**Independent Test**: Upload a statement for a leaf in each type, verify only that account's
movements are offered, verify parents are refused, and verify hierarchy moves preserve matches.

### Tests for User Story 4

- [x] T048 [US4] Add failing service/query tests for any-type leaf reconciliation, account-scoped suggestions, and parent refusal in `src/lib/server/services/reconciliation.spec.ts` and `src/lib/server/reconciliation/suggestions.spec.ts`

### Implementation for User Story 4

- [x] T049 [US4] Replace money-pot role guards with posting eligibility in `src/lib/server/services/reconciliation.ts` and `src/lib/server/queries/reconciliation.ts`
- [x] T050 [US4] Update account statement creation endpoints and account reconciliation loaders to accept any active leaf in `src/routes/api/accounts/[id]/reconciliation/statements/+server.ts` and `src/lib/server/loaders/reconciliation.ts`
- [x] T051 [US4] Show reconciliation actions only for eligible leaves while preserving statement URLs in `src/lib/components/reconciliation/AccountStatements.svelte` and `src/routes/(app)/accounts/[id]/reconcile/+page.svelte`

**Checkpoint**: US4 works for all five types without changing ledger amounts.

---

## Phase 8: User Story 5 — Reports follow the five fixed types (Priority: P2)

**Goal**: Every financial surface classifies by fixed type and rolls hierarchy without double counting.

**Independent Test**: Post balanced records through custom accounts in all five types and verify
Balance Sheet, Income Statement, accumulated result, transfers, dashboard figures, and exports agree.

### Tests for User Story 5

- [x] T052 [P] [US5] Add failing Balance Sheet tests for direct types, normal signs, hierarchy subtotals, and accumulated result in `src/lib/server/ledger/reports/balance-sheet.spec.ts`
- [x] T053 [P] [US5] Add failing Income Statement tests for Revenue/Expense, transfers, hierarchy subtotals, and net profit in `src/lib/server/ledger/reports/profit-loss.spec.ts`
- [x] T054 [P] [US5] Add failing partner-statement tests for contact-scoped Equity movements by direction in `src/lib/server/ledger/reports/partner-statement.spec.ts`

### Implementation for User Story 5

- [x] T055 [US5] Refactor Balance Sheet and Income Statement calculations to fixed types and leaf-once hierarchy totals in `src/lib/server/ledger/reports/balance-sheet.ts` and `src/lib/server/ledger/reports/profit-loss.ts`
- [x] T056 [US5] Refactor partner statements to contact-scoped Equity movement direction in `src/lib/server/ledger/reports/partner-statement.ts`
- [x] T057 [US5] Align report, dashboard, account balance, and CSV query classification in `src/lib/server/queries/reports.ts`, `src/lib/server/queries/dashboard.ts`, and `src/lib/server/ledger/reports/csv.ts`
- [x] T058 [US5] Update report labels and hierarchical rows in `src/lib/components/reports/BalanceSheetReport.svelte`, `src/lib/components/reports/ProfitLossReport.svelte`, and `src/lib/components/reports/PartnerStatementReport.svelte`

**Checkpoint**: US5 reports and operational figures share one type/hierarchy interpretation.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Remove retired role/category surfaces and perform full release validation.

- [x] T059 [P] Remove the Categories destination and role-based navigation from `src/lib/nav-config.ts` and `src/routes/(app)/categories/`
- [x] T060 [P] Remove retired role UI and replace remaining role labels/usages in `src/lib/components/accounts/CategoriesPage.svelte`, `src/lib/components/accounts/account-roles.ts`, and `src/lib/components/`
- [x] T061 Search for and remove remaining account-role/name lookups while preserving unrelated contact roles across `src/`
- [x] T062 Verify account events use SSE only and all mutations retain permission, strict Zod, audit, and post-commit emission across `src/routes/api/accounts/` and `src/routes/api/settings/account-defaults/`
- [x] T063 Run all automated gates configured in `package.json` with `bun run test`, `bun run check`, and `bun run build`
- [x] T064 Execute every fresh-install, hierarchy, automatic-record, report, reconciliation, conversion, and retry scenario in `specs/004-standardize-chart-accounts/quickstart.md`

---

## Dependencies & Execution Order

### Phase dependencies

- Phase 1 starts immediately.
- Phase 2 depends on Phase 1 and blocks every story.
- US1 depends on Phase 2; US2 depends on US1's service/query contract.
- US3 depends on Phase 2 and may run beside US1/US2 if it does not edit their owned files.
- US6 depends on Phase 2 and the settled account/default service contracts; it is a release gate.
- US4 depends on posting eligibility from Phase 2, but not on US5.
- US5 depends on fixed types and hierarchy queries from Phases 2 and 4.
- Phase 9 depends on every story selected for release; T063–T064 run last.

### Story completion order

```text
Setup → Foundation → ┬→ US1 → US2 ───────────────┐
                     ├→ US3 ─────────────────────┤
                     ├→ US6 (release gate) ──────┤→ Polish → Full validation
                     └→ US4 → US5 ───────────────┘
```

### Within each story

- Write each in-scope test task first and confirm it fails for the intended reason.
- Complete pure rules before services, services/queries before routes, and routes before UI wiring.
- A task that edits a file already owned by another active task is not parallel even if marked `[P]`
  elsewhere; reassign it to the file owner or wait for that task to merge.
- Commit after each task or tightly coupled test/implementation pair so another agent can rebase safely.

---

## Sub-Agent Delegation Plan

Use one coordinator plus at most three implementation sub-agents. The coordinator owns integration,
schema sequencing, task status, and final gates; sub-agents receive bounded task-ID ranges and exact
file ownership. Agents must report changed files, tests run, and unresolved assumptions before handoff.

### Wave 1 — Shared foundation (sequential integration)

- **Coordinator**: T001, T010–T015. Own `package.json`, `src/lib/server/db/schema.ts`, `drizzle/`,
  seeds, shared queries/loaders, and the integration gate.
- **Sub-agent A — type/code rules**: T002, T004–T005, T007–T008. Own `src/lib/enums.ts` and
  `src/lib/server/ledger/account-{type,code}*`.
- **Sub-agent B — eligibility contract**: T003, T006, T009. Own account view types and
  `src/lib/server/ledger/account-eligibility*`.
- **Sub-agent C — schema review/tests**: read-only review of T010–T014 artifacts, then independently
  verify test gaps and migration consistency; it must not edit coordinator-owned files in this wave.

Integrate A and B before T010–T14, then pass T015 before Wave 2.

### Wave 2 — Independent feature lanes

- **Sub-agent A — chart/hierarchy lane**: T016–T029 (US1 and US2). Own account CRUD, hierarchy,
  account API/routes, `AccountsPage`, `AccountSheet`, and account picker files.
- **Sub-agent B — defaults/automatic bookkeeping lane**: T030–T038 (US3). Own defaults service/API/UI,
  invoices, opening balances, imports, and settlement files named in those tasks.
- **Sub-agent C — conversion lane**: T039–T047 (US6). Own migration/reference services, command,
  guard tests, and conversion evidence. It may inspect but not alter A/B-owned files; request contract
  changes through the coordinator.
- **Coordinator**: Resolve shared-file collisions (especially `accounts.ts`, `entry-builder.spec.ts`,
  and schema assumptions), integrate each lane, and rerun targeted tests after every merge.

US6 begins only after coordinator publishes the settled schema/account/default contract. US1/US2 and
US3 may otherwise proceed concurrently because their primary file ownership is disjoint.

### Wave 3 — P2 surfaces and cleanup

- **Sub-agent A — reconciliation**: T048–T051 (US4).
- **Sub-agent B — reporting**: T052–T058 (US5).
- **Sub-agent C — retirement scan**: T059–T061, beginning with a read-only role-usage inventory and
  deleting category routes only after A/B confirm no dependency remains.
- **Coordinator**: T062–T064 and final conflict resolution. No sub-agent runs broad auto-formatting
  over files owned by another lane.

### Required handoff format

Each sub-agent returns: completed task IDs; changed file paths; failing test observed before the fix;
commands/results after the fix; migration or API contract deviations; and tasks still blocked. The
coordinator updates checkboxes only after reviewing the diff and reproducing the relevant gate.

---

## Parallel Execution Examples

### Foundation

```text
Sub-agent A: T002 + T004 + T005 + T007 + T008 (type/code files)
Sub-agent B: T003 + T006 + T009 (view/eligibility files)
Coordinator: prepare T010 schema integration after both contracts land
```

### P1 stories after the foundation gate

```text
Sub-agent A: T016–T029 (US1/US2 chart and hierarchy)
Sub-agent B: T030–T038 (US3 defaults and automatic records)
Sub-agent C: T039–T047 (US6 conversion, after schema contract publication)
```

### P2 stories after P1 integration

```text
Sub-agent A: T048–T051 (US4 reconciliation)
Sub-agent B: T052–T058 (US5 reports)
Sub-agent C: T059–T061 (role/category retirement inventory and cleanup)
```

---

## Implementation Strategy

### MVP first

1. Complete Setup and Foundation.
2. Complete US1, then US2 so a safe, hierarchical chart is usable.
3. Validate their independent tests before broadening automatic behavior.

US1 alone is the smallest visible MVP; US1 + US2 is the smallest coherent chart-management release.
Production deployment still requires US3 and the US6 conversion release gate.

### Incremental delivery

1. Fixed types/codes/schema foundation.
2. Unified chart and safe hierarchy (US1 + US2).
3. Saved defaults and automatic creators (US3).
4. Proven production conversion and retry (US6 release gate).
5. Any-account reconciliation (US4).
6. Type/hierarchy-driven reports (US5).
7. Retired-surface cleanup and full quickstart validation.

## Phase: Self-running conversion (FR-070a, FR-061a–c, FR-070b)

The conversion shipped as `bun run chart:migrate`, which 002 FR-037 forbids: a command is a manual
step. It also left a silent middle state — a book converted to double-entry but never standardized
started with every type and code null and no saved defaults.

- [x] T065 Move the staged pipeline out of `scripts/` into `src/lib/server/db/auto-upgrade.ts`, exporting `upgradeDatabaseFile` and `classifyDatabaseFile` (own read-only connection); read the migration files lazily
- [x] T066 Run it from `createDb()` in `src/lib/server/db/client.ts` before the database is opened for writing, exiting non-zero on failure; keep `legacyDropAllowed` as the second gate
- [x] T067 Delete `scripts/migrate-chart-of-accounts.ts` and the `chart:migrate` script; move its spec to `src/lib/server/db/auto-upgrade.spec.ts` and repoint `test:chart`
- [x] T068 Record the legacy-name and retype judgements as data in `src/lib/server/services/account-aliases.ts`, read from the real book
- [x] T069 Add the retype, alias-rename, alias-merge and import-queue passes to `services/account-migration.ts`, reserve the seeded codes in the fall-through code assignment, and report `retypedAccounts` / `aliasRenames` / `rewrittenImportCategories`
- [x] T070 Add `isEquipmentAccount` / `isMoneyPotAccount` / `isCategoryAccount` to `ledger/account-type.ts` and route every pot-versus-category split through them: `sides-from-accounts.ts` (with `role` on `SidesAccount`), `loaders/records.ts`, `queries/dashboard.ts`, `queries/accounts.ts`, `import/category-accounts.ts`, `settings/+page.server.ts`, `import/+page.server.ts`
- [x] T071 Carry `accountRole` on `MovementView` and mirror the split client-side in `components/ledger/account-kinds.ts`, used by `RecordsPage.svelte`
- [x] T072 Cover it: nine cases in `auto-upgrade.spec.ts` over a fixture carrying the real book’s category names, plus the two equipment cases in `sides-from-accounts.spec.ts`
- [x] T073 Update `contracts/migration.md`, the FRs above, `CLAUDE.md` and `docs/RELEASE_NOTES_004.md`

## Notes

- `[P]` means different files and no dependency on unfinished tasks; the delegation plan can narrow it.
- All financial tests use a real temporary SQLite database rather than mocked queries.
- Generated migrations come from Drizzle; do not hand-author schema mutations.
- Conversion validation uses disposable WAL-consistent copies only, never the live database.
- No production release is allowed until US6 passes conversion, invariant, and no-op retry checks.
