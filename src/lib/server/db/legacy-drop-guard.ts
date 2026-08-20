import { existsSync } from "fs";
import { Database } from "bun:sqlite";
import type { Allowed } from "../ledger/types.js";

/**
 * May the migration that drops the legacy tables run?
 *
 * `expenses`, `incomes` and `claims` hold the records of every installation
 * that has not yet been converted to the double-entry store. Dropping them
 * before that conversion has run destroys those records outright, and there is
 * no way back from inside the app (FR-037a).
 *
 * **Why this cannot live inside the migration.** `migrate(db, …)` runs at
 * module load, inside `createDb()` in `db/client.ts`. The conversion that reads
 * these tables — `ensureLedgerUpgrade` — runs later, from `init()` in
 * `hooks.server.ts`. A `DROP TABLE` in a migration would therefore destroy the
 * rows *before* the conversion that needed them could ever run. So the decision
 * is made here, before `migrate()` is called at all, and on a refusal the
 * server does not start and the database is left byte-identical
 * (research.md R-05).
 *
 * Pure: it takes the three facts it needs and returns an answer. Reading those
 * facts out of `sqlite_master` and `settings` is a *read*, so the
 * constitution's "never a hand-applied schema mutation" rule is untouched —
 * every schema change still goes through the generated migration.
 */

/** The release that knows how to convert the legacy tables. */
export const PREVIOUS_RELEASE = "0.0.1";

export type LegacyDropState = {
  /** Does `expenses` still exist in `sqlite_master`? */
  legacyTablesPresent: boolean;
  /** Rows across `expenses` + `incomes` + `claims`. */
  legacyRowCount: number;
  /** `settings.ledger_upgrade_state` → phase, or null if never recorded. */
  upgradePhase: string | null;
};

const REFUSAL = `This release removes the old expense, income and claim tables, and this installation still has records in them that have not been converted. Install version ${PREVIOUS_RELEASE} first, let it start once so it can convert them, then install this version. Your database has not been changed.`;

export function legacyDropAllowed(state: LegacyDropState): Allowed {
  // 1. A fresh installation, or one already cleaned. Nothing to lose.
  if (!state.legacyTablesPresent) return { ok: true };

  // 2. The tables are there but empty. Also nothing to lose — and this is the
  //    common case for an installation converted by an earlier release that
  //    already cleared them.
  if (state.legacyRowCount === 0) return { ok: true };

  // 3. Rows, and the conversion finished: what is left are the old copies of
  //    records that now live in `ledger_records`. Safe to drop.
  if (state.upgradePhase === "done") return { ok: true };

  // 4. Rows, and the conversion did not finish. The only refusal there is.
  return { ok: false, reason: REFUSAL };
}

/**
 * Reads the three facts above out of a database file, without writing to it.
 *
 * **Read-only on purpose.** On a refusal the promise is that the file is left
 * byte-identical, and a read-write connection breaks that promise before any
 * decision is made: it sets `journal_mode`, and closing it checkpoints the WAL
 * back into the main file. A read-only connection cannot do either.
 *
 * Raw SQL, because this runs before `migrate()` — the schema Drizzle knows
 * about is the one *after* the drop, and these tables are not in it. Reading is
 * not a schema mutation, so the constitution's rule that every schema change
 * goes through a generated migration is untouched (research.md R-05).
 */
export function readLegacyDropStateAt(databasePath: string): LegacyDropState {
  // A database that does not exist yet is a fresh installation.
  if (!existsSync(databasePath)) {
    return {
      legacyTablesPresent: false,
      legacyRowCount: 0,
      upgradePhase: null,
    };
  }

  const raw = new Database(databasePath, { readonly: true });
  try {
    return readLegacyDropStateFrom(raw);
  } finally {
    raw.close();
  }
}

/** The same read, against an open connection. Split out so a test can drive it. */
export function readLegacyDropStateFrom(raw: Database): LegacyDropState {
  const present = raw
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('expenses','incomes','claims')",
    )
    .all() as { name: string }[];

  if (present.length === 0) {
    return {
      legacyTablesPresent: false,
      legacyRowCount: 0,
      upgradePhase: null,
    };
  }

  // Only the tables that actually exist are counted — an installation part-way
  // through an older release may have some and not others.
  let legacyRowCount = 0;
  for (const { name } of present) {
    const row = raw.query(`SELECT count(*) AS n FROM "${name}"`).get() as {
      n: number;
    } | null;
    legacyRowCount += row?.n ?? 0;
  }

  const settingsTable = raw
    .query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'",
    )
    .get();
  let upgradePhase: string | null = null;
  if (settingsTable) {
    const row = raw
      .query("SELECT value FROM settings WHERE key = ?")
      .get("ledger_upgrade_state") as { value: string } | null;
    if (row?.value) {
      try {
        upgradePhase =
          (JSON.parse(row.value) as { phase?: string }).phase ?? null;
      } catch {
        // An unreadable state row is not a finished conversion.
        upgradePhase = null;
      }
    }
  }

  return { legacyTablesPresent: true, legacyRowCount, upgradePhase };
}
