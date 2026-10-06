import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  buildXlsx,
  buildZip,
  walletReportFixture,
} from "../extraction/spreadsheet/__fixtures__/build-xlsx.js";

/**
 * What Auto Import accepts as an upload (006 FR-050), and that the check the
 * other uploads use is not widened: Reconciliation and record attachments
 * still refuse a spreadsheet.
 *
 * Every file is made in memory. Nothing is stored, but the storage helpers
 * read the storage path when they load, so it is pointed at a folder under
 * `os.tmpdir()`.
 */

const sandbox = mkdtempSync(join(tmpdir(), "akaun-upload-type-spec-"));

vi.mock("$lib/server/env.js", () => ({
  STORAGE_PATH: sandbox,
  DATABASE_PATH: "/dev/null",
  OCR_CACHE_PATH: "/dev/null",
}));

const { importUploadNameRefusal, sniffImportUpload } =
  await import("./upload-type.js");
const { sniffAllowedType } = await import("../file-storage.js");

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

const PDF = Buffer.from("%PDF-1.7\n1 0 obj <<>> endobj\n");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const XLSX = buildXlsx({
  sheets: [
    {
      name: "Sheet1",
      rows: [
        ["Date", "Amount"],
        ["2026-03-01", 5],
      ],
    },
  ],
});
const CSV = Buffer.from("Date,Amount\n2026-03-01,5.00\n");

/** An old Office file: an `.xls`, or with `protectedFile` an encrypted `.xlsx`. */
function compoundFile(protectedFile = false): Buffer {
  const file = Buffer.alloc(1024);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(file);
  Buffer.from(protectedFile ? "EncryptedPackage" : "Workbook", "utf16le").copy(
    file,
    600,
  );
  return file;
}

describe("importUploadNameRefusal", () => {
  it("takes a PDF, a photo, an .xlsx and a .csv, in any case", () => {
    for (const name of [
      "a.pdf",
      "a.JPG",
      "a.jpeg",
      "a.png",
      "Report.XLSX",
      "export.csv",
    ]) {
      expect(importUploadNameRefusal(name)).toBeNull();
    }
  });

  it("names an old .xls and a binary .xlsb workbook", () => {
    expect(importUploadNameRefusal("report.xls")).toMatch(
      /old Excel file \(\.xls\).*save it as \.xlsx or \.csv/,
    );
    expect(importUploadNameRefusal("report.XLSB")).toMatch(
      /binary Excel workbook \(\.xlsb\)/,
    );
  });

  it("refuses any other file, naming what is accepted", () => {
    expect(importUploadNameRefusal("notes.docx")).toBe(
      "Unsupported file type. Upload a PDF, JPG, PNG, Excel workbook (.xlsx) or CSV file.",
    );
    expect(importUploadNameRefusal("no-extension")).toMatch(/Unsupported/);
  });
});

describe("sniffImportUpload: a PDF or a photo, as before (FR-004)", () => {
  it("takes each by its content", () => {
    expect(sniffImportUpload(PDF, "a.pdf")).toEqual({ ok: true, type: "pdf" });
    expect(sniffImportUpload(JPEG, "a.jpg")).toEqual({
      ok: true,
      type: "jpeg",
    });
    expect(sniffImportUpload(PNG, "a.png")).toEqual({ ok: true, type: "png" });
  });

  it("refuses with the message it always gave, a workbook named .pdf too", () => {
    for (const buffer of [Buffer.from("hello"), XLSX, CSV]) {
      expect(sniffImportUpload(buffer, "a.pdf")).toEqual({
        ok: false,
        error: "File content is not a valid PDF, JPG, or PNG.",
      });
    }
  });
});

