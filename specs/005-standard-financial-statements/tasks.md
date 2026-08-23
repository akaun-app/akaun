---

description: "Task list for Standard Financial Statements on Dashboard and Reports"

---

# Tasks: Standard Financial Statements on Dashboard and Reports

**Input**: Design documents from `/specs/005-standard-financial-statements/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: Governed by Constitution Principle V. Included for the pure logic and business
rules this feature adds — the sub-type backfill migration, the sub-type-change eligibility
rule, and the new `cashFlow()` calculation — each written first and confirmed to fail before
its implementation task. Omitted for component wiring (selectors, tiles), thin CRUD
passthroughs (Zod schema fields), and the schema/migration tasks themselves, per quickstart.md's
explicit "Automated coverage" notes for each scenario.

**Organization**: Tasks are grouped by user story (spec.md's US1-US4, all but US4 are P1).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: Which user story this task belongs to (US1-US4); Setup/Foundational/Polish have none
- Every task names exact file paths and, where useful, current line numbers

## Path Conventions

Single SvelteKit codebase (Constitution I), no backend/frontend split:

- Enums/shared types: `src/lib/enums.ts`, `src/lib/server/ledger/types.ts`
- Schema & migrations: `src/lib/server/db/schema.ts`, generated into `drizzle/`
- Business rules: `src/lib/server/ledger/`, `src/lib/server/services/`
- Queries & loaders: `src/lib/server/queries/`, `src/lib/server/loaders/`
- Routes: `src/routes/(app)/<feature>/`, API at `src/routes/api/<feature>/`
- Shared page components: `src/lib/components/<feature>/`
- Tests: colocated `*.spec.ts` next to the module under test (Vitest)

---

## Phase 1: Setup

**Purpose**: Establish a safe, clean starting point (CLAUDE.md's Verification Policy)

- [X] T001 Confirm no dev server is running against the real `data/akaun.db` (`ps aux | grep "vite dev"`); if one is running, stop it before editing anything, per CLAUDE.md — `createDb()` converts the database on first start against an unconverted book.
- [X] T002 Confirm `bun run test`, `bun run check`, and `bun run lint` all pass on the current branch before making any change, establishing a clean baseline to diff against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The new `AccountSubType` classification and its schema column, needed by every
user story below.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Add `AccountSubType` enum (`Cash=1, Bank=2, Wallet=3, Card=4, Receivable=5, Inventory=6, OtherCurrentAsset=7, Equipment=8`), `AccountSubTypeLabels`, `AccountSubTypeDisplayLabels`, the `AccountSubTypeCode` type, and `accountSubTypeEnum = makeEnum(AccountSubTypeLabels)` in `src/lib/enums.ts` — insert after `AccountCodeRanges` (~line 264), before `DefaultAccountPurpose` (~line 266), mirroring `AccountType`/`AccountTypeLabels`/`AccountTypeDisplayLabels`/`accountTypeEnum`'s existing wiring (lines 250-264, 310-332, 365-366). Append-only, per data-model.md.
- [X] T004 In the same file (`src/lib/enums.ts`), delete the confirmed-zero-caller dead exports `AccountRoleLabels` (lines 295-308) and `accountRoleEnum` (line 365) (research.md §13) — grep `AccountRoleLabels\b` and `accountRoleEnum\b` across `src/` first to reconfirm nothing references them before deleting. (Depends on T003; same file.)
- [X] T005 Add a nullable `subType: integer("sub_type")` column to the `accounts` table in `src/lib/server/db/schema.ts`, immediately after the `type` column (line 646), with a comment noting it is meaningful only when `type = Asset`.
- [X] T006 Run `bun run db:generate` to produce the migration `drizzle/NNNN_account_sub_type.sql` for the new `accounts.sub_type` column. Do not hand-write the SQL. (Depends on T005.)
- [X] T007 [P] Extend `src/lib/server/ledger/types.ts`: add `subType: AccountSubTypeCode | null` to `AccountRow` (lines 53-66) and `AccountView` (69-82); add `subType?: AccountSubTypeCode` to `AccountCreate` (87-91) and `AccountPatch` (92-97); add `accountSubType: AccountSubTypeCode | null` to `MovementView` (147-161); add `CashFlowLine` / `CashFlowSection` / `CashFlowReport` types beside `BalanceSheetReport` (~500-513) per data-model.md's shape. (Depends on T003.)
- [X] T008 [P] Extend the client-facing mirror `src/lib/components/accounts/account-types.ts`: add `subType: AccountSubTypeCode | null` to `AccountView`, and `subType?: AccountSubTypeCode` to `AccountCreateInput`/`AccountUpdateInput`. (Depends on T003.)
- [X] T009 In `src/lib/server/ledger/account-type.ts`, add `CASH_AND_EQUIVALENT_SUBTYPES = [Cash, Bank, Wallet, Card]` and `OTHER_CURRENT_ASSET_SUBTYPES = [Receivable, Inventory, OtherCurrentAsset]`, and `isNeedsReview(account) = account.type === Asset && account.subType == null`; re-point `isEquipmentAccount` (lines 116-120) to `account.type === Asset && account.subType === AccountSubType.Equipment` and `isMoneyPotAccount` (123-125) to ride the corrected `isEquipmentAccount`; update the `RoleAndType` doc comment (92-108) to name `subType`, not `role`, as the Asset-account classifier (research.md §12). (Depends on T003.)
- [X] T010 In the same file (`src/lib/server/ledger/account-type.ts`), delete the confirmed-zero-caller dead code: deprecated `displaySign` (87-90), `isSharedOwedRole` (137-139), `MONEY_POT_ROLES` (141-146), `isCategoryRole` (148-152), `isProfitAndLossRole` (154-158), `isBalanceSheetRole` (160-164) (research.md §13) — grep each name across `src/` first to reconfirm zero callers. (Depends on T009; same file.)
- [X] T011 [P] Rename `src/lib/components/ledger/account-kinds.ts` to `src/lib/components/ledger/account-sub-types.ts`; re-point `isEquipmentSide`/`isCategorySide` (lines 16-29) to read `accountSubType` instead of `accountRole`, updating the `// Mirrors ...` comment (4-13) to reference the new subType-based `isEquipmentAccount`/`isMoneyPotAccount`; update the import in `RecordsPage.svelte`. (Depends on T007, T009.)
- [X] T012 [P] Re-point `defaultAccountId`'s fallback filter in `src/lib/server/queries/accounts.ts` (lines 299-331) from `ne(accounts.role, AccountRole.Equipment)` onto a null-safe subType check — e.g. `or(isNull(accounts.subType), ne(accounts.subType, AccountSubType.Equipment))` — per research.md §12's correctness caution about SQL's three-valued logic silently dropping needs-review accounts. (Depends on T003, T005.)
- [X] T013 [P] Re-point `recentRecords`'s inline SQL in `src/lib/server/queries/dashboard.ts` (lines 213-250) from `accounts.role = Equipment` to `accounts.subType = AccountSubType.Equipment` — a direct substitution; `NULL` correctly fails to match (research.md §12). (Depends on T003, T005.)

