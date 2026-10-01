/**
 * Import profiles: a saved way of reading one kind of document (006 US6-7,
 * FR-030 to FR-038).
 *
 * A user fills in a form: the profile's name, how to recognise it, its
 * instructions, and its sections. Each section has a kind (income, expense or
 * by sign), an optional fixed category, and an optional closed list of fee
 * types, each optionally pinned to a category. The server turns this into the
 * JSON Schema sent to the model; the user never edits that schema. The one
 * place raw JSON is allowed is "Advanced: extra fields", a small JSON Schema
 * fragment of plain values per section (FR-035).
 *
 * This file is the one check of a profile. The editor runs it as the user
 * types and the server runs it again before anything is saved, so the two can
 * never disagree about what is allowed (the `sequence-template.ts` pattern).
 * It has no imports from `$lib/server` and does not use zod, because client
 * files do not load zod.
 *
 * Every problem is reported with the path of the value it is about, such as
 * `sections[1].feeTypes[3].key`, so the editor can show it next to the field,
 * and with a plain sentence saying what is wrong.
 */

import { ImportMode } from "./import-reading.js";

// ── Limits ──────────────────────────────────────────────────────────────────

/** Most sections in one profile. */
export const PROFILE_SECTIONS_MAX = 20;
/** Most fee types in one section. */
export const PROFILE_FEE_TYPES_MAX = 50;
/**
 * Most listed values in a whole profile: every fee type, plus every choice of
 * every extra field. Each one is an `enum` entry in the schema sent, and
 * providers refuse very large enums.
 */
export const PROFILE_ENUM_VALUES_MAX = 200;
/** Most extra fields in one section. */
export const PROFILE_EXTRAS_MAX = 20;
/** Most recognition phrases in one profile. */
export const PROFILE_PHRASES_MAX = 10;

const NAME_MAX = 80;
const RECOGNITION_MAX = 1000;
const PHRASE_MAX = 100;
const INSTRUCTIONS_MAX = 4000;
const SECTION_NAME_MAX = 80;
const SECTION_DESCRIPTION_MAX = 1000;
const SHORT_DESCRIPTION_MAX = 300;
const ENUM_VALUE_MAX = 100;

/**
 * A key the schema uses: a section, a fee type or an extra field. Lower-case
 * letters, digits and "_", starting with a letter, at most 32 characters. The
 * key is what the model writes back, so it must be plain.
 */
export const PROFILE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Names the books already use for an item or for the document as a whole. An
 * extra field may not take one: the item already has that value, and two
 * fields with one name would be read and shown ambiguously (FR-035).
 */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set([
  // What every item has.
  "description",
  "amount",
  "date",
  "reference",
  "source_line",
  "fee_type",
  "category_account_id",
  "category",
  "extras",
  // What the document has once.
  "counterparty",
  "supplier",
  "currency",
  "exchange_rate",
  "document_type",
  "kind",
  // The answer's own parts.
  "header",
  "sections",
  "ignored",
  "stated_total",
  // What the record is given.
  "item_name",
  "remark",
  "account_id",
  "contact",
  "id",
]);

/**
 * What the model writes for "none of these" in a list of choices that may be
 * empty: a fee type (a line that is none of the section's types) or an extra
 * field with an enum that a line does not print. It is sent as one more value
 * of the list, not as null: a strict provider (OpenAI, Groq) reads `enum` as
 * the only values allowed, null included, so a list without it would give the
 * model no way to say "none" and it would put a stray line under the closest
 * type (FR-034). The reading turns it back into null, so no fee type key and
 * no choice of an extra field may be this word.
 */
export const NONE_VALUE = "none";

/**
 * Names every plain JavaScript object already has, such as "constructor".
 * The reading code looks keys up in plain objects, where one of these names
 * finds the built-in value instead of a field, so a section, field or fee type
 * keyed with one would save but could never be read. They are refused like a
 * reserved name.
 */
const OBJECT_BUILTIN_NAMES: ReadonlySet<string> = new Set(
  Object.getOwnPropertyNames(Object.prototype),
);

