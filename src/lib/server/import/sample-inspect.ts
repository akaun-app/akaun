/**
 * A look at a sample spreadsheet, for building an import profile's table from
 * it (006 FR-053): where the table is, its first rows, the values each column
 * holds, and a guess at what each column is for. The editor shows the table
 * and lets the user correct the guesses (`$lib/import-profile-sample.ts`).
 *
 * Nothing is stored and nothing reads the database: the caller hands in the
 * bytes and gets back plain values. Where the table ends is the reading's own
 * rule (`tableDataRows`), so what the editor shows is what an upload reads.
 */

import {
  foldTableText,
  TABLE_DATE_FORMATS,
  type TableDateFormat,
} from "$lib/import-profile-schema.js";
import {
  SAMPLE_DISTINCT_MAX,
  SAMPLE_ROWS,
  type SampleColumn,
  type SampleGuess,
  type SampleInspection,
  type SampleLabel,
} from "$lib/import-profile-sample.js";
import { readCsv } from "../extraction/spreadsheet/csv.js";
import {
  cellText,
  SpreadsheetError,
  type CellValue,
  type Sheet,
  type SheetRow,
  type Workbook,
} from "../extraction/spreadsheet/types.js";
import { readXlsx } from "../extraction/spreadsheet/xlsx.js";
import {
  parseTableAmount,
  parseTableDate,
  tableDataRows,
} from "./table-reader.js";

/** How far down a sheet the heading row is looked for. */
const HEADER_SEARCH_ROWS = 60;
/** Most labels outside the table sent back. */
const LABELS_MAX = 20;

/** Where to look, when the user has said; else the guess is used. */
export interface SampleChoice {
  sheet?: string | null;
  headerRow?: number | null;
}

export type SampleResult =
  | { ok: true; sample: SampleInspection }
  | { ok: false; error: string };

const text = (cell: CellValue | null | undefined) => cellText(cell).trim();

function isDateCell(cell: CellValue | null | undefined): boolean {
  if (!cell) return false;
  if (cell.kind === "date") return parseTableDate(cell, "YYYY-MM-DD") !== null;
  if (cell.kind !== "string") return false;
  return TABLE_DATE_FORMATS.some((format) => parseTableDate(cell, format));
}

function isAmountCell(cell: CellValue | null | undefined): boolean {
  if (!cell) return false;
  if (cell.kind === "number") return true;
  if (cell.kind !== "string") return false;
  return (
    parseTableAmount(cell.text, ".").ok || parseTableAmount(cell.text, ",").ok
  );
}

/** A cell that reads as a heading: text that is neither a date nor a number. */
function isHeadingCell(cell: CellValue | null | undefined): boolean {
  return (
    cell?.kind === "string" &&
    cell.text.trim() !== "" &&
    !isDateCell(cell) &&
    !isAmountCell(cell)
  );
}

/**
 * The heading row of a sheet, or -1: of the rows with three or more headings
 * (two when they are all the row has) and a date or a number in the rows
 * under them, the one whose table looks most like transactions. A column of
 * dates counts most, then more rows, then more headings, so a short summary
 * block above the real table ("Total Money In 54.15") is passed over. On a
 * tie the higher row wins.
 */
