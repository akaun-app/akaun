import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import { AccountRole, AccountType } from "$lib/enums.js";
import {
  CHART_MIGRATION_VERSION,
  migrateAccountChart,
  normalizeAccountName,
} from "./account-migration.js";

function fixture(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    "CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, role INTEGER NOT NULL, type INTEGER, code INTEGER UNIQUE, name TEXT NOT NULL, parent_id INTEGER REFERENCES accounts(id), merged_into_account_id INTEGER REFERENCES accounts(id), rank TEXT NOT NULL, archived_at TEXT);",
  );
  db.exec(
    "CREATE TABLE account_defaults (purpose INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id));",
  );
  db.exec(
    "CREATE TABLE account_migration_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, version TEXT UNIQUE NOT NULL, status TEXT NOT NULL, started_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL, completed_at TEXT, summary_json TEXT DEFAULT '{}' NOT NULL, before_snapshot_json TEXT DEFAULT '{}' NOT NULL, after_snapshot_json TEXT DEFAULT '{}' NOT NULL);",
  );
  db.exec(
    "CREATE TABLE account_merge_audits (id INTEGER PRIMARY KEY AUTOINCREMENT, source_account_id INTEGER UNIQUE NOT NULL, survivor_account_id INTEGER NOT NULL REFERENCES accounts(id), run_id INTEGER NOT NULL REFERENCES account_migration_runs(id), normalized_name TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT, reference_counts_json TEXT DEFAULT '{}' NOT NULL);",
  );
  db.exec(
    "CREATE TABLE ledger_movements (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id), amount_minor INTEGER NOT NULL);",
  );
  return db;
}

describe("chart account migration", () => {
  it("Name_WhenNormalised_ShouldMatchOnlyExactCaseAndWhitespaceVariants", () => {
    expect(normalizeAccountName("  PRODUCT   Sales ")).toBe("product sales");
    expect(normalizeAccountName("Marketing")).not.toBe(
      normalizeAccountName("Advertising"),
    );
  });

  it("LegacyAccounts_WhenMigrated_ShouldMapRolesAndAssignStableCodes", () => {
    const db = fixture();
    db.query(
      "INSERT INTO accounts(id, role, name, rank) VALUES (?, ?, ?, ?)",
    ).run(9, AccountRole.Payable, "Supplier balance", "b");
    db.query(
      "INSERT INTO accounts(id, role, name, rank) VALUES (?, ?, ?, ?)",
    ).run(2, AccountRole.Bank, "Operating bank", "a");
    db.query(
      "INSERT INTO accounts(id, role, name, rank) VALUES (?, ?, ?, ?)",
    ).run(5, AccountRole.IncomeCategory, "Product Sales", "a");

    const summary = migrateAccountChart(db);
    const rows = db
      .query(
        "SELECT id, type, code FROM accounts WHERE id IN (2,5,9) ORDER BY id",
      )
      .all();

    // `Product Sales` is a seeded name, so it takes the seeded code. The other
    // two are not, so they take the lowest code in their range that the default
    // chart is not about to claim — 1000 is Cash and 2000 is Accounts Payable
    // (FR-058, FR-059).
    expect(rows).toEqual([
      { id: 2, type: AccountType.Asset, code: 1001 },
      { id: 5, type: AccountType.Revenue, code: 4000 },
      { id: 9, type: AccountType.Liability, code: 2001 },
    ]);
    expect(
      db.query("SELECT code FROM accounts WHERE name = 'Cash'").get(),
    ).toEqual({ code: 1000 });
    expect(
      db
        .query("SELECT code FROM accounts WHERE name = 'Accounts Payable'")
        .get(),
    ).toEqual({ code: 2000 });
    expect(summary.status).toBe("completed");
    expect(summary.mappedAccounts).toBe(3);
  });

  it("Migration_WhenRetried_ShouldVerifyWithoutMutating", () => {
    const db = fixture();
    db.query("INSERT INTO accounts(role, name, rank) VALUES (?, ?, ?)").run(
      AccountRole.ExpenseCategory,
      "Utilities",
      "a",
    );
    migrateAccountChart(db);
    const before = db.serialize();

    const retry = migrateAccountChart(db);

    expect(retry.status).toBe("already_completed");
    expect(retry.mappedAccounts).toBe(0);
    expect(db.serialize()).toEqual(before);
    expect(
      db
        .query(
          "SELECT count(*) AS n FROM account_migration_runs WHERE version = ?",
        )
        .get(CHART_MIGRATION_VERSION),
    ).toEqual({ n: 1 });
  });

  it("SeedDuplicate_WhenExactAndSameType_ShouldMergeIntoExistingIdentity", () => {
    const db = fixture();
    db.query(
      "INSERT INTO accounts(id, role, type, code, name, rank) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      1,
      AccountRole.IncomeCategory,
      AccountType.Revenue,
      null,
      " product   sales ",
      "a",
    );
    db.query(
      "INSERT INTO accounts(id, role, type, code, name, rank) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      2,
      AccountRole.IncomeCategory,
      AccountType.Revenue,
      4000,
      "Product Sales",
      "b",
    );
    db.query("INSERT INTO ledger_movements VALUES (?, ?, ?)").run(1, 2, -500);

    const summary = migrateAccountChart(db);

    expect(summary.completedMerges).toBe(1);
    expect(db.query("SELECT account_id FROM ledger_movements").get()).toEqual({
      account_id: 1,
    });
    expect(
      db
        .query("SELECT merged_into_account_id FROM accounts WHERE id = 2")
        .get(),
    ).toEqual({ merged_into_account_id: 1 });
  });

  it("SeedCandidate_WhenTypeDiffers_ShouldStaySeparate", () => {
    const db = fixture();
    db.query(
      "INSERT INTO accounts(role, type, code, name, rank) VALUES (?, ?, ?, ?, ?)",
    ).run(
      AccountRole.ExpenseCategory,
      AccountType.Expense,
      5001,
      "Product Sales",
      "a",
    );

    const summary = migrateAccountChart(db);

    expect(summary.completedMerges).toBe(0);
    expect(
      db
        .query(
          "SELECT count(*) AS n FROM accounts WHERE name = 'Product Sales'",
        )
        .get(),
    ).toEqual({ n: 2 });
  });
});
