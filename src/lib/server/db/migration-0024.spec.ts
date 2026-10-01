import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { DocumentType, ImportState } from "$lib/enums.js";
import { applyMigrationRange } from "./auto-upgrade.js";

/**
 * Migration 0024 adds the import profiles table (006 S2) and nothing else.
 * Upgrading must not change or remove anything already in the queue, the
 * import history, the records or the settings (FR-048), including a queue row
 * read with the built-in several-items reading, whose profile id
 * ("builtin:items@1") is not a saved profile's.
 *
 * Each test builds its own database file under `os.tmpdir()` from the
 * migrations in `drizzle/`, stopping at 0023, then fills it, and only then
 * applies 0024.
 */

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const LAST_BEFORE = 23;
const MIGRATION = 24;

function databaseAt0023(): Database {
  const directory = mkdtempSync(join(tmpdir(), "akaun-migration-0024-"));
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
    "INSERT INTO settings(key, value) VALUES ('import.customInstructions', 'Use Office for paper')",
  ).run();
  db.query(
    "INSERT INTO ledger_records(id, kind, date, amount) VALUES (1, 1, '2026-07-31', 10)",
  ).run();
  db.query(
    "INSERT INTO audit_log(record_type, record_id, user_id, action) VALUES ('record', 1, 1, 'create')",
  ).run();

  // A receipt from before 006, with every reading column empty.
  db.query(
    `INSERT INTO import_queue(id, created_by, state, temp_file_path, original_filename)
     VALUES ('receipt', 1, ?, 'import/temp/receipt.pdf', 'receipt.pdf')`,
  ).run(ImportState.PendingReview);
  // A group read with the built-in several-items reading (006 S1).
  db.query(
    `INSERT INTO import_queue(id, created_by, state, temp_file_path, original_filename,
       read_as, profile_id, read_how, extraction_notes)
     VALUES ('group', 1, ?, 'import/temp/fees.pdf', 'fees.pdf',
       'items', 'builtin:items@1', 'chosen', '{"statedTotal":null,"itemsTotalMinor":-1000,"ignored":[]}')`,
  ).run(ImportState.Grouped);
  db.query(
    `INSERT INTO import_items(id, job_id, state, position, section_key, document_type, amount)
     VALUES ('item-0', 'group', ?, 0, 'items', ?, 10)`,
  ).run(ImportState.PendingReview, DocumentType.Expense);
}

/** Every table and index, and every row of every table, as they stand. */
function everything(db: Database) {
  const objects = db
    .query(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' ORDER BY name",
    )
    .all() as { type: string; name: string; sql: string | null }[];
  const rows: Record<string, unknown[]> = {};
  for (const object of objects) {
    if (object.type !== "table") continue;
    rows[object.name] = db
      .query(`SELECT * FROM "${object.name}" ORDER BY rowid`)
      .all();
  }
  return { objects, rows };
}

describe("migration 0024", () => {
  it("adds the profiles table and leaves everything else as it was", () => {
    const db = databaseAt0023();
    fill(db);
    const before = everything(db);

    applyMigrationRange(db, MIGRATION, MIGRATION);

    const after = everything(db);
    expect(after.objects.filter((o) => o.name !== "import_profiles")).toEqual(
      before.objects,
    );
    const { import_profiles: profiles, ...rest } = after.rows;
    expect(rest).toEqual(before.rows);
    expect(profiles).toEqual([]);
    expect(
      db.query("SELECT profile_id FROM import_queue WHERE id = 'group'").get(),
    ).toEqual({ profile_id: "builtin:items@1" });
    db.close();
  });

  it("gives a new profile its defaults, enabled", () => {
    const db = databaseAt0023();
    applyMigrationRange(db, MIGRATION, MIGRATION);
    db.query("INSERT INTO import_profiles(name) VALUES ('Fees')").run();

    expect(
      db
        .query(
          "SELECT id, description, phrases_json, instructions, sections_json, stated_total_labels_json, enabled FROM import_profiles",
        )
        .get(),
    ).toEqual({
      id: 1,
      description: "",
      phrases_json: "[]",
      instructions: "",
      sections_json: "[]",
      stated_total_labels_json: "{}",
      enabled: 1,
    });
    db.close();
  });
});
