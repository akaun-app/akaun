import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { and, eq, sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema.js";
import {
  accounts,
  claims,
  contacts,
  expenses,
  incomes,
  ledgerMovements,
  ledgerRecords,
  settlements,
  users,
} from "../../db/schema.js";
import {
  AccountRole,
  ClaimStatus,
  ExpenseStatus,
  LedgerRecordKind,
} from "$lib/enums.js";
import { seedAccounts } from "./accounts.js";
import { convertLegacyRecords } from "./convert.js";
import type { LedgerDb, UpgradeReport } from "../types.js";

// Principle V: a query is tested against a real temporary SQLite database, never
// a mock. The whole point of this module is what it writes.

let dir: string;
let db: LedgerDb;

function emptyReport(): UpgradeReport {
  return {
    uncategorisedRecordIds: [],
    missingAttachments: [],
    roundingDifferences: [],
    payerAttributions: [],
    bankFallbackRecordIds: [],
    unrepointedAllocationIds: [],
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "akaun-convert-"));
  const raw = new Database(join(dir, "test.db"));
  raw.exec("PRAGMA foreign_keys = ON;");
  db = drizzle(raw, { schema }) as LedgerDb;
  migrate(db, { migrationsFolder: "drizzle" });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** The two accounts a legacy installation always has: an admin and a real person. */
function seedUsers() {
  db.insert(users)
    .values([
      {
        id: 1,
        email: "admin@localhost",
        username: "admin",
        passwordHash: "x",
        name: null,
      },
      {
        id: 2,
        email: "hao@example.com",
        username: "hao",
        passwordHash: "x",
        name: "Hao Quan Tang",
      },
    ])
    .run();
}

function seedContact(
  id: number,
  legalName: string,
  email: string | null = null,
) {
  db.insert(contacts).values({ id, entityType: 1, legalName, email }).run();
}

function addExpense(row: {
  id: number;
  number: string;
  amount: number;
  category?: string;
  status?: number;
  claimId?: number | null;
  contactId?: number | null;
  date?: string;
}) {
  db.insert(expenses)
    .values({
      id: row.id,
      expenseNumber: row.number,
      itemName: `Item ${row.id}`,
      category: row.category ?? "Transport",
      status: row.status ?? ExpenseStatus.Paid,
      date: row.date ?? "2025-03-04",
      amount: row.amount,
      claimId: row.claimId ?? null,
      contactId: row.contactId ?? null,
      createdBy: 2,
    })
    .run();
}

function addClaim(row: {
  id: number;
  number: string;
  status: number;
  createdBy?: number;
}) {
  db.insert(claims)
    .values({
      id: row.id,
      claimNumber: row.number,
      date: "2025-03-31",
      status: row.status,
      createdBy: row.createdBy ?? 2,
    })
    .run();
}

function run() {
  const seeded = seedAccounts(db);
  const report = emptyReport();
  convertLegacyRecords(db, seeded, report);
  return { seeded, report };
}

function movementsOf(recordId: number) {
  return db
    .select({
      accountId: ledgerMovements.accountId,
      amountMinor: ledgerMovements.amountMinor,
      role: accounts.role,
    })
    .from(ledgerMovements)
    .innerJoin(accounts, eq(accounts.id, ledgerMovements.accountId))
    .where(eq(ledgerMovements.recordId, recordId))
    .all();
}

function recordFor(legacyKind: string, legacyId: number) {
  return db
    .select()
    .from(ledgerRecords)
    .where(
      and(
        eq(ledgerRecords.legacyKind, legacyKind),
        eq(ledgerRecords.legacyId, legacyId),
      ),
    )
    .get();
}

describe("converting an ordinary paid expense", () => {
  it("keeps its id, its number, its date and its amount", () => {
    seedUsers();
    addExpense({ id: 5, number: "EX20250304-001", amount: 123.45 });
    run();

    const record = recordFor("expense", 5);
    expect(record?.id).toBe(5);
    expect(record?.recordNumber).toBe("EX20250304-001");
    expect(record?.date).toBe("2025-03-04");
    expect(record?.amount).toBe(123.45);
    expect(record?.kind).toBe(LedgerRecordKind.Expense);
  });

  it("puts it against its category and the default bank account", () => {
    seedUsers();
    addExpense({
      id: 5,
      number: "EX20250304-001",
      amount: 100,
      category: "Transport",
    });
    const { seeded } = run();

    const movements = movementsOf(5);
    expect(movements).toHaveLength(2);
    expect(
      movements.find((m) => m.role === AccountRole.ExpenseCategory)
        ?.amountMinor,
    ).toBe(10000);
    expect(
      movements.find((m) => m.accountId === seeded.defaultAccountId)
        ?.amountMinor,
    ).toBe(-10000);
  });

  it("balances", () => {
    seedUsers();
    addExpense({ id: 5, number: "EX20250304-001", amount: 33.33 });
    run();
    expect(movementsOf(5).reduce((sum, m) => sum + m.amountMinor, 0)).toBe(0);
  });
});

describe("a reimbursement that was completed", () => {
  it("becomes a payment carrying the claim's own number", () => {
    seedUsers();
    seedContact(10, "Hao Quan Tang");
    addClaim({ id: 1, number: "CL20250331-001", status: ClaimStatus.Done });
    addExpense({ id: 5, number: "EX20250304-001", amount: 60, claimId: 1 });
    addExpense({ id: 6, number: "EX20250305-001", amount: 40, claimId: 1 });
    run();

    const payment = recordFor("claim", 1);
    expect(payment?.kind).toBe(LedgerRecordKind.Payment);
    expect(payment?.recordNumber).toBe("CL20250331-001");
    // The claim's amount is the sum of what it covered.
    expect(payment?.amount).toBe(100);
  });

  it("leaves every covered expense fully settled, so each reads paid", () => {
    seedUsers();
    seedContact(10, "Hao Quan Tang");
    addClaim({ id: 1, number: "CL20250331-001", status: ClaimStatus.Done });
    addExpense({ id: 5, number: "EX20250304-001", amount: 60, claimId: 1 });
    addExpense({ id: 6, number: "EX20250305-001", amount: 40, claimId: 1 });
    run();

    const rows = db.select().from(settlements).all();
    expect(rows).toHaveLength(2);
    expect(rows.reduce((sum, r) => sum + r.amountMinor, 0)).toBe(10000);
  });

  it("writes the payer contact onto the payment and onto every expense it covered", () => {
    seedUsers();
    seedContact(10, "Hao Quan Tang");
    addClaim({
      id: 1,
      number: "CL20250331-001",
      status: ClaimStatus.Done,
      createdBy: 2,
    });
    addExpense({ id: 5, number: "EX20250304-001", amount: 60, claimId: 1 });
    run();

    expect(recordFor("claim", 1)?.contactId).toBe(10);
    expect(recordFor("expense", 5)?.contactId).toBe(10);
  });

  it("puts each covered expense against money we owe rather than the bank", () => {
    seedUsers();
    seedContact(10, "Hao Quan Tang");
    addClaim({ id: 1, number: "CL20250331-001", status: ClaimStatus.Done });
    addExpense({ id: 5, number: "EX20250304-001", amount: 60, claimId: 1 });
    run();

    expect(movementsOf(5).some((m) => m.role === AccountRole.Payable)).toBe(
      true,
    );
  });
});

describe("a reimbursement that was never completed", () => {
  it("leaves the amounts outstanding, with no payment record at all", () => {
    seedUsers();
    seedContact(10, "Hao Quan Tang");
    addClaim({ id: 1, number: "CL20250331-001", status: ClaimStatus.Pending });
    addExpense({ id: 5, number: "EX20250304-001", amount: 60, claimId: 1 });
    run();

    // No payment has been made, so nothing has settled the expense.
    expect(recordFor("claim", 1)).toBeUndefined();
    expect(db.select().from(settlements).all()).toHaveLength(0);
    expect(movementsOf(5).some((m) => m.role === AccountRole.Payable)).toBe(
      true,
    );
  });

  it("still names the person who is owed", () => {
    seedUsers();
    seedContact(10, "Hao Quan Tang");
    addClaim({ id: 1, number: "CL20250331-001", status: ClaimStatus.Pending });
    addExpense({ id: 5, number: "EX20250304-001", amount: 60, claimId: 1 });
    run();
    expect(recordFor("expense", 5)?.contactId).toBe(10);
  });
});

describe("income", () => {
  it("goes into the default bank account, out of its category", () => {
    seedUsers();
    db.insert(incomes)
      .values({
        id: 3,
        incomeNumber: "IN20250310-001",
        descriptionText: "Project",
        category: "Consulting",
        date: "2025-03-10",
        amount: 500,
        createdBy: 2,
      })
      .run();
    const { seeded } = run();

    const record = recordFor("income", 3);
    expect(record?.kind).toBe(LedgerRecordKind.Income);
    const movements = movementsOf(record!.id);
    expect(
      movements.find((m) => m.accountId === seeded.defaultAccountId)
        ?.amountMinor,
    ).toBe(50000);
    expect(
      movements.find((m) => m.role === AccountRole.IncomeCategory)?.amountMinor,
    ).toBe(-50000);
  });

  it("is given an id above the highest old expense id, so no expense link breaks", () => {
    seedUsers();
    addExpense({ id: 900, number: "EX20250304-900", amount: 10 });
    db.insert(incomes)
      .values({
        id: 3,
        incomeNumber: "IN20250310-001",
        descriptionText: "Project",
        category: "Consulting",
        date: "2025-03-10",
        amount: 500,
        createdBy: 2,
      })
      .run();
    run();

    expect(recordFor("expense", 900)?.id).toBe(900);
    expect(recordFor("income", 3)!.id).toBeGreaterThan(900);
  });
});

describe("an expense that was never paid and was never on a reimbursement", () => {
  it("stays owed to the contact it names", () => {
    seedUsers();
    seedContact(10, "A Supplier");
    addExpense({
      id: 5,
      number: "EX20250304-001",
      amount: 60,
      status: ExpenseStatus.Unpaid,
      contactId: 10,
    });
    run();

    expect(movementsOf(5).some((m) => m.role === AccountRole.Payable)).toBe(
      true,
    );
    expect(recordFor("expense", 5)?.contactId).toBe(10);
  });

  it("falls back to the bank when it names nobody, and is reported", () => {
    seedUsers();
    addExpense({
      id: 5,
      number: "EX20250304-001",
      amount: 60,
      status: ExpenseStatus.Unpaid,
    });
    const { seeded, report } = run();

    expect(
      movementsOf(5).some((m) => m.accountId === seeded.defaultAccountId),
    ).toBe(true);
    expect(report.bankFallbackRecordIds).toContain(5);
  });
});

describe("a category that cannot be read", () => {
  it("lands on Uncategorised and is flagged", () => {
    seedUsers();
    addExpense({ id: 5, number: "EX20250304-001", amount: 60, category: "" });
    const { seeded, report } = run();

    expect(
      movementsOf(5).some((m) => m.accountId === seeded.uncategorisedAccountId),
    ).toBe(true);
    expect(report.uncategorisedRecordIds).toContain(5);
  });
});

describe("running the conversion twice", () => {
  it("changes nothing the second time", () => {
    seedUsers();
    seedContact(10, "Hao Quan Tang");
    addClaim({ id: 1, number: "CL20250331-001", status: ClaimStatus.Done });
    addExpense({ id: 5, number: "EX20250304-001", amount: 60, claimId: 1 });
    addExpense({ id: 6, number: "EX20250305-001", amount: 40 });
    db.insert(incomes)
      .values({
        id: 3,
        incomeNumber: "IN20250310-001",
        descriptionText: "Project",
        category: "Consulting",
        date: "2025-03-10",
        amount: 500,
        createdBy: 2,
      })
      .run();

    run();
    const after = () => ({
      records:
        db
          .select({ n: sql<number>`count(*)` })
          .from(ledgerRecords)
          .get()?.n ?? 0,
      movements:
        db
          .select({ n: sql<number>`count(*)` })
          .from(ledgerMovements)
          .get()?.n ?? 0,
      settlements:
        db
          .select({ n: sql<number>`count(*)` })
          .from(settlements)
          .get()?.n ?? 0,
      contacts:
        db
          .select({ n: sql<number>`count(*)` })
          .from(contacts)
          .get()?.n ?? 0,
      accounts:
        db
          .select({ n: sql<number>`count(*)` })
          .from(accounts)
          .get()?.n ?? 0,
    });

    const first = after();
    run();
    expect(after()).toEqual(first);
  });

  it("keeps the same ids, so a link that worked still works", () => {
    seedUsers();
    addExpense({ id: 5, number: "EX20250304-001", amount: 60 });
    run();
    const firstId = recordFor("expense", 5)?.id;
    run();
    expect(recordFor("expense", 5)?.id).toBe(firstId);
  });
});

describe("the whole set of converted records", () => {
  it("balances, every record and overall", () => {
    seedUsers();
    seedContact(10, "Hao Quan Tang");
    addClaim({ id: 1, number: "CL20250331-001", status: ClaimStatus.Done });
    addExpense({ id: 5, number: "EX20250304-001", amount: 60, claimId: 1 });
    addExpense({ id: 6, number: "EX20250305-001", amount: 12.34 });
    db.insert(incomes)
      .values({
        id: 3,
        incomeNumber: "IN20250310-001",
        descriptionText: "Project",
        category: "Consulting",
        date: "2025-03-10",
        amount: 500,
        createdBy: 2,
      })
      .run();
    run();

    const perRecord = db
      .select({
        recordId: ledgerMovements.recordId,
        total: sql<number>`sum(${ledgerMovements.amountMinor})`,
      })
      .from(ledgerMovements)
      .groupBy(ledgerMovements.recordId)
      .all();
    for (const row of perRecord) expect(row.total).toBe(0);

    const whole =
      db
        .select({
          total: sql<number>`coalesce(sum(${ledgerMovements.amountMinor}), 0)`,
        })
        .from(ledgerMovements)
        .get()?.total ?? 0;
    expect(whole).toBe(0);
  });
});
