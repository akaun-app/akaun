# Phase 1 Data Model: Standard Financial Statements on Dashboard and Reports

## Entity: Account (extended)

Table: `accounts` (`src/lib/server/db/schema.ts:637-691`). One new column; everything else is
unchanged.

| Field | Type | Notes |
|---|---|---|
| `subType` | `integer`, nullable (SQL column `sub_type`) | New. `AccountSubType` code (see enum below) — the finer classification within `type`, the main group. `NULL` means **needs review** — not a distinct sentinel value, the absence of one. Meaningful only when `type = Asset`; `NULL`/unused for Liability, Equity, Revenue, Expense accounts. |

**Validation rules**

- On create, when `type = Asset`: `subType` is **required** and MUST be one of the seven everyday
  values (`Cash`, `Bank`, `Wallet`, `Card`, `Receivable`, `Inventory`, `OtherCurrentAsset`) —
  Equipment is never accepted from this path (FR-001, FR-003; Research §4).
- On create/patch, when `type ≠ Asset`: `subType` MUST be absent/`NULL`; rejected as a validation
  error if a non-Asset account posts a `subType`, the same way `role` is already never client-set
  (Zod `.strict()` schemas at `api/accounts/+server.ts`, `api/accounts/[id]/+server.ts`).
- On patch, changing `subType` on an existing Asset account is allowed whenever the account is
  otherwise editable (`perms.change`, `!isSystem`, not archived/locked) — it is **not** gated by
  `canChangeAccountType`'s movement/child/statement/default-count checks (Research §3, spec edge
  case).
