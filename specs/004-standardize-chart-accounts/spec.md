# Feature Specification: Standardized Chart of Accounts

**Feature Directory**: `specs/004-standardize-chart-accounts`

**Created**: 2026-08-21

**Status**: Draft

**Input**: User description: "Optimize the chart of accounts after the double-entry conversion. Fixed account types must drive accounting behavior, users must be free to create accounts, all accounts should behave consistently, account codes and hierarchy are needed, reconciliation should work for any account with a statement, and existing charts should be reshaped safely."

## Overview

Akaun already keeps balanced records: every record moves value between at least two accounts, and
the movements cancel out. The remaining weakness is the chart of accounts. An account is currently
created as a hard-coded product role such as bank, wallet, equipment, money owed, or expense
category. Its accounting type is then inferred from that role. A user who needs an ordinary loan,
another kind of liability, or a different equity account must wait for the product to learn a new
role first.

This feature turns that relationship around. Every account belongs directly to one of five fixed
accounting types. The type supplies the accounting rules; the account supplies the user's own name
and place in the chart, while Akaun assigns its next available code. Features that need a particular account, such as invoicing or opening
balances, remember the user's chosen account instead of giving that account a special identity.

The ledger itself is not replaced. Records, movements, contacts, settlements, invoices, imports,
attachments and statement matches keep their existing meaning. The purpose of this change is to
make the account foundation general enough for new business cases without adding a new accounting
engine for each one.

## Words Used In This Spec

| Word                  | What it means here                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account type**      | One of the five fixed accounting classes: Asset, Liability, Equity, Revenue or Expense. It decides which report an account appears on and which balance direction is normal.             |
| **Account**           | A user-named line in the chart, such as Maybank Current Account, Accounts Payable, Product Sales or Advertising. Records point to accounts.                                              |
| **Chart of accounts** | The complete organized list of accounts used by the business.                                                                                                                            |
| **Code**              | A unique numeric identifier such as `1100` or `5200`. Akaun assigns the next available code from the account type's seeded number range.                                                 |
| **Parent account**    | A heading that groups and totals child accounts. It cannot be used directly on a record.                                                                                                 |
| **Posting account**   | An active account with no children. It can be selected on a record and can receive movements.                                                                                            |
| **Normal balance**    | The side on which an account usually increases: debit for Assets and Expenses; credit for Liabilities, Equity and Revenue.                                                               |
| **Saved default**     | An account chosen once for an automatic action, such as the Asset account used when an invoice says a customer owes money. It is a setting, not a different kind of account.             |
| **Scripted merge**    | A one-time conversion step that moves every reference from a duplicate account into a compatible surviving account without changing the books. It has no review screen or approval step. |
| **Reconcile**         | Compare one account's recorded movements with a statement supplied for that same account.                                                                                                |

## Fixed Accounting Rules

Users may create as many accounts as they need, but they may not create, rename or delete the five
account types.

| Account type | Plain meaning                      | Normal balance | Financial statement |
| ------------ | ---------------------------------- | -------------- | ------------------- |
| Asset        | What the business owns or controls | Debit          | Balance Sheet       |
| Liability    | What the business owes             | Credit         | Balance Sheet       |
| Equity       | What belongs to the owners         | Credit         | Balance Sheet       |
| Revenue      | What the business earned           | Credit         | Income Statement    |
| Expense      | What the business used up or spent | Debit          | Income Statement    |

The fixed account type and financial-report label is **Revenue**. Transaction actions and filters
use the simple accounting labels **Income** and **Expense**; plain-language substitutes such as
"money in", "money out" or "earned" are not used as action labels.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Build a chart for the actual business (Priority: P1)

An administrator opens one Chart of Accounts page and sees all five account types together as
clearly separated sections. Accounts are arranged by code and may be nested under headings. The administrator can add a loan,
another bank account, a new revenue line or any other account without waiting for Akaun to add a
new business-specific account role.

**Why this priority**: This is the central value of the feature. The chart becomes user-defined
while the accounting rules remain fixed and safe.

**Independent Test**: Create one posting account under each fixed type, organize some beneath parent
accounts, and confirm each receives the next available code and appears in the correct section of
the same page without any developer-defined role being requested.

**Acceptance Scenarios**:

1. **Given** an administrator can manage accounts, **When** they create an account with a name and fixed type, **Then** the system assigns the next available code in that type's seeded range, shows it in that type's section on the unified page, and makes it immediately available wherever a compatible posting account can be selected.
2. **Given** a Liability account named "Vehicle Loan", **When** it is saved, **Then** it behaves as a normal Liability without requiring a special Loan account type or role.
3. **Given** accounts under all five types, **When** the administrator searches by part of a code or name, **Then** every matching account is shown with its place in the hierarchy.
4. **Given** an account with no movements and no children, **When** the administrator changes its type, **Then** it moves to the new type's section, receives the next available code in that type's range, and follows the new type's accounting rules.
5. **Given** an account with movements or children, **When** the administrator tries to change its type, **Then** the change is refused with a plain explanation that existing history or descendants depend on it.

---

### User Story 2 - Organize accounts without changing the books (Priority: P1)

An administrator uses parent accounts to make a long chart understandable. A parent is a heading
and subtotal, while records are written only to the active accounts beneath it. Moving an unused
account within the same type changes presentation, not accounting history.

**Why this priority**: Codes alone do not make a large chart manageable. The hierarchy must remain
safe: a heading that can also receive movements creates ambiguous and easily double-counted totals.

**Independent Test**: Create a parent with two children, write movements to both children, and
confirm the parent reports their combined balance exactly once and cannot be chosen on a new record.

**Acceptance Scenarios**:

1. **Given** two accounts of the same type, **When** one is assigned as the other's parent, **Then** the child appears beneath it and the parent shows the total of all descendants.
2. **Given** accounts of different types, **When** the administrator tries to make one the parent of the other, **Then** the change is refused.
3. **Given** an account that already has movements, **When** the administrator tries to add a child beneath it, **Then** the change is refused because an account cannot be both a posting account and a heading.
4. **Given** a parent account, **When** a user opens any account picker for a new record, **Then** the parent is not selectable.
5. **Given** a hierarchy more than one level deep, **When** the administrator tries to create a cycle, **Then** the change is refused and the existing hierarchy is unchanged.

---

### User Story 3 - Keep automatic bookkeeping predictable (Priority: P1)

Some actions create records for the user. Issuing an invoice, recording money owed, entering a
starting balance and confirming an import must know which accounts to use. An administrator chooses
those accounts once from compatible posting accounts, and Akaun remembers the choices.

**Why this priority**: Removing hard-coded roles is unsafe unless every automatic action still has
one clear account to use. Saved defaults preserve convenience without making an account special.

**Independent Test**: Choose compatible defaults, issue an invoice, enter an opening balance and
confirm an imported expense. Confirm each action uses the saved accounts and every generated record
remains balanced.

**Acceptance Scenarios**:

1. **Given** the administrator is configuring automatic bookkeeping, **When** they choose defaults for money owed to us, money we owe, opening balances, sales revenue, uncategorised expenses and the everyday transaction account, **Then** each choice is saved only when it has the required fixed type and is an active posting account.
2. **Given** valid saved defaults, **When** an invoice is issued, **Then** the invoice uses the chosen Asset account for money owed and the chosen Revenue account for the sale.
3. **Given** a valid Equity default for opening balances, **When** a starting balance is entered for a posting account, **Then** the other side uses that saved Equity account.
4. **Given** an account is a saved default, **When** an administrator tries to deactivate it, delete it or turn it into a parent, **Then** the action is refused until a compatible replacement is selected.
5. **Given** a required default is missing or no longer valid, **When** an automatic action needs it, **Then** no record is created and the user is directed to choose a compatible account.
6. **Given** a partner puts money into or takes money from the business, **When** the record is saved against an Equity account and names that partner, **Then** the partner statement reflects it without requiring a special partner account type.

---

### User Story 4 - Reconcile any posting account (Priority: P2)

A user can supply a statement for any posting account, not only an account that Akaun recognizes as
a bank or wallet. The statement is filed against that account, and only movements touching that
account are offered as matches.

**Why this priority**: Reconciliation is evidence about an account, not a property of a hard-coded
account role. Applying the same rule everywhere keeps the account model consistent.

**Independent Test**: For one posting account under each of the five types, supply a statement and
confirm that only that account's movements can be matched and that matching changes no ledger
amount.

**Acceptance Scenarios**:

1. **Given** an active posting account of any fixed type, **When** a permitted user opens it, **Then** they can start reconciliation by supplying that account's statement.
2. **Given** a statement filed against an account, **When** match suggestions are shown, **Then** only movements touching that account are eligible.
3. **Given** a parent account, **When** the user opens it, **Then** reconciliation is not offered because the parent has no movements of its own.
4. **Given** a completed or partly completed statement, **When** the chart is reorganized without merging its account, **Then** every match remains attached to the same account and movement.

---

### User Story 5 - Reports follow the five fixed types (Priority: P2)

The Balance Sheet and Income Statement read account types directly. Parent lines summarize their
descendants without double counting, and balances are shown in the direction a reader expects.

**Why this priority**: A flexible chart is only trustworthy if formal reports remain correct for
accounts the product did not know in advance.

**Independent Test**: Add a custom account under each type, write balanced records across them, and
confirm the Balance Sheet and Income Statement classify and total every line correctly.

**Acceptance Scenarios**:

1. **Given** Asset, Liability and Equity posting accounts with movements, **When** the Balance Sheet is produced, **Then** each appears under its fixed type with its expected display direction.
2. **Given** Revenue and Expense posting accounts with movements, **When** the Income Statement is produced, **Then** each appears under its fixed type and net profit equals Revenue minus Expense.
3. **Given** a parent with several descendants, **When** a report shows both detail and subtotal lines, **Then** the report total counts each movement once.
4. **Given** a transfer between two Balance Sheet accounts, **When** the Income Statement is produced, **Then** the transfer creates neither Revenue nor Expense.
5. **Given** profit accumulated before the report date, **When** the Balance Sheet is produced, **Then** the existing accumulated-result treatment continues to make the statement balance.

---

### User Story 6 - Move existing books safely (Priority: P1)

An existing installation updates without re-entering anything. Every current account receives its
fixed type and a unique code, the new default chart fills genuine gaps, and a one-time migration
script combines only duplicates that meet the fixed safe-merge rules.

**Why this priority**: A better chart is worthless if the conversion changes financial history.
This story is a release gate even though users experience it only once.

**Independent Test**: Take a populated copy of existing books, record all account balances and
report totals, run the conversion script, and verify every duplicate is merged according to the
fixed rules while every record, total, attachment, settlement and statement match remains intact.

**Acceptance Scenarios**:

1. **Given** an account using a current hard-coded role, **When** the conversion runs, **Then** it receives the corresponding fixed type without changing any movement or balance.
2. **Given** existing accounts without codes, **When** the conversion runs, **Then** each receives a unique code in its type's number range and remains identifiable by its original name.
3. **Given** a required account from the new default chart is genuinely missing, **When** the chart is reshaped, **Then** that account is added without replacing an unrelated account.
4. **Given** an existing account and a seeded account with the same fixed type and normalized name, **When** the migration script runs, **Then** it automatically combines them into the existing account and records what references moved.
5. **Given** two accounts with different fixed types or normalized names, **When** the migration script runs, **Then** it leaves them separate.
6. **Given** a scripted merge, **When** it completes, **Then** all financial and saved-setting references move together, the source leaves the active chart, and an audit trail identifies what was merged and where.
7. **Given** the conversion and scripted merges have completed, **When** balances and reports are compared with their pre-conversion values, **Then** every value is identical and every record still balances.
8. **Given** the migration script has already completed, **When** it is run again, **Then** no account, code, hierarchy link or merge is duplicated.

### Edge Cases

- **Two account creations request the same next code.** Each account receives a different unused
  code in the correct type range; creation never produces a duplicate.
- **A seeded code is already occupied during conversion.** Existing accounts are not silently
  renumbered or merged; the seeded or migrated account receives the next available code in the same
  type range and the difference is shown in the conversion summary.
- **An account name is repeated.** Names need not be globally unique because code and hierarchy
  identify the account; two accounts with the same normalized name are never merged when their
  fixed types differ.
- **A parent is deactivated.** It can be deactivated only when all descendants are already inactive
  and it is not used by a saved default.
- **A child is moved between parents.** Both parents must have the child's fixed type; balances and
  history remain on the child.
- **A posting account is made a parent.** The action is refused once the account has any movement,
  reconciliation history or saved-default use.
- **A scripted merge would make a hierarchy cycle or mix account types.** That pair is not merged
  and is listed in the migration summary for manual investigation.
- **Both source and destination have statement history.** The scripted merge retains every
  statement and match under the surviving account without combining statement sessions.