/** The message for a key that is a built-in object name. */
function builtinNameMessage(key: string, what: string): string {
  return `"${key}" cannot be used as ${what}. Choose another name.`;
}

// ── The profile ─────────────────────────────────────────────────────────────

/**
 * Whether a section's lines are income or expenses (FR-031). `by_sign` reads
 * a positive amount as income and a negative one as an expense, and both are
 * stored without their sign (FR-008).
 */
export type ProfileSectionKind = "income" | "expense" | "by_sign";
export const PROFILE_SECTION_KINDS: readonly ProfileSectionKind[] = [
  "income",
  "expense",
  "by_sign",
];

/**
 * Which import mode a section belongs to (FR-031, FR-032).
 *
 * Only Summary for now. Every transaction (US8, FR-002 and FR-043) is
 * deferred by the maintainer, so every section is a Summary section and the
 * editor shows no choice. This is the extension point: US8 adds
 * `ImportMode.EveryTransaction` to this list, and a saved section already
 * carries its mode, so nothing stored needs to change.
 */
export type ProfileSectionMode = typeof ImportMode.Summary;
export const PROFILE_SECTION_MODES: readonly ProfileSectionMode[] = [
  ImportMode.Summary,
];

/** A plain value an extra field can hold. */
export type ExtraScalarType = "string" | "number" | "integer" | "boolean";
const SCALAR_TYPES: readonly ExtraScalarType[] = [
  "string",
  "number",
  "integer",
  "boolean",
];

/**
 * One extra field, written as JSON Schema. `type` is a plain type, or a plain
 * type and "null" in a list, for a value that may be missing.
 */
export interface ExtraFieldSchema {
  type: ExtraScalarType | (ExtraScalarType | "null")[];
  description?: string;
  /** Only for text: the closed list of values the field can take. */
  enum?: string[];
}

/** A section's "Advanced: extra fields": a flat JSON Schema object. */
export interface ExtrasFragment {
  type: "object";
  properties: Record<string, ExtraFieldSchema>;
  /** The fields the document always prints. The rest may be null. */
  required?: string[];
}

/** One kind of line a section lists, such as "commission_fee" (FR-034). */
export interface ProfileFeeType {
  key: string;
  /** Tells the model which lines are this type. May be empty. */
  description: string;
  /** The category every line of this type gets. Wins over any other. */
  categoryAccountId: number | null;
}

/** One part of the document to read (FR-031). */
export interface ProfileSection {
  /** The section's key in the answer. See `PROFILE_KEY_PATTERN`. */
  key: string;
  /** The name the screens show. */
  name: string;
  /** What the section is and where to find it on the document. */
  description: string;
  mode: ProfileSectionMode;
  kind: ProfileSectionKind;
  /** The category of a line with no fee type. */
  fixedCategoryAccountId: number | null;
  /**
   * The closed list of line types. Empty means the section takes any line
   * its description fits. When it is not empty, a line of no listed type is
   * not proposed (FR-034).
   */
  feeTypes: ProfileFeeType[];
  /** "Advanced: extra fields". Null when there are none. */
  extras: ExtrasFragment | null;
}

/** A profile as the editor fills it in and the server saves it. */
export interface ImportProfileDraft {
  name: string;
  /** How to recognise the document, in plain words (FR-030). */
  description: string;
  /** Text that the document always prints, for recognising it without AI. */
  phrases: string[];
  /**
   * The profile's own guidance to the model. It replaces the general import
   * instructions for documents read with this profile (FR-036).
   */
  instructions: string;
  /**
   * Which printed total each import mode compares against, such as "Total
   * payout released". Keyed by mode; only Summary for now. Empty or missing
   * means the profile names no total and no control total is shown.
   */
  statedTotalLabels: Partial<Record<ProfileSectionMode, string>>;
  sections: ProfileSection[];
}

/** One problem with a profile, at the path of the value it is about. */
export interface ProfileError {
  path: string;
  message: string;
}