**Checkpoint**: Schema, enum, and all four re-pointed `role` readers are in place. User story work can begin.

---

## Phase 3: User Story 1 - Every money-holding account has a real sub-type (Priority: P1) 🎯 MVP

**Goal**: A user can set, change, and rely on a real sub-type (Cash/Bank/Wallet/Card/
Receivable/Inventory/OtherCurrentAsset/Equipment) on every asset account; existing accounts
are auto-classified where recognizable and marked "needs review" otherwise.

**Independent Test**: Open an asset account (new or existing), set its sub-type, save, and
confirm a second account can be given the same sub-type — verifiable before any report or
dashboard change exists.

### Tests for User Story 1 ⚠️

> Write these first and confirm they FAIL before implementing.

- [X] T014 [P] [US1] Add a failing test (new `describe` block, following the existing temp-SQLite-fixture pattern) in `src/lib/server/db/auto-upgrade.spec.ts` asserting the sub-type backfill: seeded defaults by code (1000→Cash, 1100→Bank, 1200→Receivable, 1300→Inventory) get the matching `subType`; every other existing Asset account gets `subType = NULL`; an account already carrying `role = Equipment` gets `subType = Equipment`; non-Asset accounts are untouched.
- [X] T015 [P] [US1] Add a failing unit test for the new sub-type-change eligibility rule in `src/lib/server/ledger/account-eligibility.spec.ts`, proving it is **not** blocked by movement/child/statement/default count (unlike `canChangeAccountType`), only by the account's existing edit-lock state (`!perms.change`, `isSystem`, `archivedAt`).

### Implementation for User Story 1

