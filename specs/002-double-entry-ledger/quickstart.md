# Quickstart & Validation Guide: Double-Entry Ledger

**Feature**: `specs/002-double-entry-ledger` | **Date**: 2026-08-15

How to run this feature and prove it works. Scenario numbers map to the Success Criteria in
[spec.md](./spec.md). Shapes referenced here are defined in [data-model.md](./data-model.md) and
[contracts/api.md](./contracts/api.md) and are not repeated.

## Prerequisites

- Bun installed, dependencies installed (`bun install`).
- **A copy of a real database with data in it.** Most of what this feature promises is about not
  disturbing existing records, and an empty database cannot show that. Copy `data/akaun.db` (and
  `data/storage/`) to a scratch directory and point `DATABASE_PATH` / `STORAGE_PATH` at the copy.
- At least one superuser (`bun run admin:create`).
- No LLM provider is needed for any scenario here.

**Never run the upgrade against the only copy of real data.** The upgrade takes its own backup
(D-15), but the point of scenario 1 is to compare before against after, which needs a before.

## Gates — run these first

```bash
bun run check      # svelte-check
bun run lint       # prettier + eslint
bun run test       # vitest, both projects
```

All three must pass before the feature is done (constitution, Development Workflow). Run `bun run
check` with no dev-server browser tab open, or restart the dev server afterwards — see the note in
`CLAUDE.md`.

## Unit suite

The rule modules are developed test-first (research.md D-22). Run just them while iterating:

```bash
bun run test:unit -- --project server src/lib/server/ledger
```

| Spec file | Must pin |
|---|---|
| `money.spec.ts` | Conversion to cents at the record's own stored rate; one payment split three ways still sums to the original to the cent; a rate of 1 converts exactly (FR-005, rounding edge case) |
| `entry-builder.spec.ts` | Every kind's movements sum to zero; a record with one side is refused; a record touching a shared owed account with no contact is refused; a transfer to the same account is refused (FR-001, FR-002, FR-007, FR-008) |
| `settlement-rules.spec.ts` | Three expenses from one person total correctly; a full payment leaves zero outstanding; a partial payment leaves the right remainder and only the covered items read paid; allocating more than is outstanding is refused with the available figure; two payments settle one item; undoing restores both sides (FR-015 – FR-018, SC-006) |
| `locking.spec.ts` | Amount, date and account refused while settled or reconciled; description, contact, reference, remark and attachments still allowed; the refusal names which action unlocks (FR-017a, SC-012) |
| `integrity.spec.ts` | An unbalanced record is reported with its difference; a balanced set reports clean; the whole-books sum (FR-003) |
| `reports/profit-loss.spec.ts` | Lines grouped by category account; a transfer appears nowhere; a withdrawal dated in the next month leaves the income in the earlier one (US2 AC3, FR-025) |
| `reports/balance-sheet.spec.ts` | Owned equals owed plus owners' stake; earlier periods' accumulated result carries forward; the result equals the profit and loss for the same period; the same inputs run twice give the same answer (FR-026, SC-007) |
| `reports/partner-statement.spec.ts` | One block per Partner-role contact, with contributions, share of the result and drawings (FR-027) |
| `upgrade/payer.spec.ts` | A creator whose email matches a contact resolves to it; one whose name matches resolves to it; the seeded administrator resolves through the installation's one real user; two real users make it create a contact instead; a user with no name is named from its username, then from its email's local part; an unpaid unclaimed expense naming a contact stays owed, and one naming nobody falls back to the bank and is reported (FR-036b, FR-036c) |
| `upgrade/verify.spec.ts` | Totals, record counts, reference numbers and attachment hashes compared before and after; a deliberately corrupted "after" is reported, not passed (SC-001, SC-013, SC-014) |
| `upgrade/convert.spec.ts` | Against a **real temporary SQLite database** seeded with legacy rows: a done claim produces a payment plus settlements; a pending claim leaves the amounts outstanding; running the conversion twice changes nothing the second time (FR-035 – FR-037) |
| `reconciliation/matching.spec.ts` | Updated: candidates are movements on the statement's account; a movement on another account is never offered (SC-005) |

Per Principle V, any bug found later ships with a test here that fails before the fix.

## Run the app

```bash
DATABASE_PATH=/path/to/scratch/akaun.db STORAGE_PATH=/path/to/scratch/storage bun run dev
```

The upgrade runs at startup, before the first request is served. Watch the log for its phases and its
final report.

---

## Scenario 1 — Nothing you already have is disturbed (SC-001, SC-008, SC-013, SC-014)

**Before starting the app**, capture the baseline from the copy:

```bash
sqlite3 scratch/akaun.db \
  "select 'expenses', count(*), round(sum(amount*exchange_rate),2) from expenses;
   select 'incomes',  count(*), round(sum(amount*exchange_rate),2) from incomes;
   select category, count(*), round(sum(amount*exchange_rate),2) from expenses group by 1 order by 1;
   select 'refs', group_concat(expense_number) from (select expense_number from expenses order by 1);
   select 'attachments', (select count(*) from expense_attachments)
                       + (select count(*) from income_attachments)
                       + (select count(*) from claim_attachments);" > before.txt
```

Start the app, let the upgrade finish, then compare:

- Category totals, record counts and headline totals must match `before.txt` **to the cent**. The
  upgrade's own report states this too; the manual check is what proves the report honest.
- `select count(*) from ledger_records where legacy_kind='expense'` equals the old expense count.
- Every reference number in `before.txt` appears in `ledger_records.record_number`, character for
  character, and typing any of them into the app's search finds its record (SC-013).
- `find scratch/storage/records -type f | wc -l` equals the old attachment count, and every file
  opens from its record's detail sheet (SC-014).
- Open an expense that was on a completed claim: it reads **paid** and shows the payment that paid it
  (US1 AC2). Open one from a claim that was never completed: it reads **owed** to the person who paid
  (US1 AC3).
- Every existing bank match survives, with the same amount, pointing at the same thing (US1 AC4).
- **Restart the app.** The upgrade does nothing further, nothing is duplicated, no command was ever
  required (US1 AC5, AC6, SC-008).
- Visit an old link — `/expenses/<an old id>` opens the same record directly; `/income/<an old id>`
  redirects to that record's new URL (D-14).

**Interruption test (SC-014)**: restore the scratch copy, start the app, and kill the process while
the log shows the attachment phase. Restart. The run resumes, no file is lost, none is duplicated,
and the final counts still match.

## Scenario 2 — Shopee income matches the bank deposits (SC-003, SC-004, SC-011)

1. Create a **Shopee wallet** account (Accounts → Add, role Wallet).
2. Record the monthly statement as income against the Shopee wallet, at the full amount before
   commission, dated in the month it was earned.
3. Record the commission as an expense against the Shopee wallet.
4. Record three withdrawals from the Shopee wallet to the bank, on different dates, one falling in
   the next month.

Confirm: the Shopee balance returns to where it started; the profit and loss for the earlier month
shows the full income and the commission, and shows neither withdrawal as income or expense; the
later month shows only cash movement; the Shopee balance equals what Shopee itself shows. That is
**one statement record, one commission record, and one action per withdrawal** (SC-011).

## Scenario 3 — Pay off what's owed, fully or partly (SC-006)

Record three expenses paid personally by one person, then a payment covering less than the total.
Confirm the covered items read paid, the uncovered one still reads owed, and that person's
outstanding balance equals the difference exactly. Then try to allocate more than is outstanding — it
must be refused with a sentence naming the figure still available.

## Scenario 4 — Reconcile against the right account (SC-005)

Upload a statement for the bank account. Confirm that nothing sitting at Shopee, and nothing a partner
paid personally, is ever offered as a match — only the withdrawals and the reimbursement payment that
actually left the bank. Then take an unmatched deposit and turn it into a transfer from another
account in one action; it is created with the line's date and amount and matched immediately.

## Scenario 5 — The reports (SC-007)

Produce a profit and loss for one month, then a balance sheet at that month's end. The balance sheet
must balance, and its result for the period must equal the profit and loss. Export both to CSV.
Produce a partner statement and confirm each partner's contributions, share and drawings appear.
Produce a report covering a period before the upgrade and confirm it states that invoices issued
before then carry no history, rather than implying complete history (FR-030).

## Scenario 6 — The books check (SC-002)

Settings → **Check the books**. It must report clean, and finish in under a minute. Then, in a scratch
copy only, hand-edit one movement's `amount_minor` in SQLite and run it again — it must name that
record and its difference.

## Scenario 7 — Locked records (SC-012)

Open a record that is settled, and one that is reconciled. Changing the amount, the date or the
account is refused, and the refusal says what to undo first. Description, contact, reference, notes
and attachments still save.

## Scenario 8 — No jargon, no extra steps (SC-009, SC-010)

Walk the expense, income, payment and import screens. No accounting term appears on any of them. With
a single account configured, recording a routine expense takes exactly the steps it takes today —
the account defaults and is never asked for. With two accounts, it takes exactly one more.

Check the same screens at a mobile viewport width (FR-043).

## Scenario 9 — Access (FR-039, FR-040)

Sign in as a user with `reports` view but no `expenses` add. Reports open; nothing can be recorded.
Confirm the direct-entry journal screen is unreachable until an administrator grants the `journal`
permission, which no seeded group has.
