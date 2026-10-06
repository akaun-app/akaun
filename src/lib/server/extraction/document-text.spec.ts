import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  buildXlsx,
  walletReportFixture,
} from "./spreadsheet/__fixtures__/build-xlsx.js";

// The OCR cache is never used here (the test PDF has a text layer), but the
// module reads its path at load; keep it out of the real storage folder.
const root = mkdtempSync(join(tmpdir(), "akaun-document-text-"));
vi.mock("$lib/server/env.js", () => ({
  STORAGE_PATH: root,
  OCR_CACHE_PATH: join(root, "ocr-cache"),
}));

const {
  CSV_MIME_TYPE,
  XLSX_MIME_TYPE,
  extractDocumentSource,
  extractNumberedText,
  extractPlainAndNumberedText,
  extractText,
  inferMimeType,
  isEmptyWorkbook,
  isSpreadsheetMimeType,
  keepsReadText,
  numberDocumentLines,
  stripLineNumbers,
} = await import("./document-text.js");

afterAll(() => rmSync(root, { recursive: true, force: true }));

// A small text PDF made here, one page per entry, each line its own text run.
// Each page needs some length: a PDF with under 50 characters a page and 200
// in all is taken for a scan and sent to OCR.
async function writePdf(pages: string[][]): Promise<string> {
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));
  for (const lines of pages) {
    doc.addPage();
    lines.forEach((line, index) => doc.text(line, 72, 72 + index * 24));
  }
  doc.end();
  await done;
  const path = join(root, `doc-${pages.length}-${Date.now()}.pdf`);
  writeFileSync(path, Buffer.concat(chunks));
  return path;
}

describe("stripLineNumbers", () => {
  it("gives back only what the document prints", () => {
    const pages = ["Invoice 12\n\nService fee 10.00", "Total  10.00"];
    expect(stripLineNumbers(numberDocumentLines(pages))).toBe(
      "Invoice 12\nService fee 10.00\nTotal  10.00",
    );
  });

  it("keeps a printed line that only looks like a marker", () => {
    expect(stripLineNumbers("L0001│L0002│x\nL0003│--- page 9 ---x")).toBe(
      "L0002│x\n--- page 9 ---x",
    );
  });
});

describe("numberDocumentLines", () => {
  it("numbers every line across pages and marks each page", () => {
    expect(
      numberDocumentLines(["Invoice 12\nService fee 10.00", "Total 10.00"]),
    ).toBe(`--- page 1 ---
L0001│Invoice 12
L0002│Service fee 10.00
--- page 2 ---
L0003│Total 10.00`);
  });

  it("leaves blank lines out without numbering them, and keeps indentation", () => {
    expect(numberDocumentLines(["  Fee\r\n\r\n   \nTax  "])).toBe(
      "--- page 1 ---\nL0001│  Fee\nL0002│Tax",
    );
  });

  it("keeps every line of a long document", () => {
    const lines = Array.from({ length: 12_000 }, (_, i) => `line ${i + 1}`);
    const text = numberDocumentLines([lines.join("\n")]);
    expect(text.split("\n")).toHaveLength(12_001);
    expect(text.endsWith("L12000│line 12000")).toBe(true);
  });
});

describe("extractNumberedText", () => {
  it("keeps a multi-page PDF's line breaks and numbers its lines", async () => {
    const path = await writePdf([
      [
        "Fee notice FN-7 for the month of August, issued to the account holder",
        "Commission fee 12.50",
        "Service fee 3.00",
      ],
      [
        "Transaction fee 1.25",
        "Total charges 16.75, payable within thirty days of the notice date",
      ],
    ]);

    const text = await extractNumberedText(path, "application/pdf");

    expect(text).toBe(`--- page 1 ---
L0001│Fee notice FN-7 for the month of August, issued to the account holder
L0002│Commission fee 12.50
L0003│Service fee 3.00
--- page 2 ---
L0004│Transaction fee 1.25
L0005│Total charges 16.75, payable within thirty days of the notice date`);
  });

  it("leaves the receipt reading's text as one run, as before", async () => {
    const path = await writePdf([
      [
        "Receipt R-1 from the corner stationery shop on the high street",
        "Total 9.90",
      ],
      ["Thank you for shopping with us, and please keep this receipt"],
    ]);

    const text = await extractText(path, "application/pdf");

    expect(text).not.toContain("\n");
    expect(text).toContain("Receipt R-1");
    expect(text).toContain("Thank you");
  });

  it("refuses a file type it cannot read", async () => {
    await expect(
      extractNumberedText(join(root, "notes.txt"), "text/plain"),
    ).rejects.toThrow("Unsupported file type");
  });
});

describe("extractPlainAndNumberedText", () => {
  it("gives exactly what each of the two readings would have read on its own", async () => {
    const path = await writePdf([
      [
        "Shopee Income Statement for August, issued to the seller account holder",
        "Product price 15,012.40",
        "Commission fee -812.35",
      ],
      ["Total Payout Released 14,200.05, paid to the seller's bank account"],
    ]);

    const both = await extractPlainAndNumberedText(path, "application/pdf");

    // Auto-detect reads the file once, and whichever way it then reads the
    // document, the text is what that way always had (FR-004, FR-040).
    expect(both.plain).toBe(await extractText(path, "application/pdf"));
    expect(both.numbered).toBe(
      await extractNumberedText(path, "application/pdf"),
    );
  });

  it("refuses a file type it cannot read", async () => {
    await expect(
      extractPlainAndNumberedText(join(root, "notes.txt"), "text/plain"),
    ).rejects.toThrow("Unsupported file type");
  });
});

