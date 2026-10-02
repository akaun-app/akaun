import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { buildXlsx } from "./spreadsheet/__fixtures__/build-xlsx.js";

/**
 * The search text of a record's files (006 S4.2): a spreadsheet Auto Import
 * made a record from is turned into text, as the reading saw it, so the
 * record is found by what the sheet says. The storage folder is one under
 * `os.tmpdir()`.
 */

const root = mkdtempSync(join(tmpdir(), "akaun-attachment-text-"));
vi.mock("$lib/server/env.js", () => ({
  STORAGE_PATH: root,
  DATABASE_PATH: "/dev/null",
  OCR_CACHE_PATH: join(root, "ocr-cache"),
}));
vi.mock("$lib/server/logger.js", () => {
  const silent = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  return { createLogger: () => silent };
});

const { extractAttachmentsText } = await import("./attachment-text.js");

afterAll(() => rmSync(root, { recursive: true, force: true }));

function store(relativePath: string, data: Buffer | string): string {
  const abs = join(root, relativePath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  return relativePath;
}

describe("extractAttachmentsText with a spreadsheet", () => {
  it("gives a workbook's and a CSV file's text, sheet by sheet", async () => {
    const xlsx = store(
      "records/2026/03/a_payout.xlsx",
      buildXlsx({
        sheets: [
          {
            name: "Payout",
            rows: [
              ["Order", "Amount"],
              ["A1", { raw: "12.50" }],
            ],
          },
        ],
      }),
    );
    const csv = store(
      "records/2026/03/b_fees.csv",
      "Fee,Amount\nCommission,3.10\n",
    );

    expect(await extractAttachmentsText([xlsx, csv])).toBe(
      "Sheet: Payout\nOrder | Amount\nA1 | 12.50\nSheet: Sheet1\nFee | Amount\nCommission | 3.10",
    );
  });

  it("skips a workbook it cannot read and keeps the others", async () => {
    const broken = store("records/2026/03/c_broken.xlsx", "not a workbook");
    const csv = store(
      "records/2026/03/d_fees.csv",
      "Fee,Amount\nService,1.00\n",
    );

    expect(await extractAttachmentsText([broken, csv])).toBe(
      "Sheet: Sheet1\nFee | Amount\nService | 1.00",
    );
    expect(await extractAttachmentsText([broken])).toBeNull();
  });
});
