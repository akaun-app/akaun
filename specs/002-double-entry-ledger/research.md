# Phase 0 Research: Double-Entry Ledger

**Feature**: `specs/002-double-entry-ledger` | **Date**: 2026-08-15 | **Spec**: [spec.md](./spec.md)

Every decision below was open when planning started. Each states what was chosen, why, and what was
given up. Plain-language names are used throughout, per constitution Principle VII; the code
identifiers they map to are named where it matters.

Facts gathered from the existing codebase that these decisions rest on:

| Fact | Source |
|---|---|
| `expenses`, `incomes`, `claims` are three separate one-sided tables; `expenses.category` is free TEXT, not a foreign key | `src/lib/server/db/schema.ts` |
| Amounts are `REAL`, with `currency` + `exchange_rate` locked on the row at creation | same |
| Attachments live in three tables and three folder trees (`expenses/`, `income/`, `claims/`, each `YYYY/MM`) | `schema.ts`, `file-storage.ts` `moveToFinal()` |
| Reconciliation points at records polymorphically, `(item_type, item_id)`, with no account anywhere | `reconciliation_allocations`, `queries/reconciliation.ts` |
| Startup already runs code-based data setup after the Drizzle migrations | `hooks.server.ts` `init()` → `ensureDefault*()` in `db/client.ts` |
| Numbers come from a shared template; the counter bucket key includes the per-type prefix | `running-number.ts`, `$lib/sequence-template.ts` |
| In the maintainer's own database: 192 expenses, all marked Paid, 191 of them on one of 34 claims; 7 incomes; 2 users have ever created a claim | `sqlite3 data/akaun.db` (counts only) |

---

## D-01 — One store for records, replacing the three we have

**Decision**: Two new tables, `ledger_records` (one row per thing that happened) and
`ledger_movements` (one row per side of it), become the only place financial records live.
`expenses`, `incomes` and `claims` stop being read or written.

**Why**: FR-004 requires all records in one place so the "both sides cancel out" check (FR-003) is a
single sweep, and FR-031 requires every screen's totals to come from the same rows the reports come
from. Three stores plus a ledger would mean every report is a permanent stitching job and every
figure has two possible sources.

**What this costs**: the widest change in the codebase. `queries/expenses.ts`,
`queries/income.ts`, `queries/claims.ts`, both loaders, both page components (~3,700 lines between
them), the import pipeline, the dashboard and reconciliation all repoint. The Expenses and Income
*screens* survive unchanged in purpose — they become filtered views of the one store, not owners of
their own table.

**Rejected**: keeping `expenses`/`incomes` as document tables with movements attached alongside.
It reads as less disruptive but leaves the amount stored twice (on the document and on its
movements), which is exactly the "two fields that can disagree" failure the spec rules out in four
separate places.

---

## D-02 — Movements are whole cents, stored as integers

**Decision**: `ledger_movements.amount_minor` is an `INTEGER` count of the smallest unit of the main
currency (cents). The record keeps `amount` (`REAL`, in the currency it was entered in) and
`exchange_rate` exactly as today, for display and for audit.

**Why**: FR-002 says the two sides must cancel out *exactly* and the spec's rounding edge case says
"agree exactly, to the cent". Floating-point sums cannot promise that — the existing code already
concedes this, comparing money with an `EPSILON` of 0.005 (`reconciliation/types.ts`). With whole
cents, "this record balances" is integer equality with zero, and the whole-books check (FR-003) is
one `SUM() = 0`.

**What this costs, stated honestly**: converting a record to cents is
`Math.round(amount × exchange_rate × 100)`. For any record whose exchange rate is 1 — every record
in the maintainer's database — this is exact and SC-001's "difference of zero" holds literally. For
a foreign-currency record, today's total is a float product summed as floats, and the new total is
that product rounded to the cent per record and then summed. Those can differ by less than a cent
per record. Because every screen already displays money to two decimal places (and reconciliation
already rounds with `round2` before comparing), the *displayed* figures are unchanged; the raw float
sum is not something any screen shows. The upgrade's verification (D-15) compares totals at cent
precision and lists any record whose two computations differ, so the difference is reported rather
than discovered later.

