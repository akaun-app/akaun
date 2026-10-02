// Test-only helpers for the spreadsheet specs: a zip writer and a workbook
// builder, so every test file is made in memory and no real spreadsheet is
// ever kept in the repository. Nothing in the app imports this file.
import { deflateRawSync } from "node:zlib";
import { crc32 } from "../zip.js";

export interface ZipFile {
  name: string;
  data: string | Uint8Array;
  /** Stored as it is instead of compressed. */
  store?: boolean;
  /** Sets the "encrypted" flag, as a password-protected zip does. */
  encrypted?: boolean;
  /** Writes a different size than the real one into the archive's list. */
  declaredSize?: number;
  /** Writes a different checksum than the real one into the archive's list. */
  declaredCrc?: number;
}

/** A zip archive of these files, written the way Excel writes one. */
export function buildZip(
  files: ZipFile[],
  options: { zip64?: boolean } = {},
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const raw =
      typeof file.data === "string"
        ? Buffer.from(file.data, "utf8")
        : Buffer.from(file.data);
    const packed = file.store ? raw : deflateRawSync(raw);
    const method = file.store ? 0 : 8;
    const name = Buffer.from(file.name, "utf8");
    const flags = 0x0800 | (file.encrypted ? 1 : 0);
    const crc = file.declaredCrc ?? crc32(raw);
    const size = file.declaredSize ?? raw.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.zip64 ? 0xffff : files.length, 8);
  end.writeUInt16LE(options.zip64 ? 0xffff : files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A cell as the builder takes it. */
export type FixtureCell =
  | string
  | number
  | boolean
  | null
  | { raw: string; style?: number }
  | { serial: number; style: number }
  | { formula: string; cached?: string; type?: "str" | "n" }
  | { inline: string }
  | { iso: string }
  | { error: string };

export interface FixtureSheet {
  name: string;
  /** Rows from row 1 down. A row given as `null` is left out of the file. */
  rows?: (FixtureCell[] | null)[];
  /** The sheet part's XML as it is, instead of `rows`. */
  xml?: string;
  /** Row numbers to write for each row instead of counting from 1. */
  rowNumbers?: number[];
}

export interface FixtureWorkbook {
  sheets: FixtureSheet[];
  date1904?: boolean;
  /**
   * Number formats by style index, for `s` on a cell: a built-in format id
   * or a custom format code. Style 0 is always General.
   */
  styles?: (number | string)[];
  /** The styles part as it is, instead of the one built from `styles`. */
  stylesXml?: string;
  /** The shared strings part as it is, instead of the one built from the cells. */
  sharedStringsXml?: string;
  /** Extra parts to add to the zip. */
  extraFiles?: ZipFile[];
}

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnLetters(index: number): string {
  let name = "";
  let n = index + 1;
  while (n > 0) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** An `.xlsx` workbook built in memory, with text in shared strings as Excel does. */
export function buildXlsx(workbook: FixtureWorkbook): Buffer {
  const shared: string[] = [];
  const sharedIndex = new Map<string, number>();
  const share = (text: string) => {
    let index = sharedIndex.get(text);
    if (index === undefined) {
      index = shared.length;
      shared.push(text);
      sharedIndex.set(text, index);
    }
    return index;
  };

  const cellXml = (cell: FixtureCell, ref: string): string => {
    if (cell === null) return "";
    if (typeof cell === "string")
      return `<c r="${ref}" t="s"><v>${share(cell)}</v></c>`;
    if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
    if (typeof cell === "boolean")
      return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
    if ("raw" in cell)
      return `<c r="${ref}"${cell.style ? ` s="${cell.style}"` : ""}><v>${cell.raw}</v></c>`;
    if ("serial" in cell)
      return `<c r="${ref}" s="${cell.style}"><v>${cell.serial}</v></c>`;
    if ("formula" in cell) {
      const type = cell.type === "n" ? "" : ` t="${cell.type ?? "str"}"`;
      const value =
        cell.cached === undefined ? "" : `<v>${escapeXml(cell.cached)}</v>`;
      return `<c r="${ref}"${type}><f>${escapeXml(cell.formula)}</f>${value}</c>`;
    }
    if ("inline" in cell)
      return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(cell.inline)}</t></is></c>`;
    if ("iso" in cell) return `<c r="${ref}" t="d"><v>${cell.iso}</v></c>`;
    return `<c r="${ref}" t="e"><v>${escapeXml(cell.error)}</v></c>`;
  };

  const sheetParts = workbook.sheets.map((sheet) => {
    if (sheet.xml !== undefined) return sheet.xml;
    const rows = (sheet.rows ?? [])
      .map((cells, index) => {
        if (cells === null) return "";
        const number = sheet.rowNumbers?.[index] ?? index + 1;
        const body = cells
          .map((cell, column) =>
            cellXml(cell, `${columnLetters(column)}${number}`),
          )
          .join("");
        return `<row r="${number}">${body}</row>`;
      })
      .join("");
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN}" xmlns:r="${REL}"><sheetData>${rows}</sheetData></worksheet>`;
  });

  const styles = workbook.styles ?? [];
  const customFormats = styles
    .map((format, index) => ({ format, id: 164 + index }))
    .filter((entry) => typeof entry.format === "string");
  const stylesXml =
    workbook.stylesXml ??
    `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="${MAIN}">` +
      (customFormats.length
        ? `<numFmts count="${customFormats.length}">${customFormats
            .map(
              (entry) =>
                `<numFmt numFmtId="${entry.id}" formatCode="${escapeXml(String(entry.format))}"/>`,
            )
            .join("")}</numFmts>`
        : "") +
      `<cellStyleXfs count="1"><xf numFmtId="0"/></cellStyleXfs><cellXfs count="${styles.length + 1}"><xf numFmtId="0"/>` +
      styles
        .map(
          (format, index) =>
            `<xf numFmtId="${typeof format === "number" ? format : 164 + index}" applyNumberFormat="1"/>`,
        )
        .join("") +
      `</cellXfs></styleSheet>`;

  const sharedXml =
    workbook.sharedStringsXml ??
    `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="${MAIN}" count="${shared.length}" uniqueCount="${shared.length}">${shared
      .map((text) => `<si><t xml:space="preserve">${escapeXml(text)}</t></si>`)
      .join("")}</sst>`;

  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${MAIN}" xmlns:r="${REL}">` +
    `<workbookPr date1904="${workbook.date1904 ? "true" : "false"}"/><sheets>` +
    workbook.sheets
      .map(
        (sheet, index) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join("") +
    `</sheets></workbook>`;

  const relsXml =
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}">` +
    workbook.sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/>` +
    `<Relationship Id="rIdT" Type="${REL}/styles" Target="/xl/styles.xml"/>` +
    `</Relationships>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}">` +
    `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  return buildZip([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8"?><Types/>`,
    },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: relsXml },
    { name: "xl/styles.xml", data: stylesXml },
    { name: "xl/sharedStrings.xml", data: sharedXml },
    ...sheetParts.map((xml, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: xml,
    })),
    ...(workbook.extraFiles ?? []),
  ]);
}

