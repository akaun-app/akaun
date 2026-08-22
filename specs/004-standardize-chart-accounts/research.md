# Research: Standardized Chart of Accounts

**Feature**: `004-standardize-chart-accounts` | **Date**: 2026-08-21

## R-01 — Type and code

**Decision**: Replace account role with required type 1–5; rename type 4 Income to Revenue without
changing its numeric code. Add a unique integer code and allocate the lowest unused value in the
type range inside the insert/type-change transaction.

**Rationale**: Role is currently only an indirect source through `accountTypeFor`. Keeping both
allows drift. Transaction + unique index prevents concurrent duplicates and predictable gap filling.

**Alternatives considered**: retained subtype role (preserves coupling), text types (breaks enum
pattern), counters table (can drift), unguarded `MAX+1` (race).

## R-02 — Hierarchy

**Decision**: Add nullable self-FK `parent_id`; derive leaf/posting state. Validate same type and no
cycles before writes; recursive queries provide paths and descendant rollups.

**Rationale**: One adjacency edge is sufficient at this scale and avoids stored posting-state drift.

**Alternatives considered**: nested sets/materialized paths (unneeded), stored `is_posting` (drift),
parent movements (double-count ambiguity).

## R-03 — Saved defaults

**Decision**: Add typed `account_defaults` rows for receivable, payable, opening balances, sales
revenue, uncategorised expense and everyday transaction. Each FK is validated by type/active/leaf.

**Rationale**: Current generic settings hold only everyday account and cannot enforce FKs; invoice
and system behavior otherwise relies on role/name lookup.

**Alternatives considered**: six KV strings (weak integrity), role flags (recreates old model).

## R-04 — Reconciliation and reports

**Decision**: Replace money-pot guards with common active-leaf eligibility. Keep statement
`account_id` and movement-scoped matching. Reports classify by direct type and calculate each leaf
once; Asset/Expense are debit-normal, Liability/Equity/Revenue credit-normal.

**Rationale**: Existing statement ownership already isolates candidates. Direct type removes role
lists, while separate detail/subtotal calculations prevent double counting.

**Alternatives considered**: reconciliable capability (no present need), cached parent balances
(duplicates ledger truth).

## R-05 — Conversion and complete references

**Decision**: An explicit Bun command snapshots invariants, maps roles, assigns codes in stable
`(role, rank, id)` order, seeds gaps/defaults, and merges exact normalized-name + same-type seeded
duplicates in one transaction. It updates `ledger_movements.account_id`,
`bank_statements.account_id`, `import_queue.account_id`, `invoices.income_account_id`, defaults,
parent links and every account FK found by schema verification.

**Rationale**: A reviewable operator action is safer than boot-time mutation. Preserving movement and
statement IDs keeps settlements and allocations intact; one transaction prevents partial merges.

**Alternatives considered**: boot conversion (hidden operational risk), interactive proposal UI
(out of scope), incremental commits (partial-state risk).

## R-06 — Merge identity and links

**Decision**: Existing account survives. Seeded duplicate stays as an archived alias with
`merged_into_account_id`; audit records store moved-reference counts and skipped reasons.

**Rationale**: Retaining the source row gives old links, audit references and FK integrity a durable
resolution without deleting identity.

**Alternatives considered**: delete plus in-memory redirects (lost on restart), keep active duplicate
(not a merge), seeded survivor (breaks existing links).

## R-07 — Risks and verification

**Decision**: Test allocation, hierarchy, eligibility, defaults and merge selection first; run
conversion fixtures twice; require SQLite `foreign_key_check`, balanced records, no dangling
references and exact pre/post account/report totals.

**Rationale**: Role assumptions span entry builder, settlement, import, invoice, dashboard, partner
statement, reports and reconciliation. Schema/UI tests alone cannot catch silent financial loss.

**Alternatives considered**: UI-only validation and coverage targets (neither proves invariants).

## R-08 — Verified production snapshot

**Decision**: Treat migration `0005` as the required production input, not the role-based
double-entry schema. The chart command must compose legacy-to-ledger conversion with chart
standardization before migration `0015` may drop legacy tables.

**Evidence**: The live WAL-backed `data/akaun.db` has exactly the six repository migration hashes
`0000`–`0005`, passes integrity/foreign-key checks, and contains no `accounts`,
`ledger_records`, `ledger_movements` or statements. It contains:

| Data | Count |
|---|---:|
| Expense categories | 14 |
| Income categories | 6 |
| Expenses | 194 |
| Incomes | 7 |
| Claims | 35 |
| Expense/income attachments | 208 |
| Claimed expenses | 193 |
| Incomplete import jobs | 34 |

Every expense/income category string matches a category row under the legacy type convention (0
expense, 1 income). Exact normalized matches with the proposed default chart are only `Product Sales`,
`Packaging` and `Utilities`; they should receive their seeded codes directly. Similar names such as
`Marketing`/Advertising, `Logistics`/Shipping, `Software & Subscriptions`/Software and
`Other`/Other Expenses remain separate.

**Rationale**: Current code removed `ensureLedgerUpgrade` and deliberately refuses an unconverted
database before applying the legacy-table drop. Ignoring this baseline would make the planned command
unusable on the actual deployment.

**Alternatives considered**: Require an intermediate old release (operationally fragile and not
self-contained); apply current migrations directly (guard refusal/data-loss risk); discard incomplete
imports (violates reachability).
