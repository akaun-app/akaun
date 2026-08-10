# Feature Specification: Bank Reconciliation

**Feature Directory**: `specs/001-bank-reconciliation`

**Created**: 2026-08-10

**Status**: Draft

**Input**: User description: "Plan for phase 8: reconciliation. Refers @docs/DEVELOPMENT_PLAN.md"

**Source**: `docs/DEVELOPMENT_PLAN.md` → "Phase 8 — Reconciliation"

## Overview

Akaun records what the user *says* happened. Reconciliation checks that against what the *bank* says happened. The feature was triggered by a real case: a known starting bank balance minus the recorded transactions did not tie out to the actual account. The diagnosis was a missing or mis-recorded transaction, not a flaw in the cash-basis single-entry model — so this feature is a checking layer on top of the existing ledger, not a change to how the ledger works.

The check escalates in two steps. Step 1 is cheap: does the arithmetic tie out? If yes, the user is done in under a minute. Step 2 is only entered on a mismatch: tick off bank statement lines against Akaun records until the leftovers on each side name the problem — an Akaun record that never cleared the bank, or a bank line that was never recorded in Akaun.

No new classification field is added to expenses or incomes. Which records touched the bank is **derived** from the existing claim relationship: a claimed expense was paid out of pocket and reimbursed, so the reimbursement — the claim — is what appears on the statement, not the individual expenses inside it.

## Clarifications

### Session 2026-08-10

- Q: The plan proposed a Bank/Personal payment-method field as a prerequisite. How should reconciliation determine which transactions touched the bank? → A: Derive it from the existing claim relationship — unclaimed expenses and all incomes are bank-facing, claimed expenses ride inside their claim. No new field.
- Q: Should the Step 1 balance computation count records dated inside the period, or every record still uncleared? → A: Uncleared-to-date — count every bank-facing record still uncleared and dated on or before the period end, including stragglers carried over from earlier periods.
- Q: Can more than one reconciliation session be open at once? → A: No — one open session at a time; a new session requires closing the current one. Period dates are pre-filled from the last close but stay editable, and overlapping periods remain permitted.
- Q: Can a closed session be corrected or removed? → A: The most recent closed session can be reopened, corrected, and re-closed, and it alone can be deleted (un-clearing what it cleared). Older sessions are read-only, because each session's starting balance chains from the one before it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Check the balance ties out (Priority: P1)

The user starts a reconciliation session: they enter the account's starting balance, the date that balance is true as of, the statement period end date, and the ending balance printed on the bank statement. Akaun computes `starting balance + bank-facing income − bank-facing expenses and claims`, counting everything still uncleared up to the period end date, and shows whether it matches. On a match the session is closed as reconciled and nothing more is asked of the user. On a mismatch the difference is shown and the user is offered the line-by-line step.

**Why this priority**: This is the whole point of the feature and the common case. Most months the numbers tie out and the user is finished in under a minute. It is fully usable without any statement import.

**Independent Test**: With a small set of existing records, enter a starting balance and the exactly-correct ending balance; confirm the session reports a match and closes. Re-run with a deliberately wrong ending balance; confirm the difference is reported and Step 2 is offered.

**Acceptance Scenarios**:

1. **Given** bank-facing income and expenses in the period whose net exactly reaches the entered ending balance, **When** the user runs the check, **Then** the session is reported as reconciled, closed, and Step 2 is never offered.
2. **Given** an entered ending balance that differs from the computed one, **When** the user runs the check, **Then** the exact difference (amount and direction) is shown along with an action to escalate to line-by-line reconciliation.
3. **Given** a claim bundling 3 expenses, **When** the check runs, **Then** the claim's reimbursement total is counted once and none of the 3 bundled expenses is counted separately.
4. **Given** a previously closed session, **When** the user starts a new one, **Then** the starting balance and starting date are pre-filled from that session's ending balance and period end date, and remain editable.
5. **Given** an expense denominated in a foreign currency, **When** the check runs, **Then** its main-currency value (amount × the rate stored on the record) is what is subtracted from the balance.
6. **Given** an expense dated in a previous period that was never cleared, **When** a new session's check runs, **Then** it is still counted in the computation and still offered as a match candidate.
7. **Given** an expense already cleared in an earlier session, **When** a new session's check runs, **Then** it is excluded from the computation and is not offered as a candidate.
8. **Given** an unfinished session already open, **When** the user tries to start another, **Then** they are directed to the open session instead, and no second session is created.

