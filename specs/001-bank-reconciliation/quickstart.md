# Quickstart & Validation Guide: Bank Reconciliation

**Feature**: `specs/001-bank-reconciliation` | **Date**: 2026-08-10

How to run and prove this feature end-to-end. Scenario numbers map to the Success Criteria in
[spec.md](./spec.md). Shapes referenced here are defined in [data-model.md](./data-model.md) and
[contracts/api.md](./contracts/api.md) — they are not repeated.

## Prerequisites

- Bun installed; dependencies installed (`bun install`).
- A local database with at least one superuser (`bun run admin:create`).
- For scenarios 3–4 only: at least one enabled LLM provider in **Settings → Auto Import**. Every
  other scenario, including a complete reconciliation, must pass with **no** provider configured
  (SC-008).
- A bank statement PDF with 20+ transactions for scenario 3. Any real statement works; a
  text-based (not scanned) one is the SC-003 baseline.

## Gates — run these first

```bash
bun run check      # svelte-check
bun run lint       # prettier + eslint
bun run test       # vitest, both projects
```

All three must pass before the feature is considered done (constitution, Development Workflow).

## Unit suite

The pure modules are developed test-first (research.md D-09). Run just them while iterating:

```bash
bun run test:unit -- --project server src/lib/server/reconciliation
```

Expected files and the rules they pin:

| Spec file | Must cover |
|-----------|-----------|
| `balance.spec.ts` | claim bundling counted once (US1 AC3); foreign-currency record at `amount × exchangeRate` (US1 AC5); an uncleared record dated before the period still counted (US1 AC6, SC-010); a record cleared in an earlier session excluded (US1 AC7); a `WillNotClear` record excluded (SC-009); float-noise equality inside 0.005 |
| `matching.spec.ts` | direction filter (money-out never suggests an income); exact amount + same date outranks exact amount + 6 days; a claimed expense is never a candidate (US3 AC6); `findDuplicateLines` flags same date/amount/normalised description and ignores case and whitespace (FR-016) |
| `session-rules.spec.ts` | `canStartSession` false while one is open (US1 AC8); `canMutateSession` true only for the newest session (US4 AC5); `prefillFromLastClosed` returns the last **closed** session's ending balance and period end (US1 AC4) |
| `drift.spec.ts` | a cleared item whose amount changed is reported; a cleared item that was deleted is reported; an untouched session reports none (FR-035) |
| `statement-parse.spec.ts` | a running-balance column and a summary row are dropped; a negative amount becomes positive + `direction: Out`; a malformed row fails the Zod parse without discarding the good rows (FR-011, FR-015) |

Per Principle V, every bug found later ships with a test here that fails before the fix.

## Run the app

```bash
bun run dev        # https://localhost:5173 if SSL_ENABLED=true, else http
```

Log in, confirm **Reconciliation** appears in the nav, and open it.

---

## Scenario 1 — Ties out in under 60 seconds (SC-001, US1)

1. Note a known-good starting balance and the ending balance the arithmetic should produce.
2. **Start session**: enter starting balance, starting date, period end date, and that exact ending
   balance. Submit.
3. **Expect**: the session reports a match, shows no difference, and closes as reconciled. Step 2 is
   never offered.
4. Re-run with a deliberately wrong ending balance.
5. **Expect**: the exact difference (amount *and* direction) is shown, with an action to escalate to
   line-by-line reconciliation.

Also confirm: while a session is open, starting another is refused and the UI sends you to the open
one (US1 AC8). After closing, starting a new session pre-fills the previous ending balance and period
end date, both still editable (US1 AC4).

## Scenario 2 — The nothing-configured path (SC-008, FR-014)

1. Disable every LLM provider in Settings.
2. Open a session, escalate to Step 2, and add statement lines by hand.
3. **Expect**: the whole reconciliation completes — add lines, match, close — with no upload and no
   error state that blocks progress. If a statement upload is attempted, the response explains that
   no provider is configured and points at manual entry rather than failing silently.

## Scenario 3 — Statement import produces many lines from one file (SC-003, US2)

1. With a provider enabled, upload a 20+ transaction statement PDF into an open session.
2. **Expect**: one statement line per transaction (not one line for the file), each with date,
   description, amount, and direction; lines are editable and deletable, and a line can be added by
   hand.
