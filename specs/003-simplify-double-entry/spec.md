# Feature Specification: One Ledger, One Records Screen, One Flat Account List

**Feature Branch**: `003-simplify-double-entry`

**Created**: 2026-08-17

**Status**: Draft

**Input**: User description: "Previously we have changed the software to double entry, but i feel that currently the features, pages, modules seems abit messy as we still have income, expenses, accounts, it feels more complex, why not we make it solely for double entry, remove income/expenses/claim, and make accounts page single level list, then we can make things simpler. Please review the entire feature set and propose"

---

## Glossary

Plain meanings for the handful of words this document has to use more than once (Principle VII).

| Term | Plain meaning |
|---|---|
| **Record** | One thing that happened with money — a purchase, a sale, a payment, moving money between your own accounts. |
| **Side** | One half of a record: which account money came out of, or which account it went into. Every record has at least two sides, and they always cancel out. |
| **Account** | Any bucket a record's side can point at: a bank account, a wallet, a category like "Fuel", "Money we owe", a partner's stake. |
| **Category** | An account that says *what* money was spent on or earned from, rather than *where* money sits. There is no separate "category" thing in the data — it is just an account with a category role. |
| **Money pot** | An account where money actually sits — bank, wallet, cash, card. |
| **Kind** | The label a record carries saying what sort of event it was (money out, money in, moved between own accounts, payment, entered by hand, issued invoice). |
| **Settled / outstanding** | How much of a record that was bought or sold on credit has since been paid off, and how much is still owed. Worked out from payments, never stored. |
| **Locked** | A record that can no longer have its amount, date, or accounts changed because a payment or a bank match already depends on it. |

---

## Review of the Current Feature Set

This is the "review the entire feature set" the request asked for. It is the evidence behind
the proposal, and it is recorded here so the proposal can be argued with.

### What is genuinely duplicated today

| # | Observation | Why it makes the product feel complex |
|---|---|---|
| 1 | **Three screens read from one store.** Expenses, Income and Journal are all filtered views of the same record store. Expenses and Income are backed by literally the same loader and differ in three expressions; Journal is a third screen over the same rows. | A user learning the app is asked to learn three places to look for something that is one list. Finding a record means guessing which screen it is on before searching. |
| 2 | **Two screens manage the same account rows.** Categories are accounts. They can be created and renamed on the Accounts screen *and* on Settings → Category. | Two doors to one room, with different behaviour behind each (Settings stages edits until Save; Accounts saves immediately). |
| 3 | **The Accounts screen has six section headers** ("Where the money is", "What the business owns", "Owed either way", "The owners", "Expense categories", "Income categories"). | A list of maybe twenty rows is broken into six labelled boxes, so scanning for a name means scanning six times. Grouping is presented as structure when it is really just a sort. |
| 4 | **Permissions carry the old shape.** There are separate `expenses` and `income` permissions, and transfers, payments and opening balances are checked against `expenses` "because that is the screen they are recorded from" — a screen that this change removes. | Whoever grants access has to know that "expenses" secretly also means transfers and opening balances. That is a rule nobody can guess. |
| 4a | **`journal` is deliberately granted to nobody** because hand-entering both sides is how books can be made to say anything. | This is a real control, and it is the one thing that makes merging the three screens non-trivial. It is kept, as an ability rather than a screen — see D-02. |
| 5 | **Two record APIs.** `/api/records` already serves every kind, yet `/api/expenses`, `/api/income` and their two live-update streams still exist alongside it, plus a third stream for Journal. | Three live connections and three endpoints where one would do, and every future record change has to be made in each. |
| 6 | **Claims are already gone as a feature, but their remains are not.** There is no claims screen and no claims route. What survives is legacy: the `claims`, `expenses` and `incomes` tables (and their attachment and search tables), the `categories` table (documented as deprecated and unread), and the `ExpenseStatus`, `ClaimStatus` and `DocumentType` code lists. | Anyone reading the data model sees tables that look live and are not. This is dead weight, not a working feature. |
| 7 | **Eleven items in the main navigation**, one of which (Journal) is invisible to everyone by default. | The list is long enough that the busy items do not stand out. |
| 8 | **Two answers to "show me everything for this account."** A full-page account history (one row per side, with a running balance) and the record list's own account filter (one row per record). | The same duplication as items 1 and 2, one level down: two screens, two row meanings, for one question. Settled by D-05. |
| 9 | **Reconciliation is already per-account everywhere except in the menu.** A statement belongs to exactly one account, and only movements on that account are ever offered as matches for its lines — yet it is reached from a top-level menu item, and uploading has to ask which account the statement is for. | The account is where someone asks "does this match my bank?", and it is the one place the answer is not. Settled by D-06. |
| 10 | **Two columns kept "unread for one release"** on the reconciliation allocation table, from the release that repointed bank matches at movements. That release has passed. | More of item 6: fields that look live and are not. |

### What is NOT messy, and is deliberately kept

Stating this matters as much as the list above, because the risk in a simplification is
throwing away a distinction that was earning its place.