---

### User Story 2 - Import a bank statement into statement lines (Priority: P2)

Inside a reconciliation session, the user uploads a bank statement (PDF or image). The file is read and turned into a list of individual statement lines — date, description, amount, direction (money in/out) — one row per transaction on the statement, all belonging to that session. The extracted lines are shown for review and are editable; the user can correct a misread line, delete a junk row, or add a line by hand. Nothing extracted here is ever written into the ledger as an expense or income.

**Why this priority**: Line-by-line reconciliation needs the bank's side of the picture. Import is what makes that side available without hand-typing dozens of rows, but the session and the balance check already work without it.

**Independent Test**: Upload a multi-transaction statement PDF into a session; confirm many statement lines are produced from the one file, that they are editable, and that no expense, income, or auto-import job was created anywhere in the app.

**Acceptance Scenarios**:

1. **Given** a statement PDF containing 20 transactions, **When** the user uploads it, **Then** 20 statement lines are created for that session — not one line for the file.
2. **Given** an uploaded statement, **When** extraction finishes, **Then** the ledger contains no new expenses or incomes and the auto-import queue contains no new jobs as a result of the upload.
3. **Given** a line whose amount or date was misread, **When** the user edits it, **Then** the corrected values persist and are used for matching.
4. **Given** no document-extraction provider is configured, **When** the user opens a session, **Then** they can still add statement lines manually and complete the whole reconciliation.
5. **Given** extraction fails or produces nothing usable, **When** the user is shown the result, **Then** the failure is explained and the manual-entry path is offered instead of leaving the session stuck.

---

### User Story 3 - Tick off lines and see what is left over (Priority: P3)

With statement lines in place, the user works through the line-by-line screen. For each statement line Akaun suggests the most likely matching Akaun item — a direct expense, a whole claim, or an income — based on amount and nearby date. The user accepts, replaces, or rejects each suggestion; accepting marks both sides cleared. Nothing is cleared without an explicit action by the user. When the pass is finished, the two leftover columns are the diagnosis: unmatched Akaun items (recorded but never cleared the bank) and unmatched statement lines (money that moved but was never recorded).

**Why this priority**: This is the escalation path that actually finds the missing transaction. It only earns its place after the cheap check has failed, which is why it sits behind Steps 1–2.

**Independent Test**: Build a session where one Akaun expense has no bank line and one bank line has no Akaun record; work through the screen; confirm exactly those two items remain as leftovers on their respective sides.

**Acceptance Scenarios**:

1. **Given** a statement line whose amount equals a direct expense's main-currency amount and whose date is within the matching window, **When** the screen loads, **Then** that expense is shown as the suggested match, unconfirmed.
2. **Given** a suggested match, **When** the user accepts it, **Then** the statement line and the Akaun item are both marked cleared and linked to each other in this session.
3. **Given** a suggested match, **When** the user rejects it and picks a different Akaun item, **Then** the chosen item is the one cleared and the originally suggested item stays available for other lines.
4. **Given** a claim bundling 3 expenses reimbursed as one lump payment, **When** the user matches the single statement line to the claim, **Then** the claim is marked cleared, and each of the 3 expenses shows a "cleared via claim" badge that links to the claim rather than its own checkbox.
5. **Given** a direct (unclaimed) expense, **When** the user views it, **Then** it has its own cleared state that can be set from either the reconciliation screen or the expense detail view.
6. **Given** an expense that belongs to a claim, **When** the user looks for it on the line-by-line screen, **Then** it is not offered as a match candidate — only its parent claim is.
7. **Given** all matchable pairs have been ticked, **When** the user reviews the screen, **Then** the remaining unmatched Akaun items and unmatched statement lines are listed separately with their totals, and the sum of the leftovers accounts for the Step 1 difference.