3. **Expect the negative**: no new expense, no new income, and no new auto-import job anywhere in the
   app (SC-005, FR-012). Verify directly:

   ```bash
   sqlite3 <db> "select count(*) from import_queue;"   # unchanged
   sqlite3 <db> "select count(*) from expenses;"       # unchanged
   sqlite3 <db> "select count(*) from incomes;"        # unchanged
   sqlite3 <db> "select count(*) from bank_statement_lines where session_id = <id>;"  # == transactions
   ```

4. Upload the same file again and confirm the repeated lines are flagged as duplicates so they can be
   removed (FR-016).
5. Force a failure (upload a PDF with no readable transactions). **Expect**: the failure is explained
   and manual entry stays available; the session is not stuck (FR-015).

## Scenario 4 — Suggestions are good enough to confirm rather than search (SC-004)

With a statement whose lines mostly have real counterparts, count how many lines show the correct
Akaun item as the **top** suggestion. Target ≥ 80 %. Nothing is cleared until you accept it — confirm
that loading the screen changes no cleared state (FR-019).

## Scenario 5 — Leftovers name the problem (SC-002, US3)

1. Build a session where exactly one Akaun expense has no bank line, and one bank line has no Akaun
   record.
2. Work through the line-by-line screen accepting the correct matches.
3. **Expect**: exactly those two items remain, on the correct sides, each column showing its count and
   total, and the leftovers accounting for the Step 1 difference (FR-027).
4. Reject a suggestion and pick a different item — **expect** the chosen item is the one cleared and
   the originally suggested one is still available for other lines (US3 AC3).
5. Undo a match — **expect** both sides return to uncleared (FR-022).

## Scenario 6 — A claim consumes one line (SC-007, US3 AC4)

1. Create a claim bundling 3 expenses, reimbursed as a single lump payment.
2. Match the one statement line to the **claim**.
3. **Expect**: the claim is cleared; each of the 3 expenses shows a "cleared via claim" badge linking
   to the claim, with no checkbox of its own; none of them appears as a match candidate.
4. Open a direct (unclaimed) expense — **expect** it has its own cleared state, settable from either
   the reconciliation screen or the expense detail sheet (US3 AC5).

## Scenario 7 — Annotations stop the noise (SC-009, SC-010, FR-029)

1. Leave one item unmatched and annotate it **"not yet cleared"**; leave another and annotate it
   **"will not clear"**. Close the session.
2. Start the next session.
3. **Expect**: the "not yet cleared" item is still counted in Step 1 and still offered as a candidate;
   the "will not clear" item is in neither.

## Scenario 8 — History and the mutable-newest rule (SC-006, US4)

1. Close a session that went to Step 2, navigate away, reopen it from history.
2. **Expect**: its statement lines and match outcomes are exactly as recorded, without re-uploading.
3. Reopen the **newest** closed session, correct a wrong match, re-close it — **expect** the counts and
   the affected records' cleared state reflect the correction (US4 AC4).
4. Open an **older** session — **expect** read-only: no reopen, no delete, no match changes (US4 AC5).
5. Delete the newest session — **expect** every record it cleared returns to uncleared and its
   statement lines are gone (FR-037).
6. Edit the amount of a record cleared in a closed session — **expect** that session shows its
   underlying data changed after closing (FR-035).

## Scenario 9 — Permissions (FR-032)

With a non-superuser test user:

| Granted | Expect |
|---------|--------|
| nothing | no Reconciliation nav item; visiting `/reconciliation` redirects away |
| `view` only | history and session detail readable; starting a session, matching, editing lines, and closing all return `403` |
| `view` + `add` | can start a session and upload a statement; cannot match or close |
| `view` + `change` | can match, annotate, close, reopen |
| `+ delete` | can delete the newest session and delete lines |

## Scenario 10 — Live updates and mobile (FR-034, FR-038)

- Open the match workspace in two tabs. Accept a match in one — **expect** the other updates without a
  refresh, and an open expenses list reflects the new cleared state too.
- Close the browser mid-session, reopen — **expect** the session and its lines are intact and
  resumable (FR-009).
- Walk scenarios 1, 5, and 6 at a mobile viewport width — **expect** every screen usable: sheets slide
  up from the bottom, and the two-column workspace collapses to a tabbed single column.
