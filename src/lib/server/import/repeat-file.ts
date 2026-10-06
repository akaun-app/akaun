/**
 * Whether the identical file was already imported, and how (006 FR-026,
 * FR-033, FR-064).
 *
 * One file is imported one way only: a statement's summary and its
 * transaction table describe the same money, and so do a receipt and the
 * items read off it. Two places ask:
 *
 * - **Before reading** (`alreadyImported`, FR-026): an upload
 *   read as several items or with a profile is stopped before any AI call
 *   when another upload of the same file already made a record.
 * - **At confirm** (`alreadyImportedAtConfirm`, FR-064): two copies uploaded
 *   before either made a record both pass the first stop. The confirm of the
 *   second is refused here, inside the transaction that would write its
 *   record, so two confirms that arrive together cannot both pass.
 *
 * A document read the standard way (a receipt) is never stopped by either,
 * as before 006 (FR-004).
 */

import { and, eq, ne } from "drizzle-orm";
import { ImportState } from "$lib/enums.js";
import {
  ImportReadAs,
  ImportReadHow,
  importModeLabel,
} from "$lib/import-reading.js";
import { importItems, importQueue } from "../db/schema.js";
import type { LedgerDb } from "../ledger/types.js";
import { parseProfileSnapshot } from "./profile-snapshot.js";

type QueueRow = typeof importQueue.$inferSelect;

/** The columns that say how a job was read. */
type HowRead = Pick<QueueRow, "readAs" | "readHow" | "profileSnapshot">;

/** "as a receipt or invoice", in the words the upload screen uses. */
function howItWasRead(row: HowRead): string {
  if (row.readAs === ImportReadAs.SeveralItems) {
    return "as a document with several items";
  }
  // A profile chosen at upload, or one Auto-detect found.
  if (
    row.readAs === ImportReadAs.Profile ||
    row.readHow === ImportReadHow.Detected
  ) {
    // The copy kept on the row names the profile even after it is renamed
    // or deleted, and says which mode it was imported in (FR-033).
    const snapshot = parseProfileSnapshot(row.profileSnapshot);
    return snapshot
      ? `with the import profile "${snapshot.name}" (${importModeLabel(snapshot.mode)})`
      : "with an import profile";
  }
  return "as a receipt or invoice";
}

function records(count: number): string {
  return count === 1 ? "1 record" : `${count} records`;
}

/**
 * Whether a job is read as several items or with a profile, chosen or
 * detected: the readings these stops apply to. A receipt, chosen or the
 * Auto-detect fallback, is not.
 */
export function readsAsItems(row: Pick<QueueRow, "readAs" | "readHow">) {
  return (
    row.readAs === ImportReadAs.SeveralItems ||
    row.readAs === ImportReadAs.Profile ||
    row.readHow === ImportReadHow.Detected
  );
}

/**
 * The earliest other upload of this file that made at least one record, how
 * it was read, and how many records it made; null when there is none.
 *
 * An earlier upload whose items were all skipped or discarded made nothing,
 * so it does not count. The imported items are counted first: a finished
 * group is itself marked Imported, and it made one record per item, not one.
 * A row with no items is a receipt, which made one record when it was
 * imported.
 */
function earlierImport(
  db: LedgerDb,
  job: Pick<QueueRow, "id" | "fileHash">,
): { how: string; made: number } | null {
  if (!job.fileHash) return null;
  const others = db
    .select({
      id: importQueue.id,
      state: importQueue.state,
      readAs: importQueue.readAs,
      readHow: importQueue.readHow,
      profileSnapshot: importQueue.profileSnapshot,
      createdAt: importQueue.createdAt,
    })
    .from(importQueue)
    .where(
      and(eq(importQueue.fileHash, job.fileHash), ne(importQueue.id, job.id)),
    )
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const row of others) {
    const importedItems = db
      .select({ id: importItems.id })
      .from(importItems)
      .where(
        and(
          eq(importItems.jobId, row.id),
          eq(importItems.state, ImportState.Imported),
        ),
      )
      .all().length;
    const made =
      importedItems > 0
        ? importedItems
        : row.state === ImportState.Imported
          ? 1
          : 0;
    if (made > 0) return { how: howItWasRead(row), made };
  }
  return null;
}

/**
 * Why this file must not be read, or null when it may be (FR-026). Asked
 * only for a reading of items or with a profile, before the file is read, so
 * a stopped upload costs no AI call.
 */
export function alreadyImported(
  db: LedgerDb,
  job: Pick<QueueRow, "id" | "fileHash">,
): string | null {
  const earlier = earlierImport(db, job);
  return earlier
    ? `This file was already imported ${earlier.how}, which made ${records(earlier.made)}. It was not read again.`
    : null;
}

/**
 * Why nothing may be confirmed from this job, or null when it may (FR-064).
 *
 * Asked inside the confirm's transaction, for a receipt card and for an item
 * alike: the job's own row says how it was read. A job read the standard way
 * is never refused here, so a receipt confirms exactly as before (FR-004).
 * A job that is gone gives null; the confirm's own claim refuses it.
 */
export function alreadyImportedAtConfirm(
  db: LedgerDb,
  jobId: string,
): string | null {
  const job = db
    .select({
      id: importQueue.id,
      fileHash: importQueue.fileHash,
      readAs: importQueue.readAs,
      readHow: importQueue.readHow,
    })
    .from(importQueue)
    .where(eq(importQueue.id, jobId))
    .get();
  if (!job || !readsAsItems(job)) return null;
  const earlier = earlierImport(db, job);
  return earlier
    ? `This file was already imported ${earlier.how}, which made ${records(earlier.made)}. One file is imported one way only, so nothing was imported from this copy.`
    : null;
}
