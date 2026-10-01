/**
 * Saving import profiles: list, read, add, edit, enable or disable, and delete
 * (006 US6, FR-030, FR-035, FR-038).
 *
 * Every write runs the profile through the one shared check
 * (`$lib/import-profile-schema.ts`), the same one the editor runs, and then
 * checks what only the server can know: that each chosen category is still a
 * category of the right kind, and that no other profile has the same name. A
 * profile with any problem is refused with every problem and its path, and
 * nothing is written (FR-035 AS8).
 *
 * Every change is audited as an 'import_profile' entry in the same transaction
 * as the write, so a change is never saved without its audit entry (FR-038).
 *
 * Permissions are the caller's job, as for every service: managing profiles
 * needs `import.change` and listing them `import.view` (FR-045).
 *
 * There is no live update. Profiles are managed on a Settings-style page that
 * reloads after a save, and the upload screen reads the enabled list when it
 * loads; a profile added in another tab is offered after a reload.
 */

import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  checkProfile,
  formatProfileErrors,
  type ImportProfileDraft,
  type ProfileError,
  type ProfileSection,
  type ProfileSectionKind,
} from "$lib/import-profile-schema.js";
import { ImportReadAs } from "$lib/import-reading.js";
import { diffRecords, getAuditTrail, recordAudit } from "../audit.js";
import { importProfiles } from "../db/schema.js";
import { categoryChoices } from "../import/category-accounts.js";
import type { LedgerDb } from "../ledger/types.js";

