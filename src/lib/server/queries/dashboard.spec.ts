import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AccountRole,
  AccountType,
  DefaultAccountPurpose,
  LedgerRecordKind,
} from "$lib/enums.js";
import * as schema from "../db/schema.js";
import {
  accountDefaults,
  accounts,
  ledgerMovements,
  ledgerRecords,
  users,
} from "../db/schema.js";
import { currentAssetsAsAt, fundsFlowStatement } from "./dashboard.js";

/**
 * The reads behind the dashboard's position figures, against a real database.
 *
 * `funds-flow.spec.ts` pins the rule; what is pinned here is the row set the
 * rule is given, because the two halves of that `where` are the part that can be
 * silently wrong. Drop the `exists` and a bill taken on credit is counted as
 * though funds moved; drop the `not` and a transfer between two bank accounts
 * appears as both a source and a use. Either way the statement still renders and
 * still adds up to something — it is only wrong.
 *
 * In-memory only. Nothing here goes near `data/`.
 */

let sqlite: Database;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

let nextRank = 0;
function account(name: string, type: number, role: number): number {
  return db
    .insert(accounts)
    .values({ name, type, role, rank: `a${nextRank++}` })
    .returning({ id: accounts.id })
    .get().id;
}

/** One balanced record on a date, as `entry-builder.ts` would have written it. */
function post(
  date: string,
  sides: { accountId: number; amountMinor: number }[],
): void {
  const sum = sides.reduce((running, side) => running + side.amountMinor, 0);
  if (sum !== 0)
    throw new Error(`fixture is not a balanced record: sides sum to ${sum}`);
  const record = db
    .insert(ledgerRecords)
    .values({
      kind: LedgerRecordKind.Journal,
      date,
      description: "test",
      amount: 0,
      createdBy: 1,
      updatedBy: 1,
    })
    .returning()
    .get();
  db.insert(ledgerMovements)
    .values(
      sides.map((side, sortOrder) => ({
        recordId: record.id,
        accountId: side.accountId,
        amountMinor: side.amountMinor,
        sortOrder,
      })),
    )
    .run();
}

let BANK: number;
let CASH: number;
let RECEIVABLE: number;
let EQUIPMENT: number;
let PAYABLE: number;
let SOFTWARE: number;
let SALES: number;

beforeEach(() => {
  sqlite = new Database(":memory:");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle" });
  db.insert(users)
    .values({ email: "q@test", username: "q", passwordHash: "x" })
    .run();
  nextRank = 0;

  // Every asset that is not equipment carries the compatibility role
  // `seed-accounts.ts` stamps on all of them, so the reads must not lean on it.
  BANK = account("Bank", AccountType.Asset, AccountRole.Bank);
  CASH = account("Cash", AccountType.Asset, AccountRole.Bank);
  RECEIVABLE = account(
    "Accounts Receivable",
    AccountType.Asset,
    AccountRole.Bank,
  );
  EQUIPMENT = account("Equipment", AccountType.Asset, AccountRole.Equipment);
  PAYABLE = account(
    "Accounts Payable",
    AccountType.Liability,
    AccountRole.Payable,
  );
  SOFTWARE = account(
    "Software",
    AccountType.Expense,
    AccountRole.ExpenseCategory,
  );
  SALES = account("Sales", AccountType.Revenue, AccountRole.IncomeCategory);
  db.insert(accountDefaults)
    .values({ purpose: DefaultAccountPurpose.Payable, accountId: PAYABLE })
    .run();
});

afterEach(() => sqlite.close());

const JANUARY = ["2026-01-01", "2026-01-31"] as const;

function lineIn(
  report: ReturnType<typeof fundsFlowStatement>,
  key: string,
): number | undefined {
  return report.activities
    .flatMap((activity) => activity.lines)
    .find((line) => line.key === key)?.amountMinor;
}

describe("currentAssetsAsAt", () => {
  it("counts what is held and owed, and leaves equipment out", () => {
    post("2026-01-05", [
      { accountId: BANK, amountMinor: 1_000_00 },
      { accountId: SALES, amountMinor: -1_000_00 },
    ]);
    post("2026-01-06", [
      { accountId: EQUIPMENT, amountMinor: 400_00 },
      { accountId: BANK, amountMinor: -400_00 },
    ]);

    // 1,000 in, 400 spent on a fixed asset: 600 of current assets, not 1,000.
    expect(currentAssetsAsAt(db, "2026-01-31")).toBe(600);
  });

  it("counts receivables alongside cash, being indistinguishable by role", () => {
    post("2026-01-05", [
      { accountId: RECEIVABLE, amountMinor: 250_00 },
      { accountId: SALES, amountMinor: -250_00 },
    ]);

    expect(currentAssetsAsAt(db, "2026-01-31")).toBe(250);
  });

  it("stops at the date it is asked for", () => {
    post("2026-01-05", [
      { accountId: BANK, amountMinor: 100_00 },
      { accountId: SALES, amountMinor: -100_00 },
    ]);
    post("2026-02-05", [
      { accountId: BANK, amountMinor: 900_00 },
      { accountId: SALES, amountMinor: -900_00 },
    ]);

    expect(currentAssetsAsAt(db, "2026-01-31")).toBe(100);
    expect(currentAssetsAsAt(db, "2026-02-28")).toBe(1000);
  });
});