- **The underlying store is already right.** One record store, two-or-more sides per record, money as whole cents, nothing about payment state stored. None of that changes here. This feature changes *surfaces*, not the ledger.
- **The friendly entry forms are the reason the app is usable.** "What was it for / who paid for it" is what a non-accountant can answer. Turning every entry into a debit-and-credit grid would be a step backwards, which is why D-01 keeps the everyday wording.
- **Kinds still do real work internally.** Payments drive settlement; issued-invoice records are read-only; opening balances anchor an account. Kind stops being a *screen* here; it does not stop being a *fact about a record*.
- **Quotations, Invoices, Contacts, Auto Import, Reports, Dashboard are not duplicates of anything** and are out of scope for removal. Their links into records are re-pointed, nothing more.
- **Reconciling is not a duplicate either, and is not being removed** — it moves to the account it already belongs to (item 9 above, D-06). The account history page is the one thing genuinely merged away, into the record list's account filter (item 8, D-05).
- **Reports keep the words "income" and "expenses".** They are the names of what a profit and loss is made of, and they are the terms that must appear. Removing the *screens* does not remove the *categories*.

### The proposal in one paragraph

Collapse the three record screens into one **Records** screen — one list, one search, one set
of filters, one drawer for reading and writing — and collapse the six-section Accounts screen
into one flat searchable list that is also the only place accounts and categories are managed.
Retire the duplicate record endpoints and streams in favour of the one that already exists,
fold the record permissions into one, and retire the addresses of the removed screens outright.
Nothing about how money is recorded in the ledger changes.

### Before and after

| Today | After |
|---|---|
| Expenses screen, Income screen, Journal screen | One **Records** screen |
| Accounts screen with 6 section headers | **Accounts** — one flat list, searchable, with a filter for what kind of account |
| Categories editable in Settings → Category *and* on Accounts | Categories editable **only** on Accounts (they are accounts) |
| Permissions: `expenses`, `income`, `journal` | One `records` permission, plus one narrow ability that unlocks the full account list and a third side (D-02) |
| `/api/expenses`, `/api/income`, `/api/records` + 3 streams | `/api/records` + 1 stream |
| 11 navigation items | 8 navigation items |
| Reconciliation is a top-level menu item; uploading asks which account | Reconciling is done from the account, which is already the only account its statement can match against (D-06) |
| A cross-account "still needs clearing" tab inside Reconciliation | A "not yet cleared" filter on Records, where that fact already lives (D-06) |
| Legacy `claims` / `expenses` / `incomes` / `categories` tables still present | Removed outright (D-03) |
| A form per kind of record | One form, both sides always named in everyday words (D-01) |
| An account's history is a separate full page, plus a Records account filter | One statement view: Records narrowed to that account, with a running balance (D-05) |

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Everything that happened, in one list (Priority: P1)

Someone wants to find a record. Today they must first decide whether it was an expense, an
income, or something typed in by hand, and open the matching screen. After this change they
open **Records**, and every record the business has is there — newest first — with one search
box and filters for what kind it was, which account it touched, who it was with, when, how
much, and whether it is still owed. Opening a row opens the same drawer regardless of what the
record is.

**Why this priority**: This is the request. It removes two screens' worth of concepts and is
the only story that must ship for the product to feel simpler; every other story is cleanup
around it.

**Independent Test**: With Expenses and Income removed from the navigation, a user can find a
purchase from three months ago, a sale, and a transfer between two bank accounts from the one
Records screen, and open each one, without visiting any other page.

**Acceptance Scenarios**:

1. **Given** the books hold purchases, sales, transfers, payments and hand-made entries, **When** the user opens Records with no filter set, **Then** all of them appear in one list ordered newest first, each showing its date, description, the accounts it moved money between, its amount, and whether it is settled.
2. **Given** the user is on Records, **When** they filter to "money in", **Then** only records that increased an income category appear, and the URL reflects the filter so it can be shared or bookmarked.
3. **Given** the user searches for a supplier's name, **When** results return, **Then** matching records of every kind appear together, not split by kind.
4. **Given** a record is open in the drawer, **When** the user copies the address bar and opens it in a new tab, **Then** the same record opens.
5. **Given** a record is locked because a payment or bank match depends on it, **When** the user opens it, **Then** the amount, date and account fields are not editable and the drawer says in one plain sentence what must be undone first.

---

### User Story 2 - One way to write a record (Priority: P1)

Someone records what happened. There is one "New record" action on the Records screen, and one
form. The form always names both sides in everyday words — where the money came from and where
it went — so a purchase, a sale, a transfer and a repayment are all entered the same way, and
nobody has to pick a screen before they can start typing.

**Why this priority**: Ships with US1 — a single list with three different "add" buttons behind
it would not be simpler. It is listed separately because it is the half of the change that
carries real risk: the entry form is what makes the app usable by a non-accountant, and this is
where simplification could do harm.

The form keeps everyday wording (decision D-01). Each side asks which account, and whether
money went into it or out of it. By default the account picker offers the accounts that side
would sensibly be — categories on the "what for" side, places money sits on the "where from"
side — so the everyday case stays a two-field answer, while the full list is one step away for
the cases that need it (see US6 and D-02).

**Independent Test**: A user records a fuel purchase paid from the bank, a sale received into
the bank, and a transfer between two of their own accounts, using the same form each time, and
all three appear correctly on the Records list and in the reports.

**Acceptance Scenarios**:

1. **Given** the user opens "New record", **When** they name a date, an amount, a description, an account the money came out of and an account it went into, **Then** the record saves and both sides balance.
2. **Given** the two sides do not add up, **When** the user tries to save, **Then** the form refuses with a plain sentence saying by how much it is out, and nothing is written.
3. **Given** someone else paid for a purchase, **When** the user names that person and chooses "Money we owe" as the paying side, **Then** the record saves as owed to that person and shows as outstanding.
4. **Given** a record needs more than two sides, **When** the user adds a third line, **Then** the running difference is shown live and the record saves once it reaches zero.
5. **Given** the user has permission to view but not to add, **When** they open Records, **Then** no "New record" action is offered and the server refuses a direct attempt.
6. **Given** the user is entering an everyday purchase, **When** they open the account picker on either side, **Then** the accounts that side would sensibly be are offered first, and the full list of accounts is reachable in one step.
7. **Given** a side names an account for money owed either way, **When** the user tries to save without naming who it is owed to or by, **Then** the form refuses with that plain sentence.

---

### User Story 3 - One flat list of accounts (Priority: P1)

Someone wants to see or change an account. The Accounts screen is one list — every account,
one row each, showing its name, what sort of account it is, and its balance. No section
headers. A search box narrows by name and a filter narrows by what sort of account it is.
Categories are in that list, because a category is an account.

**Why this priority**: Explicitly requested, and it is small and self-contained — it can ship
before or after US1 without either blocking the other.

**Independent Test**: With no grouping headers on screen, a user finds a bank account, an
expense category and a partner's account from the one list, using search, and opens each.

**Acceptance Scenarios**:

1. **Given** the books hold accounts of every sort, **When** the user opens Accounts, **Then** they see one flat list with no section headings, sorted in a stable, predictable order.
2. **Given** the user types part of an account name, **When** the list narrows, **Then** matching accounts of every sort appear together.
3. **Given** the user filters to "categories", **When** the list narrows, **Then** only category accounts appear.
4. **Given** an account holds a balance below zero that should not, **When** the user views the list, **Then** the same plain explanation shown today is still shown.
5. **Given** the user opens an account, **When** the drawer opens, **Then** it is the same drawer as today, including its opening balance.
6. **Given** the account drawer is open, **When** the user follows its "see every movement" card, **Then** the Records list opens narrowed to that account, showing a running balance (decision D-05).

---

### User Story 4 - Categories are managed in one place (Priority: P2)

Someone adds a new spending category. They do it on the Accounts screen, where every other
account is created. The Category tab disappears from Settings, and with it the second,
differently-behaved way to do the same job.

**Why this priority**: Removes a real duplicate, but the product still works if it lands after
US1–US3.

**Independent Test**: A user creates, renames and retires a spending category entirely from the
Accounts screen, and Settings no longer offers a Category tab.

**Acceptance Scenarios**:

1. **Given** the user is on Accounts, **When** they add an account of the category sort, **Then** it is immediately available as a side on the Records form.
2. **Given** a category already has records against it, **When** the user retires it, **Then** it is archived rather than deleted, its history survives, and it stops being offered on new records.
3. **Given** the user opens Settings, **When** the tabs render, **Then** there is no Category tab, and no wording anywhere implies categories are managed there.

---

### User Story 5 - Nothing inside the app points at a screen that is gone (Priority: P2)

Every link the app draws for itself — from the Dashboard, reconciling, Reports, Invoices,
Auto Import and Contacts — points at the Records screen. Addresses that belonged to the removed
screens are retired outright rather than redirected (decision D-04).

**Why this priority**: In-app links are the ones the app is responsible for. If one of them
points at a removed screen the app is broken, which is different from an old bookmark someone
kept.

**Independent Test**: Every link into a record, from every screen that draws one, opens that
record on the Records screen; no screen still links to a retired address.

**Acceptance Scenarios**:

1. **Given** any screen that links to a record, **When** the user follows that link, **Then** the record opens on the Records screen.
2. **Given** a saved mobile-navigation preference naming a removed screen, **When** the user opens the app, **Then** they get a working navigation without having to fix it themselves.
3. **Given** a retired address is requested, **When** the server answers, **Then** it may answer as not-found; nothing in the app is required to keep it working.

---

### User Story 6 - One permission for records (Priority: P2)

Whoever administers access grants "Records" instead of guessing that "expenses" also silently
covers transfers, payments and opening balances.

Alongside it, one narrower ability survives from today's by-hand screen. It unlocks two things
on the one form: picking from the **full** list of accounts rather than the sensible shortlist,
and adding a **third or later side**. Like the by-hand screen it replaces, no seeded group has
it — it is granted deliberately or not at all (decision D-02).

**Why this priority**: A correctness and comprehensibility win. The narrower ability is what
keeps a real control from being lost in the merge: with the full account list, a record can be
written between any two accounts — a debt reduced and reappearing as owner capital, a figure
moved between categories after year-end — with no event behind it. The books still balance;
they just stop being true.

**Independent Test**: An administrator grants a group the ability to view and add records, and
that group records everyday purchases, sales, transfers and payments — and is not offered the
full account list or a third side until the narrower ability is granted too.

**Acceptance Scenarios**:

