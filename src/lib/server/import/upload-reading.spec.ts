import { describe, expect, it } from "vitest";
import { readingForUpload } from "./upload-reading.js";

describe("readingForUpload", () => {
  it("reads a missing choice as Auto-detect, the standard reading", () => {
    expect(readingForUpload(null)).toEqual({
      ok: true,
      readAs: "auto",
      readHow: "standard",
    });
    expect(readingForUpload("")).toEqual({
      ok: true,
      readAs: "auto",
      readHow: "standard",
    });
  });

  it("keeps Auto-detect as the standard reading while no profile exists", () => {
    expect(readingForUpload("auto")).toEqual({
      ok: true,
      readAs: "auto",
      readHow: "standard",
    });
  });

  it("records a named reading as chosen", () => {
    expect(readingForUpload("receipt")).toEqual({
      ok: true,
      readAs: "receipt",
      readHow: "chosen",
    });
    expect(readingForUpload("items")).toEqual({
      ok: true,
      readAs: "items",
      readHow: "chosen",
    });
  });

  it("refuses a choice it does not know, naming the ones it does", () => {
    for (const value of ["Receipt", "profile", "several", " items"]) {
      const result = readingForUpload(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          `Unknown way to read this document: "${value}". Use one of: auto, receipt, items.`,
        );
      }
    }
  });

  it("refuses a file sent in place of a choice", () => {
    const result = readingForUpload(new File(["x"], "x.txt"));
    expect(result).toEqual({
      ok: false,
      error:
        "Unknown way to read this document: a file. Use one of: auto, receipt, items.",
    });
  });
});
