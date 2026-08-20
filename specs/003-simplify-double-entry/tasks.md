---
description: "Task list for 003-simplify-double-entry"
---

# Tasks: One Ledger, One Records Screen, One Flat Account List

**Input**: Design documents from `/specs/003-simplify-double-entry/`

**Prerequisites**: plan.md ✔, spec.md ✔, research.md ✔, data-model.md ✔, contracts/api.md ✔,
contracts/events.md ✔, quickstart.md ✔

**Tests**: Governed by Constitution Principle V and fixed by research.md R-14. Six modules get a
test that must fail first — four pure rules (`sides-from-accounts`, `merge-records`, `coverage`,
`legacy-drop-guard`) and two bug fixes (`/api/files` ownership, Auto Import duplicate detection).
**Nothing else gets a test**: not `RecordsPage.svelte`, not the merged drawer, not the two
reconciliation components, not route wiring, not the nav change, not the accounts search box, not a
re-pointed link. R-14 names those as the case Principle V explicitly forbids testing. No coverage
target is introduced.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US8)
- Include exact file paths in descriptions

## ⚠️ Two standing rules for every task in this file

1. **`data/` is real.** Never point a script, a test or a server at `data/akaun.db` or
   `data/storage`. Work on a copy under `/tmp/akaun-003/`, and hash `data/akaun.db` before and after
   anything you are unsure about. `bun run check` also breaks an open dev-server tab — run it with
   no dev client open (`CLAUDE.md`).
2. **Verify by reading code**, `bun run check` and `bun run lint`. The maintainer does every visual
   and behaviour check (quickstart Part 5).

## Path Conventions

Single SvelteKit codebase (Constitution Principle I) — no backend/frontend split.

- **Routes & pages**: `src/routes/(app)/<feature>/`, API at `src/routes/api/<feature>/`
- **Shared page components**: `src/lib/components/<feature>/`
- **Pure rules**: `src/lib/server/ledger/`, `src/lib/server/permissions/`
- **Business logic**: `src/lib/server/services/`
- **Queries & loaders**: `src/lib/server/queries/`, `src/lib/server/loaders/`
- **Schema & migrations**: `src/lib/server/db/schema.ts`, generated into `drizzle/`
- **Tests**: colocated `*.spec.ts`, `server` project (`bun run test:unit -- --project server`)

## Phase ordering note

Phases 3–10 follow **plan.md's "Suggested delivery order"** rather than raw P1→P3 priority, because
that order is dependency-correct and each stage stays independently verifiable. US6 (P2) comes first
in code because every route in US1/US2 gates on `records`; US7 (P3) comes last because it is
irreversible and steps 2 and 9 remove its last readers. Each phase still states its own priority.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the "before" state that SC-003, SC-006 and FR-039 are measured against, and
prove the tree is green before anything moves.

- [ ] T001 **[MAINTAINER]** Back up `data/akaun.db` and `data/storage/` to `data/backups/pre-003-<date>.db` and a storage archive, then record `shasum -a 256 data/akaun.db` in this file's margin. No agent may write inside `data/` (quickstart "Before anything else", FR-038)
- [X] T002 Copy the backup to `/tmp/akaun-003/before.db` and capture the pre-change baseline into `/tmp/akaun-003/before/` — `profit-loss.json`, `balance-sheet.json`, `partner-statement.json`, `accounts.json` (every `balanceMinor`), plus `SELECT DISTINCT resource, owner_id, can_view, can_add, can_change, can_delete` from `group_permissions` and `user_permissions`. This is the only baseline SC-003 and SC-006 can be diffed against later (quickstart Part 4)
- [X] T003 [P] Create `docs/RELEASE_NOTES_003.md` whose **first paragraph** states that this release permanently removes data and that the user must back up first, before any other note (FR-038)
- [X] T004 [P] Confirm `bun run check`, `bun run lint` and `bun run test` all pass on `develop` before any change, so a later failure is attributable (quickstart Part 1)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The two live defects that FR-037 would turn from silent wrongness into a hard failure,
and the one interface-freeze edit every later phase reads.

**⚠️ CRITICAL**: T009 is the `types.ts` interface freeze — a single broadcast edit, done once here so
US1, US2, US3 and US8 never race on the same file. Both defect fixes must be green **before** the
Phase 10 drop, so the fix and the drop stay independent (research.md R-13).

- [X] T005 [P] Write a failing test `src/routes/api/files/file-ownership.spec.ts` asserting a file named only in `record_attachments` is served, a file named nowhere is still `403`, the path-traversal guard still refuses `../`, and the `bank_statements` permission check still holds. It must fail today — every ledger-record attachment currently returns `403` (research.md R-13 defect 1, FR-014, FR-039)
- [X] T006 Add the `record_attachments` ownership check to `src/routes/api/files/[...path]/+server.ts`, alongside the existing `expense_attachments` / `income_attachments` / `claim_attachments` / `bank_statements` checks, leaving the traversal guard and the `bank_statements` permission branch untouched. T005 goes green (depends on T005)
- [X] T007 [P] Write a failing test `src/lib/server/import/duplicate-detector.spec.ts` that seeds a `ledger_records` row plus its `ledger_movements` and asserts the detector offers it as a duplicate candidate. It must fail today — the detector cannot see any record created since the conversion (research.md R-13 defect 2, FR-035)
- [X] T008 Repoint `src/lib/server/import/duplicate-detector.ts` from `expenses` / `incomes` to `ledger_records` + `ledger_movements`, keeping the amount, date, reference, content and filename comparison logic byte-for-byte unchanged. T007 goes green (depends on T007)
- [X] T009 Extend `src/lib/server/ledger/types.ts` in one edit (the interface freeze — announce it): add `reconciled` / `cleared` / `clearedMinor` / `sideCount` to `RecordView` with the doc comments from data-model.md §4, add `cleared?: boolean` and `sort?: "date" | "amount"` to `RecordListFilters`, and add the `RecordCreateFromSides` type. Extend `RecordView`'s existing `reconciled` comment to explain the third field rather than replacing it (data-model.md §4, R-08)

**Checkpoint**: Attachments download, Auto Import sees real records, and every later phase has the
types it needs. `bun run check` and `bun run test` pass.

---

## Phase 3: User Story 6 - One permission for records (Priority: P2) — first in code

**Goal**: `expenses` + `income` collapse into one `records` resource by OR-merge over **both**
permission tables; `journal` is renamed `adjustments`. Nobody's effective access changes.

**Independent Test**: An administrator grants a group view + add on Records, and that group records
everyday purchases, sales, transfers and payments — and is offered neither the full account list nor
a third side until `adjustments` is granted too. Every pre-existing group and user keeps exactly the
access it had.

**Why first**: every route in US1 and US2 gates on `records`. Merging the resource before merging the
screens means one gate change per route rather than two (plan.md delivery order step 2).

### Tests for User Story 6 (Principle V — permission resolution is named TDD-required)

> Write these FIRST and confirm they FAIL before implementing.

- [X] T010 [P] [US6] Write a failing test `src/lib/server/permissions/merge-records.spec.ts` covering all 16 combinations of one owner holding `expenses` and `income` booleans, an owner holding only one of the two, an owner holding neither, the `journal` → `adjustments` rename, and idempotency (running the merge twice changes nothing). Assert invariants 7 and 8 from data-model.md §6 (SC-006, FR-029)

### Implementation for User Story 6

