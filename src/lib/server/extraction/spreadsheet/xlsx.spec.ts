import { describe, expect, it } from "vitest";
import {
  buildXlsx,
  buildZip,
  walletReportFixture,
} from "./__fixtures__/build-xlsx.js";
import { cellText, type Sheet } from "./types.js";
import {
  classifyNumberFormat,
  readXlsx,
  serialToText,
  XLSX_LIMITS,
} from "./xlsx.js";

/**
 * Reading `.xlsx` workbooks (006 S4.1). Every workbook is built in memory. The
 * wallet-report fixture has the real report's layout with invented values.
 */

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

/** A sheet as rows of cell text, keyed by row number. */
function texts(sheet: Sheet): Record<number, string[]> {
  return Object.fromEntries(
    sheet.rows.map((row) => [
      row.number,
      row.cells.map((cell) => cellText(cell)),
    ]),
  );
}

/** Whole cents from a decimal string, by string arithmetic only. */
function cents(text: string): number {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`not money: ${text}`);
  const value =
    Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  return match[1] ? -value : value;
}

function sheetXml(rows: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN}"><sheetData>${rows}</sheetData></worksheet>`;
}

describe("readXlsx: the wallet-report layout", () => {
  const fixture = walletReportFixture();
  const workbook = readXlsx(fixture.xlsx);
  const sheet = workbook.sheets[0];

  it("reads the one sheet by name", () => {
    expect(workbook.format).toBe("xlsx");
    expect(workbook.sheets.map((s) => s.name)).toEqual(["Transaction Report"]);
  });

  it("leaves out rows that hold only empty text, and keeps row numbers as Excel shows them", () => {
    const numbers = sheet.rows.map((row) => row.number);
    expect(numbers.slice(0, 11)).toEqual([
      1, 5, 6, 7, 8, 9, 11, 12, 13, 16, 18,
    ]);
    expect(texts(sheet)[1]).toEqual(["Report"]);
  });

  it("finds the heading row and every transaction below it", () => {
    const header = sheet.rows.find((row) => {
      const cells = row.cells.map((cell) => cellText(cell));
      return ["Date", "Transaction Type", "Amount"].every((name) =>
        cells.includes(name),
      );
    });
    expect(header?.number).toBe(18);
    const data = sheet.rows.filter((row) => row.number > 18);
    expect(data).toHaveLength(fixture.transactions);

    const headings = header!.cells.map((cell) => cellText(cell));
    const amount = headings.indexOf("Amount");
    const direction = headings.indexOf("Money Direction");
    const moneyOut = data
      .filter((row) => cellText(row.cells[direction]) === "Money Out")
      .reduce((sum, row) => sum + cents(cellText(row.cells[amount])), 0);
    expect(moneyOut).toBe(fixture.moneyOutCents);
  });

  it("keeps each number as the file writes it", () => {
    expect(sheet.rows.find((row) => row.number === 19)?.cells[5]).toEqual({
      kind: "number",
      raw: "12.50",
      value: 12.5,
    });
    expect(texts(sheet)[13][4]).toBe("-304.15");
  });
});

