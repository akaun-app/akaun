/**
 * Reading an `.xlsx` workbook into sheets of cells (006 S4.1).
 *
 * An `.xlsx` file is a zip of XML parts. Only a few are needed: the workbook
 * (the sheet names and the date system), its relationships (which part is
 * which sheet), the shared strings (most text lives there once, and cells
 * point to it), the styles (only to tell a date from a number) and the sheets.
 *
 * What it never does:
 *
 * - **work out a formula.** A workbook stores the last value Excel worked out
 *   for each formula, and that value is what is read. A formula with no stored
 *   value reads as an empty cell.
 * - **guess.** A cell it does not understand fails the whole workbook with a
 *   reason, rather than becoming a wrong number.
 *
 * An old `.xls` file and a password-protected workbook are not zip files at
 * all, so they are recognised and named in the error, with what to do.
 */

import { decodeXmlBytes, scanXml } from "./xml.js";
import {
  looksLikeZip,
  openZip,
  ZIP_LIMITS,
  type ZipArchive,
  type ZipLimits,
} from "./zip.js";
import {
  SpreadsheetError,
  brief,
  columnName,
  type CellValue,
  type Sheet,
  type SheetRow,
  type Workbook,
} from "./types.js";

export interface XlsxLimits extends ZipLimits {
  /** The most rows one workbook may hold, across its sheets. */
  maxRows: number;
  /** The most cells one workbook may hold, empty ones between filled ones included. */
  maxCells: number;
  /**
   * The largest size the workbook, relationship and styles parts may unpack
   * to, in bytes. These describe the workbook rather than hold its cells, so
   * a real one is a few hundred KB at most.
   */
  maxMetadataBytes: number;
}

export const XLSX_LIMITS: XlsxLimits = {
  ...ZIP_LIMITS,
  maxRows: 200_000,
  maxCells: 5_000_000,
  maxMetadataBytes: 16 * 1024 * 1024,
};

/** Excel's own limits: 1,048,576 rows, 16,384 columns (A to XFD), 32,767 characters in a cell. */
const EXCEL_MAX_ROW = 1_048_576;
const EXCEL_MAX_COLUMN = 16_384;
const EXCEL_MAX_CELL_TEXT = 32_767;
/** Excel allows 255 characters in a number format, and about 64,000 cell styles. */
const EXCEL_MAX_FORMAT_CODE = 255;
const EXCEL_MAX_CELL_STYLES = 65_536;
/**
 * The longest number a cell's value may be written as. Excel writes at most
 * 17 digits, a sign, a point and an exponent, so 100 leaves room and keeps a
 * hostile megabyte of digits away from the number pattern.
 */
const MAX_NUMBER_TEXT = 100;

const COMPOUND_FILE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * An older Office file. Both an old `.xls` workbook and a password-protected
 * `.xlsx` are stored this way. A protected one holds a stream named
 * "EncryptedPackage", and its name is written in UTF-16 in the file.
 */
function compoundFileError(data: Uint8Array): SpreadsheetError {
  const marker = Buffer.from("EncryptedPackage", "utf16le");
  if (
    Buffer.from(data.buffer, data.byteOffset, data.byteLength).includes(marker)
  ) {
    return new SpreadsheetError(
      "This workbook is protected with a password, so it cannot be read. Remove the password in Excel, save it and upload it again.",
    );
  }
  return new SpreadsheetError(
    "This is an old Excel file (.xls), which cannot be read. Open it in Excel, save it as .xlsx or .csv and upload it again.",
  );
}

function startsWith(data: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, i) => data[i] === byte);
}

const NOT_A_WORKBOOK = "The file is not an Excel workbook (.xlsx).";
const ZIP_BUT_NOT_A_WORKBOOK =
  "The file is a zip archive but not an Excel workbook (.xlsx).";
const BINARY_WORKBOOK =
  "This is a binary Excel workbook (.xlsb), which cannot be read. Open it in Excel, save it as .xlsx or .csv and upload it again.";

/**
 * Why an upload cannot be an `.xlsx` workbook, or null when it can be
 * (006 FR-050). Only the archive's list of parts is read, and nothing is
 * unpacked, so this is quick enough to run while the file is uploaded. A
 * workbook it lets through can still fail later, when its cells are read, with
 * the reason `readXlsx` gives.
 *
 * Excel, LibreOffice and Google Sheets all keep the workbook at
 * `xl/workbook.xml`, so that is the part looked for.
 */