---

### User Story 4 - Look back at past reconciliations (Priority: P4)

The user opens the reconciliation module and sees the history of previous sessions — period, starting and ending balance, whether it tied out at Step 1 or needed line-by-line work, and the final cleared/uncleared counts. Opening a past session shows its statement lines and what each one was matched to, exactly as it stood when the session closed.

**Why this priority**: The persistence that makes this possible is a structural decision that must be made now (re-uploading old statements later is painful), but the history view itself is a read-only convenience on top of it.

**Independent Test**: Close a session that went to Step 2, navigate away, and reopen it from the history list; confirm its statement lines and their match outcomes are still there.

**Acceptance Scenarios**:

1. **Given** a closed session, **When** the user opens it from history, **Then** its statement lines, their match targets, and its cleared counts are shown as recorded.
2. **Given** a session that matched at Step 1, **When** it is listed, **Then** it is distinguishable at a glance from one that required line-by-line work.
3. **Given** several sessions over several months, **When** the history is listed, **Then** they appear in reverse period order with their periods and outcomes visible without opening each one.
4. **Given** the most recently closed session, **When** the user reopens it, corrects a wrong match, and re-closes it, **Then** the correction is reflected in its cleared counts and in the cleared state of the affected records.
5. **Given** a session older than the most recent one, **When** the user opens it, **Then** it is read-only — no reopen, no delete, no match changes.

---

### Edge Cases

- **Timing differences**: a transaction recorded in Akaun near the period end that had not yet cleared the bank by the statement date will make Step 1 mismatch, even though nothing is wrong. It must surface in Step 2 as an unmatched Akaun item the user can annotate so it does not read as an error, and it must remain in scope for the next session — where it will clear normally.
- **Stragglers must not vanish**: an item left uncleared when a session closes is dated before the next session's period, yet must still be counted and offered as a candidate there. Anything else lets a real discrepancy disappear the moment the period rolls over.
- **An unclaimed expense that was actually paid from personal funds** is treated as bank-facing by the derivation rule and will therefore appear as a permanent leftover. The user needs a way to annotate it as "will not clear" so it stops resurfacing every session (see FR-029). Routine use of that annotation is the signal that an explicit payment-method field has become worth building.
- A statement line is uploaded twice (same file, or an overlapping statement period) — duplicate lines within a session must be detectable so the user is not asked to match the same bank transaction twice.
- An Akaun item that was already cleared in an earlier session appears again in a later session's period — it must not be offered as a match candidate a second time.
- A claim's total does not equal the reimbursement actually paid (partial or combined reimbursement) — the user must still be able to record the claim as cleared against the line, with the difference visible as a leftover rather than silently absorbed.
- One statement line corresponds to several Akaun records, or one Akaun record spans several statement lines — the user needs a way to leave these unmatched with a note rather than being forced into a wrong one-to-one match.
- A record that is already cleared is later edited (amount changed) or deleted — the clearing state must not silently misrepresent a reconciled period.
- An expense is attached to a claim *after* being cleared as a direct expense, or removed from a claim after the claim was cleared — the source of truth for its cleared state changes and must stay unambiguous.
- The bank statement covers a period that overlaps an already-reconciled period.
- A statement is in a currency other than the app's main currency.
- Extraction returns lines with running balances or summary rows mixed in with real transactions.
- The user closes the browser mid-session — the session and its lines must survive and be resumable.
- The user's permissions allow viewing reconciliation but not creating or clearing.

## Requirements *(mandatory)*