**Rejected**: keeping `REAL` and checking balance within a tolerance. It makes FR-002 a matter of
degree, and a ledger whose fundamental invariant is approximate is not worth migrating to.

---

## D-03 — One signed amount per movement, not separate debit and credit columns

**Decision**: a movement carries one signed `amount_minor`. Positive puts value **into** the account,
negative takes it **out**. A record's movements sum to zero. An account's balance is the sum of its
movements.

**Why**: two columns with a "exactly one is non-zero" rule is a constraint the database cannot
express and application code has to keep remembering. One signed number makes both invariants
(`SUM(per record) = 0`, `balance = SUM`) plain SQL. Accounting's debit/credit vocabulary is a
presentation concern and is reintroduced only on the reports and the direct-entry screen, where
Principle VII allows the formal term.

**Consequence to keep in mind**: money the business owes, owner capital, and income sit at a
*negative* balance in this convention (value has left, or was contributed from, those pots). Reports
flip the sign for display; the rule lives in one pure function, not scattered through queries.

---

## D-04 — What kind of record it is, is stored

**Decision**: `ledger_records.kind` stores one of expense, income, transfer, payment, opening
balance, invoice issue, journal.

**This is not the same thing as an account's role (D-05), and neither can be derived from the other.**
A role belongs to a *pot* and is set once, when the account is created; the account then outlives
thousands of records. A kind belongs to one *event* on one date. "Shopee wallet" has a role forever;
each of the forty records that touch it has its own kind.

**The real question is whether `kind` duplicates the pattern of accounts a record's movements touch**,
because the two do correlate — a record touching an expense-category account looks like an expense, one
touching two asset accounts looks like a transfer. For most records that inference works. It breaks in
three places, and each is a case the product has to get right:

1. **Intent the movements genuinely do not carry.** Buying equipment is value into one asset account
   and out of another — the same movement shape as a transfer between two of your own accounts
   (FR-006b, FR-007). The user recorded it from the expense screen and means something different by
   it. Nothing in the movements says so.
2. **Direct entry has to stay distinguishable.** A journal entry putting a figure into an expense
   category and taking it out of the bank is byte-identical to an ordinary expense. Direct entry is
   separately permitted and off by default (FR-040), so a record made that way cannot be
   indistinguishable from one made through the everyday screens.
3. **Which counter issued the number.** A record carries `EX20260815-004` or `CL20260815-012`, and
   FR-032e requires those counters to keep running with no number reused or skipped. Which counter a
   number came from cannot be recomputed — the number template is user-editable and need not contain
   a prefix at all (`$lib/sequence-template.ts`).

There is a cost argument as well, though it is the least of the four: `WHERE kind = 1` against an
index, versus an `EXISTS` subquery joining movements to accounts, on every page of the Expenses list.

**What stays derived**: paid and unpaid, how much is outstanding, every account balance, every total,
every report line. `kind` records what the user did; it never records what the numbers say (FR-012,
FR-031).

**Rejected**: classifying each record from its movements on every read. It cannot answer any of the
three cases above, and the first two would be silently wrong rather than visibly broken.

---

## D-05 — An account stores its role; its accounting type is looked up

**Decision**: `accounts.role` stores one of: bank, wallet, cash, card, equipment, money-owed-to-us,
money-we-owe, opening balances, partner capital, partner drawings, expense category, income category.
Whether an account is something owned, something owed, owner's stake, earning or spending is a fixed
lookup from the role, in one pure map — not a second stored column.

**Why**: role is what the product needs (which picker an account appears in, whether a statement can
be reconciled against it, whether it is called a "category" on screen). Type is what the reports
need. One is fully determined by the other, so storing both invites the drift FR-006a explicitly
forbids.

**Deferred, with the seam left open**: user-defined liability or equity accounts (a loan, for
instance) have no named need in the spec. Adding one later is a new role plus one entry in the map.

---

## D-06 — A category *is* an account; the `categories` table goes

**Decision**: every row in `categories` becomes an account with the matching role (expense category /
income category), keeping its name and its `rank` for ordering. `expenses.category` /
`incomes.category` (free text) resolve to that account. The `categories` table stops being read.

