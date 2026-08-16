# Feature Specification: Double-Entry Ledger

**Feature Directory**: `specs/002-double-entry-ledger`

**Created**: 2026-08-14

**Status**: Draft

**Input**: User description: "After implementing the reconciliation feature, i noticed that we actually have a gap... we only import monthly income statement from shopee, which is different from bank deposits when we withdraw money from shopee seller wallet... we withdraw many times, but income statement is a summed value... upon research, standard accounting procedure has clearing accounts, but it's for double entry accounting. Now im thinking is it i have to migrate to double entry accounting... i am okay if we implemented something innovative and general enough to change many accounting use case, but if it's very specific for our use case and cannot use for other people, i rather switch to double entry, so that in the future when we grow, we still can use and make our process more streamline."

## Overview

Today Akaun records money as a one-sided list. Every expense and income has a date and an amount, and the app quietly assumes the other side is always the bank. It never writes that down.

This change makes every record say **where the money came from and where it went**. Because both sides are written down, the totals can check themselves.

**What went wrong that started this.** A Shopee statement arrives once a month as a single figure. But the money actually reaches the bank as several withdrawals, on dates that don't line up with the month, and Shopee has already taken its commission out. Today there is no way to say "we earned this, but it's still sitting at Shopee". So the income can never be matched against any bank deposit.

**Why it's worth changing the whole model.** That marketplace problem is one symptom of a bigger limit. The business is a partnership planning to become a private limited company, and three other things already don't fit:

- money the partners put in and take out
- equipment, which should be spread over the years it's used instead of counted as one big expense
- customer invoices paid in instalments

And once the business incorporates, it must file a balance sheet — a report a one-sided list can never produce.

**This changes the bookkeeping underneath, not the product on top.** Receipt import, reimbursements, reconciliation and the record detail screens all stay. Accounting words stay off the everyday screens.

## Words Used In This Spec

Plain meanings, so nothing here needs an accounting background to read.

| Word | What it means here |
|---|---|
| **Account** | A named pot that holds a balance. Some are places money sits (bank, Shopee wallet, cash). Some are things the business owns (equipment). Some are the spending and earning categories you already use. Some track what people owe. |
| **Category** | The everyday word for an account you pick when recording money — "Petrol", "Office Supplies", "Shopee Sales". Same thing as an account, different word for the screen. |
| **Record** | One thing that happened, on one date: a receipt, a sale, a payment. Carries the description, contact, notes and attachments. |
| **Movement** | One side of a record — an amount going into or out of one account. Every record has at least two, and they always cancel out to zero. Only movements change a balance. |
| **Balance** | What an account holds right now. Always added up from its movements; never stored as a number that could drift. |
| **Contact** | A person or company — customer, supplier, or someone who paid for something themselves. Your existing contact list. |
| **Shared "owed" account** | One pot for *everything people owe us* and one for *everything we owe people*. Each movement in them carries a contact's name, so "how much does Ali owe?" is answered by filtering, not by giving Ali his own pot. |
| **Capital / drawings** | Money a partner puts into the business (capital) and money a partner takes out (drawings). |
| **Opening balance** | What an account already held on the day you started using Akaun for it. |
| **Settle** | Record that a payment paid off a specific thing that was owed — fully or partly. |
| **Reconcile** | Tick off records against a bank statement, to confirm the bank agrees with your books. |
| **Profit and loss (P&L)** | A report for a date range: what you earned, what you spent, what's left. |
| **Balance sheet** | A snapshot on one date: what the business owns, what it owes, and what the owners have in it. Formally called a "statement of financial position" — the name that appears on official filings. |
| **Archive** | Hide something from the pickers used for new records, while keeping all its history. Different from delete, which removes it. |

## Clarifications

### Session 2026-08-14

- Q: Should marketplace sales count as revenue when the statement is issued, or when the money reaches the bank? → A: When the statement is issued, at the full amount before commission, with the commission recorded as an expense. The statement is the figure that matters for tax, and counting it on withdrawal would understate what was earned and give a withdrawal that crosses a month boundary no sensible date.
- Q: Is a clearing account alone enough, or is a full accounting-model change warranted? → A: Full change. A clearing account fixes only the marketplace case; partner capital, equipment, instalments and the balance sheet all need the general model.
- Q: Should there be one general record of movements, or separate stores per document kind? → A: One general record. The "both sides must cancel out" rule has to be checkable in a single sweep; separate stores would make every report a permanent stitching job.
- Q: Do amounts owed to and by people need their own separate store? → A: No. They are balances of the two shared "owed" accounts, filtered by contact. A separate store would be a stale copy that disagrees the first time a record is edited.
- Q: Should the paid/unpaid state of an expense stay a field the user sets? → A: No. It must be worked out from whether the money owed was actually paid, so it can never contradict the records underneath.
- Q: Do invoices lose their own store? → A: No. They carry line items, due dates, terms and layout that a movement can't hold, so they stay documents that produce records. *(The original answer added "and are unchanged by the first release" — superseded on 2026-08-15, see below.)*

