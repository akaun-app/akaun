/**
 * The import profile editor's form, and how it turns into a profile and back
 * (006 US6, FR-030, FR-031, FR-035).
 *
 * The editor stages the whole profile in this shape and sends it once, as the
 * Settings page does. It differs from a saved profile in three ways:
 *
 * - Each section and fee type carries a `uid`, so a list that is reordered or
 *   shortened keeps each row's own inputs.
 * - A new section's key follows its name (`keyFromName`). A saved section
 *   keeps the key it was saved with, so renaming it changes only what the
 *   screens show.
 * - "Advanced: extra fields" is the JSON text the user typed, not the parsed
 *   fragment. The shared check (`import-profile-schema.ts`) reads text and
 *   reports a typing mistake with its path, so the editor never parses it on
 *   its own and the server sees exactly what was typed.
 *
 * Pure TypeScript with no server imports, so the editor and the server specs
 * read the same rules.
 */

import {
  PROFILE_KEY_PATTERN,
  PROFILE_SECTION_MODES,
  type ImportProfileDraft,
  type ProfileError,
  type ProfileSectionKind,
  type ProfileSectionMode,
} from "./import-profile-schema.js";
import { ImportMode } from "./import-reading.js";

export interface FeeTypeForm {
  uid: string;
  /** What the model writes back, and what the remark names. */
  key: string;
  description: string;
  /** The pinned category, or null for "Auto". */
  categoryAccountId: number | null;
}

export interface SectionForm {
  uid: string;
  /** The key a saved section has. Ignored while `keyFromName` is true. */
  key: string;
  /** True for a section not saved yet: its key is made from its name. */
  keyFromName: boolean;
  name: string;
  description: string;
  /** Which import mode reads this section: Summary or Every transaction. */
  mode: ProfileSectionMode;
  kind: ProfileSectionKind;
  fixedCategoryAccountId: number | null;
  feeTypes: FeeTypeForm[];
  /** "Advanced: extra fields" as typed. Empty means none. */
  extrasText: string;
}

export interface ProfileForm {
  name: string;
  description: string;
  phrases: string[];
  instructions: string;
  /**
   * The stated total of each import mode, as typed. Empty means the profile
   * names no total for that mode. A summary and a transaction table total
   * different lines, so each mode has its own.
   */
  statedTotals: Record<ProfileSectionMode, string>;
  sections: SectionForm[];
}

let uidCounter = 0;

/** A key for one row of the form, unique in this page. */
export function newUid(): string {
  uidCounter += 1;
  return `row-${uidCounter}`;
}

/**
 * A key made from a name: lower-case letters, digits and "_", starting with a
 * letter, at most 32 characters. "Ads & promotions" gives "ads_promotions".
 * A name with no usable letter gives "".
 */
export function slugifyKey(name: string): string {
  const plain = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+/, "")
    .slice(0, 32)
    .replace(/_+$/, "");
  return PROFILE_KEY_PATTERN.test(plain) ? plain : "";
}

/**
 * A fee type key as it is being typed: spaces and dashes become "_", capitals
 * become small letters, and anything else a key cannot hold is dropped. A
 * trailing "_" is kept, because the next word may follow it. Whatever is left
 * that still breaks the rule (a leading digit, say) is reported by the shared
 * check, not silently changed.
 */
export function typingKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 32);
}

/** An empty fee type row. */
export function newFeeType(): FeeTypeForm {
  return { uid: newUid(), key: "", description: "", categoryAccountId: null };
}

/**
 * An empty section, in Summary unless another mode is given. Expense is the
 * commonest kind on a fee document.
 */
export function newSection(
  mode: ProfileSectionMode = ImportMode.Summary,
): SectionForm {
  return {
    uid: newUid(),
    key: "",
    keyFromName: true,
    name: "",
    description: "",
    mode,
    kind: "expense",
    fixedCategoryAccountId: null,
    feeTypes: [],
    extrasText: "",
  };
}

/** No stated total for any mode. */
function noStatedTotals(): Record<ProfileSectionMode, string> {
  return { [ImportMode.Summary]: "", [ImportMode.EveryTransaction]: "" };
}

/** A blank profile with one empty section, since a profile needs one. */
export function blankForm(): ProfileForm {
  return {
    name: "",
    description: "",
    phrases: [],
    instructions: "",
    statedTotals: noStatedTotals(),
    sections: [newSection()],
  };
}