- [X] T016 [US1] Implement the sub-type backfill: add a step (e.g. `applySubTypeBackfill`, called from `migrateAccountChart` in `src/lib/server/services/account-migration.ts` before `validateCompleted`, or as its own post-`migrateAccountChart` step in `src/lib/server/db/auto-upgrade.ts` guarded by its own `account_migration_runs` version row) that maps seeded default codes to `subType` per data-model.md's table, leaving every other Asset account `NULL`. Makes T014 pass.
- [X] T017 [US1] Update `src/lib/server/db/seed-accounts.ts`'s `DEFAULT_CHART` (lines 18-37) so freshly-seeded accounts carry `subType` directly: code 1000→Cash, 1100→Bank, 1200→Receivable, 1300→Inventory; every other seeded Asset account (e.g. 1400 Marketplace Clearing) gets no `subType` (`NULL`, needs review) — matching FR-004's exact four recognized defaults.
- [X] T018 [US1] Add `canChangeAccountSubType` to `src/lib/server/ledger/account-eligibility.ts`, next to `canChangeAccountType` (line 56): allowed whenever the account is otherwise editable, without `canChangeAccountType`'s movement/child/statement/default-count checks. Makes T015 pass.
- [X] T019 [US1] Update `createAccount` in `src/lib/server/services/accounts.ts` (lines 56-93): require `data.subType` when `data.type === AccountType.Asset` (only the seven everyday values — never `Equipment`, per contracts/accounts-api.md), reject `subType` when `type !== Asset`, and persist it.
- [X] T020 [US1] Update `patchAccount` in `src/lib/server/services/accounts.ts` (lines 102-169): accept `patch.subType`, gate the write with `canChangeAccountSubType` (T018) rather than `canChangeAccountType`, reject `subType === Equipment` and `subType` on a non-Asset account, and include the change in the `recordAudit` diff.
- [X] T021 [US1] Add `subType?: AccountSubType` to the `.strict()` `createSchema` in `src/routes/api/accounts/+server.ts` (lines 19-30), enforcing required-when-Asset / rejected-when-Equipment / rejected-when-non-Asset (contracts/accounts-api.md); return 400 on violation.
- [X] T022 [US1] Add `subType?: AccountSubType` to the `.strict()` `patchSchema` in `src/routes/api/accounts/[id]/+server.ts` (lines 18-25), with the same rejections as T021.
- [X] T023 [US1] Add a sub-type `<select>` to `src/lib/components/accounts/AccountSheet.svelte`, directly after the account-type select (lines 76-84): the seven everyday `AccountSubType` values only (never Equipment), shown only when `selectedType === AccountType.Asset`, required before save.
- [X] T024 [US1] Add the sub-type selector/badge to `src/lib/components/accounts/AccountDetail.svelte`: an editable `<select>` mirroring AccountSheet's (near lines 246-251) when `canChangeAccountSubType` allows it, a "needs review" badge when `subType` is `null`, and a read-only display span (near line 178) otherwise — disabled under the same rules as the type field.

**Checkpoint**: User Story 1 is fully functional and independently testable.

---

## Phase 4: User Story 2 - Reports module offers only the standard financial statements (Priority: P1)

**Goal**: Reports shows exactly Profit & Loss, Balance Sheet, Cash Flow Statement, and (when
applicable) Partners' Equity; the Cash Flow Statement's cash total is independently verified.

**Independent Test**: Open Reports, confirm the tab list is exactly the standard statements,
open the new Cash Flow Statement tab, and confirm its cash total matches the combined movement
of Cash/Bank/Wallet/Card accounts for that period.

### Tests for User Story 2 ⚠️

- [X] T025 [P] [US2] Add failing pure-function tests in a new `src/lib/server/ledger/reports/cash-flow.spec.ts`, following `balance-sheet.spec.ts`'s fixture-builder pattern: operating/investing/financing derivation (Equipment→Investing; partner-capital/drawings/opening-balance→Financing; else→Operating); a receivable/inventory movement whose other side isn't cash surfaces as its own operating line (FR-012); a needs-review cash-side movement is excluded from every section and accumulates into `needsReviewMinor` (FR-005); the `ties`/`differenceMinor` self-check (independent opening/closing cash reads vs. summed lines, research.md §6); `historyGapNotes` propagation.

### Implementation for User Story 2

