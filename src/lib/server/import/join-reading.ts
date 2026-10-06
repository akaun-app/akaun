/**
 * The parts of one reading made into its items (006 FR-055, FR-057): a table
 * read by code, what the AI read, or both. Whichever parts a plan has, the
 * kinds, signs, categories and control total are worked out once, by the
 * same code (`readingFromEnvelope`), over every section.
 *
 * The method the notes record keeps the values rows have always stored, so a
 * reading from before reads the same: "columns", "columns_ai", "ai_pieces",
 * "ai" (Every transaction in one call), or none (Summary in one call).
 */

import { ImportMode, type ImportModeValue } from "$lib/import-reading.js";
import {
  readingFromEnvelope,
  type DocumentReading,
} from "./document-reader.js";
import { piecesIgnoredCount } from "./piece-reader.js";
import type { ReadingProfile } from "./profile-compiler.js";
import {
  readingFromTable,
  type AiPart,
  type TableProfile,
  type TableReading,
} from "./table-reader.js";

export interface ReadParts {
  /** The table read by code, with the profile it was read with. */
  table: { reading: TableReading; profile: TableProfile } | null;
  /** What the AI read. */
  ai: AiPart | null;
}

/**
 * The items of a reading. `reading` is every section the plan makes items
 * for; `mode` is the saved profile's, or null for the built-in reading.
 */
export function joinParts(
  parts: ReadParts,
  reading: ReadingProfile,
  mode: ImportModeValue | null,
  context: { today: string; mainCurrency: string; schemaId: string },
): DocumentReading {
  if (parts.table) {
    return readingFromTable(
      parts.table.reading,
      parts.table.profile,
      reading,
      context,
      parts.ai,
    );
  }
  const ai = parts.ai;
  if (!ai) throw new Error("A reading has neither a table nor an AI part.");
  const result = readingFromEnvelope(ai.envelope, reading, context);
  if (ai.method === "ai_pieces") {
    result.notes.ignoredCount = piecesIgnoredCount(
      ai.envelope,
      result.items.length,
    );
    result.notes.method = "ai_pieces";
  } else if (mode === ImportMode.EveryTransaction) {
    // Read by the AI in one call, so the reference check of FR-063 applies
    // to it as it does to a reading in pieces.
    result.notes.method = "ai";
  }
  return result;
}
