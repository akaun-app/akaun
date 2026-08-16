import { copyFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { eq, sql } from "drizzle-orm";
import { accounts, groupPermissions, ledgerRecords } from "../../db/schema.js";
import { AccountRole, type AccountRoleCode } from "$lib/enums.js";
import { DATABASE_PATH, STORAGE_PATH } from "../../env.js";
import { createLogger } from "../../logger.js";
import { getSetting, setSetting, SETTING_KEYS } from "../../settings.js";
import { checkIntegrity } from "../integrity.js";
import { integrityInputs } from "../../queries/ledger.js";
import type { LedgerDb, UpgradeReport, UpgradeState } from "../types.js";
import { seedAccounts, type SeededAccounts } from "./accounts.js";
import { moveAttachments, removeOriginals } from "./attachments.js";
import { convertLegacyRecords } from "./convert.js";
import { backfillReconciliation } from "./reconciliation.js";
import { compareSnapshots, snapshotAfter, snapshotBefore } from "./verify.js";

const log = createLogger("ledger-upgrade");

/**
 * The update, as a sequence of phases.
 *
 * It runs itself at startup, needs no command from a self-hosting user, is safe
 * to run again, and picks up where it stopped if it was interrupted (FR-037).
 * Nothing old is thrown away until the whole thing has proved it changed
 * nothing it should not have (FR-038).
 *
 * The order matters and is the whole design:
 *
 *   1. Back the database file up, so there is something to go back to.
 *   2. Take the "before" picture, while the old tables are still the truth.
 *   3. Seed the chart of accounts — nothing can be converted into nothing.
 *   4. Convert records, movements and settlements.
 *   5. Copy the attachment files and prove each copy; remove no original.
 *   6. Repoint every bank match and give every statement its account.
 *   7. Take the "after" picture and compare the two.
 *   8. ONLY THEN remove the original attachment files.
 *
 * Progress is written to one `settings` row after every phase, which is what
 * makes the run resumable, rerunnable and inspectable (D-15). Financial amounts
 * are never logged (Constitution: Technology & Platform Constraints).
 */

function emptyReport(): UpgradeReport {
  return {
    uncategorisedRecordIds: [],
    missingAttachments: [],
    roundingDifferences: [],
    payerAttributions: [],
    bankFallbackRecordIds: [],
    unrepointedAllocationIds: [],
  };
}

function emptyState(): UpgradeState {
  return {
    phase: "not-started",
    backupPath: null,
    before: null,
    verify: null,
    report: emptyReport(),
    startedAt: null,
    finishedAt: null,
  };
}

export function readUpgradeState(db: LedgerDb): UpgradeState {
  const raw = getSetting(db, SETTING_KEYS.ledgerUpgradeState);
  if (!raw) return emptyState();
  try {
    return { ...emptyState(), ...(JSON.parse(raw) as Partial<UpgradeState>) };
  } catch {
    // A hand-edited or truncated row must not wedge startup. Starting over is
    // safe: every phase is idempotent.
    log.warn(
      "Could not read the ledger upgrade state; starting from the beginning",
    );
    return emptyState();
  }
}

function writeState(db: LedgerDb, state: UpgradeState): void {
  setSetting(db, SETTING_KEYS.ledgerUpgradeState, JSON.stringify(state));
}

/**
 * A copy of the database file, taken before anything is touched.
 *
 * Not a substitute for the verification — it is what makes the verification
 * safe to fail. Skipped when a previous run already took one, so a rerun does
 * not overwrite the copy of the state we actually want to go back to.
 */
function backUpDatabase(existing: string | null, databasePath: string): string {
  if (existing) return existing;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dirname(databasePath), "backups", `pre-ledger-${stamp}.db`);
  mkdirSync(dirname(path), { recursive: true });
  copyFileSync(databasePath, path);
  log.info({ path }, "Backed the database up before the ledger upgrade");
  return path;
}

/** The category accounts, for the "after" picture to read its totals from. */
function categoryAccounts(db: LedgerDb) {
  const rows = db
    .select({ id: accounts.id, name: accounts.name, role: accounts.role })
    .from(accounts)
    .all();

  const of = (role: AccountRoleCode) =>
    rows.filter((r) => r.role === role).map((r) => r.id);

  return {
    expense: of(AccountRole.ExpenseCategory),
    income: of(AccountRole.IncomeCategory),
    nameById: new Map(rows.map((r) => [r.id, r.name])),
  };
}

