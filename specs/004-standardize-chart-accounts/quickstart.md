# Quickstart Validation: Standardized Chart of Accounts

Use only fresh or copied disposable databases for conversion validation. Because production uses WAL,
copy `akaun.db`, `akaun.db-wal` and `akaun.db-shm` together while the service is stopped, or use
SQLite's online backup API. Copying only the main file is not a valid snapshot.

## Automated gates

```sh
bun run test
bun run check
bun run build
```

Expected: pure rules, services, migration fixtures and browser tests pass.

## Fresh install

Open `/accounts`. Confirm all five sections and FR-055 seeds appear together; six defaults are
reviewable in Settings. Create one leaf per type without entering codes; codes are unique/in range.
Duplicate names remain distinguishable. Partial code/name search retains ancestors and works without
horizontal scrolling at phone/desktop widths.

## Hierarchy and lifecycle

Create a same-type parent and two children, then post to both children. Confirm the parent is absent
from pickers and totals descendants once. Confirm cross-type/cyclic parenting, making a posting
account a parent, protected type changes and invalid archive/delete operations return plain refusals.

## Automatic records, reports and reconciliation

Set all defaults; issue an invoice, opening balance and imported expense. Confirm saved IDs are used,
records balance, and missing/invalid defaults prevent any write. Verify report classification,
accumulated result and hierarchy totals. Upload a statement for a leaf of every type; only movements
touching that account match, while parents cannot reconcile.

## Populated conversion and retry

First verify the fixture reports migration `0005`, 194 expenses, 7 incomes, 35 claims and 20
categories. Run the command in [contracts/migration.md](./contracts/migration.md) on that disposable
populated copy.
Confirm the summary lists mappings, codes/conflicts, seeds/defaults, completed/skipped merges and
reference counts. Confirm 201 legacy expense/income rows, 208 direct attachments, 35 claims, 193 claim
links and 34 incomplete import jobs remain reachable; all snapshots match and old source URLs resolve.
Run it again: expect zero created
accounts, changed codes/parents/defaults, merges, moved references or audit rows.

### Automated staged-bootstrap evidence (2026-08-21)

The conversion fixture constructs a disposable migration-0005 database with the verified production
cardinalities: 194 expenses, 7 incomes, 35 claims, 193 claim links, 208 direct attachments, and 34
incomplete imports. It proves dry-run leaves the source checksum and six applied migration rows
unchanged; conversion produces 201 reachable expense/income records and 236 balanced records; the
result passes foreign-key checking; and a second run reports already-completed with zero mutations
and an unchanged checksum.

This automated evidence does not replace the final operator run on a separately created,
WAL-consistent disposable copy of the deployment database.

### Disposable deployment-copy evidence (2026-08-21)

Created an online SQLite backup of the deployment database in `/private/tmp`; the source database
and its WAL/SHM family were not modified. Dry-run and conversion both reported migration `0005`, 194
expenses, 7 incomes, 35 claims, 208 direct attachments, 34 incomplete imports, 236 balanced ledger
records, zero foreign-key violations and no attention items. A second conversion reported
`already_completed`, zero moved references, zero attention items and zero foreign-key violations.

### Fresh-install and scenario evidence (2026-08-21)

Started the application against a newly migrated disposable database and checked the account page at
a 390×844 mobile viewport. It displayed all five type sections and all 18 seeded accounts without
horizontal page overflow. The focused service/query suites exercise fresh account creation and code
allocation, hierarchy refusals and rollups, all six automatic defaults, invoices/opening balances and
imports, report classification and subtotals, five-type reconciliation, conversion rollback and the
no-op retry. The final full gates passed: 379 server tests, one browser test, static checks and the
production build (using the disposable build database).

Release only with tests/check/build passing, `foreign_key_check` clean, no attention items or dangling
references, exact financial snapshots and a no-op retry summary.
