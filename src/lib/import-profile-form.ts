/**
 * The import profile editor's form, and how it turns into a profile and back
 * (006 US6, FR-030, FR-031, FR-035).
 *
 * The editor stages the whole profile in this shape and sends it once, as the
 * Settings page does. It differs from a saved profile in four ways:
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
 * - The table layout and row rules (FR-053, FR-054) hold every list as text,
 *   one entry per line, and every optional value as "" for none, so each
 *   field binds to an input as it is. `payloadFromForm` turns them into the
 *   layout the shared check reads, and a saved layout comes back through the
 *   form unchanged.
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
  type RowCondition,
  type RowConditionOp,
  type SectionRows,
  type TableCsvDelimiter,
  type TableDateFormat,
  type TableLayout,
} from "./import-profile-schema.js";
import { ImportMode } from "./import-reading.js";

export interface FeeTypeForm {
  uid: string;
  /** What the model writes back, and what the remark names. */
  key: string;
  description: string;
  /** The pinned category, or null for "Auto". */
  categoryAccountId: number | null;
  /**
   * The cell values that mean this fee type in its section's fee type column
   * (FR-054), one per line as typed. Empty for a section the AI reads.
   */
  valuesText: string;
}

/** One condition of a row rule, as typed (FR-054). */
export interface ConditionForm {
  uid: string;
  /** A heading of the table. */
  column: string;
  op: RowConditionOp;
  /** For is, is not and contains. Kept while another op is chosen. */
  value: string;
  /** For is one of: one value per line. Kept likewise. */
  valuesText: string;
}

/** A section's row rules, as typed (FR-054). */
export interface RowsForm {
  where: ConditionForm[];
  flagWhen: ConditionForm[];
  flagNote: string;
  /** The heading of the fee type column, or "" for none. */
  feeTypeColumn: string;
}

/**
 * A profile's table layout, as typed (FR-053). Text that is a list is one
 * entry per line, and text that may be empty is "" for none, so every field
 * binds to an input as it is; `payloadFromForm` makes the layout from it.
 */
export interface LayoutForm {
  /** The sheet's name, or "" for the first sheet that has the headings. */
  sheet: string;
  /** The table's headings, one per line. */
  headersText: string;
  date: string;
  description: string;
  amount: string;
  /** "" for none. */
  reference: string;
  dateFormat: TableDateFormat;
  /** The direction column, or "" for none: the amount then has its sign. */
  directionColumn: string;
  directionInText: string;
  directionOutText: string;
  decimalSeparator: "." | ",";
  /** "" to work it out from the file. */
  csvDelimiter: TableCsvDelimiter | "";
  counterparty: string;
  currency: string;
  documentDateLabel: string;
  remarkColumns: string[];
  /** Each mode's stated-total labels, one per line. */
  totalsText: Record<ProfileSectionMode, string>;
  /** The running-balance column, or "" for none. */
  balanceColumn: string;
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
  /** A transfer section's other account (FR-058); null for any other kind. */
  counterAccountId: number | null;
  /** The section's row rules for reading from columns (FR-054), or null. */
  rows: RowsForm | null;
  /**
   * Other profiles whose records describe the same money (FR-066). Sent only
   * for a section that is not a transfer.
   */
  sameMoneyAs: number[];
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
  /** The account the document is about (FR-058), or null for none. */
  accountId: number | null;
  /**
   * The table layout for reading a spreadsheet from its columns (FR-053), or
   * null when the profile has none.
   */
  layout: LayoutForm | null;
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
  return {
    uid: newUid(),
    key: "",
    description: "",
    categoryAccountId: null,
    valuesText: "",
  };
}

