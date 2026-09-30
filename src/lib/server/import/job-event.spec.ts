import { describe, expect, it } from "vitest";
import type { importQueue } from "../db/schema.js";
import { jobForEvent } from "./job-event.js";

describe("jobForEvent", () => {
  it("drops the document text and keeps every other column", () => {
    const row = {
      id: "job-1",
      state: 4,
      originalFilename: "receipt.pdf",
      extractedText: "RECEIPT 12.50",
      preExtractedText: "RECEIPT 12.50",
      resultId: 7,
    } as unknown as typeof importQueue.$inferSelect;

    expect(jobForEvent(row)).toEqual({
      id: "job-1",
      state: 4,
      originalFilename: "receipt.pdf",
      resultId: 7,
    });
    // The row itself is left as it was.
    expect(row.extractedText).toBe("RECEIPT 12.50");
  });
});
