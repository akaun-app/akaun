# Contract: Chart Conversion at Startup

The conversion has no command. `createDb()` in `src/lib/server/db/client.ts` classifies the
database file before opening it for writing and runs `upgradeDatabaseFile` from
`src/lib/server/db/auto-upgrade.ts` when there is anything to do (002 FR-037: no manual step for a
self-hosting user, safe to run more than once).

`classifyDatabaseFile(path)` reads through its own read-only connection and returns one of:

| State         | Meaning                                                 | What happens                                                         |
| ------------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `fresh`       | No file yet                                             | Nothing; `seedAccounts` gives it the default chart                   |
| `legacy_0005` | Records still in `expenses`/`incomes`/`claims`          | Full conversion, then standardization                                |
| `ledger`      | Double-entry, chart not standardized                    | Standardization only                                                 |
| `completed`   | A completed run for `004-standardize-chart-accounts-v1` | Nothing                                                              |
| `unsupported` | A partial schema no path accepts                        | Nothing; the legacy-drop guard refuses and the server does not start |

A conversion that throws logs the reason, prints it, and exits non-zero. The server does not start
on a half-standardized chart. `legacyDropAllowed` stays in place immediately afterwards as a second,
independent gate on the one thing that cannot be undone from inside the app: migration 0015 must
never run against unconverted rows.

`dryRun` is retained on `upgradeDatabaseFile` for the spec, which uses it to prove the source is
left byte-identical. Nothing in the app passes it.

### Staged migration-0005 bootstrap

The ordinary all-migrations path cannot be used against migration 0005, because 0015 drops the
legacy tables that supply the conversion. The upgrade instead consolidates the main/WAL view into a
temporary database beside the source, verifies the input state, applies 0006 through 0014, converts
and validates the preserved legacy records, then applies 0015 and 0016 and standardizes the chart.
Only after balanced-record, snapshot and foreign-key validation succeeds is the original database
family moved to a timestamped `pre-chart-<stamp>/` directory and the consolidated result installed.

Dry-run and failures remove only the temporary copy. The original path is never mutated in place, so
the previous data stays recoverable (002 FR-038). Two processes racing are caught by the source
checksum re-check ("The source database changed while conversion was running"); the loser exits
without installing.

Summary: version/status, mapped accounts, assigned codes/conflicts, created seeds, installed
defaults, completed merges, retyped accounts, alias renames, rewritten import categories, moved
references by table, pre/post snapshots, balanced-record count, dangling-reference count and
attention items. It additionally reports input migration/state and legacy counts for records,
claims, attachments and incomplete imports. Pending and import-review rows are preserved; the
conversion never silently confirms, skips or deletes one.

### How an account is matched to the standardized chart

Four rules, applied in this order, all from `services/account-migration.ts`:

1. **Retype** — `ACCOUNT_RETYPES` in `services/account-aliases.ts`. An account whose legacy _kind_
   was wrong is retyped before any code is assigned, so it takes a code in its new range. One entry:
   `Equipment`, Expense → Asset (002 FR-006b). This is the only place in the codebase permitted to
   change the type of an account that has movements; `canChangeAccountType` refuses it everywhere
   else, and rightly so.
2. **Alias** — `ACCOUNT_ALIASES`. A legacy name that means a seeded account is renamed onto the
   seeded name where that name is free, so the account keeps its id and its movements and nothing
   has to be repointed. Where the seeded name is already taken the pair is merged instead, with the
   **seed-named row surviving** — the opposite of rule 4, because an alias says the legacy name was
   the wrong name. Two aliases may share one target (`Other` and `Uncategorised` both mean
   `Other Expenses`): the first claimant is renamed, the rest merge into it.
3. **Exact name** — an account whose normalized name and type match a `DEFAULT_CHART` entry takes
   that entry's code, and the seed is not created beside it. Codes in `DEFAULT_CHART` are reserved,
   so an unmatched account never takes 1000 from `Cash` (FR-058, FR-059).
4. **Duplicate seed** — where a prior release left an exact duplicate, the **non-seeded row
   survives** and the seeded row is retained as a redirect.

An unmatched name keeps its own account, its own name and its own code: 002 FR-033 requires every
existing category to survive with the same records against it. All account references move and the
merge audit and redirect are written in the same transaction. A completed-version retry verifies and
reports zero mutations.

Finally, `import_queue.category` is rewritten through the alias table for rows with
`completed_at IS NULL`. `matchCategoryAccount` resolves a queued category by exact name with no
fuzzy fallback, so renaming an account without rewriting the queue would drop every waiting row onto
Uncategorised.