1. **Given** a group with view-only access to records, **When** a member opens Records, **Then** they can read every kind of record — including ones written with the full account list — and are offered no create, edit or delete action.
2. **Given** a group with no records access, **When** a member requests a record address directly, **Then** the server refuses.
3. **Given** existing groups and users set up under the old permissions, **When** the change is applied, **Then** their effective access to records is unchanged unless an administrator changes it.
4. **Given** a user who may add records but has not been granted the narrower ability, **When** they open the form, **Then** each side offers only its sensible shortlist, no "add another side" action is offered, and the server refuses a request that names an account outside that shortlist or carries a third side.
5. **Given** a user who held the by-hand ability before the change, **When** the change is applied, **Then** they hold the narrower ability afterwards and lose nothing.
6. **Given** an administrator setting up a group from scratch, **When** they review its abilities, **Then** the narrower ability is off, and its description says in plain words what granting it allows.

---

### User Story 7 - The remains of the old shape are cleared away (Priority: P3)

Someone reading the data model or the code no longer finds tables and code lists for features
that do not exist. The old claim, expense and income tables, their attachment and search
tables, the deprecated categories table and the code lists that went with them are removed
outright (decision D-03).

**Why this priority**: Pure maintenance. It changes nothing a user sees, and it carries the
highest risk of the whole feature because it removes stored data on self-hosted installations.

**Independent Test**: After the change, the whole-books check still passes, every figure on
every report is identical to before, and every attachment still opens.

**Acceptance Scenarios**:

1. **Given** the books before the change, **When** the change is applied, **Then** the profit and loss, balance sheet and every account balance produce identical figures.
2. **Given** an installation whose records have already been converted into the one store, **When** the change is applied, **Then** the retired tables are removed and nothing that a screen, a report or a link depends on is lost.
3. **Given** an installation whose conversion has not run or did not complete, **When** the change is applied, **Then** nothing is removed and the installation is told plainly what to finish first.
4. **Given** the removal has run, **When** the whole-books check runs, **Then** it passes; if it does not, the release notes tell the user to restore from their own backup.
5. **Given** a user is about to upgrade, **When** they read the release notes, **Then** the notes state before anything else that this release removes data permanently and that they must back up first.

---

### User Story 8 - Checking an account against its bank statement, from the account (Priority: P2)

Someone has their bank statement and wants to know whether the books agree with it. They open
that account and reconcile there — upload the statement, match its lines against the account's
records, see what is left over. The account never has to be named, because an account's
statement can only ever be matched against that same account's records, which is already how it
works.

The top-level Reconciliation menu item goes. The one thing it had that was not about a single
account — the list of everything still waiting to be cleared, across every account — becomes a
filter on Records, where whether a record has been cleared already lives.

**Why this priority**: Removes a menu item and takes a question to the place it is asked. It is
P2 rather than P1 because reconciling still works today; nothing is broken until it moves.

**Independent Test**: With no Reconciliation item in the menu, a user opens a bank account,
uploads that account's statement, matches its lines, and finishes the statement — and can still
see everything awaiting clearing across all accounts from the Records screen.

**Acceptance Scenarios**:

1. **Given** the user opens a money-holding account, **When** the drawer opens, **Then** it offers reconciling that account, showing whether anything is part-way through.
2. **Given** the user starts reconciling an account, **When** they upload a statement, **Then** they are not asked which account it is for, and the statement is filed against that account.
3. **Given** a statement is being matched, **When** candidate records are offered, **Then** only records that touched that account are offered, exactly as today.
4. **Given** the user is matching, **When** they work, **Then** they have a full-width working surface with bank lines, candidate records and their selection visible together, at its own shareable address.
5. **Given** an account that money never sits in — a category, or what the owners have in it — **When** its drawer opens, **Then** no reconciling is offered.
6. **Given** records across several accounts are not yet cleared, **When** the user filters Records to "not yet cleared", **Then** all of them appear regardless of account, and each can be opened.
7. **Given** a statement was filed against the wrong account, **When** the user opens it from the account it is filed against, **Then** they can still move it to the right one.
8. **Given** a statement that predates the change and has no account, **When** the user reconciles, **Then** it is surfaced somewhere reachable and can be assigned to an account rather than being lost.
9. **Given** a user with no reconciliation ability, **When** they open an account, **Then** no reconciling is offered and the server refuses a direct attempt.

---

### Edge Cases

- **A record with more than two sides in a compact list.** The Records list shows an account on each side of a row; a hand-made entry with five sides has no single pair. The row must say how many sides it has rather than picking two arbitrarily.
- **A record whose kind has no everyday name.** Issued-invoice records appear in the list but are created only by the Invoices screen and cannot be edited from Records; the drawer must say so and offer the invoice instead.
- **Payments in the list.** A payment settles other records. Shown in the one list it needs to make clear what it settled, and it must remain impossible to edit a payment into imbalance.
- **A filter that empties the list.** Filtering to a kind that has no records must show an empty state that says which filter caused it, not "you have no records".
- **A running balance that would lie.** Narrowing to one account and then also searching, or sorting by amount, leaves the rows incomplete or out of order. The balance column must disappear rather than show a figure that does not add up, and the screen must say why it went.
- **One record touching the same account twice** — possible on an entry with three or more sides. In the statement view it appears once per side; everywhere else it is one row.
- **A statement filed against no account at all.** Possible only for statements that predate the earlier conversion. With reconciling reached from an account, such a statement belongs to none, so it must be surfaced somewhere it can be found and assigned — not silently unreachable.
- **A statement filed against the wrong account.** It is reachable from the account it is filed against, not the one it should be, so the move-it action must survive the relocation.
- **Reconciling an account with no statement uploaded yet**, and an account that has never been reconciled, must both read as a normal starting state rather than as something missing.
- **A part-finished reconciliation** must be visible from the account as unfinished, since there is no longer a top-level list where it would be noticed.
- **A very long account list.** With categories in the same flat list, an established set of books may run to a hundred rows; the list must stay usable by search rather than assuming the user scrolls.
- **An archived account.** Archived accounts must stay findable in the flat list behind a toggle, because their history still exists, but must not be offered on a new record.
- **Two accounts with the same name in different roles.** With sections gone, "Fuel" the category and "Fuel" a hypothetical wallet are adjacent; each row must show what sort of account it is so they can be told apart.
- **An in-flight import awaiting review** when the change lands: it must still be confirmable into a record.
- **A user whose mobile navigation preference names a removed screen** must land on a working navigation, not an empty bar.
- **Someone on the Records screen when another user deletes the record they have open** must have the drawer close cleanly, as it does today.

