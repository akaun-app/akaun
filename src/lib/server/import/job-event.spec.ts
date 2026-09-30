import { describe, expect, it } from "vitest";
import type { importItems, importQueue } from "../db/schema.js";
import { itemForEvent, jobForEvent } from "./job-event.js";

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

describe("itemForEvent", () => {
  it("sends an item whole, as a copy", () => {
    const row = {
      id: "item-1",
      jobId: "job-1",
      state: 4,
      position: 0,
      amount: 12.5,
    } as unknown as typeof importItems.$inferSelect;

    const sent = itemForEvent(row);
    expect(sent).toEqual(row);
    expect(sent).not.toBe(row);
  });
});
