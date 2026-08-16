# Contract: HTTP API

**Feature**: `specs/002-double-entry-ledger` | **Date**: 2026-08-15

Every endpoint here follows the app's four mutation obligations (constitution, Development Workflow):
a `hasPermission(locals, resource, action)` check returning `403` on failure, Zod validation of the
request body at the boundary, a `recordAudit` entry, and an SSE emit after the write. Routes parse,
authorise and delegate; the rules live in `$lib/server/services/`.

Shapes reference [data-model.md](./data-model.md) and are not repeated. Money in request and response
bodies is sent as **whole cents** (`amountMinor`, integer) wherever it is a ledger figure, and as the
entered decimal (`amount` + `currency` + `exchangeRate`) wherever it is what the user typed.

Common failures, used by every endpoint below: `400` Zod validation failed (body: `{ error, issues }`),
`401` not signed in, `403` permission denied, `404` not found, `409` a rule refused the write (body:
`{ error, reason }` — the reason is the plain sentence shown to the user).

---

## Accounts — resource `accounts`

### `GET /api/accounts`

View. Query: `role?`, `includeArchived?` (default false).
Returns each account with its derived `type`, its balance in cents, and whether it can be deleted.

```
{ accounts: [{ id, role, type, name, contactId, isSystem, rank, archivedAt,
               balanceMinor, movementCount, canDelete }] }
```

### `POST /api/accounts`

Add. Body: `{ role, name, rank? }`. `contactId` is **rejected** here — only the partner role creates
contact-linked accounts (FR-008a). `409` if `(role, name)` already exists.

### `PATCH /api/accounts/[id]`

Change. Body: `{ name?, rank?, archived? }`. Role cannot change — an account that has been a bank
account cannot become an expense category without rewriting history. `409` on the last remaining
account of a system role.

### `DELETE /api/accounts/[id]`

Delete. `409` when `isSystem` is true or the account has any movement; the body's `reason` is what the
disabled button's tooltip shows (FR-009).

### `PUT /api/accounts/[id]/opening-balance`

Change. Body: `{ date, amountMinor }`. Creates or replaces the account's single opening-balance
record against the Opening balances account (FR-010). `409` if that record is settled or reconciled.

### `GET /api/accounts/[id]/movements`

View. Query: `dateFrom?`, `dateTo?`, `limit?`, `offset?`. The full history of one account with a
running balance (FR-028).

---

## Records — resources `expenses`, `income`, `journal`

One store, but the permission checked depends on `kind`, so the existing screens keep their existing
access rules: `kind = Expense` → `expenses`; `kind = Income` → `income`; `kind = Transfer | Payment |
OpeningBalance` → whichever screen creates it (transfers and payments are checked against `expenses`
for `add`/`change`, since they are recorded from the money-out flows); `kind = Journal` → `journal`.
`InvoiceIssue` records are created only by the invoice endpoints and are read-only here.

### `GET /api/records`

View. Query: `kind?`, `accountId?`, `contactId?`, `categoryId?`, `dateFrom?`, `dateTo?`,
`amountMin?`, `amountMax?`, `paid?` (`true | false`, derived — D-10), `search?`, `limit?`, `offset?`.

```
{ records: [{ id, kind, date, recordNumber, description, contactId, contactName,
              reference, remark, currency, exchangeRate, amount, amountMinor,
              movements: [{ id, accountId, accountName, accountRole, amountMinor }],
              paid, outstandingMinor, locked, lockedReason,
              attachmentCount, createdAt, updatedAt }],
  total }
```

`paid`, `outstandingMinor` and `locked` are computed per request; nothing about them is stored.

### `POST /api/records`

Add. The body describes the record in the everyday terms of whichever screen created it — the API
never asks the caller to construct movements except for a journal entry (FR-020):

```
// expense
{ kind: 'expense', date, description, categoryId, paidFromAccountId | owedToContactId,
  amount, currency, exchangeRate, reference?, remark?, contactId? }
// income
{ kind: 'income', date, description, categoryId, receivedIntoAccountId, amount, ... }
// transfer
{ kind: 'transfer', date, description, fromAccountId, toAccountId, amount, ... }
// payment
{ kind: 'payment', date, description, paidFromAccountId, contactId,
  settlements: [{ owedMovementId, amountMinor }], amount, ... }
// journal — the only shape that names movements directly; needs `journal` add
{ kind: 'journal', date, description, movements: [{ accountId, amountMinor }], ... }
```

Rejections: `409` when the movements do not cancel out (FR-002), when a shared owed account is
touched without a contact (FR-008), when a settlement would exceed what is outstanding (FR-016), or
when `fromAccountId === toAccountId`.

### `GET /api/records/[id]`, `PATCH /api/records/[id]`, `DELETE /api/records/[id]`

`PATCH` accepts the same everyday fields. When the record is settled or reconciled, `amount`, `date`
and any account field are refused with `409` and a reason naming what to undo first — undo the
settlement, or unmatch the bank line (FR-017a). `description`, `contact`, `reference`, `remark` and
attachments stay editable in that state.

`DELETE` is refused with `409` while the record is settled or reconciled.

### `GET /api/records/[id]/attachments`, `POST /api/records/[id]/attachments`, `DELETE /api/records/[id]/attachments/[attachmentId]`

Unchanged in behaviour from today's per-kind endpoints; one set now serves every record. Files land
in `records/YYYY/MM/` (D-16). `GET` exists because a record's list response carries only
`attachmentCount` — the drawer needs the attachments themselves when it opens, and putting them on
every row of every list to save one request would be the wrong trade.

