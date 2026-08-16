# Phase 1 Data Model: Double-Entry Ledger

**Feature**: `specs/002-double-entry-ledger` | **Date**: 2026-08-15

Six new tables and four altered ones in `src/lib/server/db/schema.ts`, plus one new role code on
`contact_roles`, which needs no schema change — delivered as one committed `drizzle-kit generate`
migration. The reasoning behind each shape is in
[research.md](./research.md); it is referenced, not repeated.

Naming note (constitution Principle VII): this document uses the everyday words the product uses —
"record", "movement", "money we owe". The code identifiers are given beside them. Renaming a correct
technical identifier to something chattier would violate Principle IV.

---

## Enums

Appended to `src/lib/enums.ts` beside the existing ones. Stored as INTEGER; codes are append-only.

```ts
// --- ledger ---
export const AccountRole = {
  Bank: 1, Wallet: 2, Cash: 3, Card: 4,        // places money sits
  Equipment: 5,                                 // things the business owns and keeps
  Receivable: 6,                                // shared "money owed to us"   (system)
  Payable: 7,                                   // shared "money we owe"        (system)
  OpeningBalances: 8,                           // where opening balances come from (system)
  PartnerCapital: 9, PartnerDrawings: 10,       // one pair per partner contact
  ExpenseCategory: 11, IncomeCategory: 12       // what everyday screens call a category
} as const;

export const AccountType = { Asset: 1, Liability: 2, Equity: 3, Income: 4, Expense: 5 } as const;

export const LedgerRecordKind = {
  Expense: 1, Income: 2, Transfer: 3, Payment: 4,
  OpeningBalance: 5, InvoiceIssue: 6, Journal: 7
} as const;
```

**`AccountRole` and `LedgerRecordKind` describe different things and do not overlap.** A role belongs
to a *pot* and is set once when the account is created, outliving thousands of records; a kind belongs
to one *event* on one date. Why the kind can't simply be read off a record's movements — equipment
bought looks exactly like money moved, and a direct journal entry looks exactly like an expense — is
research.md D-04.

`Role` gains `Partner: 4` (D-08). `ReconItemType` is retired — kept in the file with a comment so its
codes are never reused, but no longer written (D-11).

**`AccountType` is never stored.** It is looked up from the role by one pure map, so the two can
never disagree (D-05):

| Role | Type | Natural balance sign | Appears on |
|---|---|---|---|
| Bank, Wallet, Cash, Card, Equipment, Receivable | Asset | positive | Balance sheet |
| Payable | Liability | negative | Balance sheet |
| OpeningBalances, PartnerCapital, PartnerDrawings | Equity | negative (drawings usually positive) | Balance sheet |
| IncomeCategory | Income | negative | Profit and loss |
| ExpenseCategory | Expense | positive | Profit and loss |

### The sign convention, in one sentence

A movement's amount is **positive when value goes into that account and negative when it leaves**, and
a record's movements always add up to zero. So money we owe, owner capital and income sit at a
negative balance; reports flip the sign for display in one place (D-03).

---

## Table: `accounts`

A named pot with a balance. Also what everyday screens call a category (FR-006a).

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | INTEGER | PK, autoincrement | |
| `role` | INTEGER | NOT NULL | `AccountRole`. Type is derived from it (D-05) |
| `name` | TEXT | NOT NULL | Shown on every picker and report line |
| `contact_id` | INTEGER | → `contacts.id`, nullable | **Only** partner capital/drawings accounts set this (FR-008b) |
| `is_system` | INTEGER (bool) | NOT NULL, default false | System accounts can never be deleted (FR-009) |
| `rank` | TEXT | NOT NULL | Lexorank ordering, carried over from `categories.rank` |
| `archived_at` | TEXT | nullable | Non-null = hidden from pickers for new records, history untouched |
| `created_by` / `updated_by` | INTEGER | → `users.id` | |
| `created_at` / `updated_at` | TEXT | NOT NULL, default `datetime('now')` | |

**Indexes**

- `accounts_role_rank_idx` on `(role, rank)` — every picker query is "accounts of this role, in
  order".
