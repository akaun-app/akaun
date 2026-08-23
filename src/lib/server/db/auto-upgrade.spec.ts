import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AccountRole,
  AccountSubType,
  AccountType,
  ExpenseSubType,
  LiabilitySubType,
  RevenueSubType,
} from "$lib/enums.js";
import {
  applyMigrationRange,
  applySubTypeBackfill,
  classifyDatabaseFile,
  upgradeDatabaseFile,
} from "./auto-upgrade.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function hash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function fixturePath(): string {
  const directory = mkdtempSync(join(tmpdir(), "akaun-chart-fixture-"));
  directories.push(directory);
  return join(directory, "akaun.db");
}

/** The expense categories of the real book, with their real record counts. */
const EXPENSE_CATEGORIES: readonly [string, number][] = [
  ["Packaging", 47],
  ["Equipment", 39],
  ["Marketing", 25],
  ["Materials", 21],
  ["Software & Subscriptions", 17],
  ["Utilities", 12],
  ["Logistics", 9],
  ["Other", 8],
  ["Operation", 7],
  ["Office Supplies", 5],
  ["Professional Services", 3],
  ["Food & Beverage", 1],
];

/** Category strings sitting on unfinished import-queue rows in the real book. */
const QUEUED_CATEGORIES: readonly [string, number][] = [
  ["Packaging", 12],
  ["Software & Subscriptions", 6],
  ["Food & Beverage", 5],
  ["Utilities", 4],
  ["Materials", 3],
  ["Equipment", 2],
  ["Transport", 1],
  ["Professional Services", 1],
];

function spread(pairs: readonly [string, number][]): string[] {
  return pairs.flatMap(([name, count]) =>
    Array.from({ length: count }, () => name),
  );
}

function productionShape(): string {
  const path = fixturePath();
  const db = new Database(path);
  applyMigrationRange(db, 0, 5);
  db.query(
    "INSERT INTO users(id, email, username, password_hash, role) VALUES (1, 'admin@localhost', 'admin', 'x', 'owner')",
  ).run();
  const expenseNames = [
    ...EXPENSE_CATEGORIES.map(([name]) => name),
    "Transport",
    "Accommodation",
  ];
  expenseNames.forEach((name, index) => {
    db.query("INSERT INTO categories(type, name, rank) VALUES (0, ?, ?)").run(
      name,
      `e${index}`,
    );
  });
  [
    "Client Project",
    "Product Sales",
    "Consulting",
    "Investment",
    "Rental",
    "Other",
  ].forEach((name, index) => {
    db.query("INSERT INTO categories(type, name, rank) VALUES (1, ?, ?)").run(
      name,
      `i${index}`,
    );
  });
  for (let id = 1; id <= 35; id += 1) {
    db.query(
      "INSERT INTO claims(id, claim_number, date, status, created_by) VALUES (?, ?, '2026-01-01', 2, 1)",
    ).run(id, `CLM-${id}`);
  }
  const categoryOfExpense = spread(EXPENSE_CATEGORIES);
  for (let id = 1; id <= 194; id += 1) {
    db.query(
      "INSERT INTO expenses(id, expense_number, item_name, category, status, date, amount, currency, exchange_rate, claim_id, created_by) VALUES (?, ?, ?, ?, 3, '2026-01-01', 10, 'MYR', 1, ?, 1)",
    ).run(
      id,
      `EXP-${id}`,
      `Expense ${id}`,
      categoryOfExpense[id - 1],
      id <= 193 ? ((id - 1) % 35) + 1 : null,
    );
    db.query(
      "INSERT INTO expense_attachments(expense_id, filename, display_name) VALUES (?, ?, ?)",
    ).run(id, `expense-${id}.pdf`, `Expense ${id}`);
  }
  for (let id = 195; id <= 201; id += 1) {
    db.query(
      "INSERT INTO expense_attachments(expense_id, filename, display_name) VALUES (1, ?, ?)",
    ).run(`expense-${id}.pdf`, `Expense ${id}`);
  }
  for (let id = 1; id <= 7; id += 1) {
    db.query(
      "INSERT INTO incomes(id, income_number, description_text, category, date, amount, currency, exchange_rate, created_by) VALUES (?, ?, ?, 'Product Sales', '2026-01-01', 20, 'MYR', 1, 1)",
    ).run(id, `INC-${id}`, `Income ${id}`);
    db.query(
      "INSERT INTO income_attachments(income_id, filename, display_name) VALUES (?, ?, ?)",
    ).run(id, `income-${id}.pdf`, `Income ${id}`);
  }
  const queued = spread(QUEUED_CATEGORIES);
  for (let id = 1; id <= 34; id += 1) {
    db.query(
      "INSERT INTO import_queue(id, created_by, state, temp_file_path, original_filename, category) VALUES (?, 1, 4, ?, ?, ?)",
    ).run(`import-${id}`, `tmp-${id}`, `import-${id}.pdf`, queued[id - 1]);
    if (id > 8) {
      // Failed extraction is unfinished too: it remains available for retry.
      db.query("UPDATE import_queue SET state = 7 WHERE id = ?").run(
        `import-${id}`,
      );
    }
  }
  // A finished row naming an aliased category, to prove history is left alone.
  db.query(
    "INSERT INTO import_queue(id, created_by, state, temp_file_path, original_filename, category, completed_at) VALUES ('import-done', 1, 6, 'tmp-done', 'done.pdf', 'Materials', '2026-01-02')",
  ).run();
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  return path;
}