/** An extra field in the form the reading uses. */
export interface ExtraField {
  key: string;
  type: ExtraScalarType;
  /** True when the field may be missing on a line. */
  nullable: boolean;
  description: string | null;
  enum: string[] | null;
}

// ── Small checks ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

const KEY_RULE =
  "must start with a lower-case letter and use only a-z, 0-9 and _ (at most 32 characters)";

/**
 * Reads a text field: trimmed, within `max` characters, and present when
 * `required`. Returns the trimmed text, or "" after reporting a problem.
 */
function text(
  value: unknown,
  path: string,
  label: string,
  errors: ProfileError[],
  { max, required }: { max: number; required: boolean },
): string {
  if (value === undefined || value === null) value = "";
  if (typeof value !== "string") {
    errors.push({ path, message: `${label} must be text.` });
    return "";
  }
  const trimmed = value.trim();
  if (required && !trimmed) {
    errors.push({ path, message: `Fill in ${label.toLowerCase()}.` });
  } else if (trimmed.length > max) {
    errors.push({
      path,
      message: `${label} can be at most ${max} characters; this has ${trimmed.length}.`,
    });
  }
  return trimmed;
}

/** Reads an optional category: null, or a whole account id. */
function categoryId(
  value: unknown,
  path: string,
  errors: ProfileError[],
): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  errors.push({ path, message: "Choose a category from the list, or none." });
  return null;
}

// ── Extra fields ────────────────────────────────────────────────────────────

const FRAGMENT_KEYWORDS = new Set(["type", "properties", "required"]);
const FIELD_KEYWORDS = new Set(["type", "description", "enum"]);

function describeKeyword(keyword: string, path: string): ProfileError {
  return {
    path: join(path, keyword),
    message: `"${keyword}" is not supported here. Extra fields may use only type, description and enum, and the list itself only type, properties and required.`,
  };
}

/** Reads one extra field. Returns the cleaned field, or null on a problem. */
function extraField(
  key: string,
  raw: unknown,
  path: string,
  errors: ProfileError[],
): ExtraFieldSchema | null {
  const before = errors.length;
  if (!PROFILE_KEY_PATTERN.test(key)) {
    errors.push({ path, message: `The field name "${key}" ${KEY_RULE}.` });
  } else if (RESERVED_FIELD_NAMES.has(key)) {
    errors.push({
      path,
      message: `"${key}" is a name the books already use for every item. Choose another name.`,
    });
  } else if (OBJECT_BUILTIN_NAMES.has(key)) {
    errors.push({ path, message: builtinNameMessage(key, "a field name") });
  }
  if (!isRecord(raw)) {
    errors.push({
      path,
      message: "Each extra field must be an object with a type.",
    });
    return null;
  }
  for (const keyword of Object.keys(raw)) {
    if (!FIELD_KEYWORDS.has(keyword)) {
      errors.push(
        keyword === "properties" || keyword === "items"
          ? {
              path: join(path, keyword),
              message:
                "Extra fields hold plain values only: text, a number or true/false. Nested objects and lists are not supported.",
            }
          : describeKeyword(keyword, path),
      );
    }
  }

  // The type: one plain type, or a plain type and "null" in a list.
  const typePath = join(path, "type");
  const types = Array.isArray(raw.type) ? raw.type : [raw.type];
  let scalar: ExtraScalarType | null = null;
  let nullable = false;
  let typeOk = types.length >= 1 && types.length <= 2;
  for (const entry of types) {
    if (entry === "null" && !nullable) {
      nullable = true;
    } else if (
      typeof entry === "string" &&
      (SCALAR_TYPES as readonly string[]).includes(entry) &&
      scalar === null
    ) {
      scalar = entry as ExtraScalarType;
    } else if (entry === "object" || entry === "array") {
      errors.push({
        path: typePath,
        message:
          "Extra fields hold plain values only: text, a number or true/false. Nested objects and lists are not supported.",
      });
      return null;
    } else {
      typeOk = false;
    }
  }
  if (!typeOk || scalar === null) {
    errors.push({
      path: typePath,
      message:
        'The type must be "string", "number", "integer" or "boolean", or one of them and "null" in a list, such as ["string", "null"].',
    });
    return null;
  }

  const field: ExtraFieldSchema = {
    type: nullable ? [scalar, "null"] : scalar,
  };

  if (raw.description !== undefined) {
    const description = text(
      raw.description,
      join(path, "description"),
      "The description",
      errors,
      { max: SHORT_DESCRIPTION_MAX, required: false },
    );
    if (description) field.description = description;
  }

  if (raw.enum !== undefined) {
    const enumPath = join(path, "enum");
    if (scalar !== "string") {
      errors.push({
        path: enumPath,
        message: "A list of choices (enum) is allowed only on a text field.",
      });
    } else if (!Array.isArray(raw.enum) || raw.enum.length === 0) {
      errors.push({
        path: enumPath,
        message: "The list of choices (enum) must be a list of text values.",
      });
    } else {
      const seen = new Set<string>();
      raw.enum.forEach((value, index) => {
        const valuePath = `${enumPath}[${index}]`;
        if (typeof value !== "string" || !value.trim()) {
          errors.push({
            path: valuePath,
            message: "Each choice must be text and not empty.",
          });
        } else if (value.length > ENUM_VALUE_MAX) {
          errors.push({
            path: valuePath,
            message: `Each choice can be at most ${ENUM_VALUE_MAX} characters.`,
          });
        } else if (value === NONE_VALUE) {
          errors.push({
            path: valuePath,
            message: `"${NONE_VALUE}" is how the reading marks a line that has none of these choices. Leave it out; a line with no choice is read as empty.`,
          });
        } else if (seen.has(value)) {
          errors.push({
            path: valuePath,
            message: `"${value}" is listed twice.`,
          });
        } else {
          seen.add(value);
        }
      });
      field.enum = [...seen];
    }
  }

  return errors.length === before ? field : null;
}

