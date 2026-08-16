# Implementation Plan: Double-Entry Ledger

**Branch**: `002-double-entry-ledger` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-double-entry-ledger/spec.md`

## Summary

Every record in Akaun gains a second side, so it says where the money came from and where it went, and
the totals can check themselves. Three one-sided tables (`expenses`, `incomes`, `claims`) are replaced
by one store — `ledger_records` (what happened) plus `ledger_movements` (each side of it) — against a
chart of `accounts` in which today's categories *are* accounts. Claims retire and become payments plus
settlements. Reconciliation starts belonging to an account. Profit and loss, balance sheet and partner
statement become possible for the first time.

The problem that started it: a Shopee statement arrives monthly as one figure, but the money reaches
the bank as several withdrawals. With a Shopee wallet account, the income books when it was earned and
each withdrawal is a transfer that matches its deposit exactly — the withdrawal is the only candidate
for its bank line, and the income is never offered, because it never touched the bank.

Technical approach:

- **Six new tables, four altered** — `accounts`, `ledger_records`, `ledger_movements`, `settlements`,
  `record_attachments`, `record_search_text`; `bank_statements` gains an account,
  `reconciliation_allocations` points at a movement instead of a record, `invoices` gains its ledger
  link, and `import_queue` gains the account an imported record affected. `contact_roles` gains a
  Partner code but no column. One committed `drizzle-kit generate` migration.
- **Money is whole cents in an integer column** (`amount_minor`, signed, summing to zero per record).
  That is what makes "the two sides cancel out exactly" (FR-002) and "the books balance" (FR-003)
  provable rather than approximate — the existing code already concedes floats can't do it, comparing
  money with an `EPSILON` of 0.005. The record still keeps the amount as entered plus its locked
  exchange rate, for display and audit (research.md D-02).
- **Nothing about payment state is stored.** Paid, outstanding, "how much is left", a contact's
  balance and every account balance are computed from movements and settlements, so two screens can
  never disagree (FR-012, FR-031). `invoices.amount_paid` and `expenses.status` both go.
- **Pure rule modules under `$lib/server/ledger/`**, developed test-first: building the movements for
  each kind, converting to cents, settlement arithmetic, record locking, the integrity sweep, and the
  three reports. Routes parse, authorise and delegate; services own the permission-checked write with
  audit and SSE.
- **The upgrade is code, runs itself at startup**, is idempotent, resumable, verified before anything
  old is thrown away, and needs no command from a self-hosting user. It backs up the database file
  first, converts, moves attachment files by copy-verify-then-remove, repoints reconciliation, and
  compares every total, count, reference number and file hash before and after. It also works out by
  rule, rather than by asking, who each pre-upgrade reimbursement is owed to (FR-036b), and reports
  every attribution it made so a wrong one is visible instead of silent.
- **The product on top does not change.** Expenses, Income, Contacts, Import, Reconciliation,
  Quotations and Invoices keep their screens and their URLs; Expenses and Income become filtered views
  of the one store. Claims is the single screen removed. Three new screens arrive: Accounts, Reports,
  and a direct-entry Journal behind its own permission.

## Technical Context

**Language/Version**: TypeScript (strict) on Bun; Svelte 5 (runes mode forced project-wide)

**Primary Dependencies**: SvelteKit 2, Drizzle ORM 0.45 (`bun:sqlite` driver), Zod 4, bits-ui 2,
Tailwind 4, `pino`. **No new runtime dependency** — cents arithmetic is integers, CSV export is string
building, and file hashing uses `node:crypto`, all already available.

**Storage**: single SQLite file via Drizzle; six new tables and four altered ones in one committed
`drizzle-kit generate` migration, followed by a code-based data upgrade. Attachments consolidate into
`STORAGE_PATH/records/YYYY/MM/`. A pre-upgrade copy of the database goes to
`data/backups/pre-ledger-<timestamp>.db`.

**Testing**: Vitest — `server` project (node, `*.spec.ts`) for every rule module, over plain row
objects with no database. The upgrade conversion is the exception and is tested against a **real
temporary SQLite database** seeded with legacy rows, as the constitution requires; the `client`
project is not used by this feature.

**Target Platform**: one SvelteKit app served to browser, installable PWA, Tauri desktop sidecar and
mobile web — no surface-specific code paths.

**Project Type**: single full-stack web application (`src/routes` + `src/lib` + `src/lib/server`)

**Performance Goals**: the whole-books check (FR-003, SC-002) is two indexed aggregates and must
finish well inside a minute on the reference data (192 expenses, 34 claims, 7 incomes) and stay under
it at ~50k records. A list screen's derived paid state is one grouped join on an indexed column,
alongside the reconciliation-coverage subquery the list already carries. The upgrade blocks startup;
on the reference database it is a few hundred rows and a few hundred file copies.

**Constraints**: no new datastore, broker or worker service; the upgrade must complete with no manual
step and be safe to re-run (FR-037); previous data stays recoverable until verification passes
(FR-038); no existing reference number may change (FR-032d); every screen usable at mobile widths;
financial amounts never logged.

**Scale/Scope**: single self-hosted business, one installation. 6 new tables, 4 altered, 3 new enum
groups, ~25 API endpoints (of which ~12 are new), 3 new routes, 1 route removed, ~10 new Svelte
components, and the largest rewrite in the codebase to date — `queries/expenses.ts`,
`queries/income.ts`, `queries/claims.ts`, both loaders, `ExpensesPage.svelte` (1,919 lines) and
`IncomePage.svelte` (1,774 lines) all repoint at the one store.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Principle | Status | Check |
|------|-----------|--------|-------|
| Single codebase | I | **PASS** | No surface-specific fork. Accounts, Reports and Journal collapse to a single column below the mobile breakpoint via the existing `useIsMobile()` hook; every new drawer uses `panelSide = isMobile ? 'bottom' : 'right'` (FR-043). |
| Lightweight | II | **PASS** | No new datastore, broker or worker service — the upgrade runs in-process at startup beside the existing `ensureDefault*()` calls, and the integrity check is two aggregate queries run on demand. No new runtime dependency. No feature requires a network service; nothing here touches an LLM provider. |
| YAGNI | III | **PASS** | No user-defined liability or equity accounts, no automatic equipment-cost schedules, no tracking-category dimension, no stock, no tax fields, no PDF report export — all out of scope, each left as a named seam (a new role in one map; an ordinary journal record; the existing `pdfkit` pipeline). The `kind` column is not speculative — it carries intent the movements cannot (equipment bought versus money moved), keeps a direct journal entry distinguishable from an everyday expense, and records which running-number counter issued the record's number (D-04). Logic placed by layer: `routes/` → `services/` → `queries/` → `db/`, with pure rules in `lib/server/ledger/`. |
| SOLID boundaries | IV | **PASS** | Routes parse + `hasPermission` + delegate. Rules in `lib/server/ledger/*.ts` as pure functions over plain rows; writes in `lib/server/services/{ledger,accounts,settlements}.ts`; queries in `lib/server/queries/{ledger,accounts,reports}.ts`. No `services/` → `routes/` import. Every request body, form submission and imported figure validated with Zod at the boundary. `entry-builder.ts` is the single place movements are constructed, so the balance rule has exactly one enforcement point. |
| Mutation obligations | IV | **PASS** | Every mutating endpoint in [contracts/api.md](./contracts/api.md) is specified with its `hasPermission` resource + action (403 on fail), Zod schema, `recordAudit` call, and its emit on `ledgerEvents` / `accountEvents`. Settlements are audited explicitly (FR-041), as are account archive and opening-balance writes. |
| TDD scope | V | **PASS** | Test-first and named in [research.md](./research.md) D-22 and [quickstart.md](./quickstart.md): `money.ts`, `entry-builder.ts`, `settlement-rules.ts`, `locking.ts`, `integrity.ts`, `account-type.ts`, the three report modules plus `csv.ts`, `upgrade/payer.ts`, `upgrade/verify.ts`, and the updated `reconciliation/matching.ts`. `upgrade/convert.ts` is tested against a real temporary SQLite database, not a mock. No coverage target introduced. |
| Established patterns | VI | **PASS** (2 recorded deviations) | Live updates through `ledgerEvents` / `accountEvents`, no polling. Every record detail and create/edit drawer uses the shared `Sheet` standard, including the new account, opening-balance, payment and journal drawers. Records stay reachable at `/expenses/[id]` and `/income/[id]` through the same shallow-routing pattern, with a redirect that keeps pre-upgrade links working (D-14). The payment card on an expense and the settled-items list on a payment use the `related-link` contract. **Deviations**: Reports and the account-history view are full pages rather than drawers, and the claims screen is deleted along with its deep links — both recorded in Complexity Tracking. |
| Fixed stack | Tech Constraints | **PASS** | Svelte 5 runes, Drizzle + SQLite only, schema change via `drizzle-kit generate` with the migration committed; no hand-applied schema mutation. All new server code under `$lib/server/**`; the client-side copies of the record-locking and account-type rules carry the required `// Mirrors …` comment. Destructive schema change states its data-migration path, and defers the drops entirely (D-17). |

**Post-Phase-1 re-check**: re-evaluated after [data-model.md](./data-model.md) and `contracts/` were
written — all gates still hold. Three design choices were tightened by the re-check:

1. **`AccountType` is no longer stored.** It is looked up from `role` by a pure map, because storing
   both is exactly the drift FR-006a forbids (D-05).
2. **A sixth invariant was added** tying a record's entered amount to its movements. FR-005 requires
   the entered amount and its rate to be kept, so the converted figure necessarily exists twice; the
   invariant plus a single writing path (`entry-builder.ts`) is what stops them drifting.
3. **`settlements` links movement to movement, not record to record**, so the over-allocation refusal
   (FR-016) is a local check against one movement's own amount rather than a re-derivation.

**Post-clarification re-check (2026-08-16)**: the spec gained FR-036b and FR-036c, closing the two
decisions research.md had carried as open (D-12, D-19). Every gate was re-evaluated against the
amended spec and all still hold. One design consequence follows, and is the only structural change
this re-check makes:

- **Who a pre-upgrade reimbursement is owed to becomes a pure module**, `upgrade/payer.ts`. FR-036b
  is an ordered resolution — email, then name, then the installation's one real user when the
  creator is the seeded administrator, then a created contact named through a fallback chain — that
  decides the counterparty on every migrated reimbursement. It is precisely Principle V's "logic
  that can be wrong silently": pick the wrong contact and the records still balance, the totals
  still match, and nothing looks broken. Left inside `convert.ts` it could only be exercised through
  a real database; extracted, it is red-green testable over plain rows, and `convert.ts` keeps one
  job — writing what the rule decided. FR-036c's "unpaid, unclaimed, names nobody" fallback lives in
  the same module for the same reason.
- **The upgrade report gains a section** listing every payer attribution with the step that chose it,
  and every FR-036c bank fallback, because both requirements make the report the place a wrong guess
  becomes visible rather than silent.
- No new gate is threatened: the module adds no dependency, no datastore and no service, and it
  removes a piece of multi-step logic from a file that already carries orchestration (Principle IV).

## Project Structure

### Documentation (this feature)

```text
specs/002-double-entry-ledger/
├── plan.md              # This file
├── research.md          # Phase 0 output — 22 decisions, all confirmed (D-12, D-19 closed 2026-08-16)
├── data-model.md        # Phase 1 output — 6 new tables, 4 changed, invariants, upgrade mapping
├── quickstart.md        # Phase 1 output — validation guide, 9 scenarios
├── contracts/
│   ├── api.md           # HTTP endpoints, request shapes, refusals, mutation obligations
│   └── events.md        # SSE stream contract
├── checklists/
│   └── requirements.md  # Existing spec-quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/lib/
├── enums.ts                                  # + AccountRole, AccountType, LedgerRecordKind;
│                                             #   Role.Partner = 4; ReconItemType retired (kept, unused)
├── sequence-template.ts                      # `claim` key renamed `payment`, prefix stays 'CL' (D-13)
├── nav-config.ts                             # − Claims; + Accounts, Reports, Journal
├── components/
│   ├── ledger/
│   │   ├── RecordSheet.svelte                # shared record detail/edit drawer (Sheet standard)
│   │   ├── PaymentSheet.svelte               # record a payment + tick what it covers (FR-015)
│   │   ├── SettlementList.svelte             # what this payment covered / what paid this (related-link)
│   │   └── AccountSelect.svelte              # "which account paid?" — defaults, one control (FR-011)
│   ├── accounts/
│   │   ├── AccountsPage.svelte               # chart of accounts + balances
│   │   ├── AccountSheet.svelte               # add/edit/archive (Sheet standard)
│   │   └── OpeningBalanceSheet.svelte        # FR-010
│   ├── reports/
│   │   ├── ProfitLossReport.svelte
│   │   ├── BalanceSheetReport.svelte
│   │   ├── PartnerStatementReport.svelte
│   │   └── AccountHistory.svelte             # FR-028
│   ├── journal/JournalPage.svelte            # direct entry, own permission (FR-040)
│   ├── expenses/ExpensesPage.svelte          # REPOINTED at ledger records; screen unchanged
│   ├── income/IncomePage.svelte              # REPOINTED
│   ├── invoices/InvoicesPage.svelte          # + Issue action, derived paid/outstanding
│   ├── contacts/ContactsPage.svelte          # + Partner role, archive-not-delete (FR-009a)
│   ├── reconciliation/*.svelte               # + account on statement; candidates are movements
│   └── claims/                               # DELETED (FR-036a)
└── server/
    ├── ledger/
    │   ├── events.ts                         # ledgerEvents + accountEvents
    │   ├── types.ts                          # row types, cent helpers
    │   ├── money.ts             PURE         # entered amount → cents, splits, rounding   [test-first]
    │   ├── entry-builder.ts     PURE         # movements per kind; the balance rule       [test-first]
    │   ├── settlement-rules.ts  PURE         # outstanding / paid / over-allocation       [test-first]
    │   ├── locking.ts           PURE         # settled-or-reconciled field lock (FR-017a) [test-first]
    │   ├── integrity.ts         PURE         # every record balances; books balance       [test-first]
    │   ├── account-type.ts      PURE         # role → type map, sign for display          [test-first]
    │   ├── reports/
    │   │   ├── profit-loss.ts   PURE                                                      [test-first]
    │   │   ├── balance-sheet.ts PURE                                                      [test-first]
    │   │   ├── partner-statement.ts PURE                                                  [test-first]
    │   │   └── csv.ts           PURE         # FR-029                                     [test-first]
    │   └── upgrade/
    │       ├── index.ts                      # phases, idempotency, backup, orchestration
    │       ├── accounts.ts                   # system + category accounts (FR-032a)
    │       ├── convert.ts                    # expenses/incomes/claims → records+movements+settlements
    │       ├── payer.ts         PURE         # who a pre-upgrade reimbursement is owed to  [test-first]
    │       │                                 #   (FR-036b's four ordered steps, FR-036c's fallback)
    │       ├── attachments.ts                # copy → verify → rewrite path → deferred remove
    │       ├── reconciliation.ts             # allocations → movement_id; statements → account
    │       └── verify.ts        PURE-ish     # before/after comparison (SC-001, 013, 014) [test-first]
    ├── queries/
    │   ├── ledger.ts                         # all reads/writes for records + movements
    │   ├── accounts.ts                       # chart of accounts + balances
    │   ├── settlements.ts                    # outstanding items, ageing (US6)
    │   ├── reports.ts                        # the aggregates the report modules consume
    │   ├── {expenses,income,claims}.ts       # DELETED — callers repointed to ledger.ts
    │   └── categories.ts                     # DELETED — categories are accounts (FR-006a)
    ├── services/
    │   ├── ledger.ts                         # permission-checked writes + audit + emit
    │   ├── accounts.ts
    │   ├── settlements.ts
    │   └── claims.ts                         # DELETED
    ├── loaders/
    │   ├── ledger.ts                         # shared loader behind /expenses and /income
    │   ├── accounts.ts, reports.ts, journal.ts
    │   └── claims.ts                         # DELETED
    ├── reconciliation/{matching,types}.ts    # candidates become movements on the statement's account
    ├── permissions.ts                        # − claims; + accounts, reports, journal
    ├── audit.ts                              # RecordType: − claim; + record, account, settlement
    ├── locking.ts                            # claim rules removed; re-exports ledger/locking.ts
    ├── file-storage.ts                       # + records/YYYY/MM layout, copy-verify helpers
    ├── search-rebuild/worker.ts              # repointed at record_attachments / record_search_text
    ├── import/worker.ts + confirm route      # + account_id; creates a ledger record
    └── db/
        ├── schema.ts                         # + 6 tables, 4 altered; legacy tables kept @deprecated
        └── client.ts                         # seed perms for accounts/reports; claims perms removed

src/routes/
├── (app)/expenses/, income/                  # unchanged URLs, incl. /[id] deep links
├── (app)/accounts/, accounts/[id]/           # chart of accounts + account history
├── (app)/reports/                            # profit-loss | balance-sheet | partners
├── (app)/journal/                            # direct entry (FR-040)
├── (app)/claims/                             # DELETED (FR-036a)
├── (app)/settings/+page.svelte               # + "Check the books" action (SC-002)
└── api/
    ├── accounts/**, records/**, settlements/**, reports/**, ledger/integrity, accounts/stream
    ├── expenses/**, income/**                # kept as thin wrappers that set `kind`
    ├── reconciliation/**                     # + accountId; + lines/[lineId]/transfer (FR-023)
    ├── invoices/[id]/issue                   # FR-018a
    └── claims/**                             # DELETED

drizzle/
└── 0014_*.sql                                # generated migration (6 new tables, 4 altered)

CLAUDE.md                                     # + reports/account-history page exception; retire the
                                              #   claims references; note the ledger patterns
```

**Structure Decision**: single SvelteKit project, extended in place, following the app's existing
four-layer server split (`routes/` → `services/` → `queries/` → `db/`) with a `lib/server/ledger/`
directory holding the pure rule modules the services compose — the same shape
`lib/server/reconciliation/` and `lib/server/import/` already use, and what makes the Principle V
test-first scope reachable without a database. The upgrade lives in its own subdirectory under it,
because it is the one part of the feature that is written once, runs once per installation, and must
be readable as a sequence of phases.

**Suggested delivery order**, matching the spec's own priorities so each stage is independently
testable: schema + `accounts` + the pure rule modules → the upgrade and its verification (US1, P1) →
Expenses/Income repointed and the wallet flow (US2, P1) → settlements and payments (US3, P2) →
reconciliation by account (US4, P2) → reports (US5, P3) → who-owes-what views (US6, P4).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Legacy tables (`expenses`, `incomes`, `claims`, their attachment and search tables, `categories`) stay in the schema for one release, unread — code the constitution would otherwise call dead | FR-038 requires the previous data to stay recoverable until the verification passes. Drizzle applies schema migrations at startup *before* the data-conversion code runs, so a `DROP TABLE` in the same migration would destroy the data before anything could verify it. | Dropping them at the end of the upgrade run, after verification, would work — but it puts an irreversible drop behind a check shipped in the same release that introduces it, on databases the maintainer cannot recover for. Each table carries a `@deprecated` comment naming the release that removes it (research.md D-17). |
| `reconciliation_allocations` keeps its now-unused `item_type` / `item_id` columns alongside the new `movement_id` for one release | Same reason: the backfill that repoints every existing bank match (FR-034) must stay inspectable against what it came from until the upgrade is verified. | Dropping them in the same migration removes the only evidence that the repointing was correct, on exactly the data — historical bank matches — the user is least able to reconstruct by hand. |
| Reports and account history are full pages, not `Sheet` drawers | A profit and loss, a balance sheet and a full account history are multi-column tables read side by side and exported; they are not a record's fields. `CLAUDE.md` already carries a named workspace exception for exactly this shape, established by the reconciliation matching route. | A 500 px drawer cannot show a report a user is meant to read across and check. Every screen that *is* a record detail — account, opening balance, payment, journal entry, record detail — keeps the Sheet standard, so the drawer chrome stays uniform. Each report page still has its own deep-linkable URL. |
| The claims screen and every `/claims/[id]` link are deleted, breaking the "every record is a shareable URL" rule for those records | FR-036a states it outright, and the user confirmed the links are not in use anywhere. What a claim recorded is preserved — it becomes a payment plus the settlements saying which expenses it covered. | Keeping a redirect from every old claim URL to the payment it became would preserve links nobody follows, at the cost of a permanent lookup table and a route for a concept the release exists to remove. Every *other* pre-upgrade link, including income, is preserved (research.md D-14). |
| A record stores its entered `amount` and rate as well as movements in cents — the same money twice | FR-005 requires the amount as entered and the rate locked at creation to be kept, and the ledger requires exact integer cents. Neither can be dropped. | Deriving the entered amount back from cents loses the original figure for any rate that is not 1, which is the one thing FR-005 exists to protect. The redundancy is contained by making `entry-builder.ts` the only writer of either and adding invariant 6 (data-model.md), which the integrity sweep checks on every run. |