describe("readXlsx: cell types", () => {
  it("reads every cell type and a formula's stored value", () => {
    const workbook = readXlsx(
      buildXlsx({
        sheets: [
          {
            name: "Types",
            rows: [
              [
                "shared",
                { inline: "inline" },
                { formula: 'CONCAT("a","b")', cached: "ab" },
                true,
                false,
                { error: "#N/A" },
                { iso: "2026-03-01T08:30:00Z" },
                { raw: "-0.5" },
                { formula: "1+1", cached: "2", type: "n" },
                { formula: "NOW()" },
              ],
            ],
          },
        ],
      }),
    );
    const cells = workbook.sheets[0].rows[0].cells;
    expect(cells.slice(0, 9)).toEqual([
      { kind: "string", text: "shared" },
      { kind: "string", text: "inline" },
      { kind: "string", text: "ab" },
      { kind: "boolean", value: true },
      { kind: "boolean", value: false },
      { kind: "error", code: "#N/A" },
      { kind: "date", text: "2026-03-01 08:30:00" },
      { kind: "number", raw: "-0.5", value: -0.5 },
      { kind: "number", raw: "2", value: 2 },
    ]);
    // A formula with no stored value is not worked out: the cell is empty.
    expect(cells).toHaveLength(9);
  });

  it("joins rich-text runs and leaves out phonetic guides and Excel's _x escapes", () => {
    const workbook = readXlsx(
      buildXlsx({
        sheets: [
          {
            name: "S",
            xml: sheetXml(
              `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>`,
            ),
          },
        ],
        sharedStringsXml:
          `<sst xmlns="${MAIN}"><si><r><rPr><b/></rPr><t>Bold</t></r><r><t xml:space="preserve"> and plain</t></r></si>` +
          `<si><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh><t>_x000D_x_x005F_x0041_</t></si></sst>`,
      }),
    );
    expect(workbook.sheets[0].rows[0].cells).toEqual([
      { kind: "string", text: "Bold and plain" },
      { kind: "string", text: "東京\rx_x0041_" },
    ]);
  });

  it("places a row or cell with no position after the one before it", () => {
    const workbook = readXlsx(
      buildXlsx({
        sheets: [
          {
            name: "S",
            xml: sheetXml(
              `<row r="3"><c r="B3"><v>1</v></c><c><v>2</v></c></row><row><c><v>3</v></c><c r="E4"><v>4</v></c><c><v>5</v></c></row>`,
            ),
          },
        ],
      }),
    );
    expect(texts(workbook.sheets[0])).toEqual({
      3: ["", "1", "2"],
      4: ["3", "", "", "", "4", "5"],
    });
  });

  it("reads the sheets in workbook order", () => {
    const workbook = readXlsx(
      buildXlsx({
        sheets: [
          { name: "First", rows: [["a"]] },
          { name: "Second", rows: [["b"]] },
          { name: "Empty", rows: [] },
        ],
      }),
    );
    expect(workbook.sheets.map((s) => [s.name, s.rows.length])).toEqual([
      ["First", 1],
      ["Second", 1],
      ["Empty", 0],
    ]);
  });
});