- `accounts_contact_idx` on `(contact_id)` — the partner statement's lookup.
- Unique `accounts_role_name_idx` on `(role, name)` — replaces `categories_type_name_idx`, so an
  expense category and an income category may share a name exactly as they do today.

**Rules**

- An account with any movement against it cannot be deleted, only archived (FR-009). An account with
  no movements and `is_system = false` can be deleted outright.
- Deleting is blocked in the service layer, and the button stays visible and disabled with a tooltip
  saying why (the pattern FR-009a states for contacts, applied here too).

### Seeded system accounts

Created by the upgrade before anything is moved (FR-032a), each with `is_system = true` and a zero
opening balance so existing records alone still produce today's totals (FR-010):

| Name | Role |
|---|---|
| Bank Account | Bank |
| Money owed to us | Receivable |
| Money we owe | Payable |
| Opening balances | OpeningBalances |
| Uncategorised | ExpenseCategory |

"Bank Account" is the **default account** — the one FR-011 pre-selects, recorded in `settings` under
`ledger_default_account_id` so a user with several accounts can change which one defaults.

---

## Table: `ledger_records`

One thing that happened, on one date, with its human context.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | INTEGER | PK, autoincrement | Migrated expenses keep their original id (D-14) |
| `kind` | INTEGER | NOT NULL | `LedgerRecordKind` (D-04) |
| `date` | TEXT | NOT NULL | `YYYY-MM-DD` |
| `record_number` | TEXT | nullable, unique | From the existing sequences; null for transfers, opening balances and journal entries (D-13) |
| `description` | TEXT | NOT NULL, default `''` | Today's `expenses.item_name` / `incomes.description_text` |
| `contact_id` | INTEGER | → `contacts.id`, `set null`, nullable | Required when any movement touches a shared owed account (FR-008) |
| `reference` | TEXT | NOT NULL, default `''` | |
| `remark` | TEXT | NOT NULL, default `''` | |
| `currency` | TEXT | NOT NULL, default `'USD'` | Carried across from today's rows unchanged |
| `exchange_rate` | REAL | NOT NULL, default 1 | Locked at creation, exactly as today |
| `amount` | REAL | NOT NULL | The figure as entered, in `currency`. Display and audit only — **never summed for a report** (D-02) |
| `extracted_text` | TEXT | nullable | Raw OCR/PDF text from auto-import |
| `legacy_kind` | TEXT | nullable | `'expense' \| 'income' \| 'claim'` — upgrade provenance and idempotency key (D-14) |
| `legacy_id` | INTEGER | nullable | The record's id in that old table |
| `created_by` / `updated_by` | INTEGER | → `users.id` | |
| `created_at` / `updated_at` | TEXT | NOT NULL, default `datetime('now')` | |

**Indexes**

- `ledger_records_kind_date_idx` on `(kind, date)` — every list screen.
- `ledger_records_contact_idx` on `(contact_id)`.
- Unique `ledger_records_legacy_idx` on `(legacy_kind, legacy_id)` — makes a rerun of the upgrade
  skip what it already converted (FR-037).
- Unique on `record_number` — the existing per-table uniqueness, preserved across the merged store.

**`amount` is not the source of truth for money.** It exists so the record can be shown and edited in
the currency it was entered in. Every total, balance and report reads `ledger_movements.amount_minor`.

---

## Table: `ledger_movements`

One side of a record: an amount against one account.

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | INTEGER | PK, autoincrement | |
| `record_id` | INTEGER | NOT NULL, → `ledger_records.id`, cascade | Deleting a record deletes its sides |
| `account_id` | INTEGER | NOT NULL, → `accounts.id` | No cascade — an account with movements cannot be deleted (FR-009) |
| `amount_minor` | INTEGER | NOT NULL | Whole cents of the main currency, signed (D-02, D-03) |
| `sort_order` | INTEGER | NOT NULL, default 0 | Stable display order of the sides on the journal screen |

**Indexes**

- `ledger_movements_record_idx` on `(record_id)` — the balance check and every record read.
- `ledger_movements_account_date_idx` on `(account_id, id)` — account balance and account history.

