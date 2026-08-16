import { eq, isNotNull } from "drizzle-orm";
import { ledgerRecords, recordAttachments } from "../../db/schema.js";
import {
  copyVerified,
  recordAttachmentPath,
  removeVerifiedOriginals,
} from "../../file-storage.js";
import { createLogger } from "../../logger.js";
import type { LedgerDb, UpgradeReport } from "../types.js";

const log = createLogger("ledger-upgrade");

/**
 * Moving attachment files into the one layout every record shares,
 * `records/YYYY/MM/` (FR-032b, D-16).
 *
 * By copying, never renaming. A moved file cannot be put back by undoing a
 * database change, and a rename that half-runs leaves the file in neither
 * place with no second copy to recover from. So: copy, prove the copy is
 * byte-identical, rewrite the path, and leave the original exactly where it is.
 * Originals are removed only by `removeOriginals` below, which the orchestration
 * calls at the very end — after the whole upgrade has verified (FR-038).
 *
 * A file already at its destination is skipped, which is what makes this
 * resumable after an interruption and safe to re-run (FR-037). A file that
 * cannot be found is reported and left pointing where it was, rather than
 * failing the whole upgrade or silently losing the attachment.
 */

export function moveAttachments(
  db: LedgerDb,
  report: UpgradeReport,
  storageRoot?: string,
): void {
  const rows = db
    .select({
      id: recordAttachments.id,
      filename: recordAttachments.filename,
      legacyFilename: recordAttachments.legacyFilename,
      date: ledgerRecords.date,
    })
    .from(recordAttachments)
    .innerJoin(ledgerRecords, eq(ledgerRecords.id, recordAttachments.recordId))
    .where(isNotNull(recordAttachments.legacyFilename))
    .all();

  let moved = 0;
  let skipped = 0;

  for (const row of rows) {
    const from = row.legacyFilename!;
    const to = recordAttachmentPath(from, row.date);

    // Already where it belongs — a previous run got this far.
    if (row.filename === to && from !== to) {
      skipped += 1;
      continue;
    }

    const outcome = copyVerified(from, to, storageRoot);

    if (outcome.status === "source-missing") {
      // Left pointing where it was, so the row still names the file someone can
      // go looking for. Reported rather than fatal (FR-032b).
      report.missingAttachments.push(from);
      continue;
    }

    if (outcome.status === "mismatch") {
      // Something already sits at the destination and is NOT this file. Leaving
      // the row alone is the only safe move: overwriting would destroy whatever
      // is there, and repointing would attach the wrong document to a record.
      report.missingAttachments.push(from);
      log.warn(
        { from, to },
        "Attachment already exists at its destination with different contents; left where it was",
      );
      continue;
    }

    db.update(recordAttachments)
      .set({ filename: to })
      .where(eq(recordAttachments.id, row.id))
      .run();

    if (outcome.status === "copied") moved += 1;
    else skipped += 1;
  }

  log.info(
    { moved, skipped, missing: report.missingAttachments.length },
    "Attachment files moved",
  );
}

/**
 * Deletes the originals of files already proven identical at their destination.
 *
 * Deferred to the very end of the upgrade, after verification passes, so an
 * interrupted or failed run leaves every original where it was and the whole
 * thing can simply be run again (FR-038, SC-014).
 */
export function removeOriginals(
  db: LedgerDb,
  storageRoot?: string,
): {
  removed: number;
  kept: string[];
} {
  const pairs = db
    .select({
      from: recordAttachments.legacyFilename,
      to: recordAttachments.filename,
    })
    .from(recordAttachments)
    .where(isNotNull(recordAttachments.legacyFilename))
    .all()
    .filter(
      (r): r is { from: string; to: string } =>
        r.from !== null && r.from !== r.to,
    );

  const result = removeVerifiedOriginals(pairs, storageRoot);
  log.info(
    { removed: result.removed, kept: result.kept.length },
    "Original attachment files removed",
  );
  return result;
}
