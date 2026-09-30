import { z } from "zod";
import {
  ImportReadAs,
  ImportReadHow,
  type ImportReadAsValue,
  type ImportReadHowValue,
} from "$lib/import-reading.js";

/**
 * The "Read as" choices an upload may name today. A saved profile is not one
 * yet: profiles arrive with 006 S2, and until then naming one is refused like
 * any other unknown word rather than read some other way.
 */
const uploadReadAs = z.enum([
  ImportReadAs.Auto,
  ImportReadAs.Receipt,
  ImportReadAs.SeveralItems,
]);

export type UploadReading =
  | { ok: true; readAs: ImportReadAsValue; readHow: ImportReadHowValue }
  | { ok: false; error: string };

/**
 * Reads the upload's "Read as" field (FR-001). An upload that names no choice,
 * such as one sent by an automated tool, is read as Auto-detect. A choice the
 * system does not know is refused with the choices it does know, and the
 * caller then stores nothing.
 *
 * Auto-detect with no enabled profile is the standard reading, with no extra
 * step (FR-003). No profile can exist yet, so that is always the case here,
 * and the row says so from the start. Once profiles exist the worker decides.
 */
export function readingForUpload(
  raw: FormDataEntryValue | null,
): UploadReading {
  const value = raw === null || raw === "" ? ImportReadAs.Auto : raw;
  const parsed = uploadReadAs.safeParse(value);
  if (!parsed.success) {
    const shown = typeof value === "string" ? `"${value}"` : "a file";
    return {
      ok: false,
      error: `Unknown way to read this document: ${shown}. Use one of: ${uploadReadAs.options.join(", ")}.`,
    };
  }
  const readAs = parsed.data;
  return {
    ok: true,
    readAs,
    readHow:
      readAs === ImportReadAs.Auto
        ? ImportReadHow.Standard
        : ImportReadHow.Chosen,
  };
}