// ── Spreadsheets (006 S4.2) ────────────────────────────────────────────────

function writeFile(name: string, data: Buffer | string): string {
  const path = join(root, `${Date.now()}-${Math.random()}-${name}`);
  writeFileSync(path, data);
  return path;
}

describe("inferMimeType and spreadsheets", () => {
  it("names a workbook and a CSV file, and nothing else as a spreadsheet", () => {
    expect(inferMimeType("Report.XLSX")).toBe(XLSX_MIME_TYPE);
    expect(inferMimeType("export.csv")).toBe(CSV_MIME_TYPE);
    expect(isSpreadsheetMimeType(XLSX_MIME_TYPE)).toBe(true);
    expect(isSpreadsheetMimeType(CSV_MIME_TYPE)).toBe(true);
    for (const name of ["a.pdf", "a.jpg", "a.png", "a.xls", "a.txt"]) {
      expect(isSpreadsheetMimeType(inferMimeType(name))).toBe(false);
    }
    expect(inferMimeType("a.xls")).toBe("application/octet-stream");
  });

  it("does not keep a spreadsheet's text: it is quick to read again", () => {
    expect(keepsReadText("a.xlsx")).toBe(false);
    expect(keepsReadText("a.csv")).toBe(false);
  });

  it("leaves the PDF and photo extractors refusing a spreadsheet", async () => {
    const path = writeFile("a.csv", "Date,Amount\n2026-03-01,5\n");
    await expect(extractText(path, CSV_MIME_TYPE)).rejects.toThrow(
      "Unsupported file type",
    );
  });
});

describe("extractDocumentSource", () => {
  it("turns a workbook into one numbered page per sheet (FR-051)", async () => {
    const path = writeFile(
      "book.xlsx",
      buildXlsx({
        sheets: [
          {
            name: "Payouts",
            rows: [
              ["Date", "Description", "Amount"],
              [{ serial: 46082, style: 1 }, "Order 1", { raw: "12.50" }],
              null,
              ["", "Total", { formula: "SUM(C2:C2)", cached: "12.5" }],
            ],
          },
          { name: "Notes", rows: [["Exported by the platform"]] },
        ],
        styles: [14],
      }),
    );

    const source = await extractDocumentSource(path, XLSX_MIME_TYPE);

    expect(source.numbered).toBe(`--- page 1 ---
L0001│Sheet: Payouts
L0002│Date | Description | Amount
L0003│2026-03-01 | Order 1 | 12.50
L0004│ | Total | 12.5
--- page 2 ---
L0005│Sheet: Notes
L0006│Exported by the platform`);
    // The same text with no numbers and no page markers, as a reading of
    // items keeps it for search.
    expect(source.plain).toBe(stripLineNumbers(source.numbered));
    expect(source.workbook?.format).toBe("xlsx");
    expect(source.workbook?.sheets.map((sheet) => sheet.name)).toEqual([
      "Payouts",
      "Notes",
    ]);
  });

  it("reads a CSV file as one sheet", async () => {
    const path = writeFile(
      "export.csv",
      'Date;Description;Amount\n2026-03-01;"Order; 1";5,00\n',
    );

    const source = await extractDocumentSource(path, CSV_MIME_TYPE);

    expect(source.numbered).toBe(`--- page 1 ---
L0001│Sheet: Sheet1
L0002│Date | Description | Amount
L0003│2026-03-01 | Order; 1 | 5,00`);
    expect(source.workbook?.format).toBe("csv");
  });

  it("reads the wallet-shaped workbook with every row on its own line", async () => {
    const fixture = walletReportFixture();
    const path = writeFile("wallet.xlsx", fixture.xlsx);

    const source = await extractDocumentSource(path, XLSX_MIME_TYPE);

    const lines = source.plain.split("\n");
    const header = lines.findIndex((line) => line.startsWith("Date | "));
    expect(header).toBeGreaterThan(0);
    expect(lines.length - header - 1).toBe(fixture.transactions);
  });

  it("names the problem with a file it cannot read", async () => {
    const xls = Buffer.alloc(1024);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(xls);
    Buffer.from("EncryptedPackage", "utf16le").copy(xls, 600);
    const path = writeFile("locked.xlsx", xls);
    await expect(extractDocumentSource(path, XLSX_MIME_TYPE)).rejects.toThrow(
      /protected with a password/,
    );
  });

  it("gives a PDF exactly what extractPlainAndNumberedText gives", async () => {
    const path = await writePdf([
      [
        "Receipt R-2 from the corner stationery shop on the high street",
        "Total 4.20",
      ],
    ]);
    const source = await extractDocumentSource(path, "application/pdf");
    expect(source).toEqual(
      await extractPlainAndNumberedText(path, "application/pdf"),
    );
    expect(source.workbook).toBeUndefined();
  });
});

describe("isEmptyWorkbook", () => {
  it("is true only when no cell shows anything", () => {
    const sheet = (cells: (string | null)[][]) => ({
      format: "csv" as const,
      sheets: [
        {
          name: "Sheet1",
          rows: cells.map((row, i) => ({
            number: i + 1,
            cells: row.map((text) =>
              text === null ? null : { kind: "string" as const, text },
            ),
          })),
        },
      ],
    });
    expect(isEmptyWorkbook({ format: "xlsx", sheets: [] })).toBe(true);
    expect(isEmptyWorkbook(sheet([[null, "  "], [""]]))).toBe(true);
    expect(isEmptyWorkbook(sheet([[null, "x"]]))).toBe(false);
  });
});
