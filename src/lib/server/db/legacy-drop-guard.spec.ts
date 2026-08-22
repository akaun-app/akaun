import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  legacyDropAllowed,
  readLegacyDropStateAt,
  PREVIOUS_RELEASE,
  type LegacyDropState,
} from "./legacy-drop-guard.js";

/**
 * Principle V, at its sharpest: wrong once, and an installation's records are
 * gone.
 *
 * This guard decides whether the migration that drops `expenses`, `incomes` and
 * `claims` may run. It cannot live inside the migration itself, because
 * `migrate()` runs at module load in `db/client.ts` while the conversion that
 * reads those tables runs later, in `hooks.server.ts`'s `init()` — so a `DROP`
 * in a migration would destroy the rows *before* the conversion that needed
 * them, on an installation that skipped the previous release. That is exactly
 * what FR-037a forbids (research.md R-05).
 *
 * Pure, over plain state. Three answers, and only one of them is a refusal.
 */

function state(overrides: Partial<LegacyDropState> = {}): LegacyDropState {
  return {
    legacyTablesPresent: true,
    legacyRowCount: 0,
    upgradePhase: "done",
    chartMigrationCompleted: false,
    ...overrides,
  };
}

describe("legacyDropAllowed", () => {
  it("allows when the tables are absent — a fresh install, or already cleaned", () => {
    const result = legacyDropAllowed(
      state({ legacyTablesPresent: false, legacyRowCount: 0 }),
    );
    expect(result.ok).toBe(true);
  });

  it("allows when the tables are absent even if the phase was never recorded", () => {
    const result = legacyDropAllowed(
      state({ legacyTablesPresent: false, upgradePhase: null }),
    );
    expect(result.ok).toBe(true);
  });

  it("allows when the tables are present but hold no rows", () => {
    const result = legacyDropAllowed(
      state({ legacyRowCount: 0, upgradePhase: null }),
    );
    expect(result.ok).toBe(true);
  });

  it("allows when the tables hold rows and the conversion finished", () => {
    const result = legacyDropAllowed(
      state({ legacyRowCount: 412, upgradePhase: "done" }),
    );
    expect(result.ok).toBe(true);
  });

  it("allows legacy cleanup after the composed chart conversion completed", () => {
    const result = legacyDropAllowed(
      state({
        legacyRowCount: 412,
        upgradePhase: null,
        chartMigrationCompleted: true,
      }),
    );
    expect(result.ok).toBe(true);
  });

  // The one refusal.
  it("refuses when the tables hold rows and the conversion has not finished", () => {
    const result = legacyDropAllowed(
      state({ legacyRowCount: 412, upgradePhase: "converting" }),
    );
    expect(result.ok).toBe(false);
  });

  it("refuses when the tables hold rows and no phase was ever recorded", () => {
    const result = legacyDropAllowed(
      state({ legacyRowCount: 1, upgradePhase: null }),
    );
    expect(result.ok).toBe(false);
  });

  it("refuses a phase that started but never reached done", () => {
    for (const phase of ["not-started", "converting", "verifying", "failed"]) {
      const result = legacyDropAllowed(
        state({ legacyRowCount: 5, upgradePhase: phase }),
      );
      expect(result.ok).toBe(false);
    }
  });

  it("names the release to install first, and promises the file is untouched", () => {
    const result = legacyDropAllowed(
      state({ legacyRowCount: 9, upgradePhase: "not-started" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.reason).toBe(
      `This release removes the old expense, income and claim tables, and this installation still has records in them that have not been converted. Install version ${PREVIOUS_RELEASE} first, let it start once so it can convert them, then install this version. Your database has not been changed.`,
    );
    // The two things a person needs from this sentence.
    expect(result.reason).toContain(PREVIOUS_RELEASE);
    expect(result.reason).toContain("has not been changed");
  });
});

// ---------------------------------------------------------------------------
// The refusal path, against a real database file (T117).
//
// This matters more than the success path: it is the one that runs on an
// installation whose records have not been converted, and the promise it makes
// is that the file is left exactly as it was.
// ---------------------------------------------------------------------------

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** A database in the state an unconverted installation is in. */
function buildLegacyDatabase(dir: string, phase: string | null): string {
  const path = join(dir, "unconverted.db");
  const raw = new Database(path);
  raw.exec("PRAGMA journal_mode = WAL;");
  raw.exec("CREATE TABLE expenses (id INTEGER PRIMARY KEY, amount REAL);");
  raw.exec("CREATE TABLE incomes (id INTEGER PRIMARY KEY, amount REAL);");
  raw.exec("CREATE TABLE claims (id INTEGER PRIMARY KEY, amount REAL);");
  raw.exec(
    "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  );
  raw.exec("INSERT INTO expenses (amount) VALUES (10.0), (20.0);");
  raw.exec("INSERT INTO incomes (amount) VALUES (30.0);");
  if (phase !== null) {
    raw
      .query("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run("ledger_upgrade_state", JSON.stringify({ phase }));
  }
  // Fully checkpointed and closed, so the bytes on disk are settled before the
  // guard ever looks at them.
  raw.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  raw.close();
  return path;
}

describe("the refusal path, on a real file", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "akaun-guard-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses an unconverted database and leaves it byte-identical", () => {
    const path = buildLegacyDatabase(dir, "converting");
    const before = sha256(path);

    const result = legacyDropAllowed(readLegacyDropStateAt(path));

    expect(result.ok).toBe(false);
    // The whole point: reading the state must not have written anything.
    expect(sha256(path)).toBe(before);
  });

  it("refuses a database that never recorded a phase, and leaves it untouched", () => {
    const path = buildLegacyDatabase(dir, null);
    const before = sha256(path);

    const result = legacyDropAllowed(readLegacyDropStateAt(path));

    expect(result.ok).toBe(false);
    expect(sha256(path)).toBe(before);
  });

  it("allows a converted database, and still leaves it untouched", () => {
    const path = buildLegacyDatabase(dir, "done");
    const before = sha256(path);

    const result = legacyDropAllowed(readLegacyDropStateAt(path));

    expect(result.ok).toBe(true);
    expect(sha256(path)).toBe(before);
  });

  it("treats a database file that does not exist as a fresh installation", () => {
    const result = legacyDropAllowed(
      readLegacyDropStateAt(join(dir, "not-here.db")),
    );
    expect(result.ok).toBe(true);
  });

  it("reads the real row counts and phase out of the file", () => {
    const path = buildLegacyDatabase(dir, "converting");
    const state = readLegacyDropStateAt(path);

    expect(state.legacyTablesPresent).toBe(true);
    expect(state.legacyRowCount).toBe(3);
    expect(state.upgradePhase).toBe("converting");
  });
});
