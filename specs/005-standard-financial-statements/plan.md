# Implementation Plan: Standard Financial Statements on Dashboard and Reports

**Branch**: `005-standard-financial-statements` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-standard-financial-statements/spec.md`

## Summary

Today no account distinguishes real cash from a receivable or inventory (the asset `role` column
is a legacy shadow of `type`, always `Bank` for every asset), so a genuine Cash Flow Statement is
impossible and the Reports/Dashboard screens each compute figures their own way. This feature adds
a real `subType` classification to asset accounts (Cash, Bank, Wallet, Card, Accounts receivable,
Inventory, Other current asset, Equipment) — `type` is the main group, `subType` the finer
classification within it — uses it to build a new Cash Flow Statement in Reports, drops the two
report tabs that duplicate Contacts (Receivables, Payables), and replaces the Dashboard's ad hoc
charts and KPI tiles with three indicators — net profit, financial position, cash flow — each one
a direct call into the same report function Reports itself uses, so the two screens can never
disagree (the existing `funds-flow.ts` module, and its own doc comment, already flag that a
current-assets-based figure cannot honestly be called a cash flow statement — this is the fix).
This also finishes the last step of `role`'s planned retirement for asset accounts: its four live
readers (`isEquipmentAccount`/`isMoneyPotAccount`, the client mirror `isEquipmentSide`,
`defaultAccountId`'s fallback filter, and the dashboard's `recentRecords` query) all move onto
`subType`, so the two enums are not meant to coexist as parallel classifications going forward —
`role` becomes fully inert for Asset rows, kept only to satisfy the column's `NOT NULL` constraint.
Six functions and two enum exports that already have zero callers (`isSharedOwedRole`,
`isCategoryRole`, `isProfitAndLossRole`, `isBalanceSheetRole`, `displaySign`, `MONEY_POT_ROLES`,
`AccountRoleLabels`, `accountRoleEnum`) are deleted as dead-code cleanup in the same pass.
Dropping the `role` column and `AccountRole` enum themselves is explicitly **out of scope** —
research.md §13 found a real migration-sequencing hazard in the one-time legacy-database upgrade
path (raw SQL there names `role` literally, independent of `schema.ts`), which needs its own
dedicated, careful design in a future feature, not a drive-by deletion here. See `research.md` for
the thirteen technical decisions this depends on.

## Technical Context

**Language/Version**: TypeScript (strict mode), Bun runtime

**Primary Dependencies**: SvelteKit 2 with Svelte 5 runes, Drizzle ORM, Zod (validation at every
boundary), `bits-ui`, Tailwind 4

**Storage**: SQLite via Drizzle — one new additive column (`accounts.subType`) via `drizzle-kit
generate`; no new table beyond what a migration/backfill marker needs, no new datastore

**Testing**: Vitest — `server` project (Bun, real temporary SQLite fixtures) for the backfill
migration and the new pure `cashFlow()` report function; `client` project (Node/Playwright) not
expected to need new coverage, this feature has no new component logic complex enough to warrant it

**Target Platform**: Web — the existing single SvelteKit app serving browser, installable PWA,
Tauri desktop, and mobile web (Constitution I)

**Project Type**: Single web application, no new project/service

**Performance Goals**: None new; the new Cash Flow Statement and dashboard indicators reuse the
existing `accountTotals`-family SQL primitives already used by Profit & Loss and Balance Sheet, so
no new query shape or performance profile is introduced

**Constraints**: Must keep working on the existing single-SQLite-file, self-hosted deployment
(Raspberry Pi / NAS / small VPS) with no new external service (Constitution II)

**Scale/Scope**: Touches the `accounts` table (all Asset rows), the Reports module (5 tabs → 4,
one of them new), and the Dashboard (3 charts + 1 funds-flow panel + 4 KPI tiles → 3 statement
indicators)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Principle | Check |
|------|-----------|-------|
| Single codebase | I | PASS — no platform fork; Reports/Dashboard already responsive, new indicators/tab reuse the same responsive containers. |
| Lightweight | II | PASS — one additive SQLite column, no new datastore/broker/service; no new mandatory network dependency. |
| YAGNI | III | PASS — `AccountSubType` enum sized exactly to the spec's 8 values; no config knob; sub-type-eligibility logic reuses existing edit-lock checks rather than inventing a new mechanism. |
| SOLID boundaries | IV | PASS — new pure calculation in `ledger/reports/cash-flow.ts`, new SQL in `queries/reports.ts`, business rule for sub-type-eligibility in `services/accounts.ts`; routes stay parse+authorize+delegate; all external input (`subType` field) validated via the existing `.strict()` Zod schemas. |
| Mutation obligations | IV | PASS — `POST`/`PATCH /api/accounts` already call `hasPermission`, Zod-validate, `recordAudit`, and emit on `accountEvents`; the `subType` field rides the same obligations, no new mutating endpoint is introduced (Cash Flow Statement is read-only, `reports` stays view-only per Constitution VII). |
| TDD scope | V | PASS — the backfill migration (real temp-SQLite test, `db/auto-upgrade.spec.ts` pattern) and the pure `cashFlow()`/sub-type-eligibility functions are in-scope for red-green tests; Svelte/route wiring is not, per existing convention. |
| Established patterns | VI | PASS — SSE reuses `ledgerEvents`/`accountEvents`, no new emitter; Reports keeps the full-page pattern (CLAUDE.md's Detail Page Standard already carves out Reports as pages); CSV export reuses `csv.ts`/`report-endpoint.ts`; no drawer/detail-page pattern is touched. |
| Fixed stack | Tech Constraints | PASS — Svelte 5 runes, Drizzle + SQLite via `drizzle-kit generate` with the migration committed alongside the schema change; new server-only logic under `$lib/server/**`; any client mirror (e.g. sub-type badges in a picker) hand-duplicated with a `// Mirrors ...` comment per existing convention. |

No violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/005-standard-financial-statements/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── accounts-api.md
│   ├── reports-api.md
│   └── dashboard-data.md
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

Single SvelteKit application (Constitution I) — no new project. Real paths this feature touches:

```text
src/lib/enums.ts                                  # + AccountSubType enum;
                                                   #   AccountRoleLabels/accountRoleEnum deleted (dead code, Research §13)

src/lib/server/db/
├── schema.ts                                      # + accounts.subType column (SQL: sub_type)
├── seed-accounts.ts                                # default-account → subType mapping
└── auto-upgrade.ts                                 # + one-time subType backfill pass

drizzle/
└── NNNN_account_sub_type.sql                       # generated via `bun run db:generate`

src/lib/server/ledger/
├── types.ts                                        # + AccountSubType fields on Account*, + accountSubType on MovementView, + CashFlowReport
├── account-type.ts                                 # + CASH_AND_EQUIVALENT_SUBTYPES / needs-review helpers;
│                                                    #   isEquipmentAccount/isMoneyPotAccount re-pointed onto subType (Research §12);
│                                                    #   MONEY_POT_ROLES, isSharedOwedRole, isCategoryRole,
│                                                    #   isProfitAndLossRole, isBalanceSheetRole, displaySign deleted (dead code, Research §13)
├── account-eligibility.ts                          # + sub-type-change eligibility (looser than type-change)
└── reports/
    ├── cash-flow.ts                                 # NEW — pure cashFlow() calculation
    ├── csv.ts                                        # + cashFlowCsv()
    └── funds-flow.ts                                 # removed as a dashboard source (Research §10)

src/lib/components/ledger/account-kinds.ts          # renamed account-sub-types.ts; isEquipmentSide/isCategorySide
                                                     # re-pointed onto accountSubType (client mirror, Research §12)

src/lib/server/services/accounts.ts                 # createAccount/patchAccount handle subType
src/lib/server/queries/
├── accounts.ts                                      # defaultAccountId's fallback filter re-pointed onto subType,
│                                                     #   null-safely (Research §12 correctness caution)
├── reports.ts                                       # + cashFlowReport(db, from, to), + partnerContacts-derived hasPartners
└── dashboard.ts                                      # net-profit/position/cash-flow indicators; remove chart/funds-flow queries;
                                                       #   recentRecords re-pointed onto subType; IS_CURRENT_ASSET/currentAssetsAsAt
                                                       #   deleted as dead code once their only callers are removed (Research §12)

src/lib/server/loaders/reports.ts                    # REPORT_VIEWS drops owed-to-us/we-owe, redirects them; + hasPartners

src/routes/api/accounts/+server.ts                   # POST: + subType
src/routes/api/accounts/[id]/+server.ts              # PATCH: + subType
src/routes/api/reports/cash-flow/+server.ts          # NEW endpoint, mirrors balance-sheet/+server.ts
src/routes/(app)/reports/[view]/+page.server.ts      # redirect for retired views (via loadReportsPage)
src/routes/(app)/dashboard/+page.server.ts           # new indicator data, removed chart/funds-flow data

src/lib/components/accounts/
├── AccountSheet.svelte                               # + sub-type selector (create)
└── AccountDetail.svelte                              # + sub-type selector/badge (edit)

src/lib/components/reports/
├── ReportsPage.svelte                                # TABS filtered by hasPartners, cash-flow tab added
├── CashFlowStatementReport.svelte                     # NEW
├── OwedToUs.svelte / WeOwe.svelte                      # deleted
└── report-links.ts                                    # extended for dashboard indicator hrefs

src/lib/components/dashboard/
├── +page.svelte                                       # 3 indicator tiles replace charts + funds-flow panel
├── FundsFlow.svelte                                    # deleted
└── charts/BarChart.svelte, DonutChart.svelte, TrendBars.svelte  # deleted if no other caller (grep-confirm at implementation time)
```

**Structure Decision**: No new project or service — every change lands inside the existing single
SvelteKit codebase, following the layer boundaries already fixed by Constitution IV
(`routes/` → `lib/server/services/` → `lib/server/queries/`/`db/`, pure calculation in
`lib/server/ledger/reports/`).

## Complexity Tracking

*No entries — Constitution Check has no violations to justify.*