- [X] T011 [US6] Implement the pure OR-merge in `src/lib/server/permissions/merge-records.ts` — plain rows in, plain rows out, no database. A missing source row reads as all-false; `records.can_*` = `expenses.can_* OR income.can_*`; `journal` rows become `adjustments` unchanged (data-model.md §3, R-04). T010 goes green (depends on T010)
- [X] T012 [US6] Add the thin idempotent applier `applyRecordsPermission(db)` and call it from the seed path in `src/lib/server/db/client.ts` beside `ensureGroupSeed()`, guarded by a `settings` key. It MUST write **both** `group_permissions` and `user_permissions` — `dropClaimPermissions()` touched groups only and repeating that omission silently discards every per-user override (R-04) (depends on T011)
- [X] T013 [US6] Change `ResourceName` and `ALL_RESOURCES` in `src/lib/server/permissions.ts`: remove `expenses`, `income`, `journal`; add `records`, `adjustments`. `ALL_RESOURCES` duplicates the union rather than deriving from it, so both must change (data-model.md §3)
- [X] T014 [US6] Update `SEED_GROUPS` in `src/lib/server/db/client.ts` — Bookkeeper → `records` view/add/change, Data Entry → `records` add, Reviewer → `records` view; Administrators unchanged (`isSuperuser`). **No seeded group grants `adjustments`** (FR-031a) (depends on T013)
- [X] T015 [P] [US6] Collapse `resourceForKind()` and `resourceForKindName()` in `src/lib/server/ledger/record-permissions.ts` to return `"records"` for every kind. Keep both functions — every call site keeps calling them — and replace the file's doc comment with the written record of what changed: transfers, payments and opening balances were checked against `expenses` "because that is the screen they are recorded from", and that screen is gone (contracts/api.md) (depends on T013)
- [X] T016 [P] [US6] Update the `RESOURCES` array in `src/routes/(app)/users-groups/+page.svelte` (lines 54–66): remove `expenses`, `income`, `journal`; add `records` and `adjustments`; add a `description` field to every entry, using the two texts in data-model.md §3 verbatim for `records` and `adjustments` (FR-031e) (depends on T013)
- [X] T017 [P] [US6] **Not applicable — no such array exists.** `api/groups/[id]/permissions/+server.ts` is 51 lines and resource-name-agnostic: its PATCH writes whatever keys the client sends and its GET reads whatever rows exist, so there is no second list to keep in step. The list is written in two places, not three: the union + `ALL_RESOURCES` (T013) and the one `RESOURCES` array (T016). ~~Update the `RESOURCES` array in `src/routes/api/groups/[id]/permissions/+server.ts` (lines 54–65) to match T016 exactly — same ids, same labels, same descriptions. These two arrays and the union in T013 are the three places the list is written and they must change together (depends on T013)
- [X] T018 [US6] In `src/routes/api/records/+server.ts`, replace the `["expenses", "income"]` check on GET (line ~106) with one `hasPermission(locals, "records", "view")`, and gate POST on `records.add`. This closes the live hole where a hand-written record was readable by anyone with expense view and never checked `journal` (R-11) (depends on T013)
- [X] T019 [P] [US6] Gate `src/routes/api/records/[id]/+server.ts` on `records` — `view` for GET, `change` for PATCH, `delete` for DELETE (depends on T013)
- [X] T020 [P] [US6] Gate `src/routes/api/records/[id]/attachments/+server.ts` and `src/routes/api/records/[id]/attachments/[attachmentId]/+server.ts` on `records` (FR-014) (depends on T013)
- [X] T021 [P] [US6] Gate `src/routes/api/records/[id]/settlements/+server.ts` on `records` view (depends on T013)

**Checkpoint**: `bun run check` passes with no `expenses` / `income` / `journal` resource name left in
`src/lib/server/`. Every record endpoint answers to one ability. US1 can begin.

---

## Phase 4: User Story 1 - Everything that happened, in one list (Priority: P1) 🎯 MVP

**Goal**: One Records screen listing every record of every kind, newest first, with one search box
and the FR-002 filters, one live connection, and a shareable address per record.

**Independent Test**: With Expenses, Income and Journal gone from the navigation, a user finds a
purchase from three months ago, a sale, and a transfer between two bank accounts from the one Records
screen, and opens each one, without visiting any other page.

**Note**: this phase creates the new screen. Deleting the three old ones and re-pointing the links
into them is US5 (Phase 8) — the old routes keep working until then, so this phase is shippable on
its own.

### Implementation for User Story 1

- [X] T022 [US1] Add the `sideCount` aggregate to `listRecords()` in `src/lib/server/queries/ledger.ts` — a count of `ledger_movements` per record — so a row can show a count instead of two accounts when it exceeds 2 (FR-003, edge case "a record with more than two sides") (depends on T009)
- [X] T023 [US1] Add the `sort` filter (`date` default, `amount`) to `listRecords()` in `src/lib/server/queries/ledger.ts`, and make sure `kind` still accepts a single value or an array. Every other FR-002 filter already exists — `accountId`, `contactId`, `categoryAccountId`, `dateFrom`, `dateTo`, `amountMin`, `amountMax`, `paid`, `search`, `limit`, `offset` — so invent none (data-model.md §4) (depends on T009)
- [X] T024 [US1] Create `src/lib/server/loaders/records.ts` by copying `src/lib/server/loaders/ledger.ts` and dropping `legacyDestination` (lines 93–123) with its `findByLegacy` call. One shared loader serving both routes, redirecting to `/records` when `openId` is not one of the loaded records (FR-004, FR-025a, `CLAUDE.md` deep-link pattern) (depends on T022, T023)
- [X] T025 [US1] Add `cleared` and `sort` to the Zod query schema in `src/routes/api/records/+server.ts` GET, and return `reconciled`, `cleared`, `clearedMinor` and `sideCount` on every record. `cleared` stays wired to a stub returning `false` until T088 lands the coverage rule (contracts/api.md) (depends on T009, T018, T022, T023)
- [X] T026 [US1] Create `src/routes/api/records/stream/+server.ts` — a `ReadableStream` with `Content-Type: text/event-stream`, gated `records.view`, forwarding `record-update` (full `RecordView`, **no kind filter**), `record-deleted` (`{id}`) and `settlement-changed` (`{recordIds}`) from the one `ledgerEvents` emitter. **No snapshot on connect** — Records is a paginated list (contracts/events.md, R-11). Change no emitter and no `emit` call site (depends on T013)
- [X] T027 [US1] Create `src/lib/components/records/RecordsPage.svelte` by copying `src/lib/components/expenses/ExpensesPage.svelte` (1,347 lines) verbatim and renaming only what the file name forces. Commit this as a pure copy so every later diff in this phase is readable (R-01)
- [X] T028 [US1] In `src/lib/components/records/RecordsPage.svelte`, fold in what Income and Journal contribute: the `+` prefix and green amount become a **per-row rule driven by the record's own sign**, not by which screen you are on, and `journal-rules.ts`' balance mirror is reached through the drawer. Keep from Expenses the table, sort, date range, selection and delete bar, the `StatusBadge` column, the "Still owed" panel and its `PaymentSheet` (R-01) (depends on T027)
- [X] T029 [US1] Replace the header stat tiles in `src/lib/components/records/RecordsPage.svelte` with one fixed set of four in the Dashboard's vocabulary — Money in, Money out, Still owed, All records. Income's "This quarter" and "Largest payment" and Expenses' "Still owed / Paid / This month" split are deliberately given up (R-01) (depends on T028)
- [X] T030 [US1] Add the kind filter and the account filter to the `RecordsPage.svelte` filter panel, alongside the existing search, contact, date-range, amount-range and outstanding filters, and reflect every one in the URL query string so a filtered view is shareable (FR-002, US1 scenario 2) (depends on T028)
- [X] T031 [US1] Render each row in `RecordsPage.svelte` as date, description, **the two accounts money moved between — or `N sides` when `sideCount > 2`**, amount, and settled state. A five-sided hand-made entry must say how many sides it has rather than picking two arbitrarily (FR-003, edge case) (depends on T028, T022)
- [X] T032 [US1] Add the empty state to `RecordsPage.svelte` that names **which filter** emptied the list, never "you have no records" (edge case "a filter that empties the list") (depends on T030)
- [X] T033 [US1] Wire the shallow-routing deep link in `RecordsPage.svelte`: `openRecord(record, { push })` sets local `$state` and calls `pushState(resolve('/(app)/records/[id]', { id: String(id) }), { viaPush: true })`; `closeDetail()` reads `page.state.viaPush` and calls `history.back()` when true, else `goto(resolve('/(app)/records'), { replaceState: true })`. On mount with an `openId`, call `openRecord(record, { push: false })` (`CLAUDE.md` deep-link pattern, FR-004) (depends on T028)
- [X] T034 [US1] Wire the SSE client in `RecordsPage.svelte`: open the `EventSource` on `/api/records/stream` in `onMount`, close it in `onDestroy` — **never in `$effect`**. Merge in the `mergeServerJobs` shape: update rows already held, insert a row arriving from another tab at the start of the list, and **never** add a row from the create action's own response. Keep the existing `loadOwed()` call on both `record-update` and `settlement-changed`. Close the drawer cleanly when the open record is deleted by another user (contracts/events.md, edge case) (depends on T026, T028)
- [X] T035 [P] [US1] Create `src/routes/(app)/records/+page.svelte` rendering `RecordsPage` with `openId={null}`, and `src/routes/(app)/records/+page.server.ts` calling the shared loader from T024 (depends on T024, T027)
- [X] T036 [P] [US1] Create `src/routes/(app)/records/[id]/+page.svelte` rendering `RecordsPage` with `openId={data.openRecordId}`, and `src/routes/(app)/records/[id]/+page.server.ts` calling the same shared loader (depends on T024, T027)
- [X] T037 [US1] Add the `cleared` label to `src/lib/components/ledger/record-status.ts` so the merged screen can show it, and confirm the file's `// Mirrors src/lib/server/...` comment still names the right source (`CLAUDE.md` hand-mirror rule) (depends on T009)
- [X] T038 [US1] In `src/lib/nav-config.ts`, remove the Expenses, Income and Journal items and add **Records**. Leave Reconciliation in place — US8 removes it (FR-007, FR-023) (depends on T035)

