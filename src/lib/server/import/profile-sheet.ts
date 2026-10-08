/**
 * The one sheet of a workbook an import profile reads (006 FR-069).
 *
 * A marketplace report is often a workbook of several sheets: a summary, the
 * orders, the fees. They are mostly different views of the same money, and
 * one file is imported one way only (FR-026), so a profile reads one sheet,
 * and its table and its AI part alike see that sheet and no other. The AI is
 * then never sent the order rows of a profile that wants the summary, nor
 * the summary beside the orders it already adds up.
 *
 * Which sheet:
 *
 * - **The file has one sheet** (every CSV file, and many exports): that
 *   sheet, whatever its name, so a profile made from a workbook of several
 *   sheets still reads the same report exported as CSV.
 * - **The profile names one:** that sheet, matched as `sheetNamed` matches
 *   it. A workbook without it is refused, naming the sheets it has.
 * - **It names none and reads a table:** the sheet the table's headings are
 *   on (`findTable`). When no sheet has them, the whole workbook is kept, and
 *   the table reader says the table was not found.
 * - **It names none and the AI reads it:** the first visible sheet with
 *   something in it, so a blank sheet or a cover with only a logo is passed
 *   over.
 *
 * This file is the one place the rule is written: the reading, the preview
 * and Auto-detect all ask it.
 */

import { guessHeaderAt } from "./sample-inspect.js";
import { findTable, sheetNamed } from "./table-reader.js";
import { lineOfRow, sheetHead } from "../extraction/spreadsheet/render.js";
import {
  brief,
  isBlankRow,
  type Sheet,
  type Workbook,
} from "../extraction/spreadsheet/types.js";
import { foldTableText } from "$lib/import-profile-schema.js";

/** The sheet a profile reads, and the workbook cut down to it. */
export interface ProfileSheet {
  /** The workbook with only the sheet read. */
  workbook: Workbook;
  /** The sheet's name. */
  name: string;
  /** How many sheets the file has. */
  of: number;
}

/** As much of a profile as the choice of its sheet needs. */
export interface SheetProfile {
  name: string;
  sheet?: string | null;
}

/** The sheets of a workbook as a reader finds them, for a message. */
function sheetList(workbook: Workbook): string {
  return workbook.sheets
    .map((sheet) => `"${brief(sheet.name)}"${sheet.hidden ? " (hidden)" : ""}`)
    .join(", ");
}

/** Whether a sheet has anything in its cells. */
function hasContent(sheet: Sheet): boolean {
  return sheet.rows.some((row) => !isBlankRow(row));
}

/**
 * Why a profile cannot read this workbook's sheet, or null when it can: the
 * sheet it names is not there, in a workbook of several sheets. Auto-detect
 * leaves such a profile out.
 */
export function missingSheet(
  workbook: Workbook,
  profile: SheetProfile,
): string | null {
  if (
    !profile.sheet ||
    workbook.sheets.length <= 1 ||
    sheetNamed(workbook, profile.sheet)
  ) {
    return null;
  }
  return `The import profile "${profile.name}" reads the sheet "${brief(profile.sheet)}", and this workbook has no sheet of that name. Its sheets are: ${sheetList(workbook)}.`;
}

/**
 * The sheet a profile reads in this workbook, with the workbook cut down to
 * it, or the reason it cannot be read. `headers` are the headings of the
 * profile's table, when it reads one by code: they find the sheet when the
 * profile names none.
 */
export function profileSheet(
  workbook: Workbook,
  profile: SheetProfile,
  headers: readonly string[] | null,
): ProfileSheet | { refused: string } {
  const of = workbook.sheets.length;
  const whole: ProfileSheet = { workbook, name: "", of };
  const keep = (sheet: Sheet): ProfileSheet => ({
    workbook: of === 1 ? workbook : { ...workbook, sheets: [sheet] },
    name: sheet.name,
    of,
  });

  if (of <= 1) return of === 1 ? keep(workbook.sheets[0]) : whole;
  if (profile.sheet) {
    const named = sheetNamed(workbook, profile.sheet);
    return named ? keep(named) : { refused: missingSheet(workbook, profile)! };
  }
  if (headers) {
    const found = findTable(workbook, headers);
    // Not found: the table reader says so, naming the headings.
    return found ? keep(found.sheet) : whole;
  }
  const visible = workbook.sheets.filter((sheet) => !sheet.hidden);
  const first = visible.find(hasContent) ?? visible[0] ?? workbook.sheets[0];
  return keep(first);
}

/**
 * Whether the profile's table is in this workbook, on the sheet the profile
 * reads: Auto-detect's first and cheapest test of a spreadsheet (US10 AS12).
 */
export function hasProfileTable(
  workbook: Workbook,
  profile: SheetProfile,
  headers: readonly string[],
): boolean {
  const picked = profileSheet(workbook, profile, headers);
  return !("refused" in picked) && findTable(picked.workbook, headers) !== null;
}

/**
 * The start of the sheets, for Auto-detect's AI call (FR-039): the `budget`
 * characters it is shown, shared out so that a report whose first sheet is a
 * long summary still shows the call what its other sheets are. A sheet
 * shorter than its share leaves the rest to the others. Each sheet's text
 * starts with its "Sheet: <name>" line. The visible sheets are shown, and a
 * hidden one only when a profile names it (`named`). No sheet is turned into
 * more text than the whole budget.
 */
export function sheetsHead(
  workbook: Workbook,
  budget: number,
  named: readonly string[] = [],
): string {
  const wanted = new Set(named.map(foldTableText));
  const shown = workbook.sheets.filter(
    (sheet) => !sheet.hidden || wanted.has(foldTableText(sheet.name)),
  );
  const pages = (shown.length > 0 ? shown : workbook.sheets).map((sheet) =>
    sheetHead(sheet, budget),
  );
  // The line breaks between the sheets are part of the budget.
  let left = Math.max(0, budget - (pages.length - 1));
  const take = pages.map(() => 0);
  const shortestFirst = pages
    .map((page, index) => ({ index, length: page.length }))
    .sort((a, b) => a.length - b.length);
  shortestFirst.forEach(({ index, length }, done) => {
    const share = Math.floor(left / (pages.length - done));
    take[index] = Math.min(length, share);
    left -= take[index];
  });
  return pages.map((page, index) => page.slice(0, take[index])).join("\n");
}

/**
 * The lines of a one-sheet workbook's text that say what its columns are:
 * its "Sheet:" line, and its column-heading row. `headerRow` is that row's
 * number when the table reader found it; otherwise `guessHeaderAt` guesses
 * it, and none is given when it finds none. Every piece of a long reading is
 * shown them (`PieceReadOptions.pinned`). None for a workbook of several
 * sheets, whose sheets each have their own.
 */
export function headingLines(
  workbook: Workbook,
  headerRow: number | null = null,
): number[] {
  if (workbook.sheets.length !== 1) return [];
  const [sheet] = workbook.sheets;
  let row = headerRow;
  if (row === null) {
    const at = guessHeaderAt(sheet);
    row = at >= 0 ? sheet.rows[at].number : null;
  }
  const line = row === null ? null : lineOfRow(sheet, row);
  // The "Sheet:" line is the first of the text.
  return line === null ? [1] : [1, line];
}