describe("readXlsx: dates", () => {
  const styles = [
    14,
    22,
    "yyyy-mm-dd hh:mm:ss",
    "dd/mm/yyyy",
    "h:mm",
    "0.00",
    "[h]:mm",
    '"Day "0',
  ];
  const cell = (serial: number, styleIndex: number) => ({
    serial,
    style: styleIndex + 1,
  });

  it("turns a date-formatted serial into a date, and leaves numbers alone", () => {
    const workbook = readXlsx(
      buildXlsx({
        styles,
        sheets: [
          {
            name: "D",
            rows: [
              [
                cell(46113, 0),
                cell(46113.5, 1),
                cell(46113.75, 2),
                cell(46113, 3),
                cell(0.5, 4),
                cell(46113, 5),
                cell(1.5, 6),
                cell(7, 7),
                cell(46113.25, 0),
              ],
            ],
          },
        ],
      }),
    );
    expect(texts(workbook.sheets[0])[1]).toEqual([
      "2026-04-01",
      "2026-04-01 12:00:00",
      "2026-04-01 18:00:00",
      "2026-04-01",
      "12:00:00",
      "46113",
      "1.5",
      "7",
      // A date format that hides the time still has one; it is shown.
      "2026-04-01 06:00:00",
    ]);
  });

  it("reads a 1904 workbook", () => {
    const workbook = readXlsx(
      buildXlsx({
        date1904: true,
        styles: [14],
        sheets: [{ name: "D", rows: [[cell(0, 0), cell(44651, 0)]] }],
      }),
    );
    expect(texts(workbook.sheets[0])[1]).toEqual(["1904-01-01", "2026-04-01"]);
  });

  it("follows Excel's 1900 calendar, with its day 60 that never was", () => {
    expect(serialToText(1, false, "date")).toBe("1900-01-01");
    expect(serialToText(59, false, "date")).toBe("1900-02-28");
    expect(serialToText(60, false, "date")).toBeNull();
    expect(serialToText(61, false, "date")).toBe("1900-03-01");
    expect(serialToText(0, false, "date")).toBeNull();
    expect(serialToText(-1, false, "date")).toBeNull();
    // Rounded to the second, into the next day when it must be.
    expect(serialToText(46112.999999999, false, "datetime")).toBe(
      "2026-04-01 00:00:00",
    );
  });

  it("tells date formats from number formats", () => {
    expect(classifyNumberFormat("General")).toBeNull();
    expect(classifyNumberFormat("#,##0.00;[Red]-#,##0.00")).toBeNull();
    expect(classifyNumberFormat('"Day "0')).toBeNull();
    expect(classifyNumberFormat("0.00E+00")).toBeNull();
    expect(classifyNumberFormat("[h]:mm:ss")).toBeNull();
    expect(classifyNumberFormat("[$-409]d-mmm-yy;@")).toBe("date");
    expect(classifyNumberFormat("mmm yyyy")).toBe("date");
    expect(classifyNumberFormat("mm:ss")).toBe("time");
    expect(classifyNumberFormat("h:mm AM/PM")).toBe("time");
    expect(classifyNumberFormat("d/m/yyyy h:mm")).toBe("datetime");
  });
});