**Why**: FR-006a states it directly, and matches Xero and QuickBooks. Two concepts with a mapping
between them is one more thing to maintain wrongly.

**Detail that matters**: `category` is free text today with no foreign key, so a record can carry a
category string that no `categories` row has. The upgrade creates an account for every distinct
category string actually found in the data, not just for the rows in `categories`. A record with an
empty or missing category goes to a seeded **Uncategorised** expense account and is flagged, per the
spec's edge case — never rejected, never silently dropped.

---

## D-07 — The contact lives on the record; two shared accounts hold what's owed

**Decision**: one **Money owed to us** account and one **Money we owe** account, both system
accounts. `ledger_records.contact_id` is the single place a contact is stored; a record touching
either shared account must have one, enforced in the service layer and checked by the integrity
sweep. A contact's outstanding balance is a filter over movements joined to their record.

**Why**: FR-008 and the clarification behind it. A contact per account would make the category
picker grow with the customer list (FR-008a); a separate debts table would be a copy that disagrees
with the ledger the first time a record is edited.

**Consequence the user has already accepted**: one record covers one contact. A single bank payment
to two suppliers is two records.

---

## D-08 — Partner is a contact role, and creates two accounts

**Decision**: `Role.Partner = 4` joins the existing contact roles. Giving a contact that role creates
their capital account and drawings account, each with `accounts.contact_id` pointing at them.
Removing the role archives those accounts if they hold movements, and deletes them only if they are
empty.

**Why**: FR-008b. Partners are few, permanent, and must appear by name on a balance sheet, so they
need their own pots; customers and suppliers are many and changing, so they don't. This is the one
place a contact change touches accounts, and the spec names it as the single exception.

---

## D-09 — A settlement links one movement to another

**Decision**: `settlements(payment_movement_id, owed_movement_id, amount_minor)`, unique on the pair.
Both sides are movements on a shared owed account.

**Why**: the amount that can be allocated is the amount of the owed movement, so pointing at the
movement is what makes the over-allocation refusal (FR-016) a local check rather than a re-derivation
from the whole record. It mirrors the shape `reconciliation_allocations` already uses for the same
many-to-many reason (FR-018).

**A settlement changes no balance.** It is a note about two movements that already exist.

---

## D-10 — Paid, outstanding and "how much is left" are always computed

**Decision**: no stored status for payment state. An expense is *owed* if it has a movement on the
Money-we-owe account; it is *paid* when settlements against that movement cover it. An expense paid
straight from an account has no owed movement and reads paid immediately. `invoices.amount_paid` is
dropped and derived the same way; `invoices.status` keeps only the document lifecycle (draft, sent,
cancelled) and "paid" is computed.

**Why**: FR-012 requires it, and `ExpenseStatus.Pending` disappears with claims. Keeping a stored
mirror is the exact contradiction the spec was written to remove.

**What this costs**: the Expenses list needs an aggregate over settlements to render its status
column. It is one grouped join on an indexed column, computed alongside the existing reconciliation
coverage subquery the list already carries.

---

## D-11 — Reconciliation matches a movement, and a statement belongs to an account

**Decision**: `bank_statements` gains `account_id`. `reconciliation_allocations` replaces
`(item_type, item_id)` with `movement_id` pointing at a movement **on that statement's account**.

**Why**: FR-021 and SC-005. Once money can sit in more than one place, "which records could this
bank line be" is exactly "which movements touched this account" — no direction guessing, no
`claim_id IS NULL` proxy for bank-facing. Money sitting at Shopee is never offered against a bank
statement because it has no bank movement, which is the original bug, fixed at the root rather than
filtered out.

**Simplification this buys**: `ReconItemType` retires. The direction filter in `matching.ts` becomes
the sign of the movement. Partial and many-to-many allocation (FR-022) keep working untouched,
because the allocation row's shape is otherwise unchanged.

**Migration**: each existing allocation is repointed to the bank movement of the record it named — an
expense's or income's own bank movement, or, for a claim, the bank movement of the payment that claim
became (D-12). Amounts are carried across unchanged, satisfying FR-034.

---

