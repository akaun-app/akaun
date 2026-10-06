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
  it("reads a missing choice as Auto-detect, the standard reading, with no mode yet", () => {
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

  it("keeps Auto-detect as the standard reading until a profile is detected", () => {
    expect(
      readingForUpload(
        "auto",
        profiles({
          1: { name: "A", enabled: true, mode: "every_transaction" },
        }),
      ),
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

  it("reads an enabled profile as chosen, in its own mode, by its id", () => {
    const asked: number[] = [];
    const find = (id: number) => {
      asked.push(id);
      return {
        name: "Shopee statement",
        enabled: true,
        mode: "summary" as const,
      };
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

  it("refuses a deleted profile by the name it had, when that is known", () => {
    const names: Record<number, string> = { 7: "Old statement" };
    expect(
      readingForUpload("profile:7", none, (id) => names[id] ?? null),
    ).toEqual({
      ok: false,
      error:
        'The import profile "Old statement" was deleted. Choose another way to read this document.',
    });
    expect(
      readingForUpload("profile:8", none, (id) => names[id] ?? null),
    ).toEqual({
      ok: false,
      error:
        "No import profile has the id 8; it may have been deleted. Choose another way to read this document.",
    });
  });

  it("refuses a disabled profile by name (US6 AS12)", () => {
    expect(
      readingForUpload(
        "profile:3",
        profiles({
          3: { name: "Fee notice", enabled: false, mode: "summary" },
        }),
      ),
    ).toEqual({
      ok: false,
      error:
        'The import profile "Fee notice" is turned off. Turn it on in Settings, or choose another way to read this document.',
    });
  });

  it("refuses a choice it does not know, naming the ones it does", () => {
    const anyProfile = () => ({
      name: "A",
      enabled: true,
      mode: "summary" as const,
    });
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

  describe("the profile's own mode (FR-002)", () => {
    const find = profiles({
      4: { name: "Wallet report", enabled: true, mode: "every_transaction" },
      6: { name: "Fee notice", enabled: true, mode: "summary" },
    });

    it("stores the chosen profile's mode, whatever it is", () => {
      expect(readingForUpload("profile:4", find)).toEqual({
        ok: true,
        readAs: "profile",
        readHow: "chosen",
        profileId: "4",
        importMode: "every_transaction",
      });
      expect(readingForUpload("profile:6", find)).toMatchObject({
        ok: true,
        importMode: "summary",
      });
    });

    it("stores no mode for Auto-detect until it finds a profile", () => {
      expect(readingForUpload("auto", find)).toMatchObject({
        ok: true,
        readAs: "auto",
        importMode: null,
      });
    });

    it("stores no mode for a receipt or several items, which have none", () => {
      for (const readAs of ["receipt", "items"]) {
        expect(readingForUpload(readAs, find)).toMatchObject({
          ok: true,
          readAs,
          importMode: null,
        });
      }
    });
  });
});
