import { describe, expect, it } from "vitest";
import { readingForUpload, type UploadProfile } from "./upload-reading.js";

const CHOICES =
  "auto, receipt, items, or profile:<id> for an enabled import profile";

/** The saved profiles a test knows about, by id. */
function profiles(
  known: Record<number, UploadProfile> = {},
): (id: number) => UploadProfile | null {
  return (id) => known[id] ?? null;
}

const none = profiles();

describe("readingForUpload", () => {
  it("reads a missing choice as Auto-detect, the standard reading", () => {
    const expected = {
      ok: true,
      readAs: "auto",
      readHow: "standard",
      profileId: null,
      importMode: null,
    };
    expect(readingForUpload(null, none)).toEqual(expected);
    expect(readingForUpload("", none)).toEqual(expected);
  });

  it("keeps Auto-detect as the standard reading until detection exists", () => {
    expect(
      readingForUpload("auto", profiles({ 1: { name: "A", enabled: true } })),
    ).toEqual({
      ok: true,
      readAs: "auto",
      readHow: "standard",
      profileId: null,
      importMode: null,
    });
  });

  it("records a named reading as chosen", () => {
    expect(readingForUpload("receipt", none)).toEqual({
      ok: true,
      readAs: "receipt",
      readHow: "chosen",
      profileId: null,
      importMode: null,
    });
    expect(readingForUpload("items", none)).toEqual({
      ok: true,
      readAs: "items",
      readHow: "chosen",
      profileId: null,
      importMode: null,
    });
  });

  it("reads an enabled profile as chosen, in Summary, by its id", () => {
    const asked: number[] = [];
    const find = (id: number) => {
      asked.push(id);
      return { name: "Shopee statement", enabled: true };
    };
    expect(readingForUpload("profile:12", find)).toEqual({
      ok: true,
      readAs: "profile",
      readHow: "chosen",
      profileId: "12",
      importMode: "summary",
    });
    expect(asked).toEqual([12]);
  });

  it("refuses a profile that does not exist, naming the id", () => {
    expect(readingForUpload("profile:7", none)).toEqual({
      ok: false,
      error:
        "No import profile has the id 7; it may have been deleted. Choose another way to read this document.",
    });
  });

  it("refuses a disabled profile by name (US6 AS12)", () => {
    expect(
      readingForUpload(
        "profile:3",
        profiles({ 3: { name: "Fee notice", enabled: false } }),
      ),
    ).toEqual({
      ok: false,
      error:
        'The import profile "Fee notice" is turned off. Turn it on in Settings, or choose another way to read this document.',
    });
  });

  it("refuses a choice it does not know, naming the ones it does", () => {
    const anyProfile = () => ({ name: "A", enabled: true });
    for (const value of [
      "Receipt",
      "profile",
      "profile:",
      "profile:0",
      "profile:01",
      "profile:-1",
      "profile:1.5",
      "profile: 1",
      "profile:builtin:items@1",
      "profile:1234567890123456",
      "several",
      " items",
    ]) {
      const result = readingForUpload(value, anyProfile);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          `Unknown way to read this document: "${value}". Use one of: ${CHOICES}.`,
        );
      }
    }
  });

  it("refuses a file sent in place of a choice", () => {
    const result = readingForUpload(new File(["x"], "x.txt"), none);
    expect(result).toEqual({
      ok: false,
      error: `Unknown way to read this document: a file. Use one of: ${CHOICES}.`,
    });
  });
});
