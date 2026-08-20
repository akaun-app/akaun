# Contract: HTTP API

**Feature**: `specs/003-simplify-double-entry` | **Date**: 2026-08-17

Every endpoint keeps the app's four mutation obligations: a `hasPermission(locals, resource, action)`
check returning `403` on failure, Zod validation at the boundary, a `recordAudit` entry, and an SSE
emit after the write. Routes parse, authorise and delegate; the rules stay in `$lib/server/services/`.

Shapes reference [data-model.md](../data-model.md) and are not repeated. Common failures are unchanged:
`400` Zod validation failed, `401` not signed in, `403` permission denied, `404` not found, `409` a
rule refused (body `{ error, reason }`, where `reason` is the plain sentence shown to the user).

**This feature's API work is mostly subtraction.** Nine endpoints retire, one is added, one is moved,
and four gain a field. What is *not* here is as important: `/api/records`, `/api/settlements`,
`/api/accounts`, `/api/reports/{profit-loss,balance-sheet,partner-statement}`, `/api/invoices`,
`/api/quotations`, `/api/contacts`, `/api/import` and `/api/ledger/integrity` keep their addresses and
their response shapes.

---

## Retired outright

No redirect is built for any of these (D-04). A request may answer `404`.

| Endpoint | Replaced by |
|---|---|
| `GET POST /api/expenses` | `/api/records` with `kind=1` |
| `GET PATCH DELETE /api/expenses/[id]` | `/api/records/[id]` |
| `GET POST /api/expenses/[id]/attachments` | `/api/records/[id]/attachments` — already a pure re-export today |
| `DELETE /api/expenses/[id]/attachments/[attachmentId]` | same |
| `GET /api/expenses/stream` | `GET /api/records/stream` |
| the same five under `/api/income/**` | the same |
| `GET /api/journal/stream` | `GET /api/records/stream` |
| `GET /api/reports/account-history` | `GET /api/records/statement` |
| `GET /api/accounts/[id]/movements` | `GET /api/records/statement` |

The expense and income attachment routes are already `export { POST } from "…/records/…"` re-exports,
so deleting them removes addresses, not behaviour.

---

## Records — resource `records`

### The permission collapse

`resourceForKind()` and `resourceForKindName()` in `ledger/record-permissions.ts` both return
`"records"` for every kind. The two functions survive as a single line each rather than being deleted,
because every call site keeps calling them and the file's doc comment is the written record of what
changed:

> Transfers, payments and opening balances were checked against `expenses` "because that is the screen
> they are recorded from". That screen is gone, and so is the rule nobody could guess.

**One hole this closes.** `GET /api/records` with no `kind` currently checks `["expenses", "income"]`
and never checks `journal` (`api/records/+server.ts:106`), so a hand-written record is readable by
anyone with expense view. After this change one `records` view check covers every kind. That is not a
widening: FR-031d puts the gate on *writing* with free choice, never on seeing (see `adjustments`
below).

### `GET /api/records`

View on `records`. Query, all optional: `kind` (repeatable), `accountId`, `contactId`,
`categoryAccountId`, `dateFrom`, `dateTo`, `amountMin`, `amountMax`, `paid`, **`cleared`** (new),
`search`, **`sort`** (new — `date` default, or `amount`), `limit`, `offset`.

Each record gains three fields (data-model.md §4):

```
{ records: [{ …unchanged…,
              reconciled,          // any bank line points here — drives `locked`
              cleared,             // fully covered by bank lines — drives the filter and the label
              clearedMinor,
              sideCount }],        // > 2 means the row shows a count, not two accounts
  total }
```

`cleared` is deliberately not the same question as `reconciled`, and the two disagree on a partly
matched record. See research.md R-08 — the workspace's "Needs Review" filter that FR-056 replaces is
amount-aware, so the Records filter must be too, while `locked` must stay existence-based.

### `POST /api/records`

Add on `records`. The endpoint's existing Zod discriminated union on `kind` — `expense`, `income`,
`transfer`, `payment`, `journal` — is **kept**. Auto Import posts `expense` and `income` shapes, and
`RecordCreateSides` itself is constructed in-process by `services/invoices.ts` (`invoice-issue`),
`services/accounts.ts` (`opening-balance`) and reconciliation's transfer action, all of which call
`createRecord` directly. FR-036 leaves every one of them untouched, so none of the seven variants can
be removed.

One new member is added, and it is the only one the form sends (D-01, research.md R-02):

```
{ date, description, amount, currency, exchangeRate, reference?, remark?, contactId?,
  fromAccountId,          // the account money left
  toAccountId,            // the account money went to
  extraSides?: [{ accountId, amountMinor }] }   // third and later sides
```

The server calls `sidesFromAccounts()` to derive which of the seven kinds this is, then hands the
result to `buildMovements()` unchanged. `entry-builder.ts` remains the only place movements are
constructed.