### Session 2026-08-15

- Q: What balance should each account start from, and as at what date? → A: Each account can have one opening balance, dated whenever the user chooses, entered as a normal two-sided record against a dedicated opening-balances account. Accounts created by the upgrade start at zero, so existing records on their own still produce today's totals.
- Q: Is spreading the cost of equipment over its life part of this change? → A: Partly. Equipment can be recorded as something the business owns instead of a one-off expense. Automatic schedules that spread the cost year by year are out of scope; a user who wants that records it by hand.
- Q: What happens to today's expense and income categories? → A: A category and an account become the same thing, as they are in Xero and QuickBooks. The word "category" stays on every everyday screen; underneath, it's an account. Expense categories and income categories stay separate sets, exactly as now. Existing categories become accounts at upgrade, keeping their names, so a category total becomes that account's balance — same number.
- Q: Which account is the other side of an everyday expense or income? → A: The category the user already picks. Nothing extra is asked for, and nothing is chosen behind the scenes.
- Q: Does each contact become an account? → A: No, and the two kinds of people are handled differently, following Xero and QuickBooks. **People you trade with** (customers, suppliers, anyone who paid out of pocket) are many and always changing, so they stay contacts: two shared "owed" accounts hold the money, every movement in them names a contact, and each contact's balance is worked out by filtering. **Partners** are few and permanent, and must be named individually on a balance sheet, so each partner gets their own capital account and drawings account.
- Q: Can a contact be deleted once it has financial history? → A: No. A contact named by any record can only be archived — it disappears from the pickers for new records while every record, balance and report stays exactly as it was. A contact nothing points at can still be deleted outright.
- Q: Do invoices feed the ledger in this release, or stay documents only? → A: They feed it. Issuing an invoice puts the amount into the owed-to-us account tagged with the customer, and payments settle it exactly like any other debt. Invoices issued before the upgrade are not back-filled, which is the limitation FR-030 reports. This replaces the earlier "invoices are unchanged by the first release" answer, which contradicted User Story 3 scenario 7 and all of User Story 6.
- Q: Do claims survive the change? → A: No. Claims are retired outright — the screen and its own permission go away, and no old claim link is preserved (confirmed with the user: the links aren't used anywhere, and the new flow replaces them). What a claim recorded is not lost: it becomes a payment plus the settlements saying which expenses it covered.
- Q: Does the contact belong to the record or to the movement? → A: The record. A record touching either shared owed account must name a contact, and its movements inherit it, so there is only one place the fact lives and nothing to disagree. The consequence is that one record covers one contact — paying two different suppliers in one bank transfer is two records.
- Q: How does the system know which contacts are partners? → A: "Partner" becomes a role on the contact, extending the roles contacts already carry. Marking a contact as a partner creates their capital and drawings accounts, and the partner statement lists exactly the contacts marked. This is the single stated exception to FR-008a's rule that a contact change never touches accounts.
- Q: Which account do bank statements imported before the upgrade belong to? → A: The default bank account the upgrade creates. There is one account today, so there is one right answer and no reason to ask; the user can change it on the statement afterwards if an installation turns out to have more than one candidate.
- Q: Do attachment files move on disk during the upgrade? → A: Yes. Today they're split by the old record kind (`expenses/`, `income/`, `claims/` folders, each by year and month); the upgrade moves them into one layout shared by all records and rewrites the stored paths to match. Because moving a file can't be undone by the database transaction the way a row change can, the move must be copy-verify-then-remove, resumable, and must not delete anything until the whole upgrade has been verified.
- Q: Do reference numbers change? → A: No. Expenses, income, quotations and invoices keep their existing sequences, formats and counters for both old and new records — the numbers are used as bank transfer references, so reissuing one would break a payment trail outside the app. The only number needing a new home is the claim's: a retired claim carries its number onto the payment it becomes, and new payments continue that same counter so nothing is ever reused. Every existing number stays exactly as it is and stays searchable.
- Q: What happens when a record that is already settled or reconciled is edited? → A: It's blocked. While a record is settled or reconciled, its amount, date and account can't be changed. Description, contact and attachments stay editable. To change a locked field the user first undoes the settlement or unmatches the bank line.

### Session 2026-08-16

- Q: A reimbursement recorded before the upgrade names no person — only the user account that created it. Who is it owed to? → A: The user account is matched to a contact by email, then by name. Claims created by the seeded administrator account are attributed to the installation's one real user instead, since that account is a system login rather than a person; if there is no single real user to fall back to, a contact is created from the account and flagged. Every attribution is listed in the upgrade report, and a wrong one is corrected by merging contacts, which moves every record at once. See FR-036b.
- Q: An expense that was never marked paid and was never on a reimbursement — is it owed to anyone after the upgrade? → A: Yes, when it names someone. It is booked as owed to that contact, so it still reads owed rather than silently becoming paid. One that names nobody has no one to be owed to, so it falls back to the default bank account and is listed in the upgrade report. See FR-036c.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Nothing you already have is disturbed (Priority: P1)

An existing user updates the app. Every expense, income, contact, attachment and past bank match is still there afterwards, with the same amounts, dates, categories and totals. Claims are the one exception, and only in shape: a claim becomes a payment plus the settlements saying which expenses it covered, so what it recorded survives even though the claim itself no longer exists as its own kind of record. Nothing needs re-typing, no report changes its answer, and someone running Akaun on their own machine has no command to run.

**Why this priority**: Nothing else can ship without it. If a bookkeeping change quietly moves historical numbers, every figure in the product becomes untrustworthy — and self-hosting users can't be walked through a migration one by one.

**Independent Test**: Take a copy of a database with real data in it, run the update, and compare every headline total, record count and category breakdown against the same figures taken beforehand. They must match exactly.

**Acceptance Scenarios**:

1. **Given** a database with existing expenses, incomes and claims, **When** the update runs, **Then** total income, total expenses, per-category totals and record counts are unchanged.
2. **Given** an expense that was on a completed claim, **When** the update runs, **Then** the expense still shows as paid and still shows which reimbursement paid it.
3. **Given** an expense on a claim that was never completed, **When** the update runs, **Then** the amount still shows as owed to the person who paid it.
4. **Given** existing matches between bank statement lines and records, **When** the update runs, **Then** every match survives with the same amount and still points at the same thing.
5. **Given** the update has already run, **When** the app restarts, **Then** it does nothing further and nothing is duplicated.
6. **Given** a self-hosted installation, **When** the user updates and restarts, **Then** it completes with no command to run and no instructions to follow.
7. **Given** records with attachments and scanned text, **When** the update runs, **Then** every attachment still opens and every record is still findable by search.

---

### User Story 2 - Shopee income matches the bank deposits (Priority: P1)

The user records the monthly Shopee statement as income in the month it was earned, at the full amount before commission, and records the commission as an expense. Both sit against the Shopee wallet, not the bank. As withdrawals arrive, each one is recorded as money moving from the Shopee wallet to the bank, and each matches its deposit exactly. At any time the user can compare the Shopee balance in the app against the balance Shopee itself shows.

**Why this priority**: This is the problem that started the whole change, and proving it works is what justifies the change.

**Independent Test**: Record one month's statement as income plus a commission expense against the Shopee wallet, then record three withdrawals of different amounts on different dates, one of them falling in the next month. Confirm the Shopee balance returns to where it started, the income stays in the month it was earned, and each withdrawal is offered as the match for its deposit.

**Acceptance Scenarios**:

1. **Given** a Shopee wallet and a monthly statement, **When** the user records the income and the commission against it, **Then** the income is dated in the month it was earned and the commission shows as an expense.
2. **Given** income and commission recorded against the Shopee wallet, **When** the user records a withdrawal to the bank, **Then** the Shopee balance falls and the bank balance rises by the same amount, and neither counts as new income or a new expense.
3. **Given** a withdrawal dated in the month after the sales it came from, **When** reports are run, **Then** the income stays in the earlier month and only the cash movement lands in the later one.
4. **Given** withdrawals matching bank deposits, **When** the user reconciles the bank statement, **Then** each withdrawal is offered as the match for its deposit, and the Shopee income itself is never offered.
5. **Given** everything earned in a period has been withdrawn, **When** the user looks at the Shopee balance, **Then** it equals the balance Shopee itself shows.
6. **Given** a withdrawal recorded before its statement was entered, **When** the user looks at the Shopee balance, **Then** the gap is visible and explained rather than silently wrong.

---

### User Story 3 - Pay off what's owed, fully or partly (Priority: P2)

Money the business owes — to a partner who paid out of their own pocket, to a supplier on credit — shows as an outstanding balance against that person or company. The user records a payment and ticks which outstanding items it covers. A payment that covers only some of them leaves the rest clearly still owed. The same mechanism handles a customer paying an invoice in instalments.

**Why this priority**: Replaces today's reimbursement flow with one that also handles suppliers and instalments — a need the business already has. It needs P1 first, but nothing else waits on it.

**Independent Test**: Record three expenses paid personally by one person, then reimburse less than the full amount. Confirm the covered items read as paid, the uncovered one still reads as owed, and the person's outstanding balance equals the difference.

**Acceptance Scenarios**:

1. **Given** three expenses paid personally by one person, **When** the user views what's owed to that person, **Then** the total equals the sum of the three.
2. **Given** an amount owed to a person, **When** the user records a payment covering all of it, **Then** each covered expense reads as paid and the balance owed is zero.
3. **Given** an amount owed, **When** the user records a payment covering only part of it, **Then** the covered items read as paid, the rest still reads as owed, and the remaining balance is right.
4. **Given** an expense paid straight from a business account, **When** the user views it, **Then** it reads as paid immediately and never shows as owed to anyone.
5. **Given** a supplier bill recorded as owed, **When** the user records a payment to that supplier, **Then** it works exactly like a reimbursement, on the same screen.
6. **Given** a payment, **When** the user tries to allocate more than is actually outstanding, **Then** the system refuses and explains why.
7. **Given** a customer invoice, **When** the customer pays part of it, **Then** the invoice shows the amount received and the amount still due.

---

### User Story 4 - Reconcile any account against its own statement (Priority: P2)

The user uploads a statement and says which account it belongs to. Only records that touched that account are offered as matches. Money sitting at Shopee, expenses a partner paid personally, and anything belonging to a different account are never offered, because they never went through this account.

**Why this priority**: Reconciliation already works today. This keeps it correct once money can sit in more than one place. Without it, Shopee income would still be offered against bank lines — the original bug, moved.

**Independent Test**: With two accounts holding records, upload a statement for one of them and confirm nothing belonging to the other is ever offered.

**Acceptance Scenarios**:

1. **Given** a statement belonging to a stated account, **When** the matching screen loads, **Then** only records that touched that account are offered.
2. **Given** an expense paid personally by a partner, **When** the bank statement is reconciled, **Then** the expense is not offered — only the reimbursement that actually left the bank.
3. **Given** income sitting at Shopee, **When** a bank statement is reconciled, **Then** it is not offered.
4. **Given** an unmatched deposit that came from another account the user holds, **When** the user chooses to record it as a transfer between their own accounts, **Then** the transfer is created with the deposit's date and amount and matched to it in one step.
5. **Given** existing partial and many-to-many matches, **When** accounts are introduced, **Then** they keep working unchanged.

---

### User Story 5 - Produce the financial reports (Priority: P3)

The user picks a period and gets a profit and loss report, or picks a date and gets a balance sheet. A partner can see what they've put in, their share of the profit, and what they've taken out. All of it can be exported to send to an accountant, a bank or the tax office.

**Why this priority**: The payoff that makes the change worth its cost, and the biggest gap in the product today. It's pure reading on top of P1, so it can come at any time after.

**Independent Test**: Produce a profit and loss for one month and a balance sheet at that month's end. Confirm the balance sheet balances and its profit figure agrees with the profit and loss.

**Acceptance Scenarios**:

1. **Given** a date range, **When** the user produces a profit and loss report, **Then** it shows income and expenses by category and the net result.
2. **Given** a date, **When** the user produces a balance sheet, **Then** what the business owns equals what it owes plus what the owners have in it.
3. **Given** a finished earlier period, **When** a balance sheet is produced for the current one, **Then** the accumulated result of earlier periods is carried into it.
4. **Given** a partnership with more than one partner, **When** a partner statement is produced, **Then** it shows each partner's contributions, share of profit and drawings.
5. **Given** any report, **When** the user exports it, **Then** it saves in a form suitable for sending onwards.
6. **Given** a period before the app started tracking what customers owe, **When** a report covering it is produced, **Then** it says so rather than implying complete history.

---

### User Story 6 - See who owes what (Priority: P4)

The user sees which customers owe money and how overdue each one is, and which suppliers are owed and when payment is due.

**Why this priority**: Useful but not blocking — it's a new way of reading information P2 and P3 already record.

**Independent Test**: With outstanding customer and supplier balances of different ages, confirm each shows against the right contact in the right age band.

**Acceptance Scenarios**:

1. **Given** unpaid customer invoices of different ages, **When** the user views what's owed to the business, **Then** each shows against its customer, grouped by how overdue it is.
2. **Given** unpaid supplier bills, **When** the user views what the business owes, **Then** each shows against its supplier with its due date.
3. **Given** a part-paid invoice, **When** it appears in these views, **Then** only the amount still outstanding is shown.

---

### Edge Cases

- **Amount changed after being settled or reconciled** — can't happen. The amount, date and account of a settled or reconciled record are locked, and the refusal says which action unlocks them.
- **Withdrawal recorded before its statement** — the Shopee balance may briefly read below zero. That's a timing gap, not an error, and must be shown as such.
- **Payment allocated to something already fully paid** — refused, not silently swallowed.
- **Account with records is closed** — history must survive. The account can be archived, never deleted out from under its records.
- **Contact with financial history** — can only be archived, never deleted, so a balance can never lose the name it belongs to. A contact nothing points at can still be deleted.
- **Record saved with only one side** — impossible. A record whose two sides don't cancel out cannot be saved.
- **Amounts in another currency** — count at their converted value using the rate stored on the record at the time, on both sides.
- **A statement covering a period already reconciled** — the existing already-matched protection still applies.
- **Period boundaries in reports** — earlier periods' accumulated result must carry forward correctly, and running the same report twice must give the same answer.
- **Update interrupted half-way** — must resume or restart cleanly, duplicating nothing. Attachment files are the hard part, because moving a file can't be undone by undoing a database change: a file already at its new location is skipped, and no original is removed until the whole upgrade has been checked (FR-032b).
- **An attachment file is missing from disk** — reported and left pointing where it was, rather than failing the whole upgrade or quietly dropping the attachment.
- **A user who can view but not record** — seeing balances and reports must not let them change anything.
- **An imported record with no category** — since the category is the other side of the record, it needs one to balance. It's accepted against an "Uncategorised" expense category and flagged as needing one, never rejected and never silently lost.
- **Partner role removed while their capital account still holds money** — the accounts archive rather than disappear, so the balance sheet never loses what they put in.
- **One bank payment covering two different people** — can't be one record, since a record carries one contact (FR-008). It's recorded as two records, one per person.
- **Rounding when one payment is split several ways** — the two sides must still agree exactly, to the cent.

## Requirements *(mandatory)*

### Functional Requirements

**The core rule**

- **FR-001**: Every record MUST say where the money came from and where it went, and the two sides MUST cancel out exactly.
- **FR-002**: The system MUST refuse to save a record whose two sides don't cancel out.
- **FR-003**: The system MUST be able to show, on demand, that every record balances and that the books as a whole balance, and MUST report anything that doesn't.
- **FR-004**: All records MUST live in one place, so FR-003 can be answered in a single sweep no matter what kind of record it is.
- **FR-005**: Amounts in another currency MUST count at their converted value, using the rate stored on the record when it was created.

**Accounts**

- **FR-006**: Users MUST be able to set up the places money sits (bank, Shopee or gateway wallet, cash, card), the things the business owns and keeps (equipment), and the categories money is earned and spent under — and see a balance for each.
- **FR-006a**: A category and an account MUST be the same thing, not two things. "Category" stays the word on everyday screens; underneath it is an account. Expense categories and income categories stay separate sets, so an expense screen offers expense categories and an income screen offers income ones. There MUST NOT be a second classification concept beside accounts, and no mapping between the two that could be maintained wrongly or drift.
- **FR-006b**: Users MUST be able to record buying something the business keeps — equipment — so it isn't counted as one big expense in the month it was bought. Spreading that cost over the item's life MUST be possible as an ordinary record, but the system MUST NOT be required to schedule or post it automatically. The everyday screen reaches this by offering that account among its categories (FR-006a), so no extra screen or concept appears.
- **FR-007**: Users MUST be able to record money moving between two places they hold, and that MUST NOT count as income or as an expense.
- **FR-008**: Money owed to and by the people the business trades with MUST live in two shared accounts — one for what people owe us, one for what we owe people. A record touching either of them MUST name a contact, and one that doesn't MUST be refused; its movements take that contact, so the contact is stored in exactly one place and cannot disagree with itself. Each contact's outstanding total MUST be worked out by filtering those movements, not kept as a separate list of debts. One record covers one contact — a single bank payment to two different suppliers is two records.
- **FR-008a**: A contact MUST NOT be an account. Adding, editing or archiving a contact MUST NOT create, change or remove any account. This keeps the list a user picks a category from short, no matter how many customers they have. The single exception is marking a contact as a partner (FR-008b).
- **FR-008b**: "Partner" MUST be a role a contact can be given, alongside the roles contacts already carry. Marking a contact as a partner MUST create that partner's capital account and drawings account, each pointing at that contact so it can be labelled with their name; this is the only kind of account that points at a contact. The partner statement (FR-027) MUST list exactly the contacts holding that role. Removing the role MUST NOT delete accounts that already hold movements — they archive instead, per FR-009.
- **FR-009**: Accounts the system itself relies on MUST NOT be deletable, and any account with records against it MUST be archivable rather than deleted.
- **FR-009a**: A contact named by any record MUST NOT be deletable. It MUST be archivable instead — hidden from the pickers used for new records, while every existing record, balance and report stays exactly as it was. A contact nothing points at MAY still be deleted. Where deletion is blocked the button MUST stay visible and disabled, with a tooltip saying why.
- **FR-010**: Users MUST be able to give each account one opening balance, dated whenever they choose, so balances are right from their first day of use. It MUST be recorded as an ordinary two-sided record against a dedicated opening-balances account, so it obeys FR-001 to FR-003 like everything else instead of being an exception. Accounts created by the update MUST start at zero, so existing records alone still produce today's totals (SC-001).

**Everyday recording**

- **FR-011**: Recording an expense or income MUST ask which account it came from or went into, defaulting to the user's usual one so someone with a single account is never asked twice. The other side is the category they already pick (FR-006a), so the only new question on the screen is which account paid or received.
- **FR-012**: Whether an expense is paid MUST be worked out from whether the money owed was actually paid. It MUST NOT be a field the user sets.
- **FR-013**: An expense paid straight from an account MUST read as paid the moment it's recorded.
- **FR-014**: An expense someone else paid for the business MUST read as owed to that person until it's paid back.
- **FR-015**: Users MUST be able to record a payment that pays off one or more outstanding items, choosing which, and MUST be able to pay off only part of what's outstanding.
- **FR-016**: The system MUST refuse to allocate more to an outstanding item than is actually still outstanding on it.
- **FR-017**: Users MUST be able to undo a settlement, putting both sides back as they were.
- **FR-017a**: While a record is settled or reconciled, its amount, date and account MUST NOT be changeable. Description, contact, reference, notes and attachments MUST stay editable. An attempt to change a locked field MUST be refused and MUST say what unlocks it: undoing the settlement (FR-017) or unmatching the bank line.
- **FR-018**: One payment MUST be able to pay off several outstanding items, and one outstanding item MUST be able to be paid off by several payments.
- **FR-018a**: Issuing an invoice MUST create a record putting its amount into the owed-to-us account, tagged with that customer (FR-008). A customer's payment MUST settle it through the same mechanism as any other debt (FR-015), so part payments and instalments need nothing invoice-specific. Invoices issued before the upgrade MUST NOT be back-filled; that gap is what FR-030 reports.
- **FR-019**: The existing document import MUST keep working end to end, and MUST let the user say which account the imported record affected.
- **FR-020**: Everyday recording screens MUST NOT make the user understand or enter accounting concepts. Both sides MUST be expressed in plain terms — which account paid, and what it was for.

**Reconciliation**

- **FR-021**: A statement MUST belong to a stated account, and only records that touched that account MUST be offered as matches for its lines.
- **FR-022**: Existing partial and many-to-many matching MUST keep working unchanged.
- **FR-023**: Users MUST be able to turn an unmatched statement line into a transfer between two accounts they hold, pre-filled from the line, and have it matched in the same action.
- **FR-024**: Reconciling MUST NOT change the amount, date or content of any record.

**Reports**

- **FR-025**: Users MUST be able to produce a profit and loss report for any date range, broken down by category. Because a category is an account (FR-006a), each line of the breakdown is that account's movement over the period, so the report and the category totals shown elsewhere can never disagree (FR-031).
- **FR-026**: Users MUST be able to produce a balance sheet as at any date, where what's owned equals what's owed plus what the owners have in it, carrying forward earlier periods' accumulated result.
- **FR-027**: Users MUST be able to produce a statement of each partner's capital, share of the result, and drawings, taken from that partner's own accounts (FR-008b).
- **FR-028**: Users MUST be able to see the full history of movements for any single account.
- **FR-029**: Reports MUST be exportable in a form suitable for sending to an accountant or the tax office.
- **FR-030**: Any report covering a period before the app started tracking something MUST say so — in particular, invoices issued before the upgrade carry no ledger history (FR-018a), so a report covering that period MUST state the gap rather than implying complete history.
- **FR-031**: Summary figures anywhere in the product MUST come from the same records the reports come from, so two screens can never disagree.

**Updating existing data**

- **FR-032**: The update MUST keep every existing record — amount, date, category, contact, attachments and searchability.
- **FR-032a**: The update MUST create the accounts the model needs before it moves anything: a default bank account, the two shared owed accounts, and the opening-balances account. Every existing expense and income MUST be attributed to the default bank account, since that is what today's one-sided model already assumes — except expenses someone paid personally, which go to the we-owe account instead (FR-036), and expenses that were never marked paid, which follow FR-036c.
- **FR-032b**: Attachments MUST end up in one layout shared by all records, replacing today's split by record kind, with each stored path rewritten to match. Because a moved file cannot be put back by undoing a database change, the move MUST be done by copying, checking the copy arrived intact, and only then removing the original; a file already at its new location MUST be skipped so the upgrade can be re-run or resumed after an interruption; no original MUST be removed until the whole upgrade has passed the check required by FR-038; and a file that cannot be found MUST be reported and left pointing at where it was, rather than failing the whole upgrade or silently losing the attachment.
- **FR-032c**: Every attachment MUST still open, and open the same file, after the upgrade. This MUST be checkable by count and by content, not by inspection.
- **FR-032d**: No existing record's reference number MUST be changed, reissued or reformatted by the upgrade or by anything after it. These numbers are used as bank transfer references, so a changed number breaks a payment trail outside the app that Akaun cannot see or repair. Every existing number MUST remain findable by search, exactly as typed.
- **FR-032e**: Numbering schemes MUST stay as they are. Expenses, income, quotations and invoices keep their existing sequences, formats and counters for new records as well as old. A retired claim MUST carry its number onto the payment it becomes (FR-036a), and new payments MUST continue that same counter, so no number is ever reused or skipped.
- **FR-033**: Every headline total and category breakdown MUST be unchanged by the update. Every existing category MUST survive as an account of the matching kind, with the same name, the same records against it, and a balance equal to what its category total was.
- **FR-034**: Existing bank matches MUST survive and still point at the same record and amount.
- **FR-034a**: Every bank statement imported before the upgrade MUST be assigned to the default bank account the upgrade creates, so FR-021 holds for old statements as well as new ones without asking the user anything. The user MUST be able to change that account on the statement afterwards.
- **FR-035**: An expense that was part of a completed reimbursement MUST still read as paid, and MUST still show which payment paid it.
- **FR-036**: An expense on an unfinished reimbursement MUST still read as owed to the person who paid it.
- **FR-036a**: Claims MUST be retired as a kind of record. Every existing claim MUST become a payment plus the settlements recording which expenses it covered. The claims screen and its own permission MUST be removed, and old claim links MUST NOT be preserved — a deliberate exception to the rule that every record keeps a shareable link, taken because those links are not in use.
- **FR-036b**: Because a reimbursement recorded before the upgrade names no person — only the user account that created it — the update MUST work out who each one is owed to, without asking. It MUST resolve that account to a contact in this order, and MUST record which step answered:
  1. A contact whose email matches the account's email.
  2. A contact whose name matches the account's name.
  3. **The installation's one real user, when the account is the seeded administrator.** A seeded administrator login is a system account, not a person, so a reimbursement it created was really made by whoever runs the installation. When exactly one other user account exists, steps 1 and 2 are retried against that account. When none or more than one exists, there is no single answer and this step is skipped.
  4. A new contact, created as an individual with the Employee role, named from the first of the account's name, its username, or the part of its email before the `@` — so a contact can never be created without a name.

  Every attribution MUST appear in the update's report, naming the contact each reimbursement landed on and which step chose it, so a wrong guess is visible rather than silent. Correcting one MUST NOT require re-typing anything: merging the two contacts moves every record at once, which is also what keeps a payment and the expenses it covers naming the same person.

- **FR-036c**: An expense that was never marked paid and was never on a reimbursement MUST NOT come out of the update reading paid. Where it names a contact, it MUST be booked as owed to that contact, exactly as a personally-paid expense is (FR-014). Where it names nobody there is no one to owe, so it falls back to the default bank account under FR-032a's general rule and MUST be listed in the update's report, so the user can see which records were treated that way rather than discovering it later.

- **FR-037**: The update MUST complete with no manual step for a self-hosting user, and MUST be safe to run more than once.
- **FR-038**: The update MUST be checkable before anything old is thrown away, and the previous data MUST stay recoverable until that check passes.

**Access and accountability**

- **FR-039**: Access MUST use the existing permission model, with view, add, change and delete controlled separately. Being able to see reports MUST NOT allow recording.
- **FR-040**: Entering accounting entries directly, bypassing the everyday screens, MUST need its own permission and MUST be off by default.
- **FR-041**: Every create, change and delete MUST go into the audit trail, settlements included.
- **FR-042**: A change made in one open view MUST show up in other open views of the same data without a manual refresh.
- **FR-043**: Every screen MUST work at mobile widths.

### Key Entities

- **Account**: a named pot with a balance. It may be a place money sits (bank, Shopee wallet, cash, card), something the business owns and keeps (equipment), a category money is earned or spent under, one of the two shared accounts for money owed each way, or a partner's capital or drawings. What everyday screens call a category is an account — the same thing under the word the user already knows. Only a partner's capital or drawings account points at a contact (FR-008b); for money owed, the contact is named on the movement instead.
- **Record**: one thing that happened, on one date, with its human context — contact, description, reference, note, attachments, scanned text. The contact is required when the record touches either shared owed account (FR-008), and is the only place a contact is stored.
- **Movement**: one side of a record — an amount against one account. A record's movements always cancel out to zero, and they take their contact from the record. Only movements change balances.
- **Settlement**: a note that a particular payment paid off a particular outstanding item, for a particular amount. Changes no balance on its own; it's what makes "is this paid?" and "how much is left?" answerable.
- **Statement line**: a transaction as printed by the bank. Evidence from outside, never a record of the business's own.
- **Bank match**: a note that a statement line corresponds to a movement on the account being reconciled, for an amount. Changes no balance.
- **Invoice**: a document with line items, a due date and terms. Stays a document of its own because it holds things a movement can't, and produces a record putting its amount into the owed-to-us account tagged with the customer (FR-018a).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After updating a database with real data, every headline total, category total and record count is identical to before — a difference of zero, not a small one.
- **SC-002**: The check that every record balances and the books balance passes at all times, and a user can run it themselves in under a minute.
- **SC-003**: A month of Shopee activity — one statement, one commission, three withdrawals with one falling in the next month — produces income reported in the month it was earned, the commission visible as an expense, and all three withdrawals offered as the matches for their deposits.
- **SC-004**: The Shopee balance in the app equals the balance Shopee itself shows, once a period's statements and withdrawals are all recorded.
- **SC-005**: A record belonging to one account is never offered as a match for a statement belonging to another.
- **SC-006**: A payment covering part of what's owed leaves the rest correctly outstanding — checkable by the contact's balance equalling the unpaid amount exactly.
- **SC-007**: A balance sheet produced for any date balances exactly, and its result for the period equals the profit and loss for the same period.
- **SC-008**: A self-hosting user updates and restarts with no command to run, and can reach every existing record straight away.
- **SC-009**: Recording a routine expense or income takes no more steps than it does today. A user with a single account gains no step at all, because the account defaults (FR-011); a user with several gains exactly one.
- **SC-010**: No accounting jargon appears on any everyday recording screen — checkable by looking at the expense, income, payment and import screens.
- **SC-011**: The monthly Shopee routine is one statement record, one commission record, and one action per withdrawal.
- **SC-012**: A settled or reconciled record can't be left misstated by a later edit — changing its amount, date or account is refused, and the refusal says what to undo first.
- **SC-013**: Every reference number in the database before the upgrade is present, unchanged, character for character, after it — and typing any of them into search finds its record.
- **SC-014**: Every attachment count and every file's content matches before and after the upgrade. Interrupting the upgrade mid-move and re-running it produces the same result, with no file lost and none duplicated.

## Assumptions

- **Accounting jargon stays off everyday screens** (confirmed with the user). Everyday screens keep the words they use now; accounting language appears only in reports and on the separately-permitted direct-entry screen.
- **Shopee income counts when the statement is issued, at the full amount before commission** (confirmed with the user), with the commission recorded as an expense. Counting it on withdrawal would understate what was earned and give a withdrawal spanning two months no sensible date.
- **The commission is entered by hand, once a month.** Pulling several records out of one imported document is a separate capability the import pipeline doesn't have, and isn't part of this change.
- **One account today, several later** (confirmed with the user). A user with a single account must never be asked which one they mean, and nothing in the model should need changing when a second appears.
- **Partners are existing contacts**, identified by a "partner" role on the contact rather than by a separate kind of person (FR-008b). Marking a contact as a partner creates their capital and drawings accounts, labelled with their name. Capital starts at zero unless an opening balance is recorded. A partner who pays for something out of pocket is simply owed money like anyone else (FR-014) — that's a debt, not capital.
- **Existing reimbursement claims become payments** (FR-036a). Which expenses a reimbursement covered is preserved as settlements, so nothing is lost, but a claim stops being its own kind of record and the claims screen goes away. Old claim links are deliberately not preserved (confirmed with the user: they aren't in use). Retiring the `claims` permission resource is part of the change.
- **An unpaid expense stays unpaid through the update** (confirmed with the user, FR-036c). Attributing everything unclaimed to the bank would be simpler, but it would turn an expense the user marked unpaid into one reading paid — the single thing User Story 1 promises cannot happen. On the maintainer's own database no record is affected, because every expense there is already marked paid; the rule exists for other installations.
- **A seeded administrator login is not a person** (confirmed with the user, FR-036b). Where it created reimbursements, they belong to the installation's one real user. This is a guess the update makes so it can run without asking; it is reported rather than hidden, and merging contacts corrects it in one action. Where an installation has no real user beside the administrator, or has several, the update creates a contact from the account instead, because there is no single right answer to pick.
- **The "pending" state for expenses disappears** (confirmed with the user). It meant "on a reimbursement that isn't finished yet". It's replaced by knowing who is owed, how much, and how much is left — with bank clearing tracked separately by reconciliation.
- **Invoices keep their own store and gain a ledger side** (FR-018a). Line items, due dates, terms and layout stay exactly as they are; what's new is that issuing an invoice records the amount as owed by that customer, so payments and instalments run through the shared settlement mechanism. Invoices issued before the upgrade are not back-filled, which is why FR-030 exists.
- **Stock and cost of goods sold are out of scope** (confirmed with the user: "not now, nice to have in the future").
- **Sales tax fields are out of scope.** A known gap, unrelated to this change.
- **Reconciliation keeps working as it does now**, including partial and many-to-many matching, assisted matching with the user confirming, and no automatic clearing.
- **Balances are always added up from movements, never stored**, following the existing decision to work out reconciliation state rather than store it.
- **Reference numbers are used outside Akaun** (confirmed with the user): they go on bank transfers, so a number the app reissues breaks a payment trail Akaun can't see or repair. This is why FR-032d and FR-032e forbid renumbering even where it would tidy things up, and why no unified numbering scheme is introduced.
- **Attachment files are moved into one layout** (confirmed with the user), rather than left in the old per-kind folders. This is the only part of the upgrade that touches data the database transaction can't protect, which is why FR-032b spells out copy-verify-remove, resumability, and deferred deletion.

## Out of Scope

- Pulling more than one record out of a single imported document.
- Automatic schedules that spread equipment cost year by year, and disposal handling. Recording equipment as something the business owns is in scope (FR-006b); spreading its cost is a manual entry.
- Stock, stock valuation and cost of goods sold.
- Sales tax (SST/GST) fields and returns.
- Submitting e-invoices to the tax office.
- Payroll.
- More than one business in one installation.
- Automatic connections to banks or marketplaces; statements are still uploaded by hand.
- Budgets and forecasts.
- A separate tagging dimension for slicing reports by department, project or branch (what other products call tracking categories, classes or reporting tags). Categories are accounts here (FR-006a); a second dimension can come later if a real need appears.

## Dependencies

- Builds on the existing reconciliation feature, including statement import, assisted matching, and partial and many-to-many allocation.
- Uses the existing contact list for the people money is owed to and by, and for partners.
- Uses the existing permission, audit and live-update mechanisms.
- Uses the existing stored exchange rates for amounts in other currencies.