**Checkpoint**: `/records` lists every kind newest first, filters work and appear in the URL,
`/records/[id]` opens the drawer over the list, one SSE connection carries updates for all kinds, and
Expenses / Income / Journal are gone from the nav. **This is the MVP** — stop and let the maintainer
confirm quickstart Part 5's US1 checks.

---

## Phase 5: User Story 2 - One way to write a record (Priority: P1)

**Goal**: One "New record" action, one form, both sides always named in everyday words. The kind is
**derived** from the two accounts' roles, never asked. Free choice of account and a third side are
gated on `adjustments`, enforced on the server.

**Independent Test**: A user records a fuel purchase paid from the bank, a sale received into the
bank, and a transfer between two of their own accounts, using the same form each time, and all three
appear correctly on the Records list and in the reports.

### Tests for User Story 2 (Principle V — a wrong kind is silent) ⚠️

> Write this FIRST and confirm it FAILS before implementing.

- [X] T039 [P] [US2] Write a failing test `src/lib/server/ledger/sides-from-accounts.spec.ts` covering **every row** of the derivation table in data-model.md §5 over plain role codes with no database, plus each refusal with its exact plain sentence: both sides name the same account; a side names `Receivable` or `Payable` with no contact ("Say who this is owed to or by."); a side names an archived account; the result is `journal` (or `extraSides` is present, or a side is outside its shortlist) and the caller lacks `adjustments`. Assert the module builds **no movements** — it returns a `RecordCreateSides` only (R-02, R-14)

### Implementation for User Story 2

- [X] T040 [US2] Implement `src/lib/server/ledger/sides-from-accounts.ts` — `sidesFromAccounts(input, ctx): Refusable<RecordCreateSides>`, pure. It translates the two-account answer into the shape `entry-builder.ts` already accepts and **constructs no movements**; `entry-builder.ts` stays the single enforcement point of the zero-sum rule. `invoice-issue` is not producible here (R-02, data-model.md §5). T039 goes green (depends on T009, T039)
- [X] T041 [US2] Add the eighth member to the existing Zod discriminated union in `POST src/routes/api/records/+server.ts` — `{ date, description, amount, currency, exchangeRate, reference?, remark?, contactId?, fromAccountId, toAccountId, extraSides? }`. **Keep all seven existing variants**: Auto Import posts `expense` and `income`, and `services/invoices.ts`, `services/accounts.ts` and reconciliation's transfer action construct `RecordCreateSides` in-process (FR-036) (depends on T040)
- [X] T042 [US2] In `POST src/routes/api/records/+server.ts`, call `sidesFromAccounts()` on the new member, then hand the result to `buildMovements()` unchanged. Return `409 { error, reason }` for each refusal, including the sides-do-not-cancel case **stating by how much it is out** (FR-009) (depends on T041)
- [X] T043 [US2] Add the `adjustments` gate to `POST src/routes/api/records/+server.ts` — `adjustments.add` — checked **after** the derivation, because whether a record needs the ability is a fact about the accounts it names, not about what the client sent. It refuses a derivation landing on `journal`, an `extraSides` payload, and an account outside a side's everyday shortlist. Server-side, never by hiding a control (FR-031c) (depends on T042)
- [X] T044 [US2] In `PATCH src/routes/api/records/[id]/+server.ts`, accept `fromAccountId` / `toAccountId` and re-derive the kind through `sidesFromAccounts()`, gated on `adjustments.change`. Keep refusing `amount`, `date` and any account field on a settled or reconciled record with the same sentence naming what to undo first (FR-012), and keep refusing an `invoice-issue` record with "Change it on the invoice instead." (FR-013) (depends on T040, T019)
- [X] T045 [US2] Move `src/lib/components/journal/journal-rules.ts` to `src/lib/components/ledger/journal-rules.ts`, keeping its `// Mirrors src/lib/server/ledger/entry-builder.ts's ...` comment intact, and update its importers (`CLAUDE.md` hand-mirror rule)
- [X] T046 [US2] Rebuild the create/edit form in `src/lib/components/ledger/RecordSheet.svelte` around the two everyday questions — which account the money left, which it went to — with **no kind picker**. Send `RecordCreateFromSides`. Keep the shared `Sheet` shape exactly: `gap:0` inline on `Sheet.Content`, header with eyebrow + title and the close button only, `.detail-amount`, `.field` / `.field-label`, sticky `.sheet-foot` outside the scrollable body (`CLAUDE.md` drawer standard, D-01) (depends on T040, T045)
- [X] T047 [US2] Add the extra-sides editor to `src/lib/components/ledger/RecordSheet.svelte`, shown only with `adjustments`, displaying the **running difference live** as lines are added and refusing to save until it reaches zero, using the `journal-rules.ts` mirror (FR-010, US2 scenario 4) (depends on T046)
- [X] T048 [US2] Add the "someone else paid" path to `RecordSheet.svelte` — naming a contact and choosing "Money we owe" as the paying side saves the record as owed to that person and shows as outstanding — and refuse to save a `Receivable` / `Payable` side with no contact, using the same plain sentence the server returns (FR-011, US2 scenarios 3 and 7) (depends on T046)
- [X] T049 [US2] In `src/lib/components/ledger/RecordSheet.svelte`, show a locked record's amount, date and account fields as not editable with the drawer's existing one-sentence explanation (FR-012), and show an `invoice-issue` record read-only with a link to the invoice that owns it (FR-013, edge case "a record whose kind has no everyday name") (depends on T046)
- [X] T050 [US2] Remove the generic `/reconciliation` link from `src/lib/components/ledger/RecordSheet.svelte` — that destination is gone in US8, and a record's relation to a statement is reached from the account (depends on T046)
- [X] T051 [US2] Keep `AttachmentManager.svelte` then `<AuditTrail recordType=... recordId=... />` last in the `RecordSheet.svelte` body in that order, with the `bind:this` `.refresh()` call after a successful save (FR-014, `CLAUDE.md` drawer standard) (depends on T046)
- [X] T052 [US2] Add the shortlist/full-list behaviour to `src/lib/components/ledger/AccountSelect.svelte`: each side offers the accounts that side would sensibly be — categories for what a record was for, money pots for where it came from or went — with the **full list reachable in one step**, offered only with `adjustments`. Archived accounts are never offered on a new record (FR-008a, FR-021, FR-031) (depends on T046)
- [X] T053 [US2] Hide the "New record" action in `src/lib/components/records/RecordsPage.svelte` without `records.add`, and hide the "add another side" action and the full-account-list step without `adjustments` — the server refusals in T043 and T047 remain the enforcement (US2 scenarios 5 and 6, FR-031c) (depends on T028, T043, T052)