Refusals (`409`, each with its plain sentence):

- the sides do not cancel out, and by how much (FR-009)
- both sides name the same account
- a side names Money owed to us or Money we owe with no contact — "Say who this is owed to or by."
  (FR-011, US2 scenario 7)
- a side names an archived account (FR-021)
- **the derivation lands on `journal`, or `extraSides` is present, or a side names an account outside
  that side's everyday shortlist, and the caller lacks `adjustments`** — FR-031c

That last refusal is the whole of FR-031's server enforcement. It is checked after the derivation,
because whether a record needs the ability is a fact about the accounts it names, not about what the
client sent.

### `GET PATCH DELETE /api/records/[id]`

Unchanged except that all three check `records`. `PATCH` keeps refusing `amount`, `date` and any
account field on a settled or reconciled record, with the same sentence naming what to undo first
(FR-012). `PATCH` and `DELETE` keep refusing an `invoice-issue` record with "Change it on the invoice
instead." (FR-013).

`PATCH` accepts `fromAccountId` / `toAccountId` and re-derives the kind through the same rule, subject
to the same `adjustments` gate.

### `GET POST /api/records/[id]/attachments`, `DELETE …/[attachmentId]`

Unchanged in behaviour, now checking `records`. FR-014.

### `GET /api/records/[id]/settlements`

Unchanged, checking `records` view. FR-018's "list of many" for the drawer.

### `GET /api/records/stream` — **new**

View on `records`. **This endpoint does not exist today** — FR-005 reads as a consolidation but it is
one new endpoint and three deletions (research.md R-11).

Forwards, from the one `ledgerEvents` emitter, with no kind filter:

| Event | Payload |
|---|---|
| `record-update` | the full `RecordView` |
| `record-deleted` | `{ id }` |
| `settlement-changed` | `{ recordIds }` |

**No snapshot on connect**, per `CLAUDE.md`: Records is a paginated list, so SSR gives the first state
and the stream carries only changes. The journal stream's deliberate omission of `settlement-changed`
disappears with it — the merged screen shows records that do have a derived paid state.

### `GET /api/records/statement` — **new, replacing two**

View on **`records`** (FR-046). Query: `accountId` (required), `dateFrom?`, `dateTo?`, `limit?`,
`offset?`, `format=json|csv`.

Returns `AccountHistoryReport` unchanged — `runningBalanceMinor` per entry, `openingBalanceMinor`,
`closingBalanceMinor`, `total`, `notes`. The query (`accountHistory()`), the running-balance
arithmetic, the truncation note and the CSV writer are all reused as they stand; only the address and
the ability change.

Two endpoints retire into this one. Both answered the same question at different addresses under
different abilities, which is the duplication of the spec's review item 8 one level down:

- `/api/reports/account-history` — gated `reports.view`, had `format=csv`.
- `/api/accounts/[id]/movements` — gated `accounts.view`, had no CSV.

**A defect this closes**: `/accounts/[id]/history` gates its page shell on `accounts.view` but fetched
from the endpoint gated on `reports.view`, so a user with accounts access and no reports access got a
page that loaded and then refused. One screen now answers to one ability.

A record touching the narrowed account twice appears once per side, so the running balance adds up
(FR-042). The opening, closing and running figures are returned only when `accountId` plus an optional
date range are the only parameters and `sort` is date order; otherwise they are omitted and `notes`
carries the plain reason (FR-043).

---

## Adjustments — resource `adjustments`

Not an endpoint of its own. One ability checked inside `POST` and `PATCH /api/records`, gating exactly
two things (FR-031):

1. naming an account outside the side's everyday shortlist, and
2. adding a third or later side.

`adjustments.add` for creating, `adjustments.change` for editing. **Reading is never gated on it**
(FR-031d) — a record written with free choice is visible to anyone with `records` view.

Held by no seeded group and off by default on a new group (FR-031a), inherited from `journal`, which no
seeded group grants today. Anyone who held `journal` holds `adjustments` afterwards with the same
actions (FR-031b), because the migration is a rename rather than a merge.

---

## Accounts — resource `accounts`

Endpoints unchanged: `GET POST /api/accounts`, `GET PATCH DELETE /api/accounts/[id]`,
`PUT /api/accounts/[id]/opening-balance`, `GET /api/accounts/stream`. `GET /api/accounts/[id]/movements`
retires (above).

`GET /api/accounts` keeps `role?` and `includeArchived?`. The flat list, its search box and its
"sort of account" filter are **client-side over the already-loaded list** (FR-017) — the loader already
fetches every account with `includeArchived: true`, and an established set of books runs to perhaps a
hundred rows. Adding server-side search would be a second way to filter one list, for no gain.