- **The source and destination are both saved for different automatic actions.** Each saved setting
  is repointed to the survivor; no setting is dropped.
- **Archived accounts exist before conversion.** They receive types, codes and parents like active
  accounts but remain inactive and unavailable for new records.
- **A report is filtered to a date before the hierarchy existed.** It uses the current chart
  structure to organize the historical movements without changing their dates or values.
- **A statement line is unmatched during a scripted merge.** It remains in its original statement
  session, which is now filed under the surviving account.

## Requirements _(mandatory)_

### Functional Requirements

**Fixed account types and behavior**

- **FR-001**: The system MUST provide exactly five system-defined account types: Asset, Liability,
  Equity, Revenue and Expense.
- **FR-002**: Users MUST NOT be able to create, rename, reorder or delete account types.
- **FR-003**: Each account type MUST determine its normal balance and financial-statement placement
  according to the Fixed Accounting Rules table.
- **FR-004**: The chart and financial reports MUST use **Revenue** for the fixed account type.
  Transaction actions and filters MUST use **Income** and **Expense**, and MUST NOT use
  plain-language substitutes such as "money in", "money out" or "earned" as labels.
- **FR-005**: Business-specific descriptions such as bank, wallet, loan, supplier, customer,
  marketplace or advertising MUST NOT be fundamental account types.
- **FR-006**: Every account MUST follow the same lifecycle and validation rules regardless of its
  type, except where the type's normal balance or report placement necessarily differs.

**Accounts, codes and hierarchy**

- **FR-007**: Every account MUST have a system-assigned, auto-incrementing numeric code, a name, a
  fixed type and an active state, and MAY have one parent account.
- **FR-008**: When an account is created, the system MUST assign the next unused code in the seeded
  number range for its fixed type: Asset `1000–1999`, Liability `2000–2999`, Equity `3000–3999`,
  Revenue `4000–4999` and Expense `5000–5999`. Codes MUST be globally unique and users MUST NOT
  need to enter them manually.
- **FR-009**: Account names MAY repeat; code and hierarchy MUST keep repeated names distinguishable
  in lists, pickers and reports.
- **FR-010**: An account's type MAY change only while the account has no movements, children,
  reconciliation history or saved-default use. A permitted type change MUST assign the next unused
  code in the new type's range.
- **FR-011**: A child and every ancestor above it MUST share the same fixed type.
- **FR-012**: The account hierarchy MUST refuse cycles, including a parent pointing to itself or to
  any descendant.
- **FR-013**: An account with one or more children MUST be a non-posting parent and MUST NOT appear
  as selectable on a new or edited record.
- **FR-014**: An account with any movement MUST NOT gain a child.
- **FR-015**: A parent account's displayed balance MUST be the sum of its descendants, with every
  descendant movement counted exactly once.
- **FR-016**: A posting account's displayed balance MUST continue to be calculated from its ledger
  movements rather than stored as an independently editable figure.
- **FR-017**: An account with movements, children, reconciliation history or saved-default use MUST
  NOT be deleted.
- **FR-018**: An account with financial history MUST be deactivated rather than deleted; its history
  and report contribution MUST remain available.
- **FR-019**: A parent account MAY be deactivated only after every descendant is inactive and it is
  no longer used by a saved default.
- **FR-020**: Inactive accounts MUST remain findable behind an explicit control but MUST NOT be
  offered on new records or as new saved defaults.

**One chart experience**

- **FR-021**: The system MUST provide one Chart of Accounts containing accounts of all five types.
- **FR-022**: The chart MUST display all five fixed types together on one page as clearly separated
  sections, without requiring tabs or page navigation to move between types.
- **FR-023**: Within each type section, the chart MUST show the code, name, hierarchy, active state,
  direct balance when applicable and rolled-up balance when applicable.
- **FR-024**: The chart MUST order accounts predictably by code within their parent.
- **FR-025**: Users MUST be able to search the chart by partial code or name without losing enough
  ancestor context to understand where a result sits.
- **FR-026**: The current separate Categories management destination MUST be retired; Revenue and
  Expense accounts MUST be managed through the Chart of Accounts under the same permissions and
  lifecycle as every other account.
- **FR-027**: Every existing account deep link MUST continue to reach that account after conversion
  or, after a scripted merge, its surviving destination.