---

## Requirements *(mandatory)*

### Functional Requirements

**The Records screen**

- **FR-001**: The system MUST provide one Records screen listing every record in the store, of every kind, ordered newest first.
- **FR-002**: The Records list MUST offer, in one place: free-text search, and filters for kind, account, contact, date range, amount range, and whether a record is still outstanding.
- **FR-003**: Each row MUST show the record's date, description, the accounts it moved money between (or the number of sides when there are more than two), its amount, and its settled state.
- **FR-004**: Every record MUST remain reachable at its own shareable address, and opening that address MUST open that record's drawer over the Records list.
- **FR-005**: The Records screen MUST receive live updates over one connection, replacing the three separate live connections in use today.
- **FR-006**: Records MUST be created, read, updated and deleted through the one record interface already serving every kind; the duplicate expense-only and income-only interfaces MUST be retired.
- **FR-007**: The system MUST NOT present separate Expenses, Income or Journal screens in navigation.

**Writing a record**

- **FR-008**: The system MUST offer one form for creating a record, naming both sides in everyday words rather than accounting terms. There MUST NOT be a separate form per kind of record.
- **FR-008a**: On each side, the account picker MUST offer the accounts that side would sensibly be — categories for what a record was for, places money sits for where it came from or went — and MUST make the full list of accounts reachable in one step, subject to FR-031.
- **FR-009**: The form MUST refuse to save a record whose sides do not cancel out, and MUST state by how much it is out.
- **FR-010**: The form MUST support a record with more than two sides, showing the running difference as lines are added.
- **FR-011**: The form MUST continue to support recording that someone else paid, so the record reads as owed to that person.
- **FR-012**: A record that a payment or a bank match depends on MUST continue to refuse changes to its amount, date and accounts, with the same plain explanation given today.
- **FR-013**: Records created by another screen and not editable from Records — an issued invoice's record — MUST be shown as read-only with a link to the screen that owns them.
- **FR-014**: Attachments and the record's history of changes MUST remain available on every record, exactly as today.

**Accounts**

- **FR-015**: The Accounts screen MUST present one flat list, with no section headings, of the
  accounts that **hold or owe money** — where money sits, what is owed either way, what the
  business owns, and what the owners put in. Categories MUST NOT appear on it.

  *Amended twice.* The original required one flat list over **every** account, and it was
  explicitly requested. It was then narrowed to one ledger at a time. Neither survived contact
  with real data: this installation holds 22 categories against 4 accounts that hold or owe
  money, so any list containing both reads as nothing but categories. The split is the
  balance-sheet / income-statement line every accounting system already draws.

- **FR-016**: Each account row MUST show its name, what sort of account it is, and its balance, shown the way round a reader expects.
- **FR-017**: The Accounts screen MUST offer search by name and a filter by sort of account.
- **FR-018**: Categories MUST have their own screen, reached from the Accounts screen and from
  Settings, and MUST be rendered there exactly like any other account row — same shape, same
  balance, no special casing.

  *Amended with FR-015.* A category is still an account underneath (002 FR-006a); what changed
  is only which screen shows it. The record form still offers accounts and categories together,
  because both are sides of a record.

- **FR-019**: There MUST be exactly one place each kind is created, renamed and archived: the
  Accounts screen for accounts that hold or owe money, the Categories screen for categories.
  Both MUST go through the same accounts service, so the two screens can never behave
  differently. *(Amended with FR-015/FR-018; the rule that there is only one place is
  unchanged.)*
- **FR-020**: The Settings screen MUST NOT offer a Category tab, and no wording anywhere may
  imply categories are managed in Settings. A plain link out to the Categories screen is
  permitted and is not a management surface.
- **FR-021**: Archiving an account that already has records against it MUST preserve its history and stop it being offered on new records; deleting an account holding records MUST remain refused with a plain reason.
- **FR-022**: The account drawer and its opening balance MUST be unchanged. Its "see every movement" card MUST lead to the Records list narrowed to that account (FR-040).

**Navigation and links**

