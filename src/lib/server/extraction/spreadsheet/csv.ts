/**
 * Reading a `.csv` file into one sheet of cells (006 S4.1).
 *
 * A CSV file says nothing about itself, so three things are worked out:
 *
 * 1. **The characters.** A byte order mark says UTF-8 or UTF-16. Without one,
 *    the file is read as UTF-8 if it is valid UTF-8, and otherwise as
 *    Windows-1252, which is what Excel on Windows writes for "CSV".
 * 2. **The separator.** Excel's own `sep=;` first line is honoured. Otherwise
 *    each of comma, semicolon, tab and bar is tried on the start of the file,
 *    and the one that splits the most lines into the same number of cells
 *    wins. A caller that knows the separator passes it.
 * 3. **Quoting**, as RFC 4180 sets it out: a quoted cell may hold the
 *    separator, a line break or a doubled quote. Rows may have different
 *    numbers of cells.
 *
 * Every cell is text. Nothing is turned into a number or a date here; a
 * column reading does that, knowing which column is which.
 */

import {
  SpreadsheetError,
  brief,
  type Sheet,
  type SheetRow,
  type Workbook,
} from "./types.js";

export interface CsvLimits {
  maxRows: number;
  /** The most cells one row may have. */
  maxCellsPerRow: number;
  /** The most characters one cell may hold. */
  maxCellLength: number;
  maxCells: number;
}

/** Excel's own row width and cell length, and the same row and cell budget as a workbook. */
export const CSV_LIMITS: CsvLimits = {
  maxRows: 200_000,
  maxCellsPerRow: 16_384,
  maxCellLength: 32_767,
  maxCells: 5_000_000,
};

export interface CsvOptions {
  /** The separator, when it is known. Otherwise it is worked out. */
  delimiter?: string;
  /** The name the one sheet is given. */
  sheetName?: string;
  limits?: CsvLimits;
}

export const CSV_DELIMITERS = [",", ";", "\t", "|"] as const;

/** The file's bytes as text, by its byte order mark, else UTF-8, else Windows-1252. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      bytes.subarray(3),
    );
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le", { ignoreBOM: true }).decode(
      bytes.subarray(2),
    );
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be", { ignoreBOM: true }).decode(
      bytes.subarray(2),
    );
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

interface CsvRecord {
  /** The row number a person sees when the file is opened in Excel. */
  number: number;
  fields: string[];
}

interface ParseResult {
  records: CsvRecord[];
  /** Where an unclosed quote started, when `lenient` let it through. */
  unclosedAt: number | null;
}

/**
 * Splits the text into rows of cells. A row with nothing on it is left out
 * but still counted, so row numbers stay the ones Excel shows.
 */
function parseRecords(
  text: string,
  delimiter: string,
  limits: CsvLimits,
  lenient: boolean,
): ParseResult {
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let fieldStarted = false;
  let rowNumber = 1;
  let quoteRow = 0;
  let cells = 0;
  const length = text.length;

  const endField = () => {
    if (field.length > limits.maxCellLength) {
      throw new SpreadsheetError(
        `Row ${rowNumber} of the file has a cell longer than ${limits.maxCellLength.toLocaleString("en")} characters, which is more than can be read.`,
      );
    }
    fields.push(field);
    if (fields.length > limits.maxCellsPerRow) {
      throw new SpreadsheetError(
        `Row ${rowNumber} of the file has more than ${limits.maxCellsPerRow.toLocaleString("en")} cells, which is more than can be read.`,
      );
    }
    field = "";
    fieldStarted = false;
  };
  const endRecord = (nextRowNumber: number) => {
    endField();
    if (fields.some((f) => f !== "")) {
      if (records.length >= limits.maxRows) {
        throw new SpreadsheetError(
          `The file has more than ${limits.maxRows.toLocaleString("en")} rows, which is more than can be read.`,
        );
      }
      cells += fields.length;
      if (cells > limits.maxCells) {
        throw new SpreadsheetError(
          `The file has more than ${limits.maxCells.toLocaleString("en")} cells, which is more than can be read.`,
        );
      }
      records.push({ number: rowNumber, fields });
    }
    fields = [];
    rowNumber = nextRowNumber;
  };

  let i = 0;
  while (i < length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      // A line break inside quotes is part of the cell; Excel still shows the
      // cell on one row, so the row count does not move.
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true;
      fieldStarted = true;
      quoteRow = rowNumber;
      i++;
      continue;
    }
    if (ch === delimiter) {
      endField();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      endRecord(rowNumber + 1);
      continue;
    }
    // Text after a closing quote, or a quote in the middle of a cell, is kept
    // as it is, the way Excel opens such a file.
    field += ch;
    fieldStarted = true;
    i++;
  }
  if (quoted && !lenient) {
    throw new SpreadsheetError(
      `The file cannot be read: a quoted cell that starts on row ${quoteRow} is never closed.`,
    );
  }
  if (field !== "" || fields.length > 0 || quoted) endRecord(rowNumber + 1);
  return { records, unclosedAt: quoted ? quoteRow : null };
}

