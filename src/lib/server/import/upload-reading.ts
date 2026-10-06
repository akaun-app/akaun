import { z } from "zod";
import {
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

/**
 * What the upload needs to know of a saved profile: whether to accept it, and
 * the import mode it is read in, which is its own (FR-002).
 */
export type UploadProfile = {
  name: string;
  enabled: boolean;
  mode: ImportModeValue;
};

export type UploadReading =
  | {
      ok: true;
      readAs: ImportReadAsValue;
      readHow: ImportReadHowValue;
      /** The saved profile's id, as `profile_id` stores it; else null. */
      profileId: string | null;
      /**
       * The chosen profile's import mode; else null. Auto-detect stores the
       * mode of the profile it finds once it finds one, and a receipt or
       * several items has no mode.
       */
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
 * There is no "Import" choice (FR-002): a profile is read in its own import
 * mode, Summary lines or Every transaction, and a chosen profile's mode is
 * stored with the row. An upload from a screen opened before the choice was
 * removed may still send an `importMode` field; the caller does not read it.
 *
 * An Auto-detect row says Standard from the start. The worker changes that to
 * Detected when it finds a profile that fits (006 US9); with no enabled
 * profile there is no detection step at all (FR-003).
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
      importMode: profile.mode,
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