/** A saved profile, as the screens and the reading use it. */
export interface ImportProfileView extends ImportProfileDraft {
  id: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * The answer to a write. A refusal carries every problem with its path, for
 * the editor to show beside each field, and `reason` names them in one line.
 * `missing` is set when the profile no longer exists.
 */
export type ProfileWrite<T> = { ok: true; value: T } | ProfileRefusal;

export type ProfileRefusal = {
  ok: false;
  reason: string;
  errors: ProfileError[];
  missing?: true;
};

type ProfileRow = typeof importProfiles.$inferSelect;

const MISSING: ProfileRefusal = {
  ok: false,
  reason: "That import profile no longer exists.",
  errors: [],
  missing: true,
};

function refuse(errors: ProfileError[]): ProfileRefusal {
  return { ok: false, reason: formatProfileErrors(errors), errors };
}

/**
 * Reads a JSON column back. A value that does not parse, or is not the kind
 * expected, gives `fallback`. Every row was checked when it was written, so
 * this only guards against a damaged file.
 */
function parseColumn<T>(
  stored: string,
  fallback: T,
  fits: (value: unknown) => boolean,
): T {
  try {
    const value: unknown = JSON.parse(stored);
    return fits(value) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

const isPlainObject = (value: unknown) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function toView(row: ProfileRow): ImportProfileView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    phrases: parseColumn<string[]>(row.phrasesJson, [], Array.isArray),
    instructions: row.instructions,
    statedTotalLabels: parseColumn<ImportProfileDraft["statedTotalLabels"]>(
      row.statedTotalLabelsJson,
      {},
      isPlainObject,
    ),
    sections: parseColumn<ProfileSection[]>(
      row.sectionsJson,
      [],
      Array.isArray,
    ),
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The fields the form changes, for the audit entry's diff. */
function audited(profile: ImportProfileDraft) {
  return {
    name: profile.name,
    description: profile.description,
    phrases: profile.phrases,
    instructions: profile.instructions,
    statedTotalLabels: profile.statedTotalLabels,
    sections: profile.sections,
  };
}

function columns(profile: ImportProfileDraft) {
  return {
    name: profile.name,
    description: profile.description,
    phrasesJson: JSON.stringify(profile.phrases),
    instructions: profile.instructions,
    sectionsJson: JSON.stringify(profile.sections),
    statedTotalLabelsJson: JSON.stringify(profile.statedTotalLabels),
  };
}

/** The account types a section's category may be, by the section's kind. */
function categoryKinds(kind: ProfileSectionKind): ("expense" | "income")[] {
  if (kind === "income") return ["income"];
  if (kind === "expense") return ["expense"];
  return ["expense", "income"];
}

const KIND_WORDS: Record<ProfileSectionKind, string> = {
  income: "an income category",
  expense: "an expense category",
  by_sign: "an income or expense category",
};

/**
 * What the shared check cannot see: whether each chosen category is a
 * category that can take records, of the section's kind. An archived or
 * deleted category is refused here; one archived after saving is passed over
 * when a document is read.
 */
function checkCategories(
  db: LedgerDb,
  profile: ImportProfileDraft,
): ProfileError[] {
  const choices = {
    expense: new Set(categoryChoices(db, "expense").map((c) => c.id)),
    income: new Set(categoryChoices(db, "income").map((c) => c.id)),
  };
  const errors: ProfileError[] = [];
  profile.sections.forEach((section, index) => {
    const kinds = categoryKinds(section.kind);
    const check = (id: number | null, path: string) => {
      if (id === null) return;
      if (kinds.some((kind) => choices[kind].has(id))) return;
      errors.push({
        path,
        message: `That category is archived, no longer exists, or is not ${KIND_WORDS[section.kind]}. Choose another.`,
      });
    };
    check(
      section.fixedCategoryAccountId,
      `sections[${index}].fixedCategoryAccountId`,
    );
    section.feeTypes.forEach((feeType, feeIndex) =>
      check(
        feeType.categoryAccountId,
        `sections[${index}].feeTypes[${feeIndex}].categoryAccountId`,
      ),
    );
  });
  return errors;
}

/** Another profile already called `name`, ignoring case. */
function nameTaken(db: LedgerDb, name: string, exceptId?: number): boolean {
  const sameName = sql`lower(${importProfiles.name}) = lower(${name})`;
  const row = db
    .select({ id: importProfiles.id })
    .from(importProfiles)
    .where(
      exceptId === undefined
        ? sameName
        : and(sameName, ne(importProfiles.id, exceptId)),
    )
    .get();
  return Boolean(row);
}

/** Runs every check on a profile. The cleaned profile, or every problem. */
function prepare(
  db: LedgerDb,
  input: unknown,
  exceptId?: number,
): { ok: true; profile: ImportProfileDraft } | ProfileRefusal {
  const checked = checkProfile(input);
  if (!checked.ok) return refuse(checked.errors);
  const errors = checkCategories(db, checked.profile);
  if (nameTaken(db, checked.profile.name, exceptId)) {
    errors.unshift({
      path: "name",
      message: `Another profile is already called "${checked.profile.name}". Choose another name.`,
    });
  }
  if (errors.length > 0) return refuse(errors);
  return { ok: true, profile: checked.profile };
}

// ── Reading ─────────────────────────────────────────────────────────────────

/**
 * Every profile, by name. `enabledOnly` gives the ones "Read as" offers
 * (US6 AS5, AS12).
 */
export function listImportProfiles(
  db: LedgerDb,
  { enabledOnly = false }: { enabledOnly?: boolean } = {},
): ImportProfileView[] {
  return db
    .select()
    .from(importProfiles)
    .where(enabledOnly ? eq(importProfiles.enabled, true) : undefined)
    .orderBy(sql`lower(${importProfiles.name})`, asc(importProfiles.id))
    .all()
    .map(toView);
}

/** One profile, or null when there is none with this id. */
export function getImportProfile(
  db: LedgerDb,
  id: number,
): ImportProfileView | null {
  const row = db
    .select()
    .from(importProfiles)
    .where(eq(importProfiles.id, id))
    .get();
  return row ? toView(row) : null;
}

/**
 * The saved profile a queue row was read with, by its id, or null.
 *
 * `import_queue.profile_id` also holds the schema id of a built-in reading,
 * such as "builtin:items@1" for several items (006 S1). That is never a saved
 * profile's id: a row names a saved profile only when it was read as one
 * (`read_as` = "profile"), and its profile id is then this table's whole
 * number id. Every other row gives null, so an older row is never looked up
 * here by mistake (FR-048).
 */
export function savedProfileIdOf(job: {
  readAs: string | null;
  profileId: string | null;
}): number | null {
  if (job.readAs !== ImportReadAs.Profile || !job.profileId) return null;
  if (!/^[1-9][0-9]*$/.test(job.profileId)) return null;
  const id = Number(job.profileId);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * The name a deleted profile had, from the audit entry of its delete, or null
 * when there is none. A document whose profile was deleted before it was read
 * fails with a message naming the profile (spec edge case), and the queue row
 * itself keeps only the profile's id.
 */
export function deletedProfileName(db: LedgerDb, id: number): string | null {
  const deleted = getAuditTrail(db, "import_profile", id).find(
    (entry) => entry.action === "delete",
  );
  const name = deleted?.changes?.find((change) => change.field === "name");
  return typeof name?.before === "string" ? name.before : null;
}

// ── Writing ─────────────────────────────────────────────────────────────────

/** Adds a profile, enabled. */
export function createImportProfile(
  db: LedgerDb,
  actingUserId: number,
  input: unknown,
): ProfileWrite<ImportProfileView> {
  const prepared = prepare(db, input);
  if (!prepared.ok) return prepared;

  const row = db.transaction((tx) => {
    const inserted = tx
      .insert(importProfiles)
      .values({
        ...columns(prepared.profile),
        enabled: true,
        createdBy: actingUserId,
        updatedBy: actingUserId,
      })
      .returning()
      .get();
    recordAudit(tx, {
      recordType: "import_profile",
      recordId: inserted.id,
      userId: actingUserId,
      action: "create",
    });
    return inserted;
  });
  return { ok: true, value: toView(row) };
}

/**
 * Replaces a profile's form with `input`, as one save (the Settings pattern:
 * the editor stages the whole profile and sends it once). Whether it is
 * enabled is not part of the form; see `setImportProfileEnabled`.
 */
export function updateImportProfile(
  db: LedgerDb,
  actingUserId: number,
  id: number,
  input: unknown,
): ProfileWrite<ImportProfileView> {
  const existing = getImportProfile(db, id);
  if (!existing) return MISSING;
  const prepared = prepare(db, input, id);
  if (!prepared.ok) return prepared;

  const changes = diffRecords(audited(existing), audited(prepared.profile));
  if (changes.length === 0) return { ok: true, value: existing };

  const row = db.transaction((tx) => {
    const updated = tx
      .update(importProfiles)
      .set({
        ...columns(prepared.profile),
        updatedBy: actingUserId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(importProfiles.id, id))
      .returning()
      .get();
    recordAudit(tx, {
      recordType: "import_profile",
      recordId: id,
      userId: actingUserId,
      action: "update",
      changes,
    });
    return updated;
  });
  return { ok: true, value: toView(row) };
}

/**
 * Turns a profile on or off. A disabled profile is kept, and not offered
 * under "Read as" (US6 AS12). Turning it to what it already is changes and
 * audits nothing.
 */
export function setImportProfileEnabled(
  db: LedgerDb,
  actingUserId: number,
  id: number,
  enabled: boolean,
): ProfileWrite<ImportProfileView> {
  const existing = getImportProfile(db, id);
  if (!existing) return MISSING;
  if (existing.enabled === enabled) return { ok: true, value: existing };

  const row = db.transaction((tx) => {
    const updated = tx
      .update(importProfiles)
      .set({
        enabled,
        updatedBy: actingUserId,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(importProfiles.id, id))
      .returning()
      .get();
    recordAudit(tx, {
      recordType: "import_profile",
      recordId: id,
      userId: actingUserId,
      action: "update",
      changes: [{ field: "enabled", before: existing.enabled, after: enabled }],
    });
    return updated;
  });
  return { ok: true, value: toView(row) };
}

/**
 * Deletes a profile. Documents already read with it keep their copy of it,
 * so no group changes (FR-038). The audit entry keeps what the profile was,
 * since the row itself is gone.
 */
export function deleteImportProfile(
  db: LedgerDb,
  actingUserId: number,
  id: number,
): ProfileWrite<null> {
  const existing = getImportProfile(db, id);
  if (!existing) return MISSING;

  db.transaction((tx) => {
    tx.delete(importProfiles).where(eq(importProfiles.id, id)).run();
    recordAudit(tx, {
      recordType: "import_profile",
      recordId: id,
      userId: actingUserId,
      action: "delete",
      changes: diffRecords(
        { ...audited(existing), enabled: existing.enabled },
        null,
      ),
    });
  });
  return { ok: true, value: null };
}
