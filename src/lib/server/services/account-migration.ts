import type { Database } from "bun:sqlite";
import {
  AccountRole,
  AccountType,
  DefaultAccountPurpose,
  DocumentType,
  type AccountRoleCode,
  type AccountTypeCode,
} from "$lib/enums.js";
import { DEFAULT_CHART } from "../db/seed-accounts.js";
import { lowestFreeAccountCode } from "../ledger/account-code.js";
import { accountTypeForLegacyRole } from "../ledger/account-type.js";
import {
  ACCOUNT_ALIASES,
  ACCOUNT_RETYPES,
  aliasTarget,
} from "./account-aliases.js";
import { repointAccountReferences } from "./account-reference-map.js";

export const CHART_MIGRATION_VERSION = "004-standardize-chart-accounts-v1";

export type AccountMigrationSummary = {
  version: string;
  status: "completed" | "already_completed";
  mappedAccounts: number;
  assignedCodes: number;
  createdSeeds: number;
  installedDefaults: number;
  completedMerges: number;
  /** Accounts whose legacy type was wrong, not just their name (FR-057). */
  retypedAccounts: number;
  /** Legacy names renamed onto the seeded account they meant. */
  aliasRenames: number;
  /** Unfinished import-queue rows whose category string was rewritten. */
  rewrittenImportCategories: number;
  movedReferences: Record<string, number>;
  attentionItems: string[];
};

type AccountRow = {
  id: number;
  role: AccountRoleCode;
  type: AccountTypeCode | null;
  code: number | null;
  name: string;
  rank: string;
};

const DEFAULT_CODE_BY_PURPOSE = {
  [DefaultAccountPurpose.Receivable]: 1200,
  [DefaultAccountPurpose.Payable]: 2000,
  [DefaultAccountPurpose.OpeningBalances]: 3000,
  [DefaultAccountPurpose.SalesRevenue]: 4000,
  [DefaultAccountPurpose.UncategorisedExpense]: 5900,
  [DefaultAccountPurpose.EverydayTransaction]: 1100,
  [DefaultAccountPurpose.UncategorisedIncome]: 4100,
} as const;

function compatibilityRole(type: AccountTypeCode): AccountRoleCode {
  switch (type) {
    case AccountType.Asset:
      return AccountRole.Bank;
    case AccountType.Liability:
      return AccountRole.Payable;
    case AccountType.Equity:
      return AccountRole.OpeningBalances;
    case AccountType.Revenue:
      return AccountRole.IncomeCategory;
    case AccountType.Expense:
      return AccountRole.ExpenseCategory;
  }
}

export function normalizeAccountName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function accountRows(db: Database): AccountRow[] {
  return db
    .query(
      "SELECT id, role, type, code, name, rank FROM accounts ORDER BY role, rank, id",
    )
    .all() as AccountRow[];
}

function usedCodes(db: Database): number[] {
  return (
    db.query("SELECT code FROM accounts WHERE code IS NOT NULL").all() as {
      code: number;
    }[]
  ).map((row) => row.code);
}

function matchingAccounts(
  db: Database,
  type: AccountTypeCode,
  name: string,
): { id: number; code: number | null }[] {
  const normalized = normalizeAccountName(name);
  return (
    db
      .query(
        "SELECT id, code, name FROM accounts WHERE type = ? AND merged_into_account_id IS NULL ORDER BY id",
      )
      .all(type) as { id: number; code: number | null; name: string }[]
  )
    .filter((row) => normalizeAccountName(row.name) === normalized)
    .map(({ id, code }) => ({ id, code }));
}

