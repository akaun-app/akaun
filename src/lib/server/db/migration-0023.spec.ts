import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentType, ImportState } from "$lib/enums.js";
import { applyMigrationRange } from "./auto-upgrade.js";

/**
 * Migration 0023 marks each attachment that is a document imported as several
 * items, so its text is never searched as one record's own (006 FR-029). The
 * mark is set on the attachments already made from such a document, and on no
 * other.
 *
 * Each test builds its own database file under `os.tmpdir()` from the
 * migrations in `drizzle/`, stopping at 0022, then fills it, and only then
 * applies 0023.
 */

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const LAST_BEFORE = 22;
const MIGRATION = 23;

function databaseAt0022(): Database {
  const directory = mkdtempSync(join(tmpdir(), "akaun-migration-0023-"));
  directories.push(directory);
  const db = new Database(join(directory, "akaun.db"));
  applyMigrationRange(db, 0, LAST_BEFORE);
  return db;
}

const GROUP_FILE = "records/2026/07/group_fees.pdf";
const SHARED_FILE = "records/2026/07/shared.pdf";
const OWN_FILE = "records/2026/07/own_receipt.pdf";

function fill(db: Database) {
  db.query(
    "INSERT INTO users(id, email, username, password_hash) VALUES (1, 'u@test', 'u', 'x')",
  ).run();
  const record = db.query(
    "INSERT INTO ledger_records(id, kind, date, amount) VALUES (?, 1, '2026-07-31', 10)",
  );
  for (const id of [1, 2, 3, 4]) record.run(id);

  // A finished group whose other records have let its file go: only record 1
  // still has it.
  db.query(
    `INSERT INTO import_queue(id, created_by, state, temp_file_path, original_filename)
     VALUES ('group', 1, ?, ?, 'fees.pdf')`,
  ).run(ImportState.Imported, GROUP_FILE);
  db.query(
    `INSERT INTO import_items(id, job_id, state, position, section_key, document_type, result_id)
     VALUES ('item-0', 'group', ?, 0, 'items', ?, 1)`,
  ).run(ImportState.Imported, DocumentType.Expense);
  // A receipt from the history, which has no items.
  db.query(
    `INSERT INTO import_queue(id, created_by, state, temp_file_path, original_filename)
     VALUES ('receipt', 1, ?, ?, 'own_receipt.pdf')`,
  ).run(ImportState.Imported, OWN_FILE);

  const attach = db.query(
    "INSERT INTO record_attachments(id, record_id, filename, display_name) VALUES (?, ?, ?, 'file')",
  );
  attach.run(10, 1, GROUP_FILE);
  // A group's file whose queue row was cleared from history: two records
  // still share it.
  attach.run(11, 2, SHARED_FILE);
  attach.run(12, 3, SHARED_FILE);
  attach.run(13, 4, OWN_FILE);
}

describe("migration 0023", () => {
  it("marks only the files of documents imported as several items", () => {
    const db = databaseAt0022();
    fill(db);

    applyMigrationRange(db, MIGRATION, MIGRATION);

    const rows = db
      .query(
        "SELECT id, record_id, filename, group_document FROM record_attachments ORDER BY id",
      )
      .all();
    expect(rows).toEqual([
      { id: 10, record_id: 1, filename: GROUP_FILE, group_document: 1 },
      { id: 11, record_id: 2, filename: SHARED_FILE, group_document: 1 },
      { id: 12, record_id: 3, filename: SHARED_FILE, group_document: 1 },
      { id: 13, record_id: 4, filename: OWN_FILE, group_document: 0 },
    ]);
    db.close();
  });

  it("gives a new attachment the unmarked default", () => {
    const db = databaseAt0022();
    applyMigrationRange(db, MIGRATION, MIGRATION);
    db.query(
      "INSERT INTO ledger_records(id, kind, date, amount) VALUES (1, 1, '2026-07-31', 10)",
    ).run();
    db.query(
      "INSERT INTO record_attachments(record_id, filename, display_name) VALUES (1, 'a.pdf', 'a')",
    ).run();

    expect(
      db.query("SELECT group_document FROM record_attachments").get(),
    ).toEqual({ group_document: 0 });
    db.close();
  });
});
