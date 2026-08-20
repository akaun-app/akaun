import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema.js";
import {
  accounts,
  contacts,
  ledgerMovements,
  ledgerRecords,
} from "../db/schema.js";
import {
  AccountRole,
  DocumentType,
  EntityType,
  LedgerRecordKind,
} from "$lib/enums.js";
import { detectDuplicate } from "./duplicate-detector.js";

// Principle V: a query is tested against a real temporary SQLite database.
//
// Auto Import's duplicate check reads the record store. Before this spec it read
// `expenses` / `incomes` — the two tables the double-entry conversion emptied and
// that nothing writes to any more — so it could not see a single record created
// since the conversion and offered no duplicate, ever (FR-035).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

let dir: string;
let db: Db;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "akaun-dup-"));
  const raw = new Database(join(dir, "test.db"));
  raw.exec("PRAGMA foreign_keys = ON;");
  db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: "drizzle" });

  db.insert(accounts)
    .values([
      { name: "Bank Account", role: AccountRole.Bank, rank: 1 },
      { name: "Fuel", role: AccountRole.ExpenseCategory, rank: 2 },
      { name: "Sales", role: AccountRole.IncomeCategory, rank: 3 },
    ])
    .run();
  db.insert(contacts)
    .values({ legalName: "Petronas", entityType: EntityType.Business })
    .run();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A record in the one store, with both of its sides. */
function seedRecord(overrides: {
  kind: number;
  amountMinor: number;
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  date: string;
  reference?: string;
  extractedText?: string;
}) {
  const [record] = db
    .insert(ledgerRecords)
    .values({
      kind: overrides.kind,
      date: overrides.date,
      description: "Fuel",
      contactId: 1,
      reference: overrides.reference ?? "",
      amount: overrides.amount,
      currency: "MYR",
      extractedText: overrides.extractedText ?? null,
    })
    .returning({ id: ledgerRecords.id })
    .all();

  db.insert(ledgerMovements)
    .values([
      {
        recordId: record.id,
        accountId: overrides.toAccountId,
        amountMinor: overrides.amountMinor,
      },
      {
        recordId: record.id,
        accountId: overrides.fromAccountId,
        amountMinor: -overrides.amountMinor,
      },
    ])
    .run();

  return record.id;
}

const baseJob = {
  originalFilename: "receipt.pdf",
  fileHash: null,
  itemName: null,
  supplier: "Petronas",
  amount: 100,
  date: "2026-08-01",
  reference: "INV-1",
  extractedText: null,
  documentType: DocumentType.Expense,
};

describe("detectDuplicate over the one record store", () => {
  it("offers an expense record created since the conversion", () => {
    const id = seedRecord({
      kind: LedgerRecordKind.Expense,
      amount: 100,
      amountMinor: 10_000,
      fromAccountId: 1,
      toAccountId: 2,
      date: "2026-08-01",
      reference: "INV-1",
    });

    const result = detectDuplicate(db, baseJob);

    expect(result).not.toBeNull();
    expect(result!.duplicateOf).toBe(id);
    expect(result!.reasons).toContain("reference");
  });

  it("offers an income record for an income document", () => {
    const id = seedRecord({
      kind: LedgerRecordKind.Income,
      amount: 250,
      amountMinor: 25_000,
      fromAccountId: 3,
      toAccountId: 1,
      date: "2026-08-02",
      reference: "SO-9",
    });

    const result = detectDuplicate(db, {
      ...baseJob,
      documentType: DocumentType.Income,
      amount: 250,
      date: "2026-08-02",
      reference: "SO-9",
    });

    expect(result).not.toBeNull();
    expect(result!.duplicateOf).toBe(id);
  });

  it("does not offer a record of another kind", () => {
    seedRecord({
      kind: LedgerRecordKind.Income,
      amount: 100,
      amountMinor: 10_000,
      fromAccountId: 3,
      toAccountId: 1,
      date: "2026-08-01",
      reference: "INV-1",
    });

    expect(detectDuplicate(db, baseJob)).toBeNull();
  });

  it("stays silent when nothing resembles the job", () => {
    seedRecord({
      kind: LedgerRecordKind.Expense,
      amount: 7,
      amountMinor: 700,
      fromAccountId: 1,
      toAccountId: 2,
      date: "2020-01-01",
      reference: "OTHER",
    });

    expect(
      detectDuplicate(db, {
        ...baseJob,
        supplier: null,
        originalFilename: "x.pdf",
      }),
    ).toBeNull();
  });

  it("scores an amount and date match without a reference", () => {
    const id = seedRecord({
      kind: LedgerRecordKind.Expense,
      amount: 100,
      amountMinor: 10_000,
      fromAccountId: 1,
      toAccountId: 2,
      date: "2026-08-01",
    });

    const result = detectDuplicate(db, { ...baseJob, reference: null });

    expect(result).not.toBeNull();
    expect(result!.duplicateOf).toBe(id);
  });
});
