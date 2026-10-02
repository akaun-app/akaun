import { describe, expect, it } from "vitest";
import { buildZip } from "./__fixtures__/build-xlsx.js";
import { crc32, looksLikeZip, openZip, ZIP_LIMITS } from "./zip.js";

/**
 * The zip reader under an `.xlsx` workbook (006 S4.1). Every archive is built
 * in memory; the point is that a damaged or hostile archive fails with a
 * reason and never gives back the wrong bytes.
 */

describe("openZip", () => {
  it("reads stored and compressed files, by name in any case", () => {
    const zip = openZip(
      buildZip([
        { name: "a.txt", data: "stored text", store: true },
        { name: "xl/Workbook.xml", data: "<workbook/>".repeat(50) },
      ]),
    );
    expect(zip.names()).toEqual(["a.txt", "xl/Workbook.xml"]);
    expect(zip.has("XL/workbook.xml")).toBe(true);
    expect(zip.has("/xl/workbook.xml")).toBe(true);
    expect(zip.read("a.txt").toString()).toBe("stored text");
    expect(zip.read("xl/workbook.xml").toString()).toBe(
      "<workbook/>".repeat(50),
    );
  });

  it("reads an empty file", () => {
    const zip = openZip(buildZip([{ name: "empty", data: "" }]));
    expect(zip.read("empty").length).toBe(0);
  });

  it("says when a part is missing", () => {
    const zip = openZip(buildZip([{ name: "a", data: "x" }]));
    expect(() => zip.read("b")).toThrow(/no part named b/);
  });

  it("refuses an encrypted archive", () => {
    expect(() =>
      openZip(buildZip([{ name: "a", data: "x", encrypted: true }])),
    ).toThrow(/password/);
  });

  it("refuses a Zip64 archive", () => {
    expect(() =>
      openZip(buildZip([{ name: "a", data: "x" }], { zip64: true })),
    ).toThrow(/Zip64/);
  });

  it("refuses a file that is not a zip, or is cut short", () => {
    expect(() =>
      openZip(
        Buffer.from("just some text, long enough to look for an end record"),
      ),
    ).toThrow(/not a valid \.xlsx/);
    const whole = buildZip([{ name: "a", data: "hello world ".repeat(20) }]);
    expect(() => openZip(whole.subarray(0, 10))).toThrow(/not a valid/);
    // The list of parts survives, but the part's own bytes are garbled.
    const garbled = Buffer.from(whole);
    garbled.fill(0xff, 31, 40);
    expect(() => openZip(garbled).read("a")).toThrow(/damaged/);
  });

  it("refuses a part that unpacks past the size it declares", () => {
    const zip = openZip(
      buildZip([{ name: "bomb", data: "A".repeat(100_000), declaredSize: 10 }]),
    );
    expect(() => zip.read("bomb")).toThrow(/damaged.*bomb/);
  });

  it("refuses a part that fails its checksum", () => {
    const zip = openZip(
      buildZip([{ name: "a", data: "hello", declaredCrc: 1234 }]),
    );
    expect(() => zip.read("a")).toThrow(/checksum/);
  });

  it("refuses a part bigger than the limit before unpacking it", () => {
    const limits = { ...ZIP_LIMITS, maxEntryBytes: 1000 };
    expect(() =>
      openZip(buildZip([{ name: "big", data: "A".repeat(1001) }]), limits),
    ).toThrow(/big.*more than/);
  });

  it("refuses a part bigger than the size asked for, before unpacking it", () => {
    const zip = openZip(buildZip([{ name: "styles", data: "A".repeat(5000) }]));
    expect(() => zip.read("styles", 4096)).toThrow(/styles.*more than 4 KB/);
    expect(zip.read("styles", 5000)).toHaveLength(5000);
  });

  it("stops when all the parts read together pass the limit", () => {
    const limits = { ...ZIP_LIMITS, maxTotalBytes: 1500 };
    const zip = openZip(
      buildZip([
        { name: "a", data: "A".repeat(1000) },
        { name: "b", data: "B".repeat(1000) },
      ]),
      limits,
    );
    zip.read("a");
    expect(() => zip.read("b")).toThrow(/unpacks to more than/);
  });

  it("refuses more parts than the limit", () => {
    const files = Array.from({ length: 4 }, (_, i) => ({
      name: `f${i}`,
      data: "x",
    }));
    expect(() =>
      openZip(buildZip(files), { ...ZIP_LIMITS, maxEntries: 3 }),
    ).toThrow(/more than 3 parts/);
  });

  it("refuses a compression method it cannot unpack", () => {
    const archive = buildZip([{ name: "a", data: "hello", store: true }]);
    archive.writeUInt16LE(12, 8); // the local header's method
    const central = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt16LE(12, central + 10);
    expect(() => openZip(archive).read("a")).toThrow(/compressed in a way/);
  });
});

describe("looksLikeZip and crc32", () => {
  it("knows a zip by its first bytes", () => {
    expect(looksLikeZip(buildZip([{ name: "a", data: "x" }]))).toBe(true);
    expect(looksLikeZip(Buffer.from("%PDF-1.7"))).toBe(false);
  });

  it("gives the standard CRC-32", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
});
