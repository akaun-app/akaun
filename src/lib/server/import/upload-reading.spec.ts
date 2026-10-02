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
  it("reads a missing choice as Auto-detect, the standard reading, in Summary", () => {
    const expected = {
      ok: true,
      readAs: "auto",
      readHow: "standard",
      profileId: null,
      importMode: "summary",
    };
    expect(readingForUpload(null, null, none)).toEqual(expected);
    expect(readingForUpload("", null, none)).toEqual(expected);
  });

  it("keeps Auto-detect as the standard reading until a profile is detected", () => {
    expect(
      readingForUpload(
        "auto",
        null,
        profiles({ 1: { name: "A", enabled: true } }),
      ),
    ).toEqual({
      ok: true,
      readAs: "auto",
      readHow: "standard",
      profileId: null,
      importMode: "summary",
    });
  });

  it("records a named reading as chosen", () => {
    expect(readingForUpload("receipt", null, none)).toEqual({
      ok: true,
      readAs: "receipt",
      readHow: "chosen",
      profileId: null,
      importMode: null,
    });
    expect(readingForUpload("items", null, none)).toEqual({
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
    expect(readingForUpload("profile:12", null, find)).toEqual({
      ok: true,
      readAs: "profile",
      readHow: "chosen",
      profileId: "12",
      importMode: "summary",
    });
    expect(asked).toEqual([12]);
  });

  it("refuses a profile that does not exist, naming the id", () => {
    expect(readingForUpload("profile:7", null, none)).toEqual({
      ok: false,
      error:
        "No import profile has the id 7; it may have been deleted. Choose another way to read this document.",
    });
  });

  it("refuses a deleted profile by the name it had, when that is known", () => {
    const names: Record<number, string> = { 7: "Old statement" };
    expect(
      readingForUpload("profile:7", null, none, (id) => names[id] ?? null),
    ).toEqual({
      ok: false,
      error:
        'The import profile "Old statement" was deleted. Choose another way to read this document.',
    });
    expect(
      readingForUpload("profile:8", null, none, (id) => names[id] ?? null),
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
        null,
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
      const result = readingForUpload(value, null, anyProfile);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(
          `Unknown way to read this document: "${value}". Use one of: ${CHOICES}.`,
        );
      }
    }
  });

  it("refuses a file sent in place of a choice", () => {
    const result = readingForUpload(new File(["x"], "x.txt"), null, none);
    expect(result).toEqual({
      ok: false,
      error: `Unknown way to read this document: a file. Use one of: ${CHOICES}.`,
    });
  });

  describe("the Import choice (FR-002)", () => {
    const enabled = profiles({ 4: { name: "Wallet report", enabled: true } });

    it("stores Every transaction for a profile and for Auto-detect", () => {
      expect(
        readingForUpload("profile:4", "every_transaction", enabled),
      ).toEqual({
        ok: true,
        readAs: "profile",
        readHow: "chosen",
        profileId: "4",
        importMode: "every_transaction",
      });
      expect(readingForUpload("auto", "every_transaction", enabled)).toEqual({
        ok: true,
        readAs: "auto",
        readHow: "standard",
        profileId: null,
        importMode: "every_transaction",
      });
      expect(readingForUpload("profile:4", "summary", enabled)).toMatchObject({
        ok: true,
        importMode: "summary",
      });
    });

    it("reads a missing or empty choice as Summary", () => {
      for (const missing of [null, undefined, ""]) {
        expect(readingForUpload("profile:4", missing, enabled)).toMatchObject({
          ok: true,
          importMode: "summary",
        });
      }
    });

    it("stores no mode for a receipt or several items, which have none", () => {
      for (const readAs of ["receipt", "items"]) {
        expect(
          readingForUpload(readAs, "every_transaction", enabled),
        ).toMatchObject({ ok: true, readAs, importMode: null });
      }
    });

    it("refuses a mode it does not know, whatever Read as says", () => {
      for (const readAs of ["profile:4", "auto", "receipt", "items"]) {
        for (const mode of ["Summary", "every", "transactions", " summary"]) {
          expect(readingForUpload(readAs, mode, enabled)).toEqual({
            ok: false,
            error: `Unknown import mode: "${mode}". Use summary or every_transaction.`,
          });
        }
      }
      expect(
        readingForUpload("auto", new File(["x"], "x.txt"), enabled),
      ).toEqual({
        ok: false,
        error: "Unknown import mode: a file. Use summary or every_transaction.",
      });
    });

    it("names an unknown Read as before an unknown mode", () => {
      const result = readingForUpload("several", "every", enabled);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/^Unknown way to read/);
    });
  });
});
