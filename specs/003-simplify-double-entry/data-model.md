# Phase 1 Data Model: One Ledger, One Records Screen, One Flat Account List

**Branch**: `003-simplify-double-entry` | **Date**: 2026-08-17 | **Spec**: [spec.md](./spec.md)

**No new entity is introduced.** The record store, its sides, and the chart of accounts are unchanged
in shape and in meaning. What changes here is subtractive — dead tables go, two dead columns go, one
column stops being optional — plus a permission rename, a permission merge, and three additions to
types the screens already read.

Money is whole cents in a signed integer (`amount_minor`); a side is positive when value goes **into**
an account and negative when it leaves; a record's sides always sum to zero. None of that is touched.

---

## 1. Tables removed

All seven are declared `@deprecated` in `schema.ts` today. Verified unread except where noted, and
those two readers are repointed first (research.md R-13).

| Drizzle name | SQL name | Lines | What replaced it |
|---|---|---|---|
| `expenseSearchText` | `expense_search_text` | 351–356 | `record_search_text` |
| `incomeSearchText` | `income_search_text` | 362–367 | `record_search_text` |
| `expenseAttachments` | `expense_attachments` | 266–276 | `record_attachments` |
| `incomeAttachments` | `income_attachments` | 282–292 | `record_attachments` |
| `claimAttachments` | `claim_attachments` | 298–308 | `record_attachments` |
| `expenses` | `expenses` | 194–231 | `ledger_records` (kind Expense) + `ledger_movements` |
| `incomes` | `incomes` | 237–260 | `ledger_records` (kind Income) + `ledger_movements` |
| `claims` | `claims` | 177–188 | `ledger_records` (kind Payment) + `settlements` |
| `categories` | `categories` | 379–393 | `accounts` with role `ExpenseCategory` / `IncomeCategory` |

There is no FTS5 table and no trigger anywhere in the codebase, so nothing is trigger-dependent. The
dependencies are foreign keys, and they fix the order.

### Drop order (load-bearing)

Drizzle wraps each migration in `BEGIN … COMMIT`, so `PRAGMA foreign_keys = OFF` has no effect inside
it — the order below is what makes the migration succeed rather than a convenience.

```
1. expense_search_text, income_search_text            (leaves)
   expense_attachments, income_attachments,
   claim_attachments                                   (leaves)

2. REBUILD invoices  — drop column result_income_id     (live table, FK → incomes)

3. expenses          (FK → claims, FK → contacts)
   incomes           (FK → contacts)
   claims

4. categories                                          (no incoming FK)

5. REBUILD reconciliation_allocations
                     — drop columns item_type, item_id  (live table, FR-037b)
```

Steps 2 and 5 rebuild **live** tables. Both are SQLite table rebuilds (create `__new_x`, copy, drop,
rename) because SQLite cannot drop a column carrying a foreign key. They are the highest-risk
statements in the release and the reason FR-038's backup warning leads the release notes.

### Columns removed

| Table | Column | Why it is safe |
|---|---|---|
| `invoices` | `result_income_id` | Points at `incomes`. Superseded by `invoices.ledger_record_id`, written by `markInvoiceIssued`. Already `@deprecated`. |
| `reconciliation_allocations` | `item_type` | Superseded by `movement_id`. Verified zero readers in `src/`. |
| `reconciliation_allocations` | `item_id` | Same. Kept unread for one release by 002's D-17; that release has passed. |

### Columns deliberately kept

| Table | Column | Why |
|---|---|---|
| `ledger_records` | `legacy_kind`, `legacy_id` | Not named by FR-037. They are the only surviving record of which old row a converted record came from. The **lookup** that resolved a pre-conversion URL from them is removed (FR-025a), not the provenance. Their unique index `ledger_records_legacy_idx` stays. |
| `record_attachments` | `legacy_filename` | Where a migrated receipt used to sit on disk. Same reasoning. |

---

## 2. Column changed

| Table | Column | Before | After | Migration |
|---|---|---|---|---|
| `bank_statements` | `account_id` | `integer` → `accounts.id`, **nullable** | `integer NOT NULL` → `accounts.id` | Any remaining null is set to the seeded default money-holding account before the constraint is added, exactly as the earlier conversion's `backfillReconciliation` did. |

Nullable only because the earlier conversion ran before accounts were seeded — a reason that expired
when it finished. With reconciling reached from an account (research.md R-09, R-10), a statement
belonging to no account would belong to no route, so FR-055 is satisfied by removing the case rather
than building a surface for it.

---

## 3. Permissions

`resource` is a plain `text` column on both tables, with no enum, no foreign key and no lookup table.
Both are keyed `(ownerId, resource)`, which is what makes the merge a merge rather than a rename.

### `ResourceName` before and after

```
before: dashboard | expenses | income | import | contacts | quotations | invoices |
        reconciliation | accounts | reports | journal          (11)

after:  dashboard | records | import | contacts | quotations | invoices |
        reconciliation | accounts | reports | adjustments      (10)
```