### Functional Requirements

**Reconciliation sessions (Step 1)**

- **FR-001**: Users MUST be able to start a reconciliation session by entering a starting balance, the date that balance applies from, the statement period end date, and the ending balance shown on the statement.
- **FR-002**: The system MUST compute the expected ending balance as the starting balance plus bank-facing income minus bank-facing expenses and claims, counting every bank-facing record that is **still uncleared** and dated on or before the period end date — including records dated before the period that have not yet cleared — and compare the result to the entered ending balance.
- **FR-003**: "Bank-facing" MUST be derived, not stored: direct (unclaimed) expenses, claims, and incomes are bank-facing. An expense attached to a claim MUST NOT be counted individually — the claim's reimbursement represents that money leaving the bank.
- **FR-004**: Records already cleared in an earlier session, and records annotated "will not clear", MUST be excluded from the computation. A record that stayed uncleared when an earlier session closed MUST remain in scope for every subsequent session until it is cleared or annotated.
- **FR-005**: Amounts recorded in a currency other than the main currency MUST participate at their main-currency value, using the exchange rate stored on the record at the time it was created.
- **FR-006**: When the computed and entered ending balances agree, the system MUST close the session as reconciled and MUST NOT prompt for line-by-line work.
- **FR-007**: When they disagree, the system MUST show the exact difference and offer to escalate to line-by-line reconciliation.
- **FR-008**: A new session MUST pre-fill its starting balance and starting date from the most recently closed session's ending balance and period end date, and both MUST remain editable.
- **FR-009**: Sessions MUST be resumable — an unfinished session survives navigation, logout, and restart, and can be reopened and continued.
- **FR-010**: At most one reconciliation session MAY be open at a time. Starting a new session MUST require the current one to be closed first, so the same uncleared records can never be counted by two sessions simultaneously.

**Statement import (Step 2 input)**

- **FR-011**: Users MUST be able to upload a bank statement document (PDF or image) into a session and have it produce one statement line per transaction found, each carrying date, description, amount, and direction (money in or out).
- **FR-012**: Statement lines MUST be stored against the session that produced them and MUST NOT be written into the ledger as expenses or incomes, nor enter the auto-import pipeline.
- **FR-013**: Statement lines MUST be editable and deletable by the user, and users MUST be able to add a statement line manually.
- **FR-014**: Reconciliation MUST remain fully completable with no document-extraction provider configured, via manual statement-line entry.
- **FR-015**: When extraction fails or yields no usable lines, the system MUST tell the user what happened and leave the session usable via manual entry.
- **FR-016**: The system MUST flag statement lines within a session that duplicate an existing line (same date, amount, and description) so the user can remove them.
- **FR-017**: Statement lines MUST be retained after their session closes, remaining available for later viewing.

**Matching and clearing (Step 2)**

- **FR-018**: For each statement line, the system MUST propose the most likely matching Akaun item among direct expenses, claims, and incomes, ranked by amount equality and date proximity.
- **FR-019**: A proposed match MUST NOT clear anything on its own; clearing MUST require an explicit user action.
- **FR-020**: Users MUST be able to reject a proposal and select any other eligible Akaun item as the match, and to leave a line deliberately unmatched.
- **FR-021**: Accepting a match MUST mark both the statement line and the Akaun item as cleared and record which session and which statement line cleared it.
- **FR-022**: Users MUST be able to undo a match, returning both sides to uncleared.
- **FR-023**: Cleared state MUST live only on the items that actually hit the bank: direct (unclaimed) expenses, claims, and incomes.
- **FR-024**: An expense attached to a claim MUST NOT present its own cleared control; it MUST show that its clearing is governed by its parent claim, with a link to that claim.
- **FR-025**: A claim's detail view MUST present the cleared control for the reimbursement as a whole.
- **FR-026**: An Akaun item already cleared in an earlier session MUST NOT be offered as a match candidate in a later one.
- **FR-027**: On finishing a pass, the system MUST list unmatched Akaun items and unmatched statement lines separately, each with a count and total, and MUST show how those leftovers account for the Step 1 difference.
- **FR-028**: Users MUST be able to close a session that still has leftovers, recording the outcome and the final cleared/uncleared counts.
- **FR-029**: Users MUST be able to annotate an unmatched Akaun item as either "not yet cleared" (a timing difference — remains a candidate in future sessions) or "will not clear" (never a bank transaction — stops being offered and stops appearing as a leftover), so neither reads as a suspected error.