describe("sniffImportUpload: an Excel workbook", () => {
  it("takes a zip that holds xl/workbook.xml", () => {
    expect(sniffImportUpload(XLSX, "a.xlsx")).toEqual({
      ok: true,
      type: "xlsx",
    });
    expect(sniffImportUpload(walletReportFixture().xlsx, "w.xlsx").ok).toBe(
      true,
    );
  });

  it("names an old .xls renamed .xlsx, and a password-protected workbook", () => {
    expect(sniffImportUpload(compoundFile(), "a.xlsx")).toEqual({
      ok: false,
      error: expect.stringMatching(/old Excel file \(\.xls\)/),
    });
    expect(sniffImportUpload(compoundFile(true), "a.xlsx")).toEqual({
      ok: false,
      error: expect.stringMatching(/protected with a password/),
    });
  });

  it("names a binary workbook, and refuses a zip or text that is no workbook", () => {
    const xlsb = buildZip([{ name: "xl/workbook.bin", data: "x" }]);
    expect(sniffImportUpload(xlsb, "a.xlsx")).toEqual({
      ok: false,
      error: expect.stringMatching(/\.xlsb/),
    });
    const other = buildZip([{ name: "word/document.xml", data: "<w/>" }]);
    expect(sniffImportUpload(other, "a.xlsx")).toEqual({
      ok: false,
      error: "The file is a zip archive but not an Excel workbook (.xlsx).",
    });
    for (const buffer of [CSV, PDF]) {
      expect(sniffImportUpload(buffer, "a.xlsx")).toEqual({
        ok: false,
        error: "The file is not an Excel workbook (.xlsx).",
      });
    }
  });

  it("names a password-protected zip", () => {
    const locked = buildZip([
      { name: "xl/workbook.xml", data: "<workbook/>", encrypted: true },
    ]);
    expect(sniffImportUpload(locked, "a.xlsx")).toEqual({
      ok: false,
      error: expect.stringMatching(/password/),
    });
  });
});

describe("sniffImportUpload: a CSV file", () => {
  it("takes text, in UTF-8, Windows-1252 or UTF-16 with its byte order mark", () => {
    expect(sniffImportUpload(CSV, "a.csv")).toEqual({ ok: true, type: "csv" });
    const latin = Buffer.from([0x43, 0x61, 0x66, 0xe9, 0x2c, 0x31, 0x0a]);
    expect(sniffImportUpload(latin, "a.csv").ok).toBe(true);
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("Date,Amount\n", "utf16le"),
    ]);
    expect(sniffImportUpload(utf16, "a.csv").ok).toBe(true);
  });

  it("refuses a workbook, a PDF, a photo, binary data and an empty file", () => {
    expect(sniffImportUpload(XLSX, "a.csv")).toEqual({
      ok: false,
      error: expect.stringMatching(
        /is an Excel workbook\. Rename it to \.xlsx/,
      ),
    });
    // Renaming these to .xlsx would not help, so the advice is not to.
    expect(sniffImportUpload(compoundFile(), "a.csv")).toEqual({
      ok: false,
      error: expect.stringMatching(
        /not a CSV file\. This is an old Excel file \(\.xls\).*save it as \.xlsx or \.csv/,
      ),
    });
    expect(sniffImportUpload(compoundFile(true), "a.csv")).toEqual({
      ok: false,
      error: expect.stringMatching(
        /not a CSV file\. .*protected with a password/,
      ),
    });
    for (const buffer of [compoundFile(), compoundFile(true)]) {
      const check = sniffImportUpload(buffer, "a.csv");
      expect(check.ok ? "" : check.error).not.toMatch(/Rename it/);
    }
    for (const buffer of [PDF, JPEG, PNG]) {
      expect(sniffImportUpload(buffer, "a.csv")).toEqual({
        ok: false,
        error: expect.stringMatching(/PDF or an image/),
      });
    }
    expect(sniffImportUpload(Buffer.from([0x41, 0, 0x42]), "a.csv")).toEqual({
      ok: false,
      error: expect.stringMatching(/does not hold text/),
    });
    expect(sniffImportUpload(Buffer.alloc(0), "a.csv")).toEqual({
      ok: false,
      error: "The CSV file is empty.",
    });
  });
});

describe("sniffAllowedType is not widened", () => {
  // Reconciliation statements and record attachments check with this, so a
  // spreadsheet is still refused there (FR-050).
  it("still refuses a workbook and a CSV file", () => {
    expect(sniffAllowedType(XLSX)).toBeNull();
    expect(sniffAllowedType(CSV)).toBeNull();
    expect(sniffAllowedType(walletReportFixture().xlsx)).toBeNull();
  });
});