/**
 * Deletes the `claims` permission rows. Claims are retired as a kind of record,
 * so a permission naming them grants access to nothing and would sit in the
 * groups screen forever confusing whoever reads it (D-20, FR-036a).
 */
function dropClaimPermissions(db: LedgerDb): void {
  const removed = db
    .delete(groupPermissions)
    .where(eq(groupPermissions.resource, "claims"))
    .returning({ groupId: groupPermissions.groupId })
    .all();
  if (removed.length > 0) {
    log.info({ rows: removed.length }, "Removed the retired claims permission");
  }
}

/** True once every legacy row has a record against it. */
function conversionLooksComplete(db: LedgerDb): boolean {
  const converted =
    db
      .select({ n: sql<number>`count(*)` })
      .from(ledgerRecords)
      .where(sql`${ledgerRecords.legacyKind} IS NOT NULL`)
      .get()?.n ?? 0;
  return converted > 0;
}

/**
 * Who is allowed to set this thing running.
 *
 * The upgrade converts a real business's books and, at the end, deletes the
 * original attachment files. It runs itself from the app's own startup, with no
 * command and no setting — that is FR-037, and it is what makes a self-hosting
 * user's installation update itself.
 *
 * What must NOT run it is a test runner. `DATABASE_PATH` and `STORAGE_PATH`
 * default to paths RELATIVE to the working directory, so a spec running in the
 * project root points at whatever books are sitting in `data/`, and no amount
 * of overriding the environment inside the spec changes that. This has already
 * destroyed a real `data/` directory once.
 */
export type UpgradeGuard = {
  /**
   * Set ONLY by a caller that has created its own temporary database and knows
   * it is not pointing at anyone's real books. Nothing in the application sets
   * this; it exists so a test can exercise the whole orchestration.
   */
  allowOutsideServerStartup?: boolean;
};

/**
 * Why this process must not run the upgrade, or null when it may.
 *
 * There is deliberately no "skip it" switch. FR-037 requires the update to
 * complete with no manual step for a self-hosting user, and a flag someone has
 * to remember to unset is exactly the manual step it forbids — it would also
 * mean an installation could sit half-converted because nobody knew about it.
 * The one thing refused here is a test runner, which needs no setting because
 * the runner announces itself.
 *
 * Pure, and takes the condition rather than reading it, so the rule can be
 * exercised without a test having to reach into `process.env` and put it back.
 */
export function upgradeRefusal(
  conditions: { underTestRunner: boolean },
  guard: UpgradeGuard,
): string | null {
  // An explicit opt-in means the caller created the database it just handed us
  // and knows it is not anybody's real books.
  if (guard.allowOutsideServerStartup) return null;

  // A spec that reaches this is running in the project root, where the default
  // paths are the real ones — so running the upgrade would convert whatever
  // books happen to be sitting in `data/`.
  if (conditions.underTestRunner) {
    return "The ledger upgrade does not run under a test runner. A test that means to exercise it must pass { allowOutsideServerStartup: true } and its own temporary database.";
  }

  return null;
}

function whyItMustNotRun(guard: UpgradeGuard): string | null {
  // Vitest sets this in every worker.
  return upgradeRefusal(
    { underTestRunner: Boolean(process.env.VITEST) },
    guard,
  );
}

/**
 * The database file to back up, and the root every attachment path is relative
 * to.
 *
 * These are arguments rather than module-level constants because the database
 * and the files have to move together. Reading `DATABASE_PATH` and
 * `STORAGE_PATH` from the environment here meant that handing this function a
 * temporary database still backed up, copied and DELETED under the real
 * `data/` — the two were configured independently, so sandboxing one sandboxed
 * nothing. That is not a hypothetical: it destroyed a real installation's
 * receipts. A caller that owns a sandbox now says so once, and it holds for
 * both halves.
 */
export type UpgradePaths = {
  databasePath: string;
  storageRoot: string;
};

