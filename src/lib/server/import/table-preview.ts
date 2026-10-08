/**
 * A preview of how a profile reads a sample spreadsheet from its columns (006
 * FR-053 to FR-055), for the profile editor: where the table was found, the
 * first rows as items, how many rows each section took and how many were left
 * out, and any reason the reading would fail. In a profile where the AI
 * reads some sections beside the table (FR-057), only the table is read: the
 * preview never calls the AI, and names the sections it leaves to it.
 *
 * It is the reading itself (`readFromColumns`) run on a file that is never
 * stored, with a profile that is never saved, so what the preview shows is
 * what an upload would give. Nothing here writes to the database or to
 * storage: the caller hands in the bytes and gets back plain values.
 */

import { DocumentTypeLabels, type DocumentTypeCode } from "$lib/enums.js";
import {
  checkTablePreview,
  nameFromKey,
  profileSections,
  type ProfileError,
} from "$lib/import-profile-schema.js";
import { type ImportModeValue } from "$lib/import-reading.js";
import { readCsv } from "../extraction/spreadsheet/csv.js";
import { renderWorkbook } from "../extraction/spreadsheet/render.js";
import {
  SpreadsheetError,
  type Workbook,
} from "../extraction/spreadsheet/types.js";
import { readXlsx } from "../extraction/spreadsheet/xlsx.js";
import { savedReadingProfile } from "./profile-compiler.js";
import { profileSheet } from "./profile-sheet.js";
import { readFromColumns, readTable, TableReadError } from "./table-reader.js";
import { DocumentLimitError } from "./document-reader.js";

/** How many items the preview lists. */
export const PREVIEW_ROWS = 10;

/** One item as the preview lists it. */
export interface PreviewItem {
  /** The spreadsheet's own row number, as Excel shows it. */
  row: number | null;
  section: string;
  /** "expense", "income", "transfer_out" or "transfer_in". */
  kind: string;
  date: string;
  description: string;
  /** Whole cents, without a sign: the kind says which way. */
  amountMinor: number;
  reference: string;
  /** The line type's name, or null with none. */
  feeType: string | null;
  /** The reviewer's note from the section's flag rule, or null. */
  note: string | null;
}

export interface TablePreview {
  /** The profile's import mode, which the preview reads in (FR-032). */
  mode: ImportModeValue;
  sheet: string;
  /** The Excel row number of the headings. */
  headerRow: number;
  /** The table's rows, from below the headings to the first blank row. */
  rows: number;
  /**
   * How many items each section read from the table took, in the profile's
   * order.
   */
  sections: { key: string; name: string; kind: string; count: number }[];
  /**
   * The sections the AI reads from the rest of the sheet (FR-057), which the
   * preview does not read. Their items are not in `items` or the totals.
   */
  aiSections: string[];
  items: PreviewItem[];
  /** All the items, not only those listed. */
  itemCount: number;
  /** How many rows were left out, and a few of them. */
  ignoredCount: number;
  ignored: string[];
  /** The stated total and the items' total, both signed, in whole cents. */
  statedTotalMinor: number | null;
  itemsTotalMinor: number;
  balance: { matches: boolean; message: string } | null;
}

export type PreviewResult =
  | { ok: true; preview: TablePreview; unsaved: ProfileError[] }
  | { ok: false; error: string; errors?: ProfileError[] };

/** The sample's cells, or why they cannot be read. */
function workbookOf(
  bytes: Uint8Array,
  type: "xlsx" | "csv",
  delimiter: string | undefined,
): Workbook | string {
  try {
    return type === "xlsx" ? readXlsx(bytes) : readCsv(bytes, { delimiter });
  } catch (error) {
    if (error instanceof SpreadsheetError) return error.message;
    throw error;
  }
}

/**
 * Reads `bytes` with the profile being edited, as an upload with it would be
 * read, and says what it found. `profileInput` is the editor's payload, which
 * need not be ready to save: only the layout and the row rules must be
 * complete (`checkTablePreview`). It is read in the profile's own import
 * mode, as every document read with it is.
 */
