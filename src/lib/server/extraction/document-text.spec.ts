import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { afterAll, describe, expect, it, vi } from "vitest";

// The OCR cache is never used here (the test PDF has a text layer), but the
// module reads its path at load; keep it out of the real storage folder.
const root = mkdtempSync(join(tmpdir(), "akaun-document-text-"));
vi.mock("$lib/server/env.js", () => ({
  STORAGE_PATH: root,
  OCR_CACHE_PATH: join(root, "ocr-cache"),
}));

const {
  extractNumberedText,
  extractPlainAndNumberedText,
  extractText,
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
