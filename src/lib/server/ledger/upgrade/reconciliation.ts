import { and, eq, isNull, sql } from "drizzle-orm";
import {
  bankStatements,
  ledgerMovements,
  ledgerRecords,
  reconciliationAllocations,
} from "../../db/schema.js";
import { ReconItemType } from "$lib/enums.js";
import { createLogger } from "../../logger.js";
import type { LedgerDb, LegacyKind, UpgradeReport } from "../types.js";
import type { SeededAccounts } from "./accounts.js";

const log = createLogger("ledger-upgrade");

/**
 * Repointing every existing bank match, and giving every existing statement an
 * account (FR-034, FR-034a, D-11).
 *
 * An allocation used to name a record polymorphically — an expense, an income
 * or a claim. It now names the ledger movement that actually touched the bank,
 * because that is what a bank line can be matched to. For a claim, that is the
 * bank movement of the payment it became.
 *
 * The two old columns are left exactly as they were, unread, for one release,
 * so the repointing stays inspectable against what it came from (D-17). This is
 * the one part of the upgrade the user is least able to reconstruct by hand.
 */

/** Every allocation's bank movement, found through the record it named. */
function bankMovementByLegacy(
  db: LedgerDb,
  bankAccountId: number,
  legacyKind: LegacyKind,
): Map<number, number> {
  const rows = db
    .select({
      legacyId: ledgerRecords.legacyId,
      movementId: ledgerMovements.id,
    })
    .from(ledgerRecords)
    .innerJoin(ledgerMovements, eq(ledgerMovements.recordId, ledgerRecords.id))
    .where(
      and(
        eq(ledgerRecords.legacyKind, legacyKind),
        eq(ledgerMovements.accountId, bankAccountId),
      ),
    )
    .all();

  return new Map(
    rows
      .filter(
        (r): r is { legacyId: number; movementId: number } =>
          r.legacyId !== null,
      )
      .map((r) => [r.legacyId, r.movementId]),
  );
}

export function backfillReconciliation(
  db: LedgerDb,
  seeded: SeededAccounts,
  report: UpgradeReport,
): void {
  // Every statement imported before the upgrade belongs to the default bank
  // account — that is what today's one-sided model already assumed. The user can
  // reassign it afterwards (FR-034a).
  const assigned = db
    .update(bankStatements)
    .set({ accountId: seeded.defaultAccountId })
    .where(isNull(bankStatements.accountId))
    .returning({ id: bankStatements.id })
    .all();

  const byKind: Record<number, Map<number, number>> = {
    [ReconItemType.Expense]: bankMovementByLegacy(
      db,
      seeded.defaultAccountId,
      "expense",
    ),
    [ReconItemType.Income]: bankMovementByLegacy(
      db,
      seeded.defaultAccountId,
      "income",
    ),
    // A claim became a payment; its bank movement is the payment's.
    [ReconItemType.Claim]: bankMovementByLegacy(
      db,
      seeded.defaultAccountId,
      "claim",
    ),
  };

  const pending = db
    .select({
      id: reconciliationAllocations.id,
      itemType: reconciliationAllocations.itemType,
      itemId: reconciliationAllocations.itemId,
    })
    .from(reconciliationAllocations)
    .where(isNull(reconciliationAllocations.movementId))
    .all();

  let repointed = 0;

  for (const row of pending) {
    if (row.itemType === null || row.itemId === null) {
      // Written after the upgrade with no legacy columns and somehow no
      // movement either — nothing to repoint it from.
      report.unrepointedAllocationIds.push(row.id);
      continue;
    }

    const movementId = byKind[row.itemType]?.get(row.itemId);
    if (movementId === undefined) {
      // The record it named has no bank movement — an expense somebody else
      // paid, for instance, which never touched the bank. Reported rather than
      // guessed at, since a wrong bank match is worse than a missing one.
      report.unrepointedAllocationIds.push(row.id);
      continue;
    }

    db.update(reconciliationAllocations)
      .set({ movementId })
      .where(eq(reconciliationAllocations.id, row.id))
      .run();
    repointed += 1;
  }

  log.info(
    {
      statementsAssigned: assigned.length,
      allocationsRepointed: repointed,
      allocationsUnrepointed: report.unrepointedAllocationIds.length,
    },
    "Reconciliation backfilled",
  );
}

/** How many allocations still have no movement — the orchestration reports this. */
export function unrepointedCount(db: LedgerDb): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(reconciliationAllocations)
      .where(isNull(reconciliationAllocations.movementId))
      .get()?.n ?? 0
  );
}

/** Statements still without an account — should be none after a full run. */
export function unassignedStatementCount(db: LedgerDb): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(bankStatements)
      .where(isNull(bankStatements.accountId))
      .get()?.n ?? 0
  );
}
