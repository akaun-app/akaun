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
  ImportState,
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

  it("leaves the file name out when the job has none (006 FR-025)", () => {
    const id = seedRecord({
      kind: LedgerRecordKind.Expense,
      amount: 100,
      amountMinor: 10_000,
      fromAccountId: 1,
      toAccountId: 2,
      date: "2020-01-01",
      reference: "OLD",
    });
    db.insert(schema.users)
      .values({ id: 1, email: "u@test", username: "u", passwordHash: "x" })
      .run();
    db.insert(schema.importQueue)
      .values({
        id: "old-job",
        createdBy: 1,
        state: ImportState.Imported,
        tempFilePath: "import/temp/old.pdf",
        originalFilename: "fees.pdf",
        resultId: id,
        resultType: DocumentType.Expense,
      })
      .run();
    const job = {
      ...baseJob,
      reference: null,
      date: "2026-08-01",
      originalFilename: "fees.pdf",
    };

    // Amount and supplier alone are under the threshold; the shared file name
    // is what tips a receipt over it.
    expect(detectDuplicate(db, job)?.reasons).toContain("filename");
    expect(detectDuplicate(db, { ...job, originalFilename: null })).toBeNull();
  });

  it("still flags a receipt whose file was imported as a group of items (006 FR-004)", () => {
    const id = seedRecord({
      kind: LedgerRecordKind.Expense,
      amount: 7,
      amountMinor: 700,
      fromAccountId: 1,
      toAccountId: 2,
      date: "2020-01-01",
      reference: "OTHER",
    });
    db.insert(schema.users)
      .values({ id: 1, email: "u@test", username: "u", passwordHash: "x" })
      .run();
    // A finished group is Imported with no record of its own; its record is on
    // its item.
    db.insert(schema.importQueue)
      .values({
        id: "group-job",
        createdBy: 1,
        state: ImportState.Imported,
        tempFilePath: "records/2026/07/fees.pdf",
        originalFilename: "fees.pdf",
        fileHash: "same-bytes",
      })
      .run();
    db.insert(schema.importItems)
      .values({
        id: "group-item",
        jobId: "group-job",
        state: ImportState.Imported,
        position: 0,
        sectionKey: "items",
        resultId: id,
        resultType: DocumentType.Expense,
      })
      .run();

    const result = detectDuplicate(db, {
      ...baseJob,
      supplier: null,
      reference: null,
      originalFilename: "renamed.pdf",
      fileHash: "same-bytes",
    });

    expect(result).toEqual({
      duplicateOf: id,
      confidence: 100,
      reasons: ["file_hash"],
    });
  });

  it("never offers a record whose own reference differs, for an item read from columns (006 FR-063)", () => {
    const other = seedRecord({
      kind: LedgerRecordKind.Expense,
      amount: 100,
      amountMinor: 10_000,
      fromAccountId: 1,
      toAccountId: 2,
      date: "2026-08-01",
      reference: "ORDER-1",
    });
    const item = {
      ...baseJob,
      originalFilename: null,
      reference: "ORDER-2",
    };

    // Every other reading keeps the weighted check: date, amount and other
    // party outweigh the different reference (FR-024).
    expect(detectDuplicate(db, item)?.duplicateOf).toBe(other);
    // Two rows of one table with different references are two transactions.
    expect(detectDuplicate(db, { ...item, referenceVeto: true })).toBeNull();
    // The same reference, or none on either side, is still compared.
    expect(
      detectDuplicate(db, {
        ...item,
        reference: "ORDER-1",
        referenceVeto: true,
      })?.duplicateOf,
    ).toBe(other);
    expect(
      detectDuplicate(db, { ...item, reference: "", referenceVeto: true })
        ?.duplicateOf,
    ).toBe(other);
    const unnamed = seedRecord({
      kind: LedgerRecordKind.Expense,
      amount: 55,
      amountMinor: 5_500,
      fromAccountId: 1,
      toAccountId: 2,
      date: "2026-08-03",
    });
    expect(
      detectDuplicate(db, {
        ...item,
        amount: 55,
        date: "2026-08-03",
        referenceVeto: true,
      })?.duplicateOf,
    ).toBe(unnamed);
  });
});