**Module, history, and access**

- **FR-030**: Reconciliation MUST be its own area of the app with its own navigation entry, reading across expenses, incomes, and claims.
- **FR-031**: Users MUST be able to list past sessions in reverse period order showing period, balances, whether Step 1 matched, and final cleared/uncleared counts, and to open any past session to see its lines and match outcomes as recorded.
- **FR-032**: Access MUST be governed by a `reconciliation` permission resource with the same view / add / change / delete actions as every other resource. Viewing without `view` MUST behave as if the area does not exist; starting a session requires `add`; clearing, matching, and editing lines require `change`; deleting a session or its lines requires `delete`.
- **FR-033**: Every create, update, and delete in this feature MUST be recorded in the audit trail, including changes to an expense's, claim's, or income's cleared state.
- **FR-034**: Changes made in one open view MUST appear in other open views of the same data without a manual refresh.
- **FR-035**: Editing the amount of, or deleting, a record that has been cleared MUST NOT leave a closed session silently misstating what was reconciled — the affected session MUST show that its underlying data changed after closing.
- **FR-036**: The most recently closed session MUST be reopenable so its matches and annotations can be corrected and the session re-closed. Every session older than that MUST be read-only.
- **FR-037**: Deleting a session MUST be restricted to the most recent session, MUST return every record it cleared to uncleared, and MUST remove its statement lines. Deleting a session that a later session was chained from MUST NOT be possible.
- **FR-038**: Every screen in this feature MUST be usable at mobile viewport widths.

### Key Entities

- **Bank-facing item**: not a stored thing — a derived category covering direct (unclaimed) expenses, claims, and incomes. These are the only records that can clear against a bank statement.
- **Reconciliation session**: one reconciliation attempt. Holds the starting balance and its date, the period end date, the statement's ending balance, the computed balance, the outcome (matched at Step 1, or escalated), the final cleared/uncleared counts, and who ran it. Owns its statement lines.
- **Bank statement line**: one transaction as printed on the bank statement — date, description, amount, direction. Belongs to a session, carries its match status and what it was matched to, and is retained after the session closes. It is reference data, never a ledger record.
- **Cleared marker**: the state on a direct expense, a claim, or an income saying it has been seen on a bank statement, together with the session and statement line that cleared it.
- **Leftover annotation**: a user note on an unmatched Akaun item recording why it did not clear — "not yet cleared" (timing) or "will not clear" (not a bank transaction).
- **Match suggestion**: a transient, ranked proposal pairing a statement line with an Akaun item. Never persisted as a decision — only the user's accepted match is.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user whose books tie out can complete a reconciliation — open the module, enter two balances, get a confirmed match, close the session — in under 60 seconds with no document upload.
- **SC-002**: When a period is out by a single missing transaction, the line-by-line pass leaves exactly that one item as a leftover, on the correct side (missing from Akaun vs. never cleared the bank).
- **SC-003**: Uploading a bank statement of 20+ transactions produces one reviewable line per transaction from the single file, with at least 90% of lines needing no correction on a clean text-based statement.
- **SC-004**: At least 80% of statement lines that have a genuine counterpart in Akaun are correctly proposed as the top suggestion, so the user's job is confirming rather than searching.
- **SC-005**: No reconciliation action ever creates, modifies, or deletes an expense or income record other than its cleared state and leftover annotation — verifiable by comparing ledger contents before and after a full session.
- **SC-006**: Statement lines from a session closed months earlier are still retrievable without re-uploading the statement.
- **SC-007**: A claim bundling N expenses consumes exactly one statement line, and none of its N expenses can be cleared independently.
- **SC-008**: Reconciliation is fully completable with no third-party extraction service configured.
- **SC-009**: An item annotated "will not clear" does not appear as a leftover in any subsequent session.
- **SC-010**: An item left uncleared when a session closes is still counted in, and offered as a candidate by, the next session — a discrepancy never disappears simply because the period moved on.