**Checkpoint**: One form writes a purchase, a sale, a transfer, a repayment and a someone-else-paid
record; the kind is never asked; the sides-do-not-cancel refusal states by how much; a user without
`adjustments` gets a shortlist, no third side, and a server refusal if they force it.

---

## Phase 6: User Story 3 - One flat list of accounts (Priority: P1)

**Goal**: One flat account list with no section headings, a name search box and a "sort of account"
filter — and the account's statement becomes the Records list narrowed to that account, with a
running balance, replacing the separate full-page history (D-05).

**Independent Test**: With no grouping headers on screen, a user finds a bank account, an expense
category and a partner's account from the one list using search, opens each, and follows the drawer's
"see every movement" card into a running-balance statement for that account.

### Implementation for User Story 3 — the flat list

- [X] T054 [P] [US3] Delete `ROLE_GROUPS` from `src/lib/components/accounts/account-roles.ts` and expose the six labels it used as **filter values** instead. They are already written in plain words and already tested against the roles (R-12)
- [X] T055 [US3] Remove the six group headers from `src/lib/components/accounts/AccountsPage.svelte`, rendering one flat list in the query's existing stable order (`role ASC, rank ASC`). Each row shows name, **what sort of account it is**, and balance through `displaySign` — two accounts named "Fuel" in different roles must be tellable apart (FR-015, FR-016, edge case) (depends on T054)
- [X] T056 [US3] Add a name search box and the "sort of account" filter to `src/lib/components/accounts/AccountsPage.svelte`, both **client-side over the already-loaded list** — the loader already fetches every account with `includeArchived: true`, and a hundred rows cost nothing. Keep the "Show archived" toggle: archived accounts stay findable because their history exists. The screen has no search box at all today, so this is new work and SC-008 depends entirely on it (FR-017, R-12, contracts/api.md) (depends on T055)
- [X] T057 [US3] Confirm in `src/lib/components/accounts/AccountsPage.svelte` that category accounts render in the same flat list as every other account with no special casing, and that the existing below-zero balance explanation still shows (FR-018, US3 scenario 4) (depends on T055)

### Implementation for User Story 3 — the statement view (D-05)

- [X] T058 [US3] Create `src/routes/api/records/statement/+server.ts` gated on **`records.view`** — query `accountId` (required), `dateFrom?`, `dateTo?`, `limit?`, `offset?`, `format=json|csv`. Return `AccountHistoryReport` unchanged, reusing `accountHistory()`, the running-balance arithmetic, the truncation note and the CSV writer exactly as they stand. A record touching the narrowed account twice appears **once per side** so the balance adds up (FR-040–FR-046, FR-042, R-07) (depends on T013)
- [X] T059 [US3] In `src/routes/api/records/statement/+server.ts`, return `openingBalanceMinor`, `closingBalanceMinor` and per-entry `runningBalanceMinor` **only** when `accountId` plus an optional date range are the only parameters and the sort is date order; otherwise omit them and put the plain reason in `notes` (FR-043, edge case "a running balance that would lie") (depends on T058)
- [X] T060 [US3] Add statement mode to `src/lib/components/records/RecordsPage.svelte`: when the URL carries `account=<id>` and nothing but an optional date range, show the running-balance column with the opening figure before the first row and the closing figure after the last, one row per side of the narrowed account (FR-040–FR-042) (depends on T030, T058)
- [X] T061 [US3] Make the running balance, opening and closing figures **disappear** in `RecordsPage.svelte` the moment another filter is applied or the sort changes, and say on screen why they went — a missing figure with no explanation reads as a fault (FR-043, edge case) (depends on T060, T023)
- [X] T062 [US3] Add the CSV export to statement mode in `RecordsPage.svelte`, covering the rows in view and using the same signs the screen shows, plus the "showing N of M movements" note when the view is truncated (FR-044, FR-045, `CLAUDE.md` sign rule) (depends on T060)
- [X] T063 [US3] Re-point the "see every movement" relation card in `src/lib/components/accounts/AccountSheet.svelte` at `/records?account=<id>`, keeping the `related-link` class, the 34×34 icon box, the grey second line and the trailing `ChevronRight` (FR-022, US3 scenario 6, `CLAUDE.md` relation-card contract)
- [X] T064 [US3] Delete `src/routes/(app)/accounts/[id]/history/+page.svelte` and `+page.server.ts`, delete `src/lib/components/reports/AccountHistory.svelte`, and remove the account-history view from `src/lib/server/loaders/reports.ts`. This also closes the live defect where the page shell gated on `accounts.view` while its data came from an endpoint gated on `reports.view` (FR-046, R-07) (depends on T060, T063)
- [X] T065 [US3] Delete `src/routes/api/reports/account-history/+server.ts` and `src/routes/api/accounts/[id]/movements/+server.ts` — both retire into T058's one endpoint (contracts/api.md) (depends on T058, T064)
- [X] T066 [US3] Re-point every report that links to an account at its statement view in `src/lib/components/reports/report-links.ts` — `openAccountHistory()` keeps going to `/(app)/accounts/[id]`, whose drawer card now leads to `/records?account=` (FR-047) (depends on T063)
- [X] T067 [US3] Confirm the account drawer and its opening balance are otherwise **unchanged** in `src/lib/components/accounts/AccountSheet.svelte`, including the `.ob-card` starting-balance relation card (FR-022, US3 scenario 5)

**Checkpoint**: One flat searchable account list; the account drawer's movement card opens a
running-balance statement inside Records; the separate history page and its two endpoints are gone
and one screen answers to one ability.

---

## Phase 7: User Story 4 - Categories are managed in one place (Priority: P2)

**Goal**: The Settings Category tab and its second, differently-behaved way to do the same job are
deleted. Accounts is the only place accounts, including categories, are created, renamed and archived.

**Independent Test**: A user creates, renames and retires a spending category entirely from the
Accounts screen, and Settings no longer offers a Category tab.