/**
 * The separator that splits the start of the file most evenly: the one for
 * which the most rows have the same number of cells, more than one. A comma
 * when none of them splits anything.
 *
 * A wrong separator can make a cell look far too long (with `|` on a comma
 * file, each whole line is one cell), so each trial runs without the cell
 * length and row width limits, and a trial that still hits a limit only
 * means that separator does not fit. The real limits apply when the file is
 * read with the separator chosen.
 */
export function detectDelimiter(
  text: string,
  limits: CsvLimits = CSV_LIMITS,
): string {
  const sample = text.slice(0, 64 * 1024);
  const cutShort = sample.length < text.length;
  const trialLimits: CsvLimits = {
    ...limits,
    maxCellLength: Number.POSITIVE_INFINITY,
    maxCellsPerRow: Number.POSITIVE_INFINITY,
  };
  let best: { delimiter: string; rows: number; width: number } = {
    delimiter: ",",
    rows: 0,
    width: 1,
  };
  for (const delimiter of CSV_DELIMITERS) {
    let trial: ParseResult;
    try {
      trial = parseRecords(sample, delimiter, trialLimits, true);
    } catch (error) {
      if (error instanceof SpreadsheetError) continue;
      throw error;
    }
    const { records, unclosedAt } = trial;
    // The last row of a cut-off sample may be cut too.
    const rows =
      cutShort || unclosedAt !== null ? records.slice(0, -1) : records;
    const counts = new Map<number, number>();
    for (const record of rows) {
      if (record.fields.length > 1)
        counts.set(
          record.fields.length,
          (counts.get(record.fields.length) ?? 0) + 1,
        );
    }
    for (const [width, count] of counts) {
      if (count > best.rows || (count === best.rows && width > best.width)) {
        best = { delimiter, rows: count, width };
      }
    }
  }
  return best.delimiter;
}

/** Excel's `sep=;` line, which names the separator and is not part of the data. */
const SEP_LINE = /^"?sep=(.)"?[ \t]*(?:\r\n|\r|\n|$)/i;

export function readCsv(bytes: Uint8Array, options: CsvOptions = {}): Workbook {
  const limits = options.limits ?? CSV_LIMITS;
  let text = decodeCsvBytes(bytes);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  let delimiter = options.delimiter;
  const sepLine = SEP_LINE.exec(text);
  if (sepLine) {
    text = text.slice(sepLine[0].length);
    delimiter ??= sepLine[1];
  }
  if (
    delimiter !== undefined &&
    (delimiter.length !== 1 || delimiter === '"' || /[\r\n]/.test(delimiter))
  ) {
    throw new SpreadsheetError(
      `"${brief(delimiter)}" cannot be used to separate the cells of a CSV file.`,
    );
  }
  delimiter ??= detectDelimiter(text, limits);

  const { records } = parseRecords(text, delimiter, limits, false);
  const rows: SheetRow[] = records.map((record) => ({
    number: record.number,
    cells: trimEmptyEnd(record.fields).map((field) =>
      field === "" ? null : { kind: "string", text: field },
    ),
  }));
  const sheet: Sheet = { name: options.sheetName ?? "Sheet1", rows };
  return { format: "csv", sheets: [sheet] };
}

function trimEmptyEnd(fields: string[]): string[] {
  let end = fields.length;
  while (end > 0 && fields[end - 1] === "") end--;
  return fields.slice(0, end);
}
