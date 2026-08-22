# Phase 0 Research: Standard Financial Statements on Dashboard and Reports

The spec (`spec.md`) has no `[NEEDS CLARIFICATION]` markers — the requirements checklist already
passed. What remains are *technical* unknowns: how to fit the new behavior into the existing
schema and code without a second way of doing something the codebase has already settled. Each
item below is a real design decision this plan depends on, in Decision/Rationale/Alternatives
form.

## 1. Where "account kind" lives in the schema

**Decision**: Add a new nullable column `accounts.kind` (integer) and a new `AccountKind` enum in
`src/lib/enums.ts` (`Cash`, `Bank`, `Wallet`, `Card`, `Receivable`, `Inventory`,
`OtherCurrentAsset`, `Equipment`). Leave the existing `accounts.role` column untouched.

**Rationale**: `role` (`schema.ts:641-642`) is documented as transitional — *"`role` remains
during the conversion release only, so migration 0016 can map old installations in one
transaction before later readers stop depending on it."* It is also structurally 1:1 with `type`
today (`legacyRoleForAccountType` always maps `Asset → Bank`), so it cannot represent a real
per-account distinction going forward without breaking that mapping for every other reader of
`role`. A new column is additive and does not touch code scheduled for removal.

**Alternatives considered**: Repurposing `role` to carry the new meaning — rejected because it
would require auditing and changing every reader of `role` (there are several: `displaySign`,
`isMoneyPotAccount`, `isCategoryAccount`, the auto-upgrade alias matcher) at the same time as
shipping a new user-facing feature, and because the column is already scheduled to be dropped
independently of this feature.

## 2. Migration and backfill mechanism

**Decision**: An additive `drizzle-kit generate` migration (`ALTER TABLE accounts ADD kind
integer`), landing as the next numbered file after `0016_standardize_chart_accounts.sql`. The
one-time backfill (FR-004) runs from the same auto-upgrade path documented in CLAUDE.md
(`db/auto-upgrade.ts`, invoked by `createDb()` at module load): for each of the app's seeded
default accounts (Cash → `Cash`, Bank → `Bank`, Accounts Receivable → `Receivable`, Inventory →
`Inventory`, by matching on the existing `account_defaults`/seed `code`, not by name — codes are
already the unique, stable key `seed-accounts.ts` uses), set `kind` directly; every other
existing Asset account is left `kind = NULL`, which *is* the "needs review" state — no separate
sentinel value.

**Rationale**: CLAUDE.md's verification policy already treats `db/auto-upgrade.ts` +
`upgradeDatabaseFile({ databasePath })` as the one place a real installation is transformed on
first start, and `db/auto-upgrade.spec.ts`'s temp-database-fixture pattern is the existing,
required way to test it (Principle V: every bug-prone, silent-failure-risk piece of logic gets a
red-green test against a real temporary SQLite file, never a mock).

**Alternatives considered**: A manual "reclassify all accounts" setup wizard screen — rejected by
FR-004 itself, which requires the small number of recognizable defaults to be classified
automatically with no user action, and by Principle III (no new screen for a one-time system
concern already served by the existing auto-upgrade seam).

## 3. Eligibility to change kind later

**Decision**: Changing `kind` on an existing account is gated only by the same conditions that
already block editing an account at all (`!perms.change`, `isSystem`, `archivedAt` set) — **not**
by `canChangeAccountType`'s movement-count/child-count/statement-count/default-count gate.

**Rationale**: Spec edge case is explicit: *"The change is allowed unless an existing rule already
blocks editing that account (for example it is locked), because the kind describes what the
account is, not a permanent fact fixed at creation — the same way its name can already be
changed."* Reusing `canChangeAccountType`'s stricter gate would silently make kind
un-correctable on every account with history, which is exactly the "needs review" backlog FR-004
creates and expects to be resolved by editing.

**Alternatives considered**: Reusing `canChangeAccountType` as-is — rejected, contradicts the
edge case above and would make "needs review" a trap with no way out once an account has any
movements.

## 4. Equipment's relationship to "kind"