- [X] T068 [US4] Delete the Category tab and its staged-list UI from `src/routes/(app)/settings/+page.svelte`, including the tab entry itself, so the tab strip renders without it (FR-020)
- [X] T069 [US4] Delete the `saveCategories` action and `planCategoryChanges` from `src/routes/(app)/settings/+page.server.ts`. **Leave the accounts service untouched** — that tab already reconciled its staged list by calling `createAccount`, `patchAccount` and `removeAccount` through the same service `POST /api/accounts` uses, so no new endpoint is needed (contracts/api.md, FR-019) (depends on T068)
- [X] T070 [US4] Confirm an account created in `src/lib/components/accounts/AccountsPage.svelte` with a category role is immediately offered as a side by `src/lib/components/ledger/AccountSelect.svelte`, with no cache or seed step between (US4 scenario 1, FR-019) (depends on T052, T055)
- [X] T071 [US4] Confirm archiving a category that already has records against it archives rather than deletes, preserves its history and stops it being offered on new records; and that deleting an account holding records is still refused with a plain reason and a disabled-with-`title` delete button rather than a hidden one (FR-021, `CLAUDE.md` footer rule) (depends on T055)
- [X] T072 [US4] Sweep `src/routes/(app)/settings/`, `src/lib/components/` and every help string for wording that implies categories are managed in Settings, and remove it (FR-020) (depends on T068)

**Checkpoint**: Settings has no Category tab, no wording points at one, and every category operation
happens on Accounts through the one service.

---

## Phase 8: User Story 5 - Nothing inside the app points at a screen that is gone (Priority: P2)

**Goal**: Every link the app draws for itself points at Records, and the retired addresses are
retired **outright** — no redirect layer, no legacy lookup (D-04).

**Independent Test**: Every link into a record, from every screen that draws one, opens that record on
the Records screen; no file in `src/` references a retired address.

### Re-point every link first

- [X] T073 [P] [US5] Change `recordPathFor()` in `src/lib/components/reports/report-links.ts` (lines 35 and 38) from `/(app)/expenses/[id]` and `/(app)/income/[id]` to `/(app)/records/[id]` (FR-027, FR-047) (depends on T036)
- [X] T074 [P] [US5] Change the redirect in `src/routes/+page.server.ts` (line 4) from `/expenses` to `/records` (depends on T035)
- [X] T075 [P] [US5] Change `canOpen` in `src/lib/components/ledger/SettlementList.svelte` so **every kind** opens, at `/records/[id]` — Payment, Transfer, OpeningBalance and InvoiceIssue now all have a screen, so the reason the chevron was withheld is gone. Keep the compact-row shape, the `related-link` class and the trailing `ChevronRight` (FR-027, `CLAUDE.md` named-URL exception) (depends on T036)
- [X] T076 [P] [US5] Change `badgeFor()` in `src/lib/components/ui/Sidebar.svelte` (line 25) and `src/lib/components/ui/BottomNav.svelte` (line 19) from `item.id === 'expenses'` to `'records'`. The figure itself is unchanged — `unpaidCount` in `src/routes/(app)/+layout.server.ts:18–22` already derives from settlement state, not a stored column (FR-024, contracts/events.md) (depends on T038)
- [X] T077 [US5] Re-point every remaining in-app link into a record at `/records/[id]` using `goto(resolve('/(app)/records/[id]', { id: String(id) }))` with no query string — Dashboard, Auto Import, Contacts, and the new reconciliation surfaces. Verify by grepping `src/` for `/expenses/`, `/income/` and `/journal/` (FR-027) (depends on T036)

### Then retire the addresses

- [X] T078 [P] [US5] Delete `src/routes/(app)/expenses/`, `src/routes/(app)/income/` and `src/routes/(app)/journal/` entirely — eight route files (FR-025) (depends on T073, T074, T075, T076, T077)
- [X] T079 [P] [US5] Delete `src/routes/api/expenses/**` (5 files) and `src/routes/api/income/**` (5 files). The attachment routes are already `export { POST } from "…/records/…"` re-exports, so this removes addresses and not behaviour (contracts/api.md) (depends on T077)
- [X] T080 [P] [US5] Delete `src/routes/api/journal/stream/+server.ts` — its work moved to `/api/records/stream`, including the `settlement-changed` event it deliberately omitted (contracts/events.md) (depends on T026)
- [X] T081 [P] [US5] Delete `src/lib/components/expenses/` and `src/lib/components/income/` and `src/lib/components/journal/` (`JournalPage.svelte`, `JournalSheet.svelte`) — `journal-rules.ts` already moved in T045 (depends on T028, T045, T078)
- [X] T082 [US5] Delete `src/lib/server/loaders/ledger.ts` and `src/lib/server/loaders/journal.ts`, now that `loaders/records.ts` serves both routes (depends on T024, T078)
- [X] T083 [US5] Delete `findByLegacy` from `src/lib/server/queries/ledger.ts` (lines 529–545). The `legacy_kind` / `legacy_id` columns and their unique index **stay** — they are provenance, and FR-037 does not name them; only the lookup goes (FR-025a, R-06) (depends on T024, T082)
- [X] T084 [P] [US5] Write a test asserting that a saved mobile-nav preference naming a removed screen resolves to a working navigation — `src/lib/server/navPreferences.ts:34` already skips any `itemId` not in `DEFAULT_NAV_ITEMS` and `setUserNavOrder` drops unknown ids on save, so FR-026 needs a test, not code (research.md correction 5, FR-026) (depends on T038)
- [X] T085 [US5] Run the SC-005 gate: no file in `src/` references `/expenses`, `/income`, `/journal`, `/api/expenses`, `/api/income` or `/api/journal`. Fix every hit (quickstart "Definition of done") (depends on T078, T079, T080, T081, T082, T083)

**Checkpoint**: `bun run check` and `bun run lint` pass with the three screens gone. Every in-app link
opens a record on Records. Nothing redirects, and nothing needs to.

---

## Phase 9: User Story 8 - Checking an account against its bank statement, from the account (Priority: P2)

**Goal**: Reconciling is reached from the account it belongs to, at two full-page addresses under
`/accounts/[id]/reconcile`; the top-level Reconciliation item goes; and the cross-account
still-to-clear worklist becomes a filter on Records.

**Independent Test**: With no Reconciliation item in the menu, a user opens a bank account, uploads
that account's statement, matches its lines, and finishes the statement — and can still see
everything awaiting clearing across all accounts from the Records screen.

**Note**: this is the largest single piece of work in the feature — a 2,852-line component divided by
surface, not by size. **Nothing about reconciling's behaviour changes** (FR-034, FR-051, FR-057).

### Tests for User Story 8 (Principle V — money arithmetic is silent when wrong) ⚠️

> Write this FIRST and confirm it FAILS before implementing.

- [X] T086 [P] [US8] Write a failing test `src/lib/server/ledger/coverage.spec.ts` over plain rows: nothing allocated, part allocated, exactly covered, over-covered, and a record touching one account twice. Assert invariant 10 — `clearedMinor` never exceeds the record's own `amountMinor`, and `cleared` is true **exactly** when they are equal (data-model.md §6, R-08, R-14)

### Implementation for User Story 8 — the cleared filter (FR-056)