Three places list this and all three must change together: the `ResourceName` union and
`ALL_RESOURCES` in `permissions.ts` (which duplicates the union rather than deriving from it), the
`RESOURCES` array in `users-groups/+page.svelte:54–66`, and the `RESOURCES` array in
`api/groups/[id]/permissions/+server.ts:54–65`.

### Change A — `expenses` + `income` → `records` (OR-merge)

Two rows collapse onto one primary key, so the four booleans are OR-ed before the write:

| Destination | Rule |
|---|---|
| `records.can_view` | `expenses.can_view OR income.can_view` |
| `records.can_add` | `expenses.can_add OR income.can_add` |
| `records.can_change` | `expenses.can_change OR income.can_change` |
| `records.can_delete` | `expenses.can_delete OR income.can_delete` |

Applied to **`group_permissions` and `user_permissions` both**. `dropClaimPermissions()`
(`upgrade/index.ts:125–134`) is the precedent for retiring a resource string and it touched groups
only; repeating that omission would discard every per-user override and break FR-029 silently.

A missing source row reads as all-false, so a group holding only `income` keeps exactly what it held.

### Change B — `journal` → `adjustments` (rename)

One row becomes one row. No collision, no merge, no loss:

```sql
UPDATE group_permissions SET resource = 'adjustments' WHERE resource = 'journal';
UPDATE user_permissions  SET resource = 'adjustments' WHERE resource = 'journal';
```

This is what satisfies FR-031b at zero cost. And because no seeded group grants `journal` today —
verified across `SEED_GROUPS` (`db/client.ts:61–266`): Bookkeeper, Data Entry and Reviewer all omit
it, and Administrators passes only through the `isSuperuser` early return in `hasPermission` — FR-031a
is satisfied by inheritance. Nothing needs to newly withhold it.

### Where the rewrite runs

A pure function, `permissions/merge-records.ts`, developed test-first, plus a thin idempotent applier
called from the seed path in `db/client.ts` beside `ensureGroupSeed()`, guarded by a `settings` key.
Not inside a migration: Principle V names permission resolution as TDD-required, and a pure function
over rows is red-green testable where SQL inside a migration is not.

### Seeded groups after the change

| Group | Before | After |
|---|---|---|
| Administrators | `isSuperuser: true`, no rows | unchanged |
| Bookkeeper | expenses view/add/change + income view/add/change | `records` view/add/change |
| Data Entry | expenses add + income add | `records` add |
| Reviewer | expenses view + income view | `records` view |
| any | `journal` — none | `adjustments` — none (FR-031a) |

### Resource descriptions (FR-031e)

The two `RESOURCES` arrays carry `{id, label}` today. Both gain `description`, because
`adjustments` is unguessable without one:

| Resource | Label | Description |
|---|---|---|
| `records` | Records | Everything that happened with money — purchases, sales, transfers, payments. |
| `adjustments` | Adjustments | Lets someone write a record between any two accounts, and add more than two sides. Needed for corrections and year-end adjustments. Grant it only to someone you trust with the books, because a record written this way can make the accounts say anything and still add up. |

`reports` stays view-only; no `add`, `change` or `delete` is ever granted on it.

---

## 4. Types changed in `ledger/types.ts`

`types.ts` is the interface freeze — a change here is a change every caller sees. Three additions and
two extensions, all additive to existing callers except where noted.

### `RecordView` — three new fields

```ts
export type RecordView = LedgerRecordRow & {
  …
  /** Any bank line points at this record. Drives `locked`. Existence only. */
  reconciled: boolean;
  /** Fully covered by bank lines. Drives the "not yet cleared" filter and the row label. */
  cleared: boolean;
  /** How much of this record bank lines account for, in cents. */
  clearedMinor: Minor;
  /** How many sides this record has — a row shows the count instead of two accounts when > 2. */
  sideCount: number;
};
```

`reconciled` and `cleared` answer genuinely different questions and the codebase already computes both
under one name in two places that disagree (research.md R-08):

- `matchedMovements()` (`queries/ledger.ts:265–275`) — existence. One allocation row is enough.
- the reconciliation workspace — `remainingAmount >= EPSILON`. A partly matched movement still needs
  clearing, which is why its "Needs Review" filter lists it.

Existence is right for **locking**: if any bank line points at a record its amount must not change,
covered or not. Coverage is right for a **worklist**: FR-056's filter must not disagree with the
workspace it replaces. So each keeps its own field, named for what it answers. `locked` continues to
read `reconciled`.

`sideCount` exists for the list row. A hand-made entry with five sides has no single pair of accounts,
and the row must say how many sides it has rather than picking two arbitrarily (spec edge case).

### `RecordListFilters` — two new filters

```ts
export type RecordListFilters = {
  …
  /** FR-056 — every account, not just those with a statement. */
  cleared?: boolean;
  /** FR-043 — which sort is in force, because the running balance depends on date order. */
  sort?: "date" | "amount";
};
```