function tableExists(db: Database, table: string): boolean {
  return Boolean(
    db
      .query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function movementCount(db: Database, accountId: number): number {
  if (!tableExists(db, "ledger_movements")) return 0;
  return Number(
    (
      db
        .query(
          "SELECT count(*) AS n FROM ledger_movements WHERE account_id = ?",
        )
        .get(accountId) as { n: number }
    ).n,
  );
}

/**
 * Fixes accounts whose legacy *kind* was wrong, not just their name.
 *
 * This is the one place in the codebase allowed to change the type of an account
 * that already has movements. `canChangeAccountType` in
 * `ledger/account-eligibility.ts` refuses exactly that, and is right to: for a
 * user action, retyping an account with history silently rewrites past reports.
 * Here rewriting past reports *is* the intent — legacy filed equipment as an
 * expense category, so buying something the business keeps read as one big
 * expense in the month it was bought, which 002 FR-006b says must not happen.
 *
 * Runs before any code is assigned, so the account is given a code in its new
 * type's range rather than keeping one that would fail `validateCompleted`.
 */
function applyRetypes(db: Database, summary: AccountMigrationSummary): void {
  for (const retype of ACCOUNT_RETYPES) {
    for (const row of matchingAccounts(db, retype.fromType, retype.name)) {
      db.query("UPDATE accounts SET type = ?, role = ? WHERE id = ?").run(
        retype.toType,
        retype.toRole,
        row.id,
      );
      summary.retypedAccounts += 1;
      summary.attentionItems.push(
        `${retype.name} moved from type ${retype.fromType} to type ${retype.toType} (${movementCount(db, row.id)} movements). Its records leave the profit and loss and appear on the balance sheet.`,
      );
    }
  }
}

/** An alias whose target name is already taken, so a rename would collide. */
type AliasMerge = { sourceId: number; survivorId: number; name: string };

/**
 * Renames each legacy name onto the seeded account it meant.
 *
 * A rename, not a merge, wherever the target name is still free: it is the same
 * row with the same id and the same movements, so nothing has to be repointed
 * and nothing can be lost. The exact-name pass that follows then hands it the
 * seed's code, and the seed-creation pass after that finds the name taken and
 * does not create a competing empty duplicate — which is the whole point, since
 * `account_defaults` is installed by code and would otherwise name the empty one.
 *
 * Two aliases may share a target (`Other` and `Uncategorised` both mean
 * `Other Expenses`). The target holder is therefore re-read for every account,
 * so the first claimant is renamed and the rest are queued as merges.
 */
function applyAliases(
  db: Database,
  summary: AccountMigrationSummary,
): AliasMerge[] {
  const merges: AliasMerge[] = [];
  for (const alias of ACCOUNT_ALIASES) {
    const target = aliasTarget(alias);
    if (!target) {
      summary.attentionItems.push(
        `Alias ${alias.from} names code ${alias.toCode}, which is not in the default chart.`,
      );
      continue;
    }
    for (const row of matchingAccounts(db, alias.type, alias.from)) {
      const holder = matchingAccounts(db, alias.type, target.name)[0] ?? null;
      if (!holder) {
        db.query("UPDATE accounts SET name = ? WHERE id = ?").run(
          target.name,
          row.id,
        );
        summary.aliasRenames += 1;
      } else if (holder.id !== row.id) {
        merges.push({
          sourceId: row.id,
          survivorId: holder.id,
          name: target.name,
        });
      }
    }
  }
  return merges;
}

/**
 * Moves every reference off `sourceId` onto `survivorId` and retires the source
 * as a redirect. Shared by both merge passes so there is one implementation of
 * "these two accounts are one account" (004 FR-063..FR-067).
 */
function mergeInto(
  db: Database,
  summary: AccountMigrationSummary,
  runId: number,
  sourceId: number,
  survivorId: number,
  normalizedName: string,
): void {
  mergeCounts(
    summary.movedReferences,
    repointAccountReferences(db, sourceId, survivorId),
  );
  db.query(
    "UPDATE accounts SET archived_at = datetime('now'), merged_into_account_id = ? WHERE id = ?",
  ).run(survivorId, sourceId);
  db.query(
    "INSERT INTO account_merge_audits(source_account_id, survivor_account_id, run_id, normalized_name, outcome, reference_counts_json) VALUES (?, ?, ?, ?, 'merged', ?)",
  ).run(
    sourceId,
    survivorId,
    runId,
    normalizedName,
    JSON.stringify(summary.movedReferences),
  );
  summary.completedMerges += 1;
}

const CATEGORY_TYPE_BY_DOCUMENT: Record<number, AccountTypeCode> = {
  [DocumentType.Expense]: AccountType.Expense,
  [DocumentType.Income]: AccountType.Revenue,
};

/**
 * Rewrites the category *names* still sitting on unfinished import-queue rows.
 *
 * A queued import carries the category the extractor read as a string, and
 * `matchCategoryAccount` resolves it by exact name with no fuzzy fallback. Rename
 * `Marketing` to `Advertising` and leave the queue alone, and every waiting row
 * that named it quietly lands on Uncategorised instead — the classification is
 * there, and it is thrown away by the upgrade rather than by anyone's decision.
 */
function rewriteImportCategories(
  db: Database,
  summary: AccountMigrationSummary,
): void {
  if (!tableExists(db, "import_queue")) return;
  const rows = db
    .query(
      "SELECT id, document_type, category FROM import_queue WHERE completed_at IS NULL AND category IS NOT NULL",
    )
    .all() as { id: string; document_type: number | null; category: string }[];
  for (const row of rows) {
    const normalized = normalizeAccountName(row.category);
    const candidates = ACCOUNT_ALIASES.filter(
      (alias) => normalizeAccountName(alias.from) === normalized,
    );
    // A row whose kind has not been read yet can only be rewritten when the name
    // means the same account whichever kind it turns out to be. `Other` does not.
    const alias =
      row.document_type === null
        ? candidates.length === 1
          ? candidates[0]
          : null
        : (candidates.find(
            (candidate) =>
              candidate.type === CATEGORY_TYPE_BY_DOCUMENT[row.document_type!],
          ) ?? null);
    const target = alias ? aliasTarget(alias) : null;
    if (!target || target.name === row.category) continue;
    db.query("UPDATE import_queue SET category = ? WHERE id = ?").run(
      target.name,
      row.id,
    );
    summary.rewrittenImportCategories += 1;
  }
}

function emptySummary(
  status: AccountMigrationSummary["status"],
): AccountMigrationSummary {
  return {
    version: CHART_MIGRATION_VERSION,
    status,
    mappedAccounts: 0,
    assignedCodes: 0,
    createdSeeds: 0,
    installedDefaults: 0,
    completedMerges: 0,
    retypedAccounts: 0,
    aliasRenames: 0,
    rewrittenImportCategories: 0,
    movedReferences: {},
    attentionItems: [],
  };
}

function mergeCounts(
  target: Record<string, number>,
  additions: Record<string, number>,
): void {
  for (const [table, count] of Object.entries(additions)) {
    target[table] = (target[table] ?? 0) + count;
  }
}

function validateCompleted(db: Database): void {
  const invalid = db
    .query(
      "SELECT count(*) AS n FROM accounts WHERE type IS NULL OR code IS NULL OR type < 1 OR type > 5 OR code < type * 1000 OR code > type * 1000 + 999",
    )
    .get() as { n: number };
  if (invalid.n !== 0) {
    throw new Error(
      "Completed chart migration has invalid account types or codes.",
    );
  }
  const duplicates = db
    .query(
      "SELECT count(*) AS n FROM (SELECT code FROM accounts GROUP BY code HAVING count(*) > 1)",
    )
    .get() as { n: number };
  if (duplicates.n !== 0) {
    throw new Error("Completed chart migration has duplicate account codes.");
  }
}

function invariantSnapshot(db: Database): Record<string, number> {
  const hasLedger = db
    .query(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ledger_movements'",
    )
    .get();
  if (!hasLedger) return {};
  const columns = db.query("PRAGMA table_info(ledger_movements)").all() as {
    name: string;
  }[];
  if (
    !columns.some((column) => column.name === "record_id") ||
    !columns.some((column) => column.name === "amount_minor")
  ) {
    return {};
  }
  return db
    .query(
      "SELECT count(DISTINCT record_id) AS recordCount, count(*) AS movementCount, coalesce(sum(amount_minor), 0) AS netMinor FROM ledger_movements",
    )
    .get() as Record<string, number>;
}

export function migrateAccountChart(db: Database): AccountMigrationSummary {
  const completed = db
    .query(
      "SELECT status FROM account_migration_runs WHERE version = ? AND status = 'completed'",
    )
    .get(CHART_MIGRATION_VERSION);
  if (completed) {
    validateCompleted(db);
    return emptySummary("already_completed");
  }

  return db.transaction(() => {
    const summary = emptySummary("completed");
    const beforeSnapshot = invariantSnapshot(db);
    const run = db
      .query(
        "INSERT INTO account_migration_runs(version, status) VALUES (?, 'running') RETURNING id",
      )
      .get(CHART_MIGRATION_VERSION) as { id: number };

    for (const row of accountRows(db)) {
      if (row.type !== null) continue;
      db.query("UPDATE accounts SET type = ? WHERE id = ?").run(
        accountTypeForLegacyRole(row.role),
        row.id,
      );
      summary.mappedAccounts += 1;
    }

    applyRetypes(db, summary);
    const aliasMerges = applyAliases(db, summary);

    // Exact same-type names receive their proposed seeded code first. The alias
    // pass above renamed legacy names onto seeded ones, so they qualify here.
    for (const seed of DEFAULT_CHART) {
      const match = matchingAccounts(db, seed.type, seed.name)[0] ?? null;
      if (!match || match.code !== null) continue;
      const occupied = db
        .query("SELECT id FROM accounts WHERE code = ?")
        .get(seed.code);
      const code = occupied
        ? lowestFreeAccountCode(seed.type, usedCodes(db))
        : seed.code;
      db.query("UPDATE accounts SET code = ? WHERE id = ?").run(code, match.id);
      summary.assignedCodes += 1;
    }

    // Everything else takes the lowest free code in its range — but never one the
    // default chart is about to claim. Without the reservation a legacy account
    // needing an asset code takes 1000 before the seeds are created, and `Cash`
    // is pushed off the canonical code every other installation gives it
    // (FR-058, FR-059).
    for (const row of accountRows(db)) {
      if (row.code !== null) continue;
      const type = row.type ?? accountTypeForLegacyRole(row.role);
      const reserved = DEFAULT_CHART.filter((seed) => seed.type === type).map(
        (seed) => seed.code,
      );
      const code = lowestFreeAccountCode(type, [...usedCodes(db), ...reserved]);
      db.query("UPDATE accounts SET code = ? WHERE id = ?").run(code, row.id);
      summary.assignedCodes += 1;
    }

    for (const [index, seed] of DEFAULT_CHART.entries()) {
      const sameName = matchingAccounts(db, seed.type, seed.name)[0] ?? null;
      if (sameName) continue;
      const code = db
        .query("SELECT id FROM accounts WHERE code = ?")
        .get(seed.code)
        ? lowestFreeAccountCode(seed.type, usedCodes(db))
        : seed.code;
      db.query(
        "INSERT INTO accounts(role, type, code, name, rank) VALUES (?, ?, ?, ?, ?)",
      ).run(
        compatibilityRole(seed.type),
        seed.type,
        code,
        seed.name,
        `seed-${String(index).padStart(3, "0")}`,
      );
      summary.createdSeeds += 1;
    }

    for (const [purposeText, code] of Object.entries(DEFAULT_CODE_BY_PURPOSE)) {
      const account = db
        .query("SELECT id FROM accounts WHERE code = ?")
        .get(code) as { id: number } | null;
      if (!account) {
        summary.attentionItems.push(
          `Default purpose ${purposeText} has no account at code ${code}.`,
        );
        continue;
      }
      const result = db
        .query(
          "INSERT OR IGNORE INTO account_defaults(purpose, account_id) VALUES (?, ?)",
        )
        .run(Number(purposeText), account.id);
      summary.installedDefaults += Number(result.changes);
    }

    // If a prior seed pass already left an exact duplicate, preserve the
    // non-seeded identity and retain the seeded row as a direct redirect.
    for (const seed of DEFAULT_CHART) {
      const matches = matchingAccounts(db, seed.type, seed.name) as {
        id: number;
        code: number;
      }[];
      if (matches.length !== 2) continue;
      const source = matches.find((row) => row.code === seed.code);
      const survivor = matches.find((row) => row.id !== source?.id);
      if (!source || !survivor) continue;
      const aliasCode = lowestFreeAccountCode(seed.type, usedCodes(db));
      db.query("UPDATE accounts SET code = ? WHERE id = ?").run(
        aliasCode,
        source.id,
      );
      db.query("UPDATE accounts SET code = ? WHERE id = ?").run(
        seed.code,
        survivor.id,
      );
      mergeInto(
        db,
        summary,
        run.id,
        source.id,
        survivor.id,
        normalizeAccountName(seed.name),
      );
    }

    // The alias merges queued before any code was assigned, run with the
    // **opposite** survivor rule to the pass above: there the two names were
    // already identical, so the row the user had made survives; here the alias
    // says the legacy name was the wrong name, so the seed-named row survives and
    // the legacy one is archived as a redirect to it.
    for (const merge of aliasMerges) {
      mergeInto(
        db,
        summary,
        run.id,
        merge.sourceId,
        merge.survivorId,
        normalizeAccountName(merge.name),
      );
    }

    rewriteImportCategories(db, summary);

    validateCompleted(db);
    const afterSnapshot = invariantSnapshot(db);
    if (JSON.stringify(afterSnapshot) !== JSON.stringify(beforeSnapshot)) {
      throw new Error("Account standardization changed ledger invariants.");
    }
    db.query(
      "UPDATE account_migration_runs SET status = 'completed', completed_at = datetime('now'), summary_json = ?, before_snapshot_json = ?, after_snapshot_json = ? WHERE id = ?",
    ).run(
      JSON.stringify(summary),
      JSON.stringify(beforeSnapshot),
      JSON.stringify(afterSnapshot),
      run.id,
    );
    return summary;
  })();
}
