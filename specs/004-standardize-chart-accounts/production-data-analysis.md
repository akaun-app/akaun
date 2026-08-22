# Production Data Analysis

**Inspected**: 2026-08-21 | **Source**: `data/akaun.db` with WAL companions | **Mode**: read-only

## Schema state

- SQLite integrity check: pass; foreign-key check: no violations.
- Journal mode: WAL.
- Applied migrations: exactly repository `0000` through `0005` (all hashes match).
- Present financial model: legacy `expenses`, `incomes`, `claims`, `categories`.
- Absent: `accounts`, `ledger_records`, `ledger_movements`, `bank_statements`, settlements.
- No `ledger_upgrade_state` exists.

## Relevant volumes

| Item | Count |
|---|---:|
| Users | 2 |
| Contacts | 89 |
| Categories | 20 (14 expense, 6 income) |
| Expenses | 194 |
| Incomes | 7 |
| Claims | 35 |
| Claimed expenses | 193 |
| Expense attachments | 201 |
| Income attachments | 7 |
| Claim attachments | 37 |
| Import queue | 111 total; 34 incomplete |
| Invoices / quotations | 0 / 0 |

All 194 expense and 7 income category strings resolve to an existing category row. Expense dates run
from 2021-01-17 to 2026-08-08; income dates run from 2026-01-28 to 2026-07-31. The display currency is
MYR; legacy records include MYR, USD and one CNY expense, so snapshot comparison must use the stored
exchange rate and minor-unit conversion used by the existing ledger upgrade.

## Category implications

Exact default-chart matches are:

| Existing category | New type | Reserved code |
|---|---|---:|
| Product Sales | Revenue | 4000 |
| Packaging | Expense | 5200 |
| Utilities | Expense | 5500 |

These existing categories should become the seeded-purpose accounts directly, not be duplicated and
then merged. Other legacy categories retain their names and receive deterministic free codes.

No synonym merge is authorized. In particular, Marketing is not Advertising, Logistics is not
Shipping, Software & Subscriptions is not Software, and Other is not Other Expenses. The missing
seeded accounts may be added separately.

## Required upgrade consequence

Production cannot use a migration that begins from `accounts.role`; that table does not exist yet.
The supported command must first perform the legacy-to-double-entry conversion formerly handled by
`ensureLedgerUpgrade`, then standardize the chart, and only after invariant checks permit legacy
tables to be dropped. The production snapshot becomes a regression fixture through a redacted or
locally referenced clone; it must never be edited in place or committed.