Everything else FR-002 asks for already exists: `kind` (single or array), `accountId`, `contactId`,
`categoryAccountId`, `dateFrom`, `dateTo`, `amountMin`, `amountMax`, `paid`, `search`, `limit`,
`offset`. FR-002 needs no filter invented beyond `cleared`.

`sort` is named because FR-043 makes it load-bearing: the running balance may only appear when the rows
are in date order, so the statement view has to know which sort is in force.

### `RecordCreate` — one new shape

`RecordCreateSides` keeps all seven existing variants; the API keeps accepting them, because Invoices,
Auto Import and reconciliation's transfer action all construct them today and FR-036 leaves those
untouched. The **form** sends a new eighth shape instead, and the server derives which of the seven it
means:

```ts
/** What the one form sends. The kind is derived, never stated (D-01, research.md R-02). */
export type RecordCreateFromSides = {
  fromAccountId: number;   // the account money left
  toAccountId: number;     // the account money went to
  /** Third and later sides. Requires the `adjustments` ability (FR-031). */
  extraSides?: { accountId: number; amountMinor: Minor }[];
};
```

### `AccountHistoryReport` — unchanged, and reused

The statement view (D-05) reuses `AccountHistoryEntry` and `AccountHistoryReport` exactly as they
stand, including `runningBalanceMinor`, `openingBalanceMinor`, `closingBalanceMinor`, `total` and
`notes`. Nothing about the running balance is rebuilt — only its address and its ability change
(research.md R-07).

---

## 5. The derivation: two accounts → a kind

`ledger/sides-from-accounts.ts`, pure, test-first. It produces a `RecordCreateSides` for
`entry-builder.ts`, which stays the only place movements are constructed.

```
sidesFromAccounts(input, ctx): Refusable<RecordCreateSides>
```

| Money left a role of… | …and went to | Kind produced |
|---|---|---|
| Bank / Wallet / Cash / Card | ExpenseCategory or Equipment | `expense` |
| IncomeCategory | Bank / Wallet / Cash / Card | `income` |
| Bank / Wallet / Cash / Card | Bank / Wallet / Cash / Card | `transfer` |
| Bank / Wallet / Cash / Card | Payable | `payment`, `we-pay` |
| Receivable | Bank / Wallet / Cash / Card | `payment`, `we-receive` |
| Payable | ExpenseCategory or Equipment | `expense`, `paidFromAccountId: null` — someone else paid |
| OpeningBalances | anything | `opening-balance` |
| any other pair, or `extraSides` present | — | `journal` |

Refusals, each with the plain sentence shown to the user:

- Both sides name the same account.
- A side names `Receivable` or `Payable` with no contact — "Say who this is owed to or by."
- The result is `journal` and the caller lacks `adjustments` — FR-031c, refused on the server, not by
  hiding the control.
- A side names an archived account (FR-021).

`invoice-issue` is not producible here. It is created only by the invoice endpoints and is read-only
through the records API (`isReadOnlyKind`, FR-013).

---

## 6. Invariants

The six invariants of the double-entry ledger are unchanged and still checked by
`checkIntegrity()` — every record's sides sum to zero, every record has at least two sides, no side is
zero, a shared owed account is never touched without a contact, the whole table sums to zero, and a
record's entered amount matches its sides. FR-038a requires the whole-books check to pass after the
drop, and it uses that same function.

Four invariants are added by this feature, each with the requirement it serves:

| # | Invariant | Serves |
|---|---|---|
| 7 | Every permission row's `resource` is a member of `ALL_RESOURCES`. No row names `expenses`, `income` or `journal` after the rewrite. | FR-028, SC-006 |
| 8 | For every user and group, effective access to records after the change is at least what it was before. | FR-029, SC-006 |
| 9 | `bank_statements.account_id` is never null, and always names an account whose role is a money pot. | FR-049, FR-055 |
| 10 | `clearedMinor` never exceeds a record's own `amountMinor`, and `cleared` is true exactly when they are equal. | FR-056, R-08 |

Invariants 7 and 8 are what SC-006 measures. They are checked by the test around
`merge-records.ts`, not at runtime — a permission table cannot be continuously swept without the sweep
becoming the thing that is wrong.

---

## 7. What is not changing

Stated as plainly as what is, because the risk in a simplification is discarding something that was
earning its place:

- `ledger_records`, `ledger_movements`, `settlements`, `accounts`, `record_attachments`,
  `record_search_text` — no column added, removed or retyped.
- Money stays whole cents in a signed integer. The decimal `amount` and the locked `exchange_rate`
  stay for display and audit and are still never summed into a report total.
- Nothing about payment state is stored. `paid`, `outstandingMinor`, `locked`, contact balances and
  account balances are still computed per request.
- A category is still an account. Its `type` is still derived from its `role` and never stored.
- `displaySign` stays the one place a sign is flipped for display.
- `entry-builder.ts` stays the only place movements are constructed.
- Every report produces identical figures (FR-033, SC-003), because nothing they read is touched.
