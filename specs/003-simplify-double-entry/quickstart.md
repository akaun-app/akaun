# Quickstart: Validating One Ledger, One Records Screen, One Flat Account List

**Branch**: `003-simplify-double-entry` | **Date**: 2026-08-17 | **Spec**: [spec.md](./spec.md)

How to prove this feature works. It is split by who does what, because this project divides
verification deliberately: an agent reads code and runs the suite, and the maintainer confirms
behaviour and appearance in the running app.

---

## Before anything else: this release destroys data

FR-038 requires the release notes to say so before they say anything else, and the same warning belongs
at the top of this document.

**Back up `data/akaun.db` and `data/storage/` before running this branch against real books.** The
migration drops the old expense, income and claim tables and rebuilds two live tables. Nothing in the
app can undo it — D-03 assigns that responsibility to the user on purpose, unlike the earlier
conversion, which took its own restorable copy.

```bash
# From the project root, with the app not running.
mkdir -p data/backups
cp data/akaun.db "data/backups/pre-003-$(date +%Y%m%dT%H%M%S).db"
cp -R data/storage "data/backups/storage-pre-003-$(date +%Y%m%dT%H%M%S)"
shasum -a 256 data/akaun.db          # record this; compare after
```

### Rules for anyone writing a script during this work

`DATABASE_PATH` and `STORAGE_PATH` are relative and `.env` points them at `./data/akaun.db` and
`./data/storage`. **Any process started in the project root writes to the maintainer's real books.**
Setting those two variables inside your own script is not sufficient protection. A test must pass its
own paths explicitly. Check for a running dev server with `ps aux | grep "vite dev"` before editing
anything, because a restart runs migrations.

---

## Prerequisites

```bash
bun install
```

No new runtime dependency is introduced. Nothing here needs a network service, an LLM provider or a
browser.

---

## Part 1 — The gates (agent, no running app)

All three must pass before the change is considered done.

```bash
bun run check      # svelte-kit sync + svelte-check
bun run lint       # prettier --check + eslint
bun run test       # server project under Bun, then client project under Node
```

Notes that will otherwise cost time:

- **Run `bun run check` with no dev-server tab open.** It rewrites
  `.svelte-kit/generated/client/nodes/*.js`, and a tab loaded before that keeps the old route-to-node
  map — producing a blank page and an error naming a component you never opened. Repair is: stop the
  server, `rm -rf node_modules/.vite`, restart, reload.
- `bun run test` runs two projects in two runtimes on purpose. `test:unit` is the Bun half — pass
  `--project server` when invoking it directly. A server spec under Node fails on `bun:sqlite`; a
  client spec under Bun times out starting the browser.
- Prettier still skips `.svelte` files (no config, so `prettier-plugin-svelte` never loads), and ~200
  pre-existing tab/space failures in `src` are a separate chore. Do not fix them on this branch.

---

## Part 2 — The four rules developed test-first

Each is a pure module over plain rows, no database. Write the failing test, watch it fail, then make it
pass. These are the only places in this feature where a wrong answer is silent (Principle V,
research.md R-14).

```bash
bun run test:unit -- --run --project server src/lib/server/ledger/sides-from-accounts.spec.ts
bun run test:unit -- --run --project server src/lib/server/permissions/merge-records.spec.ts
bun run test:unit -- --run --project server src/lib/server/ledger/coverage.spec.ts
bun run test:unit -- --run --project server src/lib/server/db/legacy-drop-guard.spec.ts
```

| Module | The cases that matter | Why it is silent when wrong |
|---|---|---|
| `sides-from-accounts.ts` | Every row of the derivation table in data-model.md §5, plus each refusal: same account both sides, an owed account with no contact, an archived account, and free choice without `adjustments`. | A wrong kind still balances and still totals. It only files the record on the wrong report. |
| `merge-records.ts` | Each of the 16 combinations of one group holding `expenses` and `income` booleans; a group holding only one of the two; a group holding neither; and the `journal` → `adjustments` rename. | A wrong OR-merge revokes access nobody notices until someone complains. SC-006 measures it. |
| `coverage.ts` | Nothing allocated, part allocated, exactly covered, over-covered, a record touching one account twice. `cleared` true **only** when `clearedMinor` equals `amountMinor` (invariant 10). | Money arithmetic. A partly matched record reading as cleared hides real work. |
| `legacy-drop-guard.ts` | Tables absent; present with zero rows; present with rows and phase `done`; present with rows and phase not `done` (**the only refusal**); phase missing entirely. | Wrong once, and an installation's records are gone. |