Attachments stay editable on a settled or reconciled record: a receipt is a supporting document, not
accounting data, and adding a missing one cannot make any other record wrong (FR-017a).

### `GET /api/records/[id]/settlements`

View, against the record's own kind. Returns the settlements touching either side of this record —
what paid it, or what it paid off — as the "list of many" the detail drawer renders (FR-018).

```
{ links: [{ settlementId, amountMinor, createdAt,
            otherRecordId, otherRecordNumber, otherDate, otherDescription, otherKind }] }
```

Separate from `GET /api/settlements`, which answers a different question: that one lists what is
still *outstanding* so a payment can be allocated against it, while this one lists what has already
been settled against one record. Neither answer contains the other.

The existing `/api/expenses/**`, `/api/income/**` and their attachment routes remain as thin wrappers
that set `kind` and delegate, so nothing outside the app that calls them breaks. `/api/claims/**` is
removed (FR-036a).

---

## Settlements — resource `expenses` (add / delete)

### `GET /api/settlements`

View. Query: `contactId?`, `direction` (`owed-to-us | we-owe`), `openOnly?`.
Returns the outstanding items a payment can be allocated against, and the ageing bands User Story 6
displays.

```
{ items: [{ movementId, recordId, recordNumber, date, dueDate, description,
            contactId, contactName, amountMinor, settledMinor, outstandingMinor, daysOverdue }],
  totalOutstandingMinor }
```

### `POST /api/settlements`

Add. Body: `{ paymentMovementId, allocations: [{ owedMovementId, amountMinor }] }`.
`409` when an allocation exceeds what is outstanding, when the two movements are on different
accounts, or when they belong to different contacts. The `reason` states the figure still available
(FR-016).

### `DELETE /api/settlements/[id]`

Delete. Undoes one allocation; both sides return to outstanding, and any field the settlement was
locking becomes editable again (FR-017).

---

## Reconciliation — resource `reconciliation` (existing endpoints, changed shapes)

- `POST /api/reconciliation/statements` gains a required `accountId` (FR-021).
- `PATCH /api/reconciliation/statements/[id]` accepts `accountId` so a statement can be reassigned
  (FR-034a).
- Candidate and allocation payloads replace `{ itemType, itemId }` with `{ movementId }` (D-11).
  Candidates are movements on the statement's account only; nothing from another account is ever
  returned (SC-005).
- `POST /api/reconciliation/lines/[lineId]/transfer` — **new**. Turns an unmatched line into a
  transfer between two accounts the user holds, pre-filled from the line, and matches it in the same
  action (FR-023). Body: `{ otherAccountId, description? }`. Creates the record, its two movements
  and the allocation in one transaction, then emits on both streams.

Partial and many-to-many allocation behaviour is unchanged (FR-022), as is the rule that reconciling
never alters a record (FR-024).

---

## Reports — resource `reports` (view only)

Every report accepts `format=json` (default) or `format=csv` (FR-029). Every response carries a
`notes` array; a report covering a period before the app began tracking what customers owe includes
the plain sentence FR-030 requires, rather than implying complete history.

| Endpoint | Query | Returns |
|---|---|---|
| `GET /api/reports/profit-loss` | `dateFrom`, `dateTo` | Income and expense lines by category account, and the net result (FR-025) |
| `GET /api/reports/balance-sheet` | `asAt` | What's owned, what's owed, what the owners have in it, plus the accumulated result carried forward, and a `balances: true\|false` flag with the difference if it is ever false (FR-026) |
| `GET /api/reports/partner-statement` | `dateFrom`, `dateTo` | One block per contact holding the Partner role: contributions, share of the result, drawings (FR-027) |
| `GET /api/reports/account-history` | `accountId`, `dateFrom?`, `dateTo?` | Every movement with a running balance (FR-028) |

`GET /api/ledger/integrity` — view on `reports`. Runs the whole-books check and returns
`{ ok, recordsChecked, unbalancedRecords: [{ recordId, differenceMinor }], totalDifferenceMinor,
elapsedMs }` (FR-003, SC-002).

---

## Invoices — resource `invoices` (changed)

- `POST /api/invoices/[id]/issue` — **new**. Body: `{ incomeAccountId? }`, defaulting to the seeded
  Sales income account. Moves the invoice to Sent and creates the ledger record putting its amount
  into Money owed to us, tagged with the customer (FR-018a). `409` if already issued.
- Invoice responses replace the stored `amountPaid` with derived `paidMinor` / `outstandingMinor`,
  and add `paid` (D-10).
- A customer's payment is an ordinary payment record settling the invoice's Receivable movement — no
  invoice-specific endpoint (FR-018a).

---

## Import — resource `import` (changed)

- `import_queue` gains `account_id`; the review screen offers which account paid or received, with
  the default account pre-selected (FR-019, FR-011).
- The confirm endpoint creates a ledger record instead of an `expenses`/`incomes` row. Its response
  keeps the same shape, with `resultId` now a ledger record id.
- A confirmed record whose category could not be determined lands on **Uncategorised** and is flagged
  in the response, never rejected (spec edge case).

---

## Contacts — resource `contacts` (changed)

- `PUT /api/contacts/[id]/roles` accepts the new Partner role. Granting it creates that contact's
  capital and drawings accounts; removing it archives them when they hold movements and deletes them
  when they do not (FR-008b).
- `DELETE /api/contacts/[id]` returns `409` when any record names the contact, with the reason the
  disabled button's tooltip shows; archiving is offered instead (FR-009a).
