import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AccountType,
  DefaultAccountPurpose,
  type AccountTypeCode,
  type DefaultAccountPurposeCode,
} from "$lib/enums.js";
import * as schema from "../db/schema.js";
import type { LedgerDb } from "../ledger/types.js";
import {
  getAccountDefaults,
  replaceAccountDefaults,
  requireAccountDefault,
} from "./account-defaults.js";

let sqlite: Database;
let db: LedgerDb;

const PURPOSES: readonly [DefaultAccountPurposeCode, AccountTypeCode][] = [
  [DefaultAccountPurpose.Receivable, AccountType.Asset],
  [DefaultAccountPurpose.Payable, AccountType.Liability],
  [DefaultAccountPurpose.OpeningBalances, AccountType.Equity],
  [DefaultAccountPurpose.SalesRevenue, AccountType.Revenue],
  [DefaultAccountPurpose.UncategorisedExpense, AccountType.Expense],
  [DefaultAccountPurpose.EverydayTransaction, AccountType.Asset],
];

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id INTEGER PRIMARY KEY);
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role INTEGER NOT NULL,
      type INTEGER,
      code INTEGER,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES accounts(id),
      merged_into_account_id INTEGER REFERENCES accounts(id),
      contact_id INTEGER,
      is_system INTEGER NOT NULL DEFAULT 0,
      rank TEXT NOT NULL,
      archived_at TEXT,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE account_defaults (
      purpose INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_type TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      changes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE ledger_movements (
      id INTEGER PRIMARY KEY,
      record_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      amount_minor INTEGER NOT NULL,
      sort_order INTEGER NOT NULL
    );
  `);
  db = drizzle(sqlite, { schema });
  sqlite.run("INSERT INTO users (id) VALUES (7)");
});

function account(type: AccountTypeCode, name: string, extra = ""): number {
  const count = sqlite
    .query<{ n: number }, []>("SELECT count(*) AS n FROM accounts")
    .get()!.n;
  sqlite.run(
    `INSERT INTO accounts (role, type, code, name, rank ${extra ? ", archived_at" : ""}) VALUES (1, ?, ?, ?, ? ${extra ? ", ?" : ""})`,
    extra
      ? [type, 1000 + count, name, name, extra]
      : [type, 1000 + count, name, name],
  );
  return Number(
    sqlite.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!
      .id,
  );
}

function validInputs() {
  return PURPOSES.map(([purpose, type], index) => ({
    purpose,
    accountId: account(type, `Account ${index}`),
  }));
}

describe("saved account defaults", () => {
  it("atomically saves and returns all six compatible active leaves", () => {
    const inputs = validInputs();
    expect(replaceAccountDefaults(db, 7, inputs).ok).toBe(true);
    expect(
      getAccountDefaults(db).map((item) => [
        item.purpose,
        item.account?.id,
        item.valid,
      ]),
    ).toEqual(inputs.map((item) => [item.purpose, item.accountId, true]));
    expect(
      sqlite
        .query<{ n: number }, []>(
          "SELECT count(*) AS n FROM audit_log WHERE record_type = 'account' AND action = 'update'",
        )
        .get()!.n,
    ).toBe(6);
  });

  it("refuses a missing purpose without changing existing defaults", () => {
    const initial = validInputs();
    expect(replaceAccountDefaults(db, 7, initial).ok).toBe(true);
    const result = replaceAccountDefaults(db, 7, initial.slice(0, 5));
    expect(result.ok).toBe(false);
    expect(getAccountDefaults(db).map((item) => item.account?.id)).toEqual(
      initial.map((item) => item.accountId),
    );
    expect(
      sqlite.query<{ n: number }, []>("SELECT count(*) AS n FROM audit_log").get()!.n,
    ).toBe(6);
  });

  it("refuses the wrong type, inactive accounts, and headings", () => {
    const base = validInputs();
    const wrongType = account(AccountType.Expense, "Wrong type");
    expect(
      replaceAccountDefaults(db, 7, [
        { ...base[0], accountId: wrongType },
        ...base.slice(1),
      ]).ok,
    ).toBe(false);

    const inactive = account(AccountType.Asset, "Inactive", "2026-01-01");
    expect(
      replaceAccountDefaults(db, 7, [
        { ...base[0], accountId: inactive },
        ...base.slice(1),
      ]).ok,
    ).toBe(false);

    const heading = account(AccountType.Asset, "Heading");
    sqlite.run("UPDATE accounts SET parent_id = ? WHERE id = ?", [
      heading,
      base[0].accountId,
    ]);
    expect(
      replaceAccountDefaults(db, 7, [
        { ...base[0], accountId: heading },
        ...base.slice(1),
      ]).ok,
    ).toBe(false);
  });

  it("revalidates a default immediately before automatic use", () => {
    const inputs = validInputs();
    expect(replaceAccountDefaults(db, 7, inputs).ok).toBe(true);
    for (const [index, [purpose]] of PURPOSES.entries()) {
      expect(requireAccountDefault(db, purpose)).toEqual({
        ok: true,
        value: inputs[index].accountId,
      });
    }

    sqlite.run("UPDATE accounts SET archived_at = '2026-01-01' WHERE id = ?", [
      inputs[1].accountId,
    ]);
    const after = requireAccountDefault(db, DefaultAccountPurpose.Payable);
    expect(after.ok).toBe(false);
  });
});
