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
  /** The import mode the document was read in. */
  mode: ImportModeValue;
  /** The id of the schema that was sent (`profile:<id>:<hash>`). */
  schemaId: string;
  /** The profile's form, as it was. */
  profile: ImportProfileDraft;
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

/** The sections of the mode the document was read in, in profile order. */
export function snapshotSections(snapshot: ProfileSnapshot): SnapshotSection[] {
  return (
    snapshot.profile.sections
      // A section saved with no mode is a Summary one, as the compiler reads it.
      .filter(
        (section) => (section.mode ?? ImportMode.Summary) === snapshot.mode,
      )
      .map(({ key, name, kind }) => ({ key, name, kind }))
  );
}
