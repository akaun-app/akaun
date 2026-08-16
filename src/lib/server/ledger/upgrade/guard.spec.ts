import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq } from "drizzle-orm";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema.js";
import { settings } from "../../db/schema.js";
import { runLedgerUpgrade, upgradeRefusal } from "./index.js";
import type { LedgerDb } from "../types.js";

/**
 * The upgrade converts a real business's books and then deletes the original
 * attachment files. `DATABASE_PATH` and `STORAGE_PATH` default to paths
 * RELATIVE to the working directory, so any process started in the project root
 * — a spec file, a one-off script, a dev server nobody meant to start — points
 * at the maintainer's real data by default.
 *
 * That is not hypothetical: it has already destroyed a real `data/` directory
 * once, and no amount of overriding the environment inside such a script
 * prevented it. These tests exist so the refusal that now stands in the way
 * cannot be removed or weakened without something going red.
 *
 * Note what makes the integration cases below meaningful: they run UNDER
 * Vitest, which is one of the conditions the guard refuses on. They prove the
 * guard by the fact that they can be written at all.
 */

describe("the rule about where the upgrade may run", () => {
  it("lets the app's own startup through, with no setting to remember", () => {
    // FR-037: a self-hosting user's installation updates itself. There is no
    // switch to turn on, which is why this is the whole of the happy path.
    expect(upgradeRefusal({ underTestRunner: false }, {})).toBeNull();
  });

  it("refuses under a test runner", () => {
    const refusal = upgradeRefusal({ underTestRunner: true }, {});
    expect(refusal).toMatch(/test runner/i);
    // The refusal has to say what a test that genuinely wants to exercise the
    // upgrade should do instead, or the next person just deletes the guard.
    expect(refusal).toMatch(/allowOutsideServerStartup/);
  });

  it("waives the refusal for a caller that says it owns the database", () => {
    expect(
      upgradeRefusal(
        { underTestRunner: true },
        { allowOutsideServerStartup: true },
      ),
    ).toBeNull();
  });
});

// --- and that the rule is actually wired into the entry point ---------------

let dir: string;
let db: LedgerDb;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "akaun-guard-"));
  const raw = new Database(join(dir, "test.db"));
  raw.exec("PRAGMA foreign_keys = ON;");
  db = drizzle(raw, { schema }) as LedgerDb;
  migrate(db, { migrationsFolder: "drizzle" });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The paths this test owns. Passing them is the point of the exercise: without
 * them the upgrade backs up, copies and deletes under the REAL `data/`, however
 * temporary the database it was handed.
 */
function sandbox() {
  return {
    databasePath: join(dir, "test.db"),
    storageRoot: join(dir, "storage"),
  };
}

/** Whether the upgrade got far enough to write anything at all. */
function leftAnyTrace(): boolean {
  return (
    db
      .select()
      .from(settings)
      .where(eq(settings.key, "ledger_upgrade_state"))
      .get() !== undefined
  );
}

describe("running the upgrade from a spec file", () => {
  it("is refused, and writes nothing", () => {
    const state = runLedgerUpgrade(db);
    expect(state.phase).toBe("not-started");
    expect(leftAnyTrace()).toBe(false);
  });
});

describe("a caller that has said it owns the database", () => {
  it("is allowed through, and converts", () => {
    const state = runLedgerUpgrade(
      db,
      { allowOutsideServerStartup: true },
      sandbox(),
    );
    expect(state.phase).toBe("done");
    expect(state.verify?.ok).toBe(true);
    expect(leftAnyTrace()).toBe(true);
  });

  it("does nothing the second time", () => {
    runLedgerUpgrade(db, { allowOutsideServerStartup: true }, sandbox());
    expect(
      runLedgerUpgrade(db, { allowOutsideServerStartup: true }, sandbox())
        .phase,
    ).toBe("done");
  });

  it("backs up inside the sandbox it was given, never beside the real database", () => {
    const state = runLedgerUpgrade(
      db,
      { allowOutsideServerStartup: true },
      sandbox(),
    );
    expect(state.backupPath).not.toBeNull();
    // This is the accident the paths argument exists to prevent: a backup, a
    // file copy or a file DELETE landing in the maintainer's `data/` because
    // the paths came from the environment rather than from the caller. Handing
    // over a temporary database was never enough on its own.
    expect(state.backupPath!.startsWith(dir)).toBe(true);
    expect(existsSync(state.backupPath!)).toBe(true);
  });
});
