# Phase 0 Research: One Ledger, One Records Screen, One Flat Account List

**Branch**: `003-simplify-double-entry` | **Date**: 2026-08-17 | **Spec**: [spec.md](./spec.md)

Every decision below is settled. Each one names what it gives up, per Principle VII. The spec's own
decisions are numbered `D-01`–`D-06` and are inputs here; the decisions this document adds are
numbered `R-01`–`R-14`.

Nothing in this document needed a `NEEDS CLARIFICATION` marker. The spec arrived with all six of its
decisions settled, so Phase 0 was not about resolving open questions — it was about reading the code
the spec describes and finding out where the description and the code disagree. It did, in five
places, and those are recorded as R-05, R-09, R-10, R-12 and R-13.

---

## What the survey found that the spec did not know

The spec was written from the product's behaviour. Six parallel reads of the code found five facts
that change the work, and three defects that this feature cannot ship without fixing.

### The five corrections

| # | The spec assumed | The code says |
|---|---|---|
| 1 | The reconciliation matching surface exists at `/reconciliation/[id]/match` and keeps its address (FR-052). | **That route does not exist.** Commit `e5568b1f` deleted it when reconciliation became one continuous workspace. The directories are empty shells. FR-052 is therefore *new* work — an address is being created, not preserved. `CLAUDE.md` cites the dead route as its task-workspace reference, so the documented exception is already false. |
| 2 | Reconciliation has a cross-account "still needs clearing" **tab** (FR-056, D-06). | It is a **status filter** ("Needs Review") on the "Akaun Records" tab, and it is not cross-account: `workspace()` only ever loads movements on accounts that already have an uploaded statement. |
| 3 | The old attachment and search tables are FTS tables with triggers. | **There is no FTS5 anywhere in the codebase.** Search is plain `*_search_text` side-tables queried with `LIKE`. No trigger references any legacy table, so the drop has no trigger dependencies — it has FK dependencies instead, which is a different and harder problem (R-05). |
| 4 | The legacy tables are unread (item 6 of the spec's review). | Two live code paths still read them, and one live table still has a foreign key into one of them. See the three defects below. |
| 5 | A saved mobile-nav preference naming a removed screen needs handling (FR-026). | Already handled. `navPreferences.ts:34` skips any `itemId` not in `DEFAULT_NAV_ITEMS`, and `setUserNavOrder` drops unknown ids on save. FR-026 needs a test, not code. |

### The three defects this feature must fix

These are not scope creep. Each one is a thing FR-037 would break, or a requirement that is already
untrue. Principle V makes every one of them test-first: a test that fails before the fix.

**1. Attachments on ledger records cannot be downloaded at all.** `AttachmentManager.svelte:77`
links to `/api/files/{filename}`. For a ledger record that filename is a `records/YYYY/MM/…` path
stored only in `record_attachments`. But `api/files/[...path]/+server.ts:37–52` checks ownership
against `expense_attachments`, `income_attachments`, `claim_attachments` and `bank_statements`
only — never `record_attachments` — so line 65 returns **403**. Records converted by the earlier
upgrade broke too, because the conversion rewrote `record_attachments.filename` to the new path
while the legacy row kept the old one. FR-014 ("attachments remain available exactly as today") and
FR-039 ("no attachment may change") both already fail, and FR-037 drops the three tables this route
depends on.

**2. Auto Import's duplicate check reads the tables that are being dropped.**
`import/duplicate-detector.ts:3,85` does `const table = isIncome ? incomes : expenses`, called live
from `worker.ts:241`. Since the confirm route now writes to `ledger_records`, this check can never
see a record created after the conversion — it is already silently ineffective, which is precisely
the "wrong and nobody notices" that Principle V exists for. FR-035 requires Auto Import to keep
working, and the drop makes this a compile error rather than a silent one.

**3. A live table has a foreign key into a table being dropped.**
`schema.ts:526` — `invoices.result_income_id` references `incomes.id`. Dropping `incomes` means
rebuilding the live `invoices` table, not just dropping dead ones.

---

## R-01 — One `RecordsPage.svelte`, grown from `ExpensesPage.svelte`

**Decision**: One screen component, `src/lib/components/records/RecordsPage.svelte`, created by taking
`ExpensesPage.svelte` (1,347 lines) as the base and folding in what Income and Journal add.
`ExpensesPage.svelte`, `IncomePage.svelte` (1,046), `JournalPage.svelte` (238) and their six route
files are deleted.

**Why this base**: Expenses is a strict superset of Income in machinery. It already has the status
filter, the status column, the selection bar, the outstanding panel and the `PaymentSheet`; Income has
none of those and adds only a `+` sign, a green amount, and four different stat tiles. Journal adds
nothing to the *list* — it is 238 lines of simple card rows with no table, no sort, no filter and no
selection — and everything it contributes is in its drawer (R-02).

**What the merged screen keeps from each**:

- From Expenses: the table, sort, date range, selection and delete bar, the status filter, the
  `StatusBadge` column, the "Still owed" panel and its `PaymentSheet`.
- From Income: nothing structural. The `+` prefix and green amount become a per-row rule driven by
  the record's own sign, not by which screen you are on.
- From Journal: nothing in the list. Its `journal-rules.ts` client mirror survives and moves to the
  merged drawer.

**Stat tiles**: one set of four, in the vocabulary the Dashboard already uses — Money in, Money out,
Still owed, All records. Expenses and Income each had four tiles chosen for their own screen (Income
had "This quarter" and "Largest payment"); a merged screen cannot show eight.

**What this gives up**: Income's "This quarter" and "Largest payment" tiles, and Expenses' split of
"Still owed / Paid / This month". Anyone who used those loses a figure that was one glance away and
is now a filter plus a total. Accepted: the alternative is a screen whose header changes shape
depending on what is filtered, which is worse than a fixed header.

**Alternative rejected**: keeping three components behind one route and switching on a tab. That is
the current product with one fewer URL — it removes nothing, and SC-001 measures screens a record can
live on, not routes.

---

## R-02 — The kind of record is derived from the two accounts, by a pure rule

**Decision**: A new pure module, `src/lib/server/ledger/sides-from-accounts.ts`, developed test-first.
It takes the two accounts a user named plus any further sides, and returns the `RecordCreateSides`
the existing `entry-builder.ts` already accepts:

```ts
sidesFromAccounts(input: { fromAccountId, toAccountId, extraSides?, contactId }, ctx: BuildContext)
  : Refusable<RecordCreateSides>
```

This is what makes D-01 real. The form asks two everyday questions — which account the money left,
which account it went to — and the *kind* falls out of the roles of those two accounts rather than
being asked:

| Money left an account with role… | …and went to one with role | Kind |
|---|---|---|
| money pot (Bank/Wallet/Cash/Card) | ExpenseCategory or Equipment | Expense |
| IncomeCategory | money pot | Income |
| money pot | money pot | Transfer |
| money pot | Payable (we owe) | Payment, `we-pay` |
| Receivable (owed to us) | money pot | Payment, `we-receive` |
| Payable (someone else paid) | ExpenseCategory | Expense with `paidFromAccountId: null` |
| OpeningBalances | any | OpeningBalance |
| anything else, or three or more sides | — | Journal |

**Why a separate module and not inside `entry-builder.ts`**: `entry-builder.ts` is the single place
movements are constructed, and `CLAUDE.md` states that a route or service that builds its own
movements is a defect. That rule stays intact — this module builds no movements. It translates a
two-account answer into the shape the builder already takes, and the builder still enforces the
zero-sum rule. Keeping them separate also means the derivation is testable over plain role codes with
no accounts, no context and no database.

**Why test-first**: this is Principle V's central case. A wrong kind still balances, still totals
correctly, and still passes the whole-books check — it just files the record on the wrong report and
under the wrong label. Nobody notices.

**What this gives up**: the user can no longer *state* the kind, so a record whose two accounts are
ambiguous gets the app's reading rather than the user's. The `InvoiceIssue` kind is unreachable from
the form on purpose (FR-013), and `Journal` becomes the honest catch-all for anything the table above
does not name — which is exactly what gates it behind R-03.

**Alternative rejected**: keeping `kind` as a field the form sets from a picker. It reintroduces the
question D-01 removes, and it makes two sources of truth for the same fact — the picker and the
accounts — that can disagree.

---

## R-03 — The free-choice ability is a renamed resource, `adjustments`

**Decision**: The `journal` resource is **renamed** to `adjustments` in `ResourceName`,
`ALL_RESOURCES`, and both `RESOURCES` arrays in the admin UI. It gates exactly two things on the one
form (FR-031): reaching the full list of accounts on a side, and adding a third or later side.

**Why rename rather than add**: one row becomes one row, so FR-031b costs nothing — a plain
`UPDATE … SET resource='adjustments' WHERE resource='journal'` on both permission tables preserves
whatever anyone held, with no primary-key collision and no merge. And because no seeded group grants
`journal` today (verified: `SEED_GROUPS` in `db/client.ts:61–266` — Bookkeeper, Data Entry and
Reviewer all omit it; Administrators only passes via the `isSuperuser` early return), FR-031a is
satisfied by inheritance rather than by a new rule.

**Why not keep the key `journal`**: it would cost no migration at all. Rejected because a permission
named after a screen that no longer exists is exactly the unguessable rule this feature was written to
remove — item 4 of the spec's own review. Trading a one-line migration for an honest name is the
right way round.

**Why `adjustments`**: D-02's own rationale names what the ability is for — "corrections and year-end
adjustments". It is one everyday word, it matches the existing lowercase single-word convention of
every other resource, and it describes the purpose rather than the mechanism. Its admin-UI
description (FR-031e) reads: *"Lets someone write a record between any two accounts, and add more
than two sides. Needed for corrections and year-end adjustments. Grant it only to someone you trust
with the books, because a record written this way can make the accounts say anything and still add
up."*

**Which action gates what**: `adjustments.add` for creating, `adjustments.change` for editing. The
rename carries each holder's existing actions across unchanged.

**What this gives up**: an administrator has one more ability to understand, and the word "journal"
disappears from a screen someone may have learned. Accepted — D-02 already weighed this and chose the
control over the convenience.

---

## R-04 — The records permission merge is a pure OR-merge, applied once, over both tables

**Decision**: `expenses`, `income` → one `records` resource. The merge is a pure function developed
test-first, `src/lib/server/permissions/merge-records.ts`, plus a thin idempotent applier called from
the existing seed path in `db/client.ts` beside `ensureGroupSeed()`, guarded by a `settings` key.

**Why this is not a rename**: `group_permissions` and `user_permissions` are both keyed
`(ownerId, resource)` with `resource` as a **plain text column** — no enum, no foreign key, no lookup
table. Two source rows therefore collapse onto one primary key. A naive `UPDATE` either fails on the
unique constraint or silently keeps whichever row it wrote last, which would revoke access and break
FR-029. The four booleans must be OR-ed first:

```
records.canView   = expenses.canView   OR income.canView
records.canAdd    = expenses.canAdd    OR income.canAdd
records.canChange = expenses.canChange OR income.canChange
records.canDelete = expenses.canDelete OR income.canDelete
```

**Both tables.** The precedent for retiring a resource string is `dropClaimPermissions()`
(`upgrade/index.ts:125–134`), and it touched `group_permissions` only. Repeating that omission would
silently discard every per-user override, which is a direct FR-029 failure and one nobody would see
until a user complained about access they used to have. This is the single most testable claim in the
feature and SC-006 measures it account by account.

**Why code and not SQL**: expressible as `INSERT … SELECT MAX(can_view), …  GROUP BY group_id`, but
Principle V names permission resolution as TDD-required, and a pure function over rows is red-green
testable while a SQL statement inside a migration is not. The applier writes what the rule decided.

**Why beside `ensureGroupSeed()` and not as a ledger-upgrade phase**: the ledger upgrade is retired by
this release (R-06). Permissions do not depend on the record conversion, so the merge has no reason to
sit behind that gate.

**What this gives up**: one more idempotent startup step and one more `settings` key. Folding it into
the migration SQL would have been fewer moving parts, at the cost of the one test that proves nobody
lost access.

---

## R-05 — The legacy drop is gated *before* migrations run, by a pure guard

**Decision**: The drops live in one committed `drizzle-kit generate` migration. A pure guard function
decides whether that migration may proceed, and it is called in `db/client.ts` **immediately before
`migrate(db, …)`** on line 30. If it refuses, the server does not start and prints one plain sentence.

**Why the gate cannot be inside the migration**: `migrate(db, { migrationsFolder: "drizzle" })` runs
at module load inside `createDb()` (`db/client.ts:30`), and `hooks.server.ts:28` calls
`ensureLedgerUpgrade` only afterwards, in `init()`. A `DROP TABLE` in a migration would therefore
destroy the legacy rows **before the conversion that reads them could ever run**, on an installation
that skipped the previous release. That is the exact failure FR-037a forbids, and 002's own Complexity
Tracking recorded the same ordering as the reason it deferred these drops.

**The guard** — `src/lib/server/db/legacy-drop-guard.ts`, pure, test-first:

```ts
legacyDropAllowed(state: {
  legacyTablesPresent: boolean;   // does `expenses` exist in sqlite_master?
  legacyRowCount: number;         // rows across expenses + incomes + claims
  upgradePhase: string | null;    // settings.ledger_upgrade_state → phase, or null
}): Allowed
```

Three answers, and only the third is a refusal:

1. Tables absent — a fresh installation, or one already cleaned. **Allow.**
2. Tables present, zero rows — nothing to lose. **Allow.**
3. Tables present with rows, and `upgradePhase !== "done"` — **Refuse**, with:
   *"This release removes the old expense, income and claim tables, and this installation still has
   records in them that have not been converted. Install version <previous> first, let it start once
   so it can convert them, then install this version. Your database has not been changed."*
4. Tables present with rows, and `upgradePhase === "done"` — converted; the rows are the old copies.
   **Allow.**

Reading `sqlite_master` and one `settings` row with raw SQL before Drizzle is available is a **read**,
so the constitution's "never a hand-applied schema mutation" rule is untouched — every schema change
still goes through the generated migration.

**Drop order** (FK-safe; Drizzle wraps each migration in a transaction, so `PRAGMA foreign_keys=OFF`
is a no-op and order is load-bearing):

1. `expense_search_text`, `income_search_text`, `expense_attachments`, `income_attachments`,
   `claim_attachments` — leaves, nothing references them.
2. Rebuild `invoices` without `result_income_id` — a **live** table losing its FK into `incomes`.
3. `expenses` (FK into `claims`), then `incomes`, then `claims`.
4. `categories` — no incoming FK, independent.
5. Rebuild `reconciliation_allocations` without `item_type` / `item_id` (FR-037b) — a **live** table;
   verified zero readers remain anywhere in `src/`.

**What this gives up**: a refusal that stops the server is the harshest failure this app has. It is
chosen over any softer option because the softer options all mean starting with the data already
gone. Two live tables are rebuilt to drop a dead column, which is the riskiest step in the release and
the reason FR-038's backup warning leads the release notes.

---

## R-06 — The conversion code retires with the tables it reads

**Decision**: `src/lib/server/ledger/upgrade/**` and `ensureLedgerUpgrade` are removed in this
release. The pre-migration guard (R-05) is what tells an un-upgraded installation what to run first.

**Why it must go**: every file in that directory reads `expenses`, `incomes`, `claims` or
`categories`. Once those tables are dropped from `schema.ts`, the module cannot compile. Keeping it
would mean keeping the tables, which is the feature.

**What has to be rescued first**: `seedAccounts()` (`upgrade/accounts.ts`) does two jobs, and only one
of them is conversion. On a **fresh** installation it seeds the default expense and income categories
and guarantees the "Sales" income account the invoice flow defaults to. That job is not going away, so
it moves to `src/lib/server/db/seed-accounts.ts`, stripped of every legacy read, and is called from
the normal seed path beside `ensureGroupSeed()`.

**What stays**: `ledger_records.legacy_kind` and `legacy_id`. FR-037 does not list them, and they are
the only surviving record of which old row a converted record came from. The **lookup** that read them
to resolve a pre-conversion URL goes (FR-025a) — `legacyDestination` in `loaders/ledger.ts:93–123` and
`findByLegacy` in `queries/ledger.ts:529–545` — but the columns and their unique index remain as
provenance.

**What this gives up**: an installation two releases behind must install the previous release and
start it once. There is no longer any path that converts and cleans in one step, and there is no
in-app way back. That is D-03's decision, stated here as its mechanical consequence.

---

## R-07 — One endpoint answers "everything that touched this account"

**Decision**: `GET /api/records/statement`, gated on `records.view`. Both existing answers retire:
`/api/reports/account-history` (gated `reports.view`) and `/api/accounts/[id]/movements` (gated
`accounts.view`).

**Why**: this is D-05 one level down. There are currently **three** ways to ask one question — two
endpoints and the Records account filter — and the same duplication the feature removes from the
screens exists in the API beneath them. The query (`accountHistory()`), the shape
(`AccountHistoryReport`), the running balance, the opening and closing figures, the truncation note and
the CSV writer all already exist and are all reused unchanged. What changes is the address and the
ability.

**A defect this closes**: `/accounts/[id]/history` gates its page shell on `accounts.view` but fetches
from an endpoint gated on `reports.view`. A user with accounts access and no reports access gets a page
that loads and then shows a permission error. FR-046's move to the records ability is not only a
relocation — it makes one screen answer to one ability.

**The screen**: the statement view is the Records list at `/records?account=<id>`, per FR-040. A query
string is a shareable address, and it makes FR-043's rule expressible in the URL itself: the running
balance, opening and closing figures appear only when `account` and an optional date range are the
**only** parameters present. Any other filter, or any sort other than date, hides them and the screen
says why (edge case: "a running balance that would lie").

**What this gives up**: the wide full page. The statement now sits under the Records screen's filter
chrome, so a table meant to be read across has less room — D-05 accepted this, and FR-044's export is
what covers the case where the width genuinely matters.

---

## R-08 — "Cleared" gets its own field, kept separate from "reconciled"

**Decision**: `RecordView` keeps `reconciled` (does **any** bank line point at this record) and gains
`cleared` plus `clearedMinor` (is the record **fully** covered by bank lines). The coverage arithmetic
is pure and test-first.

**Why both**: the codebase already has two definitions and they disagree.

- `matchedMovements()` (`queries/ledger.ts:265–275`) is an existence check — one allocation row makes a
  movement reconciled, whatever the amount.
- The reconciliation workspace uses `remainingAmount >= EPSILON` — a partly matched movement still
  needs clearing, which is why its "Needs Review" filter shows it.

FR-056's "not yet cleared" filter must not disagree with the workspace it replaces, or a user moves
between two screens and gets two answers — the thing this ledger was built to make impossible. But
existence is the right rule for **locking**: if any bank line points at a record, its amount may not
change, whether or not the line covers it. So the two questions are genuinely different and each keeps
its own field, named for what it answers.

`locked` keeps reading `reconciled`. The Records filter and the row label read `cleared`.
`RecordView`'s existing comment already explains why `reconciled` is separate from `locked`; it is
extended to explain the third field rather than replaced.

**What this gives up**: three near-neighbour fields on one type, which is one more thing to hold in
mind than a single boolean. The alternative — one field — means either a lock that lets a matched
record be edited, or a worklist that hides work.

---

## R-09 — Reconciling lives under the account, and the matching surface gets a real address

**Decision**: two routes, both under the account that owns the statement:

- `/accounts/[id]/reconcile` — that account's statements, and the upload. Full page.
- `/accounts/[id]/reconcile/[statementId]` — the matching workspace. Full page, full width, its own
  shareable address (FR-052).

The top-level `/reconciliation` route and its nav item are removed. The account drawer gains a
relation card, "Check against the bank", following the single-record-reference shape and carrying
whether anything is part-way through (FR-053).

**Why under the account rather than keeping the `/reconciliation` namespace**: a statement belongs to
exactly one account and only that account's movements are ever candidates for its lines — a rule
enforced twice already, in `workspace()` and again client-side in `compatibleLines`. Putting the
address under the account makes the account picker unnecessary rather than merely hidden, which is
what FR-050 asks for. It also makes `CLAUDE.md`'s task-workspace exception true again, at a real path,
after commit `e5568b1f` left it pointing at nothing.

**How the 2,852-line component is divided**: by the three surfaces, not by size. `ReconciliationPage`
is replaced by `AccountStatements.svelte` (list, upload, retry, move-to-another-account) and
`StatementMatch.svelte` (lines, candidates, the allocation composer, auto-match). The upload account
picker is deleted outright — the route supplies the account. The "Akaun Records" tab and its
"Needs Review" filter are deleted; that question is now FR-056's filter on Records.

**What this gives up**: exactly what D-06 said it would. The cross-account worklist stops being a
place you land on. And splitting a 2,852-line component is the largest and least mechanical piece of
work in the feature — nothing about it is a rename.

---

## R-10 — A statement can no longer belong to no account

**Decision**: `bank_statements.account_id` becomes **NOT NULL**. The migration assigns the seeded
default money-holding account to any row still null, exactly as the earlier conversion's
`backfillReconciliation` did.

**Why**: FR-055 requires an accountless statement to be findable and assignable. With reconciling
reached from an account (R-09), such a statement belongs to no route and would be genuinely
unreachable. There are two ways to honour the requirement: build a surface for the case, or remove the
case. The column is nullable only because the earlier conversion ran before accounts were seeded and a
NOT NULL column would have broken its own foreign key — a reason that expired when that conversion
finished.

**What this gives up**: a statement that was silently filed against the default account by the earlier
conversion is now filed against the default account permanently unless someone moves it. FR-054's
move-to-another-account action (`PATCH /api/reconciliation/statements/[statementId]`, which already
exists) is what covers that, and R-09 keeps it reachable from the account the statement is currently
filed against.

---

## R-11 — One stream, and it is a new endpoint

**Decision**: `GET /api/records/stream`, gated `records.view`, forwarding `record-update` unfiltered,
plus `record-deleted` and `settlement-changed`. The three per-kind streams retire.

**Correction to the spec**: FR-005 reads as though three connections become one. There is **no**
`/api/records/stream` today — the three existing streams are `/api/expenses/stream`,
`/api/income/stream` and `/api/journal/stream`, each filtering the one `ledgerEvents` emitter by kind.
So this is one new endpoint and three deletions, not a consolidation of existing code.

**No snapshot on connect**, per `CLAUDE.md`: Records is a paginated list, so SSR gives the first state
and the stream gives only changes. The journal stream's deliberate omission of `settlement-changed`
disappears with it — the merged screen shows records that do have derived paid state, so it needs that
event.

**One thing to close while here**: `GET /api/records` with no `kind` currently checks
`["expenses", "income"]` and **never checks `journal`** (`api/records/+server.ts:106`). Today that is
reachable only by an explicit API call; after this feature it is the default path for the one list, so
a hand-written record would be visible to anyone with expense view. The single `records` resource
closes it by construction, and FR-031d is what makes that correct rather than a widening: reading is
gated on records view, and only *writing* with free choice needs `adjustments`.

---

## R-12 — The flat account list replaces grouping with a filter, and gains the search it never had

**Decision**: `ROLE_GROUPS` (`components/accounts/account-roles.ts:46–81`) is deleted. The list keeps
its existing stable order — `role ASC, rank ASC`, already the query's order — and gains a name search
box and a "sort of account" filter whose values are the six labels the section headers used, now as
filter options.

**Correction to the spec**: US3 and FR-017 read as though search is being kept or adjusted. The
Accounts screen has **no search box at all** today — only a "Show archived" toggle. FR-017 is new
work, and SC-008 ("finding a named account among a hundred takes one search") depends entirely on it.

**Why reuse the six labels as filter values**: they are already written in plain words and already
tested against the roles. Grouping presented a sort as structure; the same words as a filter present it
as what it is.

**What this gives up**: someone who navigated by scanning to a familiar heading now types instead. That
is the trade the spec asked for, and the archived toggle stays (edge case: archived accounts must
remain findable).

---

## R-13 — Two live readers of the legacy tables are repointed, test-first

**Decision**: both defects found in the survey are fixed in this feature, each with a test that fails
before the fix, per Principle V's "every bug fix, without exception".

**`api/files/[...path]/+server.ts`** gains a `record_attachments` ownership check, and loses the three
legacy attachment checks when their tables are dropped. Until then it checks all four, so the fix
lands before the drop and neither depends on the other. The test asserts that a file named in
`record_attachments` is served and that a file named nowhere is still refused — the path-traversal
guard and the `bank_statements` permission check on line 58 must keep working unchanged.

**`import/duplicate-detector.ts`** is repointed at `ledger_records` and `ledger_movements`. Its
comparison logic — amount, date, reference, content and filename similarity — is unchanged; only the
rows it reads over change. The test seeds a ledger record and asserts the detector finds it, which
fails today for every record created since the conversion.

**Why in this feature and not deferred**: the drop makes the first a permission failure on real
receipts and the second a compile error. Neither can be left, and both are the kind of wrongness that
does not announce itself.

---

## R-14 — What is developed test-first, and what is not

Principle V scopes TDD by risk, not coverage. No coverage target is introduced.

**Test-first (pure, over plain rows, no database):**

| Module | Why it can be wrong silently |
|---|---|
| `ledger/sides-from-accounts.ts` | A wrong kind still balances and still totals. It only files the record on the wrong report. |
| `permissions/merge-records.ts` | A wrong OR-merge revokes access nobody notices until someone complains, and SC-006 measures it. |
| `ledger/coverage.ts` (R-08's `cleared` / `clearedMinor`) | Money arithmetic. A partly matched record reading as cleared hides real work. |
| `db/legacy-drop-guard.ts` | Wrong once, and an installation's records are gone. |

**Test-first because they are bug fixes** (R-13): the `/api/files` ownership check and the Auto Import
duplicate detector. A failing test before each fix.

**Not tested, by design**: `RecordsPage.svelte`, the merged drawer, the two reconciliation components,
route wiring, the nav change, the accounts search box and filter, and every re-pointed link. These are
Svelte components and layout, verified by `bun run check`, `bun run lint` and the user's own visual
confirmation. Forcing tests here is what Principle V explicitly forbids.

**Where the existing suite stands**: no spec file anywhere references the `/expenses`, `/income` or
`/journal` routes, their loaders or their endpoints, and there is no end-to-end suite. So the URL
removal breaks no test — which also means nothing currently protects it. The four pure modules above
are where the new coverage goes.

---

## Consolidated risk

| Risk | Where | How it is held |
|---|---|---|
| Legacy rows destroyed on an un-upgraded installation | R-05 | Pure guard in front of `migrate()`; refuses to start and changes nothing |
| A live table rebuilt to drop a dead column | R-05 steps 2 and 5 | Both verified to have zero readers; FR-038a's whole-books check runs after |
| Someone silently loses access | R-04 | Pure OR-merge, test-first, over **both** permission tables; SC-006 verifies account by account |
| A record files itself as the wrong kind | R-02 | Pure derivation, test-first, and the integrity sweep still proves every record balances |
| Receipts unreachable | R-13 | Fixed before the drop, with a failing test first |
| A running balance that does not add up | R-07 | Shown only when the URL carries account plus optional dates and nothing else |
| The 2,852-line split loses a behaviour | R-09 | Divided by surface, not by size; nothing about reconciling's behaviour changes (FR-034) |

All fourteen decisions are settled. No `NEEDS CLARIFICATION` remains.