export function workbookRefusal(
  data: Uint8Array,
  limits: ZipLimits = ZIP_LIMITS,
): string | null {
  if (startsWith(data, COMPOUND_FILE_MAGIC))
    return compoundFileError(data).message;
  if (!looksLikeZip(data)) return NOT_A_WORKBOOK;
  let zip: ZipArchive;
  try {
    zip = openZip(data, limits);
  } catch (err) {
    if (err instanceof SpreadsheetError) return err.message;
    throw err;
  }
  if (zip.has("xl/workbook.xml")) return null;
  if (zip.has("xl/workbook.bin")) return BINARY_WORKBOOK;
  return ZIP_BUT_NOT_A_WORKBOOK;
}

export function readXlsx(
  data: Uint8Array,
  limits: XlsxLimits = XLSX_LIMITS,
): Workbook {
  if (startsWith(data, COMPOUND_FILE_MAGIC)) throw compoundFileError(data);
  if (!looksLikeZip(data)) throw new SpreadsheetError(NOT_A_WORKBOOK);
  const zip = openZip(data, limits);
  const workbookPath = findWorkbookPath(zip, limits);
  if (/\.bin$/i.test(workbookPath)) {
    throw new SpreadsheetError(BINARY_WORKBOOK);
  }
  if (!zip.has(workbookPath)) {
    throw new SpreadsheetError(ZIP_BUT_NOT_A_WORKBOOK);
  }

  const workbook = readWorkbookPart(
    decodeXmlBytes(zip.read(workbookPath, limits.maxMetadataBytes)),
  );
  const relations = readRelationships(zip, workbookPath, limits);
  const { date1904 } = workbook;

  const sharedStringsPath = [...relations.values()].find(
    (r) => r.type === "sharedStrings",
  )?.target;
  const sharedStrings =
    sharedStringsPath && zip.has(sharedStringsPath)
      ? readSharedStrings(zip.read(sharedStringsPath))
      : [];
  const stylesPath = [...relations.values()].find(
    (r) => r.type === "styles",
  )?.target;
  const dateStyles =
    stylesPath && zip.has(stylesPath)
      ? readDateStyles(zip.read(stylesPath, limits.maxMetadataBytes))
      : [];

  const budget = { rows: 0, cells: 0 };
  const sheets: Sheet[] = [];
  for (const entry of workbook.sheets) {
    const relation = relations.get(entry.id ?? "");
    // A chart sheet or a macro sheet has no cells to read.
    if (!relation || relation.type !== "worksheet") continue;
    if (!zip.has(relation.target)) {
      throw new SpreadsheetError(
        `The workbook lists a sheet "${brief(entry.name ?? "")}" that is not in the file.`,
      );
    }
    const name = entry.name ?? `Sheet${sheets.length + 1}`;
    const rows = readSheetRows(decodeXmlBytes(zip.read(relation.target)), {
      name,
      sharedStrings,
      dateStyles,
      date1904,
      limits,
      budget,
    });
    sheets.push(entry.hidden ? { name, rows, hidden: true } : { name, rows });
  }
  if (sheets.length === 0)
    throw new SpreadsheetError("The workbook has no sheets with cells in it.");
  return { format: "xlsx", sheets };
}

function isTrue(value: string | undefined): boolean {
  return value === "1" || value === "true";
}

// ── Parts and relationships ───────────────────────────────────────────────

interface Relation {
  /** The last word of the relationship type, such as `worksheet` or `styles`. */
  type: string;
  /** The part's path inside the zip. */
  target: string;
}

/** Joins a relationship target to the folder of the part that names it. */
function resolvePath(fromPart: string, target: string): string {
  const parts = target.startsWith("/") ? [] : fromPart.split("/").slice(0, -1);
  for (const piece of target.replace(/^\/+/, "").split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== "." && piece !== "") parts.push(piece);
  }
  return parts.join("/");
}

/**
 * A part's relationships, by id. `_rels/x.xml.rels` belongs to `x.xml`. Read
 * in one pass without building a tree, as are the workbook and styles parts:
 * a tree of a few MB of tiny tags takes hundreds of MB of memory.
 */
