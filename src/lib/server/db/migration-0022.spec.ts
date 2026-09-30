import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { AccountRole, DocumentType, ImportState } from "$lib/enums.js";
import { applyMigrationRange } from "./auto-upgrade.js";
import * as schema from "./schema.js";
import {
  pickReviewFields,
  type ReviewFields,
} from "../import/review-fields.js";

/**
 * Migration 0022 adds the import items table and new columns on the import
 * queue for documents with several items (006). Upgrading must leave every
 * queued and history row exactly as it was (FR-048).
 *
 * Each test builds its own database file under `os.tmpdir()` from the
 * migrations in `drizzle/`, stopping at 0021, then fills it the way an
 * installation from before 006 would be filled, and only then applies 0022.
 */

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const LAST_BEFORE = 21;
const MIGRATION = 22;

function databaseAt0021(): Database {
  const directory = mkdtempSync(join(tmpdir(), "akaun-migration-0022-"));
  directories.push(directory);
  const db = new Database(join(directory, "akaun.db"));
  applyMigrationRange(db, 0, LAST_BEFORE);
  return db;
}

/** One row per queue state an installation can hold, with every field set. */
function fillLikeBefore006(db: Database) {
  db.query(
    "INSERT INTO users(id, email, username, password_hash) VALUES (1, 'u@test', 'u', 'x')",
  ).run();
  db.query(
    "INSERT INTO contacts(id, entity_type, legal_name) VALUES (7, 2, 'Shopee')",
  ).run();
  db.query(
    "INSERT INTO accounts(id, role, name, rank) VALUES (30, ?, 'Maybank', 'a0'), (40, ?, 'Office Supplies', 'a1')",
  ).run(AccountRole.Bank, AccountRole.ExpenseCategory);

  const insert = db.query(`INSERT INTO import_queue(
      id, created_by, state, temp_file_path, original_filename, file_hash,
      pre_extracted_text, extracted_text, document_type, item_name, supplier,
      matched_contact_id, match_candidates, date, amount, currency,
      exchange_rate, reference, category, category_account_id, remark,
      duplicate_of, duplicate_confidence, duplicate_reasons, account_id,
      result_id, result_type, error, created_at, processed_at, confirmed_at,
      completed_at
    ) VALUES (?, 1, ?, ?, 'receipt.pdf', 'abc123', 'typed text', 'read text',
      ?, 'Printer paper', 'Shopee', 7, '[{"id":7,"legalName":"Shopee","score":1}]',
      '2026-08-14', 12.34, 'MYR', 1, 'INV-1', 'Office Supplies', 40, NULL,
      NULL, NULL, NULL, 30, ?, ?, ?, '2026-08-14 10:00:00',
      '2026-08-14 10:01:00', ?, ?)`);
  // Waiting for review.
  insert.run(
    "11111111-1111-4111-8111-111111111111",
    ImportState.PendingReview,
    "import/temp/1_receipt.pdf",
    DocumentType.Expense,
    null,
    null,
    null,
    null,
    null,
  );
  // In the history, linked to the record it became.
  insert.run(
    "22222222-2222-4222-8222-222222222222",
    ImportState.Imported,
    "records/2026/08/2_receipt.pdf",
    DocumentType.Expense,
    501,
    DocumentType.Expense,
    null,
    "2026-08-14 10:05:00",
    "2026-08-14 10:05:00",
  );
  // Failed, with its reason.
  insert.run(
    "33333333-3333-4333-8333-333333333333",
    ImportState.Failed,
    "import/temp/3_receipt.pdf",
    DocumentType.Income,
    null,
    null,
    "No AI provider is set up.",
    null,
    null,
  );
}

type Row = Record<string, unknown>;

function queueRows(db: Database): Row[] {
  return db
    .query("SELECT rowid AS row_id, * FROM import_queue ORDER BY id")
    .all() as Row[];
}

function tableSql(db: Database): Map<string, string> {
  const rows = db
    .query(
      "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name",
    )
    .all() as { type: string; name: string; sql: string }[];
  return new Map(rows.map((r) => [`${r.type}:${r.name}`, r.sql]));
}

function rowCounts(db: Database): Map<string, number> {
  const tables = db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];
  return new Map(
    tables.map(({ name }) => [
      name,
      (db.query(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number })
        .n,
    ]),
  );
}

const NEW_QUEUE_COLUMNS = [
  "read_as",
  "profile_id",
  "profile_snapshot",
  "import_mode",
  "read_how",
  "extraction_notes",
  "progress_done",
  "progress_total",
  "group_account_id",
];

/** What 0022's ALTER TABLE statements add to the queue's stored definition. */
const ADDED_TO_QUEUE =
  ", `read_as` text, `profile_id` text, `profile_snapshot` text, `import_mode` text, `read_how` text, `extraction_notes` text, `progress_done` integer, `progress_total` integer, `group_account_id` integer REFERENCES accounts(id) ON DELETE SET NULL";