- **FR-023**: Main navigation MUST list Dashboard, Records, Accounts, Contacts, Quotations, Invoices, Auto Import and Reports. It MUST NOT list Reconciliation, which is reached from an account (FR-048).
- **FR-024**: The count of outstanding records currently shown against Expenses MUST move to Records.
- **FR-025**: The addresses of the removed screens — the expense, income and journal lists and their record addresses — MUST be retired outright. No redirect is required (D-04).
- **FR-025a**: The look-up that resolves a record address written before the earlier conversion MUST be removed with them, since nothing depends on those addresses any more.
- **FR-026**: A saved mobile-navigation preference naming a removed screen MUST resolve to a working navigation without the user intervening.
- **FR-027**: Every screen that links to a record — Dashboard, the matching surface, Reports, Invoices, Auto Import, Contacts — MUST link to it on the Records screen.

**Permissions**

- **FR-028**: The separate abilities to work with expenses and with income MUST be replaced by one ability covering records of every kind.
- **FR-029**: Applying this change MUST NOT alter any existing user's or group's effective access; whatever they could do before, they can do after.
- **FR-030**: Every interface that reads or changes a record MUST check the records ability and refuse without it. Reports MUST remain view-only.
- **FR-031**: Reaching the full list of accounts on a side (FR-008a) and adding a third or later side (FR-010) MUST both be gated by one ability of their own, separate from the records ability.
- **FR-031a**: No seeded group MUST hold that ability, and it MUST be off by default on a newly created group, so it is granted deliberately or not at all.
- **FR-031b**: Anyone who held the by-hand ability before the change MUST hold the narrower ability after it, and MUST lose nothing.
- **FR-031c**: The gate MUST be enforced on the server, not by hiding the controls: a request naming an account outside a side's shortlist, or carrying a third side, MUST be refused without the ability.
- **FR-031d**: Reading a record written with the full account list MUST need only the records view ability — the gate is on writing, never on seeing.
- **FR-031e**: Where an administrator grants abilities, this one MUST carry a plain description of what it allows.

**Everything that reads records**

- **FR-032**: The Dashboard MUST continue to show the same money-in and money-out figures, computed as today from the category accounts, with its links pointing at Records.
- **FR-033**: Every report MUST produce figures identical to those produced before the change, and MUST keep using the words income and expenses for what a profit and loss is made of.
- **FR-034**: Reconciling MUST continue to match bank lines against records of every kind, against the same account rule it uses today; only where it is reached from changes (FR-048–FR-055).
- **FR-035**: The Auto Import review step MUST continue to produce a correct record from a scanned document, naming both of its sides.
- **FR-036**: Invoices and Quotations MUST be unaffected, and an issued invoice MUST continue to produce its record.

**Clearing the remains**

- **FR-037**: The stored tables and code lists belonging to features that no longer exist — the old claim, expense and income tables, their attachment and search tables, the deprecated categories table, and the code lists for expense status, claim status and document type — MUST be removed.
- **FR-037b**: The two columns on the reconciliation allocation table kept unread for one release, from the change that repointed bank matches at movements, MUST be removed with them; that release has passed.
- **FR-037a**: The removal MUST run only on an installation whose records have already been converted into the one store. Where the conversion has not run or did not complete, nothing MUST be removed and the installation MUST say plainly what to finish first.
- **FR-038**: The release MUST state, before anything else in its notes, that it permanently removes data and that the user must back up first. Taking that backup is the user's responsibility (decision D-03); the system MUST NOT silently rely on being able to undo the removal.
- **FR-038a**: The whole-books check MUST pass after the removal.
- **FR-039**: No figure on any report, and no attachment, may change as a result of clearing the remains.

**An account's own records — the statement view**

- **FR-040**: The Records list narrowed to exactly one account MUST serve as that account's statement, and MUST be reachable from the account drawer and at its own shareable address.
- **FR-041**: In that view the list MUST show, for each row, that account's own side of the record and a running balance, plus an opening figure before the first row and a closing figure after the last.
- **FR-042**: A record that touches the narrowed account more than once MUST appear once per side, so the running balance adds up.
- **FR-043**: The running balance, the opening figure and the closing figure MUST be shown only while the rows are complete and in date order — that is, when the account and an optional date range are the only filters applied. Any other filter, or any other sort, MUST hide them rather than show a figure that does not add up.
- **FR-044**: The view MUST offer the same export the separate history page offers today, covering the rows in view.
- **FR-045**: Where not every movement is shown, the view MUST say how many of how many it is showing, as the history page does today.
- **FR-046**: The separate full-page account history MUST be retired, and the statement view MUST be gated on the records ability rather than the reports ability (D-05).
- **FR-047**: Reports that link to an account MUST link to its statement view.

**Reconciling, from the account**

- **FR-048**: Reconciling MUST be reached from an account, and MUST NOT be a main navigation item.
- **FR-049**: Reconciling MUST be offered only on accounts where money actually sits, and MUST NOT be offered on a category or on what the owners have in it.
- **FR-050**: Uploading a statement from an account MUST NOT ask which account it is for; the account it was started from MUST be the one it is filed against.
- **FR-051**: The rule that only records touching a statement's own account are offered as matches MUST be unchanged.
- **FR-052**: The matching surface MUST remain a full-width working surface showing bank lines, candidate records and the current selection together, at its own shareable address. It MUST NOT be squeezed into the account drawer.
- **FR-053**: An account MUST show whether a reconciliation is part-way through, since there is no longer a top-level list where an unfinished one would be noticed.
- **FR-054**: Moving a statement to a different account MUST still be possible, reached from the account it is currently filed against.
- **FR-055**: A statement filed against no account MUST be surfaced somewhere a user can find and assign it.
- **FR-056**: Records MUST offer a "not yet cleared" filter covering every account, replacing the cross-account list inside the old reconciliation screen. Reconciling itself MUST NOT be startable from that filter — it is a worklist, not a second way in.
- **FR-057**: Reconciling MUST keep its own ability, separate from the records and accounts abilities; only its location changes, not who may do it.

