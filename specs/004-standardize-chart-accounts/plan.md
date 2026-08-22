# Implementation Plan: Standardized Chart of Accounts

**Branch**: `004-standardize-chart-accounts` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

## Summary

Replace twelve business-specific account roles with five fixed accounting types and make every
account a system-numbered line in one hierarchical Chart of Accounts. Extend the Drizzle account
model with type, code and parent identity; move automatic-bookkeeping choices into six validated
saved defaults; update ledger, reports, reconciliation and pickers to consume a common posting-account
contract; and ship an idempotent transactional conversion command that preserves links and proves
financial values did not change.

## Technical Context

**Language/Version**: TypeScript 6 strict; Svelte 5.56 runes; SvelteKit 2.63

**Primary Dependencies**: Drizzle ORM 0.45, Zod 4.4, bits-ui 2.16, Tailwind 4, pino 10

**Storage**: SQLite through Drizzle; generated and committed migration

**Testing**: Vitest server/browser projects and conversion tests on disposable SQLite copies

**Target Platform**: Responsive web/PWA and Tauri 2 desktop via adapter-node

**Project Type**: Single full-stack SvelteKit application

**Performance Goals**: ancestor-aware search under one second for 250 accounts/five levels; exact
minor-unit totals; unique account-code allocation in one write transaction

**Constraints**: Offline core; no new dependency/service; immutable five types; globally unique
type-bounded codes; parents never post; conversion is atomic/retry-safe; old links resolve

**Scale/Scope**: Current single-user deployment, while remaining safe under concurrent requests;
18 seeded accounts, six defaults, and all current account references/surfaces

## Verified Production Baseline

The copied production snapshot in `data/` was inspected read-only on 2026-08-21, including its WAL.
It is exactly at Drizzle migrations `0000`–`0005`; it has no accounts or double-entry tables yet.
It contains 194 expenses, 7 incomes, 35 claims, 20 categories and 34 incomplete import jobs. Therefore
the release cannot run only an account-to-account migration, and the current application's
`legacy-drop-guard` would correctly refuse this database.

The implementation MUST provide and test one explicit end-to-end production upgrade path:

1. consolidate/copy the database together with `-wal` and `-shm`;
2. convert the migration-0005 legacy records/categories into the double-entry ledger without dropping
   legacy tables;
3. immediately standardize the resulting accounts, codes, hierarchy and defaults;
4. prove legacy-row reachability, attachments/claims/import state, balanced records and exact totals;
5. only then mark the legacy conversion complete and allow the generated legacy-table drop migration.

The prior release's deleted `ensureLedgerUpgrade` implementation must be recovered from repository
history or reintroduced as tested migration-library code; operators must not be required to deploy an
unverified intermediate application version.

## Constitution Check

_GATE: Passed before Phase 0 and re-checked after Phase 1._

| Gate                 | Principle | Check                                                                                                                           |
| -------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Single codebase      | I         | **PASS** — one responsive implementation serves web, PWA and Tauri.                                                             |
| Lightweight          | II        | **PASS** — existing SQLite, Drizzle and SSE suffice; no dependency or network service added.                                    |
| YAGNI                | III       | **PASS** — only the five types, hierarchy, six named defaults and explicit migration required now are introduced.               |
| SOLID boundaries     | IV        | **PASS** — routes authorise/validate, services own rules, queries read data, pure ledger modules own type/code/hierarchy rules. |
| Mutation obligations | IV        | **PASS** — HTTP mutations retain permission, Zod, audit and SSE; the operator command writes permanent migration/merge audits.  |
| TDD scope            | V         | **PASS** — allocation, hierarchy, posting eligibility, defaults, role conversion, merge selection and snapshots are test-first. |
| Established patterns | VI        | **PASS** — account URLs, Sheet detail, relation cards and account SSE remain; Categories is retired into the chart.             |
| Fixed stack          | Tech      | **PASS** — Svelte runes, Drizzle/SQLite, generated migration and server code under `$lib/server/**`.                            |

**Post-design re-check**: all gates still pass. Code allocation is serialized with insertion.
Merged source rows remain as archived redirect aliases, preserving foreign-key and audit integrity.

## Design Decisions

1. Store `accounts.type` directly and retire role. Numeric type 4 remains stable but is named Revenue.
2. Store a globally unique integer code. Allocate the lowest free code inside the type range in the
   same SQLite transaction; exhaustion is a plain refusal.
3. Use nullable `parent_id`; derive posting eligibility from active state plus no children. Enforce
   same-type ancestry/cycle rules and compute rollups from leaf movements only.
4. Use a typed `account_defaults` table for six purposes. Validate active leaf + required type on
   save and again before automatic writes.
5. Preserve a merged source as archived with `merged_into_account_id`; canonical loaders redirect
   old IDs, chains are forbidden, and the existing account survives.
6. Run conversion through an explicit Bun command, never silently on boot. It accepts both the verified
   migration-0005 legacy schema and an already converted ledger schema, composes the legacy-ledger and
   chart phases, codes accounts, seeds gaps/defaults, validates snapshots and audits.

## Project Structure

```text
specs/004-standardize-chart-accounts/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/{api,events,migration}.md
└── tasks.md                         # later: /speckit-tasks

src/lib/
├── enums.ts                         # fixed types; Revenue label
├── nav-config.ts                    # retire Categories destination
├── components/accounts/
│   ├── AccountsPage.svelte          # five-section searchable tree
│   ├── AccountSheet.svelte          # type/parent edit; read-only code
│   ├── AccountSelect.svelte         # common active-leaf contract
│   └── account-types.ts
├── components/settings/AccountDefaults.svelte
└── server/
    ├── db/{schema,seed-accounts,auto-upgrade}.ts
    ├── ledger/{account-type,account-code,account-hierarchy,account-eligibility}.ts
    ├── queries/{accounts,reports}.ts
    ├── services/{accounts,account-defaults,account-migration,account-aliases}.ts
    └── services/{invoices,reconciliation}.ts
src/routes/
├── (app)/accounts/
├── (app)/settings/
└── api/{accounts,settings/account-defaults}/
drizzle/0016_*.sql
```

**Structure Decision**: Continue the existing single SvelteKit layout. Domain invariants belong in
`server/ledger`, orchestration in services, reads in queries and HTTP concerns in routes.

## Delivery Sequence

1. Add failing pure/service tests for types, codes, hierarchy, defaults, reporting and merge selection.
2. Change schema and generate migration; keep old role data available to conversion.
3. Recover/test the legacy-to-ledger conversion against a production snapshot clone, then compose it
   with chart conversion, complete reference discovery, redirects, idempotency and financial snapshots.
4. Switch automatic creators, settlement rules, reports and reconciliation to types/default IDs.
5. Build unified chart/settings UI and remove dead role/Category surfaces.
6. Run [quickstart.md](./quickstart.md), tests, check, build and the conversion twice.

## Complexity Tracking

No constitutional violations require justification.