/**
 * Checks a section's "Advanced: extra fields" (FR-035): a JSON Schema object
 * of plain values, written as JSON text or already parsed. Empty text, null
 * or an object with no properties all mean "no extra fields".
 *
 * Only `type`, `properties` and `required` are allowed on the object, and only
 * `type`, `description` and `enum` (text values only) on each field; a value
 * that may be missing is written as a type list with "null". Anything else is
 * refused with its path, never silently dropped, so what the user wrote is
 * exactly what is sent.
 *
 * `path` is where the fragment sits, for the messages: `sections[0].extras`
 * inside a profile.
 */
export function validateExtrasFragment(
  input: unknown,
  path = "extras",
):
  | { ok: true; fragment: ExtrasFragment | null; enumCount: number }
  | { ok: false; errors: ProfileError[] } {
  let raw = input;
  if (typeof raw === "string") {
    if (!raw.trim()) return { ok: true, fragment: null, enumCount: 0 };
    try {
      raw = JSON.parse(raw);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        errors: [{ path, message: `This is not valid JSON: ${reason}` }],
      };
    }
  }
  if (raw === undefined || raw === null) {
    return { ok: true, fragment: null, enumCount: 0 };
  }

  const errors: ProfileError[] = [];
  if (!isRecord(raw)) {
    return {
      ok: false,
      errors: [
        {
          path,
          message:
            'Extra fields must be a JSON Schema object, such as {"type": "object", "properties": {...}}.',
        },
      ],
    };
  }
  for (const keyword of Object.keys(raw)) {
    if (!FRAGMENT_KEYWORDS.has(keyword)) {
      errors.push(describeKeyword(keyword, path));
    }
  }
  if (raw.type !== "object") {
    errors.push({
      path: join(path, "type"),
      message: 'The type of the extra fields must be "object".',
    });
  }

  const propertiesPath = join(path, "properties");
  const properties = raw.properties ?? {};
  if (!isRecord(properties)) {
    errors.push({
      path: propertiesPath,
      message: "properties must be an object naming each extra field.",
    });
    return { ok: false, errors };
  }
  const keys = Object.keys(properties);
  if (keys.length > PROFILE_EXTRAS_MAX) {
    errors.push({
      path: propertiesPath,
      message: `A section can have at most ${PROFILE_EXTRAS_MAX} extra fields; this has ${keys.length}.`,
    });
  }

  const requiredPath = join(path, "required");
  let required: string[] = [];
  if (raw.required !== undefined) {
    if (
      !Array.isArray(raw.required) ||
      raw.required.some((entry) => typeof entry !== "string")
    ) {
      errors.push({
        path: requiredPath,
        message: "required must be a list of field names.",
      });
    } else {
      required = raw.required as string[];
      const seen = new Set<string>();
      required.forEach((name, index) => {
        if (!Object.hasOwn(properties, name)) {
          errors.push({
            path: `${requiredPath}[${index}]`,
            message: `"${name}" is not one of the extra fields.`,
          });
        } else if (seen.has(name)) {
          errors.push({
            path: `${requiredPath}[${index}]`,
            message: `"${name}" is listed twice.`,
          });
        }
        seen.add(name);
      });
    }
  }

  const cleaned: Record<string, ExtraFieldSchema> = {};
  let enumCount = 0;
  for (const key of keys) {
    const field = extraField(
      key,
      properties[key],
      join(propertiesPath, key),
      errors,
    );
    if (field) {
      cleaned[key] = field;
      enumCount += field.enum?.length ?? 0;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  if (keys.length === 0) return { ok: true, fragment: null, enumCount: 0 };
  const fragment: ExtrasFragment = { type: "object", properties: cleaned };
  const keptRequired = [...new Set(required)];
  if (keptRequired.length > 0) fragment.required = keptRequired;
  return { ok: true, fragment, enumCount };
}

/**
 * The extra fields of a checked fragment, in the form the reading uses. A
 * field may be missing on a line (`nullable`) when its type lists "null" or
 * when it is not in `required`: the answer always has every field, and a
 * missing value is sent back as null.
 */
export function extraFieldsOf(fragment: ExtrasFragment | null): ExtraField[] {
  if (!fragment) return [];
  const required = new Set(fragment.required ?? []);
  return Object.entries(fragment.properties).map(([key, field]) => {
    const types = Array.isArray(field.type) ? field.type : [field.type];
    const scalar = types.find((entry) => entry !== "null") as ExtraScalarType;
    return {
      key,
      type: scalar,
      nullable: types.includes("null") || !required.has(key),
      description: field.description ?? null,
      enum: field.enum ? [...field.enum] : null,
    };
  });
}

// ── The whole profile ───────────────────────────────────────────────────────

function feeTypes(
  raw: unknown,
  path: string,
  errors: ProfileError[],
): ProfileFeeType[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push({ path, message: "Fee types must be a list." });
    return [];
  }
  if (raw.length > PROFILE_FEE_TYPES_MAX) {
    errors.push({
      path,
      message: `A section can list at most ${PROFILE_FEE_TYPES_MAX} fee types; this has ${raw.length}.`,
    });
  }
  const seen = new Set<string>();
  return raw.map((entry, index) => {
    const at = `${path}[${index}]`;
    const value = isRecord(entry) ? entry : {};
    if (!isRecord(entry)) {
      errors.push({ path: at, message: "Each fee type must be an object." });
    }
    const key = typeof value.key === "string" ? value.key.trim() : "";
    if (!PROFILE_KEY_PATTERN.test(key)) {
      errors.push({
        path: `${at}.key`,
        message: key
          ? `The fee type key "${key}" ${KEY_RULE}.`
          : "The fee type key is required.",
      });
    } else if (OBJECT_BUILTIN_NAMES.has(key)) {
      errors.push({
        path: `${at}.key`,
        message: builtinNameMessage(key, "a fee type key"),
      });
    } else if (key === NONE_VALUE) {
      errors.push({
        path: `${at}.key`,
        message: `"${NONE_VALUE}" is how the reading marks a line that is none of the fee types. Choose another key.`,
      });
    } else if (seen.has(key)) {
      errors.push({
        path: `${at}.key`,
        message: `The fee type "${key}" is listed twice in this section.`,
      });
    }
    seen.add(key);
    return {
      key,
      description: text(
        value.description,
        `${at}.description`,
        "The fee type description",
        errors,
        { max: SHORT_DESCRIPTION_MAX, required: false },
      ),
      categoryAccountId: categoryId(
        value.categoryAccountId,
        `${at}.categoryAccountId`,
        errors,
      ),
    };
  });
}