describe("fundsFlowStatement", () => {
  it("separates capital expenditure from operating expenses", () => {
    post("2026-01-05", [
      { accountId: SOFTWARE, amountMinor: 60_00 },
      { accountId: BANK, amountMinor: -60_00 },
    ]);
    post("2026-01-06", [
      { accountId: EQUIPMENT, amountMinor: 400_00 },
      { accountId: BANK, amountMinor: -400_00 },
    ]);

    const report = fundsFlowStatement(db, ...JANUARY);
    expect(lineIn(report, "operating-expenses")).toBe(-60_00);
    expect(lineIn(report, "capital-expenditure")).toBe(-400_00);
    expect(report.ties).toBe(true);
  });

  it("reports nothing for a transfer between two current-asset accounts", () => {
    // Without the `not` on the outer side this reads as a source and a use.
    post("2026-01-05", [
      { accountId: BANK, amountMinor: -250_00 },
      { accountId: CASH, amountMinor: 250_00 },
    ]);

    const report = fundsFlowStatement(db, ...JANUARY);
    expect(report.activities).toEqual([]);
    expect(report.netMinor).toBe(0);
    expect(report.ties).toBe(true);
  });

  it("reports nothing for a bill taken on credit", () => {
    // Without the `exists` this counts as though the funds had moved.
    post("2026-01-05", [
      { accountId: SOFTWARE, amountMinor: 40_00 },
      { accountId: PAYABLE, amountMinor: -40_00 },
    ]);

    const report = fundsFlowStatement(db, ...JANUARY);
    expect(report.activities).toEqual([]);
    expect(report.netMinor).toBe(0);
    expect(report.ties).toBe(true);
  });

  it("reads the payable default as operating and other liabilities as financing", () => {
    const loan = account("Loan", AccountType.Liability, AccountRole.Payable);
    post("2026-01-05", [
      { accountId: PAYABLE, amountMinor: 40_00 },
      { accountId: BANK, amountMinor: -40_00 },
    ]);
    post("2026-01-06", [
      { accountId: BANK, amountMinor: 5_000_00 },
      { accountId: loan, amountMinor: -5_000_00 },
    ]);

    const report = fundsFlowStatement(db, ...JANUARY);
    expect(lineIn(report, "trade-payables")).toBe(-40_00);
    expect(lineIn(report, "borrowings")).toBe(5_000_00);
  });

  it("opens where the previous period closed", () => {
    post("2025-12-20", [
      { accountId: BANK, amountMinor: 700_00 },
      { accountId: SALES, amountMinor: -700_00 },
    ]);
    post("2026-01-05", [
      { accountId: SOFTWARE, amountMinor: 60_00 },
      { accountId: BANK, amountMinor: -60_00 },
    ]);

    const report = fundsFlowStatement(db, ...JANUARY);
    expect(report.openingMinor).toBe(700_00);
    expect(report.closingMinor).toBe(640_00);
    expect(report.netMinor).toBe(-60_00);
    expect(report.ties).toBe(true);
  });

  it("explains the whole movement, whatever the records were", () => {
    post("2025-12-31", [
      { accountId: BANK, amountMinor: 2_000_00 },
      { accountId: SALES, amountMinor: -2_000_00 },
    ]);
    post("2026-01-03", [
      { accountId: RECEIVABLE, amountMinor: 1_500_00 },
      { accountId: SALES, amountMinor: -1_500_00 },
    ]);
    post("2026-01-08", [
      { accountId: BANK, amountMinor: 600_00 },
      { accountId: RECEIVABLE, amountMinor: -600_00 },
    ]);
    post("2026-01-12", [
      { accountId: EQUIPMENT, amountMinor: 3_400_00 },
      { accountId: BANK, amountMinor: -3_400_00 },
    ]);
    post("2026-01-19", [
      { accountId: SOFTWARE, amountMinor: 100_00 },
      { accountId: BANK, amountMinor: -60_00 },
      { accountId: PAYABLE, amountMinor: -40_00 },
    ]);
    post("2026-02-02", [
      { accountId: SOFTWARE, amountMinor: 999_00 },
      { accountId: BANK, amountMinor: -999_00 },
    ]);

    const report = fundsFlowStatement(db, ...JANUARY);
    expect(lineIn(report, "revenue")).toBe(1_500_00);
    expect(lineIn(report, "operating-expenses")).toBe(-100_00);
    expect(lineIn(report, "trade-payables")).toBe(40_00);
    expect(lineIn(report, "capital-expenditure")).toBe(-3_400_00);

    // The property the whole statement rests on, over a real query.
    expect(report.openingMinor + report.netMinor).toBe(report.closingMinor);
    expect(report.ties).toBe(true);
    // February stayed out of it.
    expect(report.closingMinor).toBe(
      Math.round(currentAssetsAsAt(db, "2026-01-31") * 100),
    );
  });
});