function readRelationships(
  zip: ZipArchive,
  part: string,
  limits: XlsxLimits,
): Map<string, Relation> {
  const slash = part.lastIndexOf("/");
  const relsPath = `${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`;
  const relations = new Map<string, Relation>();
  if (!zip.has(relsPath)) return relations;
  let depth = 0;
  scanXml(decodeXmlBytes(zip.read(relsPath, limits.maxMetadataBytes)), {
    open(name, attrs) {
      depth++;
      if (depth !== 2 || name !== "Relationship") return;
      if (attrs.TargetMode === "External") return;
      const { Id: id, Type: type, Target: target } = attrs;
      if (!id || !type || !target) return;
      relations.set(id, {
        type: type.slice(type.lastIndexOf("/") + 1),
        target: resolvePath(part, target),
      });
    },
    close() {
      depth--;
    },
  });
  return relations;
}

interface WorkbookPart {
  date1904: boolean;
  /** The sheets in workbook order, each with its relationship id. */
  sheets: { name?: string; id?: string; hidden: boolean }[];
}

/** The workbook part: its date system and its list of sheets. */
function readWorkbookPart(xml: string): WorkbookPart {
  const part: WorkbookPart = { date1904: false, sheets: [] };
  const path: string[] = [];
  scanXml(xml, {
    open(name, attrs) {
      path.push(name);
      if (path.length === 2 && name === "workbookPr") {
        part.date1904 = isTrue(attrs.date1904);
      } else if (
        path.length === 3 &&
        path[1] === "sheets" &&
        name === "sheet"
      ) {
        part.sheets.push({
          name: attrs.name,
          id: attrs.id,
          // "hidden", or "veryHidden" for one only a macro can show.
          hidden: attrs.state === "hidden" || attrs.state === "veryHidden",
        });
      }
    },
    close() {
      path.pop();
    },
  });
  return part;
}

/** Where the workbook part is: what the package's own relationships name, else the usual place. */
function findWorkbookPath(zip: ZipArchive, limits: XlsxLimits): string {
  const root = readRelationships(zip, "", limits);
  const office = [...root.values()].find((r) => r.type === "officeDocument");
  return office?.target ?? "xl/workbook.xml";
}

// ── Shared strings ────────────────────────────────────────────────────────

/**
 * Excel writes a few characters as `_xHHHH_` (a carriage return is
 * `_x000D_`), and an underscore that would look like one as `_x005F_`.
 */