/** Text typed one entry per line, as a list: trimmed, empty lines left out. */
export function linesOf(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** An empty condition: the first heading, compared with "is". */
export function newCondition(column = ""): ConditionForm {
  return { uid: newUid(), column, op: "is", value: "", valuesText: "" };
}

/** Row rules that take every row, with nothing flagged. */
export function newRows(): RowsForm {
  return { where: [], flagWhen: [], flagNote: "", feeTypeColumn: "" };
}

/** An empty table layout. */
export function newLayout(): LayoutForm {
  return {
    sheet: "",
    headersText: "",
    date: "",
    description: "",
    amount: "",
    reference: "",
    dateFormat: "YYYY-MM-DD",
    directionColumn: "",
    directionInText: "",
    directionOutText: "",
    decimalSeparator: ".",
    csvDelimiter: "",
    counterparty: "",
    currency: "",
    documentDateLabel: "",
    remarkColumns: [],
    totalsText: { [ImportMode.Summary]: "", [ImportMode.EveryTransaction]: "" },
    balanceColumn: "",
  };
}

function conditionForm(condition: RowCondition): ConditionForm {
  return {
    uid: newUid(),
    column: condition.column,
    op: condition.op,
    value: condition.value ?? "",
    valuesText: (condition.values ?? []).join("\n"),
  };
}

function rowsForm(rows: SectionRows): RowsForm {
  return {
    where: rows.where.map(conditionForm),
    flagWhen: rows.flagWhen.map(conditionForm),
    flagNote: rows.flagNote,
    feeTypeColumn: rows.feeTypeColumn ?? "",
  };
}

function layoutForm(layout: TableLayout): LayoutForm {
  return {
    sheet: layout.sheet ?? "",
    headersText: layout.headers.join("\n"),
    date: layout.columns.date,
    description: layout.columns.description,
    amount: layout.columns.amount,
    reference: layout.columns.reference ?? "",
    dateFormat: layout.dateFormat,
    directionColumn: layout.direction?.column ?? "",
    directionInText: (layout.direction?.in ?? []).join("\n"),
    directionOutText: (layout.direction?.out ?? []).join("\n"),
    decimalSeparator: layout.decimalSeparator,
    csvDelimiter: layout.csvDelimiter ?? "",
    counterparty: layout.counterparty ?? "",
    currency: layout.currency ?? "",
    documentDateLabel: layout.documentDateLabel ?? "",
    remarkColumns: [...layout.remarkColumns],
    totalsText: {
      [ImportMode.Summary]: (
        layout.statedTotalLabels[ImportMode.Summary] ?? []
      ).join("\n"),
      [ImportMode.EveryTransaction]: (
        layout.statedTotalLabels[ImportMode.EveryTransaction] ?? []
      ).join("\n"),
    },
    balanceColumn: layout.balanceColumn ?? "",
  };
}

/** The headings a layout form names, for the column choices. */
export function layoutHeadings(layout: LayoutForm | null): string[] {
  return layout ? linesOf(layout.headersText) : [];
}

function conditionPayload(condition: ConditionForm): Record<string, unknown> {
  const out: Record<string, unknown> = {
    column: condition.column,
    op: condition.op,
  };
  if (["is", "is_not", "contains"].includes(condition.op)) {
    out.value = condition.value;
  } else if (condition.op === "is_one_of") {
    out.values = linesOf(condition.valuesText);
  }
  return out;
}

function rowsPayload(rows: RowsForm): Record<string, unknown> {
  return {
    where: rows.where.map(conditionPayload),
    flagWhen: rows.flagWhen.map(conditionPayload),
    flagNote: rows.flagNote,
    feeTypeColumn: rows.feeTypeColumn || null,
  };
}

function layoutPayload(layout: LayoutForm): Record<string, unknown> {
  const statedTotalLabels: Record<string, string[]> = {};
  for (const mode of PROFILE_SECTION_MODES) {
    const labels = linesOf(layout.totalsText[mode] ?? "");
    if (labels.length) statedTotalLabels[mode] = labels;
  }
  const directionIn = linesOf(layout.directionInText);
  const directionOut = linesOf(layout.directionOutText);
  return {
    sheet: layout.sheet || null,
    headers: linesOf(layout.headersText),
    columns: {
      date: layout.date,
      description: layout.description,
      amount: layout.amount,
      reference: layout.reference || null,
    },
    dateFormat: layout.dateFormat,
    // Sent when any part of it is filled in, so a direction with values but
    // no column is reported rather than dropped.
    direction:
      layout.directionColumn || directionIn.length || directionOut.length
        ? {
            column: layout.directionColumn,
            in: directionIn,
            out: directionOut,
          }
        : null,
    decimalSeparator: layout.decimalSeparator,
    csvDelimiter: layout.csvDelimiter || null,
    counterparty: layout.counterparty || null,
    currency: layout.currency || null,
    documentDateLabel: layout.documentDateLabel || null,
    remarkColumns: layout.remarkColumns,
    statedTotalLabels,
    balanceColumn: layout.balanceColumn || null,
  };
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
    counterAccountId: null,
    rows: null,
    sameMoneyAs: [],
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
    accountId: null,
    layout: null,
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
    accountId: draft.accountId ?? null,
    layout: draft.layout ? layoutForm(draft.layout) : null,
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
        valuesText: (feeType.values ?? []).join("\n"),
      })),
      extrasText: section.extras ? JSON.stringify(section.extras, null, 2) : "",
      counterAccountId: section.counterAccountId ?? null,
      rows: section.rows ? rowsForm(section.rows) : null,
      sameMoneyAs: [...(section.sameMoneyAs ?? [])],
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
    accountId: form.accountId,
    // Sent only when there is one, as a profile without one is saved.
    ...(form.layout ? { layout: layoutPayload(form.layout) } : {}),
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
        ...(linesOf(feeType.valuesText).length
          ? { values: linesOf(feeType.valuesText) }
          : {}),
      })),
      extras: section.extrasText,
      // Sent only for a transfer, the one kind that names it.
      ...(section.kind === "transfer"
        ? { counterAccountId: section.counterAccountId }
        : {}),
      ...(section.rows ? { rows: rowsPayload(section.rows) } : {}),
      // Never for a transfer, which the editor gives no such field (FR-066).
      ...(section.kind !== "transfer" && section.sameMoneyAs.length
        ? { sameMoneyAs: section.sameMoneyAs }
        : {}),
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
