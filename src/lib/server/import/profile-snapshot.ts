/**
 * The copy of an import profile kept on a queue row that was read with it
 * (`import_queue.profile_snapshot`, 006 FR-038).
 *
 * A profile can be edited, disabled or deleted after a document was read with
 * it. The group must not change when that happens, and the screens must still
 * be able to say which profile read it (FR-041) and name its sections, so the
 * row keeps the profile as it was. The copy is the form the user filled in,
 * which is what the schema sent was built from, plus the id of that schema:
 * the schema id carries a hash of the schema, so it says exactly what the
 * model was asked for even after the compiler changes.
 *
 * Only the server reads the column. A screen gets the parts it shows (the
 * name, the mode, the section names) from the job event or the page's loader.
 */

import type {
  ImportProfileDraft,
  ProfileSectionKind,
} from "$lib/import-profile-schema.js";
import {
  ImportMode,
  isImportMode,
  type ImportModeValue,
} from "$lib/import-reading.js";

export interface ProfileSnapshot {
  version: 1;
  /** The saved profile's id. It may no longer exist. */
  id: number;
  name: string;
  /**
   * The import mode the document was read in: the profile's own (FR-032).
   * On a copy from when each section had its own mode, the mode chosen then.
   */
  mode: ImportModeValue;
  /**
   * The id of the schema that was sent (`profile:<id>:<hash>`). Empty while
   * the document waits to be read: the copy taken at upload only names the
   * profile, and reading replaces it with the profile as it is read.
   */
  schemaId: string;
  /** The profile's form, as it was. */
  profile: SnapshotProfile;
}

/**
 * A profile's form as a copy keeps it. A copy taken before the mode was set
 * on the profile has none there, and its sections may each carry one; it
 * still reads (FR-038).
 */
export type SnapshotProfile = Omit<ImportProfileDraft, "mode"> & {
  mode?: ImportModeValue;
};

/** A saved profile, as much of it as a copy keeps. */
type SnapshotSource = ImportProfileDraft & { id: number };

/**
 * The copy of a profile for a queue row. Taken twice: at upload, with no
 * schema id, so a document that waits or fails can still say which profile it
 * was to be read with, and a profile deleted before it is read can be named
 * (FR-041, spec edge case); and again when it is read, with the schema sent,
 * which is the copy the group keeps (FR-038).
 */
export function profileSnapshotOf(
  saved: SnapshotSource,
  schemaId = "",
): ProfileSnapshot {
  return {
    version: 1,
    id: saved.id,
    name: saved.name,
    mode: saved.mode,
    schemaId,
    profile: {
      name: saved.name,
      description: saved.description,
      phrases: saved.phrases,
      instructions: saved.instructions,
      mode: saved.mode,
      statedTotalLabels: saved.statedTotalLabels,
      accountId: saved.accountId ?? null,
      ...(saved.layout ? { layout: saved.layout } : {}),
      sections: saved.sections,
    },
  };
}

export function serializeProfileSnapshot(snapshot: ProfileSnapshot): string {
  return JSON.stringify(snapshot);
}

/**
 * Reads the column back. Anything that is not a snapshot gives null, so a
 * damaged value shows no profile rather than a wrong one.
 */
export function parseProfileSnapshot(
  stored: string | null | undefined,
): ProfileSnapshot | null {
  if (!stored) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const profile = value.profile as Record<string, unknown> | null;
  if (
    value.version !== 1 ||
    typeof value.id !== "number" ||
    typeof value.name !== "string" ||
    typeof value.schemaId !== "string" ||
    !isImportMode(value.mode) ||
    !profile ||
    typeof profile !== "object" ||
    !Array.isArray(profile.sections)
  ) {
    return null;
  }
  return value as unknown as ProfileSnapshot;
}

/** A section as the group's page names it, for its section filter (FR-017). */
export interface SnapshotSection {
  key: string;
  name: string;
  kind: ProfileSectionKind;
}

/**
 * The sections the document was read with, in profile order: those of the
 * mode it was read in. A section with no mode of its own follows the
 * profile's, except on a copy from before the profile had a mode, where it
 * was a Summary section (FR-038: an old reading names what it named then).
 */
export function snapshotSections(snapshot: ProfileSnapshot): SnapshotSection[] {
  const noModeMeans = isImportMode(snapshot.profile.mode)
    ? snapshot.mode
    : ImportMode.Summary;
  return snapshot.profile.sections
    .filter((section) => (section.mode ?? noModeMeans) === snapshot.mode)
    .map(({ key, name, kind }) => ({ key, name, kind }));
}