**Decision**: The kind selector on the account form offers the seven non-Equipment values only.
Equipment classification keeps its existing, separate path (chosen on the everyday record form as
what money was spent on, per CLAUDE.md and the spec's edge case), and an account already carrying
the Equipment role is stored with `kind = Equipment` automatically wherever that existing path
creates or confirms it — it is never asked for, and never offered as a choice alongside the seven
everyday kinds. Implementation must first locate that path (candidates: the Settings page's
category-staging save handler, or wherever a new "category" that is really Equipment gets its
account row created — CLAUDE.md's Settings Page Patterns section is the starting point). It may
turn out there is currently **no live path that creates a brand-new Equipment account at all** —
`createAccount` always stamps `role = Bank` for a new Asset account, so today only a
legacy-migrated book can have `role = Equipment`, via `account-aliases.ts` during
`db/auto-upgrade.ts`. If confirmed, that is a pre-existing gap this feature does not need to close
(FR-019's scope guard) — but the backfill/migration step must still stamp `kind = Equipment` on
every already-existing `role = Equipment` account, since Decision §12 below makes `kind` (not
`role`) the thing `isEquipmentAccount` reads going forward.

**Rationale**: The spec's edge case rules this out explicitly: *"Equipment is chosen on the
everyday record form as what money was spent on, the same way a category is today, not set as one
of these seven kinds."* Treating it as an eighth interactive choice on the account form would
contradict that and duplicate a decision the product already makes elsewhere.

**Alternatives considered**: Adding Equipment as an eighth radio option on the same form —
rejected per the edge case above; it would let a user set Equipment two different ways with two
different consequences, which is the "second way to do a solved thing" Principle VI forbids.

## 5. Cash Flow Statement activity classification (operating / investing / financing)

**Decision**: Classify each movement that touches a cash-and-cash-equivalents account (FR-006) by
its *other* side:

- **Investing**: the other side is an Equipment account.
- **Financing**: the other side is a partner-capital or partner-drawings account (`AccountRole
  PartnerCapital`/`PartnerDrawings`), or the account's own Opening Balances entry.
- **Operating**: everything else — revenue, expense, receivable, inventory, payable, and other
  current-asset counterparts. This is also where FR-012's "Change in receivables"-style lines
  come from: a receivable/inventory/other-current-asset movement whose other side is **not**
  itself a cash account is surfaced as its own operating line rather than folded into cash.

**Rationale**: This is the smallest rule that satisfies FR-012's example and the standard
three-way grouping FR-010 requires, without adding a new "activity type" field to every record —
which FR-019's scope guard rules out (no capability beyond account classification and its effect
on the statements). The rule reads the same two facts every other report already reads
(`AccountTotal`'s `type`/`role`), so it needs no schema change beyond `kind` itself.

**Alternatives considered**: Tagging each ledger record with an explicit
operating/investing/financing flag at entry time — rejected, it is new schema and new UI on the
record form, which is exactly the "capability beyond classification" FR-019 forbids; the
derivation above needs nothing new to fill in from the account it already touches.

## 6. Cash Flow Statement's independent tie-out (FR-011)

**Decision**: Compute `openingMinor`/`closingMinor` as two independent reads — the combined
balance of cash-and-cash-equivalents accounts (FR-006) as at the day before the period starts,
and as at the period's end — via the existing `accountTotalsUpTo` primitive, filtered to accounts
of kind Cash/Bank/Wallet/Card. Compare `closingMinor - openingMinor` against the sum of every
operating/investing/financing line. A mismatch sets `ties = false` and a warning note, exactly
like `balance-sheet.ts`'s `balances` flag and `funds-flow.ts`'s existing `ties`/`differenceMinor`
pair.

**Rationale**: This is a direct precedent already in the codebase (`funds-flow.ts:246-259`, and
`balance-sheet.ts:153-165`) for the same shape of self-check the spec asks for by analogy ("the
same way the existing Balance Sheet independently checks that it balances"). Reusing the pattern
means the new statement is checked the same way, rather than inventing a second convention for
"does this add up."

## 7. Conditional Partners' Equity tab, and the new Cash Flow tab's visibility

**Decision**: Thread a `hasPartners: boolean` (from the existing `partnerContacts(db)` query)
into the reports page data, and filter the static `TABS` array in `ReportsPage.svelte` by it.
Cash Flow is always shown, unconditionally, alongside Profit & Loss and Balance Sheet.

**Rationale**: Today there is **no** conditional-tab mechanism — Partners' Equity is always in
`TABS`, and only its *content* shows an empty state when there are no partners
(`PartnerStatementReport.svelte:53-57`). But spec's User Story 2 Acceptance Scenario 1 is
explicit that the *tab itself* must not appear for a partner-less business, so this plan adds the
one piece of new plumbing that requirement needs — a boolean the loader already has the query for.

**Alternatives considered**: Leaving Partners' Equity always visible with its existing empty
state, treating the spec's "only if the business has partner accounts" as already satisfied —
rejected: it does not match Acceptance Scenario 1 ("nothing else" in the tab list), and the
Edge Cases section repeats it as a hard requirement, not a nice-to-have.

## 8. Redirecting the retired Receivables/Payables report tabs (FR-009)

**Decision**: `loadReportsPage` recognizes the two retired view values (`owed-to-us`, `we-owe`)
specifically and issues `redirect(302, '/contacts')` rather than treating them as unknown/erroring.
No CSV endpoint redirect is needed — research confirmed neither tab ever had a CSV export
endpoint (`ReportsPage.svelte` sets `csv = null` for both today).

**Rationale**: CLAUDE.md's three-ledgers table puts "who owes whom" on Contacts for both
directions, and Contacts already renders `contactBalances()` for every contact — one navigation
step, satisfying SC-005's "no more than two." `/records?account=<payable-or-receivable-default-id>`
was considered as an alternative destination but Contacts is the closer match to what a user
looked for on either retired tab (a person/entity balance, not a movement list).

**Alternatives considered**: A generic "this report was removed" interstitial page — rejected,
Principle VII and FR-009 both call for landing on a *working* screen, not an explanation of an
absence.

## 9. Making dashboard indicators provably equal to the Reports figures (FR-014)

**Decision**: The dashboard's net-profit indicator switches from its current ad hoc
`incomeTotals(db, from, to).total - expenseTotals(db, from, to).total` (`typeTotals`-based) to
calling `profitLossReport(db, dateFrom, dateTo)` directly — the exact function
`/reports/profit-loss` calls — and reading `resultMinor`. The financial-position indicator keeps
calling `balanceSheetReport` via the existing `positionAsAt` (already compliant — it delegates
rather than recomputing). The new cash-flow indicator calls the same `cashFlowReport(db,
dateFrom, dateTo)` that backs `/reports/cash-flow`.

**Rationale**: FR-014 requires "the same calculation the matching Reports statement uses for the
same period... never a second, separately written calculation." The current net-profit tile is
the one existing indicator that fails this today (it duplicates the arithmetic instead of calling
the report function), so bringing it in line is in scope even though the spec frames this as
"replace charts," because User Story 4's guarantee cannot hold otherwise.

**Alternatives considered**: Leaving `typeTotals`-based net profit as is, since it happens to
produce the same number today — rejected: "happens to agree" is exactly the drift User Story 4
exists to prevent the next time either calculation is touched independently.

## 10. Fate of the existing "Funds Flow" dashboard panel

**Decision**: Retire the `FundsFlow.svelte` panel and its `fundsFlowStatement()` dashboard query
from the dashboard, superseded by the new Cash Flow indicator. Its `historyGapNotes()` helper is
kept and reused by the new Cash Flow Statement/indicator (it is a shared, pure function, not
specific to funds-flow).

**Rationale**: `funds-flow.ts`'s own doc comment says computing this on a current-assets basis and
calling it cash flow "would be wrong twice over — the base is not cash, and `/reports` already
owns the statement names." Keeping both the old current-assets-based panel and the new
true-cash-based indicator on the same dashboard would show two different "cash-like" figures for
the same period, reviving the exact tally problem (User Story 4) this feature exists to remove.

**Alternatives considered**: Keeping Funds Flow alongside the new indicator as a distinct,
clearly-labeled thing — rejected: FR-013 says the dashboard should read "like a summary of the
three statements," and a fourth, non-statement figure computed on a different basis works against
that and against SC-002's "zero exceptions" tally guarantee.

## 11. Retiring the "current assets" and "accounts payable" KPI tiles

**Decision**: Both existing tiles are folded into the one financial-position indicator (assets /
liabilities / equity from the Balance Sheet, FR-013 Acceptance Scenario 2), rather than kept
alongside it.

**Rationale**: Acceptance Scenario 2 asks for one financial-position indicator equal to the
Balance Sheet; current-assets and accounts-payable are both individual lines *within* that
statement, so showing them as separate tiles beside the new indicator would be the ad hoc,
statement-external figures FR-013 asks to remove, just not named as "charts."

**Alternatives considered**: Keeping them as sub-figures under the financial-position indicator
(not full third-party tiles) — left as an implementation-level layout choice for `/speckit-tasks`,
not a structural decision this plan needs to fix.

## 12. Retiring `role`'s last live Asset-account use

A follow-up question — since `AccountKind` (Cash, Bank, Wallet, Card, Receivable, Inventory,
OtherCurrentAsset, Equipment) shares 6 of its 8 values with the existing `AccountRole` enum, isn't
this redundant? — was investigated directly (grepping every reader of `role`/`AccountRole` across
`src`). The answer: merging `kind` into `role` is the wrong fix (it contradicts
`004-standardize-chart-accounts`'s plan to retire `role`, its completed retirement tasks, and
Decision §1 above — and it would not even save implementation work, since every write site
(`createAccount`, `patchAccount`, `legacyRoleForAccountType`, `compatibilityRole`) needs the same
rework whether the new data lives in `role` or in `kind`, because `role` is unconditionally
stamped `Bank` for every Asset account today; the 6 overlapping values exist as labels, not as
live, independently-set data). But the investigation also found the actual source of the
redundancy-*feeling*: `role` still has exactly one live, per-Asset-account reader —
`isEquipmentAccount`/`isMoneyPotAccount` (`src/lib/server/ledger/account-type.ts:116-125`), which
distinguish Equipment from every other Asset account by checking `role === AccountRole.Equipment`.

**Decision**: `isEquipmentAccount` and `isMoneyPotAccount` are changed to read `account.kind`
instead of `account.role` (`account.type === Asset && account.kind === AccountKind.Equipment`,
and `account.type === Asset && !isEquipmentAccount(account)`, respectively). `role` keeps being
written exactly as today — `legacyRoleForAccountType` unconditionally stamps `Bank` on every new
Asset account, purely to satisfy the column's `NOT NULL` constraint — but nothing reads it for
Asset rows any more once this lands. The `RoleAndType` type and its doc comment
(`account-type.ts:92-108`, which currently says "`role` is the only column that tells the two
apart") are updated to name `kind` as that column for Asset accounts instead. The dead
`MONEY_POT_ROLES` array (`account-type.ts:141-146`, confirmed unreferenced by any importer) is
deleted rather than left beside the now-real `CASH_AND_EQUIVALENT_KINDS`/
`OTHER_CURRENT_ASSET_KINDS` groupings (data-model.md).

**Rationale**: This is the one remaining place `role` carries live, per-account meaning for
Assets, and it currently only works for legacy-migrated books — a *new* Equipment account has no
live creation path that sets `role = Equipment` today (Decision §4's revised text). Once `kind` is
the authoritative source, leaving `isEquipmentAccount` on `role` would mean two different,
sometimes-disagreeing answers to "is this equipment" existing side by side — exactly the drift
Principle VI and User Story 4's tally guarantee exist to prevent. It also matches the schema's own
stated intent for `role` (a column meant to last only "before later readers stop depending on
it," `schema.ts:641-644`) rather than leaving it half-dependent-upon indefinitely. This is *not* a
reopening of the merge idea rejected in Decision §1: `role` and its enum are untouched for every
non-Asset type, and the column itself is not renamed, dropped, or dual-purposed — only its two
Asset-facing readers are re-pointed onto the field that now actually answers their question.

**Consequence**: `MovementView` (`ledger/types.ts:147-161`) gains an `accountKind` field beside
its existing `accountRole`/`accountType`, and the client mirror
`src/lib/components/ledger/account-kinds.ts` (`isEquipmentSide`/`isCategorySide`) is updated the
same way, per the existing hand-duplication convention.

**Alternatives considered**: Leaving `isEquipmentAccount` on `role` unchanged, since it already
"happens to work" for migrated data — rejected: it would leave `role` partially load-bearing
forever (blocking 004's planned removal) and would require whichever new-Equipment creation path
this feature locates (Decision §4) to write to *both* `role` and `kind` to stay correct — the
redundant-writes version of the same problem.

## Summary of resolved unknowns

| Unknown | Resolution |
|---|---|
| New column vs. reuse `role` | New nullable `accounts.kind` column + `AccountKind` enum |
| Backfill mechanism | Extend `db/auto-upgrade.ts`, seed defaults by `account_defaults` code, rest → `NULL` ("needs review") |
| Kind-change eligibility | Gate on existing edit-blocking rules only, not `canChangeAccountType`'s movement gate |
| Equipment vs. kind | Kind selector excludes Equipment; Equipment keeps its existing separate path, stamped `kind = Equipment` there |
| CFS activity grouping | Derived from the movement's other-side account (Equipment → Investing, partner/opening → Financing, else → Operating) |
| CFS tie-out | Independent opening/closing cash reads vs. summed lines, same pattern as `balance-sheet.ts`/`funds-flow.ts` |
| Tab visibility | New `hasPartners` boolean threaded into reports page data; Cash Flow always shown |
| Retired tab redirects | `owed-to-us` / `we-owe` → `redirect(302, '/contacts')` |
| Dashboard/report tally | Net-profit tile calls `profitLossReport` directly; position tile already compliant; cash-flow tile calls new `cashFlowReport` |
| Funds Flow panel | Retired, superseded by the new Cash Flow indicator; `historyGapNotes()` reused |
| Current-assets / AP tiles | Folded into the single financial-position indicator |
| `role` vs. `kind` overlap | Not merged (contradicts 004's retirement plan, saves no work); instead `isEquipmentAccount`/`isMoneyPotAccount` re-pointed onto `kind`, making `role` fully inert for Asset rows |
