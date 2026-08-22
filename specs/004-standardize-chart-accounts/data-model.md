# Data Model: Standardized Chart of Accounts

**Feature**: `004-standardize-chart-accounts` | **Date**: 2026-08-21

## Fixed types (code enum, not a table)

| Code | Name | Range | Normal balance | Statement |
|---:|---|---|---|---|
| 1 | Asset | 1000–1999 | Debit | Balance Sheet |
| 2 | Liability | 2000–2999 | Credit | Balance Sheet |
| 3 | Equity | 3000–3999 | Credit | Balance Sheet |
| 4 | Revenue | 4000–4999 | Credit | Income Statement |
| 5 | Expense | 5000–5999 | Debit | Income Statement |

## `accounts` (changed)

Fields: existing `id/name/rank/archived_at/audit timestamps`; new required unique `code`, required
`type`, nullable self-FK `parent_id`, nullable self-FK `merged_into_account_id`. Remove `role`
and contact-specific identity after conversion; duplicate names are allowed. Index
`(type,parent_id,code)`, parent, and merged destination.

Derived: active = not archived; posting eligible = active with no children; direct balance = own
movements; rolled-up balance = self plus descendants; path = ordered ancestors.

Rules: same-type acyclic ancestry; account with movements cannot gain children; type changes only
without movement/child/statement/default dependency and allocate a destination-range code; parents
archive only after descendants; merged rows are inactive and canonicalize directly to one survivor.

## `account_defaults` (new)

Fields: `purpose` integer PK, `account_id` FK RESTRICT, `updated_by`, `updated_at`.

| Purpose | Required type |
|---|---|
| receivable | Asset |
| payable | Liability |
| opening_balances | Equity |
| sales_revenue | Revenue |
| uncategorised_expense | Expense |
| everyday_transaction | Asset |

Every target must be active and a leaf; validate on save and use.

## `account_migration_runs` and `account_merge_audits` (new)

Run: ID, unique version idempotency key, timestamps, status and JSON summary/snapshots.
Merge audit: unique source ID, survivor FK, run FK, normalized name, outcome/reason and JSON
reference counts. Failed transactions leave neither completed run nor partial audit.

## Conversion mapping

| Old roles | Type |
|---|---|
| Bank, Wallet, Cash, Card, Equipment, Receivable | Asset |
| Payable | Liability |
| Opening Balances, Partner Capital, Partner Drawings | Equity |
| Income Category | Revenue |
| Expense Category | Expense |

## Existing relations

Movement and statement account FKs are repointed during merge; their row IDs remain stable, so
settlements and reconciliation allocations remain intact. Import-queue, invoice-income, defaults,
parent and every discovered account FK move atomically. Ledger movements remain the only stored
balance truth.

## Commit invariants

1. Every account has one in-range globally unique code; hierarchy is same-type and acyclic.
2. No account with movements has children; every default is a compatible active leaf.
3. Every record retains at least two non-zero movements summing to zero.
4. Every old identity is reachable directly or through `merged_into_account_id`.
5. Per-account, Balance Sheet, Income Statement and net-profit snapshots match exactly.
6. Foreign-key check passes and the second conversion run performs zero mutations.
