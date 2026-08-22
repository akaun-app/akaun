# Quickstart: Validating Standard Financial Statements

Per CLAUDE.md's Verification Policy, agent work here is checked by reading the diff, running
`bun run check` / `bun run lint` / `bun run test`, and reasoning about correctness — never by
starting the dev server or driving the UI. The scenarios below are what the **user** runs to
confirm the feature behaves as specified; they map directly to spec.md's Independent Tests.

## Prerequisites

- `bun install`
- `bun run db:generate` after the schema change lands, to produce the migration file — do **not**
  hand-write SQL for it.
- `bun run test` (both Vitest projects), `bun run check`, `bun run lint` all passing.
- A copy of a real book for manual checking, never the live `data/` — see CLAUDE.md's data-safety
  section for how to copy `.db`/`-wal`/`-shm` safely.

## Scenario 1 — Account kind classification (User Story 1)

1. Start the app against a fresh or copied database.
2. Open an existing Asset account created before this feature shipped → it shows "needs review"
   and is excluded from any "cash and cash equivalents" total.
3. Create a new Asset account → the form requires a kind before it can be saved.
4. Set two different accounts to kind "Bank" → both save; both are treated as bank accounts.
5. Confirm the four recognizable defaults (Cash, Bank, Accounts Receivable, Inventory) already
   carry their matching kind with no action taken.

**Automated coverage**: a `db/auto-upgrade.spec.ts`-style test against a temporary SQLite fixture
asserting the backfill table above (data-model.md); a unit test on the kind-change eligibility
rule proving it is *not* blocked by movement history, only by the account's existing edit-lock
state.

## Scenario 2 — Reports offers only the standard statements (User Story 2)

1. Open Reports → tab list is exactly Profit & Loss, Balance Sheet, Cash Flow Statement, and
   Partners' Equity only when the business has partner accounts.
2. Open Cash Flow Statement → shows operating/investing/financing groups, opening and closing
   cash, and a separate "needs review" line when applicable.
3. Issue an invoice, do not pay it → it does not appear as cash received on the Cash Flow
   Statement for that period; only the later payment does.
4. Visit a bookmarked `/reports/owed-to-us` or `/reports/we-owe` URL → redirects to `/contacts`
   rather than erroring.
5. Export the Cash Flow Statement as CSV → same figures and structure as on screen, same BOM/
   content-disposition pattern as the other statements.

**Automated coverage**: pure-function tests for `cashFlow()` (the `ledger/reports/cash-flow.ts`
equivalent of `profit-loss.ts`/`balance-sheet.ts`) covering the operating/investing/financing
derivation rule and the `ties`/`differenceMinor` self-check, against fixed `AccountTotal[]`
input — no DB needed, following the existing `balance-sheet.spec.ts` pattern.

## Scenario 3 — Dashboard shows statement-based indicators (User Story 3)

1. Open the dashboard with a period selected → net-profit, financial-position, and cash-flow
   indicators are shown; no bar/donut/trend charts remain.
2. For the same period, open the matching Reports statement → the figures match exactly, to the
   cent.
3. Click an indicator → lands on the matching Reports statement, same period/date already applied.

**Automated coverage**: none new beyond Scenario 2's pure-function tests — the dashboard indicator
values must literally be the same function calls Reports makes (Research §9), so there is nothing
distinct to unit-test beyond confirming the load function calls `profitLossReport`/
`balanceSheetReport`/`cashFlowReport` rather than a second calculation.

## Scenario 4 — Dashboard and Reports never disagree (User Story 4)

1. With both the dashboard and Profit & Loss report open, record a new expense → both update to
   the same new total with no manual refresh (existing SSE wiring, no new emitter needed).
2. Force a books-don't-balance state (existing rare data-integrity scenario) → the dashboard's
   financial-position indicator shows the same warning the Balance Sheet report shows, not a bare
   number.

## Regression checks

- `bun run test` — confirm no existing Profit & Loss / Balance Sheet / Partners' Equity spec
  broke, and that removed Receivables/Payables specs (if any existed) are deleted, not left
  failing.
- Grep for any remaining reference to `fundsFlowStatement`/`FundsFlow.svelte` after removal —
  none should remain outside of history.
- Confirm every mutating account endpoint still round-trips permission check, Zod validation,
  audit record, and SSE emit (Constitution IV) after the `kind` field is added to their schemas.
