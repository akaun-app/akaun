# Feature Specification: Multi-record Auto Import

**Feature Branch**: `develop` (no feature branch created)

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description:

> Multi-record Auto Import: let one imported source document (for example a fee document that also has header numbers, subtotals, balances and unrelated tables) produce several records, one per fee line, instead of exactly one. At upload the user chooses the document type: "Receipt or invoice (one record)", which behaves as today, or "Document with several items (one record each)". Only the fee lines become records; header numbers, totals, balances and unrelated tables are ignored. The items from one document appear grouped in the review queue, with a control-total check (sum of the items against the document's own stated fee total, compared in whole cents), an expandable list of the lines the system deliberately ignored, one "paid from" account applied to all items, and Confirm all / Skip all. Each item stays individually editable, skippable and duplicate-checked, and items from the same document never flag each other as duplicates. One stored source file is attached to every record created from the document and survives deleting any single attachment. Re-uploading a document that was already imported is stopped early with a clear message. A document that yields exactly one item behaves exactly like a receipt today; one that yields none fails with "No items found". Extraction must never silently drop lines: an over-long document fails with a reason instead of being truncated. A later phase lets users define their own import profiles: a custom JSON Schema in which fixed field names map to the ledger, per-profile instructions, and a closed fee-type list where each type can pin a category account. Out of scope: bank statements (they stay in Reconciliation, spec 001 FR-012), CSV import, one row producing several records, a table-style review page, and sending page images to a vision model. This supersedes spec 002's out-of-scope note about pulling more than one record out of a single imported document. Full design brief and rationale: /home/haoquantang/.claude/plans/currently-the-auto-import-elegant-lecun.md

## Glossary

| Term | Plain meaning |
|---|---|
| Source document | A file (PDF or photo) that is itself the evidence of the transactions on it, such as a supplier's fee notice. A bank statement is *not* one: it only lists money that moved, and is matched against records (`001-bank-reconciliation`). |
| Item | One charge listed in a source document, for example one fee. Each item becomes its own record. |
| Header numbers | Figures in a document's heading or summary that are not charges of their own: subtotals, totals, amount due, balance brought forward, payments received, account and reference numbers. |
| Ignored line | A line the system saw in the document and deliberately did not turn into an item, such as a subtotal. Shown to the reviewer so they can see what was left out. |
| Document group | The review cards that came from one uploaded document, shown together. |
| Review card | The existing Auto Import card where a person checks and edits one proposed record before confirming it. |
| Stated fee total | The total the document itself prints for exactly its fee lines (for example "Total charges"). It is not the amount due, a balance, or a grand total that includes other things. |
| Control total | A check that adds up the items and compares the result with the stated fee total, to the cent. It catches a fee that was missed or counted twice. |
| Possible duplicate | The existing warning on a review card that a proposed record looks like one already in the books. |
| Accounts payable / Accounts receivable | What the business owes / what the business is owed. An imported document starts on one of these because it proves an amount is owed, not that money moved. |
| Import profile | *(Later phase)* A saved recipe for one kind of document: instructions for reading it, the layout of an item, and optionally a list of fee types. |
| Item layout | *(Later phase)* The description of what one item looks like, written as a JSON Schema: a standard, machine-checkable way to list fields and the values each may hold. |
| Fee type | *(Later phase)* A named kind of charge in a profile, such as "Commission". It can be tied to a category so items of that type always land in it. |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One document with several fees becomes several records (Priority: P1)

Today a document can only become one record. A fee document lists several separate charges, say a commission, a service fee and a payment-processing fee, and the user wants each as its own expense in its own category. At upload the user chooses "Document with several items (one record each)". The system reads the document, proposes one record per fee, and the user reviews and confirms them.

**Why this priority**: This is the whole request. Without it the user keys each fee in by hand from the same document, every month.

**Independent Test**: Upload a fee document with three fee lines using the several-items choice and confirm all three. The Records list shows three records with the right amounts and the same supplier, date and reference, and each record has the document attached.

**Acceptance Scenarios**:

1. **Given** the upload screen, **When** the user opens the document-type choice, **Then** they see "Receipt or invoice (one record)", selected by default, and "Document with several items (one record each)".
2. **Given** a document with three fee lines uploaded as several items, **When** reading finishes, **Then** three review cards appear together as one group, each with its own description, amount and category, and all three carry the document's supplier, date and reference.
3. **Given** that group of three, **When** the user confirms each card, **Then** three separate records exist, each with the source document attached.
4. **Given** the same document uploaded as "Receipt or invoice", **When** reading finishes, **Then** one review card appears exactly as it does today.
5. **Given** a document with only one fee line, **When** it is uploaded as several items, **Then** one ordinary review card appears, with no group.
6. **Given** a document with no fee lines, **When** it is uploaded as several items, **Then** the upload fails with "No items found" and can be discarded like any failed upload.
7. **Given** the user chose "Document with several items" for one upload, **When** they upload the next document on the same device, **Then** that choice is still selected.
8. **Given** a document too long to be read in full, **When** it is uploaded as several items, **Then** the upload fails with a reason that names the limit reached, and no items appear.
9. **Given** a document in a foreign currency, **When** it is read as several items, **Then** every card shows the currency and its exchange rate, or asks for one, exactly as a receipt card does.
10. **Given** an upload that names a document type the system does not recognise, **When** it is submitted, **Then** it is rejected with a clear message and nothing is uploaded.

---

### User Story 2 - Only the fee lines are imported; header numbers are left out (Priority: P1)

Real documents carry more numbers than fees: an amount due in the header, subtotals, a tax summary, a balance brought forward, other tables such as a list of orders. Only the fee lines should become records. Everything else must stay out of the books, and the reviewer must be able to see what was left out.

**Why this priority**: A wrong record in the books is worse than a missing one, because nobody notices it. Importing a total next to the fees it adds up would count the same money twice.

**Independent Test**: Upload a document with a header total, a subtotal, a balance brought forward, a table of orders and three fee lines. Exactly three items are proposed, and the ignored lines list names the header total, the subtotal and the balance.

**Acceptance Scenarios**:

1. **Given** a document with header numbers and fee lines, **When** it is read as several items, **Then** only the fee lines are proposed and no header number, subtotal, total or balance becomes an item.
2. **Given** a document that also contains a table of orders or transactions, **When** it is read as several items, **Then** the rows of that table do not become items.
3. **Given** a group where some lines were left out, **When** the reviewer looks at the group header, **Then** it shows "Ignored N lines" and opening it lists a short piece of text for each one, for example "Subtotal 1,230.00".
4. **Given** the ignored lines list, **When** it is shown, **Then** it is presented as a guide and the screen does not claim it is complete.
5. **Given** a fee the system missed, **When** the reviewer notices, **Then** they add it as an ordinary record from the Records screen; the group itself has no way to add an item.

---

### User Story 3 - A missed or double-counted fee is caught (Priority: P1)

Deciding which lines are fees is a judgement and can be wrong. Adding up is arithmetic and cannot. When the document prints its own total for its fee lines, the system compares that total with the sum of the proposed items, so a missed or doubled fee shows up before anything is confirmed.

**Why this priority**: It is the cheapest dependable signal that the reading was right, and it is what lets the user trust "Confirm all".

**Independent Test**: Use a document whose stated fee total equals the sum of its fee lines, and one where the reading is short by one fee. The first shows "matches"; the second shows the exact difference.

**Acceptance Scenarios**:

1. **Given** a stated fee total equal to the sum of the items, **When** the group is shown, **Then** the Control total shows that it matches.
2. **Given** a sum that differs from the stated fee total by even one cent, **When** the group is shown, **Then** it shows the difference with a warning, and confirming is still allowed.
3. **Given** a document that prints no total for its fee lines, **When** the group is shown, **Then** no Control total is shown, so nothing implies a check that did not happen.
4. **Given** a document whose header shows an amount due or a balance as well as a fee total, **When** the check runs, **Then** it uses the fee total and never the amount due or the balance.

---

### User Story 4 - Review a group quickly without losing control of each item (Priority: P2)

A group of ten cards is tedious if every card must be handled alone, and dangerous if one click can push through something that needs a look. The group offers shared actions, and each item keeps its own controls.

**Why this priority**: Without shared actions the feature works but is slow; without per-item control it is unsafe. Both are needed for real use, but the records already come out right without them.

**Independent Test**: With a group of five items, one flagged as a possible duplicate, choose one Source account for the group and press "Confirm all". Four records are created and the flagged item stays for individual review, with a message saying which and why.

**Acceptance Scenarios**:

1. **Given** a group, **When** the user picks a Source account on the group, **Then** every item shows that Source account, and changing one item afterwards changes only that item.
2. **Given** a group with nothing that needs attention, **When** the user presses "Confirm all", **Then** one record is created per item, each record's activity shows its creation as it does for a receipt import, and the group moves to history.
3. **Given** a group with one item flagged as a possible duplicate and one missing an exchange rate, **When** the user presses "Confirm all", **Then** the other items are confirmed, and the two remain with a message naming each item and the reason.
4. **Given** a group, **When** the user presses "Skip all", **Then** every item still awaiting review is skipped, no records are created, and the stored file is removed if no record uses it.
5. **Given** a group, **When** the user skips one item, **Then** the other items are unaffected and the source file is kept while anything still uses it.
6. **Given** items from one document, **When** duplicates are checked, **Then** no item is flagged as a duplicate of another item from the same document.
7. **Given** an item that matches an existing record (same reference, or same date, amount and contact), **When** it is shown, **Then** it is flagged as a possible duplicate with the usual "Import anyway" choice.
8. **Given** this month's fee document that repeats last month's fees with different dates and references, **When** it is read, **Then** its items are not flagged because the wording is similar.
9. **Given** an item that has been confirmed, **When** the user looks at the import history, **Then** its entry links to the record it created.
10. **Given** a group where two items are already confirmed, **When** the user discards the document, **Then** the items still awaiting review disappear and the two records stay.
11. **Given** an item the books refuse to record (for example no account chosen), **When** the user confirms it, **Then** no record, no new contact and no attachment is left behind, and the item stays ready to fix.
12. **Given** a user without permission to change imports, **When** they try to confirm, skip or discard an item, **Then** it is refused, as it is for a receipt today.
13. **Given** the same group open in two browser tabs, **When** items are confirmed or skipped in one, **Then** the other tab updates without a reload.
14. **Given** a phone-width screen, **When** the user opens a group, **Then** the header, its actions and the cards are usable without sideways scrolling.

---

### User Story 5 - One stored file, many records (Priority: P2)

Every record made from a document points to the same stored copy of it. A person looking at any one of the records can open the source, and removing it from one record must never break the others.

**Why this priority**: A source document that vanishes from other records after one deletion silently damages the audit trail, which is the reason to attach it at all.

**Independent Test**: Confirm all items of a three-item document, delete the attachment from one record, and check the other two still open the document; delete it from the last two and check the file is gone.

**Acceptance Scenarios**:

1. **Given** all items of a document confirmed, **When** the user opens any of the records, **Then** the source document is attached, and only one copy is stored.
2. **Given** three records sharing one file, **When** the attachment is deleted from one of them, **Then** the other two can still open it.
3. **Given** a file attached to a single remaining record, **When** that attachment is deleted, **Then** the stored file is removed.
4. **Given** some items confirmed, **When** the user clears the import history, **Then** a file that a record still uses is kept.
5. **Given** a document already imported as several items with at least one record created, **When** the identical file is uploaded again as several items, **Then** it is stopped before reading, with a message saying it was already imported and how many records that produced.
6. **Given** an earlier upload of the same file whose items were all skipped or discarded, **When** it is uploaded again, **Then** it is read normally, because nothing was imported.
7. **Given** records created from one document, **When** the user searches for the wording of one fee line, **Then** only the record for that fee is found, not the other records from the same document.

---

### User Story 6 - Define an import profile for a kind of document (Priority: P3, later phase)

The built-in reading of a fee document is general. A user who receives the same kind of document every month, say a marketplace's monthly fee notice, wants to say once how to read it: where the fees are, which lines count, what to call them and which category each kind of fee belongs in. They create an import profile, choose it at upload, and get the same result each month.

**Why this priority**: It moves the decision "what counts as a fee" from one general instruction for everything to a recipe per kind of document. A closed list of fee types is the most dependable form of it: the reader may propose only lines that match a listed type, and the category becomes a lookup instead of a guess. It comes after the built-in reading is proven on real documents.

**Independent Test**: Create a profile with instructions and three fee types, two of them tied to categories. Import a sample document with it. Only lines matching the listed types become items, and the tied categories are applied.

**Acceptance Scenarios**:

1. **Given** the place in Settings where the AI providers are managed, **When** a user allowed to change imports opens it, **Then** they can add, edit, disable and delete import profiles.
2. **Given** an item layout that breaks the rules, **When** the user saves, **Then** it is rejected with a message saying what is wrong and where, and nothing is saved.
3. **Given** an enabled profile, **When** the user uploads a document, **Then** the profile appears in the choice beside the two built-in options, and the document is read with the profile's instructions in place of the general ones.
4. **Given** a profile with fee types, **When** a document is read with it, **Then** lines that match no listed type are not proposed, and each proposed item's remark names its fee type.
5. **Given** a fee type tied to a category, **When** an item of that type is proposed, **Then** it gets that category; a type not tied to one gets the system's suggestion if it is valid, and Uncategorised otherwise.
6. **Given** an item layout with extra fields such as an order number, **When** a document is read, **Then** each item shows those values, and they are added to the record's remark as "name: value".
7. **Given** the AI provider rejects a profile's item layout, **When** a document is read with it, **Then** only that document fails, with the reason shown, and every other document is read as before.
8. **Given** any change to a profile, **When** it is saved, **Then** it is recorded in the audit trail.

---

### Edge Cases

- The document lists the same fee twice. Both appear as items and the reviewer can skip one. When the document states a fee total, the Control total shows the difference.
- A document lists credits, discounts or refunds. They do not become records in this phase; they appear under ignored lines, and the Control total may then differ, which is the visible sign.
- A document mixes kinds, for example sales income and fees. It is read as one kind (expense or income) as a whole. Lines of the other kind appear under ignored lines.
- The document date is missing. The same fallback as a receipt is used.
- Amounts are in a foreign currency. The document has one currency, each card's currency and rate can be edited as on a receipt today, and the Control total is compared in the document's own currency.
- The document is too long or has too many items. The upload fails with a reason naming the limit; it is never cut short (FR-009).
- Reading fails part-way. No partial group is shown.
- Two browser tabs are open. Both update live as items are confirmed or skipped.
- Every item of a group is confirmed or skipped. The group leaves the review queue and appears in history.
- The AI provider is unavailable. The upload fails with the same message a receipt gets today, and entering records by hand is unaffected.
- The server restarts while a document is being read. Reading starts again, as it does for a receipt.

## Requirements *(mandatory)*

### Functional Requirements

**Choosing how a document is read**

- **FR-001**: At upload the user MUST be able to choose between "Receipt or invoice (one record)" and "Document with several items (one record each)". The first is the default. An upload that states no choice, for example one sent by an automated tool, MUST be read as a receipt or invoice.
- **FR-002**: The last choice MUST be remembered on that device for the next upload.
- **FR-003**: A choice the system does not recognise MUST be rejected with a clear message, and nothing is uploaded.
- **FR-004**: A document read as "Receipt or invoice" MUST behave exactly as it does today: same fields, same review card, same possible-duplicate check, same confirm. The only change to receipts is the history link in FR-021.

**Reading a document with several items**

- **FR-005**: The system MUST propose one record per item and MUST NOT propose anything for header numbers, subtotals, totals, amount due, balance brought forward, payments received, account or reference numbers, or unrelated tables.
- **FR-006**: All items from one document MUST share the document's other party (the supplier for an expense, the customer for income), date, reference, currency and kind (expense or income). An item that states its own date or reference uses that one for itself only.
- **FR-007**: Each item MUST be handled as a receipt is: the other party is matched to an existing contact or offered as a new one, a foreign-currency amount gets an exchange rate, the category is one of the user's categories or Uncategorised, and amounts are kept in whole cents.
- **FR-008**: A document that yields exactly one item MUST behave as a receipt: one review card, no group. A document that yields none MUST fail with "No items found".
- **FR-009**: The system MUST NOT silently drop lines. A document too long to be read in full, or with more items than the limit, MUST fail with a reason that names the limit reached (initial limits are in Assumptions).
- **FR-010**: Items MUST appear only when the whole document was read successfully. If reading fails part-way, no partial group is shown.
- **FR-011**: The system MUST keep a short list of the lines it deliberately left out and show it on the group as an expandable "Ignored N lines". The screen MUST NOT claim the list is complete.

**Checking the result**

- **FR-012**: When the document states its own total for the fee lines, the group MUST show a Control total: the items added up, in whole cents of the document's own currency, against the stated fee total, as either "matches" or "differs by" the amount. The check reflects the items as read, not later edits or skips.
- **FR-013**: A difference MUST warn but MUST NOT block confirming. When the document states no such total, no Control total is shown.
- **FR-014**: The stated fee total means the total of exactly the lines proposed as items. An amount due, a balance, or a grand total that includes other charges MUST NOT be used as the stated fee total.

**Reviewing a group**

- **FR-015**: Items from one document MUST appear together as one group in the Auto Import review queue, showing the file name, the number of items, the Control total, the ignored lines and the group actions.
- **FR-016**: The group MUST offer one Source account choice that fills the Source account of every item at once. Each item can still be changed afterwards without affecting the others.
- **FR-017**: The group MUST offer "Confirm all" and "Skip all".
- **FR-018**: "Confirm all" MUST confirm the items one after another. It MUST leave behind, and tell the user about, any item that needs attention (flagged as a possible duplicate, or missing something required such as an exchange rate or an account), naming the item and the reason. One item failing MUST NOT stop or undo the others.
- **FR-019**: Each item MUST stay individually editable, confirmable and skippable, with the same fields as a receipt review card. Skipping or discarding one item MUST NOT change the other items, and MUST NOT remove the source file while any other item or record still uses it.
- **FR-020**: Discarding the whole document MUST remove only the items still awaiting review. Records already created stay, and so does the source file while a record uses it.
- **FR-021**: A confirmed item's history entry MUST link to the record it created. Confirmed receipts get the same link.
- **FR-022**: The group and its actions MUST be usable at phone widths.

**Duplicates**

- **FR-023**: Each item MUST be checked against the existing records with the same signals as today (reference, amount, date and contact) and flagged the same way, with the same "Import anyway" choice.
- **FR-024**: Items from the same document MUST NOT flag each other, and the document's shared file name or wording MUST NOT count as evidence that an item duplicates an older record. A document that repeats last month's fees, with the same other party and amounts but a different date and reference, MUST NOT be flagged on similar wording alone.
- **FR-025**: A file identical to one already imported, as a receipt or as several items with at least one record created, MUST be stopped before reading when it is uploaded as several items. The message MUST say it was already imported and how many records that produced. If the earlier upload produced no records, the upload proceeds.

**The source file**

- **FR-026**: One stored copy of the source file MUST be attached to every record created from the document.
- **FR-027**: Deleting an attachment from one record MUST remove the stored file only when no other record uses it. Clearing the import history MUST likewise never remove a file a record still uses.
- **FR-028**: A record created from a several-items document MUST NOT carry the whole document's text as its searchable content. It is found by its own description, contact, reference and amount.

**Safety, permissions and live updates**

- **FR-029**: Confirming an item MUST either fully succeed or leave nothing behind: no record without its import status, and no new contact left over from a refused record.
- **FR-030**: Choosing "Document with several items" MUST need only the permission to upload imports that exists today. Confirming, skipping and discarding MUST need the same permissions as today. No new permission is introduced.
- **FR-031**: Every record created MUST be audited exactly as records from a receipt import are today.
- **FR-032**: As items are proposed, confirmed, skipped or discarded, every open Auto Import screen MUST update without a reload.
- **FR-033**: Upgrading MUST NOT change or remove anything already in the queue, the import history or the records.

**Boundaries**

- **FR-034**: Bank statements stay in Reconciliation. Nothing uploaded to Auto Import creates statement lines, and statement lines never enter Auto Import (unchanged from `001-bank-reconciliation` FR-012).

**Import profiles (later phase, User Story 6)**

- **FR-035**: A user allowed to change imports MUST be able to add, edit, disable and delete import profiles. A profile has a name, instructions, an item layout and, optionally, fee types. Enabled profiles appear in the upload choice beside the two built-in options.
- **FR-036**: A profile's item layout MUST use the fixed field names the books understand (description, amount, category, date, reference, currency, supplier) and a required list of items. Other fields are allowed: they are shown on the item and added to the record's remark as "name: value".
- **FR-037**: An item layout that breaks the rules (no list of items, a field holding the wrong kind of value, a feature the system does not support, or too large) MUST be rejected on save with a message saying what is wrong and where. Nothing is saved.
- **FR-038**: A profile's instructions MUST apply only to documents read with that profile, in place of the general import instructions.
- **FR-039**: When a profile lists fee types, the system MUST propose only lines that match a listed type. A type MAY be tied to a category: the tied category wins, otherwise the system's suggested category is used if valid, otherwise Uncategorised. The item's fee type MUST be added to its remark.
- **FR-040**: If the AI provider rejects a profile's item layout, only that document MUST fail, with the reason shown. It MUST NOT change how any other document is read.
- **FR-041**: Adding, editing, disabling or deleting a profile MUST be audited.

### Key Entities *(include if feature involves data)*

- **Source document**: The uploaded file. It keeps the way it was to be read (receipt or several items), its stored copy, the stated fee total and the ignored lines.
- **Item**: One proposed record from a source document. It has the same details as today's proposed record, plus the group it belongs to. It ends confirmed, skipped or discarded.
- **Document group**: The items of one source document, viewed together. It exists only when a document yielded more than one item.
- **Ignored line**: A short piece of text for a line the system saw and left out, kept with the source document for the reviewer.
- **Import profile** *(later phase)*: A named recipe (instructions, item layout, optional fee types) chosen at upload.
- **Fee type** *(later phase)*: A named kind of charge in a profile, optionally tied to a category.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can turn a document with ten fee lines into ten confirmed records with no edits in under two minutes of hands-on time (upload, choose, "Confirm all"), instead of entering ten records by hand.
- **SC-002**: On the maintainer's sample documents (at least three real documents that carry header numbers and tables), no header number, subtotal, total or balance is ever proposed as an item.
- **SC-003**: On the same samples, every fee line is proposed, or the group shows a visible warning (a Control total difference, or an ignored line the reviewer can see should not have been left out). No sample produces a wrong set of items with no sign of it.
- **SC-004**: When a document states a fee total, a difference of even one cent between it and the items is shown every time.
- **SC-005**: Receipts and invoices uploaded the usual way behave as before, apart from the history link in FR-021: every existing import scenario passes unchanged, and items already in the queue or the history before the upgrade look and behave as they did.
- **SC-006**: After "Confirm all" on N items there are exactly N new records and one stored file. After the attachment is deleted from one record the other N−1 still open the file, and after it is deleted from the last one no stored file remains.
- **SC-007**: No item is flagged as a duplicate of another item from its own document, and a document repeating last month's fees is not flagged on wording alone (checked with a two-month example).
- **SC-008**: The same file uploaded twice as several items is stopped before reading every time the first upload created at least one record.
- **SC-009** *(later phase)*: A user can create a profile for a new kind of document and import its first document without any change to the software, in under ten minutes, starting from the built-in item layout.

## Assumptions

- **Scope is source documents, not bank statements** (confirmed with the user). A bank statement only lists money that moved, and is matched against records in Reconciliation (`001-bank-reconciliation` FR-012). Importing it as records would risk counting the same spending twice, once from the receipt and once from the bank line.
- **The document is not necessarily a table** (confirmed with the user). Fees may be described in sentences or sections. Only the fee lines are wanted; header numbers and other tables are not.
- **Fee documents come first** (confirmed with the user). Long lists of transactions are a different shape of document and are out of scope here.
- **One kind per document.** A document is read as all expense or all income. Per-item kinds, such as sales income beside fees, are left for later.
- **Credits, discounts and refunds are not turned into records** in this phase. They show under ignored lines.
- **A missed item is added by hand.** The group has no "add item"; the reviewer uses the ordinary new-record screen.
- **Initial limits are about 40,000 characters of document text and about 50 items per document.** They are starting values, to be adjusted after real use.
- **Only the text of a document is sent to the AI provider, not page images.** Tables can come out scrambled on some PDFs. This is checked on real sample documents during planning, before any screen is built. If it proves inadequate, sending page images is a separate feature.
- **Imports keep starting on Accounts payable or Accounts receivable, as today.** The group's Source account changes that for all items at once.
- **The general import instructions still apply** to several-items documents until a profile replaces them (User Story 6).
- **No new permission.** The existing import permissions cover everything in User Stories 1 to 5. User Story 6 uses the permission to change imports.
- **An AI provider is still optional**, as today. Without one, imports fail as they do now, and entering records by hand is unaffected.
- **This supersedes two earlier statements, for source documents only:** the note in `002-double-entry-ledger` that pulling more than one record out of a single imported document is out of scope, and the design note in `docs/DEVELOPMENT_PLAN.md` that a receipt is one file and one record. `001-bank-reconciliation` FR-012 is unchanged.
- **User Story 6 is a second increment.** User Stories 1 to 5 are the first release and stand on their own.

## Out of Scope

- Bank statements, which stay in Reconciliation.
- CSV import.
- One row producing several records, for example a sale plus its commission.
- A table-style review page for hundreds of rows.
- Sending page images to a vision model.
- Mixed expense and income within one document.
- Adding a missed item inside a group.
- Reading a very long document page by page.
- Who is allowed to change Settings in general, noted separately from this feature.