## Assumptions

- **No payment-method field** (confirmed with the user). Which records touched the bank is derived from the claim relationship rather than stored on each record: claimed expenses were paid personally and reimbursed, so their claim is the bank movement; everything else is assumed bank-facing. The trade-off is an unclaimed expense genuinely paid from personal funds — it is caught in Step 2 as a leftover and annotated "will not clear" (FR-029). If that annotation is needed routinely, that is the evidence that a stored payment-method field has earned its place; until then it is not built.
- **Single bank account.** There is one bank account being reconciled, and no formal account entity is introduced. Multi-account support is deferred, and the persisted statement lines are what make adding it later a backfill rather than a re-import.
- **Statement currency is the main currency.** The bank account is assumed to be held in the app's main currency. Foreign-currency records are compared at their stored main-currency value; small differences between the stored rate and the rate the bank actually applied will surface as near-matches for the user to resolve manually, not as automatic matches.
- **Matching assistance** (confirmed with the user): the system suggests, the user confirms. Nothing is auto-cleared, even on an exact amount-and-date match.
- **Match window**: a statement line and an Akaun item are considered candidates when their amounts are equal and their dates are within a small number of days of each other; the exact window is an implementation detail tuned during build, not a user-facing setting.
- **Step 1 counts uncleared items, not a date slice** (confirmed with the user). A bank-supplied starting balance already reflects everything the bank had cleared by that date, so anything still uncleared belongs in the next period's arithmetic regardless of when it was dated. This is what makes an unresolved item keep surfacing until it is dealt with, instead of silently vanishing once the period moves on. It also means a genuine timing difference — recorded near the period end, cleared by the bank a few days later — still trips Step 1; that is accepted, and FR-029's "not yet cleared" annotation is how the user records it as expected rather than an error.
- **Sessions are not concurrent** (confirmed with the user). Only one session may be open at a time (FR-010) — with the uncleared-to-date rule, two open sessions would both count the same uncleared records and could both appear to tie out while the account does not. Overlapping *periods* remain permitted, because real statements have gaps and partial periods; the already-cleared guard (FR-026) is what keeps overlapping periods honest.
- **Sessions chain, so only the newest is mutable** (confirmed with the user). Each session's starting balance comes from the previous session's close, so correcting an older session would invalidate every session after it. Reopen and delete are therefore restricted to the most recent session (FR-036, FR-037); older ones are history.
- **Cash-basis single-entry is unchanged.** This feature adds no journals, no double-entry, and no accounting-model change, per the plan's stated conclusion.
- **Existing patterns are reused.** The document extraction technology from auto-import is reused as a shared utility, not as its pipeline; the module follows the app's established conventions for detail sheets, deep-linked records, live updates, permissions, and audit trails.

## Out of Scope

- **A Bank/Personal payment-method field on expenses and incomes** — proposed in the development plan as a prerequisite, deliberately not built (see Clarifications and Assumptions). The claim relationship carries the distinction today.
- Creating an expense directly from an unmatched statement line (deferred; the persisted line data makes it a later addition).
- Detecting recurring transactions from accumulated statement history.
- A formal multi-account entity.
- Bank CSV import — superseded by document extraction; revisited only if PDF extraction proves unreliable in practice.
- Direct bank API / open-banking connections.
- Any change to the cash-basis single-entry accounting model.
