/**
 * Reading the files inside a zip archive, which is what an `.xlsx` workbook
 * is (006 S4.1). Only what a workbook needs is supported: files that are
 * stored as they are or compressed with deflate, in an archive under 4 GB.
 *
 * The file comes from an upload, so it is not trusted:
 *
 * - every size is checked before anything is unpacked, and unpacking stops at
 *   the size the archive declares, so a small file cannot unpack to gigabytes;
 * - each file's checksum is checked, so a damaged file fails instead of giving
 *   wrong cells;
 * - an encrypted archive, a split archive and the Zip64 extension (used for
 *   archives over 4 GB) are refused with a reason, never half read.
 *
 * Files are unpacked only when asked for, one at a time.
 */

import { inflateRawSync } from "node:zlib";
import { SpreadsheetError, brief } from "./types.js";

export interface ZipLimits {
  /** The most files the archive may list. */
  maxEntries: number;
  /** The largest size one file may unpack to, in bytes. */
  maxEntryBytes: number;
  /** The most bytes all the files read from one archive may unpack to. */
  maxTotalBytes: number;
}

/**
 * The upload limit is 15 MB. A workbook's XML compresses about ten to one, so
 * these leave room for a large but real workbook and stop a zip bomb early.
 */
export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 2_000,
  maxEntryBytes: 100 * 1024 * 1024,
  maxTotalBytes: 200 * 1024 * 1024,
};

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ZIP64_MARK_16 = 0xffff;
const ZIP64_MARK_32 = 0xffffffff;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_UTF8 = 0x0800;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc: number;
  localOffset: number;
}

export interface ZipArchive {
  /** Every file name in the archive, in the order it lists them. */
  names(): string[];
  /** Whether the archive holds this file. Case is ignored, as in a workbook. */
  has(name: string): boolean;
  /**
   * The file's bytes, unpacked and checked. Fails if it is not there, or if
   * it unpacks to more than `maxBytes` (when given; the archive's own limit
   * otherwise). The size is checked before anything is unpacked.
   */
  read(name: string, maxBytes?: number): Buffer;
}

/** Whether these bytes start the way a zip archive does. */
export function looksLikeZip(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    ((data[2] === 0x03 && data[3] === 0x04) ||
      (data[2] === 0x05 && data[3] === 0x06))
  );
}