function section(
  raw: unknown,
  path: string,
  seenKeys: Set<string>,
  errors: ProfileError[],
): { section: ProfileSection; enumCount: number } {
  const value = isRecord(raw) ? raw : {};
  if (!isRecord(raw)) {
    errors.push({ path, message: "Each section must be an object." });
  }

  const key = typeof value.key === "string" ? value.key.trim() : "";
  if (!PROFILE_KEY_PATTERN.test(key)) {
    errors.push({
      path: `${path}.key`,
      message: key
        ? `The section key "${key}" ${KEY_RULE}.`
        : "The section key is required.",
    });
  } else if (OBJECT_BUILTIN_NAMES.has(key)) {
    errors.push({
      path: `${path}.key`,
      message: builtinNameMessage(key, "a section key"),
    });
  } else if (seenKeys.has(key)) {
    errors.push({
      path: `${path}.key`,
      message: `Two sections use the key "${key}". Each section needs its own key.`,
    });
  }
  seenKeys.add(key);

  // Read in the order the editor shows the fields, so the problems are
  // listed in that order too.
  const name = text(value.name, `${path}.name`, "The section name", errors, {
    max: SECTION_NAME_MAX,
    required: true,
  });
  const description = text(
    value.description,
    `${path}.description`,
    "The section description",
    errors,
    { max: SECTION_DESCRIPTION_MAX, required: true },
  );

  // Missing means Summary: the only mode there is today (see
  // PROFILE_SECTION_MODES).
  const mode = value.mode ?? ImportMode.Summary;
  if (!(PROFILE_SECTION_MODES as readonly unknown[]).includes(mode)) {
    errors.push({
      path: `${path}.mode`,
      message: "Only Summary sections are supported for now.",
    });
  }

  const kind = value.kind;
  if (!(PROFILE_SECTION_KINDS as readonly unknown[]).includes(kind)) {
    errors.push({
      path: `${path}.kind`,
      message: "Choose whether the section is Income, Expense or By sign.",
    });
  }

  const fixedCategoryAccountId = categoryId(
    value.fixedCategoryAccountId,
    `${path}.fixedCategoryAccountId`,
    errors,
  );
  const fees = feeTypes(value.feeTypes, `${path}.feeTypes`, errors);
  const extras = validateExtrasFragment(value.extras, `${path}.extras`);
  if (!extras.ok) errors.push(...extras.errors);

  return {
    section: {
      key,
      name,
      description,
      mode: ImportMode.Summary,
      kind: kind as ProfileSectionKind,
      fixedCategoryAccountId,
      feeTypes: fees,
      extras: extras.ok ? extras.fragment : null,
    },
    enumCount: fees.length + (extras.ok ? extras.enumCount : 0),
  };
}