- **FR-028**: Account changes MUST continue to be permission-controlled, audited and reflected to
  other open sessions.

**Saved defaults and automatic records**

- **FR-029**: The system MUST store administrator-selected defaults for at least: money owed to us,
  money we owe, opening balances, sales revenue, uncategorised expenses and the everyday
  transaction account.
- **FR-030**: The money-owed-to-us default MUST reference an active Asset posting account.
- **FR-031**: The money-we-owe default MUST reference an active Liability posting account.
- **FR-032**: The opening-balances default MUST reference an active Equity posting account.
- **FR-033**: The sales-revenue default MUST reference an active Revenue posting account.
- **FR-034**: The uncategorised-expense default MUST reference an active Expense posting account.
- **FR-035**: The everyday-transaction default MUST reference an active Asset posting account.
- **FR-036**: An automatic action MUST refuse to create a record when a required saved default is
  missing or invalid, and MUST identify the setting that needs attention.
- **FR-037**: Invoices, owed-money flows, opening balances, imports and other automatic record
  creators MUST use the saved account references rather than account names or business-specific
  account roles.
- **FR-038**: Changing a saved default MUST affect only records created afterwards; historical
  records MUST keep their original accounts.
- **FR-039**: The selected defaults MUST be visible and changeable together so an administrator can
  review the automatic bookkeeping setup as one coherent set.

**Records, contacts and reconciliation**

- **FR-040**: Every saved record MUST continue to contain at least two non-zero movements whose
  signed values total zero.
- **FR-041**: Record forms and automatic record creators MUST select accounts through a common
  account contract based on type, active state and posting eligibility, rather than a list of
  hard-coded account roles.
- **FR-042**: Contacts MUST remain separate from accounts. A supplier or customer MUST NOT require
  its own general-ledger account; the record continues to identify who it concerns.
- **FR-043**: Settlement behavior MUST identify receivable and payable movements through the saved
  Asset and Liability accounts, while leaving contacts and settlement amounts unchanged.
- **FR-043a**: Partner statements MUST identify a partner through the contact named on records and
  MUST classify that partner's Equity movements by direction; a partner MUST NOT require a special
  account type or a permanently dedicated account.
- **FR-044**: A permitted user MUST be able to reconcile any active posting account of any fixed
  type when a statement for that account is supplied.
- **FR-045**: A statement MUST belong to exactly one posting account, and only movements touching
  that account MAY be offered as matches.
- **FR-046**: Reconciliation MUST NOT be offered for a parent account.
- **FR-047**: Matching, unmatching or completing a statement MUST continue to change reconciliation
  evidence only and MUST NOT change ledger movement amounts.

**Reports**

- **FR-048**: The Balance Sheet MUST derive its Asset, Liability and Equity sections from account
  type rather than account role or account name.
- **FR-049**: The Income Statement MUST derive its Revenue and Expense sections from account type
  rather than account role or account name.
- **FR-050**: Net profit MUST equal Revenue minus Expense for the chosen period.
- **FR-051**: The Balance Sheet MUST continue to include accumulated profit or loss in Equity so the
  statement balances without requiring an automatic year-end closing entry.
- **FR-052**: Reports MUST support hierarchical detail and subtotals without counting a movement
  more than once in any total.
- **FR-053**: Transfers between accounts that are all outside Revenue and Expense MUST NOT affect
  the Income Statement.
- **FR-054**: Dashboard figures, account balances, exports and formal reports MUST use the same
  account-type and hierarchy rules so the same account cannot be classified differently between
  surfaces.

**Default chart and existing-book conversion**

- **FR-055**: A new installation MUST seed the following posting accounts and account codes,
  organized within their fixed-type sections on the unified page. Users MAY rename, extend,
  deactivate or reorganize them subject to the
  normal account rules.

| Code | Name                 | Type      |
| ---- | -------------------- | --------- |
| 1000 | Cash                 | Asset     |
| 1100 | Bank                 | Asset     |
| 1200 | Accounts Receivable  | Asset     |
| 1300 | Inventory            | Asset     |
| 1400 | Marketplace Clearing | Asset     |
| 2000 | Accounts Payable     | Liability |
| 2100 | Loans                | Liability |
| 3000 | Owner's Equity       | Equity    |
| 3100 | Retained Earnings    | Equity    |
| 4000 | Product Sales        | Revenue   |
| 4100 | Other Revenue        | Revenue   |
| 5000 | Cost of Goods Sold   | Expense   |
| 5100 | Advertising          | Expense   |
| 5200 | Packaging            | Expense   |
| 5300 | Shipping             | Expense   |
| 5400 | Software             | Expense   |
| 5500 | Utilities            | Expense   |
| 5900 | Other Expenses       | Expense   |