- An account whose `subType` is set via the existing Equipment path (record-form "what money was
  spent on" choice) is stamped `subType = Equipment` by that path, never by the account form's
  sub-type selector (Research §4).

**State transitions**

```
new Asset account created
        │
        ▼
  sub-type chosen on the form (required) ──────► subType = <one of 7 everyday values>
        │
        └─ (Equipment path instead) ────────────► subType = Equipment  (never via this selector)

existing Asset account, subType = NULL ("needs review")
        │
        ▼ user opens it and sets a sub-type
  subType = <chosen value>   (allowed regardless of movement history, subject to normal edit rules)

existing Asset account, subType already set
        │
        ▼ user reclassifies (e.g. Bank → Inventory)
  subType = <new value>      (same rule — allowed unless account is otherwise uneditable)
```

**Migration/backfill** (one-time, via `db/auto-upgrade.ts`, additive schema migration first):

| Existing account | Resulting `subType` |
|---|---|
| Seeded default matching `account_defaults` code for Cash (1000) | `Cash` |
| Seeded default matching code for Bank/EverydayTransaction (1100) | `Bank` |
| Seeded default matching code for Accounts Receivable (1200) | `Receivable` |
| Seeded default matching code for Inventory (1300) | `Inventory` |
| Any other existing Asset account | `NULL` ("needs review") |
| Account already carrying the legacy `Equipment` role | `Equipment` |
| Non-Asset account (Liability/Equity/Revenue/Expense) | `NULL`, unused |

## New Enum: `AccountSubType`

Location: `src/lib/enums.ts`, alongside the existing `AccountRole`/`AccountType` enums. `type` is
the main group (Asset/Liability/Equity/Revenue/Expense); `subType` is the finer classification
within it.

```
Cash              = 1
Bank              = 2
Wallet            = 3
Card              = 4
Receivable        = 5
Inventory         = 6
OtherCurrentAsset = 7
Equipment         = 8
```

Append-only, same convention as every other enum in this file (`AccountRole`, `AccountType`) —
values are never renumbered or reused.

**Derived groupings** (pure functions in `src/lib/server/ledger/account-type.ts`, mirrored
client-side per the existing client-mirror pattern where a screen needs it before a request to the
server):

- `CASH_AND_EQUIVALENT_SUBTYPES = [Cash, Bank, Wallet, Card]` — FR-006's "cash and cash
  equivalents."
- `OTHER_CURRENT_ASSET_SUBTYPES = [Receivable, Inventory, OtherCurrentAsset]` — current assets
  that are never cash.
- `isNeedsReview(account) = account.type === Asset && account.subType == null`.
- `isEquipmentAccount(account) = account.type === Asset && account.subType ===
  AccountSubType.Equipment` — **moved here from being `role`-based** (research.md §12). This
  supersedes the current `account-type.ts` implementation, which checks `account.role ===
  AccountRole.Equipment`; the legacy `AccountRole` enum and the `role` column are otherwise
  untouched by this feature (research.md §1, §12 — `role` is not merged with `subType`, only its
  live readers move off it; research.md §13 covers whether `role` can eventually be removed
  outright — not in this feature).
- `isMoneyPotAccount(account) = account.type === Asset && !isEquipmentAccount(account)` — same
  logic as today, riding the corrected `isEquipmentAccount`.
- **Three more live sites move off `role` for the same reason** (research.md §12's correction —
  the original "one live reader" count was wrong):
  - `defaultAccountId` (`src/lib/server/queries/accounts.ts:303-330`) — its Asset-not-Equipment
    fallback filter. Must be rewritten null-safely (`subType` is nullable, `role` never was): a
    naive `subType !== Equipment` silently drops every needs-review account from the fallback
    candidates via SQL's three-valued logic. Use a null-safe form (e.g. `subType IS NULL OR
    subType !== Equipment`).
  - `recentRecords` (`src/lib/server/queries/dashboard.ts:224-227`) — its inline
    `type = ? OR role = Equipment` SQL, feeding the dashboard's recent-activity list. An equality
    check is not at risk from the nullability change (a `NULL` `subType` simply fails to match,
    which is correct), so this one is a direct substitution.
  - The client mirror `isEquipmentSide` (`src/lib/components/ledger/account-kinds.ts:16-20`,
    renamed `account-sub-types.ts`) — already covered above, listed here for completeness since
    it's live in `RecordsPage.svelte`.
- `IS_CURRENT_ASSET`/`currentAssetsAsAt` (`src/lib/server/queries/dashboard.ts:375-378` and its
  caller) need **no re-pointing** — both of their only callers (the Funds Flow panel, the
  current-assets KPI tile) are removed by this feature (Research §10, §11), so this becomes dead
  code to delete instead.
- The dead `MONEY_POT_ROLES` array (`account-type.ts:141-146`, unreferenced by any importer), and
  five other zero-caller functions (`isSharedOwedRole`, `isCategoryRole`, `isProfitAndLossRole`,
  `isBalanceSheetRole`, `displaySign`), plus the unreferenced `AccountRoleLabels`/`accountRoleEnum`
  exports in `enums.ts`, are deleted as part of this change (research.md §13) — confirmed
  zero-caller dead code, unrelated to whether `role` itself is ever fully removed.
- `MovementView` (`ledger/types.ts:147-161`) gains `accountSubType: AccountSubTypeCode | null`
  beside its existing `accountRole`/`accountType`, and the client mirror
  `src/lib/components/ledger/account-kinds.ts` — **renamed to `account-sub-types.ts`** as part of
  this change, since the file exists specifically to mirror this concept — is updated to expose
  `isEquipmentSide`/`isCategorySide` reading `accountSubType`, per the existing hand-duplication
  convention (`// Mirrors ...` comment).

## Extended type: `AccountRow` / `AccountView` / `AccountCreate` / `AccountPatch`

Location: `src/lib/server/ledger/types.ts` (frozen interface — a change here is a change for
every caller, per CLAUDE.md).

- `AccountRow`, `AccountView`: add `subType: AccountSubTypeCode | null`.
- `AccountCreate`: add `subType?: AccountSubTypeCode` (required by service-layer validation when
  `type === Asset`, not by the type system, matching how existing required-conditionally fields
  are handled).
- `AccountPatch`: add `subType?: AccountSubTypeCode`.
- Client-facing role-free mirror `src/lib/components/accounts/account-types.ts`
  (`AccountView`/`AccountCreateInput`/`AccountUpdateInput`): same addition, kept in hand-sync per
  existing convention (this file already exists precisely to keep `role` off the client contract;
  `subType` is the opposite — a field the client *is* meant to see and set).

## New Entity: `CashFlowReport`

Location: `src/lib/server/ledger/types.ts`, beside `ProfitLossReport`/`BalanceSheetReport`.

```
CashFlowLine = {
  accountId: number | null   // null for the synthetic "needs review" line
  label: string
  amountMinor: number
}

CashFlowSection = {
  label: "Operating" | "Investing" | "Financing"
  lines: CashFlowLine[]
  totalMinor: number
}

CashFlowReport = {
  dateFrom: string
  dateTo: string
  operating: CashFlowSection
  investing: CashFlowSection
  financing: CashFlowSection
  needsReviewMinor: number        // movement on "needs review" accounts, shown separately (FR-005)
  openingCashMinor: number        // independently read, as at day before dateFrom
  closingCashMinor: number        // independently read, as at dateTo
  netChangeMinor: number          // sum of all section totals
  ties: boolean                   // closingCashMinor - openingCashMinor === netChangeMinor
  differenceMinor: number
  notes: string[]                 // history-gap note (via historyGapNotes), "not yet classified" note, etc.
}
```

**Validation/derivation rules**

- `operating`/`investing`/`financing` lines are derived per Research §5 from each cash-touching
  movement's other-side account.
- A movement whose cash-side account has `subType = NULL` ("needs review") is excluded from every
  section and instead accumulates into `needsReviewMinor`, never silently joining `operating`
  (FR-005).
- `ties = false` triggers a warning note, exactly like `BalanceSheetReport.balances`.

## Extended: Reports page data

Location: `src/lib/server/loaders/reports.ts`.

- `REPORT_VIEWS` becomes `["profit-loss", "balance-sheet", "cash-flow", "partners"] as const` —
  `owed-to-us` and `we-owe` are removed from the type entirely; the route handler recognizes the
  two old string values separately, only to redirect (Research §8).
- `ReportsPageData` (or equivalent) gains `hasPartners: boolean`, computed once per load from the
  existing `partnerContacts(db)` query, consumed by `ReportsPage.svelte` to filter `TABS`.

## Extended: Dashboard indicator data

Location: `src/lib/server/queries/dashboard.ts` / `+page.server.ts`.

Replaces the four ad hoc KPI figures and three chart datasets with three indicators, each a thin
read of the corresponding report:

```
DashboardIndicators = {
  netProfit: { amountMinor: number, dateFrom: string, dateTo: string }        // from profitLossReport(...).resultMinor
  position:  { assetsTotalMinor, liabilitiesTotalMinor, equityTotalMinor, balances: boolean, asAt: string } // from balanceSheetReport
  cashFlow:  { netChangeMinor: number, dateFrom: string, dateTo: string, needsReviewMinor: number } // from cashFlowReport
}
```

Each indicator's link target is computed with the same `dateFrom`/`dateTo`/`asAt` it displayed,
via the existing `report-links.ts` helpers, satisfying FR-015.

`recentActivity` and the period selector (`dashboard-periods.ts`) are unchanged (FR-017). The
`FundsFlow` panel and its backing `fundsFlowStatement()` query are removed (Research §10).