describe("migration 0022", () => {
  it("keeps every queued and history row exactly as it was", () => {
    const db = databaseAt0021();
    fillLikeBefore006(db);
    const before = queueRows(db);
    expect(before).toHaveLength(3);

    applyMigrationRange(db, MIGRATION, MIGRATION);

    const after = queueRows(db);
    expect(after).toHaveLength(before.length);
    after.forEach((row, index) => {
      // Same row, same storage slot: the table was altered, not rebuilt.
      const old = before[index];
      for (const [column, value] of Object.entries(old)) {
        expect(row[column], column).toEqual(value);
      }
      // The new columns are empty, which reads as a receipt.
      for (const column of NEW_QUEUE_COLUMNS) {
        expect(row[column], column).toBeNull();
      }
      expect(Object.keys(row)).toHaveLength(
        Object.keys(old).length + NEW_QUEUE_COLUMNS.length,
      );
    });
    db.close();
  });

  it("only adds: no table is rebuilt, dropped or emptied", () => {
    const db = databaseAt0021();
    fillLikeBefore006(db);
    const sqlBefore = tableSql(db);
    const countsBefore = rowCounts(db);

    applyMigrationRange(db, MIGRATION, MIGRATION);

    const sqlAfter = tableSql(db);
    for (const [name, sql] of sqlBefore) {
      if (name === "table:import_queue") {
        // ALTER TABLE … ADD writes each new column into the stored definition
        // after the last one and leaves the rest of it alone; a rebuild would
        // write a new definition. So taking the new columns out again must
        // give back the old text exactly.
        expect(sqlAfter.get(name)?.replace(ADDED_TO_QUEUE, "")).toBe(sql);
      } else {
        expect(sqlAfter.get(name), name).toBe(sql);
      }
    }
    const added = [...sqlAfter.keys()].filter((name) => !sqlBefore.has(name));
    expect(added.sort()).toEqual([
      "index:import_items_job_state_idx",
      "index:record_attachments_filename_idx",
      "table:import_items",
    ]);

    const countsAfter = rowCounts(db);
    for (const [table, count] of countsBefore) {
      if (table === "__drizzle_migrations") continue;
      expect(countsAfter.get(table), table).toBe(count);
    }
    expect(countsAfter.get("import_items")).toBe(0);
    db.close();
  });

  it("reads an older row through the app's schema as a receipt", () => {
    const sqlite = databaseAt0021();
    fillLikeBefore006(sqlite);
    applyMigrationRange(sqlite, MIGRATION, MIGRATION);
    const db = drizzle(sqlite, { schema });

    const row = db
      .select()
      .from(schema.importQueue)
      .where(eq(schema.importQueue.id, "11111111-1111-4111-8111-111111111111"))
      .get();
    expect(row).toMatchObject({
      state: ImportState.PendingReview,
      itemName: "Printer paper",
      amount: 12.34,
      readAs: null,
      profileId: null,
      importMode: null,
      readHow: null,
      extractionNotes: null,
      progressDone: null,
      progressTotal: null,
      groupAccountId: null,
    });
    sqlite.close();
  });

  it("stores items under their document, and removes them with it", () => {
    const sqlite = databaseAt0021();
    fillLikeBefore006(sqlite);
    applyMigrationRange(sqlite, MIGRATION, MIGRATION);
    sqlite.exec("PRAGMA foreign_keys = ON");
    const db = drizzle(sqlite, { schema });
    const jobId = "11111111-1111-4111-8111-111111111111";

    const queueRow = db
      .select()
      .from(schema.importQueue)
      .where(eq(schema.importQueue.id, jobId))
      .get();
    if (!queueRow) throw new Error("fixture row missing");
    // An item holds the same review fields as the receipt's queue row.
    const fields: ReviewFields = pickReviewFields(queueRow);
    db.insert(schema.importItems)
      .values([
        { id: "item-a", jobId, position: 0, sectionKey: "items", ...fields },
        {
          id: "item-b",
          jobId,
          position: 1,
          sectionKey: "items",
          ...fields,
          itemName: "Ink",
        },
      ])
      .run();

    const items = db
      .select()
      .from(schema.importItems)
      .where(eq(schema.importItems.jobId, jobId))
      .all();
    expect(items).toHaveLength(2);
    // Born waiting for review.
    expect(items.every((i) => i.state === ImportState.PendingReview)).toBe(
      true,
    );
    expect(pickReviewFields(items[0])).toEqual(fields);

    db.delete(schema.importQueue).where(eq(schema.importQueue.id, jobId)).run();
    expect(db.select().from(schema.importItems).all()).toHaveLength(0);
    sqlite.close();
  });

  it("clears a group's Source account when that account is deleted", () => {
    const sqlite = databaseAt0021();
    fillLikeBefore006(sqlite);
    applyMigrationRange(sqlite, MIGRATION, MIGRATION);
    sqlite.exec("PRAGMA foreign_keys = ON");
    const jobId = "33333333-3333-4333-8333-333333333333";
    sqlite
      .query(
        "INSERT INTO accounts(id, role, name, rank) VALUES (50, ?, 'Cash', 'a2')",
      )
      .run(AccountRole.Cash);
    sqlite
      .query("UPDATE import_queue SET group_account_id = 50 WHERE id = ?")
      .run(jobId);

    sqlite.query("DELETE FROM accounts WHERE id = 50").run();

    const row = sqlite
      .query("SELECT group_account_id FROM import_queue WHERE id = ?")
      .get(jobId) as { group_account_id: number | null };
    expect(row.group_account_id).toBeNull();
    sqlite.close();
  });
});