- **FR-056**: The new-install chart MUST select compatible initial saved defaults from the seeded
  accounts and MUST clearly identify any additional choice the administrator must make before an
  automatic action can run.
- **FR-057**: Conversion MUST map every existing account role to the fixed type it represents today,
  including inactive accounts, without changing movements or balances.
- **FR-058**: Conversion MUST assign every existing account a globally unique code within the number
  range associated with its fixed type, preserving the account's current stable order where
  possible.
- **FR-059**: When a desired code is occupied, conversion MUST keep both accounts, choose another
  unused code in the same type range and report the difference.
- **FR-060**: Conversion MUST add a missing default-chart account only when no existing account has
  already been selected to serve that purpose.
- **FR-061**: Conversion MUST merge an existing account with a seeded duplicate only when both have
  the same fixed type and normalized name, or when the existing name appears in the recorded
  legacy-name list for that seeded account; all other similarities MUST remain separate.
- **FR-061a**: The legacy-name list MUST be written down as data, one entry per judgement, and MUST
  NOT be inferred at run time from spelling similarity. A name not on it MUST keep its own account,
  its own name and its own code.
- **FR-061b**: Where a recorded legacy name means a seeded account whose name is not yet taken,
  conversion MUST rename the existing account rather than create the seed beside it, so the account
  keeps its identity, its movements and its references. Where several legacy names mean one seeded
  account, the first MUST be renamed and the rest merged into it.
- **FR-061c**: Conversion MUST retype an account whose recorded legacy kind was wrong — equipment
  filed as an expense category (002 FR-006b) — before any code is assigned, so it receives a code in
  its new type's range. Such a reclassification MUST appear in the summary as an item needing
  attention, because it moves records between the profit and loss and the balance sheet. It is the
  only permitted retype of an account that already has movements.
- **FR-062**: The existing account MUST survive a merge with a seeded duplicate so its identity and
  links remain stable. Where the merge is by recorded legacy name rather than an identical one, the
  seeded-named account MUST survive instead, because the legacy name is the name being corrected.
- **FR-063**: Merges MUST run without a proposal screen or user-confirmation step.
- **FR-064**: A scripted merge MUST move movements, statement ownership, saved defaults and every
  other account reference to the survivor as one complete operation; a partial merge MUST leave no
  lasting change.
- **FR-065**: A scripted merge MUST preserve statement sessions and their individual allocations;
  it MUST NOT collapse two statements into one.
- **FR-066**: A scripted merge MUST leave an audit record identifying the source, survivor, time
  and affected-reference counts.
- **FR-067**: After a scripted merge, an old link or reference to the source account MUST resolve to
  the survivor rather than an empty or unrelated account.
- **FR-068**: If a possible merge would mix account types, make a hierarchy cycle or otherwise fail
  the safe-merge rules, the script MUST leave both accounts unchanged and list the reason in its
  summary.
- **FR-069**: Before conversion is accepted as complete, the system MUST verify that every record is
  balanced and that account balances and financial-report totals equal their pre-conversion values.
- **FR-070**: Conversion MUST be safe to retry without duplicating accounts,
  codes, parents, defaults, movements, statements or audit records.
- **FR-070a**: Conversion MUST run by itself when the installation starts, with no command and no
  setting (002 FR-037), for a book still on the pre-ledger schema and for one converted to
  double-entry but never standardized. It MUST run against a copy and install the result only after
  every check has passed, MUST leave the original byte-identical on failure, and MUST NOT let the
  installation start on a partly standardized chart.
- **FR-070b**: Conversion MUST rewrite the category name recorded on every unfinished import-review
  row through the same legacy-name list, so a row waiting for review keeps the category it was read
  as instead of falling back to the uncategorised account.
- **FR-071**: Conversion MUST produce a reviewable summary of created accounts, assigned codes,
  hierarchy placement, saved defaults, completed merges, renamed legacy names, retyped accounts,
  rewritten import-review categories, skipped merge candidates and any item needing attention.

### Key Entities

