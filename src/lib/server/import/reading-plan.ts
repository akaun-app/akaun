/**
 * How one queued document is read, worked out once before it is read (006).
 *
 * A plan says everything the reading needs to know, so nothing downstream
 * asks the same question again:
 *
 * - **receipt:** the standard reading, one record (FR-003, FR-004).
 * - **items:** "Multiple records", the built-in reading of several items.
 * - **profile:** a saved import profile, by its kind (`ProfileKind`): a table
 *   part read by code, an AI part, or both. The AI part is read in pieces in
 *   Every transaction mode (FR-043), and, beside a table, from the text with
 *   the table's rows cut out (FR-057).
 *
 * `needsAi` and `needsCells` are the only answers to "does this reading ask
 * the AI?" and "does it read a spreadsheet's cells?".
 */

import { eq } from "drizzle-orm";
import {
  kindReadsTable,
  kindUsesAi,
  profileKind,
  profileSections,
} from "$lib/import-profile-schema.js";
import {
  ImportMode,
  ImportReadHow,
  type ImportModeValue,
} from "$lib/import-reading.js";
import { importQueue } from "../db/schema.js";
import {
  inferMimeType,
  isSpreadsheetMimeType,
} from "../extraction/document-text.js";
import type { LedgerDb } from "../ledger/types.js";
import {
  deletedProfileName,
  getImportProfile,
} from "../services/import-profiles.js";
import {
  SEVERAL_ITEMS_PROFILE,
  savedReadingProfile,
  type ReadingProfile,
} from "./profile-compiler.js";
import {
  parseProfileSnapshot,
  profileSnapshotOf,
  serializeProfileSnapshot,
} from "./profile-snapshot.js";
import { columnsReadingId, type TableProfile } from "./table-reader.js";

type ImportJob = typeof importQueue.$inferSelect;

/** A reading of items: "Multiple records", or a saved profile. */
export interface ItemsPlan {
  kind: "items" | "profile";
  /** What the row's `profile_id` holds once it is read. */
  profileId: string;
  /** The saved profile's name; absent for the built-in reading. */
  profileName?: string;
  /**
   * Every section the reading makes items for, as one profile: the kinds,
   * categories and the control total are worked out once, over all of them.
   * A section read from the table is marked `fromTable`.
   */
  reading: ReadingProfile;
  /** The saved profile's import mode; null for the built-in reading. */
  mode: ImportModeValue | null;
  /** The table read by code, or null. */
  table: TableProfile | null;
  /** What the AI reads, and whether in pieces, or null. */
  ai: { reading: ReadingProfile; pieces: boolean } | null;
}

export type ReadingPlan = { kind: "receipt" } | ItemsPlan;

export const RECEIPT_PLAN: ReadingPlan = { kind: "receipt" };

/** Whether the reading asks the AI, and so needs a provider. */
export function needsAi(plan: ReadingPlan): boolean {
  return plan.kind === "receipt" || plan.ai !== null;
}

/** Whether the reading reads a spreadsheet's cells. */
export function needsCells(plan: ReadingPlan): boolean {
  return plan.kind !== "receipt" && plan.table !== null;
}

/** "Multiple records": the built-in reading, by the AI in one call. */
export function builtinItemsPlan(): ItemsPlan {
  return {
    kind: "items",
    profileId: SEVERAL_ITEMS_PROFILE.schemaId,
    reading: SEVERAL_ITEMS_PROFILE,
    mode: null,
    table: null,
    ai: { reading: SEVERAL_ITEMS_PROFILE, pieces: false },
  };
}

/** Whether the job's file is an Excel workbook or a CSV file (FR-050). */
export function isSpreadsheetJob(
  job: Pick<ImportJob, "originalFilename">,
): boolean {
  return isSpreadsheetMimeType(inferMimeType(job.originalFilename));
}

/**
 * Whether the job's cells can be read: a spreadsheet whose text was not
 * given with the upload. Text given in its place has no cells to go by.
 */