**No contact column.** The contact is on the record and is read by joining (D-07, FR-008), so the two
can never disagree.

**Invariants** — enforced in `ledger/entry-builder.ts` on every write and checkable in one sweep by
`ledger/integrity.ts` (FR-002, FR-003):

1. `SUM(amount_minor) = 0` for every `record_id`.
2. Every record has at least two movements.
3. No movement has `amount_minor = 0`.
4. A record with a movement on the Receivable or Payable account has a non-null `contact_id`.
5. `SUM(amount_minor) = 0` across the whole table.
6. For every kind except `Journal`, the record's own figure and its movements agree:
   the sum of the record's positive movements equals `Math.round(amount × exchange_rate × 100)`.
   FR-005 requires the entered amount and its rate to be kept, so the converted figure necessarily
   exists twice; this invariant is what stops the two from drifting, and `entry-builder.ts` is the
   only code that writes either. A journal entry is exempt because its many sides have no single
   entered figure.

---

## Table: `settlements`

A note that a payment paid off a particular outstanding item, for a particular amount. **Changes no
balance** (D-09).

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | INTEGER | PK, autoincrement | |
| `payment_movement_id` | INTEGER | NOT NULL, → `ledger_movements.id`, cascade | The paying side, on a shared owed account |
| `owed_movement_id` | INTEGER | NOT NULL, → `ledger_movements.id`, cascade | The outstanding side, on the same shared owed account |
| `amount_minor` | INTEGER | NOT NULL, > 0 | How much of the outstanding item this payment covers |
| `created_by` | INTEGER | → `users.id` | |
| `created_at` | TEXT | NOT NULL, default `datetime('now')` | |

**Indexes**: unique `settlements_pair_idx` on `(payment_movement_id, owed_movement_id)`;
`settlements_owed_idx` on `(owed_movement_id)` — the "how much is left" aggregate.

**Rules** (all in `ledger/settlement-rules.ts`, tested first — FR-015 – FR-018):

- Both movements must be on the **same** shared owed account and belong to the **same contact**.
- The two must face opposite ways: one is what's owed, the other is the money paying it.
- `SUM(amount_minor)` against one owed movement may never exceed that movement's own amount (FR-016)
  — the refusal explains the remaining figure rather than silently truncating.
- One payment may settle many items and one item may be settled by many payments (FR-018).
- Undoing a settlement deletes the row; both movements return to fully outstanding (FR-017).

### Derived states (never stored — FR-012)

| Question | Answer |
|---|---|
| How much is still outstanding on an owed movement? | `abs(movement.amount_minor) − SUM(settlements.amount_minor)` for that movement |
| Is this expense paid? | It has no Payable movement (paid straight from an account, FR-013), **or** its Payable movement is fully settled |
| What does contact X owe us? | Sum of unsettled Receivable movements on records whose `contact_id` is X |
| Is this invoice paid? | Its Receivable movement is fully settled |
| Is this record locked? | It has a settlement against either of its movements, **or** a reconciliation allocation against one (FR-017a) |

---

## Table: `record_attachments`

Replaces `expense_attachments`, `income_attachments` and `claim_attachments` (FR-032b).

| Column | Type | Constraints |
|---|---|---|
| `id` | INTEGER | PK, autoincrement |
| `record_id` | INTEGER | NOT NULL, → `ledger_records.id`, cascade |
| `filename` | TEXT | NOT NULL — path relative to `STORAGE_PATH` |
| `display_name` | TEXT | NOT NULL |
| `added_date` | TEXT | NOT NULL, default `date('now')` |
| `legacy_filename` | TEXT | nullable — where the file was before the upgrade |

**Index**: `record_attachments_record_idx` on `(record_id)`.

`legacy_filename` is what makes the file move resumable and checkable: a rerun sees the file already
at its destination and skips it, and the verification step compares the two hashes before any
original is removed (D-16, FR-032b, SC-014). It is cleared by the same later release that drops the
legacy tables.

---

## Table: `record_search_text`