export function previewTable(
  profileInput: unknown,
  file: { bytes: Uint8Array; type: "xlsx" | "csv" },
  options: { mainCurrency: string; today: string },
): PreviewResult {
  const checked = checkTablePreview(profileInput);
  if (!checked.ok) {
    return {
      ok: false,
      error:
        "The table layout or a section's row rules need fixing before the sample can be read.",
      errors: checked.errors,
    };
  }
  const { profile } = checked;
  const { mode } = profile;
  const read = profileSections(profile).filter((section) => section.rows);
  const aiSections = profileSections(profile)
    .filter((section) => !section.rows)
    .map((section) => section.name || section.key);

  const fileWorkbook = workbookOf(
    file.bytes,
    file.type,
    profile.layout.csvDelimiter ?? undefined,
  );
  if (typeof fileWorkbook === "string") {
    return { ok: false, error: fileWorkbook };
  }

  const table = {
    name: profile.name || "this profile",
    mode,
    layout: profile.layout,
    sections: profile.sections,
  };
  // The one sheet the profile reads, as the reading itself cuts it (FR-069).
  const picked = profileSheet(
    fileWorkbook,
    { name: table.name, sheet: profile.sheet },
    profile.layout.headers,
  );
  if ("refused" in picked) return { ok: false, error: picked.refused };
  const { workbook } = picked;
  let found;
  let reading;
  try {
    found = readTable(workbook, table, options.mainCurrency);
    reading = readFromColumns(
      workbook,
      table,
      savedReadingProfile({ ...profile, id: 0 }),
      {
        today: options.today,
        mainCurrency: options.mainCurrency,
        schemaId: "preview",
      },
    );
  } catch (error) {
    if (error instanceof TableReadError || error instanceof DocumentLimitError)
      return { ok: false, error: error.message };
    throw error;
  }

  // Each item's line in the text back to the row number Excel shows.
  const rowOfLine = new Map<number, number>();
  for (const rendered of renderWorkbook(workbook).rows) {
    rowOfLine.set(rendered.line, rendered.rowNumber);
  }
  const names = new Map(read.map((s) => [s.key, s.name || s.key]));
  const counts = new Map<string, number>();
  for (const item of reading.items) {
    counts.set(item.sectionKey, (counts.get(item.sectionKey) ?? 0) + 1);
  }
  const kindLabel = (code: DocumentTypeCode) =>
    DocumentTypeLabels[code] ?? "expense";

  return {
    ok: true,
    unsaved: checked.unsaved,
    preview: {
      mode,
      sheet: found.found.sheet,
      headerRow: found.found.headerRow,
      rows: found.found.rows,
      sections: read.map((section) => ({
        key: section.key,
        name: section.name || section.key,
        kind: section.kind,
        count: counts.get(section.key) ?? 0,
      })),
      aiSections,
      items: reading.items.slice(0, PREVIEW_ROWS).map((item) => ({
        row:
          item.sourceLine === null
            ? null
            : (rowOfLine.get(item.sourceLine) ?? null),
        section: names.get(item.sectionKey) ?? item.sectionKey,
        kind: kindLabel(item.kind),
        date: item.date,
        description: item.description,
        amountMinor: item.amountMinor,
        reference: item.reference,
        feeType: item.feeType
          ? item.feeTypeName || nameFromKey(item.feeType)
          : null,
        note: item.reviewNote,
      })),
      itemCount: reading.items.length,
      ignoredCount: reading.notes.ignoredCount ?? reading.notes.ignored.length,
      ignored: reading.notes.ignored.slice(0, 5),
      statedTotalMinor: reading.notes.statedTotal?.minor ?? null,
      itemsTotalMinor: reading.notes.itemsTotalMinor,
      balance: reading.notes.balance ?? null,
    },
  };
}