- [X] T026 [US2] Implement the pure `cashFlow(input): CashFlowReport` function in new `src/lib/server/ledger/reports/cash-flow.ts`, following `balance-sheet.ts`'s structure and reusing `historyGapNotes` from `src/lib/server/ledger/reports/notes.ts` (same pattern as `balance-sheet.ts`/`funds-flow.ts`); classify each cash-touching movement's activity per research.md §5; self-check per research.md §6. Makes T025 pass. (Depends on T007.)
- [X] T027 [US2] Add `cashFlowCsv(report: CashFlowReport): CsvTable` to `src/lib/server/ledger/reports/csv.ts`, mirroring `balanceSheetCsv` (123-137)/`sectionRows` (109-121) or an equivalent for the activities/lines shape. (Depends on T026.)
- [X] T028 [US2] Add `cashFlowReport(db, dateFrom, dateTo): CashFlowReport` to `src/lib/server/queries/reports.ts`, alongside `profitLossReport`/`balanceSheetReport` (146-168): read rows via `accountTotalsBetween`/`accountTotalsUpTo` filtered to `CASH_AND_EQUIVALENT_SUBTYPES` (T009), call the pure `cashFlow()` (T026).
- [X] T029 [US2] Add `hasPartners: boolean` (from `partnerContacts(db)`, lines 109-117) to reports page data, and update `REPORT_VIEWS` in `src/lib/server/loaders/reports.ts` (lines 30-36) to `["profit-loss", "balance-sheet", "cash-flow", "partners"] as const`.
- [X] T030 [US2] In `loadReportsPage` (`src/lib/server/loaders/reports.ts`, lines 79-126): add a `cash-flow` case calling `cashFlowReport` (T028); replace the `owed-to-us`/`we-owe` cases (110-124) with `redirect(302, '/contacts')` for both (FR-009), removing their `outstandingAgeing` calls.
- [X] T031 [US2] Create `src/routes/api/reports/cash-flow/+server.ts`, mirroring `src/routes/api/reports/balance-sheet/+server.ts` but using `periodQuery` (dateFrom/dateTo) instead of `asAtQuery`, and `cashFlowReport`/`cashFlowCsv` (T028/T027).
- [X] T032 [US2] Update `TABS` in `src/lib/components/reports/ReportsPage.svelte` (lines 30-36): replace the `owed-to-us`/`we-owe` entries with a `cash-flow` entry, filter the `partners` entry by `hasPartners` (T029); update `DESCRIPTIONS` (38-44), the `csv` derived switch (57-72) with a `cash-flow` case, and `showsPeriod`/`showsAsAt` (74-75) to treat cash-flow as period-based.
- [X] T033 [US2] Create `src/lib/components/reports/CashFlowStatementReport.svelte` (new, following `ProfitLossReport.svelte`/`BalanceSheetReport.svelte`'s naming convention, importing `./reports.css`): render operating/investing/financing sections, opening/closing cash figures, a separate "needs review" line, and the `ties`/`differenceMinor` warning.
- [X] T034 [US2] Wire the new component into `ReportsPage.svelte`'s report-body dispatch (lines 160-170): add `{:else if data.view === 'cash-flow'}<CashFlowStatementReport report={data.report} {isMobile} />`. (Depends on T032, T033.)
- [X] T035 [P] [US2] Delete `src/lib/components/reports/OwedToUs.svelte` and `src/lib/components/reports/WeOwe.svelte` (superseded by the T030 redirect; neither ever had a CSV endpoint, per contracts/reports-api.md).

**Checkpoint**: User Story 2 is fully functional — Reports shows exactly the four standard statements and Cash Flow ties out.

---

## Phase 5: User Story 3 - Dashboard shows statement-based indicators instead of ad hoc charts (Priority: P1)

**Goal**: The dashboard shows three headline indicators (net profit, financial position, cash
flow), each read directly from the same report function Reports uses, with no charts and no
Funds Flow panel.

**Independent Test**: Open the dashboard, note each indicator's figure and period, open the
matching Reports statement for the same period, confirm the figures match exactly.

### Implementation for User Story 3

> No new tests beyond US2's: per quickstart.md Scenario 3, the dashboard indicators must be the
> literal same function calls Reports makes, so there is nothing distinct to unit-test — T046
> below is a code-reading confirmation, not a new spec.

- [X] T036 [US3] Replace `src/lib/server/queries/dashboard.ts`'s ad hoc net-profit calculation (the `expenseTotals`/`incomeTotals`-based `typeTotals` figure, lines 100-115) with a direct call to `profitLossReport(db, dateFrom, dateTo).resultMinor` — the same function `/reports/profit-loss` calls (FR-014, research.md §9).
- [X] T037 [US3] Add a `cashFlow` indicator to `src/lib/server/queries/dashboard.ts` calling `cashFlowReport(db, dateFrom, dateTo)` (T028) and returning `{ netChangeMinor, needsReviewMinor, dateFrom, dateTo }` per contracts/dashboard-data.md.
- [X] T038 [US3] Delete `monthlyExpenseTotals`/`monthlyIncomeTotals` (163-166), `expenseCategoryBreakdown` (174-203), the standalone `outstandingTotal` tile usage (122-138), `fundsFlowStatement` (446-501), and `IS_CURRENT_ASSET`/`currentAssetsMinor`/`currentAssetsAsAt` (375-400) from `src/lib/server/queries/dashboard.ts` — all become dead code once their only callers (the removed charts/FundsFlow panel) are gone (research.md §10, §11, §12).
- [X] T039 [US3] Build one `position` indicator object (`assetsTotalMinor`/`liabilitiesTotalMinor`/`equityTotalMinor`/`balances`/`asAt`) in `src/lib/server/queries/dashboard.ts`, folding in the current-assets and accounts-payable figures, still delegating to `balanceSheetReport` via the existing `positionAsAt` (already compliant, research.md §9/§11).
- [X] T040 [US3] Update `src/routes/(app)/dashboard/+page.server.ts` (lines 5-123): remove imports/usage of `monthlyExpenseTotals`, `monthlyIncomeTotals`, `expenseCategoryBreakdown`, `currentAssetsAsAt`, `fundsFlowStatement`; build the `netProfit`/`position`/`cashFlow` indicator objects (T036-T039) each with an `href` carrying the exact `dateFrom`/`dateTo`/`asAt` shown (FR-015, via T041); keep `recentActivity`/period selector unchanged (FR-017). (Depends on T036, T037, T039, T041.)
- [X] T041 [P] [US3] Extend `src/lib/components/reports/report-links.ts` with dashboard-indicator href helpers (`/reports/profit-loss?from=...&to=...`, `/reports/balance-sheet?asAt=...`, `/reports/cash-flow?from=...&to=...`), following the existing `goto(resolve(...))` pattern.
- [X] T042 [US3] Replace the three chart tiles and the `FundsFlow` panel in `src/routes/(app)/dashboard/+page.svelte` (imports at lines 14-16, usages at 170/189/200/216) with three indicator tiles (net profit, financial position, cash flow), each linking via its `href`; keep the "Recent activity" list and period selector. (Depends on T040.)
- [X] T043 [P] [US3] Delete `src/lib/components/dashboard/FundsFlow.svelte` (superseded by the cash-flow indicator, research.md §10). (Depends on T042.)
- [X] T044 [US3] Grep-confirm `BarChart.svelte`, `DonutChart.svelte`, `TrendBars.svelte` (and `LazyChart.svelte` if it has no other caller) have no remaining callers after T042, then delete them.
- [X] T045 [P] [US3] Grep-confirm `fundsFlow`/`FundsFlowReport`/`ledger/reports/funds-flow.ts` have no remaining callers once T038 lands, then delete `funds-flow.ts` and `funds-flow.spec.ts` (Principle IV) — `historyGapNotes` stays, since it lives in `notes.ts`, not `funds-flow.ts`.

**Checkpoint**: User Story 3 is fully functional — the dashboard shows exactly three statement-based indicators, no charts.

---

## Phase 6: User Story 4 - Dashboard and Reports never disagree (Priority: P2)

**Goal**: The tally guarantee that US1-US3's "read straight from the report function" design
is meant to produce is confirmed, and the books-don't-balance warning propagates.

**Independent Test**: Change a record affecting revenue, expenses, or a cash account; confirm
the dashboard indicator and the corresponding Reports statement update to the same new figure
together (existing SSE wiring, no new emitter needed).

- [X] T046 [US4] Re-read `src/routes/(app)/dashboard/+page.server.ts` after T040 and confirm each indicator's figure comes from literally calling `profitLossReport`/`balanceSheetReport`/`cashFlowReport` — never a second, separately written calculation (FR-014) — per quickstart.md Scenario 3.
- [X] T047 [US4] Confirm the dashboard's `position` tile (T042) renders the same "books do not balance" warning `BalanceSheetReport.svelte` renders when `balances === false` (FR-016); add the warning branch to the tile if T042 didn't already include it.

**Checkpoint**: All four user stories are independently functional; dashboard and Reports are guaranteed to tally by construction, not by convention.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T048 [P] Grep for any remaining reference to `fundsFlowStatement`, `FundsFlow.svelte`, `OwedToUs`, `WeOwe`, `role === AccountRole.Equipment` (on Asset accounts), `IS_CURRENT_ASSET`, `currentAssetsAsAt` outside of history/specs — none should remain.
- [X] T049 [P] Delete or update any existing spec files that described the removed Receivables/Payables tabs or the funds-flow dashboard panel, so no stale test is left failing (quickstart.md's Regression checks).
- [X] T050 Run `bun run test`, `bun run check`, and `bun run lint`; fix any failures. Confirm no existing Profit & Loss / Balance Sheet / Partners' Equity spec broke.
- [X] T051 Read through quickstart.md's four scenarios against the final diff and reason about correctness (per CLAUDE.md's Verification Policy — no dev server, no browser).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS every user story — the `AccountSubType` enum and `subType` column are read by all of US1-US3.
- **User Story 1 (Phase 3)**: Depends on Foundational only. The account-classification UI and backfill can ship alone.
- **User Story 2 (Phase 4)**: Depends on Foundational; `cashFlowReport` (T028) reads `CASH_AND_EQUIVALENT_SUBTYPES` (T009) and benefits from real `subType` data existing (US1), but its own tests/pure function (T025-T026) need only the enum and types from Foundational.
- **User Story 3 (Phase 5)**: Depends on Foundational and on US2's `cashFlowReport` (T028) — the dashboard's cash-flow indicator calls it directly (FR-014).
- **User Story 4 (Phase 6)**: Depends on US1, US2, US3 all being implemented — it verifies their combined behavior rather than adding new capability.
- **Polish (Phase 7)**: Depends on all four user stories.

### Within Each Phase

- Tests (T014-T015, T025) are written and confirmed failing before their implementation tasks.
- Foundational's enum/schema tasks (T003, T005) precede every task that references `AccountSubType`/`subType`.
- Same-file tasks are sequenced, not parallel: T003→T004 (enums.ts), T009→T010 (account-type.ts).

### Parallel Opportunities

- Within Foundational, once T003 and T005 land: T007, T008, T009, T011, T012, T013 touch different files and can run in parallel.
- Within US1: T014 and T015 (different spec files) in parallel; T023 (AccountSheet) and T024 (AccountDetail) touch different files and can run in parallel once T019-T022 land.
- Within US2: T025 alone first; T035 (deleting OwedToUs/WeOwe) can run in parallel with T031-T034 once T030 lands.
- Within US3: T041 (report-links.ts) can run in parallel with T036-T039 (dashboard.ts); T043 and T045 (independent deletions) can run in parallel once their respective callers are gone.

---

## Parallel Example: Foundational Phase

```bash
# After T003 (enum) and T005 (schema column) land:
Task: "Extend ledger/types.ts with subType/CashFlowReport fields"      # T007
Task: "Extend components/accounts/account-types.ts with subType"       # T008
Task: "Re-point isEquipmentAccount/isMoneyPotAccount onto subType"     # T009
Task: "Re-point defaultAccountId's fallback filter onto subType"       # T012
Task: "Re-point recentRecords' inline SQL onto subType"                # T013
```

## Parallel Example: User Story 1

```bash
Task: "Auto-upgrade backfill test in db/auto-upgrade.spec.ts"          # T014
Task: "Sub-type-change eligibility test in account-eligibility.spec.ts" # T015
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational) — blocks everything else.
2. Complete Phase 3 (User Story 1) — every asset account can be classified.
3. **STOP and VALIDATE**: run quickstart.md Scenario 1 by reading the diff and running the new tests.
4. This alone is shippable: it fixes the data model even before Reports/Dashboard consume it.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → account sub-types exist and are editable → validate independently.
3. US2 → Reports gains a real Cash Flow Statement and drops the two duplicate tabs → validate against US1's data.
4. US3 → Dashboard reads the same three statements → validate against US2's report functions.
5. US4 → confirm the tally guarantee holds and the balance warning propagates.
6. Polish → regression sweep, dead-code grep, `bun run test`/`check`/`lint`.

### Notes

- [P] tasks touch different files and have no incomplete-task dependency at the point they run.
- Every mutating endpoint touched (accounts POST/PATCH) already carries `hasPermission` + Zod + `recordAudit` + SSE emit; the `subType` field rides those existing obligations rather than adding new ones (Constitution IV).
- No task in this list touches `data/` directly or starts a dev server — per CLAUDE.md, that verification is the user's, not an agent's.
