import { describe, expect, it } from "vitest";
import { numberDocumentLines } from "../document-text.js";
import { buildXlsx, walletReportFixture } from "./__fixtures__/build-xlsx.js";
import { readCsv } from "./csv.js";
import { detectionText, renderWorkbook } from "./render.js";
import { readXlsx } from "./xlsx.js";

/**
 * A spreadsheet as text (006 S4.1): pages for the AI reading, numbered by the
 * same `numberDocumentLines` a PDF goes through, and text for recognition
 * phrases.
 */

describe("renderWorkbook", () => {
  it("writes one page per sheet, a row per line, cells joined by ' | '", () => {
    const workbook = readXlsx(
      buildXlsx({
        styles: [22],
        sheets: [
          {
            name: "Sales",
            rows: [
              ["Date", "Note", "", "Amount", "", ""],
              [
                { serial: 46113.5, style: 1 },
                "two\nlines",
                null,
                { raw: "12.50" },
              ],
              null,
              ["", "", ""],
              [null, "", "x"],
            ],
          },
          { name: "Empty", rows: [] },
        ],
      }),
    );
    const { pages, rows } = renderWorkbook(workbook);
    expect(pages).toEqual([
      [
        "Sheet: Sales",
        "Date | Note |  | Amount",
        "2026-04-01 12:00:00 | two lines |  | 12.50",
        " |  | x",
      ].join("\n"),
      "Sheet: Empty",
    ]);
    expect(rows).toEqual([
      { sheetIndex: 0, rowNumber: 1, line: 2 },
      { sheetIndex: 0, rowNumber: 2, line: 3 },
      { sheetIndex: 0, rowNumber: 5, line: 4 },
    ]);
  });

  it("gives each row the line number numberDocumentLines gives it", () => {
    const { xlsx, transactions } = walletReportFixture();
    const workbook = readXlsx(xlsx);
    const { pages, rows } = renderWorkbook(workbook);
    const numbered = numberDocumentLines(pages).split("\n");
    const byNumber = new Map(
      numbered
        .map((line) => /^L(\d+)│(.*)$/.exec(line))
        .filter((match) => match !== null)
        .map((match) => [Number(match[1]), match[2]]),
    );
    expect(byNumber.get(1)).toBe("Sheet: Transaction Report");
    const sheet = workbook.sheets[0];
    for (const rendered of rows) {
      const row = sheet.rows.find((r) => r.number === rendered.rowNumber)!;
      const first = row.cells.find((cell) => cell !== null);
      expect(byNumber.get(rendered.line)).toContain(
        first && "text" in first ? first.text : "",
      );
    }
    const header = rows.find((r) => r.rowNumber === 18)!;
    expect(byNumber.get(header.line)).toBe(
      "Date | Transaction Type | Description | Order ID | Money Direction | Amount | Status | Balance After Transactions",
    );
    expect(rows.filter((r) => r.rowNumber > 18)).toHaveLength(transactions);
    expect(byNumber.size).toBe(rows.length + 1);
  });

  it("renders a CSV file the same way", () => {
    const { pages } = renderWorkbook(
      readCsv(Buffer.from("a;b\n1;2\n"), { sheetName: "export" }),
    );
    expect(pages).toEqual(["Sheet: export\na | b\n1 | 2"]);
  });
});

describe("detectionText", () => {
  it("holds every word, with sheet names, for phrase matching", () => {
    const text = detectionText(readXlsx(walletReportFixture().xlsx));
    expect(text.split("\n")[0]).toBe("Sheet: Transaction Report");
    expect(text).toContain("Total Money In 54.15 MYR 4");
    expect(text).toContain("Transaction Details");
    expect(text).not.toContain("|");
  });
});

describe("what the AI reads of a workbook (006 S4.5 decisions)", () => {
  it("writes a | inside a cell as ¦, so it never reads as a cell boundary", () => {
    const workbook = readCsv(Buffer.from('a,"b | c",d\n'), { sheetName: "x" });
    const { pages } = renderWorkbook(workbook);
    expect(pages).toEqual(["Sheet: x\na | b \u00a6 c | d"]);
    // Phrase matching reads the cells as they are.
    expect(detectionText(workbook)).toContain("b | c");
  });

  it("reads a hidden sheet like any other, and says it is hidden", () => {
    const workbook = readXlsx(
      buildXlsx({
        sheets: [
          { name: "Shown", rows: [["one"]] },
          { name: "Lookup", rows: [["two"]], state: "hidden" },
          { name: "Macro", rows: [["three"]], state: "veryHidden" },
        ],
      }),
    );
    expect(workbook.sheets.map((sheet) => sheet.hidden ?? false)).toEqual([
      false,
      true,
      true,
    ]);
    expect(renderWorkbook(workbook).pages).toEqual([
      "Sheet: Shown\none",
      "Sheet: Lookup (hidden)\ntwo",
      "Sheet: Macro (hidden)\nthree",
    ]);
    expect(detectionText(workbook)).toContain("two");
  });
});