/**
 * A book an earlier release already converted to double-entry but never
 * standardized, with both the legacy name and the seeded name already present so
 * the alias has to merge rather than rename.
 */
function ledgerShape(): string {
  const path = fixturePath();
  const db = new Database(path);
  applyMigrationRange(db, 0, 14);
  db.query(
    "INSERT INTO users(id, email, username, password_hash, role) VALUES (1, 'admin@localhost', 'admin', 'x', 'owner')",
  ).run();
  const ids = new Map<string, number>();
  for (const [role, name] of [
    [AccountRole.Bank, "Bank Account"],
    [AccountRole.ExpenseCategory, "Marketing"],
    [AccountRole.ExpenseCategory, "Advertising"],
    [AccountRole.ExpenseCategory, "Equipment"],
  ] as const) {
    ids.set(
      name,
      Number(
        (
          db
            .query(
              "INSERT INTO accounts(role, name, rank) VALUES (?, ?, ?) RETURNING id",
            )
            .get(role, name, name) as { id: number }
        ).id,
      ),
    );
  }
  const record = (id: number, categoryName: string) => {
    db.query(
      "INSERT INTO ledger_records(id, kind, date, record_number, description, currency, exchange_rate, amount, created_by) VALUES (?, 1, '2026-01-01', ?, ?, 'MYR', 1, 10, 1)",
    ).run(id, `EXP-${id}`, `Expense ${id}`);
    db.query(
      "INSERT INTO ledger_movements(record_id, account_id, amount_minor, sort_order) VALUES (?, ?, 1000, 0)",
    ).run(id, ids.get(categoryName)!);
    db.query(
      "INSERT INTO ledger_movements(record_id, account_id, amount_minor, sort_order) VALUES (?, ?, -1000, 1)",
    ).run(id, ids.get("Bank Account")!);
  };
  record(1, "Marketing");
  record(2, "Advertising");
  record(3, "Equipment");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  return path;
}

function open(path: string): Database {
  return new Database(path, { readonly: true });
}

function accountByName(db: Database, name: string) {
  return db
    .query(
      "SELECT id, code, type, role, archived_at, merged_into_account_id FROM accounts WHERE name = ?",
    )
    .get(name) as {
    id: number;
    code: number;
    type: number;
    role: number;
    archived_at: string | null;
    merged_into_account_id: number | null;
  } | null;
}

function movementsOn(db: Database, accountId: number): number {
  return (
    db
      .query("SELECT count(*) AS n FROM ledger_movements WHERE account_id = ?")
      .get(accountId) as { n: number }
  ).n;
}