describe("readXlsx: files it refuses, with the reason", () => {
  it("names an old .xls file", () => {
    const xls = Buffer.alloc(1024);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(xls);
    Buffer.from("Workbook", "utf16le").copy(xls, 600);
    expect(() => readXlsx(xls)).toThrow(/old Excel file \(\.xls\)/);
  });

  it("names a password-protected workbook", () => {
    const protectedFile = Buffer.alloc(1024);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(
      protectedFile,
    );
    Buffer.from("EncryptedPackage", "utf16le").copy(protectedFile, 600);
    expect(() => readXlsx(protectedFile)).toThrow(/protected with a password/);
  });

  it("names a binary .xlsb workbook", () => {
    const rels = `<Relationships xmlns="p"><Relationship Id="r" Type="x/officeDocument" Target="xl/workbook.bin"/></Relationships>`;
    expect(() =>
      readXlsx(buildZip([{ name: "_rels/.rels", data: rels }])),
    ).toThrow(/\.xlsb/);
  });

  it("refuses a zip that is not a workbook, and a file that is not a zip", () => {
    expect(() =>
      readXlsx(buildZip([{ name: "word/document.xml", data: "<w/>" }])),
    ).toThrow(/not an Excel workbook/);
    expect(() => readXlsx(Buffer.from("%PDF-1.7 ..."))).toThrow(
      /not an Excel workbook/,
    );
  });

  it("names the sheet and cell it cannot read", () => {
    const bad = (rows: string) =>
      readXlsx(buildXlsx({ sheets: [{ name: "Data", xml: sheetXml(rows) }] }));
    expect(() => bad(`<row r="1"><c r="C1" t="zz"><v>1</v></c></row>`)).toThrow(
      /sheet "Data", cell C1 .*type "zz"/,
    );
    expect(() => bad(`<row r="1"><c r="A1" t="s"><v>99</v></c></row>`)).toThrow(
      /cell A1 points to a shared string/,
    );
    expect(() => bad(`<row r="1"><c r="B1"><v>12,50</v></c></row>`)).toThrow(
      /cell B1 holds "12,50", which is not a number/,
    );
    expect(() =>
      bad(`<row r="1"><c r="A1" t="d"><v>soon</v></c></row>`),
    ).toThrow(/not a date/);
  });

  it("refuses a document type inside a sheet", () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE w [<!ENTITY a "aaaa">]><worksheet><sheetData/></worksheet>`;
    expect(() => readXlsx(buildXlsx({ sheets: [{ name: "S", xml }] }))).toThrow(
      /document type/,
    );
  });

  it("checks a hostile run of digits quickly, and quotes only the start of it", () => {
    const digits = "1".repeat(100_000);
    for (const v of [`${digits}x`, `${digits}.5x`, digits]) {
      const xlsx = buildXlsx({
        sheets: [
          {
            name: "S",
            xml: sheetXml(`<row r="1"><c r="A1"><v>${v}</v></c></row>`),
          },
        ],
      });
      const started = performance.now();
      let message = "";
      try {
        readXlsx(xlsx);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(performance.now() - started).toBeLessThan(1000);
      expect(message).toMatch(/cell A1 holds "1{40}…", which is not a number/);
      expect(message.length).toBeLessThan(200);
    }
    const bool = buildXlsx({
      sheets: [
        {
          name: "S",
          xml: sheetXml(
            `<row r="1"><c r="A1" t="b"><v>${"y".repeat(5000)}</v></c><c r="B1" t="d"><v>${"2".repeat(5000)}</v></c></row>`,
          ),
        },
      ],
    });
    expect(() => readXlsx(bool)).toThrow(/^.{0,200}$/);
  });

  it("refuses a number format longer than Excel allows, without reading it", () => {
    const code = "[".repeat(40_000);
    const xlsx = buildXlsx({
      sheets: [{ name: "S", rows: [[{ raw: "1", style: 1 }]] }],
      styles: [code],
    });
    const started = performance.now();
    expect(() => readXlsx(xlsx)).toThrow(/number format longer than 255/);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(classifyNumberFormat(code)).toBeNull();
  });

  it("refuses a workbook, relationship or styles part past its own size limit", () => {
    const limits = { ...XLSX_LIMITS, maxMetadataBytes: 2048 };
    const bloated = buildXlsx({
      sheets: [{ name: "S", rows: [["a"]] }],
      styles: Array.from({ length: 200 }, () => 14),
    });
    expect(() => readXlsx(bloated, limits)).toThrow(
      /styles\.xml\) unpacks to more than 2 KB/,
    );
    // The same workbook with the usual limit reads, and the sheet part is
    // not held to the smaller one.
    expect(readXlsx(bloated).sheets[0].rows).toHaveLength(1);
    const bigSheet = buildXlsx({
      sheets: [{ name: "S", rows: Array.from({ length: 200 }, (_, i) => [i]) }],
    });
    expect(readXlsx(bigSheet, limits).sheets[0].rows).toHaveLength(200);
  });

  it("refuses more cell styles than Excel allows", () => {
    const xf = '<xf numFmtId="0"/>'.repeat(65_537);
    const xlsx = buildXlsx({
      sheets: [{ name: "S", rows: [["a"]] }],
      stylesXml: `<styleSheet xmlns="${MAIN}"><cellXfs>${xf}</cellXfs></styleSheet>`,
    });
    expect(() => readXlsx(xlsx)).toThrow(/more than 65,536 cell styles/);
  });

  it("stops at the row and cell limits", () => {
    const xlsx = buildXlsx({
      sheets: [{ name: "S", rows: [["a"], ["b"], ["c"]] }],
    });
    expect(() => readXlsx(xlsx, { ...XLSX_LIMITS, maxRows: 2 })).toThrow(
      /more than 2 rows/,
    );
    const wide = buildXlsx({
      sheets: [
        { name: "S", xml: sheetXml(`<row r="1"><c r="Z1"><v>1</v></c></row>`) },
      ],
    });
    expect(() => readXlsx(wide, { ...XLSX_LIMITS, maxCells: 10 })).toThrow(
      /more than 10 cells/,
    );
  });
});
