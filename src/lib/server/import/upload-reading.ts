import { z } from "zod";
import {
  ImportMode,
  ImportReadAs,
  ImportReadHow,
  PROFILE_READ_AS_PREFIX,
  type ImportModeValue,
  type ImportReadAsValue,
  type ImportReadHowValue,
} from "$lib/import-reading.js";

/** The built-in "Read as" choices an upload may name. */
const builtInReadAs = z.enum([
  ImportReadAs.Auto,
  ImportReadAs.Receipt,
  ImportReadAs.SeveralItems,
]);

/**
 * A saved profile, named as `profile:<id>` (006 S2, FR-001). The id is a whole
 * number with no leading zero, short enough to be an exact number, so one
 * profile has exactly one way to be named.
 */
const profileReadAs = z
  .string()
  .regex(new RegExp(`^${PROFILE_READ_AS_PREFIX}([1-9][0-9]{0,14})$`))
  .transform((value) => Number(value.slice(PROFILE_READ_AS_PREFIX.length)));

const uploadReadAs = z.union([builtInReadAs, profileReadAs]);

/** What the upload needs to know of a saved profile to accept it. */
export type UploadProfile = { name: string; enabled: boolean };

export type UploadReading =
  | {
      ok: true;
      readAs: ImportReadAsValue;
      readHow: ImportReadHowValue;
      /** The saved profile's id, as `profile_id` stores it; else null. */
      profileId: string | null;
      /** The import mode, for a profile; else null. */
      importMode: ImportModeValue | null;
    }
  | { ok: false; error: string };

const CHOICES = `${builtInReadAs.options.join(", ")}, or ${PROFILE_READ_AS_PREFIX}<id> for an enabled import profile`;

/**
 * Reads the upload's "Read as" field (FR-001). An upload that names no choice,
 * such as one sent by an automated tool, is read as Auto-detect. A choice the
 * system does not know is refused with the choices it does know, and the
 * caller then stores nothing (US1 AS10).
 *
 * A saved profile is accepted only while it exists and is enabled, which is
 * what `findProfile` answers; a disabled or deleted one is not offered under
 * "Read as" (US6 AS12) and is refused by name here (a deleted one by the name
 * `deletedName` finds for it), so an old remembered
 * choice or a tool that names it gets a clear reason instead of a document
 * that fails later. The profile is checked again when the document is read,
 * since it can be turned off while the document waits.
 *
 * Every profile reading is Summary for now (FR-002 and US8 are deferred by the
 * maintainer), so the row stores Summary as its mode. This is the extension
 * point: when Every transaction arrives, the upload sends a mode and it is
 * read here.
 *
 * Auto-detect is the standard reading for now, with no extra step (FR-003).
 * Detecting a profile is 006 S3; until then the row says Standard from the
 * start.
 */
export function readingForUpload(
  raw: FormDataEntryValue | null,
  findProfile: (id: number) => UploadProfile | null,
  /** The name a deleted profile had, when it is known (spec edge case). */
  deletedName: (id: number) => string | null = () => null,
): UploadReading {
  const value = raw === null || raw === "" ? ImportReadAs.Auto : raw;
  const parsed = uploadReadAs.safeParse(value);
  if (!parsed.success) {
    const shown = typeof value === "string" ? `"${value}"` : "a file";
    return {
      ok: false,
      error: `Unknown way to read this document: ${shown}. Use one of: ${CHOICES}.`,
    };
  }

  if (typeof parsed.data === "number") {
    const id = parsed.data;
    const profile = findProfile(id);
    if (!profile) {
      // A deleted profile is named, as the spec's edge case asks; an id that
      // never named one (or whose delete left no name) is given by number.
      const name = deletedName(id);
      return {
        ok: false,
        error: name
          ? `The import profile "${name}" was deleted. Choose another way to read this document.`
          : `No import profile has the id ${id}; it may have been deleted. Choose another way to read this document.`,
      };
    }
    if (!profile.enabled) {
      return {
        ok: false,
        error: `The import profile "${profile.name}" is turned off. Turn it on in Settings, or choose another way to read this document.`,
      };
    }
    return {
      ok: true,
      readAs: ImportReadAs.Profile,
      readHow: ImportReadHow.Chosen,
      profileId: String(id),
      importMode: ImportMode.Summary,
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
    profileId: null,
    importMode: null,
  };
}