export function readsCells(
  job: Pick<ImportJob, "originalFilename" | "preExtractedText">,
): boolean {
  return isSpreadsheetJob(job) && !job.preExtractedText?.trim();
}

/**
 * The plan for reading a job with a saved profile, chosen at upload or found
 * by Auto-detect, or why it cannot be read (spec edge cases). A profile
 * disabled or deleted after the upload is not used, and the message names it.
 *
 * On success the profile is copied onto the row with its mode and how it was
 * picked, before any reading starts, so every screen can say which profile
 * reads the document from the first update on (FR-041), and an edit made
 * while it is read, or later, never changes the group (FR-038).
 */
export function planForProfile(
  db: LedgerDb,
  job: ImportJob,
  id: number | null,
  how: "chosen" | "detected",
): { ok: true; plan: ItemsPlan } | { ok: false; reason: string } {
  if (id === null) {
    return {
      ok: false,
      reason:
        "This document was to be read with an import profile, but no profile is named. Upload it again and choose how to read it.",
    };
  }
  const saved = getImportProfile(db, id);
  if (!saved) {
    const name =
      parseProfileSnapshot(job.profileSnapshot)?.name ??
      deletedProfileName(db, id);
    const named = name ? `"${name}"` : `#${id}`;
    return {
      ok: false,
      reason: `The import profile ${named} ${how} for this document was deleted before it was read. Upload it again and choose another way to read it.`,
    };
  }
  if (!saved.enabled) {
    return {
      ok: false,
      reason: `The import profile "${saved.name}" ${how} for this document was disabled before it was read. Turn it on again, or upload the document again and choose another way to read it.`,
    };
  }

  // The profile's own mode (FR-002, FR-032). The row stores it, so every
  // screen says it. Every profile saved has a section in its own mode; one
  // with none is a damaged row, and is named rather than read as nothing.
  const { mode } = saved;
  const sections = profileSections(saved);
  if (sections.length === 0) {
    return {
      ok: false,
      reason: `The import profile "${saved.name}" has no section to read, so nothing was read. Open it in Settings and add a section.`,
    };
  }

  const kind = profileKind(saved);
  // A profile that reads a table by code reads a spreadsheet's cells, and
  // nothing else: a PDF or a photo has none, and reading it without those
  // sections would import part of the document as if it were all of it.
  const table = kindReadsTable(kind) && saved.layout ? saved.layout : null;
  if (table && !readsCells(job)) {
    return {
      ok: false,
      reason: isSpreadsheetJob(job)
        ? `The import profile "${saved.name}" reads a spreadsheet's table from its cells, but this spreadsheet was given as text, which has none. Upload the file itself.`
        : `The import profile "${saved.name}" reads a spreadsheet's table, and this file is not a spreadsheet (.xlsx or .csv). Read it with a profile made for it.`,
    };
  }

  const full = savedReadingProfile(saved);
  // A table's copy names what was read, the layout and the sections, not a
  // schema the AI was never sent; the sections the AI reads are among them.
  const schemaId = table ? columnsReadingId(saved) : full.schemaId;
  const aiSections = table ? sections.filter((section) => !section.rows) : [];
  const aiReading = !kindUsesAi(kind)
    ? null
    : table
      ? aiSections.length > 0
        ? savedReadingProfile(saved, "ai")
        : null
      : full;

  db.update(importQueue)
    .set({
      profileId: String(saved.id),
      importMode: mode,
      readHow:
        how === "detected" ? ImportReadHow.Detected : ImportReadHow.Chosen,
      profileSnapshot: serializeProfileSnapshot(
        profileSnapshotOf(saved, schemaId),
      ),
    })
    .where(eq(importQueue.id, job.id))
    .run();

  return {
    ok: true,
    plan: {
      kind: "profile",
      profileId: String(saved.id),
      profileName: saved.name,
      reading: { ...full, schemaId },
      mode,
      table: table
        ? { name: saved.name, mode, layout: table, sections: saved.sections }
        : null,
      ai: aiReading
        ? {
            reading: aiReading,
            pieces: mode === ImportMode.EveryTransaction,
          }
        : null,
    },
  };
}
