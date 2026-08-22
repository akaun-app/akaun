import { Database } from "bun:sqlite";
import { describe, expect, it } from "vitest";
import {
  discoverAccountReferences,
  repointAccountReferences,
} from "./account-reference-map.js";

function fixture(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER REFERENCES accounts(id),
      merged_into_account_id INTEGER REFERENCES accounts(id)
    );
    CREATE TABLE ledger_movements (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id)
    );
    CREATE TABLE account_defaults (
      purpose INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id)
    );
    CREATE TABLE unrelated (id INTEGER PRIMARY KEY, account_id INTEGER);
  `);
  return db;
}

describe("account reference discovery", () => {
  it("Schema_WhenInspected_ShouldClassifyEveryRealAccountForeignKey", () => {
    const db = fixture();
    expect(discoverAccountReferences(db)).toEqual([
      { table: "account_defaults", column: "account_id", retained: false },
      { table: "accounts", column: "merged_into_account_id", retained: true },
      { table: "accounts", column: "parent_id", retained: false },
      { table: "ledger_movements", column: "account_id", retained: false },
    ]);
    db.close();
  });

  it("Merge_WhenRepointed_ShouldMoveWritableReferencesAndRetainRedirect", () => {
    const db = fixture();
    db.exec("INSERT INTO accounts(id) VALUES (1), (2), (3)");
    db.exec("UPDATE accounts SET parent_id = 2 WHERE id = 3");
    db.exec("INSERT INTO ledger_movements VALUES (1, 2)");
    db.exec("INSERT INTO account_defaults VALUES (1, 2)");

    expect(repointAccountReferences(db, 2, 1)).toEqual({
      account_defaults: 1,
      accounts: 1,
      ledger_movements: 1,
    });
    expect(db.query("SELECT account_id FROM ledger_movements").get()).toEqual({
      account_id: 1,
    });
    expect(
      db.query("SELECT parent_id FROM accounts WHERE id = 3").get(),
    ).toEqual({
      parent_id: 1,
    });
    db.close();
  });
});