/**
 * A made-up workbook with the shape of a marketplace wallet report: a heading
 * block with merged-looking empty cells, the summary totals, gaps between
 * blocks, and one row per transaction below a heading row at row 18. The
 * values are invented; only the layout follows the real report.
 */
export function walletReportFixture(): {
  xlsx: Buffer;
  moneyOutCents: number;
  transactions: number;
} {
  const blank = ["", "", "", "", "", "", "", ""];
  const transactions: FixtureCell[][] = [
    [
      "2026-03-29 10:15:02",
      "Order Income",
      "Income from Order #A1",
      "A1",
      "Money In",
      { raw: "12.50" },
      "Transaction Completed",
      { raw: "250.00" },
    ],
    [
      "2026-03-29 09:01:44",
      "Order Income",
      "Income from Order #A2",
      "A2",
      "Money In",
      { raw: "7.25" },
      "Transaction Completed",
      { raw: "237.50" },
    ],
    [
      "2026-03-28 18:40:00",
      "Withdrawal",
      "Withdrawal to bank",
      "",
      "Money Out",
      { raw: "-100.00" },
      "Processing",
      { raw: "230.25" },
    ],
    [
      "2026-03-28 12:00:00",
      "Adjustment",
      "Shipping fee adjustment",
      "A3",
      "Money Out",
      { raw: "-3.10" },
      "Transaction Completed",
      { raw: "330.25" },
    ],
    [
      "2026-03-27 08:30:10",
      "Order Income",
      "Income from Order #A4",
      "A4",
      "Money Out",
      { raw: "-1.05" },
      "Transaction Completed",
      { raw: "333.35" },
    ],
    [
      "2026-03-26 23:59:59",
      "Adjustment",
      "Seller compensation",
      "A5",
      "Money In",
      { raw: "4.40" },
      "Transaction Completed",
      { raw: "334.40" },
    ],
    [
      "2026-03-25 16:20:00",
      "Withdrawal",
      "Withdrawal to bank",
      "",
      "Money Out",
      { raw: "-200.00" },
      "Transaction Completed",
      { raw: "330.00" },
    ],
    [
      "2026-03-25 11:11:11",
      "Order Income",
      "Income from Order #A6",
      "A6",
      "Money In",
      { raw: "30.00" },
      "Transaction Completed",
      { raw: "530.00" },
    ],
  ];
  const moneyOutCents = -100_00 - 3_10 - 1_05 - 200_00;
  const rows: (FixtureCell[] | null)[] = [
    ["Report", "", "", "", "", "", "", ""],
    blank,
    blank,
    blank,
    ["Account Info", "", "", "", "", "", "", ""],
    ["Username (Seller)", "example.shop", "", ""],
    ["From", "2026-03-01", "", ""],
    ["To", "2026-03-29", "", ""],
    ["** A note about the export."],
    null,
    ["Summary", "", "", "", "$", "Currency", "No. of Transactions", ""],
    ["Total Money In", "", "", "", { raw: "54.15" }, "MYR", { raw: "4" }],
    ["Total Money Out", "", "", "", { raw: "-304.15" }, "MYR", { raw: "4" }],
    null,
    null,
    ["Transaction Details", "", "", "", "", "", "", ""],
    null,
    [
      "Date",
      "Transaction Type",
      "Description",
      "Order ID",
      "Money Direction",
      "Amount",
      "Status",
      "Balance After Transactions",
    ],
    ...transactions,
  ];
  return {
    xlsx: buildXlsx({ sheets: [{ name: "Transaction Report", rows }] }),
    moneyOutCents,
    transactions: transactions.length,
  };
}