## D-12 — Claims become payments, and the payer becomes a contact

**Decision**: each claim becomes a payment record (money out of the default bank account, into the
Money-we-owe account) plus one settlement per expense it covered. Each expense that was on a claim
gets its owed side against Money-we-owe instead of the bank.

**The gap this had to close**: a claim records no contact today — only `created_by`, a *user*. But
FR-008 requires a contact on any record touching a shared owed account, and FR-036 says the amount
must still read as owed to "the person who paid it". So the upgrade resolves each claim-creating user
to a contact: match on the user's email, then on their name; if neither matches, create a contact
(individual, named from the user, with the Employee role) and use it. In the maintainer's database
this is two contacts at most.

**Confirmed 2026-08-16, with one refinement, and now stated as FR-036b.** The alternative — one
shared "Reimbursements" contact — was rejected because it loses the ability to answer "how much is
owed to Ali", which is the whole point of User Story 3.

The refinement closes a gap this decision had: a seeded administrator login is a system account, not
a person. Where it created the reimbursements, they belong to the installation's one real user, so
the email-then-name lookup is retried against that user before any contact is created — but only
when exactly one other user account exists, since two or more give no single answer. The created
contact's name falls back through the account's name, its username, then the part of its email
before the `@`, because `contacts.legal_name` is `NOT NULL` and an account's name may be null.

**Why the refinement was needed, on the maintainer's own data**: of the 34 claims, 33 were created by
`admin@localhost`, whose `users.name` is `NULL`. The original rule matched no contact by email, had
nothing to match by name, and would have created a contact with no name to carry 33 of the 34
reimbursements. With the refinement, all 34 resolve to the existing contact `TANG HAO QUAN`
(matched by name against the one real user) and **no contact is created at all**.

Every attribution is listed in the upgrade report, naming the contact and which step chose it.
Correcting a wrong one is a contact merge — the app already has one, with preview and duplicate
detection — which moves every record at once and so keeps a payment and the expenses it covers
naming the same person.

**Claim attachments** move to the payment record. Old claim URLs are deliberately not preserved
(FR-036a).

---

## D-13 — Payments continue the claim counter, prefix included

**Decision**: the sequence document type keyed `claim` (code `2`) is renamed to `payment` in
TypeScript, keeps code `2`, **and keeps the prefix `CL`**.

**Why the prefix cannot change**: the counter's bucket key is built from the rendered prefix and date
(`deriveBucketKey`). Changing `CL` to anything else would start a fresh bucket at 001 and reissue
numbers that already exist — precisely what FR-032e forbids, and those numbers appear on real bank
transfers (FR-032d). A slightly odd-looking prefix is the price of never breaking a payment trail;
the code carries a comment saying so.

Expense, income, quotation and invoice sequences are untouched, in code, format and counter.
Transfers, opening balances and journal entries get no number (the column is nullable) — nothing in
the spec asks for one.

---

## D-14 — Existing record links keep working

**Decision**: `ledger_records` carries `legacy_kind` + `legacy_id` (nullable, unique together).
Migrated **expense** records are inserted with their original expense id as their ledger id. Every
other migrated record is allocated an id above the highest old expense id. `/expenses/[id]` therefore
resolves directly, unchanged. `/income/[id]` and any other stale link falls back to a lookup on
`(legacy_kind, legacy_id)` and redirects to the record's current URL.

**Why**: Principle VI says every record is a shareable URL, and the spec treats losing claim links as
an exception worth calling out — which implies the others survive. The ordering rule makes the
fallback unambiguous forever: no future record can be given an id that some old income once had.

**These two columns pay for themselves twice**: they are also the upgrade's idempotency key. A rerun
skips any legacy row already present, which is what makes FR-037 ("safe to run more than once") and
the interrupted-upgrade edge case work without a separate bookkeeping table.

---

## D-15 — The upgrade runs itself at startup, in one blocking pass

**Decision**: a code-based upgrade in `$lib/server/ledger/upgrade/`, called from `init()` in
`hooks.server.ts` after Drizzle's schema migration, in the same place `ensureDefaultCategories()`
already runs. It is guarded by a phase marker in the existing `settings` table, and it blocks startup
until it finishes.