Replaces `expense_search_text` and `income_search_text`, unchanged in shape.

| Column | Type | Constraints |
|---|---|---|
| `record_id` | INTEGER | PK, → `ledger_records.id`, cascade |
| `text` | TEXT | NOT NULL |

Every existing reference number is folded in exactly as typed, so SC-013's search requirement holds.

---

## Changed tables

### `bank_statements` — gains an account

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `account_id` | INTEGER | NOT NULL, → `accounts.id` | Which account this statement belongs to (FR-021) |

The upgrade sets it to the default bank account for every existing statement, no question asked
(FR-034a). The user can change it afterwards.

### `reconciliation_allocations` — points at a movement

`item_type` and `item_id` are replaced by:

| Column | Type | Constraints |
|---|---|---|
| `movement_id` | INTEGER | NOT NULL, → `ledger_movements.id`, cascade |

with unique `(line_id, movement_id)` and an index on `(movement_id)`. `item_amount_snapshot` stays —
it is what makes drift detectable. The two old columns are kept nullable for one release alongside
the new one so the backfill is inspectable (D-17), and are not read.

**A candidate for a statement line is now**: a movement on that statement's account, whose sign
matches the line's direction, inside the existing date window.

### `invoices` — feeds the ledger

| Column | Change | Why |
|---|---|---|
| `income_account_id` | **added**, → `accounts.id`, nullable | Which income category the invoice earns into; chosen on issue, defaulting to a seeded **Sales** income account |
| `ledger_record_id` | **added**, → `ledger_records.id`, `set null` | The record issuing the invoice created (FR-018a) |
| `result_income_id` | **stops being read** | Its job is now `ledger_record_id` |
| `amount_paid` | **stops being read** | Derived from settlements (D-10) |

`status` keeps only the document lifecycle — draft, sent, cancelled. "Paid" is computed.

### `import_queue` — gains an account

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `account_id` | INTEGER | → `accounts.id`, nullable | Which account the imported record affected (FR-019, FR-011) |

Nullable because a queued document may be reviewed before the user has said which account paid; the
review screen pre-selects the default account and the confirm step requires one before the record is
created.

### `contact_roles` — no schema change

`Role.Partner = 4` is a new code in an existing column.

### Deprecated, kept in place for one release (D-17, FR-038)

`expenses`, `incomes`, `claims`, `expense_attachments`, `income_attachments`, `claim_attachments`,
`expense_search_text`, `income_search_text`, `categories`. They stay in `schema.ts` with a
`@deprecated` comment naming the release that will drop them. No code reads or writes them after the
upgrade.

---

## How each kind of record is built

Every shape below is produced by one function per kind in `ledger/entry-builder.ts`, which is the only
place movements are constructed and the only place invariant 1 is enforced (FR-001, FR-002).

Amounts shown as `A` are the record's cent amount, `Math.round(amount × exchange_rate × 100)`.

| What the user did | Movements | Notes |
|---|---|---|
| Expense paid from an account | `+A` expense category, `−A` that account | Reads paid immediately (FR-013) |
| Expense someone else paid | `+A` expense category, `−A` Money we owe | Record must name that person (FR-008); reads owed until settled (FR-014) |
| Income received into an account | `+A` that account, `−A` income category | The Shopee statement books here, against the Shopee wallet (US2) |
| Transfer between two accounts | `+A` destination, `−A` source | Neither side is a category, so it is never income or an expense (FR-007) |
| Payment settling what's owed | `+A` Money we owe, `−A` the paying account | Plus one settlement per item covered (FR-015) |
| Money received against what's owed to us | `+A` receiving account, `−A` Money owed to us | Same mechanism, other direction |
| Issuing an invoice | `+A` Money owed to us, `−A` its income account | Tagged with the customer (FR-018a) |
| Buying equipment | `+A` the equipment account, `−A` the paying account | Not an expense that month (FR-006b); spreading its cost later is an ordinary journal record |
| Opening balance | `+A` the account, `−A` Opening balances | One per account, any date (FR-010) |
| Journal entry | Two or more movements the user enters directly | Behind its own permission, off by default (FR-040) |