- [X] T087 [US8] Implement `src/lib/server/ledger/coverage.ts` — pure, whole cents, no float arithmetic, using `ledger/money.ts` as the only converter. `cleared` is amount-aware so FR-056's filter agrees with the workspace it replaces; `reconciled` stays existence-based so `locked` keeps refusing an amount change on any matched record (R-08). T086 goes green (depends on T009, T086)
- [X] T088 [US8] Add the `clearedMinor` grouped aggregate over `reconciliation_allocations` to `listRecords()` in `src/lib/server/queries/ledger.ts`, beside the coverage subquery the list already carries, and apply the `cleared` filter. One grouped aggregate, no new query shape on a hot path (plan.md performance goals) (depends on T087, T023)
- [X] T089 [US8] Replace the `cleared` stub in `src/routes/api/records/+server.ts` with the real value from T088, so `reconciled`, `cleared` and `clearedMinor` all return the truth (contracts/api.md) (depends on T025, T088)
- [X] T090 [US8] Add the "not yet cleared" filter option to `src/lib/components/records/RecordsPage.svelte`, covering **every** account rather than only those with an uploaded statement, and show the cleared label on the row. Reconciling MUST NOT be startable from this filter — it is a worklist, not a second way in (FR-056, US8 scenario 6) (depends on T030, T037, T089)

### Implementation for User Story 8 — reconciling under the account

- [X] T091 [US8] Move `POST /api/reconciliation/statements` to `src/routes/api/accounts/[id]/reconciliation/statements/+server.ts`, taking the account **from the path**. Delete the `accountId` form field and the `400` "Choose the account this statement belongs to" refusal with it. Keep the `reconciliation` resource check, the Zod boundary, the `recordAudit` call and the `reconciliationEvents` emit exactly where they are. `createStatement`'s money-holding validation stays (FR-050, FR-049, FR-057, contracts/api.md) (depends on T013)
- [X] T092 [US8] Remove the POST handler from `src/routes/api/reconciliation/statements/+server.ts`, keeping its GET. Every other reconciliation endpoint is unchanged, including `PATCH /api/reconciliation/statements/[statementId]` — the move-to-another-account action that makes FR-054 reachable (contracts/api.md) (depends on T091)
- [X] T093 [US8] Scope `src/lib/server/loaders/reconciliation.ts` to one account and one statement, so each new surface loads only what it shows (depends on T091)
- [X] T094 [US8] Create `src/lib/components/reconciliation/AccountStatements.svelte` from the statement-list, upload, retry and move-to-another-account parts of `ReconciliationPage.svelte`. **Delete the upload account picker outright** — the route supplies the account. An account with no statement yet, and one never reconciled, both read as a normal starting state rather than as something missing (FR-050, FR-054, edge case, R-09) (depends on T093)
- [X] T095 [US8] Create `src/lib/components/reconciliation/StatementMatch.svelte` from the bank-lines, candidate-records, allocation-composer and auto-match parts of `ReconciliationPage.svelte`, as a full-width working surface showing lines, candidates and the current selection together. The candidate rule is **unchanged**: only movements on the statement's own account are ever offered, enforced in `listMovementCandidates` and again in `suggestLinesForMovement` (FR-051, FR-052, R-09) (depends on T093)
- [X] T096 [US8] Drop the "Akaun Records" tab and its "Needs Review" status filter while splitting `src/lib/components/reconciliation/ReconciliationPage.svelte` — neither is carried into `AccountStatements.svelte` or `StatementMatch.svelte` — that question is now T090's filter on Records (R-09, D-06) (depends on T090, T095)
- [X] T097 [P] [US8] Create `src/routes/(app)/accounts/[id]/reconcile/+page.svelte` and `+page.server.ts` rendering `AccountStatements`, gated on `reconciliation` and refusing an account that is not a money pot (FR-048, FR-049) (depends on T094)
- [X] T098 [P] [US8] Create `src/routes/(app)/accounts/[id]/reconcile/[statementId]/+page.svelte` and `+page.server.ts` rendering `StatementMatch` — its own shareable address, which the matching surface has never had (FR-052, research.md correction 1) (depends on T095)
- [X] T099 [US8] Filter the `reconciliationEvents` snapshot client-side in both new components — the stream still sends a full snapshot on connect, and each surface is scoped to one account, so it narrows what it receives rather than asking for a narrower feed. Open the `EventSource` in `onMount`, close it in `onDestroy` (contracts/events.md) (depends on T097, T098)
- [X] T100 [US8] Add the "Check against the bank" relation card to `src/lib/components/accounts/AccountSheet.svelte` in the single-record-reference shape — 34×34 icon box, radius 7, `background: var(--accent)`, grey second line saying whether a reconciliation is part-way through, trailing `ChevronRight`, whole element a `<button type="button">` with the `related-link` class. Offered **only** on money-holding accounts and only with the `reconciliation` ability (FR-048, FR-049, FR-053, `CLAUDE.md` relation-card contract) (depends on T097)
- [X] T101 [US8] Add the statements-in-progress count to `src/lib/server/loaders/accounts.ts` so T100's card can say whether anything is unfinished — there is no longer a top-level list where an unfinished one would be noticed (FR-053, edge case) (depends on T100)
- [X] T102 [P] [US8] Delete `src/routes/(app)/reconciliation/` entirely, including the empty `[id]/match` shells commit `e5568b1f` left behind, and delete `src/lib/components/reconciliation/ReconciliationPage.svelte` (2,852 lines) (depends on T094, T095, T097, T098)
- [X] T103 [US8] Remove the Reconciliation item from `src/lib/nav-config.ts`, leaving Dashboard, Records, Accounts, Contacts, Quotations, Invoices, Auto Import and Reports — eleven items become eight (FR-023, FR-048) (depends on T038, T102)

**Checkpoint**: Reconciling is reached only from a money-holding account, the matching workspace has a
real shareable address for the first time, the nav has eight items, and the cross-account worklist
lives on Records as a filter. No reconciliation behaviour changed.

---

## Phase 10: User Story 7 - The remains of the old shape are cleared away (Priority: P3) — last

**Goal**: Nine tables, three columns and three code lists go; `bank_statements.account_id` becomes
required; the conversion code retires with the tables it reads. Nothing a user sees changes.

**Independent Test**: After the change the whole-books check still passes, every figure on every
report is identical to before, and every attachment still opens.

**⚠️ IRREVERSIBLE.** This phase is last because steps in Phase 2 and Phase 9 remove its last readers,
and because there is no in-app way back. Do not begin until T006 and T008 are green and T085 passes.

### Tests for User Story 7 (Principle V — wrong once, and an installation's records are gone) ⚠️

> Write this FIRST and confirm it FAILS before implementing.

- [X] T104 [P] [US7] Write a failing test `src/lib/server/db/legacy-drop-guard.spec.ts` over plain state: tables absent (**allow**); present with zero rows (**allow**); present with rows and phase `done` (**allow**); present with rows and phase not `done` (**the only refusal**); phase missing entirely. Assert the refusal carries the exact sentence naming the previous release to install first (R-05, R-14)

### Implementation for User Story 7