Order of operations:

1. Copy the SQLite file to `data/backups/pre-ledger-<timestamp>.db` (FR-038).
2. Take a "before" snapshot — totals per category, record counts, every reference number, attachment
   count and per-file hash — into a settings row.
3. Create system accounts and category accounts (FR-032a).
4. Convert expenses, incomes and claims into records, movements and settlements.
5. Copy each attachment to its new location, verify the copy, rewrite the stored path.
6. Repoint reconciliation allocations and bank statements.
7. Verify: re-take the snapshot, compare, and run the whole-books balance check.
8. Only if verification passes, delete the original attachment files.

**Why blocking**: a half-upgraded database served to a browser shows figures that are wrong in ways
nobody can see. Startup latency is the cheaper cost. Progress is logged through `pino` (no amounts,
per the constitution).

**Why not a Drizzle migration**: SQL alone cannot resolve a payer contact, hash a file, or move one.
The schema change is still a committed `drizzle-kit generate` migration — only the data conversion is
code, and it runs after.

**Why not a background worker**: constitution Principle II. Nothing new to install, nothing to
supervise, no command for a self-hosting user (FR-037, SC-008).

---

## D-16 — Attachments move by copy, verify, then remove

**Decision**: one layout, `records/{YYYY}/{MM}/{uuid_originalname}`, for every record kind. Each file
is copied to its new path, the copy is compared to the source by size and SHA-256, the database path
is rewritten, and only after the whole upgrade verifies does a final sweep delete the originals. A
file already present at its destination with a matching hash is skipped. A file missing from disk is
reported and left pointing where it was.

**Why**: FR-032b spells this out, for the reason it gives — a moved file cannot be put back by
undoing a database transaction. Date-based folders keep directory sizes bounded and match the layout
`moveToFinal()` already produces; the filename already carries a UUID, so files from the three old
trees cannot collide in the new one, and `displayName()`'s existing filename parsing keeps working.

---

## D-17 — The old tables stay in place this release

**Decision**: `expenses`, `incomes`, `claims`, their three attachment tables, their two search-text
tables and `categories` remain in `schema.ts` and in the database, unread, marked deprecated. A later
release drops them.

**Why**: FR-038 requires the previous data to stay recoverable until the check passes. If dropping
them were part of the same schema migration, Drizzle would run the drop *before* the data conversion
code ever executes — the data would be gone before anything could be verified. Ordering, not
sentiment, decides this.

**Rejected**: dropping them at the end of the upgrade run, after verification. Tempting, and it would
work, but it puts an irreversible `DROP TABLE` behind a check written in the same release it is
testing. Leaving them costs a few unused tables for one release cycle.

---

## D-18 — Reports export as CSV

**Decision**: profit and loss, balance sheet, partner statement and account history each export as
CSV. Formatting is a pure function; no new dependency.

**Why**: FR-029 asks for "a form suitable for sending to an accountant or the tax office", and every
accountant's tool imports CSV. The app already has a PDF pipeline (`pdfkit`) for quotations and
invoices; wiring reports into it is a larger job with no stated need, so it is left as a noted
extension point rather than built (Principle III).

---

## D-19 — A pre-upgrade expense that was never reimbursed and has a supplier stays owed

**Decision**: on upgrade, an expense with no claim is booked against the default bank account when it
was marked Paid. If it was marked Unpaid or Pending, had no claim, and names a contact, it is booked
against Money-we-owe with that contact instead, so it still reads as owed.

**Why**: FR-032a's rule sends everything to the default bank "except expenses someone paid
personally". Read literally, an expense flagged Unpaid would come out of the upgrade reading *paid* —
the one thing US1 promises cannot happen. This refinement keeps the promise while staying inside the
rule's intent. An expense that is unpaid and names nobody has no one to owe, so it falls back to the
bank, and is listed in the upgrade report.

**Scope check**: in the maintainer's database every one of the 192 expenses is marked Paid, so this
rule changes nothing there — the query returns zero rows for both branches. It exists for other
installations.

**Confirmed 2026-08-16 as written, and now stated as FR-036c.**

---

## D-20 — Permissions: claims retires, three resources arrive

