/**
 * What a spreadsheet looks like once it has been read (006 S4.1): sheets of
 * rows of cells, the same shape whether it came from an `.xlsx` workbook or a
 * `.csv` file. Nothing here knows about records, money or the AI. Later steps
 * either render it to text for the AI (`render.ts`) or read it by its columns.
 */

/**
 * One cell's value.
 *
 * - `string`: text, as typed.
 * - `number`: `raw` is the number exactly as the file stores it (for example
 *   `712.40`), and `value` is that number. Money is later read from the text,
 *   never from `value`, so no binary rounding gets into an amount.
 * - `boolean`: TRUE or FALSE.
 * - `date`: a date or time, already written as `YYYY-MM-DD`,
 *   `YYYY-MM-DD HH:MM:SS` or `HH:MM:SS`. A workbook stores dates as a count of
 *   days, and only the cell's format says it is a date, so this is decided when
 *   the workbook is read.
 * - `error`: a formula error the file shows, such as `#N/A`.
 */
export type CellValue =
  | { kind: "string"; text: string }
  | { kind: "number"; raw: string; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "date"; text: string }
  | { kind: "error"; code: string };

/** One row. `number` is the row number a person sees in Excel (1 is the top). */
export interface SheetRow {
  number: number;
  /** Cells by column, 0 for column A. An empty cell is `null`. */
  cells: (CellValue | null)[];
}

export interface Sheet {
  name: string;
  /**
   * True for a sheet the workbook hides from view (hidden or "very hidden"
   * in Excel). It is still read: a hidden sheet's cells are part of the file,
   * and leaving them out would drop lines without saying so (FR-010).
   */
  hidden?: boolean;
  /**
   * The rows that hold at least one cell, top to bottom. A row with nothing in
   * it is not listed, so a gap in `number` is a blank row.
   */
  rows: SheetRow[];
}

export interface Workbook {
  /** Where it came from. A CSV file is one sheet. */
  format: "xlsx" | "csv";
  sheets: Sheet[];
}

/**
 * A spreadsheet that cannot be read. The message is written for the person
 * who uploaded it: it says what is wrong and, where there is one, what to do.
 */
export class SpreadsheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpreadsheetError";
  }
}

/**
 * A value from the file, cut short for an error message. The file is not
 * trusted, and one value can be megabytes long.
 */
export function brief(value: string, max = 40): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Column letters for a 0-based column index: 0 is A, 26 is AA. */
export function columnName(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/**
 * A number written out in full, with no exponent and no trailing zeros, to 15
 * significant digits: the precision Excel itself shows. A workbook sometimes
 * stores a sum as `0.30000000000000004`; this gives `0.3`, which is what the
 * person sees in Excel.
 */
export function plainNumber(value: number): string {
  if (value === 0) return "0";
  if (!Number.isFinite(value)) return String(value);
  let text = value.toPrecision(15);
  const exp = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (exp) {
    const [, sign, lead, tail = "", power] = exp;
    const digits = lead + tail;
    const point = 1 + Number(power);
    if (point <= 0) text = `${sign}0.${"0".repeat(-point)}${digits}`;
    else if (point >= digits.length)
      text = `${sign}${digits}${"0".repeat(point - digits.length)}`;
    else text = `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/**
 * A number cell as text: as the file writes it (`712.40` stays `712.40`) when
 * that is a plain decimal Excel would show in full, else `plainNumber`.
 */
function numberText(raw: string, value: number): string {
  const plain = /^-?(\d+)(?:\.(\d+))?$/.exec(raw);
  if (plain) {
    const digits = (plain[1] + (plain[2] ?? "")).replace(/^0+/, "");
    if (digits.length <= 15) return value === 0 ? raw.replace(/^-/, "") : raw;
  }
  return plainNumber(value);
}

/**
 * A cell as one line of text: what rendering shows and what a column reading
 * starts from. A line break inside a cell becomes a space, so one row is
 * always one line. An empty cell gives "".
 */
export function cellText(cell: CellValue | null | undefined): string {
  if (!cell) return "";
  switch (cell.kind) {
    case "string":
      return cell.text.replace(/\r\n|\r|\n/g, " ");
    case "number":
      return numberText(cell.raw, cell.value);
    case "boolean":
      return cell.value ? "TRUE" : "FALSE";
    case "date":
      return cell.text;
    case "error":
      return cell.code;
  }
}

/**
 * Whether a row shows nothing: every cell is empty or only spaces. This is the
 * one definition of a blank row. The text rendering leaves such a row out,
 * so it has no line number, and a table read from its columns ends at the
 * first one (FR-055). A row the file does not list at all is blank too.
 */
export function isBlankRow(row: Pick<SheetRow, "cells">): boolean {
  return row.cells.every((cell) => cellText(cell).trim() === "");
}