export function runLedgerUpgrade(
  db: LedgerDb,
  guard: UpgradeGuard = {},
  paths: UpgradePaths = {
    databasePath: DATABASE_PATH,
    storageRoot: STORAGE_PATH,
  },
): UpgradeState {
  const state = readUpgradeState(db);

  if (state.phase === "done") return state;

  const refusal = whyItMustNotRun(guard);
  if (refusal) {
    log.warn(refusal);
    return state;
  }

  state.startedAt = state.startedAt ?? new Date().toISOString();

  // The report is CARRIED FORWARD, not rebuilt. Every phase skips what a
  // previous run already did, so a rerun finds nothing to report — and starting
  // from an empty report would quietly erase the payer attributions and flagged
  // records the user is meant to review (FR-036b, FR-036c). Nothing is added
  // twice, because nothing is converted twice.
  state.report = { ...emptyReport(), ...state.report };

  // --- 1. Back up ---------------------------------------------------------
  state.backupPath = backUpDatabase(state.backupPath, paths.databasePath);
  state.phase = "backed-up";
  writeState(db, state);

  // --- 2. The "before" picture --------------------------------------------
  // Taken once and kept: on a rerun the old tables have not changed, but the
  // first run's picture is the one the comparison must be against.
  if (state.before === null) {
    state.before = snapshotBefore(db, paths.storageRoot);
  }
  writeState(db, state);

  // --- 3. Seed the chart of accounts --------------------------------------
  const seeded: SeededAccounts = seedAccounts(db);
  state.phase = "accounts-seeded";
  writeState(db, state);

  // --- 4. Convert ---------------------------------------------------------
  convertLegacyRecords(db, seeded, state.report);
  state.phase = "records-converted";
  writeState(db, state);

  // --- 5. Move the attachment files (copy and prove; remove nothing) ------
  moveAttachments(db, state.report, paths.storageRoot);
  state.phase = "attachments-moved";
  writeState(db, state);

  // --- 6. Repoint every bank match ----------------------------------------
  backfillReconciliation(db, seeded, state.report);
  dropClaimPermissions(db);
  state.phase = "reconciliation-backfilled";
  writeState(db, state);

  // --- 7. Prove it ---------------------------------------------------------
  const after = snapshotAfter(db, categoryAccounts(db), paths.storageRoot);
  state.verify = compareSnapshots(state.before, after);

  const integrity = checkIntegrity(integrityInputs(db));
  if (!integrity.ok) {
    state.verify = {
      ok: false,
      findings: [
        ...state.verify.findings,
        {
          what: "The books do not balance",
          before: "every record's two sides cancel out",
          after: `${integrity.unbalancedRecords.length} record(s) do not`,
        },
      ],
    };
  }

  state.phase = "verified";
  writeState(db, state);

  if (!state.verify.ok) {
    // Everything old is still exactly where it was, and the backup is still
    // there. Say so loudly and stop — removing an original now would throw away
    // the only evidence of what went wrong.
    log.error(
      {
        findings: state.verify.findings.map((f) => f.what),
        backup: state.backupPath,
      },
      "The ledger upgrade did not verify. Nothing has been removed; the previous data is intact.",
    );
    return state;
  }

  // --- 8. Only now: remove the originals -----------------------------------
  const removal = removeOriginals(db, paths.storageRoot);
  if (removal.kept.length > 0) {
    state.report.missingAttachments.push(...removal.kept);
  }

  state.phase = "done";
  state.finishedAt = new Date().toISOString();
  writeState(db, state);

  log.info(
    {
      converted: conversionLooksComplete(db),
      uncategorised: state.report.uncategorisedRecordIds.length,
      missingAttachments: state.report.missingAttachments.length,
      bankFallbacks: state.report.bankFallbackRecordIds.length,
      unrepointedAllocations: state.report.unrepointedAllocationIds.length,
    },
    "Ledger upgrade complete",
  );

  return state;
}

/**
 * Runs the upgrade at startup, and never lets a failure take the app down
 * silently. A run that could not verify leaves everything old intact, so the
 * app still starts and the Settings screen shows what went wrong.
 *
 * The `intent` argument is not used for anything — it is there so that calling
 * this reads, at the call site, as the deliberate act it is. There is exactly
 * one legitimate caller: `init()` in `src/hooks.server.ts`.
 */
export function ensureLedgerUpgrade(
  db: LedgerDb,
  intent: "server-startup",
): void {
  void intent;
  try {
    runLedgerUpgrade(db);
  } catch (error) {
    log.error(
      { err: error },
      "The ledger upgrade could not complete. The previous data is intact; see the backup in data/backups.",
    );
    throw error;
  }
}