function guessHeaderAt(sheet: Sheet): number {
  const limit = Math.min(sheet.rows.length, HEADER_SEARCH_ROWS);
  let best = -1;
  let bestScore = 0;
  for (let at = 0; at < limit; at++) {
    const row = sheet.rows[at];
    const filled = row.cells.filter((cell) => text(cell) !== "");
    const headings = row.cells.filter(isHeadingCell);
    const enough =
      headings.length >= 3 || (headings.length === 2 && filled.length === 2);
    if (!enough) continue;
    const below = tableDataRows(sheet, at).slice(0, 20);
    if (below.length === 0) continue;
    const cells = below.flatMap((data) => data.cells);
    if (!cells.some((cell) => isDateCell(cell) || isAmountCell(cell))) continue;
    const score =
      (cells.some(isDateCell) ? 2 : 0) +
      below.length / 20 +
      Math.min(headings.length, 10) / 10;
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  return best;
}

/** The column's values in the table, most rows first, or null past the cap. */
function distinctValues(
  rows: readonly SheetRow[],
  column: number,
): SampleColumn["distinct"] {
  const seen = new Map<string, { value: string; count: number }>();
  for (const row of rows) {
    const value = text(row.cells[column]);
    if (!value) continue;
    const key = foldTableText(value);
    const entry = seen.get(key);
    if (entry) entry.count++;
    else seen.set(key, { value, count: 1 });
    if (seen.size > SAMPLE_DISTINCT_MAX) return null;
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

function share(
  rows: readonly SheetRow[],
  column: number,
  test: (cell: CellValue | null | undefined) => boolean,
): number {
  let filled = 0;
  let hits = 0;
  for (const row of rows) {
    const cell = row.cells[column];
    if (!text(cell)) continue;
    filled++;
    if (test(cell)) hits++;
  }
  return filled === 0 ? 0 : hits / filled;
}

const named = (heading: string, pattern: RegExp) => pattern.test(heading);
const IN_WORDS = /\b(in|credit|cr|received|deposit|incoming|inflow)\b/i;
const OUT_WORDS =
  /\b(out|debit|dr|paid|withdrawal|withdraw|outgoing|outflow)\b/i;

/** What each column looks like it holds, from its cells, then its heading. */
function guessRoles(
  columns: readonly (SampleColumn & { index: number; avgLength: number })[],
  rows: readonly SheetRow[],
): Omit<SampleGuess, "csvDelimiter"> {
  const used = new Set<string>();
  const take = (heading: string | null | undefined) => {
    if (heading) used.add(heading);
    return heading ?? null;
  };
  const free = () => columns.filter((c) => !used.has(c.heading));

  const dates = free()
    .filter((c) => c.dateShare >= 0.6)
    .sort(
      (a, b) =>
        Number(named(b.heading, /date|time|created|posted/i)) -
          Number(named(a.heading, /date|time|created|posted/i)) ||
        b.dateShare - a.dateShare,
    );
  const date = take(dates[0]?.heading);

  const numeric = free().filter((c) => c.numberShare >= 0.8);
  const balance = take(
    numeric.find((c) => named(c.heading, /balance/i))?.heading,
  );
  const amounts = numeric.filter((c) => c.heading !== balance);
  const amount = take(
    (
      amounts.find((c) => named(c.heading, /amount|amt|value|total|sum/i)) ??
      amounts[0]
    )?.heading,
  );

  let direction: SampleGuess["direction"] = null;
  for (const column of free()) {
    const values = column.distinct ?? [];
    if (values.length !== 2) continue;
    const ins = values.filter(
      (v) => IN_WORDS.test(v.value) && !OUT_WORDS.test(v.value),
    );
    const outs = values.filter(
      (v) => OUT_WORDS.test(v.value) && !IN_WORDS.test(v.value),
    );
    if (ins.length === 1 && outs.length === 1) {
      direction = {
        column: column.heading,
        in: [ins[0].value],
        out: [outs[0].value],
      };
      take(column.heading);
      break;
    }
  }

  const texts = free().filter((c) => c.dateShare < 0.5 && c.numberShare < 0.5);
  const describing = /desc|detail|narrat|particular|memo|remark|item/i;
  const description = take(
    (
      texts.find((c) => named(c.heading, describing)) ??
      [...texts].sort((a, b) => b.avgLength - a.avgLength)[0]
    )?.heading,
  );
  const reference = take(
    free().find(
      (c) =>
        named(c.heading, /ref|order|invoice|\bid\b|\bno\b|number/i) &&
        c.numberShare < 1,
    )?.heading,
  );
  const sortable = free().filter(
    (c) => c.distinct !== null && c.distinct.length >= 2,
  );
  const sortBy =
    (
      sortable.find((c) => named(c.heading, /type|category|kind|class/i)) ??
      [...sortable].sort(
        (a, b) => (a.distinct?.length ?? 0) - (b.distinct?.length ?? 0),
      )[0]
    )?.heading ?? null;

  return {
    date,
    description,
    amount,
    reference,
    direction,
    balance,
    sortBy,
    dateFormat: guessDateFormat(rows, columns, date),
    decimalSeparator: guessDecimal(rows, columns, amount),
  };
}

/** The format that reads the most of the date column's text dates. */
function guessDateFormat(
  rows: readonly SheetRow[],
  columns: readonly { heading: string; index: number }[],
  date: string | null,
): TableDateFormat {
  const index = columns.find((c) => c.heading === date)?.index;
  if (index === undefined) return "YYYY-MM-DD";
  const cells = rows
    .map((row) => row.cells[index])
    .filter((cell) => cell?.kind === "string");
  if (cells.length === 0) return "YYYY-MM-DD";
  let best: TableDateFormat = "YYYY-MM-DD";
  let bestCount = 0;
  for (const format of TABLE_DATE_FORMATS) {
    const count = cells.filter((cell) => parseTableDate(cell, format)).length;
    if (count > bestCount) {
      best = format;
      bestCount = count;
    }
  }
  return best;
}

/** The separator that reads more of the amount column's text amounts. */
function guessDecimal(
  rows: readonly SheetRow[],
  columns: readonly { heading: string; index: number }[],
  amount: string | null,
): "." | "," {
  const index = columns.find((c) => c.heading === amount)?.index;
  if (index === undefined) return ".";
  let point = 0;
  let comma = 0;
  for (const row of rows) {
    const cell = row.cells[index];
    if (cell?.kind !== "string") continue;
    if (parseTableAmount(cell.text, ".").ok) point++;
    if (parseTableAmount(cell.text, ",").ok) comma++;
  }
  return comma > point ? "," : ".";
}

/** Labels outside the table with a value beside them. */
function labelsOutside(
  sheet: Sheet,
  headerAt: number,
  dataCount: number,
): SampleLabel[] {
  const outside = [
    ...sheet.rows.slice(0, headerAt),
    ...sheet.rows.slice(headerAt + 1 + dataCount),
  ];
  const labels: SampleLabel[] = [];
  for (const row of outside) {
    row.cells.forEach((cell, at) => {
      if (labels.length >= LABELS_MAX || !isHeadingCell(cell)) return;
      const next = row.cells.findIndex(
        (other, index) => index > at && text(other) !== "",
      );
      // Only a date or a figure: what a document's date or a stated total
      // is printed as.
      if (next < 0) return;
      const value = row.cells[next];
      if (!isDateCell(value) && !isAmountCell(value)) return;
      labels.push({
        label: text(cell),
        value: text(row.cells[next]),
        row: row.number,
      });
    });
  }
  return labels;
}

/** The sample's cells, or why they cannot be read. */
function workbookOf(
  bytes: Uint8Array,
  type: "xlsx" | "csv",
): Workbook | string {
  try {
    return type === "xlsx" ? readXlsx(bytes) : readCsv(bytes);
  } catch (error) {
    if (error instanceof SpreadsheetError) return error.message;
    throw error;
  }
}

/**
 * Looks at a sample spreadsheet. With no `choice`, the table is the first
 * heading row found, visible sheets first; with one, the named sheet and its
 * row with that number.
 */
export function inspectSample(
  bytes: Uint8Array,
  type: "xlsx" | "csv",
  choice: SampleChoice = {},
): SampleResult {
  const workbook = workbookOf(bytes, type);
  if (typeof workbook === "string") return { ok: false, error: workbook };

  const order = [...workbook.sheets].sort(
    (a, b) => Number(a.hidden === true) - Number(b.hidden === true),
  );
  let sheet: Sheet | undefined;
  let headerAt = -1;
  if (choice.sheet) {
    sheet = workbook.sheets.find(
      (s) => foldTableText(s.name) === foldTableText(choice.sheet!),
    );
    if (!sheet) {
      return { ok: false, error: `There is no sheet "${choice.sheet}".` };
    }
  }
  if (choice.headerRow != null) {
    const sheets = sheet ? [sheet] : order;
    for (const candidate of sheets) {
      const at = candidate.rows.findIndex(
        (row) => row.number === choice.headerRow,
      );
      if (at >= 0) {
        sheet = candidate;
        headerAt = at;
        break;
      }
    }
    if (headerAt < 0) {
      return {
        ok: false,
        error: `Row ${choice.headerRow} is empty or not on the sheet.`,
      };
    }
  } else {
    for (const candidate of sheet ? [sheet] : order) {
      headerAt = guessHeaderAt(candidate);
      if (headerAt >= 0) {
        sheet = candidate;
        break;
      }
    }
  }
  if (!sheet || headerAt < 0) {
    return {
      ok: false,
      error:
        "No table was found: no row of headings with dates or amounts below it. Choose the heading row yourself.",
    };
  }

  const headerCells = sheet.rows[headerAt].cells;
  const seen = new Set<string>();
  const indexed: { heading: string; index: number }[] = [];
  headerCells.forEach((cell, index) => {
    const heading = text(cell);
    const key = foldTableText(heading);
    if (!heading || seen.has(key)) return;
    seen.add(key);
    indexed.push({ heading, index });
  });
  const dataRows = tableDataRows(sheet, headerAt);
  const columns = indexed.map(({ heading, index }) => {
    const lengths = dataRows.map((row) => text(row.cells[index]).length);
    return {
      heading,
      index,
      distinct: distinctValues(dataRows, index),
      dateShare: share(dataRows, index, isDateCell),
      numberShare: share(dataRows, index, isAmountCell),
      avgLength: lengths.length
        ? lengths.reduce((a, b) => a + b, 0) / lengths.length
        : 0,
    };
  });

  const guess: SampleGuess = {
    ...guessRoles(columns, dataRows),
    csvDelimiter: null,
  };
  return {
    ok: true,
    sample: {
      format: workbook.format,
      sheets: workbook.sheets.map((s) => ({
        name: s.name,
        hidden: s.hidden === true,
      })),
      sheet: sheet.name,
      headerRow: sheet.rows[headerAt].number,
      rowCount: dataRows.length,
      headers: indexed.map((c) => c.heading),
      rows: dataRows
        .slice(0, SAMPLE_ROWS)
        .map((row) => indexed.map(({ index }) => text(row.cells[index]))),
      columns: columns.map(({ heading, distinct, dateShare, numberShare }) => ({
        heading,
        distinct,
        dateShare,
        numberShare,
      })),
      labels: labelsOutside(sheet, headerAt, dataRows.length),
      guess,
    },
  };
}