Categories are created, renamed and archived here and nowhere else (FR-019). No new endpoint is needed:
the Settings Category tab already reconciled its staged list by calling `createAccount`, `patchAccount`
and `removeAccount` through the same accounts service that `POST /api/accounts` uses. That tab and its
`saveCategories` action are deleted (FR-020); the service they called stays.

---

## Reconciliation — resource `reconciliation`

Who may reconcile does not change (FR-057). What changes is where it is reached and what the upload
asks.

### `POST /api/reconciliation/statements` — one field removed

`accountId` **stops being a form field**. The route becomes
`POST /api/accounts/[id]/reconciliation/statements`, taking the account from the path (FR-050). The
`400` "Choose the account this statement belongs to" refusal disappears with the picker — the account
is no longer something the request can get wrong.

`createStatement`'s existing money-holding validation stays (FR-049): a category or an owners' account
is refused, because a statement can only belong to somewhere money actually sits.

### Unchanged endpoints

`GET /api/reconciliation/statements`, `GET DELETE /api/reconciliation/statements/[statementId]`,
`POST …/retry`, `PATCH DELETE /api/reconciliation/lines/[lineId]`, `POST …/lines/[lineId]/transfer`,
`PUT /api/reconciliation/records/[movementId]/allocations`, `POST /api/reconciliation/auto-match`,
`GET /api/reconciliation/stream`.

`PATCH /api/reconciliation/statements/[statementId]` — the move-to-another-account action — is
unchanged and load-bearing. It is what makes FR-054 reachable from the account a statement is currently
filed against, and it keeps refusing (`409`) a statement that already has allocations.

The candidate rule is unchanged (FR-051): only movements on the statement's own account are ever
offered, enforced in `listMovementCandidates` and again in `suggestLinesForMovement`.

### `bank_statements.account_id` becomes required

Not an API change, but it removes a case the API had to tolerate. With the column NOT NULL
(data-model.md §2), no statement can belong to no account, so FR-055 is satisfied by construction
rather than by a surface for an impossible state.

---

## Reports — resource `reports` (view only)

`GET /api/reports/{profit-loss,balance-sheet,partner-statement}` unchanged, still `reports.view`, still
producing identical figures (FR-033, SC-003). They keep the words income and expenses, because that is
what a profit and loss is made of.

`GET /api/reports/account-history` retires (above). `report-links.ts` is the only client that needs
re-pointing: `openAccountHistory()` already goes to `/(app)/accounts/[id]`, and `recordPathFor()` at
lines 35 and 38 changes from `/(app)/expenses/[id]` and `/(app)/income/[id]` to `/(app)/records/[id]`
(FR-027, FR-047).

`GET /api/ledger/integrity` unchanged, still `reports.view`. It is what FR-038a's whole-books check
runs after the drop, using the same `checkIntegrity()` the earlier conversion used to gate itself.

---

## Files — a defect fixed before the drop

`GET /api/files/[...path]` gains a `record_attachments` ownership check.

Today it checks `expense_attachments`, `income_attachments`, `claim_attachments` and `bank_statements`
only (`api/files/[...path]/+server.ts:37–52`), so a file named only in `record_attachments` falls
through to the `403` on line 65. Every attachment on every ledger record is therefore unreachable,
including ones the earlier conversion moved — it rewrote `record_attachments.filename` to the new
`records/YYYY/MM/…` path while the legacy row kept the old one. `AttachmentManager.svelte:77` links
straight at this route.

FR-014 and FR-039 both already fail, and FR-037 drops three of the four tables this route consults, so
the fix lands **before** the drop and carries a test that fails first (Principle V). The traversal guard
on line 32 and the `bank_statements` permission check on line 58 keep working unchanged.

---

## Import — resource `import`

`POST /api/import/[jobId]/confirm` unchanged in shape and in behaviour. It already names both sides
(`categoryAccountId` plus `paidFromAccountId` or `receivedIntoAccountId`) and already goes through
`createRecord` → `buildMovements`, so FR-035 needs no API change.

Its response keeps `{ id, number, uncategorised }`. The import screen never navigated to the created
record and still does not — there is no link to re-point, which is why FR-027 costs nothing here.

**Behind it, one live defect is fixed**: `import/duplicate-detector.ts:85` reads the `expenses` and
`incomes` tables, so it has been unable to see any record created since the conversion — a silent
failure, and a hard blocker on the drop. It is repointed at `ledger_records` and `ledger_movements`
with its comparison logic unchanged, and with a test that fails first.

---

## Contacts, Quotations, Invoices — unchanged

No endpoint changes. `POST /api/invoices/[id]/issue` still creates its `invoice-issue` record through
`createRecord`, and that record stays read-only through the records API (FR-036, FR-013).

Neither Contacts nor Invoices links to a record's URL today, so neither has a link to re-point.
