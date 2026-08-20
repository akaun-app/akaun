# Implementation Plan: One Ledger, One Records Screen, One Flat Account List

**Branch**: `003-simplify-double-entry` | **Date**: 2026-08-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-simplify-double-entry/spec.md`

## Summary

Three screens that read one store become one **Records** screen. Six section headers on the Accounts
screen become one flat searchable list, which is also the only place accounts and categories are
managed. Two record permissions become one, plus one narrow ability that keeps the control the by-hand
screen carried. Three live connections become one. Reconciling moves to the account it already belongs
to. The remains of the retired claim, expense and income tables are removed outright.

**Nothing about how money is recorded changes.** One record store, sides that cancel out, whole cents,
nothing about payment state stored. This is a change to surfaces, addresses, permissions and dead
weight.

Technical approach:

- **One screen component**, `RecordsPage.svelte`, grown from `ExpensesPage.svelte` (1,347 lines) because
  Expenses is a strict superset of Income in machinery. `IncomePage.svelte` (1,046),
  `JournalPage.svelte` (238) and their six route files are deleted. Everything in
  `components/ledger/*` — `RecordSheet.svelte` (861), `SettlementList`, `PaymentSheet`,
  `AccountSelect` — is **already kind-agnostic** and is reused unchanged, which is why the merge is
  affordable at all.
- **The kind of record stops being asked and becomes derived**, by one new pure module,
  `ledger/sides-from-accounts.ts`, developed test-first. The form asks two everyday questions — which
  account the money left, which it went to — and the kind falls out of those two accounts' roles.
  `entry-builder.ts` stays the only place movements are constructed.
- **The permission merge is an OR-merge, not a rename.** `group_permissions` and `user_permissions` are
  both keyed `(ownerId, resource)`, so `expenses` and `income` collapse onto one primary key and the
  four booleans must be OR-ed first, across **both** tables. `journal` is renamed `adjustments` — one
  row to one row — which satisfies FR-031b at zero cost and inherits FR-031a from the fact that no
  seeded group grants `journal` today.
- **The legacy drop is gated in front of `migrate()`, not inside a migration.** `migrate()` runs at
  module load in `db/client.ts:30`; `ensureLedgerUpgrade` runs afterwards in `hooks.server.ts`. A
  `DROP TABLE` in a migration would therefore destroy the rows before the conversion that reads them
  could run — exactly what FR-037a forbids. A pure guard decides, and refuses to start rather than
  start with the data gone.
- **The conversion code retires with the tables it reads.** Every file in `ledger/upgrade/**` reads a
  table being dropped, so the module and `ensureLedgerUpgrade` go. `seedAccounts()`'s fresh-install job
  — the default categories and the Sales account — is rescued into `db/seed-accounts.ts` first.
- **Three defects are fixed on the way**, each with a test that fails first: attachments on ledger
  records currently return `403`, Auto Import's duplicate check reads the tables being dropped, and a
  live `invoices` foreign key points into `incomes`. None is optional — the drop turns the first into a
  permission failure on real receipts and the second into a compile error.
- **This release is net subtraction.** Ten endpoints retire and one is added; nine tables and two
  columns go; eleven navigation items become eight; two record permissions become one. No new runtime
  dependency, no new datastore, no new service.

## Technical Context

**Language/Version**: TypeScript (strict) on Bun; Svelte 5, runes mode forced project-wide

**Primary Dependencies**: SvelteKit 2, Drizzle ORM 0.45 (`bun:sqlite` driver), Zod 4, bits-ui 2,
Tailwind 4, `pino`. **No new runtime dependency, and none removed** — every change here is application
code.

**Storage**: single SQLite file via Drizzle. One committed `drizzle-kit generate` migration: nine tables
dropped, three columns dropped across two **live** tables rebuilt for the purpose, one column made
`NOT NULL`. A pure guard in front of `migrate()` refuses to proceed on an installation whose records
were never converted. No attachment file moves; `STORAGE_PATH` layout is untouched.

**Testing**: Vitest — `server` project (node/Bun, `*.spec.ts`) for four new pure rule modules and two
regression tests, all over plain rows with no database. The `client` project is not used by this
feature. The migration is verified against a **copy** of a real database, never `data/`.

**Target Platform**: one SvelteKit app served to browser, installable PWA, Tauri desktop sidecar and
mobile web — no surface-specific code paths.

**Project Type**: single full-stack web application (`src/routes` + `src/lib` + `src/lib/server`)

**Performance Goals**: no new query shape on any hot path. The Records list is the existing
`listRecords()` with two added filters; `cleared` adds one grouped aggregate over
`reconciliation_allocations` beside the coverage subquery the list already carries. The statement view
reuses `accountHistory()` unchanged. The accounts search and filter run client-side over an
already-loaded list, so a hundred rows cost nothing. The whole-books check after the drop is the same
two indexed aggregates it is today.

**Constraints**: no existing user's or group's effective access may change (FR-029, SC-006); every
report figure and every attachment identical before and after (FR-033, FR-039, SC-003); the drop must
not run on an unconverted installation and must leave it byte-identical (FR-037a); the whole-books check
must pass afterwards (FR-038a); every screen usable at mobile widths (SC-009); financial amounts never
logged.

**Scale/Scope**: single self-hosted business, one installation. 9 tables dropped, 3 columns dropped, 1
column tightened, 1 migration. 10 API endpoints retired, 2 added, 1 moved. 2 permission resources
merged into 1, 1 renamed, across 2 tables. 3 nav items removed. 7 route directories deleted, 3 added.
~3,300 lines of screen component replaced by one; the 2,852-line `ReconciliationPage.svelte` split into
two surfaces. 4 new pure modules, 2 regression tests, 3 defects fixed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Principle | Status | Check |
|------|-----------|--------|-------|
| Single codebase | I | **PASS** | No surface-specific fork. `RecordsPage` inherits `ExpensesPage`'s existing mobile treatment (card rows below the breakpoint, `panelSide = isMobile ? 'bottom' : 'right'`); the flat accounts list is already one column on mobile. SC-009 requires no horizontal scrolling on either list. The two new reconciliation routes are full pages by the task-workspace exception — that governs *visual treatment only*, and each must still be usable at mobile width. |
| Lightweight | II | **PASS** | Net subtraction: no new datastore, broker, worker or runtime dependency, and no feature made to depend on a network service. The permission rewrite and the fresh-install account seed run in-process at startup beside the existing `ensureGroupSeed()`, replacing the heavier `ensureLedgerUpgrade` that is being removed. |
| YAGNI | III | **PASS** | Every addition has a present named need: `cleared` for FR-056, `sort` for FR-043, `sideCount` for the many-sided row, `sides-from-accounts.ts` for D-01. No config knob, no plugin seam, no redirect layer (D-04 rejects one outright). Nothing is generalised for a second caller that does not exist. Logic placed by layer: `routes/` → `services/` → `queries/` → `db/`, with pure rules in `lib/server/ledger/`. |
| SOLID boundaries | IV | **PASS** | Routes parse + `hasPermission` + delegate. The new rules are pure functions over plain rows in `lib/server/ledger/` and `lib/server/permissions/`; writes stay in `lib/server/services/`. No `services/` → `routes/` import. `sides-from-accounts.ts` deliberately builds **no** movements — it returns the `RecordCreateSides` that `entry-builder.ts` already accepts, so the balance rule keeps exactly one enforcement point. Every request body still validated with Zod at the boundary. |
| Mutation obligations | IV | **PASS** | **This feature adds no mutating endpoint.** One moves (`POST …/statements` takes its account from the path instead of a form field) and ten retire. Every existing `hasPermission` / Zod / `recordAudit` / emit call site is kept where it is — which is precisely why three streams could become one without touching a single service. The Settings Category tab is deleted, and the accounts service it called through is unchanged. |
| TDD scope | V | **PASS** | Four pure modules test-first and named in [research.md](./research.md) R-14 and [quickstart.md](./quickstart.md): `sides-from-accounts.ts`, `permissions/merge-records.ts`, `ledger/coverage.ts`, `db/legacy-drop-guard.ts`. Both defects ship with a reproducing test that fails first, per Principle V's "every bug fix, without exception". No coverage target introduced, and no test written for the merged components, the drawer, the nav change or the re-pointed links. |
| Established patterns | VI | **PASS** (4 recorded deviations) | Live updates through one `ledgerEvents` stream, no polling, no snapshot on a paginated list. Every record detail and create/edit drawer keeps the shared `Sheet` standard — `RecordSheet.svelte` is reused as-is. Every record stays reachable at `/records/[id]` through the same shallow-routing pattern, one shared page component behind two small routes, one shared loader. Relation cards keep the `related-link` contract. **Deviations**: the retired deep links, the statement view inside Records, two full-page reconciliation routes, and `SettlementList`'s `canOpen` — all four recorded in Complexity Tracking, with `CLAUDE.md` amended in the same change. |
| Fixed stack | Tech Constraints | **PASS** (1 recorded deviation) | Svelte 5 runes, Drizzle + SQLite only, the schema change through `drizzle-kit generate` with the migration committed — no hand-applied schema mutation. All new server code under `$lib/server/**`. The destructive migration states its data-migration path. **Deviation**: the pre-migration guard reads `sqlite_master`, which is not a declared table, through Drizzle's raw `sql` escape hatch — recorded in Complexity Tracking. |

**Post-Phase-1 re-check**: re-evaluated after [data-model.md](./data-model.md),
[contracts/api.md](./contracts/api.md), [contracts/events.md](./contracts/events.md) and
[quickstart.md](./quickstart.md) were written. All gates still hold. Five design choices were tightened
by the re-check, each because writing the contract exposed something the summary had glossed:

1. **"Cleared" and "reconciled" became two fields, not one.** The codebase already computes this under
   one name in two places that disagree: `matchedMovements()` flips true on the first allocation, while
   the reconciliation workspace uses `remainingAmount >= EPSILON`. FR-056's filter must agree with the
   workspace it replaces, but `locked` must stay existence-based — a matched record's amount must not
   change whether or not the line covers it. Two questions, two fields, each named for what it answers
   (research.md R-08, data-model.md §4).
2. **The permission rewrite moved out of SQL and into a pure function.** It is expressible as
   `INSERT … SELECT MAX(can_view) … GROUP BY group_id`, but Principle V names permission resolution as
   TDD-required and SC-006 measures it account by account. A pure function over rows is red-green
   testable; a statement inside a migration is not.
3. **`journal` is renamed rather than replaced.** Writing FR-031b out made it obvious that one row
   becoming one row costs nothing, while a new resource would need a data migration to carry existing
   holders across. The rename also inherits FR-031a: no seeded group grants `journal`, so no seeded
   group grants `adjustments`.
4. **Two endpoints retire into one statement endpoint, not one.** `/api/accounts/[id]/movements`
   (gated `accounts.view`) answers the same question as `/api/reports/account-history` (gated
   `reports.view`). Leaving one of them would have reproduced, in the API, the exact duplication D-05
   removes from the screens — and it exposed a live defect: `/accounts/[id]/history` gates its shell on
   `accounts.view` and fetched from the endpoint gated on `reports.view`, so a user with one and not the
   other got a page that loaded and then refused.
5. **`bank_statements.account_id` becomes `NOT NULL`.** FR-055 asks for an accountless statement to be
   findable. With reconciling reached from an account, such a statement belongs to no route. There were
   two ways to honour the requirement — build a surface for the case, or remove the case — and the
   column was only ever nullable because the earlier conversion ran before accounts were seeded, a
   reason that expired when it finished.

**What the survey changed about the plan itself.** Six parallel reads of the code found five places
where the spec's description and the code disagree, and three defects. Two of the corrections change
what the work *is* rather than how it is done, and both are recorded here because a task list built on
the spec's wording alone would be wrong:

- **`/reconciliation/[id]/match` does not exist.** Commit `e5568b1f` deleted it when reconciliation
  became one continuous workspace; the directories are empty shells. FR-052's "own shareable address"
  is therefore *new* work, not a preserved address — and `CLAUDE.md`'s task-workspace exception, which
  cites that route as its reference, is already false.
- **The Accounts screen has no search box at all** today, only a "Show archived" toggle. FR-017 is new
  work, and SC-008 depends entirely on it.

Neither threatens a gate: both are ordinary feature work in the correct layer, adding no dependency, no
datastore and no service.

## Project Structure

### Documentation (this feature)

```text
specs/003-simplify-double-entry/
├── plan.md              # This file
├── research.md          # Phase 0 output — 14 decisions, 5 corrections, 3 defects found
├── data-model.md        # Phase 1 output — 9 tables dropped, 3 columns, permission rewrite, 4 invariants
├── quickstart.md        # Phase 1 output — validation guide; 6 parts, 30 maintainer checks
├── contracts/
│   ├── api.md           # Endpoint deltas: 10 retired, 2 added, 1 moved
│   └── events.md        # SSE contract: 3 streams become 1
├── checklists/
│   └── requirements.md  # Existing spec-quality checklist (passed, validation pass 5)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/lib/
├── nav-config.ts                              # − Expenses, Income, Journal, Reconciliation; + Records
│                                              #   11 items → 8 (FR-023)
├── enums.ts                                   # − ExpenseStatus, ClaimStatus + their labels/zod enums
│                                              #   DocumentType STAYS — still live in the import pipeline
├── components/
│   ├── records/
│   │   └── RecordsPage.svelte                 # NEW — the one list. From ExpensesPage; + kind filter,
│   │                                          #   account filter, cleared filter, sideCount row,
│   │                                          #   statement mode (running balance + export)
│   ├── ledger/
│   │   ├── RecordSheet.svelte                 # + the two-sided form (D-01), extra sides behind
│   │   │                                      #   `adjustments`; − the /reconciliation generic link
│   │   ├── SettlementList.svelte              # canOpen: every kind opens now, at /records/[id]
│   │   ├── record-status.ts                   # shared by the one screen; + the cleared label
│   │   ├── PaymentSheet.svelte                # unchanged
│   │   └── AccountSelect.svelte               # + shortlist vs full list, gated (FR-008a, FR-031)
│   ├── accounts/
│   │   ├── AccountsPage.svelte                # − the 6 group headers; + name search + sort filter
│   │   │                                      #   (FR-015–FR-018); + "Check against the bank" card
│   │   ├── account-roles.ts                   # − ROLE_GROUPS; the 6 labels become filter values
│   │   ├── AccountSheet.svelte                # + reconcile relation card (FR-053); history card
│   │   │                                      #   repointed at /records?account=
│   │   └── display-sign.ts                    # unchanged mirror
│   ├── reconciliation/
│   │   ├── AccountStatements.svelte           # NEW — one account's statements, upload, retry, move
│   │   ├── StatementMatch.svelte              # NEW — the matching workspace, full width
│   │   └── ReconciliationPage.svelte          # DELETED (2,852 lines, split into the two above)
│   ├── reports/
│   │   ├── report-links.ts                    # recordPathFor → /records/[id] (FR-027, FR-047)
│   │   └── AccountHistory.svelte              # DELETED — folded into RecordsPage statement mode
│   ├── journal/                               # DELETED — JournalPage, JournalSheet
│   │   └── journal-rules.ts                   # MOVED to components/ledger/ (the client balance mirror)
│   ├── expenses/, income/                     # DELETED
│   └── ui/
│       ├── Sidebar.svelte, BottomNav.svelte   # badgeFor: 'expenses' → 'records' (FR-024)
│       ├── StatusBadge.svelte                 # − the ExpenseStatus numeric branch (already
│       │                                      #   unreachable: every caller passes a label string)
│       └── AttachmentManager.svelte           # stale apiBase doc comment corrected
└── server/
    ├── ledger/
    │   ├── sides-from-accounts.ts  PURE       # two accounts → a kind (D-01)          [test-first]
    │   ├── coverage.ts             PURE       # cleared / clearedMinor (FR-056)       [test-first]
    │   ├── record-permissions.ts              # resourceForKind → 'records' for every kind
    │   ├── entry-builder.ts                   # UNCHANGED — still the only movement builder
    │   ├── types.ts                           # + cleared, clearedMinor, sideCount, RecordCreateFromSides
    │   │                                      #   + cleared/sort filters (the interface freeze: broadcast)
    │   └── upgrade/                           # DELETED — every file reads a dropped table (R-06)
    ├── permissions.ts                         # ResourceName: − expenses, income, journal
    │                                          #   + records, adjustments; ALL_RESOURCES likewise
    ├── permissions/
    │   └── merge-records.ts        PURE       # OR-merge, both tables (FR-029)        [test-first]
    ├── db/
    │   ├── schema.ts                          # − 9 tables; − invoices.result_income_id;
    │   │                                      #   − allocations.item_type/item_id;
    │   │                                      #   bank_statements.account_id NOT NULL
    │   ├── legacy-drop-guard.ts    PURE       # may the drop proceed? (FR-037a)       [test-first]
    │   ├── seed-accounts.ts                   # NEW — rescued from upgrade/accounts.ts, no legacy reads
    │   └── client.ts                          # guard BEFORE migrate(); + seedAccounts,
    │                                          #   + applyRecordsPermission beside ensureGroupSeed
    ├── loaders/
    │   ├── records.ts                         # NEW — one loader (from ledger.ts); − legacyDestination
    │   ├── accounts.ts                        # + statements-in-progress for the drawer card
    │   ├── reconciliation.ts                  # scoped to one account / one statement
    │   ├── ledger.ts, journal.ts              # DELETED
    │   └── reports.ts                         # − the account-history view
    ├── queries/
    │   ├── ledger.ts                          # − findByLegacy; + cleared aggregate, sideCount
    │   └── reconciliation.ts                  # unchanged candidate rule (FR-051)
    ├── import/duplicate-detector.ts           # DEFECT FIX — repointed at ledger_records [test-first]
    └── ...

src/routes/
├── +page.server.ts                            # redirect '/' → '/records' (was '/expenses')
├── (app)/records/                             # NEW — +page.svelte (openId=null), [id]/+page.svelte
├── (app)/accounts/
│   ├── [id]/history/                          # DELETED (D-05)
│   └── [id]/reconcile/                        # NEW — +page, and [statementId]/+page (FR-052)
├── (app)/settings/+page.svelte + .server.ts   # − Category tab, − saveCategories, − planCategoryChanges
├── (app)/expenses/, income/, journal/         # DELETED
├── (app)/reconciliation/                      # DELETED (empty [id]/match shells go too)
├── (app)/users-groups/+page.svelte            # RESOURCES: + records, adjustments, + descriptions
└── api/
    ├── records/stream/                        # NEW (FR-005)
    ├── records/statement/                     # NEW — replaces two endpoints (FR-040–FR-047)
    ├── accounts/[id]/reconciliation/statements # MOVED — account from the path (FR-050)
    ├── files/[...path]/                       # DEFECT FIX — + record_attachments check [test-first]
    ├── expenses/**, income/**, journal/**     # DELETED
    ├── reports/account-history/               # DELETED
    ├── accounts/[id]/movements/               # DELETED
    └── groups/[id]/permissions/               # RESOURCES + descriptions

drizzle/
└── 0015_*.sql                                 # 9 drops, 2 live-table rebuilds, 1 NOT NULL

CLAUDE.md                                      # 5 passages corrected — one of them already false
```

**Structure Decision**: the single SvelteKit project, unchanged in shape. This feature adds no layer and
no directory pattern; it deletes three feature directories and adds one (`components/records/`) that
follows the same "one shared page component, one shared loader, two small routes" convention every other
feature already uses. The four new rule modules sit in the two places pure rules already live —
`lib/server/ledger/` and, for the one that is about permissions rather than money,
`lib/server/permissions/`. The pre-migration guard sits in `lib/server/db/` beside the client that
calls it, because its whole reason for existing is the order in which that file does two things.

**Suggested delivery order**, matching the spec's priorities so each stage is independently verifiable:

1. **The three defects first** (research.md R-13), each with its failing test. They are prerequisites
   for the drop, they are independently shippable, and two of them are currently broken in production.
2. **US6 — the permission merge** (P2, but first in code). Everything else checks `records`, so merging
   the resource before merging the screens means one gate change per route rather than two.
3. **US1 + US2 — the one screen and the one form** (P1). The feature's reason for existing.
4. **US3 + US4 — the flat account list and categories in one place** (P1/P2). Self-contained; neither
   blocks nor is blocked by the merge.
5. **US5 — re-point every link** (P2). Cheap once the destination exists; `report-links.ts:35,38`,
   `+page.server.ts:4`, `SettlementList`, the nav badge.
6. **US8 — reconciling from the account** (P2). The largest single piece of work: splitting a
   2,852-line component and giving the matching surface the address it never had.
7. **US7 — clear the remains** (P3). Last, because it is irreversible and because steps 1 and 6 remove
   its last readers.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| A destructive migration: nine tables dropped and two **live** tables rebuilt to remove a dead column, against the constitution's "migrations are additive and reversible in intent" | FR-037 and FR-037b require it, and D-03 settles that the removal is outright. The tables and the two allocation columns were explicitly kept "unread for one release" by 002's D-17; that release has passed. `invoices.result_income_id` and `reconciliation_allocations.item_type/item_id` cannot be dropped in place because SQLite cannot drop a column carrying a foreign key. | Keeping them another release means the data model keeps showing tables that look live and are not — the dead weight this feature exists to remove. The constitution's actual requirement for a destructive change is that it *state its data-migration path*, which data-model.md §1 does, in FK-safe order. FR-038's backup warning leads the release notes, and FR-038a's whole-books check runs afterwards. |
| The pre-migration guard reads `sqlite_master`, which is not a declared Drizzle table, against "SQLite accessed exclusively through Drizzle ORM" | The guard must answer "do the legacy tables still exist, and were their rows converted?" *before* `migrate()` runs, because `migrate()` is called at module load in `db/client.ts:30` and `ensureLedgerUpgrade` only afterwards in `hooks.server.ts`. Nothing else can tell whether the drop is safe, and no declared table records whether a table exists. It is a **read**, executed through Drizzle's own raw `sql` escape hatch, and the `settings` phase it also reads uses the typed table. | Putting the check inside the migration cannot work: the drop would already have run. Putting it after `migrate()` is the same failure one line later. Requiring the maintainer to run a command first contradicts FR-037's inheritance from the earlier upgrade, which needed no command and no setting. The alternative that does not read the schema — trusting the migration journal — is exactly the assumption that fails on the installation that skipped a release. |
| `/expenses/[id]` and `/income/[id]` stop resolving, breaking "every record is a shareable URL" for links written before this release, with no redirect | FR-025 and D-04 state it outright: the maintainer does not keep or share links to records, so there is nothing to preserve, and FR-025a removes the pre-conversion lookup with them. In-app links remain the app's responsibility and are all re-pointed (US5, FR-027). | A redirect layer plus the `legacyDestination` / `findByLegacy` lookup is real code, a permanent route and a permanent index, kept alive for a case that does not occur. 002 built exactly that lookup for income ids and this release is the evidence it was never needed. Every record still has a shareable URL — one per record, at `/records/[id]`. |
| The account statement is a mode of the Records list rather than its own full page, and its running balance appears conditionally | D-05. Otherwise there are two answers to "show me everything for this account" — the history page and the Records account filter — which is the duplication of the spec's review item 8, one level down. A running balance only means anything when the rows are complete and in date order, so it must vanish when another filter narrows the set or the sort changes (FR-043). | Keeping the separate page keeps the duplication and keeps the split ability that made it a defect: the page's shell is gated on `accounts.view` while its data came from an endpoint gated on `reports.view`, so a user with one and not the other got a page that loaded and then refused. Hiding the column silently was rejected too — the screen says why it went, because a missing figure with no explanation reads as a fault. |
| Two reconciliation routes are full pages, not `Sheet` drawers, and `SettlementList`'s `canOpen` changes meaning | FR-052 requires a full-width surface showing bank lines, candidate records and the current selection together; a 500px drawer cannot. `CLAUDE.md` already carries a named task-workspace exception for this shape — and that exception currently cites `/reconciliation/[id]/match`, a route commit `e5568b1f` deleted, so the documentation is already false and this is the change that makes it true. `canOpen` gated navigation to Expense and Income rows only, because Payment and Transfer had no screen; now every kind does. | Squeezing the matching workspace into the account drawer loses the context that makes matching possible. Leaving `canOpen` alone would leave a payment row without the chevron every other row has, for a reason that no longer exists — and `CLAUDE.md` names it as the one function to update if a payments list is ever added. Every screen that *is* a record's detail keeps the Sheet standard, so the drawer chrome stays uniform. |
| `RecordView` carries three near-neighbour fields — `reconciled`, `cleared`, `clearedMinor` | They answer different questions and the codebase already computes both under one name in two places that disagree: `matchedMovements()` is an existence check, the reconciliation workspace is amount-aware. FR-056's filter must agree with the workspace it replaces, or a user gets two answers on two screens. `locked` must stay existence-based: if any bank line points at a record, its amount must not change, covered or not. | One field means choosing between a lock that lets a matched record be edited and a worklist that hides partly matched work. Both are silent wrongness. Invariant 10 (`cleared` is true exactly when `clearedMinor` equals `amountMinor`) is what keeps the pair from drifting, and the coverage arithmetic is developed test-first. |