- [X] T105 [US7] Implement `src/lib/server/db/legacy-drop-guard.ts` — `legacyDropAllowed({ legacyTablesPresent, legacyRowCount, upgradePhase }): Allowed`, pure, no database. Three answers, one refusal (R-05, quickstart Part 2). T104 goes green (depends on T104)
- [X] T106 [US7] Create `src/lib/server/db/seed-accounts.ts` by rescuing the **fresh-install half** of `seedAccounts()` from `src/lib/server/ledger/upgrade/accounts.ts` — the default expense and income categories and the guaranteed "Sales" income account the invoice flow defaults to — stripped of every legacy read (R-06)
- [X] T107 [US7] Call the guard in `src/lib/server/db/client.ts` **immediately before `migrate(db, …)`** on line 30, reading `sqlite_master` and the `settings.ledger_upgrade_state` row through Drizzle's raw `sql` escape hatch. On refusal the server does not start and prints the one plain sentence; the database is left byte-identical (FR-037a, R-05, plan.md Complexity Tracking) (depends on T105)
- [X] T108 [US7] Call `seedAccounts()` from the normal seed path in `src/lib/server/db/client.ts`, beside `ensureGroupSeed()` and `applyRecordsPermission()` (depends on T106, T012)
- [X] T109 [US7] Remove the nine deprecated tables from `src/lib/server/db/schema.ts` — `expenseSearchText`, `incomeSearchText`, `expenseAttachments`, `incomeAttachments`, `claimAttachments`, `expenses`, `incomes`, `claims`, `categories` (FR-037, data-model.md §1) (depends on T008, T085)
- [X] T110 [US7] Remove `invoices.result_income_id` (schema.ts:526) and `reconciliation_allocations.item_type` / `item_id` from `src/lib/server/db/schema.ts`, and make `bank_statements.account_id` `integer NOT NULL` referencing `accounts.id`. Keep `ledger_records.legacy_kind` / `legacy_id` with their unique index, and `record_attachments.legacy_filename` — FR-037 does not name them and they are the only surviving provenance (FR-037b, R-10, data-model.md §1) (depends on T109)
- [X] T111 [US7] Generate the migration with `bunx drizzle-kit generate` into `drizzle/0015_*.sql`, then **hand-order its statements FK-safely** and commit it: (1) the five leaf tables; (2) rebuild `invoices` without `result_income_id`; (3) `expenses`, then `incomes`, then `claims`; (4) `categories`; (5) rebuild `reconciliation_allocations` without `item_type` / `item_id`. Drizzle wraps each migration in `BEGIN … COMMIT`, so `PRAGMA foreign_keys = OFF` is a no-op and the order is load-bearing (data-model.md §1, R-05) (depends on T110)
- [X] T112 [US7] Add the `bank_statements.account_id` backfill to `drizzle/0015_*.sql` **before** the NOT NULL constraint — set any remaining null to the seeded default money-holding account, exactly as the earlier conversion's `backfillReconciliation` did (R-10, data-model.md §2) (depends on T111)
- [X] T113 [US7] Delete `src/lib/server/ledger/upgrade/**` — `accounts.ts`, `attachments.ts`, `convert.ts`, `convert.spec.ts`, `guard.spec.ts`, `index.ts`, `payer.ts`, `payer.spec.ts`, `reconciliation.ts`, `verify.ts`, `verify.spec.ts` — and remove the `ensureLedgerUpgrade` call from `src/hooks.server.ts:28`. Every file reads a dropped table, so the module cannot compile once T109 lands (R-06) (depends on T106, T107, T109)
- [X] T114 [US7] Remove `ExpenseStatus` and `ClaimStatus` with their label maps and Zod enums from `src/lib/enums.ts`. **`DocumentType` stays** — it is still live in the import pipeline (FR-037, plan.md source tree) (depends on T109)
- [X] T115 [P] [US7] Remove the now-unreachable `ExpenseStatus` numeric branch from `src/lib/components/ui/StatusBadge.svelte` — every caller already passes a label string (plan.md source tree) (depends on T114)
- [X] T116 [US7] Verify the migration on a **copy**: `mkdir -p /tmp/akaun-003 && cp data/backups/pre-003-*.db /tmp/akaun-003/probe.db`, hash `data/akaun.db` before and after to prove the real file is untouched, then run the six checks in quickstart Part 3 — nine tables gone; `invoices` lost one column and kept every row and every `ledger_record_id`; `reconciliation_allocations` lost two columns and kept every `movement_id`; zero null `bank_statements.account_id`; no permission row naming `expenses`, `income` or `journal`; `GET /api/ledger/integrity` returns `ok: true, booksBalance: true` (FR-038a, SC-004, SC-006) (depends on T112, T113)
- [X] T117 [US7] Verify the **refusal path**, which matters more than the success path: take a copy whose `settings.ledger_upgrade_state` phase is anything but `done` while the legacy tables still hold rows, start the server, and confirm it refuses, prints the sentence naming the previous release, and leaves the file **byte-identical** — `shasum -a 256` before and after must match exactly (FR-037a, quickstart Part 3) (depends on T107, T116)
- [X] T118 [US7] Verify figures identical before and after (SC-003, FR-039): capture `profit-loss`, `balance-sheet`, `partner-statement` and every `balanceMinor` from the post-migration copy into `/tmp/akaun-003/after/` over the same dates as T002, and `diff` each against `/tmp/akaun-003/before/`. Every diff must be **empty** (depends on T116, T002)
- [X] T119 [US7] Verify every attachment (FR-039): every row in `record_attachments` still resolves to a file on disk, and every one now **downloads** rather than returning `403` — the check T005 and T006 made possible (depends on T006, T116)

**Checkpoint**: The nine tables are gone, the whole-books check passes, every report figure is
byte-identical to the baseline, and an unconverted installation refuses to start without changing a
byte.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: The documentation Principle VI requires to change in the same commit, and the gates.