function decodeExcelEscapes(text: string): string {
  if (!text.includes("_x")) return text;
  return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function checkCellText(text: string): string {
  if (text.length > EXCEL_MAX_CELL_TEXT) {
    throw new SpreadsheetError(
      `A cell holds more than ${EXCEL_MAX_CELL_TEXT.toLocaleString("en")} characters, which Excel itself does not allow.`,
    );
  }
  return text;
}

/**
 * The shared strings, in order. A string may be split into runs with their
 * own fonts (rich text); the runs are joined. Phonetic guides (`rPh`, the
 * reading aid above Japanese text) are not part of the text and are left out.
 */
function readSharedStrings(bytes: Uint8Array): string[] {
  const strings: string[] = [];
  let current: string[] | null = null;
  let inText = false;
  let phonetic = 0;
  scanXml(decodeXmlBytes(bytes), {
    open(name, _attrs, selfClosing) {
      if (name === "si") current = [];
      else if (name === "rPh") phonetic++;
      else if (name === "t" && !selfClosing) inText = true;
    },
    close(name) {
      if (name === "si" && current) {
        strings.push(checkCellText(decodeExcelEscapes(current.join(""))));
        current = null;
      } else if (name === "rPh") phonetic--;
      else if (name === "t") inText = false;
    },
    text(value) {
      if (current && inText && phonetic === 0) current.push(value);
    },
  });
  return strings;
}

// ── Date styles ──────────────────────────────────────────────────────────

type DateStyle = "date" | "datetime" | "time" | null;

/** Excel's built-in number formats that show a date or a time. */
const BUILT_IN_DATE_FORMATS: Record<number, DateStyle> = {
  14: "date",
  15: "date",
  16: "date",
  17: "date",
  18: "time",
  19: "time",
  20: "time",
  21: "time",
  22: "datetime",
  45: "time",
  47: "time",
};
// The formats East Asian versions of Excel build in, all dates.
for (const id of [27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53, 54, 57, 58])
  BUILT_IN_DATE_FORMATS[id] = "date";
for (const id of [32, 33, 55, 56]) BUILT_IN_DATE_FORMATS[id] = "time";

/**
 * Whether a custom number format shows a date, a time, both, or neither. Only
 * the first section counts (the one for positive numbers). Quoted text,
 * escaped characters, colours and locale tags are taken out first, so
 * `"Day "0` is not taken for a date. An elapsed time such as `[h]:mm` is a
 * length of time, not a time of day, so it stays a number.
 */
export function classifyNumberFormat(code: string): DateStyle {
  // Excel never writes a longer one, and the patterns below are not meant
  // for one: readDateStyles refuses the workbook before it gets here.
  if (code.length > EXCEL_MAX_FORMAT_CODE) return null;
  const first = code.split(";")[0];
  if (/\[(h+|m+|s+)\]/i.test(first)) return null;
  const bare = first
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .toLowerCase();
  const ampm = /am\/pm|a\/p/.test(bare);
  const letters = bare.replace(/am\/pm|a\/p/g, "");
  if (/general/.test(letters)) return null;
  const hasTime = ampm || /[hs]/.test(letters);
  const hasDate = /[dy]/.test(letters) || (/m/.test(letters) && !hasTime);
  if (hasDate && hasTime) return "datetime";
  if (hasDate) return "date";
  if (hasTime) return "time";
  return null;
}

function tooManyStyles(): SpreadsheetError {
  return new SpreadsheetError(
    `The workbook has more than ${EXCEL_MAX_CELL_STYLES.toLocaleString("en")} cell styles, which Excel itself does not allow. Open it in Excel, save it again and upload the new copy.`,
  );
}

/**
 * For each cell style, by its index (a cell's `s`), whether it shows a date.
 * A format code longer than Excel allows is refused before it is looked at.
 */
function readDateStyles(bytes: Uint8Array): DateStyle[] {
  const custom = new Map<number, DateStyle>();
  const formatIds: number[] = [];
  const path: string[] = [];
  scanXml(decodeXmlBytes(bytes), {
    open(name, attrs) {
      path.push(name);
      if (path.length !== 3) return;
      if (path[1] === "numFmts" && name === "numFmt") {
        const code = attrs.formatCode ?? "";
        if (code.length > EXCEL_MAX_FORMAT_CODE) {
          throw new SpreadsheetError(
            `The workbook has a number format longer than ${EXCEL_MAX_FORMAT_CODE} characters, which Excel itself does not allow. Open it in Excel, save it again and upload the new copy.`,
          );
        }
        if (custom.size >= EXCEL_MAX_CELL_STYLES) throw tooManyStyles();
        custom.set(Number(attrs.numFmtId), classifyNumberFormat(code));
      } else if (path[1] === "cellXfs" && name === "xf") {
        if (formatIds.length >= EXCEL_MAX_CELL_STYLES) throw tooManyStyles();
        formatIds.push(Number(attrs.numFmtId ?? 0));
      }
    },
    close() {
      path.pop();
    },
  });
  return formatIds.map((id) =>
    custom.has(id)
      ? (custom.get(id) ?? null)
      : (BUILT_IN_DATE_FORMATS[id] ?? null),
  );
}

// ── Dates ────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

function timeText(seconds: number): string {
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

/**
 * A date serial (a count of days, with the time of day as the fraction) as
 * text. In the 1900 system day 1 is 1900-01-01, and Excel counts a
 * 1900-02-29 that never was (day 60), kept from Lotus 1-2-3, so every day from
 * 61 on is one day further than the calendar says. In the 1904 system (old Mac
 * workbooks) day 0 is 1904-01-01. The time is rounded to the second. Returns
 * null for a serial that is not a real date, so the cell stays a number.
 */
export function serialToText(
  serial: number,
  date1904: boolean,
  style: Exclude<DateStyle, null>,
): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  let days = Math.floor(serial);
  let seconds = Math.round((serial - days) * 86_400);
  if (seconds === 86_400) {
    days += 1;
    seconds = 0;
  }
  if (style === "time") return timeText(seconds);
  let epoch: number;
  if (date1904) epoch = Date.UTC(1904, 0, 1);
  else if (days === 60) return null;
  else epoch = days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  if (!date1904 && days === 0) return null;
  const date = new Date(epoch + days * DAY_MS);
  const year = date.getUTCFullYear();
  if (year > 9999) return null;
  const day = `${pad(year, 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  return style === "datetime" || seconds !== 0
    ? `${day} ${timeText(seconds)}`
    : day;
}

/**
 * A `t="d"` cell, which holds an ISO 8601 date as text. It is written out as
 * it is, with no time zone change: a workbook date is a calendar date, not an
 * instant.
 */
function isoDateText(value: string): string | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.exec(
      value.trim(),
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const date = `${year}-${month}-${day}`;
  const time = hour ? `${hour}:${minute}:${second ?? "00"}` : "00:00:00";
  return time === "00:00:00" ? date : `${date} ${time}`;
}

// ── Sheets ───────────────────────────────────────────────────────────────

interface SheetContext {
  name: string;
  sharedStrings: string[];
  dateStyles: DateStyle[];
  date1904: boolean;
  limits: XlsxLimits;
  budget: { rows: number; cells: number };
}

/**
 * A number as a workbook writes it. Each part can match only one way (the
 * digits after a point are only tried once a point is there), so a long run
 * of digits is checked in one pass, never by trying every split of it.
 */
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/** A cell reference's column, 0 for A. `B12` gives 1. Null when it has no letters. */
function columnOf(ref: string): number | null {
  const letters = /^\$?([A-Za-z]{1,3})/.exec(ref);
  if (!letters) return null;
  let index = 0;
  for (const ch of letters[1].toUpperCase())
    index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

function readSheetRows(xml: string, context: SheetContext): SheetRow[] {
  const {
    name: sheetName,
    sharedStrings,
    dateStyles,
    date1904,
    limits,
    budget,
  } = context;
  const rows = new Map<number, SheetRow>();
  let inSheetData = false;
  let lastRow = 0;
  let row: SheetRow | null = null;
  let nextColumn = 0;

  // The cell being read.
  let cell: {
    column: number;
    type: string;
    style: number;
    ref: string;
  } | null = null;
  let valueText: string[] | null = null;
  let inlineText: string[] | null = null;
  let capture: string[] | null = null;
  let phonetic = 0;

  const where = (ref: string) =>
    `sheet "${brief(sheetName)}", cell ${brief(ref)}`;
  const fail = (ref: string, detail: string) =>
    new SpreadsheetError(
      `The workbook cannot be read: ${where(ref)} ${detail}.`,
    );

  function finishCell(): void {
    if (!cell || !row) return;
    const { type, style, ref } = cell;
    const v = valueText?.join("") ?? null;
    let value: CellValue | null = null;
    switch (type) {
      case "s": {
        if (v === null || v.trim() === "") break;
        const index = Number(v);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= sharedStrings.length
        ) {
          throw fail(ref, "points to a shared string that is not in the file");
        }
        value = { kind: "string", text: sharedStrings[index] };
        break;
      }
      case "inlineStr":
        if (inlineText)
          value = {
            kind: "string",
            text: checkCellText(decodeExcelEscapes(inlineText.join(""))),
          };
        break;
      case "str":
        if (v !== null)
          value = {
            kind: "string",
            text: checkCellText(decodeExcelEscapes(v)),
          };
        break;
      case "b":
        if (v === null || v === "") break;
        if (v !== "0" && v !== "1" && v !== "true" && v !== "false")
          throw fail(ref, `holds "${brief(v)}" as TRUE or FALSE`);
        value = { kind: "boolean", value: v === "1" || v === "true" };
        break;
      case "e":
        if (v !== null && v !== "")
          value = { kind: "error", code: checkCellText(v) };
        break;
      case "d": {
        if (v === null || v === "") break;
        const text = v.length <= MAX_NUMBER_TEXT ? isoDateText(v) : null;
        if (text === null)
          throw fail(ref, `holds "${brief(v)}", which is not a date`);
        value = { kind: "date", text };
        break;
      }
      case "n": {
        if (v === null || v.trim() === "") break;
        const raw = v.trim();
        if (raw.length > MAX_NUMBER_TEXT || !NUMBER.test(raw))
          throw fail(ref, `holds "${brief(raw)}", which is not a number`);
        const number = Number(raw);
        if (!Number.isFinite(number))
          throw fail(ref, `holds "${brief(raw)}", which is not a number`);
        const dateStyle = dateStyles[style] ?? null;
        const text = dateStyle
          ? serialToText(number, date1904, dateStyle)
          : null;
        value =
          text === null
            ? { kind: "number", raw, value: number }
            : { kind: "date", text };
        break;
      }
      default:
        throw fail(ref, `has a cell type "${brief(type)}" that cannot be read`);
    }
    if (value && !(value.kind === "string" && value.text === "")) {
      const { column } = cell;
      if (column >= row.cells.length) {
        budget.cells += column + 1 - row.cells.length;
        if (budget.cells > limits.maxCells) {
          throw new SpreadsheetError(
            `The workbook has more than ${limits.maxCells.toLocaleString("en")} cells, which is more than can be read.`,
          );
        }
        while (row.cells.length <= column) row.cells.push(null);
      }
      row.cells[column] = value;
    }
  }

  scanXml(xml, {
    open(name, attrs, selfClosing) {
      if (name === "sheetData") {
        inSheetData = true;
        return;
      }
      if (!inSheetData) return;
      if (name === "row") {
        // A row with no number comes after the one before it.
        const number = attrs.r !== undefined ? Number(attrs.r) : lastRow + 1;
        if (!Number.isInteger(number) || number < 1 || number > EXCEL_MAX_ROW) {
          throw new SpreadsheetError(
            `The workbook cannot be read: sheet "${brief(sheetName)}" has a row numbered "${brief(attrs.r ?? "")}".`,
          );
        }
        lastRow = number;
        nextColumn = 0;
        row = rows.get(number) ?? { number, cells: [] };
        if (selfClosing) row = null;
        return;
      }
      if (name === "c") {
        if (!row)
          throw new SpreadsheetError(
            `The workbook cannot be read: sheet "${brief(sheetName)}" has a cell outside a row.`,
          );
        // A cell with no reference comes after the one before it.
        const column = attrs.r !== undefined ? columnOf(attrs.r) : nextColumn;
        if (column === null || column >= EXCEL_MAX_COLUMN) {
          throw new SpreadsheetError(
            `The workbook cannot be read: sheet "${brief(sheetName)}" has a cell named "${brief(attrs.r ?? "")}".`,
          );
        }
        nextColumn = column + 1;
        cell = {
          column,
          type: attrs.t ?? "n",
          style: attrs.s !== undefined ? Number(attrs.s) : 0,
          ref: attrs.r ?? `${columnName(column)}${row.number}`,
        };
        valueText = null;
        inlineText = null;
        capture = null;
        phonetic = 0;
        if (selfClosing) {
          finishCell();
          cell = null;
        }
        return;
      }
      if (!cell) return;
      if (name === "v" && !selfClosing) {
        valueText = [];
        capture = valueText;
      } else if (name === "v") {
        valueText = [];
      } else if (name === "is") {
        inlineText = [];
      } else if (name === "rPh") {
        phonetic++;
      } else if (name === "t" && inlineText && !selfClosing && phonetic === 0) {
        capture = inlineText;
      }
    },
    close(name) {
      if (name === "sheetData") {
        inSheetData = false;
        return;
      }
      if (!inSheetData) return;
      if (name === "c") {
        finishCell();
        cell = null;
        capture = null;
      } else if (name === "row") {
        if (row && row.cells.length > 0 && !rows.has(row.number)) {
          budget.rows++;
          if (budget.rows > limits.maxRows) {
            throw new SpreadsheetError(
              `The workbook has more than ${limits.maxRows.toLocaleString("en")} rows, which is more than can be read.`,
            );
          }
          rows.set(row.number, row);
        }
        row = null;
      } else if (name === "v" || name === "t") {
        capture = null;
      } else if (name === "rPh") {
        phonetic--;
      }
    },
    text(value) {
      capture?.push(value);
    },
  });

  return [...rows.values()].sort((a, b) => a.number - b.number);
}