### The two bug fixes, each with a test that fails first

```bash
bun run test:unit -- --run --project server src/routes/api/files
bun run test:unit -- --run --project server src/lib/server/import/duplicate-detector.spec.ts
```

- **`/api/files` ownership.** Assert a file named only in `record_attachments` is served; a file named
  nowhere is still `403`; the traversal guard and the `bank_statements` permission check still hold.
  This fails today for every attachment on every ledger record.
- **Auto Import duplicate detection.** Seed a ledger record, assert the detector finds it as a
  candidate. This fails today for every record created since the conversion.

Both must be green **before** the drop migration lands, so the fix and the drop are independent.

---

## Part 3 — The migration, on a copy (agent)

Never against `data/`. Work on a copy and hash it before and after.

```bash
mkdir -p /tmp/akaun-003 && cp data/backups/pre-003-*.db /tmp/akaun-003/probe.db
shasum -a 256 data/akaun.db     # must match what you recorded; the real file is untouched
```

Point a throwaway environment at the copy and start the server once, then confirm:

| Check | Expected |
|---|---|
| The nine legacy tables are gone | `SELECT name FROM sqlite_master WHERE name IN ('expenses','incomes','claims','expense_attachments','income_attachments','claim_attachments','expense_search_text','income_search_text','categories')` returns nothing |
| `invoices` lost one column and kept its rows | no `result_income_id`; row count and every `ledger_record_id` unchanged |
| `reconciliation_allocations` lost two columns and kept its rows | no `item_type`, no `item_id`; row count and every `movement_id` unchanged |
| `bank_statements.account_id` is required and populated | `SELECT COUNT(*) FROM bank_statements WHERE account_id IS NULL` returns 0 |
| No permission row names a retired resource | `SELECT DISTINCT resource FROM group_permissions UNION SELECT DISTINCT resource FROM user_permissions` contains no `expenses`, `income` or `journal` |
| The whole-books check passes (FR-038a) | `GET /api/ledger/integrity` returns `ok: true`, `booksBalance: true` |

### The refusal path, which matters more than the success path

Take a copy whose `settings` row `ledger_upgrade_state` has any phase other than `done`, while the
legacy tables still hold rows. Starting the server must **refuse**, print the sentence naming the
previous release to install first, and leave the database byte-identical:

```bash
shasum -a 256 /tmp/akaun-003/unconverted.db   # before and after must match exactly
```

This is FR-037a, and it is the one check that stands between a skipped release and lost records.

---

## Part 4 — Figures identical before and after (agent, on a copy)

SC-003 and FR-039 require every figure to be unchanged. Capture from the backup copy, capture again
after, compare byte for byte.

```bash
# For each, before and after, over the same dates:
#   GET /api/reports/profit-loss?dateFrom=…&dateTo=…
#   GET /api/reports/balance-sheet?asAt=…
#   GET /api/reports/partner-statement?dateFrom=…&dateTo=…
#   GET /api/accounts                     (every balanceMinor)
diff before/profit-loss.json after/profit-loss.json     # must be empty
```

Attachments too (FR-039): every row in `record_attachments` must still resolve to a file on disk, and
every one must now download rather than `403`.

---

## Part 5 — What the maintainer confirms in the app

Agents do not drive the running app, log in, or read `.env`. These are the user's checks, one per user
story, phrased so each can be answered yes or no.

**US1 — one list**
1. The navigation shows eight items and no Expenses, Income, Journal or Reconciliation.
2. A purchase from three months ago, a sale, and a transfer between two of your own accounts are all
   findable from Records without visiting another page.
3. Filtering to "money in" shows only income, and the address bar changes so the filter can be shared.
4. Searching a supplier's name returns records of every kind together, not split.
5. Copying the address of an open record and opening it in a new tab opens the same record.
6. A record a payment depends on opens with amount, date and accounts not editable, and one plain
   sentence saying what to undo first.

