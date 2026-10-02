/**
 * A spreadsheet as text (006 S4.1), for the two places that need text rather
 * than cells:
 *
 * - **the AI reading**, when no profile says which column is which. Each sheet
 *   is one page that starts with `Sheet: <name>`, and each row is one line with
 *   its cells joined by ` | `, so the columns still line up by position. The
 *   pages go to `numberDocumentLines` exactly like a PDF's, so every row gets a
 *   line number the reviewer can find.
 * - **recognition phrases** (`detectionText`), which only need the words.
 *
 * Dates are already written as `YYYY-MM-DD` or `YYYY-MM-DD HH:MM:SS` in the
 * cells (see `xlsx.ts`); numbers are written in full, as Excel shows them.
 */

import { cellText, type Sheet, type Workbook } from "./types.js";

/** Where one row went in the text. */
export interface RenderedRow {
  /** The sheet's position in the workbook, 0 for the first. */
  sheetIndex: number;
  /** The row number in the sheet, as Excel shows it. */
  rowNumber: number;
  /**
   * The line number `numberDocumentLines` gives this row when it numbers
   * `pages`: the `L0012` of the line.
   */
  line: number;
}

export interface RenderedWorkbook {
  /** One page per sheet, ready for `numberDocumentLines`. */
  pages: string[];
  /** Every row that has text, in order. A row with no text has no line. */
  rows: RenderedRow[];
}

/** White space other than a plain space, which would break one row into two lines. */
function oneLine(text: string): string {
  return text.replace(/[\r\n\t\v\f\u2028\u2029]+/g, " ");
}

/** The row's cells joined by ` | `, with the empty cells after the last one left off. */
function rowLine(cells: readonly string[]): string {
  let end = cells.length;
  while (end > 0 && cells[end - 1].trim() === "") end--;
  return cells.slice(0, end).join(" | ");
}

export function sheetHeading(sheet: Sheet): string {
  return `Sheet: ${oneLine(sheet.name).trim() || "(no name)"}`;
}

/**
 * The workbook as pages of text, one per sheet. Each line written is never
 * blank, so `numberDocumentLines` gives each one the next number, and the
 * heading line of each sheet is numbered too. That is how `rows` knows each
 * row's line without numbering the text itself.
 */
export function renderWorkbook(workbook: Workbook): RenderedWorkbook {
  const pages: string[] = [];
  const rows: RenderedRow[] = [];
  let line = 0;
  workbook.sheets.forEach((sheet, sheetIndex) => {
    const lines = [sheetHeading(sheet)];
    line++;
    for (const row of sheet.rows) {
      const text = rowLine(
        row.cells.map((cell) => oneLine(cellText(cell))),
      ).trimEnd();
      if (text.trim() === "") continue;
      lines.push(text);
      line++;
      rows.push({ sheetIndex, rowNumber: row.number, line });
    }
    pages.push(lines.join("\n"));
  });
  return { pages, rows };
}

/**
 * Every word in the workbook, for matching recognition phrases: each sheet's
 * name, then each row's cells separated by spaces. Phrase matching ignores
 * case and spacing, so a phrase is found even when it spans two cells.
 */
export function detectionText(workbook: Workbook): string {
  const lines: string[] = [];
  for (const sheet of workbook.sheets) {
    lines.push(sheetHeading(sheet));
    for (const row of sheet.rows) {
      const text = row.cells
        .map((cell) => oneLine(cellText(cell)).trim())
        .filter((value) => value !== "")
        .join(" ");
      if (text) lines.push(text);
    }
  }
  return lines.join("\n");
}
