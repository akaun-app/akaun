import { z } from "zod";
import {
  readingModeFor,
  type ImportProfileDraft,
} from "$lib/import-profile-schema.js";
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

/** The "Import" choices an upload may name (FR-002). */
const uploadImportMode = z.enum([
  ImportMode.Summary,
  ImportMode.EveryTransaction,
]);

/**
 * What the upload needs to know of a saved profile to accept it, and its
 * sections, which say the mode it is read in (FR-002). Without them the mode
 * the uploader chose is kept, and the reading decides.
 */
export type UploadProfile = {
  name: string;
  enabled: boolean;
  sections?: ImportProfileDraft["sections"];
};

export type UploadReading =
  | {
      ok: true;
      readAs: ImportReadAsValue;
      readHow: ImportReadHowValue;
      /** The saved profile's id, as `profile_id` stores it; else null. */
      profileId: string | null;
      /**
       * The import mode, for a profile or for Auto-detect, which may find
       * one; else null, since a receipt or several items has no mode.
       */
      importMode: ImportModeValue | null;
    }
  | { ok: false; error: string };

const CHOICES = `${builtInReadAs.options.join(", ")}, or ${PROFILE_READ_AS_PREFIX}<id> for an enabled import profile`;
const MODE_CHOICES = uploadImportMode.options.join(" or ");

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
 * The "Import" field (FR-002) says which part of a statement is read:
 * Summary or Every transaction. One that is missing or empty is Summary, the
 * default; one the system does not know is refused like an unknown "Read
 * as", whatever "Read as" says, so a mistyped mode never goes unnoticed. The
 * mode is stored for a profile and for Auto-detect, which may find a profile.
 * A chosen profile with sections in one mode only is stored with that mode,
 * whatever the field says, since it has nothing to read in the other; only a
 * profile with sections in both is stored with the mode chosen. Auto-detect
 * keeps the mode chosen, and the reading applies the same rule to the profile
 * it finds. A receipt or several items has no mode, so the field is ignored
 * for them and none is stored.
 *
 * An Auto-detect row says Standard from the start. The worker changes that to
 * Detected when it finds a profile that fits (006 US9); with no enabled
 * profile there is no detection step at all (FR-003).
 */
export function readingForUpload(
  raw: FormDataEntryValue | null,
  rawMode: FormDataEntryValue | null | undefined,
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

  const modeValue =
    rawMode === null || rawMode === undefined || rawMode === ""
      ? ImportMode.Summary
      : rawMode;
  const mode = uploadImportMode.safeParse(modeValue);
  if (!mode.success) {
    const shown = typeof modeValue === "string" ? `"${modeValue}"` : "a file";
    return {
      ok: false,
      error: `Unknown import mode: ${shown}. Use ${MODE_CHOICES}.`,
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
      importMode: profile.sections
        ? readingModeFor({ sections: profile.sections }, mode.data)
        : mode.data,
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
    importMode: readAs === ImportReadAs.Auto ? mode.data : null,
  };
}