describe("staged chart conversion", () => {
  it("DryRun_WhenGivenMigration0005_ShouldValidateAndLeaveSourceUnchanged", () => {
    const path = productionShape();
    const before = hash(path);

    const result = upgradeDatabaseFile({ databasePath: path, dryRun: true });

    expect(result.status).toBe("dry_run");
    expect(result.legacy).toMatchObject({
      expenses: 194,
      incomes: 7,
      claims: 35,
      attachments: 208,
      incompleteImports: 34,
      expenseTotalMinor: 194000,
      incomeTotalMinor: 14000,
    });
    expect(result.foreignKeyViolations).toBe(0);
    expect(hash(path)).toBe(before);
    const source = open(path);
    expect(
      source.query("SELECT count(*) AS n FROM __drizzle_migrations").get(),
    ).toEqual({ n: 6 });
    source.close();
  });

  it("Conversion_WhenRetried_ShouldBeNoOpWithBalancedReachableRecords", () => {
    const path = productionShape();
    const first = upgradeDatabaseFile({ databasePath: path });
    const afterFirst = hash(path);
    const second = upgradeDatabaseFile({ databasePath: path });

    expect(first.status).toBe("completed");
    expect(first.legacy?.balancedRecords).toBe(236);
    expect(second.status).toBe("already_completed");
    expect(second.chart.mappedAccounts).toBe(0);
    expect(second.chart.aliasRenames).toBe(0);
    expect(hash(path)).toBe(afterFirst);

    const db = open(path);
    expect(
      db
        .query(
          "SELECT count(*) AS n FROM ledger_records WHERE legacy_kind IN ('expense', 'income')",
        )
        .get(),
    ).toEqual({ n: 201 });
    expect(
      db
        .query(
          "SELECT count(*) AS n FROM (SELECT record_id FROM ledger_movements GROUP BY record_id HAVING count(*) >= 2 AND sum(amount_minor) = 0)",
        )
        .get(),
    ).toEqual({ n: 236 });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("Classify_WhenGivenEachInputShape_ShouldNameTheStateToUpgradeFrom", () => {
    expect(classifyDatabaseFile(join(fixturePath()))).toBe("fresh");
    const legacy = productionShape();
    expect(classifyDatabaseFile(legacy)).toBe("legacy_0005");
    expect(classifyDatabaseFile(ledgerShape())).toBe("ledger");
    upgradeDatabaseFile({ databasePath: legacy });
    expect(classifyDatabaseFile(legacy)).toBe("completed");
  });
});

describe("mapping a legacy chart onto the standardized one", () => {
  it("Aliases_WhenNamesMeanSeededAccounts_ShouldCarryRecordsOntoTheSeededCode", () => {
    const path = productionShape();
    upgradeDatabaseFile({ databasePath: path });
    const db = open(path);

    // Renamed onto the seed, so the records are on the canonical code.
    for (const [name, code, records] of [
      ["Advertising", 5100, 25],
      ["Software", 5400, 17],
      ["Shipping", 5300, 9],
      ["Cost of Goods Sold", 5000, 21],
      ["Packaging", 5200, 47],
      ["Utilities", 5500, 12],
      ["Product Sales", 4000, 7],
    ] as const) {
      const account = accountByName(db, name)!;
      expect([name, account.code]).toEqual([name, code]);
      expect([name, movementsOn(db, account.id)]).toEqual([name, records]);
    }

    // A name with no seeded meaning keeps its own account, in its own range.
    for (const name of [
      "Operation",
      "Office Supplies",
      "Professional Services",
      "Food & Beverage",
      "Transport",
      "Accommodation",
    ]) {
      const account = accountByName(db, name)!;
      expect([name, account.type]).toEqual([name, AccountType.Expense]);
      expect(account.code).toBeGreaterThanOrEqual(5000);
      expect(account.merged_into_account_id).toBeNull();
    }

    // The seeded chart keeps its canonical codes: no legacy account took 1000.
    expect(accountByName(db, "Cash")!.code).toBe(1000);
    expect(accountByName(db, "Inventory")!.code).toBe(1300);
    expect(accountByName(db, "Loans")!.code).toBe(2100);
    db.close();
  });

  it("Bridges_WhenConversionInventedThem_ShouldBecomeTheSavedDefaults", () => {
    const path = productionShape();
    upgradeDatabaseFile({ databasePath: path });
    const db = open(path);

    const bank = accountByName(db, "Bank")!;
    expect(bank.code).toBe(1100);
    const payable = accountByName(db, "Accounts Payable")!;
    expect(payable.code).toBe(2000);
    // Every claim-backed expense is owed, so the payable side carries the book.
    expect(movementsOn(db, payable.id)).toBeGreaterThan(0);

    const defaults = db
      .query(
        "SELECT purpose, account_id FROM account_defaults ORDER BY purpose",
      )
      .all() as { purpose: number; account_id: number }[];
    const byPurpose = new Map(
      defaults.map((row) => [row.purpose, row.account_id]),
    );
    // 6 = EverydayTransaction, 2 = Payable, 4 = SalesRevenue, 5 = UncategorisedExpense
    expect(byPurpose.get(6)).toBe(bank.id);
    expect(byPurpose.get(2)).toBe(payable.id);
    expect(byPurpose.get(4)).toBe(accountByName(db, "Product Sales")!.id);
    expect(byPurpose.get(5)).toBe(accountByName(db, "Other Expenses")!.id);
    db.close();
  });

  it("SharedTarget_WhenTwoNamesMeanOneAccount_ShouldRenameOneAndMergeTheRest", () => {
    const path = productionShape();
    const result = upgradeDatabaseFile({ databasePath: path });
    const db = open(path);

    // `Other` and `Uncategorised` both mean Other Expenses.
    const survivor = accountByName(db, "Other Expenses")!;
    expect(survivor.code).toBe(5900);
    expect(survivor.archived_at).toBeNull();
    expect(movementsOn(db, survivor.id)).toBe(8);
    // The legacy `Other` was renamed onto the seeded name, so it is the survivor
    // and it keeps its records; `Uncategorised` stays as an archived redirect so
    // a link to it still resolves.
    const redirect = accountByName(db, "Uncategorised")!;
    expect(redirect.merged_into_account_id).toBe(survivor.id);
    expect(redirect.archived_at).not.toBeNull();

    const merged = db
      .query(
        "SELECT count(*) AS n FROM accounts WHERE merged_into_account_id = ?",
      )
      .get(survivor.id) as { n: number };
    expect(merged.n).toBe(1);
    expect(result.chart.completedMerges).toBeGreaterThanOrEqual(1);
    expect(
      db.query("SELECT count(*) AS n FROM account_merge_audits").get(),
    ).toEqual({ n: result.chart.completedMerges });
    db.close();
  });

  it("Equipment_WhenLegacyFiledItAsAnExpense_ShouldBecomeAnAsset", () => {
    const path = productionShape();
    const result = upgradeDatabaseFile({ databasePath: path });
    const db = open(path);

    const equipment = accountByName(db, "Equipment")!;
    expect(equipment.type).toBe(AccountType.Asset);
    expect(equipment.role).toBe(AccountRole.Equipment);
    expect(equipment.code).toBeGreaterThanOrEqual(1000);
    expect(equipment.code).toBeLessThanOrEqual(1999);
    expect(movementsOn(db, equipment.id)).toBe(39);
    expect(result.chart.retypedAccounts).toBe(1);
    expect(
      result.chart.attentionItems.some((item) => item.startsWith("Equipment")),
    ).toBe(true);
    db.close();
  });

  it("ImportQueue_WhenARowNamesARenamedCategory_ShouldRewriteOnlyUnfinishedRows", () => {
    const path = productionShape();
    const result = upgradeDatabaseFile({ databasePath: path });
    const db = open(path);

    // Software & Subscriptions (6) and Materials (3) are the aliased names.
    expect(result.chart.rewrittenImportCategories).toBe(9);
    const counts = db
      .query(
        "SELECT category, count(*) AS n FROM import_queue WHERE completed_at IS NULL GROUP BY category",
      )
      .all() as { category: string; n: number }[];
    const byName = new Map(counts.map((row) => [row.category, row.n]));
    expect(byName.get("Software")).toBe(6);
    expect(byName.get("Cost of Goods Sold")).toBe(3);
    expect(byName.get("Software & Subscriptions")).toBeUndefined();
    expect(byName.get("Materials")).toBeUndefined();
    // Untouched: no seeded account means either of these.
    expect(byName.get("Food & Beverage")).toBe(5);
    expect(byName.get("Transport")).toBe(1);
    // A finished row keeps the name it was filed under.
    expect(
      db
        .query("SELECT category FROM import_queue WHERE id = 'import-done'")
        .get(),
    ).toEqual({ category: "Materials" });
    db.close();
  });

  it("Alias_WhenBothNamesAlreadyExist_ShouldMergeOntoTheSeededOne", () => {
    const path = ledgerShape();
    const result = upgradeDatabaseFile({ databasePath: path });
    const db = open(path);

    expect(result.inputState).toBe("ledger");
    const survivor = accountByName(db, "Advertising")!;
    expect(survivor.code).toBe(5100);
    expect(survivor.archived_at).toBeNull();
    // Its own record plus the one that came across from Marketing.
    expect(movementsOn(db, survivor.id)).toBe(2);

    const source = db
      .query(
        "SELECT archived_at, merged_into_account_id FROM accounts WHERE name = 'Marketing'",
      )
      .get() as { archived_at: string | null; merged_into_account_id: number };
    expect(source.merged_into_account_id).toBe(survivor.id);
    expect(source.archived_at).not.toBeNull();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });
});

/**
 * A book already standardized by an earlier release, before `sub_type`
 * existed — the common case: most real installations are already here, not
 * mid-conversion, and `applySubTypeBackfill` has to reach them too
 * (005 research.md §2).
 */
function completedShape(): string {
  const path = fixturePath();
  const db = new Database(path);
  applyMigrationRange(db, 0, 17);
  db.query(
    "INSERT INTO users(id, email, username, password_hash, role) VALUES (1, 'admin@localhost', 'admin', 'x', 'owner')",
  ).run();
  const insert = (name: string, code: number, role: number) =>
    db
      .query(
        "INSERT INTO accounts(role, type, code, name, rank) VALUES (?, ?, ?, ?, ?)",
      )
      .run(role, AccountType.Asset, code, name, name);
  insert("Cash", 1000, AccountRole.Cash);
  insert("Bank", 1100, AccountRole.Bank);
  insert("Accounts Receivable", 1200, AccountRole.Receivable);
  insert("Inventory", 1300, AccountRole.Bank);
  // Not one of the four recognized codes.
  insert("Marketplace Clearing", 1400, AccountRole.Bank);
  // Legacy-migrated: already carries the retired Equipment role.
  insert("Company Van", 1500, AccountRole.Equipment);
  const insertOtherType = (name: string, code: number, type: number) =>
    db
      .query(
        "INSERT INTO accounts(role, type, code, name, rank) VALUES (?, ?, ?, ?, ?)",
      )
      .run(AccountRole.Payable, type, code, name, name);
  insertOtherType("Accounts Payable", 2000, AccountType.Liability);
  // Not one of the recognized Liability codes — a loan's name doesn't say
  // short- vs long-term.
  insertOtherType("Loans", 2100, AccountType.Liability);
  insertOtherType("Product Sales", 4000, AccountType.Revenue);
  insertOtherType("Other Revenue", 4100, AccountType.Revenue);
  insertOtherType("Cost of Goods Sold", 5000, AccountType.Expense);
  insertOtherType("Advertising", 5100, AccountType.Expense);
  insertOtherType("Other Expenses", 5900, AccountType.Expense);
  // A true non-account-type row (Equity), to prove it is left alone.
  insertOtherType("Owner's Equity", 3000, AccountType.Equity);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  return path;
}

function subTypeByName(db: Database, name: string): number | null {
  return (
    db.query("SELECT sub_type FROM accounts WHERE name = ?").get(name) as {
      sub_type: number | null;
    }
  ).sub_type;
}

describe("account sub-type backfill", () => {
  it("Backfill_WhenRunOnAnAlreadyStandardizedChart_ShouldClassifyOnlyTheRecognizedDefaults", () => {
    const path = completedShape();
    const db = new Database(path);
    applySubTypeBackfill(db);

    expect(subTypeByName(db, "Cash")).toBe(AccountSubType.Cash);
    expect(subTypeByName(db, "Bank")).toBe(AccountSubType.Bank);
    expect(subTypeByName(db, "Accounts Receivable")).toBe(
      AccountSubType.Receivable,
    );
    expect(subTypeByName(db, "Inventory")).toBe(AccountSubType.Inventory);
    // Not one of the four recognized codes: stays "needs review".
    expect(subTypeByName(db, "Marketplace Clearing")).toBeNull();
    // Already carries the legacy Equipment role.
    expect(subTypeByName(db, "Company Van")).toBe(AccountSubType.Equipment);
    // Liability, Expense and Revenue defaults recognized by code, same as Asset.
    expect(subTypeByName(db, "Accounts Payable")).toBe(
      LiabilitySubType.AccountsPayable,
    );
    expect(subTypeByName(db, "Product Sales")).toBe(
      RevenueSubType.OperatingRevenue,
    );
    expect(subTypeByName(db, "Other Revenue")).toBe(RevenueSubType.OtherRevenue);
    expect(subTypeByName(db, "Cost of Goods Sold")).toBe(
      ExpenseSubType.CostOfGoodsSold,
    );
    expect(subTypeByName(db, "Advertising")).toBe(
      ExpenseSubType.OperatingExpense,
    );
    expect(subTypeByName(db, "Other Expenses")).toBe(
      ExpenseSubType.OtherExpense,
    );
    // "Loans" doesn't say short- vs long-term: stays "needs review".
    expect(subTypeByName(db, "Loans")).toBeNull();
    // Equity has no sub-type at all: untouched.
    expect(subTypeByName(db, "Owner's Equity")).toBeNull();
    db.close();
  });

  it("Backfill_WhenRunTwice_ShouldNeverOverwriteAnAlreadyClassifiedAccount", () => {
    const path = completedShape();
    const db = new Database(path);
    applySubTypeBackfill(db);
    // A user reclassified "Inventory" by hand between boots.
    db.query("UPDATE accounts SET sub_type = ? WHERE name = ?").run(
      AccountSubType.OtherCurrentAsset,
      "Inventory",
    );

    applySubTypeBackfill(db);

    expect(subTypeByName(db, "Inventory")).toBe(
      AccountSubType.OtherCurrentAsset,
    );
    db.close();
  });
});