**US2 — one form**
7. A fuel purchase paid from the bank, a sale received into the bank, and a transfer between two of
   your own accounts all go in through the same form, and each lands correctly on the list and in the
   reports.
8. Making the two sides disagree refuses the save and says by how much it is out; nothing is written.
9. Recording that someone else paid shows the record as owed to that person.
10. Signed in as a user with view but not add, there is no "New record" action.

**US3 — flat accounts**
11. The Accounts screen has no section headings, and typing part of a name narrows it.
12. Filtering to categories shows only categories.
13. Opening an account gives the same drawer as before, including its opening balance.
14. "See every movement" opens Records narrowed to that account, with a running balance, and the
    closing figure matches the balance on the Accounts list to the cent.
15. Adding a sort, or searching, while narrowed to one account makes the running balance disappear and
    the screen says why.

**US4 — one place for categories**
16. Settings has no Category tab.
17. A category added on Accounts is immediately offered on the Records form.
18. Retiring a category that has records keeps its history and stops it being offered on new records.

**US5 — no dead links**
19. Every link into a record — from the Dashboard, Reports, the matching surface — opens it on Records.
20. Visiting `/` lands on Records.
21. A saved mobile navigation that named Expenses still gives a working bottom bar.

**US6 — one permission**
22. Every group's access is what it was before the change (this is the one to check account by account).
23. A user with add but not Adjustments is offered only the everyday shortlist on each side, and no
    "add another side".
24. A new group shows Adjustments off, with a description saying plainly what granting it allows.

**US8 — reconciling from the account**
25. Opening a bank account offers reconciling, and says if a statement is part-way through.
26. Uploading a statement never asks which account it is for.
27. The matching surface is full width, with bank lines, candidates and your selection visible together,
    at an address you can copy.
28. A category account offers no reconciling.
29. Records filtered to "not yet cleared" shows everything awaiting clearing across every account, and
    each row opens.
30. A statement can still be moved to a different account.

---

## Part 6 — Documentation that has to change with the code

Principle VI: deviating from a documented pattern means amending `CLAUDE.md` in the same change. Four
passages are made false by this feature, and one is **already** false.

| Passage | Why |
|---|---|
| The named-URL exception table (Payment / Transfer / OpeningBalance / InvoiceIssue have no screen of their own) | Every kind now has one list and one deep link. The table's reason for existing changes, and `SettlementList`'s `canOpen` — documented as the one function to update — is now the function that opens every kind. |
| The per-feature deep-link pattern | Three features collapse into one, so the "one shared page component, two small routes" example needs rewriting around Records. |
| "Named full-page exception" listing `/accounts/[id]/history` | D-05 retires that page. The accounts split it describes — drawer at `/accounts/[id]`, report at `/accounts/[id]/history` — no longer exists. |
| "Named exception — task workspaces" citing `/reconciliation/[id]/match` | **Already false.** Commit `e5568b1f` deleted that route; the directories are empty. FR-052 gives the matching surface a real address, which is the chance to make the paragraph true. |
| The `$lib/server` hand-mirror list | `components/accounts/display-sign.ts` keeps its `ROLE_GROUPS` consumer removed, and any new client mirror needs its `// Mirrors …` comment. |

---

## Definition of done

- [ ] `bun run check`, `bun run lint`, `bun run test` all pass
- [ ] The four pure modules are test-first and green; both bug fixes have a test that failed first
- [ ] The migration's refusal path leaves an unconverted database byte-identical
- [ ] Profit and loss, balance sheet, partner statement and every account balance are identical
      before and after (SC-003)
- [ ] `GET /api/ledger/integrity` returns `ok: true` after the drop (SC-004, FR-038a)
- [ ] No permission row names `expenses`, `income` or `journal`; every group's access is unchanged (SC-006)
- [ ] No file in `src/` references `/expenses`, `/income`, `/journal`, `/api/expenses`, `/api/income`
      or `/api/journal` (SC-005)
- [ ] Release notes lead with the destructive-change warning and the instruction to back up (FR-038)
- [ ] `CLAUDE.md` amended in the same change (Principle VI)
- [ ] The maintainer has confirmed the 30 checks in Part 5