### Key Entities

No new stored entity is introduced. The change is to how existing ones are presented.

- **Record**: unchanged. Still one row per thing that happened, carrying its kind, date, description, contact, the figure as typed, and its locked exchange rate.
- **Side (movement)**: unchanged. Still one row per account touched, positive into and negative out of, always summing to zero across a record.
- **Account**: unchanged in the data. Presented flat rather than grouped, and now including categories in the same list. Its sort is still worked out from its role and never stored.
- **Records ability (permission)**: replaces the separate expense and income abilities, covering records of every kind.
- **Free-choice ability (permission)**: replaces the by-hand ability. Unlocks the full account list on a side and a third or later side. Held by no seeded group (D-02).
- **Retired legacy tables**: the old claim, expense and income tables, their attachment and search tables, and the deprecated categories table. Already unread, and removed by this feature (D-03).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user finds any record — of any kind — from one screen, without first choosing which screen it lives on. The number of screens a record can live on drops from 3 to 1.
- **SC-002**: The number of main navigation items drops from 11 to 8, and the number of places an account or category can be edited drops from 2 to 1.
- **SC-003**: Every figure on the profit and loss, the balance sheet, the partner statement and every account balance is identical before and after the change — verified by comparing the same reports over the same dates.
- **SC-004**: The whole-books check passes after the change, with every record's sides summing to zero and the books summing to zero overall.
- **SC-005**: No screen in the app links to a retired address; every in-app link into a record opens it on the Records screen.
- **SC-006**: Every existing user's and group's effective access is unchanged, verified account by account.
- **SC-007**: A person who has not used the app before records a purchase paid from the bank, and a sale received into it, from the one form on their first attempt, without being told which screen to use.
- **SC-008**: Finding a named account among a hundred takes one search rather than scanning six sections.
- **SC-009**: Every screen remains usable at mobile width, with no horizontal scrolling on the Records list or the Accounts list.
- **SC-010**: A record opened, edited or deleted in one browser tab is reflected in another open tab without a reload, over a single live connection per screen.
- **SC-011**: A user who may add records but has not been granted the free-choice ability cannot write a record between two accounts outside the everyday shortlists, and cannot write one with three sides — verified by the server refusing a direct request, not merely by the controls being hidden.
- **SC-012**: The number of seeded groups holding the free-choice ability is zero, before and after the change.
- **SC-013**: There is exactly one place to see everything that touched an account, reached in one step from that account, and its running balance and closing figure match the balance shown on the Accounts list to the cent.
- **SC-014**: Reconciling an account is reached in one step from that account, and the user is never asked which account a statement belongs to.
- **SC-015**: Everything still waiting to be cleared, across every account, remains findable in one step from the Records screen.
- **SC-016**: Every statement that existed before the change remains reachable afterwards, including any filed against no account.

---

## Assumptions

- **The ledger itself does not change.** One record store, sides that cancel out, money as whole cents, nothing about payment state stored. This feature changes screens, addresses, permissions and dead weight only.
- **"Remove income/expenses" means the screens and their duplicate interfaces, not the concepts.** Income and expense categories remain, because a profit and loss is made of them, and reports keep those words.
- **"Remove claim" is largely already done.** No claims screen or route exists; what remains is legacy tables and code lists, which is why it appears under US7 as a clean-up rather than as a screen removal.
- **Kind remains a fact about a record** — it drives settlement, read-only invoice records and reporting — but stops being a screen. Users meet it as a filter and a label, not as a place.
- **The record drawer standard, the relation-card contract and the shareable-address pattern all still apply**, so the merged screens keep the chrome every other screen uses.
- **Quotations, Invoices, Contacts, Auto Import, Reports and Dashboard stay as they are**, apart from re-pointing their links at Records. Consolidating them is not in scope.
- **Reconciling keeps everything it does today** — uploading, extracting, matching, auto-matching, finishing a statement. Only where it is reached from changes (D-06).
- **Existing groups keep working without an administrator's intervention**; the permission change is applied for them, not left as a manual step.
- **This is a single-user-at-a-time, self-hosted installation** in the normal case, so a brief migration window is acceptable.
- **Users back up before upgrading.** Per D-03 the app does not take a copy for them; the release notes carry the warning. Losing the retired tables is therefore acceptable and losing anything else is not.
- **The kind of record is worked out from the accounts its sides name**, not asked as a question, per D-01.

## Out of Scope

- Changing how money is stored, how sides are built, or the balance rule.
- Merging or removing Quotations, Invoices, Contacts, Auto Import, Reports or Dashboard.
- Changing what reconciling does — how statements are read, how lines are matched, how auto-matching decides. Only its location moves.
- Adding new reports, new record kinds, or multi-currency behaviour beyond what exists.
- Renaming account roles or changing which accounts appear on which report.
- Any change to how the one-off upgrade from the old shape ran; installations that have already upgraded are the starting point here.