- **Account Type**: One of the five fixed accounting classes. It owns the normal-balance and
  financial-statement rules and is not managed by users.
- **Account**: A code-and-name line in the chart with one fixed type, an active state and optionally
  one parent. Its direct balance comes from its movements; its rolled-up balance includes
  descendants.
- **Account Hierarchy**: Same-type parent and child relationships. Parents organize and subtotal;
  posting accounts receive movements.
- **Saved Account Default**: A named automatic-bookkeeping purpose linked to one compatible active
  posting account. Changing it does not rewrite history.
- **Migration Script**: The one-time, repeat-safe conversion operation that assigns types and codes,
  seeds missing accounts and performs only deterministic safe merges.
- **Merge Audit**: Permanent evidence of a scripted account merge and where old references now
  lead.
- **Ledger Record and Movement**: The existing source of financial truth. A record describes what
  happened; its movements say which accounts changed and must total zero.
- **Contact**: The existing person or organization attached to a record. It remains separate from
  the chart of accounts.
- **Statement**: Evidence supplied for one posting account and matched to that account's movements.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An administrator can create and correctly place a new posting account of any fixed
  type in under two minutes without entering a code or choosing a business-specific account role.
- **SC-002**: In a chart containing at least 250 accounts and five hierarchy levels, 95% of code or
  name searches show the matching rows with their ancestor context within one second on supported
  hardware.
- **SC-003**: Every tested parent subtotal and financial-report total counts each descendant
  movement exactly once, with zero rounding or classification differences from the underlying
  movements.
- **SC-004**: Automatic invoice, owed-money, opening-balance and import scenarios use the selected
  compatible defaults in 100% of acceptance tests and create no record when a required default is
  invalid.
- **SC-005**: Statements can be started and matched successfully against a posting account under
  each of the five fixed types, with zero movements from another account offered as eligible
  matches.
- **SC-006**: After conversion of a representative populated installation, 100% of ledger records,
  contacts, attachments, settlements, statements and statement allocations remain reachable.
- **SC-007**: Pre-conversion and post-conversion account balances, Balance Sheet totals, Income
  Statement totals and net profit match exactly to the smallest stored currency unit.
- **SC-008**: The migration script merges 100% of seeded duplicates that meet the safe-merge rules,
  skips 100% of pairs that do not, and leaves zero references pointing at a retired source.
- **SC-009**: Running the migration script more than once produces zero duplicate accounts,
  codes, hierarchy links, defaults, movements, statements or audit entries.
- **SC-010**: In usability verification on both a phone-sized and desktop-sized screen, a user can
  find an account, understand its type and parent path, and open it without horizontal page
  scrolling.
- **SC-011**: No user-created account is excluded from reports, record selection or reconciliation
  merely because its business use was not known when Akaun was built.
- **SC-012**: All five account-type sections and their totals are available in one Chart of Accounts
  page, and a user can compare accounts across types without changing tabs or opening another page.

## Assumptions

- The existing double-entry ledger remains the financial source of truth; this feature does not
  create a second journal or separate debit and credit stores.
- Contacts remain the way to identify suppliers, customers, employees, partners and platforms. A
  supplier or customer does not receive its own general-ledger account merely because it is a
  counterparty.
- Account subtype, free-form capabilities, analytical dimensions, tax configuration, stock
  valuation, automatic depreciation and automatic year-end closing are outside this feature.
- Parent accounts are headings only. All new movements are written to active leaf accounts.
- The five account types are shared across all installations and cannot be customized.
- Codes are system-assigned numeric values. Each fixed type begins with the seeded four-digit codes
  listed in FR-055, and new accounts receive the next unused code in that type's range.
- Existing names are preserved during conversion. Normalizing a name is used only to identify a
  scripted seeded-account duplicate, never to rename an account.
- The current installation has one user, so account deduplication is a one-time scripted migration;
  an interactive proposal and approval workflow is outside this feature.
- Existing permissions for managing accounts also govern the full Chart of Accounts. Existing
  reconciliation permissions continue to govern who may reconcile.
- Existing accumulated-profit reporting continues. Posting a formal year-end close into Retained
  Earnings is deferred.
- Reconciliation is offered for every posting account when a statement is supplied, even when that
  account is Revenue, Expense, Liability or Equity.
- The current account detail address remains the canonical link. A scripted merge preserves old
  links by resolving the retired source to its survivor.