/** A file name as it is looked up: forward slashes, no leading slash, any case. */
function nameKey(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

export function openZip(
  input: Uint8Array,
  limits: ZipLimits = ZIP_LIMITS,
): ZipArchive {
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const entries = readCentralDirectory(data, limits);
  const byName = new Map<string, ZipEntry>();
  for (const entry of entries) byName.set(nameKey(entry.name), entry);
  let unpacked = 0;

  return {
    names: () => entries.map((entry) => entry.name),
    has: (name) => byName.has(nameKey(name)),
    read(name, maxBytes) {
      const entry = byName.get(nameKey(name));
      if (!entry)
        throw new SpreadsheetError(
          `The file has no part named ${brief(name)}.`,
        );
      if (maxBytes !== undefined && entry.size > maxBytes) {
        throw new SpreadsheetError(
          `A part of the file (${brief(entry.name)}) unpacks to more than ${formatMegabytes(maxBytes)}, which is more than can be read.`,
        );
      }
      if (unpacked + entry.size > limits.maxTotalBytes) {
        throw new SpreadsheetError(
          `The file unpacks to more than ${formatMegabytes(limits.maxTotalBytes)}, which is more than can be read.`,
        );
      }
      const bytes = readEntry(data, entry);
      unpacked += bytes.length;
      return bytes;
    },
  };
}

/** A byte count for a message: whole megabytes, or kilobytes below one. */
function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${Math.round(mb * 10) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function damaged(detail: string): SpreadsheetError {
  return new SpreadsheetError(
    `The file is damaged and cannot be read (${detail}). Open it in Excel, save it again and upload the new copy.`,
  );
}

function tooLargeFormat(): SpreadsheetError {
  return new SpreadsheetError(
    "The file uses the Zip64 format for very large files, which cannot be read. Save it again as a normal .xlsx file.",
  );
}

function encrypted(): SpreadsheetError {
  return new SpreadsheetError(
    "The file is protected with a password. Remove the password, save it and upload it again.",
  );
}

/** Finds the end-of-archive record, which is within the last 64 KB. */
function findEndRecord(data: Buffer): number {
  const lowest = Math.max(0, data.length - 22 - 0xffff);
  for (let at = data.length - 22; at >= lowest; at--) {
    if (data.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  throw new SpreadsheetError("The file is not a valid .xlsx workbook.");
}

function readCentralDirectory(data: Buffer, limits: ZipLimits): ZipEntry[] {
  if (data.length < 22) {
    throw new SpreadsheetError("The file is not a valid .xlsx workbook.");
  }
  const end = findEndRecord(data);
  const disk = data.readUInt16LE(end + 4);
  const directoryDisk = data.readUInt16LE(end + 6);
  const count = data.readUInt16LE(end + 10);
  const directorySize = data.readUInt32LE(end + 12);
  const directoryOffset = data.readUInt32LE(end + 16);

  if (
    count === ZIP64_MARK_16 ||
    directorySize === ZIP64_MARK_32 ||
    directoryOffset === ZIP64_MARK_32 ||
    (end >= 20 && data.readUInt32LE(end - 20) === ZIP64_LOCATOR_SIGNATURE)
  ) {
    throw tooLargeFormat();
  }
  if (disk !== 0 || directoryDisk !== 0) {
    throw new SpreadsheetError(
      "The file is one part of a split archive, which cannot be read. Upload the whole workbook as one .xlsx file.",
    );
  }
  if (count > limits.maxEntries) {
    throw new SpreadsheetError(
      `The file holds more than ${limits.maxEntries} parts, which is more than a workbook can have.`,
    );
  }
  if (directoryOffset + directorySize > end)
    throw damaged("its list of parts is out of place");

  const entries: ZipEntry[] = [];
  let at = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || data.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw damaged("its list of parts is cut short");
    }
    const flags = data.readUInt16LE(at + 8);
    const method = data.readUInt16LE(at + 10);
    const crc = data.readUInt32LE(at + 16);
    const compressedSize = data.readUInt32LE(at + 20);
    const size = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    const localOffset = data.readUInt32LE(at + 42);
    const nameBytes = data.subarray(at + 46, at + 46 + nameLength);
    const name = nameBytes.toString(flags & FLAG_UTF8 ? "utf8" : "latin1");

    if (flags & (FLAG_ENCRYPTED | FLAG_STRONG_ENCRYPTION)) throw encrypted();
    if (
      compressedSize === ZIP64_MARK_32 ||
      size === ZIP64_MARK_32 ||
      localOffset === ZIP64_MARK_32
    ) {
      throw tooLargeFormat();
    }
    if (size > limits.maxEntryBytes) {
      throw new SpreadsheetError(
        `A part of the file (${brief(name)}) unpacks to more than ${formatMegabytes(limits.maxEntryBytes)}, which is more than can be read.`,
      );
    }
    entries.push({ name, method, compressedSize, size, crc, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(data: Buffer, entry: ZipEntry): Buffer {
  const at = entry.localOffset;
  if (at + 30 > data.length || data.readUInt32LE(at) !== LOCAL_SIGNATURE) {
    throw damaged(`${brief(entry.name)} is missing`);
  }
  const start =
    at + 30 + data.readUInt16LE(at + 26) + data.readUInt16LE(at + 28);
  const stop = start + entry.compressedSize;
  if (stop > data.length) throw damaged(`${brief(entry.name)} is cut short`);
  const packed = data.subarray(start, stop);

  let bytes: Buffer;
  if (entry.method === METHOD_STORED) {
    bytes = packed;
  } else if (entry.method === METHOD_DEFLATE) {
    try {
      // Unpacking stops at the declared size. A part that tries to grow past
      // it fails here rather than filling memory.
      bytes = inflateRawSync(packed, {
        maxOutputLength: Math.max(1, entry.size),
      });
    } catch {
      throw damaged(`${brief(entry.name)} does not unpack`);
    }
  } else {
    throw new SpreadsheetError(
      `A part of the file (${brief(entry.name)}) is compressed in a way that cannot be read. Open it in Excel, save it again and upload the new copy.`,
    );
  }
  if (bytes.length !== entry.size)
    throw damaged(`${brief(entry.name)} is not the size it says`);
  if (crc32(bytes) !== entry.crc)
    throw damaged(`${brief(entry.name)} fails its checksum`);
  return bytes;
}

let crcTable: Uint32Array | null = null;

/** The CRC-32 checksum zip uses for each file. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
