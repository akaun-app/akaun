import { describe, expect, it } from "vitest";
import { CSV_LIMITS, decodeCsvBytes, detectDelimiter, readCsv } from "./csv.js";
import { cellText, type Workbook } from "./types.js";

/** Reading `.csv` files (006 S4.1). */

function rows(workbook: Workbook): [number, string[]][] {
  return workbook.sheets[0].rows.map((row) => [
    row.number,
    row.cells.map((cell) => cellText(cell)),
  ]);
}

const utf8 = (text: string) => Buffer.from(text, "utf8");

describe("readCsv", () => {
  it("follows RFC 4180 quoting, and allows rows of different widths", () => {
    const workbook = readCsv(
      utf8(
        'Date,Description,Amount\r\n2026-03-01,"Paid, in full",12.50\r\n2026-03-02,"Said ""hi""\nthen left",-3\r\n4,5\r\n',
      ),
    );
    expect(workbook.format).toBe("csv");
    expect(workbook.sheets[0].name).toBe("Sheet1");
    expect(rows(workbook)).toEqual([
      [1, ["Date", "Description", "Amount"]],
      [2, ["2026-03-01", "Paid, in full", "12.50"]],
      // A line break inside quotes stays in the cell; the cell is shown on one line.
      [3, ["2026-03-02", 'Said "hi" then left', "-3"]],
      [4, ["4", "5"]],
    ]);
    expect(workbook.sheets[0].rows[2].cells[1]).toEqual({
      kind: "string",
      text: 'Said "hi"\nthen left',
    });
  });

  it("leaves blank rows out but keeps counting them, and drops empty cells at the end of a row", () => {
    const workbook = readCsv(utf8("a,b,,\n\n,,\nc,,d\rlast"), {
      sheetName: "export.csv",
    });
    expect(workbook.sheets[0].name).toBe("export.csv");
    expect(rows(workbook)).toEqual([
      [1, ["a", "b"]],
      [4, ["c", "", "d"]],
      [5, ["last"]],
    ]);
    expect(workbook.sheets[0].rows[1].cells).toEqual([
      { kind: "string", text: "c" },
      null,
      { kind: "string", text: "d" },
    ]);
  });

  it("keeps a quote in the middle of a cell as it is", () => {
    expect(rows(readCsv(utf8('a"b,"c"d\n')))).toEqual([[1, ['a"b', "cd"]]]);
  });

  it("honours Excel's sep= line and does not count it as a row", () => {
    const workbook = readCsv(
      utf8("sep=;\r\nDate;Amount\r\n2026-03-01;1,50\r\n"),
    );
    expect(rows(workbook)).toEqual([
      [1, ["Date", "Amount"]],
      [2, ["2026-03-01", "1,50"]],
    ]);
  });

  it("uses the separator it is given", () => {
    expect(rows(readCsv(utf8("a;b,c\n"), { delimiter: "," }))).toEqual([
      [1, ["a;b", "c"]],
    ]);
    expect(() => readCsv(utf8("a"), { delimiter: '"' })).toThrow(
      /cannot be used/,
    );
  });

  it("names the row where a quoted cell is never closed", () => {
    expect(() => readCsv(utf8('a,b\nc,"never\nclosed'))).toThrow(
      /starts on row 2 is never closed/,
    );
  });

  it("stops at its limits and says which", () => {
    expect(() =>
      readCsv(utf8("a\nb\nc\n"), { limits: { ...CSV_LIMITS, maxRows: 2 } }),
    ).toThrow(/more than 2 rows/);
    expect(() =>
      readCsv(utf8("abcdef\n"), {
        limits: { ...CSV_LIMITS, maxCellLength: 5 },
      }),
    ).toThrow(/Row 1 .* longer than 5 characters/);
    expect(() =>
      readCsv(utf8("a,b,c\n"), {
        limits: { ...CSV_LIMITS, maxCellsPerRow: 2 },
      }),
    ).toThrow(/Row 1 .* more than 2 cells/);
  });
});

describe("detectDelimiter", () => {
  it("picks the separator that splits the most rows evenly", () => {
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
    // Decimal commas inside semicolon-separated cells.
    expect(
      detectDelimiter(
        "Date;Amount;Note\n2026-03-01;1,50;x\n2026-03-02;2,75;y\n",
      ),
    ).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2,5\t3\n")).toBe("\t");
    expect(detectDelimiter("a|b\n1|2\n")).toBe("|");
    // A heading block above the table does not throw it off.
    expect(
      detectDelimiter(
        "Report for March\nShop: x\nDate|Amount|Status\n1|2|3\n4|5|6\n",
      ),
    ).toBe("|");
  });

  it("is not stopped by a limit that only a wrong separator would hit", () => {
    // 4,000 columns: read with "|", each whole line is one 50 KB cell.
    const line = (n: number) =>
      Array.from({ length: 4000 }, (_, i) => `r${n}c${i}xxxxxxxx`).join(",");
    const text = `${line(1)}\n${line(2)}\n`;
    expect(text.length).toBeGreaterThan(64 * 1024);
    expect(detectDelimiter(text)).toBe(",");
    const read = readCsv(utf8(text));
    expect(read.sheets[0].rows).toHaveLength(2);
    expect(read.sheets[0].rows[1].cells).toHaveLength(4000);
  });

  it("falls back to a comma when nothing splits", () => {
    expect(detectDelimiter("one\ntwo\n")).toBe(",");
  });
});

describe("decodeCsvBytes", () => {
  it("reads a byte order mark for UTF-8 and UTF-16", () => {
    expect(
      decodeCsvBytes(
        Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8("é,1")]),
      ),
    ).toBe("é,1");
    expect(
      decodeCsvBytes(
        Buffer.concat([
          Buffer.from([0xff, 0xfe]),
          Buffer.from("é,1", "utf16le"),
        ]),
      ),
    ).toBe("é,1");
    const be = Buffer.from("é,1", "utf16le").swap16();
    expect(decodeCsvBytes(Buffer.concat([Buffer.from([0xfe, 0xff]), be]))).toBe(
      "é,1",
    );
  });

  it("reads UTF-8 without a mark, and falls back to Windows-1252 when it is not UTF-8", () => {
    expect(decodeCsvBytes(utf8("Café €5"))).toBe("Café €5");
    expect(
      decodeCsvBytes(Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x35])),
    ).toBe("Café €5");
  });

  it("gives the same rows whatever the encoding", () => {
    const text = "Name,Amount\nCafé,1.00\n";
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(text, "utf16le"),
    ]);
    expect(rows(readCsv(utf16))).toEqual(rows(readCsv(utf8(text))));
  });
});
