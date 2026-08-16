# Tasks: Double-Entry Ledger

**Input**: Design documents from `/specs/002-double-entry-ledger/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/api.md](./contracts/api.md),
[contracts/events.md](./contracts/events.md), [quickstart.md](./quickstart.md)

**Tests**: Governed by Constitution Principle V. Test tasks appear **only** for the modules
research.md D-22 puts in scope — the pure rule modules, the three reports, the CSV formatter, the
upgrade verification and conversion, and the updated reconciliation matching. They are ordered
before their implementation task and must fail first. No test tasks exist for Svelte components,
route wiring, drawer chrome, schema definitions or generated migrations, and none may be added to
reach a coverage number.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested and
delivered independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on an incomplete task
- **[Story]**: Which user story the task belongs to (US1–US6)
- Every task names its exact file path

## Path Conventions

Single SvelteKit codebase (Constitution Principle I). Routes at `src/routes/(app)/<feature>/`,
API at `src/routes/api/<feature>/`, shared page components at `src/lib/components/<feature>/`,
rules at `src/lib/server/ledger/`, writes at `src/lib/server/services/`, reads at
`src/lib/server/queries/`, schema at `src/lib/server/db/schema.ts` generated into `drizzle/`.
Tests are colocated `*.spec.ts` in the Vitest `server` project.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Land every change to a file that *everything else touches*, once, so no later task has
to queue behind another for the same file. This phase is deliberately narrow and deliberately
serial — it is the whole feature's critical path.

- [X] T001 Add `AccountRole`, `AccountType` and `LedgerRecordKind`, add `Role.Partner = 4`, and mark `ReconItemType` retired-but-reserved with a comment, in `src/lib/enums.ts` (data-model.md § Enums)
- [X] T002 Add the six new tables — `accounts`, `ledger_records`, `ledger_movements`, `settlements`, `record_attachments`, `record_search_text` — with every column, foreign key and index from data-model.md, to `src/lib/server/db/schema.ts`
- [X] T003 Alter `bank_statements` (add `account_id` NOT NULL → `accounts.id`), `reconciliation_allocations` (add `movement_id` → `ledger_movements.id` with unique `(line_id, movement_id)`; leave `item_type`/`item_id` nullable and unread), `invoices` (add `income_account_id`, `ledger_record_id`), and `import_queue` (add `account_id` → `accounts.id`, nullable — FR-019), and add a `@deprecated` comment naming the release that drops each legacy table (`expenses`, `incomes`, `claims`, their three attachment tables, their two search-text tables, `categories`) in `src/lib/server/db/schema.ts` (D-17)
- [X] T004 Generate and commit the migration with `bunx drizzle-kit generate` into `drizzle/0014_*.sql`, then read the SQL to confirm it creates six tables, alters four, and contains no `DROP TABLE` (D-17, Constitution: migrations additive)
- [X] T005 Create `src/lib/server/ledger/types.ts` holding the row and DTO types, the `Minor` cent alias, and the **exported signature of every function** in `src/lib/server/ledger/*` and `queries/{ledger,accounts,settlements,reports}.ts` — this is the interface freeze that lets Phase 2 fan out; no bodies, no logic
- [X] T006 [P] Remove `claims` and add `accounts`, `reports`, `journal` to `ResourceName` / `ALL_RESOURCES` in `src/lib/server/permissions.ts` (D-20)
- [X] T007 [P] Remove the `claim` `RecordType` and add `record`, `account`, `settlement` in `src/lib/server/audit.ts` (FR-041)
- [X] T008 [P] Create `src/lib/server/ledger/events.ts` exporting `ledgerEvents` and `accountEvents`, each with `setMaxListeners(200)`, following `src/lib/server/import/events.ts` (contracts/events.md, D-21)
- [X] T009 [P] Rename the sequence document type keyed `claim` to `payment`, keeping code `2` and the `CL` prefix, with the comment explaining why the prefix cannot change, in `src/lib/sequence-template.ts` (D-13, FR-032e)
- [X] T010 [P] Seed the new permissions in `src/lib/server/db/client.ts` — Bookkeeper gains view/add/change on `accounts` and view on `reports`, Reviewer gains view on both, Data Entry gains neither, no group gets `journal`; remove every `claims` seed; and delete `ensureDefaultCategories()`, whose job passes to the upgrade's account seeding (T055), so the deprecated `categories` table stops being written on every boot (D-20, FR-040, D-17)

**Checkpoint**: `bun run check` passes. Every shared file is settled; Phase 2 can fan out with no
two agents writing the same file.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The rules, the data access, the write path, the accounts screen and the shared record
drawer. Every user story sits on this.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests for the pure rule modules (write first, watch fail — Principle V, D-22)

- [X] T011 [P] Unit test conversion to cents at the record's own stored rate, one payment split three ways still summing to the original, and a rate of 1 converting exactly, in `src/lib/server/ledger/money.spec.ts` (FR-005, rounding edge case)
- [X] T012 [P] Unit test the role → type map and the display sign for every role, in `src/lib/server/ledger/account-type.spec.ts` (D-05)
- [X] T013 [P] Unit test that every kind's movements sum to zero, a one-sided record is refused, a record touching a shared owed account with no contact is refused, and a transfer to the same account is refused, in `src/lib/server/ledger/entry-builder.spec.ts` (FR-001, FR-002, FR-007, FR-008)
- [X] T014 [P] Unit test outstanding/paid derivation, over-allocation refused with the figure still available, a partial payment leaving the right remainder, two payments settling one item, and undo restoring both sides, in `src/lib/server/ledger/settlement-rules.spec.ts` (FR-015–FR-018, SC-006)
- [X] T015 [P] Unit test that amount, date and account are refused while settled or reconciled, that description, contact, reference, remark and attachments stay allowed, and that the refusal names what unlocks, in `src/lib/server/ledger/locking.spec.ts` (FR-017a, SC-012)
- [X] T016 [P] Unit test that an unbalanced record is reported with its difference, a balanced set reports clean, and the whole-books sum is checked, in `src/lib/server/ledger/integrity.spec.ts` (FR-003)

### Implementation of the pure rule modules

- [X] T017 [P] Implement entered-amount → cents conversion, splitting and rounding in `src/lib/server/ledger/money.ts`
- [X] T018 [P] Implement the role → type map and the display sign in `src/lib/server/ledger/account-type.ts`
- [X] T019 Implement one builder per `LedgerRecordKind` plus the balance and contact rules in `src/lib/server/ledger/entry-builder.ts` — the **single** place movements are constructed (depends on T017, T018; data-model.md § How each kind of record is built)
- [X] T020 [P] Implement outstanding, paid, over-allocation and undo arithmetic in `src/lib/server/ledger/settlement-rules.ts`
- [X] T021 [P] Implement the settled-or-reconciled field lock, returning the field list and the unlock reason, in `src/lib/server/ledger/locking.ts`
- [X] T022 [P] Implement per-record and whole-books balance checks, including invariant 6 (entered amount versus movements), in `src/lib/server/ledger/integrity.ts`
- [X] T023 Delete the claim rules from `src/lib/server/locking.ts`, re-export `ledger/locking.ts` from it, and update `src/lib/server/locking.spec.ts` to the surviving rules (Principle V: delete tests that no longer describe a real rule)

### Data access

- [X] T024 [P] Implement the chart of accounts, per-account balance (`SUM(amount_minor)`), movement count and can-delete reads in `src/lib/server/queries/accounts.ts`
- [X] T025 [P] Implement record + movement reads and writes — the filtered list with derived `paid` / `outstandingMinor` / `locked`, single read, insert, update, delete — in `src/lib/server/queries/ledger.ts` (contracts/api.md § Records; D-10)
- [X] T026 [P] Implement outstanding-item reads, per-contact balances and the ageing bands in `src/lib/server/queries/settlements.ts`

### Write path (permission + Zod + audit + emit)

- [X] T027 Implement create, rename, archive, delete and opening-balance writes in `src/lib/server/services/accounts.ts`, refusing deletion of a system account or one holding movements (FR-009; depends on T019, T024)
- [X] T028 Implement record create/update/delete in `src/lib/server/services/ledger.ts`, composing `entry-builder.ts`, enforcing the lock rules, recording audit and emitting on `ledgerEvents` (depends on T019, T021, T025)
- [X] T029 Implement settlement create and undo in `src/lib/server/services/settlements.ts`, refusing over-allocation, different accounts and different contacts, with audit and a `settlement-changed` emit (FR-041; depends on T020, T026)

### Endpoints

- [X] T030 Implement `GET`/`POST` in `src/routes/api/accounts/+server.ts` — permission `accounts` view/add, Zod body, reject `contactId` on create, audit, emit (contracts/api.md)
- [X] T031 Implement `PATCH`/`DELETE` in `src/routes/api/accounts/[id]/+server.ts`, returning `409` with the plain reason the disabled button's tooltip shows
- [X] T032 Implement `PUT` in `src/routes/api/accounts/[id]/opening-balance/+server.ts`, creating or replacing the single opening-balance record against the Opening balances account (FR-010)
- [X] T033 Implement `GET` in `src/routes/api/accounts/[id]/movements/+server.ts` returning the account's history with a running balance (FR-028)
- [X] T034 Implement the SSE stream in `src/routes/api/accounts/stream/+server.ts` — `accountEvents`, no snapshot, `accounts` view permission (contracts/events.md)
- [X] T035 Implement `GET`/`POST` in `src/routes/api/records/+server.ts`, mapping `kind` to the permission resource (`expense`→expenses, `income`→income, `journal`→journal) and accepting the everyday-terms body shapes, never raw movements except for a journal entry (FR-020)
- [X] T036 Implement `GET`/`PATCH`/`DELETE` in `src/routes/api/records/[id]/+server.ts`, refusing locked-field edits and deletion with `409` and a reason naming what to undo (FR-017a)
- [X] T037 Implement `POST` in `src/routes/api/records/[id]/attachments/+server.ts` and `DELETE` in `src/routes/api/records/[id]/attachments/[attachmentId]/+server.ts`, writing into `records/YYYY/MM/`
- [X] T038 Implement `GET`/`POST` in `src/routes/api/settlements/+server.ts` (contracts/api.md § Settlements)
- [X] T039 Implement `DELETE` in `src/routes/api/settlements/[id]/+server.ts` (FR-017)
- [X] T040 Implement `GET` in `src/routes/api/ledger/integrity/+server.ts` returning `{ ok, recordsChecked, unbalancedRecords, totalDifferenceMinor, elapsedMs }` under `reports` view (FR-003, SC-002)

### Storage, search and shared UI

- [X] T041 Add the `records/YYYY/MM/` layout and the copy → hash-verify → deferred-remove helpers to `src/lib/server/file-storage.ts` (D-16, FR-032b)
- [X] T042 Repoint search text building at `record_search_text` in `src/lib/server/search-text.ts` and the rebuild worker in `src/lib/server/search-rebuild/worker.ts`, folding every reference number in exactly as typed (SC-013)
- [X] T043 Implement the accounts loader in `src/lib/server/loaders/accounts.ts` (shared by `/accounts` and `/accounts/[id]`)
- [X] T044 Build the chart of accounts with balances in `src/lib/components/accounts/AccountsPage.svelte`, grouped by role, opening its `EventSource` in `onMount` and closing it in `onDestroy`
- [X] T045 Build add/edit/archive in `src/lib/components/accounts/AccountSheet.svelte` per the Sheet standard, with the delete button visible-and-disabled plus tooltip when blocked (CLAUDE.md § Drawer standard, FR-009)
- [X] T046 Build `src/lib/components/accounts/OpeningBalanceSheet.svelte` per the Sheet standard (FR-010)
- [X] T047 Add the routes `src/routes/(app)/accounts/+page.server.ts`, `+page.svelte`, `[id]/+page.server.ts` and `[id]/+page.svelte`, both delegating to the shared loader and passing `openId` (CLAUDE.md § Deep-link pattern)
- [X] T048 Build `src/lib/components/ledger/AccountSelect.svelte` — one control answering "which account paid?", defaulting to `ledger_default_account_id` and never asked twice when only one exists (FR-011, SC-009)
- [X] T049 Remove Claims and add Accounts, Reports and Journal in `src/lib/nav-config.ts`
- [X] T050 Build the shared record detail/edit drawer `src/lib/components/ledger/RecordSheet.svelte` — hero amount, `StatusBadge` under it, `AttachmentManager` then `AuditTrail` at the bottom, sticky `.sheet-foot`, `gap:0` on `Sheet.Content` (CLAUDE.md § Drawer standard)

**Checkpoint**: The rules are proved by their tests, the chart of accounts works end to end, and the
one record store is readable and writable. All user stories can now start in parallel.

---

## Phase 3: User Story 1 — Nothing you already have is disturbed (Priority: P1) 🎯 MVP

**Goal**: An existing installation updates itself at startup with no command, converts every
expense, income and claim into records, movements and settlements, moves the attachment files,
repoints every bank match, and proves the result matches what was there before.

**Independent Test**: Copy a database with real data, capture the baseline in quickstart.md
Scenario 1, start the app, and confirm every headline total, category total, record count,
reference number and attachment hash is identical. Restart and confirm nothing is duplicated. Kill
the process mid-attachment-phase, restart, and confirm the same result.

### Tests for User Story 1 (Principle V in scope) ⚠️

- [X] T051 [P] [US1] Unit test that totals, record counts, reference numbers and attachment hashes are compared before and after, and that a deliberately corrupted "after" is reported rather than passed, in `src/lib/server/ledger/upgrade/verify.spec.ts` (SC-001, SC-013, SC-014)
- [X] T052 [P] [US1] Against a **real temporary SQLite database** seeded with legacy rows, test that a done claim produces a payment plus settlements, a pending claim leaves the amounts outstanding, the resolved payer contact is written onto both the payment and the expenses it covers, and a second run changes nothing, in `src/lib/server/ledger/upgrade/convert.spec.ts` (FR-035–FR-037)
- [X] T053 [P] [US1] Unit test the payer resolution over plain rows with no database — an email match wins, then a name match, the seeded administrator resolves through the installation's one real user, none or two real users make it create instead, a user with a null name is named from its username then its email local part, an unpaid unclaimed expense naming a contact stays owed, and one naming nobody falls back to the bank and is reported — in `src/lib/server/ledger/upgrade/payer.spec.ts` (FR-036b, FR-036c)

### Implementation for User Story 1

- [X] T054 [P] [US1] Implement the four ordered resolution steps, the naming fallback chain and the unpaid-unclaimed rule as pure functions over plain rows, each returning which step decided so the report can name it, in `src/lib/server/ledger/upgrade/payer.ts` (FR-036b, FR-036c)
- [X] T055 [US1] Implement the account seeding — Bank Account, Money owed to us, Money we owe, Opening balances, Uncategorised, plus one account per `categories` row and per distinct category string found in the data — in `src/lib/server/ledger/upgrade/accounts.ts`, writing `ledger_default_account_id` into `settings`. It MUST be idempotent and MUST run on a fresh database as well as an existing one: where there are no `categories` rows to convert, it seeds the default set of category accounts directly, so a new installation comes up with the same categories it gets today (FR-032a, FR-033, D-06)
- [X] T056 [US1] Implement the expenses/incomes/claims → records + movements + settlements conversion in `src/lib/server/ledger/upgrade/convert.ts`, preserving expense ids, allocating every other record an id above the highest old expense id, keying idempotency on `(legacy_kind, legacy_id)`, and delegating every payer decision to `upgrade/payer.ts` — reading the users and contacts it needs, applying what it returns, and writing each attribution with its deciding step into the upgrade report (depends on T054; FR-036b, FR-036c, D-14, data-model.md § What the upgrade converts)
- [X] T057 [US1] Implement the attachment move in `src/lib/server/ledger/upgrade/attachments.ts` — copy, verify by size and SHA-256, rewrite the path, record `legacy_filename`, skip a file already at its destination, report a missing file and leave it pointing where it was, remove no original (FR-032b, D-16)
- [X] T058 [US1] Implement the reconciliation backfill in `src/lib/server/ledger/upgrade/reconciliation.ts` — every allocation repointed to the bank movement of the record it named (for a claim, the payment it became), every `bank_statements` row assigned the default bank account (FR-034, FR-034a, D-11)
- [X] T059 [US1] Implement the before/after comparison in `src/lib/server/ledger/upgrade/verify.ts` — totals at cent precision, record counts, every reference number character for character, attachment count and per-file hash, plus the whole-books balance check (SC-001, SC-002, SC-013, SC-014)
- [X] T060 [US1] Implement the phased orchestration in `src/lib/server/ledger/upgrade/index.ts` — back up the database file to `data/backups/pre-ledger-<timestamp>.db`, take the before snapshot, run phases 3–6, verify, and only then delete the original attachment files; resumable and rerunnable from the `ledger_upgrade_state` settings row; logged through `pino` with no amounts (D-15, FR-037, FR-038)
- [X] T061 [US1] Delete the `claims` rows from `group_permissions` as an upgrade phase in `src/lib/server/ledger/upgrade/index.ts` (D-20)
- [X] T062 [US1] Call the upgrade from `init()` in `src/hooks.server.ts`, after the Drizzle migration and in place of the `ensureDefaultCategories()` call it replaces, beside the remaining `ensureDefault*()` calls, blocking startup until it completes — and confirm a fresh database reaches the first request with its system and category accounts present (D-15, SC-008)
- [X] T063 [US1] Add the legacy deep-link fallback — `/income/[id]` and any stale id resolving through `(legacy_kind, legacy_id)` and redirecting to the record's current URL — in `src/lib/server/loaders/ledger.ts` (D-14)
- [X] T064 [US1] Surface the upgrade report — flagged uncategorised records, missing attachment files, rounding differences, every payer attribution with the step that chose it, and every FR-036c expense sent to the bank because it named nobody — on `src/routes/(app)/settings/+page.svelte`, read from `ledger_upgrade_state`, with a line pointing at contact merge as the way to correct a wrong attribution (FR-036b)
- [X] T065 [US1] Add the "Check the books" action to `src/routes/(app)/settings/+page.svelte`, calling `GET /api/ledger/integrity` and showing the clean result or the named records and their differences (SC-002)
- [X] T066 [P] [US1] Delete `src/routes/(app)/claims/` and `src/routes/api/claims/` (FR-036a)
- [X] T067 [P] [US1] Delete `src/lib/components/claims/`, `src/lib/server/queries/claims.ts`, `src/lib/server/services/claims.ts` and `src/lib/server/loaders/claims.ts` (FR-036a)
- [X] T068 [P] [US1] Delete `claimEvents` from `src/lib/server/finance/events.ts` and the claims stream route, and remove every remaining `claimEvents` import across `src/lib/` and `src/routes/` (contracts/events.md)

**Checkpoint**: A copy of the real database updates itself, verifies clean, survives a restart and
an interruption, and every old link still resolves. This is the MVP — it can ship on its own.

---

## Phase 4: User Story 2 — Shopee income matches the bank deposits (Priority: P1)

**Goal**: Expenses and Income become filtered views of the one store, money can sit in a wallet
account, and a withdrawal is a transfer that matches its bank deposit exactly.

**Independent Test**: quickstart.md Scenario 2 — one statement, one commission, three withdrawals
with one in the next month. The Shopee balance returns to zero, the income stays in the month it
was earned, and neither withdrawal shows as income or expense.

- [X] T069 [US2] Implement the shared loader behind `/expenses` and `/income` in `src/lib/server/loaders/ledger.ts`, filtering by `kind` and redirecting to the bare list when `openId` matches nothing (CLAUDE.md § Deep-link pattern)
- [X] T070 [US2] Repoint `src/lib/components/expenses/ExpensesPage.svelte` at ledger records — derived paid state from settlements, `AccountSelect` for which account paid, category picker reading expense-category **and equipment** accounts so buying something the business keeps is recorded from the same screen with no extra concept, `RecordSheet` for the detail drawer, `ledgerEvents` stream — with the screen and its URLs unchanged (D-01, FR-006b, FR-011, FR-012)
- [X] T071 [US2] Repoint `src/lib/components/income/IncomePage.svelte` the same way, with income-category accounts only — equipment is bought, never earned, so the asymmetry with T070 is deliberate — and "which account received it" (D-01)
- [X] T072 [P] [US2] Update the client-side mirror of the record-locking rule in `ExpensesPage.svelte` and `IncomePage.svelte` with the required `// Mirrors src/lib/server/ledger/locking.ts's <fn> — …` comment (CLAUDE.md § Gotchas)
- [X] T073 [P] [US2] Point `src/routes/(app)/expenses/+page.server.ts`, `+page.svelte`, `[id]/+page.server.ts` and `[id]/+page.svelte` at the shared ledger loader, keeping the URLs exactly as they are
- [X] T074 [P] [US2] Point `src/routes/(app)/income/+page.server.ts`, `+page.svelte`, `[id]/+page.server.ts` and `[id]/+page.svelte` at the shared ledger loader
- [X] T075 [US2] Reduce `src/routes/api/expenses/**` to thin wrappers that set `kind = Expense` and delegate to the records service, so external callers keep working (contracts/api.md)
- [X] T076 [US2] Reduce `src/routes/api/income/**` to thin wrappers that set `kind = Income` and delegate
- [X] T077 [P] [US2] Repoint `src/routes/api/expenses/stream/+server.ts` at `ledgerEvents` filtered to `kind = expense`, plus payments that changed an expense's paid state, keeping the URL (contracts/events.md)
- [X] T078 [P] [US2] Repoint `src/routes/api/income/stream/+server.ts` at `ledgerEvents` filtered to `kind = income`, keeping the URL
- [X] T079 [US2] Add the transfer flow — "money moving between two places you hold", refusing `fromAccountId === toAccountId`, never counted as income or expense — to `src/lib/components/ledger/RecordSheet.svelte` and the records endpoint (FR-007)
- [X] T080 [US2] Add `account_id` to `import_queue` handling and create a ledger record instead of an `expenses`/`incomes` row on confirm, in `src/lib/server/import/worker.ts` and `src/routes/api/import/confirm/+server.ts`, landing an undetermined category on Uncategorised and flagging it rather than rejecting (FR-019, spec edge case)
- [X] T081 [P] [US2] Add the account picker, defaulted, to the import review screen in `src/lib/components/` / `src/routes/(app)/import/+page.svelte` (FR-011, FR-019)
- [X] T082 [US2] Repoint `src/lib/server/queries/dashboard.ts` at `ledger_movements`, so every dashboard figure comes from the same rows the reports do (FR-031)
- [X] T083 [US2] Repoint the category management section of `src/routes/(app)/settings/+page.svelte` at accounts, keeping the word "category" on screen and the stage-locally-save-once pattern, and add the "which account should new records default to?" setting writing `ledger_default_account_id`, shown only once more than one account exists (FR-006a, FR-011, CLAUDE.md § Settings patterns)
- [X] T084 [P] [US2] Delete `src/lib/server/queries/expenses.ts`, `src/lib/server/queries/income.ts` and `src/lib/server/queries/categories.ts` once nothing imports them (D-01, D-06)
- [X] T085 [P] [US2] Delete `src/lib/server/services/expenses.ts`, `src/lib/server/services/income.ts`, `src/lib/server/loaders/expenses.ts` and `src/lib/server/loaders/income.ts`
- [X] T086 [P] [US2] Delete the `expenseEvents` and `incomeEvents` emitters from `src/lib/server/finance/events.ts` and remove their remaining imports across `src/lib/` and `src/routes/` (D-21)

**Checkpoint**: The Shopee routine works end to end — one statement record, one commission record,
one action per withdrawal (SC-011) — and no existing screen or URL has changed.

---

## Phase 5: User Story 3 — Pay off what's owed, fully or partly (Priority: P2)

**Goal**: What's owed to a person or a supplier shows as an outstanding balance, a payment ticks off
what it covers, and a part payment leaves the rest correctly owed. Invoices join the same mechanism.

**Independent Test**: quickstart.md Scenario 3 — three expenses paid personally by one person, then
a payment covering less than the total. The covered items read paid, the uncovered one still reads
owed, the person's balance equals the difference exactly, and over-allocating is refused with the
figure still available.

- [X] T087 [US3] Build `src/lib/components/ledger/PaymentSheet.svelte` — record a payment and tick which outstanding items it covers, per the Sheet standard, refusing over-allocation with the plain sentence from the API (FR-015, FR-016)
- [X] T088 [US3] Build `src/lib/components/ledger/SettlementList.svelte` — what this payment covered, and what paid this record — using the list-of-many relation-card shape with `related-link` and a trailing chevron (CLAUDE.md § Cross-feature relation cards, FR-018)
- [X] T089 [US3] Show the derived paid/owed state, the outstanding figure and the settling payment on the expense detail in `src/lib/components/ledger/RecordSheet.svelte`, with an undo-settlement action (FR-012–FR-014, FR-017)
- [X] T090 [US3] Add the "who is owed, and how much is left" panel to `src/lib/components/expenses/ExpensesPage.svelte`, reading `GET /api/settlements` (FR-014)
- [X] T091 [P] [US3] Add the Partner role to `src/lib/components/contacts/ContactsPage.svelte` and `src/routes/api/contacts/[id]/roles/+server.ts`, creating the contact's capital and drawings accounts on grant and archiving them on removal when they hold movements (FR-008b, D-08)
- [X] T092 [P] [US3] Refuse `DELETE /api/contacts/[id]` with `409` when any record names the contact, offering archive instead, and keep the delete button visible-and-disabled with a tooltip in `src/lib/components/contacts/ContactsPage.svelte` (FR-009a)
- [X] T093 [US3] Implement `POST /api/invoices/[id]/issue` in `src/routes/api/invoices/[id]/issue/+server.ts` — move the invoice to Sent and create the record putting its amount into Money owed to us tagged with the customer, defaulting to the seeded Sales income account, `409` if already issued (FR-018a)
- [X] T094 [US3] Replace stored `amountPaid` with derived `paidMinor` / `outstandingMinor` / `paid` in `src/lib/server/queries/invoices.ts` and `src/lib/server/services/invoices.ts`, leaving `invoices.status` as the document lifecycle only (D-10)
- [X] T095 [US3] Add the Issue action and the derived paid/outstanding display to `src/lib/components/invoices/InvoicesPage.svelte`, with the settling payments shown through `SettlementList` (FR-018a, US3 AC7)
- [X] T096 [US3] Seed a **Sales** income-category account in `src/lib/server/ledger/upgrade/accounts.ts` and `src/lib/server/db/client.ts` so a fresh installation has the invoice default (FR-018a)

**Checkpoint**: Reimbursements, supplier bills and customer instalments all run through one payment
and settlement mechanism, on one screen.

---

## Phase 6: User Story 4 — Reconcile any account against its own statement (Priority: P2)

**Goal**: A statement belongs to an account, and only movements on that account are ever offered as
matches.

**Independent Test**: quickstart.md Scenario 4 — with two accounts holding records, upload a
statement for one and confirm nothing belonging to the other is offered; then turn an unmatched
deposit into a transfer in one action.

### Tests for User Story 4 (Principle V in scope) ⚠️

- [X] T097 [P] [US4] Update `src/lib/server/reconciliation/matching.spec.ts` so candidates are movements on the statement's account, the direction filter is the movement's sign, and a movement on another account is never offered (SC-005, D-11)

### Implementation for User Story 4

- [X] T098 [US4] Replace the `(item_type, item_id)` candidate model with movements on the statement's account in `src/lib/server/reconciliation/matching.ts` and `src/lib/server/reconciliation/types.ts`, dropping the `EPSILON` money comparison in favour of integer cents (D-02, D-11)
- [X] T099 [US4] Repoint allocation reads and writes at `movement_id` in `src/lib/server/queries/reconciliation.ts` and `src/lib/server/services/reconciliation.ts`, leaving partial and many-to-many behaviour untouched (FR-022, FR-024)
- [X] T100 [P] [US4] Require `accountId` on `POST /api/reconciliation/statements` and accept it on `PATCH /api/reconciliation/statements/[id]` in `src/routes/api/reconciliation/statements/`, so an existing statement can be reassigned (FR-021, FR-034a)
- [X] T101 [P] [US4] Replace `{ itemType, itemId }` with `{ movementId }` in every candidate and allocation payload under `src/routes/api/reconciliation/`
- [X] T102 [US4] Implement `POST /api/reconciliation/lines/[lineId]/transfer` in `src/routes/api/reconciliation/lines/[lineId]/transfer/+server.ts` — create the transfer record, its two movements and the allocation in one transaction, then emit on both streams (FR-023)
- [X] T103 [P] [US4] Add the account selector to statement upload and show the statement's account on the workspace in `src/lib/components/reconciliation/` (FR-021)
- [X] T104 [US4] Add the "record this as a transfer from another account" action to the matching workspace in `src/lib/components/reconciliation/`, pre-filled from the line (FR-023, US4 AC4)
- [X] T105 [P] [US4] Update `src/lib/server/reconciliation/suggestions.ts` and `suggestions.spec.ts` to score movements rather than polymorphic items (D-11)

**Checkpoint**: The original bug is fixed at the root — money sitting at Shopee is never offered
against a bank statement, because it has no bank movement.

---

## Phase 7: User Story 5 — Produce the financial reports (Priority: P3)

**Goal**: Profit and loss for any range, a balance sheet that balances at any date, a partner
statement, a full account history, and CSV export of each.

**Independent Test**: quickstart.md Scenario 5 — a profit and loss for one month and a balance sheet
at that month's end. The balance sheet balances and its result equals the profit and loss.

### Tests for User Story 5 (Principle V in scope) ⚠️

- [X] T106 [P] [US5] Unit test lines grouped by category account, a transfer appearing nowhere, and a withdrawal dated in the next month leaving the income in the earlier one, in `src/lib/server/ledger/reports/profit-loss.spec.ts` (FR-025, US2 AC3)
- [X] T107 [P] [US5] Unit test that owned equals owed plus owners' stake, earlier periods' accumulated result carries forward, the result equals the profit and loss for the same period, and the same inputs twice give the same answer, in `src/lib/server/ledger/reports/balance-sheet.spec.ts` (FR-026, SC-007)
- [X] T108 [P] [US5] Unit test one block per Partner-role contact with contributions, share of the result and drawings, in `src/lib/server/ledger/reports/partner-statement.spec.ts` (FR-027)
- [X] T109 [P] [US5] Unit test CSV escaping, column order and the notes row, in `src/lib/server/ledger/reports/csv.spec.ts` (FR-029, FR-030)

### Implementation for User Story 5

- [X] T110 [P] [US5] Implement the profit and loss over movements in a date range, grouped by category account, in `src/lib/server/ledger/reports/profit-loss.ts`
- [X] T111 [P] [US5] Implement the balance sheet as at a date, with the accumulated result carried forward and a `balances` flag carrying the difference when false, in `src/lib/server/ledger/reports/balance-sheet.ts`
- [X] T112 [P] [US5] Implement the partner statement from each Partner contact's capital and drawings accounts in `src/lib/server/ledger/reports/partner-statement.ts`
- [X] T113 [P] [US5] Implement CSV formatting with no new dependency in `src/lib/server/ledger/reports/csv.ts` (D-18)
- [X] T114 [US5] Implement the aggregate reads the three report modules consume in `src/lib/server/queries/reports.ts`
- [X] T115 [P] [US5] Implement `GET /api/reports/profit-loss` in `src/routes/api/reports/profit-loss/+server.ts` — `reports` view, `format=json|csv`, and the `notes` array carrying the FR-030 sentence
- [X] T116 [P] [US5] Implement `GET /api/reports/balance-sheet` in `src/routes/api/reports/balance-sheet/+server.ts`
- [X] T117 [P] [US5] Implement `GET /api/reports/partner-statement` in `src/routes/api/reports/partner-statement/+server.ts`
- [X] T118 [P] [US5] Implement `GET /api/reports/account-history` in `src/routes/api/reports/account-history/+server.ts` (FR-028)
- [X] T119 [US5] Implement the reports loader in `src/lib/server/loaders/reports.ts`
- [X] T120 [P] [US5] Build `src/lib/components/reports/ProfitLossReport.svelte` — full page, deep-linkable, one column below the mobile breakpoint (FR-043, plan.md Complexity Tracking)
- [X] T121 [P] [US5] Build `src/lib/components/reports/BalanceSheetReport.svelte`
- [X] T122 [P] [US5] Build `src/lib/components/reports/PartnerStatementReport.svelte`
- [X] T123 [P] [US5] Build `src/lib/components/reports/AccountHistory.svelte` with a running balance, rendered by `src/routes/(app)/accounts/[id]/+page.svelte` (FR-028)
- [X] T124 [US5] Add `src/routes/(app)/reports/+page.server.ts` and `+page.svelte` with a deep-linkable URL per report (profit-loss | balance-sheet | partners)
- [X] T125 [US5] Add the export action to each report page in `src/lib/components/reports/`, downloading the CSV from `format=csv` (FR-029)

**Checkpoint**: The payoff — a balance sheet the business can file, and a profit and loss that
agrees with it.

---

## Phase 8: User Story 6 — See who owes what (Priority: P4)

**Goal**: Which customers owe money and how overdue, and which suppliers are owed and when due.

**Independent Test**: quickstart.md — with outstanding customer and supplier balances of different
ages, each shows against the right contact in the right age band, and a part-paid invoice shows only
what is still outstanding.

- [X] T126 [US6] Add the ageing bands and due-date reads (from the invoice's due date where one exists) to `src/lib/server/queries/settlements.ts` (US6 AC1, AC2)
- [X] T127 [US6] Extend `GET /api/settlements` with `direction` and the ageing payload in `src/routes/api/settlements/+server.ts`
- [X] T128 [P] [US6] Build the money-owed-to-us view grouped by how overdue, in `src/lib/components/reports/OwedToUs.svelte`
- [X] T129 [P] [US6] Build the money-we-owe view with due dates, in `src/lib/components/reports/WeOwe.svelte`
- [X] T130 [US6] Add both views to `src/routes/(app)/reports/+page.svelte` with their own deep-linkable URLs, each row navigating to its record through the relation-card contract (CLAUDE.md § Cross-feature relation cards)

**Checkpoint**: All six stories are independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

The direct-entry journal (FR-040) belongs to no user story — it is a separately-permitted surface
required by the spec, and it is grouped here rather than pretended into one.

- [X] T131 Build the direct-entry screen in `src/lib/components/journal/JournalPage.svelte` — two or more movements entered by hand, the running difference shown, save refused until it is zero (FR-002, FR-040)
- [X] T132 Add `src/lib/server/loaders/journal.ts` and the route `src/routes/(app)/journal/+page.server.ts` / `+page.svelte`, gated on the `journal` permission so it is unreachable until granted (FR-040)
- [X] T133 [P] Verify every new mutating endpoint carries all four obligations — `hasPermission` with a `403`, Zod at the boundary, `recordAudit`, and an emit — by walking `src/routes/api/{accounts,records,settlements,reports,reconciliation,invoices}/**` against contracts/api.md, and confirm the separation FR-039 requires: `reports` view grants no `add`/`change` anywhere, and the `journal` resource is granted by no seeded group (Constitution: Development Workflow, FR-039, FR-040)
- [X] T134 [P] Confirm no accounting term appears on the expense, income, payment or import screens in `src/lib/components/{expenses,income,ledger}/` and the import review screen (SC-010, Principle VII)
- [X] T135 [P] Confirm every new screen collapses to one column below the mobile breakpoint via `useIsMobile()`, and every new drawer uses `panelSide = isMobile ? 'bottom' : 'right'` with square corners on full-height sheets (FR-043, CLAUDE.md § Drawer standard)
- [X] T136 [P] Delete tests that no longer describe a real rule — the claim-specific cases in `src/lib/server/locking.spec.ts` and any reconciliation case asserting the retired `ReconItemType` (Principle V)
- [X] T137 [P] Update `CLAUDE.md` — add the reports and account-history full-page exception, record the ledger patterns (one store, cents, `entry-builder.ts` as the single writer, `ledgerEvents`/`accountEvents`), and remove every claims reference (Principle VI)
- [X] T138 Confirm the whole-books check in `src/lib/server/ledger/integrity.ts` finishes under a minute on the reference data, measured by `elapsedMs` from `src/routes/api/ledger/integrity/+server.ts`, and confirm by reading the query plan that it stays two indexed aggregates rather than degrading to a scan as the table grows (SC-002)
- [X] T139 Run `bun run check` with no dev-server tab open, then `bun run lint` and `bun run test`; all three must pass (Constitution: Development Workflow; CLAUDE.md § Gotchas)
- [ ] T140 Walk every scenario in [quickstart.md](./quickstart.md) against a copy of a real database, including the interruption test, and record the result

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)** — no dependencies, starts immediately, and is the critical path. Everything queues behind T005.
- **Phase 2 (Foundational)** — depends on Phase 1. **Blocks every user story.**
- **Phase 3 (US1)** — depends on Phase 2.
- **Phase 4 (US2)** — depends on Phase 2. Independent of US1 in code; US1 must run before US2 is *validated* against real data.
- **Phase 5 (US3)** — depends on Phase 2.
- **Phase 6 (US4)** — depends on Phase 2, plus T058 for existing matches to survive.
- **Phase 7 (US5)** — depends on Phase 2, plus T091 (Partner role) for the partner statement to have anyone in it.
- **Phase 8 (US6)** — depends on Phase 2 and on T026; richer once US3 and US5 exist.
- **Phase 9 (Polish)** — depends on every story that is being shipped.

### The critical path, stated plainly

`T001 → T002 → T003 → T004 → T005` — five serial tasks in one or two files. Nothing else can start
safely until T005 (the interface freeze) lands, because it is what lets a rule module, a query, a
service and a page component be written at the same time without inventing each other's signatures.
**Cutting this path short is the single largest speed-up available**, and the delegation plan below
gives it to one agent with nothing else to do.

### Within a user story

- Test tasks for in-scope logic are written and fail before their implementation (Principle V)
- Rules before queries; queries before services; services before endpoints; endpoints before pages
- A story is complete before its checkpoint is claimed

### Hard serialization points (files more than one task wants)

| File | Owner | Rule |
|---|---|---|
| `src/lib/enums.ts` | T001 | One task, Phase 1. Nobody else edits it. |
| `src/lib/server/db/schema.ts` | T002, T003 | Same owner, back to back, then frozen for the feature |
| `src/lib/server/ledger/types.ts` | T005 | Frozen after T005. A signature change afterwards is a broadcast, not an edit |
| `src/routes/layout.css` | Phase 2 UI lane | Only `.sheet-*` and `related-link` already exist — add nothing new without claiming the file |
| `src/routes/(app)/settings/+page.svelte` | T064, T065, T083 | Three tasks, one file — run them in that order, one lane |
| `src/hooks.server.ts` | T062 | One task only |
| `src/lib/nav-config.ts` | T049 | One task only |
| `CLAUDE.md` | T137 | Last, after every pattern is settled |

### Parallel opportunities

- T006–T010 run together once T005 lands (five different files)
- T011–T016 all run together — six spec files, no shared imports beyond `types.ts`
- T017, T018, T020, T021, T022 run together; only T019 waits (on T017 and T018)
- T024, T025, T026 run together, then T027, T028, T029 run together
- T030–T040 are eleven separate route files and run together once their service lands
- Phases 3–8 run concurrently once Phase 2 is done — they touch disjoint directories
- Within Phase 7, T110–T113 and T115–T123 are each fully parallel

---

## Sub-Agent Delegation Plan

The organizing rule is **file ownership, not task count**: two agents never hold the same file at
the same time, and every handoff is a file that has already landed. Tasks are grouped into lanes
that own a directory, and lanes are released in waves.

### Wave 0 — one agent, no parallelism (the critical path)

| Lane | Tasks | Owns |
|---|---|---|
| **A-Foundation** | T001–T010 | `enums.ts`, `db/schema.ts`, `drizzle/`, `ledger/types.ts`, `ledger/events.ts`, `permissions.ts`, `audit.ts`, `sequence-template.ts`, `sequence`/`db/client.ts`, `nav-config.ts` (T049 pulled forward here) |

Splitting these across agents costs more in conflict than it saves in time — they are small edits to
files everything imports. One agent, start to finish. **Deliverable that unblocks everyone: T005.**

### Wave 1 — six agents, fully parallel (the pure rules)

| Lane | Tasks | Owns |
|---|---|---|
| **A-Money** | T011, T017 | `ledger/money.ts` + spec |
| **A-Types** | T012, T018 | `ledger/account-type.ts` + spec |
| **A-Entry** | T013, T019 | `ledger/entry-builder.ts` + spec |
| **A-Settle-Rules** | T014, T020 | `ledger/settlement-rules.ts` + spec |
| **A-Lock** | T015, T021, T023 | `ledger/locking.ts` + spec, `server/locking.ts` |
| **A-Integrity** | T016, T022 | `ledger/integrity.ts` + spec |
| **A-Payer** *(optional 7th)* | T053, T054 | `ledger/upgrade/payer.ts` + spec |

A-Entry writes its spec against the frozen signatures from T005 and stubs `money`/`account-type`
imports until Wave 1 finishes; it is the only lane with an intra-wave dependency, so give it the
longest slot.

**A-Payer belongs to User Story 1 but has no reason to wait for it.** `upgrade/payer.ts` is pure
logic over plain rows — it touches no database, no schema and no other lane's files — so pulling it
forward into this wave shortens A-Upgrade, which is otherwise the longest lane in the whole plan.
A-Upgrade then imports it as finished work rather than writing it.

### Wave 2 — four agents (data access, write path, endpoints, shared UI)

| Lane | Tasks | Owns |
|---|---|---|
| **A-Accounts** | T024, T027, T030–T034, T043–T047 | `queries/accounts.ts`, `services/accounts.ts`, `api/accounts/**`, `components/accounts/**`, `routes/(app)/accounts/**`, `loaders/accounts.ts` |
| **A-Records** | T025, T028, T035–T037, T040, T050 | `queries/ledger.ts`, `services/ledger.ts`, `api/records/**`, `api/ledger/integrity`, `components/ledger/RecordSheet.svelte` |
| **A-Settlements** | T026, T029, T038, T039 | `queries/settlements.ts`, `services/settlements.ts`, `api/settlements/**` |
| **A-Storage** | T041, T042, T048 | `file-storage.ts`, `search-text.ts`, `search-rebuild/worker.ts`, `components/ledger/AccountSelect.svelte` |

`AccountSelect.svelte` sits with A-Storage only because the other three lanes are already loaded; it
has no dependency on that lane's work and can move to whichever agent is free.

### Wave 3 — six agents, one per story lane (the wide fan-out)

| Lane | Tasks | Owns | Story |
|---|---|---|---|
| **A-Upgrade** | T051–T065 | `ledger/upgrade/**`, `hooks.server.ts`, `loaders/ledger.ts` (legacy fallback only) | US1 |
| **A-Claims-Removal** | T066–T068 | `routes/(app)/claims/`, `api/claims/`, `components/claims/`, `queries|services|loaders/claims.ts` | US1 |
| **A-Expenses** | T069, T070, T072 (expenses half), T073, T075, T077, T079 | `components/expenses/**`, `routes/(app)/expenses/**`, `api/expenses/**`, `loaders/ledger.ts` | US2 |
| **A-Income** | T071, T072 (income half), T074, T076, T078 | `components/income/**`, `routes/(app)/income/**`, `api/income/**` | US2 |
| **A-Payments** | T087–T090 | `components/ledger/PaymentSheet.svelte`, `SettlementList.svelte`, settlement UI in `RecordSheet.svelte` | US3 |
| **A-Recon** | T097–T105 | `server/reconciliation/**`, `queries|services/reconciliation.ts`, `api/reconciliation/**`, `components/reconciliation/**` | US4 |

Two collisions to watch, both real:

- **`loaders/ledger.ts`** is wanted by A-Upgrade (T063, the legacy fallback) and A-Expenses (T069,
  the shared loader). Give the file to A-Expenses; A-Upgrade hands T063 over as a described change
  rather than an edit, or takes the file after T069 lands.
- **`RecordSheet.svelte`** is created by A-Records in Wave 2 and extended by A-Expenses (T079) and
  A-Payments (T089). Serialize those two: T079 then T089, or merge both into A-Payments.

### Wave 4 — five agents (the rest, all independent)

| Lane | Tasks | Owns | Story |
|---|---|---|---|
| **A-Import** | T080, T081 | `server/import/**`, `api/import/confirm`, import review UI | US2 |
| **A-Contacts** | T091, T092 | `components/contacts/**`, `api/contacts/**` | US3 |
| **A-Invoices** | T093–T096 | `api/invoices/**`, `queries|services/invoices.ts`, `components/invoices/**` | US3 |
| **A-Reports** | T106–T125 | `ledger/reports/**`, `queries/reports.ts`, `api/reports/**`, `components/reports/**`, `routes/(app)/reports/**`, `loaders/reports.ts` | US5 |
| **A-Dashboard-Settings** | T082, T083 | `queries/dashboard.ts`, `routes/(app)/settings/+page.svelte` | US2 |

A-Reports is the largest single lane (twenty tasks) and splits cleanly in two if there is capacity:
**A-Reports-Rules** (T106–T114, the modules and their specs) and **A-Reports-UI** (T115–T125, the
endpoints and pages), handing off at `types.ts`'s frozen report shapes.

**A-Dashboard-Settings owns `settings/+page.svelte` for the whole feature.** T064, T065 and T083 all
land in that one file — route them all through this lane, in that order, whichever wave they belong
to.

### Wave 5 — sequential, small

| Lane | Tasks |
|---|---|
| **A-Journal** | T126–T130 (US6), T131, T132 (journal) |
| **A-Cleanup** | T084–T086, T133–T140 |

T084–T086 (deleting the old queries, services, loaders and emitters) must run **after** every lane
that imported them has landed — that is the whole point of doing them last. `bun run check` is the
gate that proves nothing still imports them.

### Rules every lane follows

1. **Never edit a file another lane owns.** If you need a change there, describe it and hand it over.
2. **`ledger/types.ts` is frozen after T005.** Needing a signature change is a message to every lane, not a quiet edit.
3. **Every mutating endpoint carries all four obligations** — permission, Zod, audit, emit. A lane that adds one without all four has not finished the task.
4. **No lane runs the app or a browser.** Verification is `bun run check`, `bun run lint`, `bun run test` and reading the diff (CLAUDE.md § Verification Policy).
5. **`bun run check` regenerates SvelteKit's client nodes** — run it with no dev-server tab open, or restart the dev server afterwards (CLAUDE.md § Gotchas).
6. **Run `bun run check` at each wave boundary, not per task.** Mid-wave the tree is expected to be red where a lane's dependency has not landed.

### Where the time actually goes

| Wave | Lanes | Serial cost if done alone | Wall clock with the lanes above |
|---|---|---|---|
| 0 | 1 | 10 tasks | 10 tasks (unavoidable) |
| 1 | 6 | 13 tasks | ~3 tasks (A-Entry is the long pole) |
| 2 | 4 | 27 tasks | ~12 tasks (A-Accounts is the long pole) |
| 3 | 6 | 41 tasks | ~15 tasks (A-Upgrade is the long pole) |
| 4 | 5 | 31 tasks | ~20 tasks (A-Reports is the long pole; ~11 if split) |
| 5 | 2 | 18 tasks | ~11 tasks |

Roughly 140 tasks of serial work compressing to about 62 tasks of wall clock — and the two long
poles worth attacking are **A-Upgrade** (unsplittable; the phases genuinely depend on each other)
and **A-Reports** (splittable, and worth splitting).

`upgrade/payer.ts` (T053, T054) is the one part of A-Upgrade that *is* splittable: it is a pure
module with no database, so it can be built in Wave 1 alongside the other rule modules and handed to
A-Upgrade as a finished import. Doing that takes the longest lane's critical path down by two.

---

## Parallel Example: Wave 1

```bash
# Six agents, six pairs of files, zero shared state:
Task: "T011 + T017 — money.spec.ts then money.ts in src/lib/server/ledger/"
Task: "T012 + T018 — account-type.spec.ts then account-type.ts in src/lib/server/ledger/"
Task: "T013 + T019 — entry-builder.spec.ts then entry-builder.ts in src/lib/server/ledger/"
Task: "T014 + T020 — settlement-rules.spec.ts then settlement-rules.ts in src/lib/server/ledger/"
Task: "T015 + T021 + T023 — locking.spec.ts, locking.ts, and server/locking.ts re-export"
Task: "T016 + T022 — integrity.spec.ts then integrity.ts in src/lib/server/ledger/"
```

## Parallel Example: Phase 2 endpoints

```bash
# Eleven route files, one agent each or two agents alternating:
Task: "T030 GET/POST src/routes/api/accounts/+server.ts"
Task: "T031 PATCH/DELETE src/routes/api/accounts/[id]/+server.ts"
Task: "T032 PUT src/routes/api/accounts/[id]/opening-balance/+server.ts"
Task: "T033 GET src/routes/api/accounts/[id]/movements/+server.ts"
Task: "T034 SSE src/routes/api/accounts/stream/+server.ts"
Task: "T035 GET/POST src/routes/api/records/+server.ts"
Task: "T038 GET/POST src/routes/api/settlements/+server.ts"
Task: "T040 GET src/routes/api/ledger/integrity/+server.ts"
```

---

## Revised Delegation Plan — remaining work (amended 2026-08-16)

Waves 0–2 ran as designed. Wave 3 onwards did not: the lanes were regrouped into
smaller rounds and **A-Invoices (Wave 4) was run before A-Payments (Wave 3)**,
whose `SettlementList.svelte` it imports. T095 landed importing a component that
does not exist, and the build has not resolved since.

**Two things about the original plan let that happen quietly, and both are fixed
below.**

1. **Ordering lived only in the wave numbers.** The table above records shared
   *files* meticulously and cross-lane *imports* not at all, so nothing said
   T095 needed T088. Regroup the lanes and the constraint disappears with them.
   The plan below states every dependency as an edge between tasks, so it
   survives being re-cut into different rounds.
2. **The serialization table was incomplete.** `routes/(app)/reports/+page.svelte`
   is written by both T124 and T130 and was never listed — and because T124
   names it as a bare `+page.svelte` rather than a full path, a mechanical scan
   of this file misses it too. Every remaining shared file is listed below with
   its full path.

### Every file two or more remaining tasks write

| File | Tasks | Rule |
|---|---|---|
| `src/lib/components/ledger/RecordSheet.svelte` | T079, T089 | One lane, T079 then T089 |
| `src/routes/(app)/settings/+page.svelte` | T064, T065, T083 | One lane, T083 → T064 → T065 |
| `src/routes/(app)/reports/+page.svelte` | T124, T130 | One lane, T124 then T130 |

### Every dependency between remaining tasks

| This | must land before | Because |
|---|---|---|
| T088 `SettlementList.svelte` | T089, and unbreaks the landed T095 | Both import the component |
| T126 ageing reads | T127 | The endpoint returns what the query derives |
| T127 `GET /api/settlements` | T128, T129 | Both views read the ageing payload |
| T114 `queries/reports.ts` *(landed)* | T115–T118 | Endpoints delegate to it |
| T115–T118 endpoints | T120–T123 | Each page fetches its own report |
| T119 `loaders/reports.ts` | T124 | The route delegates to the loader |
| T124 reports route | T130 | T130 adds two more views to that page |
| Every lane below | T084–T086 | Deleting a module before its callers are repointed breaks them |
| Everything | T133–T140 | They audit and gate what the others built |

### Round 1 — six lanes, zero shared files

| Lane | Tasks | Owns |
|---|---|---|
| **L1 A-Settlements-UI** | T087, T088, T089, T079, T090 | `components/ledger/**`, `components/expenses/ExpensesPage.svelte` |
| **L2 A-Income** | T071, T074, T076, T078 | `components/income/**`, `routes/(app)/income/**`, `api/income/**` |
| **L3 A-Reports-US6** | T115–T125, T126–T130 | `ledger/reports` consumers: `api/reports/**`, `components/reports/**`, `routes/(app)/reports/**`, `loaders/reports.ts`, `queries/settlements.ts`, `api/settlements/**` |
| **L4 A-Import** | T080, T081 | `server/import/**`, `api/import/**`, import review UI |
| **L5 A-Journal** | T131, T132 | `components/journal/**`, `routes/(app)/journal/**`, `loaders/journal.ts` |
| **L6 A-Settings-Dashboard** | T063, T064, T065, T082, T083 | `routes/(app)/settings/+page.svelte`, `queries/dashboard.ts`, `loaders/ledger.ts` |

**L1 goes out first and is the one that matters most** — T088 is what unbreaks
the build for everyone.

**US6 moved from Wave 5 into L3.** T126–T130 were grouped with the journal
because both were small; but T130 writes the reports page and T126/T127 write
the settlement reads that T128/T129 display. Putting all of US6 with the reports
lane gives that page and that endpoint one owner each, which is what the
collision table above demands.

**T063 moved to L6.** `loaders/ledger.ts` was A-Expenses' file; that lane has
landed, so the file is free and the legacy fallback can go in beside the
settings work rather than waiting on a lane of its own.

### Round 2 — strictly after every Round 1 lane has landed

| Lane | Tasks | Why it waits |
|---|---|---|
| **L7 A-Cleanup** | T084–T086, T133–T136, T138 | Deletions need every caller repointed; the audits need everything built |
| **Maintainer lane** | T137, T139 | `CLAUDE.md` last, after every pattern is settled; then the three gates |

**T140 (walking quickstart.md against a copy of a real database) is not an agent
task.** It requires running the upgrade against real data, and doing that from a
script in this repo has already destroyed and required the restoration of the
maintainer's `data/` directory once — `.env` pins `DATABASE_PATH` and
`STORAGE_PATH` to relative paths, so a sandbox that only overrides the
environment does not isolate anything. It is left for the maintainer to run
deliberately, against a copy they have made themselves.

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 — Setup (T001–T010)
2. Phase 2 — Foundational (T011–T050). **Blocks everything.**
3. Phase 3 — User Story 1 (T051–T068)
4. **STOP and VALIDATE**: quickstart.md Scenario 1 against a copy of a real database, including the
   restart and the interruption test.
5. This is shippable on its own: the books are converted, verified, and every existing screen still
   reads from data that did not move. Claims are gone, which is the one visible change.

### Incremental delivery

1. Setup + Foundational → the chart of accounts exists and records can be written
2. + US1 → the update runs itself and proves itself (**MVP**)
3. + US2 → the Shopee problem that started this is fixed (SC-003, SC-004, SC-011)
4. + US3 → reimbursements, supplier bills and instalments run through one mechanism
5. + US4 → reconciliation stays correct now money sits in more than one place
6. + US5 → the balance sheet the business needs to incorporate
7. + US6 → who owes what, by age
8. + Polish → the journal, the gates, the docs

### Parallel team strategy

Follow the waves above. The shortest honest schedule is: one agent alone through Wave 0, then six,
then four, then six, then five, then two — with `bun run check` at each boundary and nothing
crossing a lane's file ownership.

---

## Notes

- The two decisions research.md carried as open (D-12, D-19) were **confirmed on 2026-08-16** and are
  now **FR-036b** and **FR-036c**. T056 implements them as stated requirements — it no longer encodes
  an unconfirmed assumption. On the maintainer's database FR-036b resolves all 34 reimbursements to
  the existing contact `TANG HAO QUAN` and creates no contact, and FR-036c affects zero rows.
- Money in every request and response is whole cents (`amountMinor`) wherever it is a ledger figure,
  and the entered decimal (`amount` + `currency` + `exchangeRate`) wherever it is what the user typed.
- Financial amounts are never logged (Constitution: Technology & Platform Constraints).
- Commit after each task or logical group; stop at any checkpoint to validate a story on its own.

---

## Phase 10: Convergence

Assessed against spec.md, plan.md, tasks.md and the constitution. Nothing is **missing** —
every requirement and acceptance scenario has an implementation. What follows is drift:
places where the code contradicts a decision this feature itself made. Most of it traces
to one cause — `invoices.status` stopped meaning "paid" when D-10 made paid derived, and
three call sites still read it that way.

- [X] T141 CRITICAL Delete `canEditInvoice` from `src/lib/server/locking.ts` and its block in `locking.spec.ts` — it gates on `InvoiceStatus.Paid`, which nothing writes now that paid is derived, so the rule describes nothing and the test pins a rule that no longer exists per Constitution IV (no dead code) and V (delete tests that no longer describe a real rule) (contradicts)
- [X] T142 CRITICAL Record in `CLAUDE.md` that a Payment, Transfer or OpeningBalance record has no `/<feature>/[id]` URL — naming where each is instead reachable (a payment from the expense it settled, a transfer and an opening balance from their account's history) — or give payments a URL and link them from `SettlementList.svelte`'s `canOpen`. Constitution VI allows a documented deviation but not an undocumented one, and `plan.md`'s Complexity Tracking records only the claims exception (contradicts)
- [X] T143 Read the derived `paidMinor` instead of the deprecated `invoices.amountPaid` in `src/lib/server/pdf/invoice.ts` (lines 158, 167) — `amountPaid` is permanently 0 for anything issued after this change, so a printed invoice contradicts the screen it was printed from, per D-10 and FR-018a (contradicts)
- [X] T144 Derive outstanding and overdue invoices from settlements in `src/lib/server/queries/dashboard.ts` (`ne(invoices.status, InvoiceStatus.Paid)` at lines 257 and 272) — that status is never written now, so a fully settled invoice is counted as outstanding forever and a cancelled one is counted too, which is exactly the disagreement FR-031 and D-10 exist to prevent (contradicts)
- [X] T145 Fix or remove the `offset` parameter of `accountHistory` in `src/lib/server/queries/accounts.ts` — it is applied at line 390 while `openingBalanceMinor` only sums movements before `dateFrom`, so any non-zero offset silently returns wrong running and closing balances. Removing it is the smaller fix; leave a comment at the seam naming what to change if paging is ever wanted, per FR-028 and Constitution III (contradicts)
- [X] T146 Export `MONEY_POT_ROLES` once and import it in `src/lib/server/loaders/ledger.ts`, `src/routes/(app)/settings/+page.server.ts` and `src/routes/(app)/import/+page.server.ts` — three identical definitions is the third concrete use, which is where Constitution III says the abstraction is earned (partial)
- [X] T147 Report the full record count in `src/lib/components/ContactMergeCompare.svelte` (line 55) — it says "N expense(s), M income(s)" from a usage shape that now also counts payments, transfers and issued invoices, so the merge preview understates what merging will move, and merging is what FR-009a and FR-036b both point the user at (partial)
- [X] T148 Remove the `expenses` and `incomes` updates from `mergeContacts` in `src/lib/server/queries/contacts.ts` (lines 499–506) — writing to the deprecated tables contradicts D-17, and mutating them makes them a less faithful record of what the upgrade converted from (contradicts)

---

## Phase 11: Convergence

Every Phase 10 task verified landed. These four are a different class: capabilities the
old Expenses and Income screens had that the rewrite dropped. `plan.md` promised "the
product on top does not change", and for these four it did.

- [X] T149 CRITICAL Restore foreign-currency entry to `src/lib/components/ledger/RecordSheet.svelte`, which hardcodes `currency: mainCurrency(), exchangeRate: 1` at lines 214 and 260 — both old screens offered a currency and a fetched-or-typed rate, and without it a purchase in another currency is stored at face value in the main currency, silently misstating it. The schema still keeps `amount`, `currency` and `exchange_rate`, and the import path still sets all three, so this is confined to manual entry. `resolveRecordCurrency` in `src/lib/server/currency/form.ts` is the existing rate-resolution path, but it takes `FormData` while this drawer posts JSON to `/api/records` — either give it a JSON-shaped sibling or resolve the rate client-side and post it, per FR-005 and plan "the product on top does not change" (partial)
- [X] T150 CRITICAL Once T149 lands, confirm `resolveRecordCurrency` in `src/lib/server/currency/form.ts` is called again; if T149 takes a different route, delete it — it currently has zero callers, and a rate-resolution helper that nothing calls is dead code per Constitution IV. Do this task **after** T149, not before: fixing T149 is what decides whether this function lives (contradicts)
- [X] T151 Surface whether a record has been matched to a bank line in `src/lib/components/expenses/ExpensesPage.svelte` and `src/lib/components/ledger/RecordSheet.svelte` — the old screen showed a cleared/not-cleared indicator and a "Reconcile this expense" link (9 references at HEAD, none now). `RecordView` collapses settled and reconciled into `locked`/`lockedReason`, which names the bank line only once the record is locked and says nothing about one that is not yet matched; expose the reconciled state separately so the list can show it and the drawer can link to the matching workspace, per plan "Expenses, Income … keep their screens" (partial)
- [X] T152 Explain a negative balance on a money-holding account in `src/lib/components/accounts/AccountsPage.svelte` — recording a withdrawal before the statement it came from drives a wallet below zero, and the screen currently shows a bare minus figure. US2/AC6 and the "withdrawal recorded before its statement" edge case both require the gap to be visible and explained as a timing difference rather than left looking like an error (partial)