/**
 * Checks a profile and returns a cleaned copy: text trimmed, keys the profile
 * does not have dropped, the extra fields parsed. A profile with any problem
 * gives every problem found instead, and must not be saved (FR-035 AS8).
 *
 * What this cannot check is whether a chosen category still exists and fits
 * the section; the server checks that against the chart of accounts.
 */
export function checkProfile(
  input: unknown,
):
  | { ok: true; profile: ImportProfileDraft }
  | { ok: false; errors: ProfileError[] } {
  const errors: ProfileError[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ path: "", message: "The profile must be an object." }],
    };
  }

  const name = text(input.name, "name", "The name", errors, {
    max: NAME_MAX,
    required: true,
  });
  const description = text(
    input.description,
    "description",
    "The recognition description",
    errors,
    { max: RECOGNITION_MAX, required: true },
  );
  const instructions = text(
    input.instructions,
    "instructions",
    "The instructions",
    errors,
    { max: INSTRUCTIONS_MAX, required: false },
  );

  // Recognition phrases: optional, each one plain text, none twice.
  const phrases: string[] = [];
  const rawPhrases = input.phrases ?? [];
  if (!Array.isArray(rawPhrases)) {
    errors.push({ path: "phrases", message: "Phrases must be a list." });
  } else {
    if (rawPhrases.length > PROFILE_PHRASES_MAX) {
      errors.push({
        path: "phrases",
        message: `A profile can have at most ${PROFILE_PHRASES_MAX} recognition phrases; this has ${rawPhrases.length}.`,
      });
    }
    const seen = new Set<string>();
    rawPhrases.forEach((raw, index) => {
      const phrase = text(raw, `phrases[${index}]`, "A phrase", errors, {
        max: PHRASE_MAX,
        required: true,
      });
      const folded = phrase.toLowerCase();
      if (phrase && seen.has(folded)) {
        errors.push({
          path: `phrases[${index}]`,
          message: `The phrase "${phrase}" is listed twice.`,
        });
      }
      seen.add(folded);
      if (phrase) phrases.push(phrase);
    });
  }

  // The stated total each mode compares against, keyed by mode.
  const statedTotalLabels: ImportProfileDraft["statedTotalLabels"] = {};
  const rawLabels = input.statedTotalLabels ?? {};
  if (!isRecord(rawLabels)) {
    errors.push({
      path: "statedTotalLabels",
      message: "The stated totals must be given per import mode.",
    });
  } else {
    for (const [mode, label] of Object.entries(rawLabels)) {
      const at = `statedTotalLabels.${mode}`;
      if (!(PROFILE_SECTION_MODES as readonly string[]).includes(mode)) {
        errors.push({
          path: at,
          message: "Only the Summary stated total is supported for now.",
        });
        continue;
      }
      const cleaned = text(label, at, "The stated total", errors, {
        max: SHORT_DESCRIPTION_MAX,
        required: false,
      });
      if (cleaned) statedTotalLabels[mode as ProfileSectionMode] = cleaned;
    }
  }

  // The sections, and the listed values they add up to.
  const sections: ProfileSection[] = [];
  let enumCount = 0;
  let enumReported = false;
  const rawSections = input.sections;
  if (!Array.isArray(rawSections) || rawSections.length === 0) {
    errors.push({
      path: "sections",
      message: "A profile needs at least one section.",
    });
  } else {
    if (rawSections.length > PROFILE_SECTIONS_MAX) {
      errors.push({
        path: "sections",
        message: `A profile can have at most ${PROFILE_SECTIONS_MAX} sections; this has ${rawSections.length}.`,
      });
    }
    const seenKeys = new Set<string>();
    rawSections.forEach((raw, index) => {
      const path = `sections[${index}]`;
      const read = section(raw, path, seenKeys, errors);
      sections.push(read.section);
      enumCount += read.enumCount;
      if (enumCount > PROFILE_ENUM_VALUES_MAX && !enumReported) {
        enumReported = true;
        errors.push({
          path,
          message: `A profile can list at most ${PROFILE_ENUM_VALUES_MAX} values in all (fee types and the choices of extra fields); it reaches ${enumCount} at this section.`,
        });
      }
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    profile: {
      name,
      description,
      phrases,
      instructions,
      statedTotalLabels,
      sections,
    },
  };
}

/** Every problem with a profile. An empty list means it can be saved. */
export function validateProfile(input: unknown): ProfileError[] {
  const result = checkProfile(input);
  return result.ok ? [] : result.errors;
}

/** The problems as one sentence list, for a refusal's reason. */
export function formatProfileErrors(
  errors: readonly ProfileError[],
  shown = 5,
): string {
  const lines = errors
    .slice(0, shown)
    .map((error) =>
      error.path ? `${error.path}: ${error.message}` : error.message,
    );
  if (errors.length > shown) {
    lines.push(`and ${errors.length - shown} more.`);
  }
  return lines.join(" ");
}