**Decision**: `ResourceName` loses `claims` and gains `accounts` (the chart of accounts and its
balances), `reports`, and `journal` (direct accounting entry, FR-040). `journal` is granted to no
seeded group, so it is off by default. Existing `claims` rows in `group_permissions` are deleted by
the upgrade; unknown resources are already ignored by `getEffectivePermissions`, so nothing breaks
mid-upgrade.

Seeded groups: Bookkeeper gains view/add/change on accounts and view on reports; Reviewer gains view
on both; Data Entry gains neither. No group gets `journal` — an administrator grants it deliberately.

**Why the split**: FR-039 requires that seeing reports does not allow recording, which needs reports
to be its own resource. FR-040 requires direct entry to be separately permitted and off by default.

---

## D-21 — One event stream for the ledger

**Decision**: a single `ledgerEvents` emitter in `$lib/server/ledger/events.ts`, carrying the record
kind on each event, plus an `accountEvents` emitter for the chart of accounts. `expenseEvents`,
`incomeEvents` and `claimEvents` retire. The Expenses and Income stream endpoints keep their URLs and
filter by kind.

**Why**: one write to `ledger_records` can change what the Expenses page, the Income page, the
account balance and a report all show. One emitter means one emit per write; three would mean
remembering which to fire, and forgetting is silent.

---

## D-22 — What gets a test first

Constitution Principle V scopes tests by risk, not coverage. In scope, developed red-green over plain
row objects with no database:

| Module | Rules it pins |
|---|---|
| `ledger/entry-builder.ts` | Every kind's movements sum to zero; a record touching a shared owed account without a contact is refused (FR-002, FR-008) |
| `ledger/money.ts` | Conversion to cents, rounding when one payment splits several ways, foreign-currency conversion at the stored rate (FR-005, rounding edge case) |
| `ledger/settlement-rules.ts` | Outstanding and paid derivation; over-allocation refused; partial payment leaves the right remainder; undo restores both sides (FR-015 – FR-018) |
| `ledger/locking.ts` | Amount, date and account locked while settled or reconciled; description, contact, reference, notes, attachments still editable (FR-017a) |
| `ledger/integrity.ts` | An unbalanced record is reported; a balanced set reports clean; the whole-books sum (FR-003) |
| `ledger/reports/*.ts` | Balance sheet balances; its result equals the profit and loss for the same period; earlier periods carry forward; the same report run twice gives the same answer (FR-025 – FR-027, SC-007) |
| `ledger/account-type.ts` | The role → type map and the display sign for every role (D-05) |
| `ledger/reports/csv.ts` | Escaping, column order and the notes row (FR-029, FR-030) |
| `ledger/upgrade/payer.ts` | Who a pre-upgrade reimbursement is owed to: the four ordered steps, the seeded-administrator fallback, the naming chain when a user has no name, and the unpaid-unclaimed fallback (FR-036b, FR-036c) |
| `ledger/upgrade/verify.ts` | Totals, counts, reference numbers and attachment hashes compared before and after (SC-001, SC-013, SC-014) |
| `reconciliation/matching.ts` | Existing suites updated: candidates are movements on the statement's account; nothing from another account is ever offered (SC-005) |

The upgrade conversion itself is tested against a **real temporary SQLite database** seeded with
legacy rows — the constitution forbids mocking the database for this, and interruption/rerun
behaviour (FR-037) can only be shown against a real one.

Out of scope by the constitution's own carve-out: Svelte components, route wiring, drawer chrome,
schema definitions and generated migrations.

---

## Open items carried into the plan — both now closed

Two decisions above went beyond what the spec settled. Both were confirmed on 2026-08-16 and are
now stated requirements, so nothing here is left to an implementer's judgement:

1. **D-12** → **FR-036b**. Confirmed, with the seeded-administrator refinement above. On the
   maintainer's database this resolves all 34 reimbursements to the existing contact
   `TANG HAO QUAN` and creates no new contact.
2. **D-19** → **FR-036c**. Confirmed as written. Zero rows affected on the maintainer's database;
   the rule exists so that an unpaid expense on another installation cannot come out reading paid.

No open items remain.