- [X] T120 Amend `CLAUDE.md`'s **named-URL exception** table: every kind now has one list and one deep link at `/records/[id]`, so the Payment / Transfer / OpeningBalance / InvoiceIssue table's reason for existing changes, and `SettlementList`'s `canOpen` — documented as the one function to update — is now the function that opens every kind (quickstart Part 6, Principle VI)
- [X] T121 Rewrite `CLAUDE.md`'s **per-feature deep-link pattern** around Records: three features collapsed into one, so the "one shared page component, two small routes, one shared loader" example is now `RecordsPage.svelte` + `/records` + `/records/[id]` + `loaders/records.ts` (quickstart Part 6)
- [X] T122 Amend `CLAUDE.md`'s **"Named full-page exception"**: `/accounts/[id]/history` is retired, so the accounts split it describes — drawer at `/accounts/[id]`, report at `/accounts/[id]/history` — no longer exists. Reports remain full pages (quickstart Part 6, D-05)
- [X] T123 Amend `CLAUDE.md`'s **"Named exception — task workspaces"**, which is **already false**: it cites `/reconciliation/[id]/match`, a route commit `e5568b1f` deleted. Re-point it at `/accounts/[id]/reconcile/[statementId]`, the real address FR-052 creates (quickstart Part 6, research.md correction 1)
- [X] T124 Amend `CLAUDE.md`'s **`$lib/server` hand-mirror list**: `components/accounts/display-sign.ts` keeps its mirror with its `ROLE_GROUPS` consumer removed, `journal-rules.ts` now lives in `components/ledger/`, and any new client mirror needs its `// Mirrors …` comment (quickstart Part 6)
- [X] T125 Amend `CLAUDE.md`'s **permissions section**: `ResourceName` is now `dashboard | records | import | contacts | quotations | invoices | reconciliation | accounts | reports | adjustments`. `reports` stays view-only; **no seeded group grants `adjustments`**, replacing the same note about `journal` (data-model.md §3, FR-031a)
- [X] T126 [P] Correct the stale `apiBase` doc comment in `src/lib/components/ui/AttachmentManager.svelte` (plan.md source tree)
- [X] T127 Finish `docs/RELEASE_NOTES_003.md`: the destructive-change warning and back-up instruction lead it (T003), followed by the eight-item navigation, the one Records screen, the `records` / `adjustments` abilities, reconciling from the account, and the instruction to restore from backup if the whole-books check fails (FR-038, US7 scenarios 4 and 5) (depends on T003, T117)
- [X] T128 Run the gates with **no dev-server tab open**: `bun run check`, `bun run lint`, `bun run test` (both projects — `server` under Bun, `client` under Node). If a tab was open, stop the server, `rm -rf node_modules/.vite`, restart, reload (quickstart Part 1, `CLAUDE.md` gotcha)
- [X] T129 Delete any test that no longer describes a real rule — the `upgrade/**` specs go with T113, and no spec anywhere references the `/expenses`, `/income` or `/journal` routes, loaders or endpoints, so the URL removal breaks nothing (Principle V, R-14) (depends on T113, T128)
- [X] T130 Re-run the SC-005 grep as a final gate, then walk the **Definition of done** checklist at the end of `quickstart.md` and tick every line (depends on T085, T118, T119, T127, T128)
- [ ] T131 **[MAINTAINER]** Confirm the 30 checks in `quickstart.md` Part 5 in the running app — US1 one list, US2 one form, US3 flat accounts, US4 one place for categories, US5 no dead links, US6 one permission, US8 reconciling from the account — including SC-009: no horizontal scrolling on either list at mobile width (depends on T130)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T002's baseline capture is **required** by T118 — skipping it makes SC-003 unmeasurable.
- **Foundational (Phase 2)**: depends on Setup. **Blocks every user story.** T009 (`types.ts`) is read by US1, US2, US3 and US8; T006 and T008 must be green before Phase 10.
- **US6 (Phase 3)**: depends on Foundational. Blocks US1, US2, US3, US8 — they all gate on `records`.
- **US1 (Phase 4)**: depends on US6. **MVP boundary.**
- **US2 (Phase 5)**: depends on US1 (the screen the form opens from) and US6.
- **US3 (Phase 6)**: depends on US6, and on US1 for statement mode (T060 extends `RecordsPage`). T054–T057, the flat list itself, depend on neither and could ship alongside US1.
- **US4 (Phase 7)**: depends on US3 (Accounts must be the only place first) and on US2's `AccountSelect` for T070.
- **US5 (Phase 8)**: depends on US1 (the destination must exist) and US2 (`journal-rules.ts` has moved).
- **US8 (Phase 9)**: depends on US1 (filter chrome), US3 (the account drawer's card shape) and US6.
- **US7 (Phase 10)**: depends on Foundational's two fixes, on US5's T085, and on US8's T102 — those remove its last readers. **Last, and irreversible.**
- **Polish (Phase 11)**: depends on all of the above.

### Within Each User Story

- Tests for Principle V in-scope logic MUST be written and MUST fail before implementation
- Pure rules before the queries that call them; queries before endpoints; endpoints before screens
- Re-point every link **before** deleting its destination (US5's T073–T077 before T078–T083)
- The drop is last inside US7: guard and seed rescue before schema, schema before migration, migration verified on a copy before anything is believed

### Parallel Opportunities

- **Setup**: T003 and T004 in parallel; T001 → T002 is serial.
- **Foundational**: T005+T007 in parallel (two different failing tests), then T006+T009 in parallel while T008 follows T007.
- **US6**: after T013 lands, T015, T016, T017, T019, T020 and T021 are six different files with no shared state — all parallel.
- **US1**: T035 and T036 are two independent route pairs. Everything else touching `RecordsPage.svelte` is **serial** — one file.
- **US3**: T054 is independent. T058→T059 then T060→T062 are serial through `RecordsPage.svelte`.
- **US5**: T073, T074, T075, T076 are four different files, all parallel; then T078, T079, T080, T081 are four independent deletions, all parallel.
- **US8**: T094 and T095 split one source file into two new ones — parallel. T097 and T098 are two independent route pairs.
- **Polish**: T120–T125 all edit `CLAUDE.md` and are **serial**; T126 is independent of them.

### The one file that serialises the most work

`src/lib/components/records/RecordsPage.svelte` is touched by T027–T034, T053, T060–T062 and T090.
None of those carry `[P]`. Do them in listed order and commit after each — that file is the feature.

---

## Parallel Example: User Story 6

```bash
# After T013 changes ResourceName, six files can be updated at once:
Task: "Collapse resourceForKind in src/lib/server/ledger/record-permissions.ts"
Task: "RESOURCES array + descriptions in src/routes/(app)/users-groups/+page.svelte"
Task: "RESOURCES array + descriptions in src/routes/api/groups/[id]/permissions/+server.ts"
Task: "Gate src/routes/api/records/[id]/+server.ts on records"
Task: "Gate src/routes/api/records/[id]/attachments/** on records"
Task: "Gate src/routes/api/records/[id]/settlements/+server.ts on records view"
```

## Parallel Example: User Story 5

```bash
# Four link re-points, four different files:
Task: "recordPathFor -> /records/[id] in src/lib/components/reports/report-links.ts"
Task: "redirect / -> /records in src/routes/+page.server.ts"
Task: "canOpen opens every kind in src/lib/components/ledger/SettlementList.svelte"
Task: "badgeFor 'expenses' -> 'records' in Sidebar.svelte and BottomNav.svelte"

# Then four deletions, once nothing points at them:
Task: "Delete src/routes/(app)/expenses|income|journal/"
Task: "Delete src/routes/api/expenses/** and src/routes/api/income/**"
Task: "Delete src/routes/api/journal/stream/+server.ts"
Task: "Delete src/lib/components/expenses|income|journal/"
```

---

## Implementation Strategy

### MVP First

1. **Phase 1 Setup** — capture the baseline. Without T002 there is nothing to prove SC-003 against.
2. **Phase 2 Foundational** — two live defects fixed, `types.ts` frozen once.
3. **Phase 3 US6** — merge the permission before merging the screens: one gate change per route.
4. **Phase 4 US1** — the one Records screen. **STOP and VALIDATE**: quickstart Part 5's US1 checks.
5. Deploy/demo. The old screens still work at this point, so this is a safe stopping place.

### Incremental Delivery

Each phase below is independently shippable and independently verifiable:

1. Setup + Foundational → attachments download, Auto Import sees real records
2. + US6 → one records ability, nobody's access changed (SC-006)
3. + US1 → **MVP**: one list, one connection, one address per record
4. + US2 → one form, kind derived, `adjustments` enforced server-side
5. + US3 → flat searchable accounts, statement mode, one endpoint for one question
6. + US4 → categories in one place, Settings tab gone
7. + US5 → nothing points at a gone screen; three screens deleted
8. + US8 → reconciling from the account, eight nav items, cleared filter
9. + US7 → the remains cleared. **Irreversible — back up first.**
10. + Polish → `CLAUDE.md` true again, gates green, release notes lead with the warning

### If work has to stop early

Stop **after any checkpoint except inside Phase 10**. Phases 1–9 are net-additive to the data: they
change surfaces, addresses and permissions, and every one of them is reversible by reverting code.
Phase 10 is the only phase that destroys data, which is why it is last and why FR-038's warning leads
the release notes.

---

## Notes

- `[P]` = different files, no dependencies. Absence of `[P]` on consecutive tasks usually means they
  share one file — most often `RecordsPage.svelte`, `db/client.ts` or `queries/ledger.ts`.
- `[MAINTAINER]` marks the two tasks an agent must not do: the backup inside `data/` (T001) and the
  in-app confirmation (T131).
- Commit after each task or logical group. T027 in particular must be committed as a **pure copy** so
  the diffs that follow it are readable.
- Every mutating endpoint keeps all four obligations — `hasPermission`, Zod at the boundary,
  `recordAudit`, SSE emit. **This feature adds no mutating endpoint**: one moves (T091) and ten
  retire, which is why three streams became one without touching a single service.
- Money stays whole cents in a signed integer. Never sum the decimal `amount` into a total.
  `ledger/money.ts` is the only converter and `displaySign` is the only place a sign flips.
- `entry-builder.ts` stays the only place movements are constructed. `sides-from-accounts.ts` builds
  none — if it ever does, that is a defect.