### Worked example — the problem that started this (US2, SC-003)

| Step | Record | Movements |
|---|---|---|
| Monthly statement, RM 10,000 earned | Income, dated in the month earned | `+1,000,000` Shopee wallet, `−1,000,000` Shopee Sales |
| Commission, RM 800 | Expense | `+80,000` Commission (expense category), `−80,000` Shopee wallet |
| Withdrawal 1, RM 4,000 | Transfer | `+400,000` Bank, `−400,000` Shopee wallet |
| Withdrawal 2, RM 3,000 | Transfer | `+300,000` Bank, `−300,000` Shopee wallet |
| Withdrawal 3, RM 2,200, next month | Transfer | `+220,000` Bank, `−220,000` Shopee wallet |

Shopee wallet balance: `1,000,000 − 80,000 − 400,000 − 300,000 − 220,000 = 0`. The income stays in the
month it was earned; only cash movement lands in the later month; each withdrawal is the only
candidate for its bank deposit, and the Shopee income is never offered because it has no bank
movement (SC-004, SC-005).

---

## What the upgrade converts

Idempotency throughout is `(legacy_kind, legacy_id)` (D-14). Every step below skips rows already
converted.

| Old | New |
|---|---|
| Each `categories` row | An account with the matching category role, same name, same rank (FR-033) |
| Each distinct `category` string in `expenses`/`incomes` with no matching row | An account of the matching role, created so no record loses its category |
| Empty/missing category | The seeded **Uncategorised** expense account, flagged in the upgrade report |
| `expenses` row, marked Paid, no claim | Record `kind = Expense`, `+A` category, `−A` default bank; id preserved |
| `expenses` row, claimed | `+A` category, `−A` Money we owe, contact = the claim's payer contact (D-12) |
| `expenses` row, not Paid, no claim, has a contact | `+A` category, `−A` Money we owe, contact = that contact (FR-036c, D-19) |
| `expenses` row, not Paid, no claim, no contact | `+A` category, `−A` default bank; listed in the upgrade report (FR-036c, D-19) |
| `incomes` row | Record `kind = Income`, `+A` default bank, `−A` category |
| `claims` row | Record `kind = Payment` carrying the **claim's own number**, `+A` Money we owe, `−A` default bank, contact = the payer contact |
| Claim → its expenses | One settlement per covered expense, linking the payment's Payable movement to that expense's Payable movement (FR-035, FR-036) |
| Claim marked Done | Settlements cover the full amounts, so every covered expense reads paid |
| Claim still Pending | Settlements are still written for what the claim covers, but the payment record is **not** created — the amounts stay outstanding against the payer (FR-036) |
| `expense_attachments` / `income_attachments` / `claim_attachments` | `record_attachments`, files copied to `records/YYYY/MM/` (D-16) |
| `expense_search_text` / `income_search_text` | `record_search_text` |
| `reconciliation_allocations` | `movement_id` = the bank movement of the record it named; for a claim, the bank movement of the payment it became (FR-034) |
| Every `bank_statements` row | `account_id` = default bank account (FR-034a) |
| Each user who created a claim | Matched to a contact by email, then name; where the creator is the seeded administrator and exactly one other user exists, those two lookups are retried against that user; failing all of it, created as an individual with the Employee role named from name → username → email local part (FR-036b, D-12) |
| `group_permissions` rows for `claims` | Deleted (D-20) |

Never touched: `contacts`, `quotations`, `invoices` (beyond the two added columns), `audit_log`,
`app_sequences`, `settings`, `users`, `groups`, `document_templates`. No reference number is
regenerated anywhere (FR-032d, FR-032e).

### Upgrade state

One `settings` row, `ledger_upgrade_state`, holding JSON: the phase reached, the "before" snapshot,
the backup file path, and the report (flagged records, missing files, rounding differences, every
payer attribution with the FR-036b step that chose it, and every FR-036c expense sent to the bank
because it named nobody). It is
what makes the run resumable, rerunnable and inspectable, and it is what the verification step
compares against (D-15).
