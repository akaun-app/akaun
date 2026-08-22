import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrateAccountChart } from "../src/lib/server/services/account-migration.js";
import { convertLegacyLedger } from "../src/lib/server/services/legacy-ledger-migration.js";

type MigrationResult = {
  status: "completed" | "dry_run" | "already_completed";
  inputState: "legacy_0005" | "ledger" | "completed";
  legacy: ReturnType<typeof convertLegacyLedger> | null;
  chart: ReturnType<typeof migrateAccountChart>;
  foreignKeyViolations: number;
  backupPath: string | null;
};

type MigrationFile = {
  sql: string[];
  folderMillis: number;
  hash: string;
};

const migrations = readMigrationFiles({
  migrationsFolder: resolve("drizzle"),
}) as MigrationFile[];

function tableExists(db: Database, table: string): boolean {
  return Boolean(
    db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function appliedIndex(db: Database): number {
  if (!tableExists(db, "__drizzle_migrations")) return -1;
  const last = db
    .query(
      "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    )
    .get() as { created_at: number } | null;
  if (!last) return -1;
  return migrations.findIndex(
    (migration) => migration.folderMillis === Number(last.created_at),
  );
}

export function applyMigrationRange(
  db: Database,
  firstIndex: number,
  lastIndex: number,
): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)",
  );
  const current = appliedIndex(db);
  if (current > lastIndex) return;
  if (current < firstIndex - 1) {
    throw new Error(
      `Refusing partial schema: expected migration ${firstIndex - 1}, found ${current}.`,
    );
  }
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (
      let index = Math.max(firstIndex, current + 1);
      index <= lastIndex;
      index += 1
    ) {
      const migration = migrations[index];
      for (const statement of migration.sql) {
        if (statement.trim()) db.exec(statement);
      }
      db.query(
        "INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)",
      ).run(migration.hash, migration.folderMillis);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

function consolidate(source: string, destination: string): void {
  const sourceDb = new Database(source, { readonly: true });
  try {
    sourceDb.query("VACUUM INTO ?").run(destination);
  } finally {
    sourceDb.close();
  }
}

function classify(db: Database): MigrationResult["inputState"] {
  const index = appliedIndex(db);
  if (
    index === 5 &&
    tableExists(db, "expenses") &&
    !tableExists(db, "accounts")
  ) {
    return "legacy_0005";
  }
  if (
    index >= 14 &&
    tableExists(db, "accounts") &&
    tableExists(db, "ledger_records")
  ) {
    return index >= 16 ? "completed" : "ledger";
  }
  throw new Error(
    `Unsupported partial database state at migration index ${index}. Restore the original backup and retry from migration 0005 or a completed ledger conversion.`,
  );
}

function databaseFamilyChecksum(path: string): string {
  const digest = createHash("sha256");
  for (const suffix of ["", "-wal", "-shm"]) {
    const member = `${path}${suffix}`;
    digest.update(suffix);
    digest.update(existsSync(member) ? readFileSync(member) : "<absent>");
  }
  return digest.digest("hex");
}

function installResult(source: string, working: string): string {
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const backupDir = join(dirname(source), `pre-chart-${stamp}`);
  mkdirSync(backupDir);
  for (const suffix of ["", "-wal", "-shm"]) {
    const original = `${source}${suffix}`;
    if (existsSync(original)) {
      renameSync(original, join(backupDir, `akaun.db${suffix}`));
    }
  }
  try {
    renameSync(working, source);
  } catch (error) {
    const backup = join(backupDir, "akaun.db");
    if (!existsSync(source) && existsSync(backup)) renameSync(backup, source);
    throw error;
  }
  return backupDir;
}

export function migrateChartDatabase(options: {
  databasePath: string;
  dryRun?: boolean;
}): MigrationResult {
  const source = resolve(options.databasePath);
  if (!isAbsolute(source) || !existsSync(source)) {
    throw new Error("--database must name an existing absolute SQLite path.");
  }
  const temporaryDir = mkdtempSync(join(dirname(source), ".akaun-chart-"));
  const working = join(temporaryDir, "working.db");
  consolidate(source, working);
  const originalChecksum = databaseFamilyChecksum(source);
  let backupPath: string | null = null;
  try {
    const db = new Database(working);
    db.exec("PRAGMA foreign_keys = ON");
    const inputState = classify(db);
    let legacy: ReturnType<typeof convertLegacyLedger> | null = null;

    if (inputState === "legacy_0005") {
      applyMigrationRange(db, 6, 14);
      legacy = db.transaction(() => convertLegacyLedger(db))();
      applyMigrationRange(db, 15, 16);
    } else if (inputState === "ledger") {
      applyMigrationRange(db, appliedIndex(db) + 1, 16);
    }

    const chart = migrateAccountChart(db);
    const foreignKeyViolations = db
      .query("PRAGMA foreign_key_check")
      .all().length;
    if (foreignKeyViolations !== 0) {
      throw new Error(
        `Conversion produced ${foreignKeyViolations} foreign-key violations.`,
      );
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();

    if (databaseFamilyChecksum(source) !== originalChecksum) {
      throw new Error(
        "The source database changed while conversion was running.",
      );
    }
    if (!options.dryRun && chart.status !== "already_completed") {
      backupPath = installResult(source, working);
    }
    return {
      status: options.dryRun
        ? "dry_run"
        : chart.status === "already_completed"
          ? "already_completed"
          : "completed",
      inputState,
      legacy,
      chart,
      foreignKeyViolations,
      backupPath,
    };
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }
}

function parseArguments(args: string[]): {
  databasePath: string;
  dryRun: boolean;
  json: boolean;
} {
  const databaseAt = args.indexOf("--database");
  const databasePath = databaseAt >= 0 ? args[databaseAt + 1] : undefined;
  if (!databasePath || !isAbsolute(databasePath)) {
    throw new Error(
      "Usage: migrate-chart-of-accounts --database <absolute-sqlite-path> [--dry-run] [--json]",
    );
  }
  return {
    databasePath,
    dryRun: args.includes("--dry-run"),
    json: args.includes("--json"),
  };
}

if (import.meta.main) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = migrateChartDatabase(args);
    console.log(
      args.json ? JSON.stringify(result) : JSON.stringify(result, null, 2),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
