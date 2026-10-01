import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentType, ImportState } from "$lib/enums.js";
import { applyMigrationRange } from "./auto-upgrade.js";

/**
 * Migration 0025 adds one empty column, `review_note`, to the review fields of
 * the import queue and of import items (006 FR-034: a fee type's tied category
 * that could not be used is said on the item). It only adds: every row already
 * stored, in every table, stays exactly as it was (FR-048), and the new
 * column is empty on all of them.
 *
 * Each test builds its own database file under `os.tmpdir()` from the
 * migrations in `drizzle/`, stopping at 0024, then fills it, and only then
 * applies 0025.
 */

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const LAST_BEFORE = 24;
const MIGRATION = 25;

function databaseAt0024(): Database {
  const directory = mkdtempSync(join(tmpdir(), "akaun-migration-0025-"));
  directories.push(directory);
  const db = new Database(join(directory, "akaun.db"));
  applyMigrationRange(db, 0, LAST_BEFORE);
  return db;
}

function fill(db: Database) {
  db.query(
    "INSERT INTO users(id, email, username, password_hash) VALUES (1, 'u@test', 'u', 'x')",
  ).run();
  db.query(
    "INSERT INTO import_profiles(id, name, sections_json) VALUES (3, 'Shopee', '[]')",
  ).run();
  // A receipt waiting for review, with a remark.
  db.query(
    `INSERT INTO import_queue(id, created_by, state, temp_file_path, original_filename, item_name, amount, remark)
     VALUES ('receipt', 1, ?, 'import/temp/receipt.pdf', 'receipt.pdf', 'Paper', 12.5, 'Fee type: ads_fee')`,
  ).run(ImportState.PendingReview);
  // A group read with a saved profile, and one of its items.
  db.query(
    `INSERT INTO import_queue(id, created_by, state, temp_file_path, original_filename,
       read_as, profile_id, read_how, profile_snapshot)
     VALUES ('group', 1, ?, 'import/temp/fees.pdf', 'fees.pdf',
       'profile', '3', 'chosen', '{"version":1}')`,
  ).run(ImportState.Grouped);
  db.query(
    `INSERT INTO import_items(id, job_id, state, position, section_key, fee_type, extras_json, document_type, amount, remark)
     VALUES ('item-0', 'group', ?, 0, 'fees', 'ads_fee', '{"order_no":"2408"}', ?, 10, 'Fee type: ads_fee; order_no: 2408')`,
  ).run(ImportState.PendingReview, DocumentType.Expense);
}

/** Every table's rows, as they stand, with the new column left out. */
function rowsWithout(db: Database, column: string) {
  const tables = db
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name",
    )
    .all() as { name: string }[];
  const rows: Record<string, unknown[]> = {};
  for (const { name } of tables) {
    rows[name] = (
      db.query(`SELECT * FROM "${name}" ORDER BY rowid`).all() as Record<
        string,
        unknown
      >[]
    ).map((row) => {
      const copy = { ...row };
      delete copy[column];
      return copy;
    });
  }
  return rows;
}

function columns(db: Database, table: string): string[] {
  return (
    db.query(`PRAGMA table_info("${table}")`).all() as { name: string }[]
  ).map((column) => column.name);
}

describe("migration 0025", () => {
  it("adds an empty review note to the queue and to items, and changes nothing else", () => {
    const db = databaseAt0024();
    fill(db);
    const before = rowsWithout(db, "review_note");
    const queueColumns = columns(db, "import_queue");
    const itemColumns = columns(db, "import_items");

    applyMigrationRange(db, MIGRATION, MIGRATION);

    expect(rowsWithout(db, "review_note")).toEqual(before);
    expect(columns(db, "import_queue")).toEqual([
      ...queueColumns,
      "review_note",
    ]);
    expect(columns(db, "import_items")).toEqual([
      ...itemColumns,
      "review_note",
    ]);
    expect(
      db.query("SELECT review_note FROM import_queue ORDER BY id").all(),
    ).toEqual([{ review_note: null }, { review_note: null }]);
    expect(db.query("SELECT review_note FROM import_items").all()).toEqual([
      { review_note: null },
    ]);
    db.close();
  });
});