---

## Decisions

Recorded so the reasoning survives, not just the outcome.

### D-01 — One form, everyday words, both sides always named *(settled 2026-08-17)*

The one entry form always names both sides, in everyday words: which account, and whether money
went into it or out of it. There is no per-kind form and no debit-and-credit grid.

**What this gives up**: a purely free-form grid would have been slightly less code. It was
rejected because the form is what makes the app usable by someone who is not an accountant, and
that is the one thing this simplification must not cost.

**Consequence**: the kind of record is no longer something the user picks — it is worked out
from which accounts the two sides landed on. A record whose "what for" side is an expense
category is money out; one whose sides are two money pots is a transfer. This is already how
the ledger behaves; it simply stops being asked as a question.

### D-02 — "Entered by hand" becomes an ability, not a screen *(settled 2026-08-17)*

Every record already names both sides, so "hand-entered" no longer describes a *form*. What is
left of it is exactly two things: **which accounts the picker will offer**, and **whether a
third or later side may be added**. Both stay behind one ability of their own, held by no
seeded group — the same control the by-hand screen carries today, moved onto the one form.

**Why it is kept rather than folded in**: with the full account list, a record can be written
between any two accounts with no event behind it — money owed reduced and reappearing as owner
capital, a figure moved between categories after year-end, a starting balance rewritten. The
arithmetic still holds; the books simply stop being true. This is a legitimate and necessary
tool for corrections and year-end adjustments, which is exactly why it exists and exactly why
it is granted deliberately.

**What this gives up**: one more ability for an administrator to understand, and one gate to
enforce on the form and the server. Folding it in would have been simpler and would cost a
single trusted user nothing today. It was rejected because everything else in this feature
removes a convenience, which can be put back, while this is the one control in it — and a
balance quietly restated is not something that can be found later.

**Consequence**: for anyone without the ability, each side of the form offers only its sensible
shortlist and no third side. Reading such a record is never gated (FR-031d).

### D-03 — The retired tables are removed outright *(settled 2026-08-17)*

The old claim, expense and income tables, their attachment and search tables, the deprecated
categories table, and the retired code lists are dropped. Nothing live reads them.

**What this gives up**: the removal cannot be undone from inside the app. The maintainer's
decision is that backing up before an upgrade is the user's own responsibility, so the release
notes carry that warning prominently rather than the system taking a copy for them. Note that
this is a deliberate departure from how the earlier one-off conversion behaved, which took its
own restorable copy first.

### D-04 — Retired addresses are not redirected *(settled 2026-08-17)*

The addresses of the removed screens simply stop existing. No redirect layer is built, and the
look-up that resolved a record address written before the earlier conversion goes with them.

**Why**: the maintainer does not keep or share links to records, so there is nothing to
preserve. Redirects would be real code kept alive for a case that does not occur.

**What this gives up**: an old bookmark or a link shared out of the app before this release
will stop working. Accepted deliberately. In-app links are a separate matter and are still the
app's responsibility (US5, FR-027).

### D-05 — An account's history is the Records list filtered to it *(settled 2026-08-17)*

Clicking an account leads to the Records list narrowed to that account. When exactly one
account is in view, the list grows the things that made the separate history page worth having:
a running balance, an opening and a closing figure, and the export. The separate full-page
history retires.

**Why**: otherwise there are two answers to "show me everything for this account" — the history
page and the Records account filter — which is the same duplication this feature exists to
remove, one level down.

**What this gives up**:

- A running balance only means anything when the rows are complete and in date order, so the
  balance column has to disappear when any other filter narrows the set or the list is sorted
  by something else. That is a conditional rule on one screen, and it is the price of the merge.
- The statement was a full page because it is a wide table read across and exported. It now
  lives on a screen that also carries filter chrome, so it has less width.
- **The ability it needs changes.** The statement is gated on the reports ability today; as part
  of Records it is gated on the records ability instead. This is a deliberate change, called out
  here because it is the one place this feature does not leave existing access untouched.

### D-06 — Reconciling moves into the account *(settled 2026-08-17)*

Reconciling is reached from an account rather than from a menu item of its own. Uploading no
longer asks which account a statement is for. The matching surface stays a full-width working
surface with its own address — it is not squeezed into the drawer. The cross-account list of
what is still waiting to be cleared becomes a filter on Records.

**Why**: a statement already belongs to exactly one account, and only that account's records are
ever offered as matches for its lines. The account is where someone asks "does this agree with
my bank?", and it was the one place that could not answer. Relocating it also removes a menu
item, and it fits the shape D-05 sets: the account is the hub for everything about that account.

**What this gives up**:

- **The cross-account worklist loses its own home.** Today one tab lists everything awaiting
  clearing across every account. As a filter on Records it is still one click, and Records
  already carries whether a record has been cleared — but it is no longer a place you land on,
  so it is a thing you have to think to look for. This is the real cost of the move.
- **An unfinished reconciliation is no longer listed centrally**, which is why FR-053 requires
  the account itself to say so.
- **A misfiled or unassigned statement is harder to stumble on**, since there is no list of all
  statements to scan. FR-054 and FR-055 exist to stop that becoming a hole.

**What it does not change**: who may reconcile. Reconciling keeps its own ability (FR-057) —
where a thing lives and who may do it are separate questions.

All six decisions are settled. No clarification remains.