/**
 * The form for a profile, saved or from a starter. Its sections keep the keys
 * they have: a saved profile's were saved with it, and a starter chose its
 * own.
 */
export function formFromDraft(draft: ImportProfileDraft): ProfileForm {
  return {
    name: draft.name,
    description: draft.description,
    phrases: [...draft.phrases],
    instructions: draft.instructions,
    statedTotals: {
      [ImportMode.Summary]: draft.statedTotalLabels[ImportMode.Summary] ?? "",
      [ImportMode.EveryTransaction]:
        draft.statedTotalLabels[ImportMode.EveryTransaction] ?? "",
    },
    sections: draft.sections.map((section) => ({
      uid: newUid(),
      key: section.key,
      keyFromName: false,
      name: section.name,
      description: section.description,
      mode: section.mode,
      kind: section.kind,
      fixedCategoryAccountId: section.fixedCategoryAccountId,
      feeTypes: section.feeTypes.map((feeType) => ({
        uid: newUid(),
        key: feeType.key,
        description: feeType.description,
        categoryAccountId: feeType.categoryAccountId,
      })),
      extrasText: section.extras ? JSON.stringify(section.extras, null, 2) : "",
    })),
  };
}

/**
 * The key each section is sent with, in order. A new section's key is made
 * from its name; when that is taken by an earlier section, a number is added
 * ("fees_2"), so two sections with one name do not stop the save. A name with
 * no usable letter gives "section_<n>".
 */
export function sectionKeys(sections: readonly SectionForm[]): string[] {
  const keys: string[] = [];
  const taken = new Set(
    sections.filter((section) => !section.keyFromName).map((s) => s.key),
  );
  sections.forEach((section, index) => {
    if (!section.keyFromName) {
      keys.push(section.key);
      return;
    }
    const base = slugifyKey(section.name) || `section_${index + 1}`;
    let key = base;
    for (let n = 2; taken.has(key); n++) {
      const suffix = `_${n}`;
      key = `${base.slice(0, 32 - suffix.length)}${suffix}`;
    }
    taken.add(key);
    keys.push(key);
  });
  return keys;
}

/**
 * What the editor sends: the profile's form in the shape the shared check
 * reads. Each section goes with its own import mode, and each mode's stated
 * total only when one is typed. The extra fields go as the text typed.
 */
export function payloadFromForm(form: ProfileForm): Record<string, unknown> {
  const keys = sectionKeys(form.sections);
  const statedTotalLabels: Partial<Record<ProfileSectionMode, string>> = {};
  for (const mode of PROFILE_SECTION_MODES) {
    const label = (form.statedTotals[mode] ?? "").trim();
    if (label) statedTotalLabels[mode] = label;
  }
  return {
    name: form.name,
    description: form.description,
    phrases: form.phrases,
    instructions: form.instructions,
    statedTotalLabels,
    sections: form.sections.map((section, index) => ({
      key: keys[index],
      name: section.name,
      description: section.description,
      mode: section.mode,
      kind: section.kind,
      fixedCategoryAccountId: section.fixedCategoryAccountId,
      feeTypes: section.feeTypes.map((feeType) => ({
        key: feeType.key,
        description: feeType.description,
        categoryAccountId: feeType.categoryAccountId,
      })),
      extras: section.extrasText,
    })),
  };
}

/**
 * One string that changes whenever anything the user can save changes, for
 * the unsaved-changes check. Row uids are left out: they are not saved.
 */
export function formFingerprint(form: ProfileForm): string {
  return JSON.stringify(payloadFromForm(form));
}

/** The problems about exactly this path. */
export function errorsAt(
  errors: readonly ProfileError[],
  path: string,
): string[] {
  return errors
    .filter((error) => error.path === path)
    .map((error) => error.message);
}

/**
 * The problems at this path or anywhere under it, with the rest of the path
 * kept, so a message about one property of an extra field still says which.
 */
export function errorsUnder(
  errors: readonly ProfileError[],
  prefix: string,
): string[] {
  return errors
    .filter(
      (error) =>
        error.path === prefix ||
        error.path.startsWith(`${prefix}.`) ||
        error.path.startsWith(`${prefix}[`),
    )
    .map((error) => {
      const rest = error.path.slice(prefix.length).replace(/^\./, "");
      return rest ? `${rest}: ${error.message}` : error.message;
    });
}
