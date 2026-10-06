import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpError, provider } from "../llm/__fixtures__/mock-model.js";
import {
  fakeReader,
  fakeReportPages,
  fakeRows,
  rowsTotalMinor,
  type FakeReaderOptions,
} from "./__fixtures__/piece-model.js";

/**
 * Reading a long document in pieces (006 S4.6, FR-043, FR-065, US8). No AI
 * provider is called: each provider gets a stand-in model
 * (`MockLanguageModelV4`) that reads the made-up document it is shown.
 */

const mocks = vi.hoisted(() => ({
  models: new Map<string, unknown>(),
}));

vi.mock("$lib/server/llm/model-factory.js", () => ({
  createModel: vi.fn((config: { name: string }) => {
    const model = mocks.models.get(config.name);
    if (!model) throw new Error(`No mock model for ${config.name}`);
    return model;
  }),
}));

vi.mock("$lib/server/llm/rate-limiter.js", () => ({
  throttleLLMCall: vi.fn(async () => {}),
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

import { DocumentType } from "$lib/enums.js";
import {
  DOCUMENT_TEXT_MAX_CHARS,
  ignoredSummary,
} from "$lib/import-reading.js";
import { numberDocumentLines } from "../extraction/document-text.js";
import { SchemaRejectedError } from "../llm/structured-call.js";
import {
  DocumentLimitError,
  type DocumentReadingParams,
} from "./document-reader.js";
import {
  PIECE_CONTEXT_LINES,
  PIECE_MAX_OUTPUT_TOKENS,
  PIECE_MAX_SPLITS,
  PIECE_NOTES,
  ReadingStoppedError,
  readInPieces,
  type PieceProgress,
  type PieceReadLimits,
  type PieceReadOptions,
} from "./piece-reader.js";
import { savedReadingProfile } from "./profile-compiler.js";

/** An Every transaction profile with one by-sign section of rows. */
const profile = savedReadingProfile({
  id: 7,
  name: "Wallet report",
  description: "A made-up wallet report.",
  phrases: [],
  instructions: "PROFILE NOTE: one record per row.",
  mode: "every_transaction",
  statedTotalLabels: { every_transaction: "Net total" },
  sections: [
    {
      key: "rows",
      name: "Transactions",
      description: "Each transaction row.",
      kind: "by_sign",
      fixedCategoryAccountId: 31,
      feeTypes: [],
      extras: null,
    },
  ],
});

/**
 * Small limits, so a document of a few dozen lines is read in several
 * pieces: 10 lines to a piece at first (100 tokens at 10 a line), 3 lines of
 * context either side.
 */
const LIMITS: Partial<PieceReadLimits> = {
  targetOutputTokens: 100,
  maxOutputTokens: 200,
  initialTokensPerLine: 10,
  minTokensPerLine: 10,
  maxPieceLines: 50,
  contextLines: 3,
  headerLines: 5,
  timeoutMs: 1_000,
};

function params(text: string): DocumentReadingParams {
  return {
    text,
    profile,
    expenseAccounts: [{ id: 31, code: 5100, path: "Expenses › Fees" }],
    incomeAccounts: [{ id: 41, code: 4000, path: "Revenue › Sales" }],
    mainCurrency: "MYR",
    today: "2026-09-30",
  };
}

/**
 * A made-up report of `count` rows: 3 header lines (L0001-L0003), the rows
 * from L0004, and a closing line.
 */
function report(count: number, perPage?: number) {
  const rows = fakeRows(count);
  return { rows, text: numberDocumentLines(fakeReportPages(rows, perPage)) };
}

function serve(name: string, options: FakeReaderOptions = {}) {
  const fake = fakeReader(options);
  mocks.models.set(name, fake.model);
  return fake;
}

async function read(
  text: string,
  options: PieceReadOptions = {},
  providers = [provider("main")],
) {
  const progress: PieceProgress[] = [];
  const reading = await readInPieces(params(text), providers, {
    ...options,
    limits: { ...LIMITS, ...options.limits },
    onProgress: (step) => {
      progress.push(step);
      options.onProgress?.(step);
    },
  });
  return { reading, progress };
}

beforeEach(() => mocks.models.clear());

describe("the limits", () => {
  it("sizes each call well inside the time an AI call is allowed", () => {
    expect(PIECE_MAX_OUTPUT_TOKENS).toBe(3_000);
    expect(PIECE_CONTEXT_LINES).toBe(15);
    expect(PIECE_MAX_SPLITS).toBe(3);
  });
});

describe("a document short enough for one call", () => {
  it("is read in one call with the whole schema, and shows no parts", async () => {
    const { rows, text } = report(4);
    const fake = serve("main", {
      header: { stated_total: rowsTotalMinor(rows) / 100 },
    });
    const { reading, progress } = await read(text);

    expect(fake.calls.map((call) => call.kind)).toEqual(["whole"]);
    expect(reading.items).toHaveLength(4);
    // Marked as read by the AI in one call, for the FR-063 reference check.
    expect(reading.notes.method).toBe("ai");
    expect(reading.controlTotal).toEqual({ matches: true, differenceMinor: 0 });
    expect(progress).toEqual([]);
  });

  it("is read in pieces when that one call is cut off", async () => {
    const { rows, text } = report(4);
    const fake = serve("main", { truncateWhole: true });
    const { reading } = await read(text);

    expect(fake.calls.map((call) => call.kind)).toEqual([
      "whole",
      "header",
      "lines",
      "lines",
    ]);
    // Split in half: L0001-L0004 and L0005-L0008.
    expect(fake.calls[2].owned).toEqual([1, 4]);
    expect(fake.calls[3].owned).toEqual([5, 8]);
    expect(reading.items.map((item) => item.reference)).toEqual(
      rows.map((row) => row.reference),
    );
    expect(reading.notes.method).toBe("ai_pieces");
  });
});

describe("a long document", () => {
  it("reads every row once, from owned ranges that cover each line exactly once", async () => {
    const { rows, text } = report(45);
    const fake = serve("main", {
      header: { stated_total: rowsTotalMinor(rows) / 100 },
    });
    const { reading } = await read(text);

    expect(fake.calls[0].kind).toBe("header");
    const pieces = fake.calls.filter((call) => call.kind === "lines");
    expect(pieces).toHaveLength(5);
    // 49 lines: 3 header lines, 45 rows and the closing line.
    let next = 1;
    for (const piece of pieces) {
      expect(piece.owned![0]).toBe(next);
      next = piece.owned![1] + 1;
    }
    expect(next).toBe(50);

    expect(reading.items).toHaveLength(45);
    expect(reading.items.map((item) => item.reference)).toEqual(
      rows.map((row) => row.reference),
    );
    expect(reading.items.map((item) => item.sourceLine)).toEqual(
      rows.map((_, at) => at + 4),
    );
    expect(reading.items.every((item) => item.reviewNote === null)).toBe(true);
    // Income and charges by sign; the header is the document's.
    expect(reading.items[0]).toMatchObject({
      kind: DocumentType.Income,
      date: rows[0].date,
    });
    // Every fifth row is a charge, printed with a minus.
    expect(reading.items[4].kind).toBe(DocumentType.Expense);
    expect(reading).toMatchObject({
      counterparty: "Example Shop",
      currency: "MYR",
      reference: "WR-2026-09",
    });
    expect(reading.controlTotal).toEqual({ matches: true, differenceMinor: 0 });
    expect(reading.notes.method).toBe("ai_pieces");
  });

  it("shows each piece its context either side, and marks its own lines", async () => {
    const { text } = report(45);
    const fake = serve("main");
    await read(text);

    const second = fake.calls.find(
      (call) => call.kind === "lines" && call.owned?.[0] === 11,
    )!;
    expect(second.owned).toEqual([11, 20]);
    expect(second.shown).toEqual(Array.from({ length: 16 }, (_, at) => at + 8));
    expect(second.user).toMatch(
      /^This part's own lines are L0011 to L0020\.\n\n<document>\n--- page 1 ---\nL0008│/,
    );
    expect(second.user).toMatch(
      /L0010│[^\n]*\n--- part starts ---\nL0011│[\s\S]*L0020│[^\n]*\n--- part ends ---\nL0021│/,
    );
    // The piece rules sit with the profile's own, under the same schema.
    expect(second.system).toContain("PROFILE NOTE: one record per row.");
    expect(second.system).toContain("List only lines in that range.");
    expect(second.system).not.toContain('"header"');
  });

  it("reads the header once, from the start of the first page and the end of the last", async () => {
    const { text } = report(45, 20);
    const fake = serve("main");
    await read(text);

    const header = fake.calls[0];
    expect(header.kind).toBe("header");
    // Five lines of the first page, five of the last (page 3: L0044-L0049).
    expect(header.shown).toEqual([1, 2, 3, 4, 5, 45, 46, 47, 48, 49]);
    expect(header.user).toContain("--- lines L0006 to L0044 are not shown ---");
    expect(header.user).toContain("--- page 3 ---");
    expect(header.system).toContain("Net total");
    expect(header.system).not.toContain('"sections"');
  });

  it("says how far it has got before each piece, and when every piece is read", async () => {
    const { text } = report(45);
    serve("main");
    const { progress } = await read(text);

    // Nothing before the header, which is not a part.
    expect(progress).toEqual([
      { done: 0, total: 5 },
      { done: 1, total: 5 },
      { done: 2, total: 5 },
      { done: 3, total: 5 },
      { done: 4, total: 5 },
      { done: 5, total: 5 },
    ]);
  });

  it("sizes the next piece by what the pieces before it wrote", async () => {
    const { text } = report(90);
    // Two tokens a row: the first piece of 10 lines wrote 14 tokens.
    const fake = serve("main", { tokensPerRow: 2 });
    await read(text, { limits: { minTokensPerLine: 1 } });

    const owned = fake.calls
      .filter((call) => call.kind === "lines")
      .map((call) => call.owned![1] - call.owned![0] + 1);
    // 10 lines at the first guess, then as many as the limit allows.
    expect(owned).toEqual([10, 50, 34]);
  });

  it("makes the pieces bigger again after a cut-off once later pieces write less", async () => {
    const { text } = report(200);
    // The first piece is cut off; every piece after it writes 2 tokens a row.
    const fake = serve("main", { tokensPerRow: 2, truncateOn: new Set([2]) });
    const { reading } = await read(text, { limits: { minTokensPerLine: 1 } });

    const owned = fake.calls
      .filter((call) => call.kind === "lines")
      .map((call) => call.owned![1] - call.owned![0] + 1);
    // Cut off at 10 lines, read again as two halves of 5, then smaller
    // pieces for a while, but not for the rest of the document: the cut-off
    // alone would have kept them at 5 lines (200 tokens over 10 lines).
    expect(owned.slice(0, 3)).toEqual([10, 5, 5]);
    expect(owned[3]).toBeLessThan(10);
    expect(Math.max(...owned.slice(3))).toBeGreaterThan(20);
    expect(reading.items).toHaveLength(200);
  });

  it("fails naming the limit when the text is longer than one reading sends", async () => {
    const fake = serve("main");
    const text = `--- page 1 ---\nL0001│${"x".repeat(DOCUMENT_TEXT_MAX_CHARS)}`;
    const failure = read(text);

    await expect(failure).rejects.toBeInstanceOf(DocumentLimitError);
    await expect(failure).rejects.toMatchObject({ limit: "characters" });
    expect(fake.calls).toHaveLength(0);
  });

  it("fails as soon as its own rows are over the item limit, reading no further", async () => {
    // 1,204 lines, 400 to a piece: the third piece takes the count to 1,197.
    const { text } = report(1_200);
    const fake = serve("main", { tokensPerRow: 0 });
    const failure = read(text, {
      limits: {
        minTokensPerLine: 0.1,
        initialTokensPerLine: 0.1,
        maxPieceLines: 400,
      },
    });

    await expect(failure).rejects.toMatchObject({
      limit: "items",
      message:
        "This document has too many items to import: 1,197 were read, and the limit is 1,000.",
    });
    expect(fake.calls.map((call) => call.owned)).toEqual([
      null,
      [1, 400],
      [401, 800],
      [801, 1200],
    ]);
  });
});

describe("merging the pieces (FR-065)", () => {
  it("drops a row read from context when the piece that owns it listed it", async () => {
    const { rows, text } = report(45);
    serve("main", { bleed: true });
    const { reading } = await read(text);

    expect(reading.items.map((item) => item.reference)).toEqual(
      rows.map((row) => row.reference),
    );
    expect(reading.items.every((item) => item.reviewNote === null)).toBe(true);
  });

  it("keeps and flags a row read from context that its own piece missed", async () => {
    const { rows, text } = report(45);
    // L0013 belongs to the second piece, which misses it; the first piece
    // sees it among its context lines and lists it.
    serve("main", { bleed: true, skipOwned: new Set([13]) });
    const { reading } = await read(text);

    expect(reading.items).toHaveLength(45);
    const kept = reading.items.find((item) => item.sourceLine === 13)!;
    expect(kept.reference).toBe(rows[9].reference);
    expect(kept.reviewNote).toBe(PIECE_NOTES.context(13));
    expect(
      reading.items.filter((item) => item.reviewNote !== null),
    ).toHaveLength(1);
  });

  it("keeps and flags an item with no line, or a line its piece was not shown", async () => {
    const { text } = report(45);
    serve("main", {
      // Call 3 is the second piece (L0011-L0020, shown L0008-L0023).
      extraOn: {
        3: [
          {
            description: "Unplaced",
            amount: 1,
            date: null,
            reference: null,
            source_line: null,
          },
          {
            description: "Far away",
            amount: 2,
            date: null,
            reference: null,
            source_line: 40,
          },
          {
            description: "Not a line",
            amount: 3,
            date: null,
            reference: null,
            source_line: 999,
          },
        ],
      },
    });
    const { reading } = await read(text);

    expect(reading.items).toHaveLength(48);
    const note = (description: string) =>
      reading.items.find((item) => item.description === description)
        ?.reviewNote;
    expect(note("Unplaced")).toBe(PIECE_NOTES.noLine);
    expect(note("Far away")).toBe(PIECE_NOTES.outside(40));
    expect(note("Not a line")).toBe(PIECE_NOTES.outside(999));
  });

  it("keeps one flagged copy of a missed row that several pieces saw as context", async () => {
    const { rows, text } = report(10);
    // Pieces of a line or two, with 3 lines of context either side: L0005
    // is among the context of several pieces, and its own piece misses it.
    serve("main", { bleed: true, skipOwned: new Set([5]) });
    const { reading } = await read(text, {
      limits: { targetOutputTokens: 20 },
    });

    expect(reading.items.map((item) => item.reference)).toEqual(
      rows.map((row) => row.reference),
    );
    const copies = reading.items.filter((item) => item.sourceLine === 5);
    expect(copies).toHaveLength(1);
    expect(copies[0].reviewNote).toBe(PIECE_NOTES.context(5));
  });

  it("counts every line the pieces left out, not only the twenty it lists", async () => {
    const { text } = report(45);
    // 25 rows, from L0004 to L0028, are listed as ignored by their pieces,
    // and the second piece lists one more line with an amount of zero.
    serve("main", {
      ignoreOwned: new Set(Array.from({ length: 25 }, (_, at) => at + 4)),
      extraOn: {
        3: [
          {
            description: "Balance brought forward",
            amount: 0,
            date: null,
            reference: null,
            source_line: 12,
          },
        ],
      },
    });
    const { reading } = await read(text);

    expect(reading.items).toHaveLength(20);
    expect(reading.notes.ignored).toHaveLength(20);
    expect(reading.notes.ignoredCount).toBe(26);
    expect(ignoredSummary(reading.notes)).toBe("Ignored 26 lines (20 shown)");
  });

  it("keeps two identical rows on different lines, even across a boundary", async () => {
    const twin = {
      date: "2026-09-05",
      reference: "TX-SAME",
      description: "Ad fee",
      amount: "-1.00",
    };
    // The twins are L0010, the first piece's last line, and L0011, the
    // second's first; each piece sees the other's among its context.
    const rows = [...fakeRows(6), twin, twin, ...fakeRows(10, 7)];
    const text = numberDocumentLines(fakeReportPages(rows));
    serve("main", { bleed: true });
    const { reading } = await read(text);

    expect(reading.items).toHaveLength(18);
    expect(
      reading.items
        .filter((item) => item.reference === "TX-SAME")
        .map((item) => item.sourceLine),
    ).toEqual([10, 11]);
    expect(
      reading.items.filter((item) => item.reference === "TX-SAME"),
    ).toHaveLength(2);
  });
});

describe("a piece cut off or out of time", () => {
  it("is split in half and read again", async () => {
    const { rows, text } = report(45);
    // A piece of 10 lines has 7 rows or more; 6 is the most one answer holds.
    const fake = serve("main", { truncateAbove: 6 });
    const { reading } = await read(text);

    const pieces = fake.calls.filter((call) => call.kind === "lines");
    expect(pieces[0].owned).toEqual([1, 10]);
    expect(pieces[1].owned).toEqual([1, 5]);
    expect(pieces[2].owned).toEqual([6, 10]);
    expect(reading.items.map((item) => item.reference)).toEqual(
      rows.map((row) => row.reference),
    );
  });

  it("fails naming the lines once it has been split as often as allowed", async () => {
    const { text } = report(45);
    const fake = serve("main", { truncateAbove: 0 });
    const failure = read(text);

    await expect(failure).rejects.toBeInstanceOf(DocumentLimitError);
    await expect(failure).rejects.toMatchObject({
      limit: "output",
      message:
        "Line L0004 could not be read: the AI model's answer reached its output length limit of 200 tokens, even 1 line at a time.",
    });
    // L0001-L0010, then L0001-L0005, L0001-L0003 (no rows), L0004-L0005,
    // and L0004 on its own, three splits down.
    expect(
      fake.calls.filter((call) => call.kind === "lines").map((c) => c.owned),
    ).toEqual([
      [1, 10],
      [1, 5],
      [1, 3],
      [4, 5],
      [4, 4],
    ]);
  });

  it("splits a piece that runs out of time, and fails naming the limit when splitting does not help", async () => {
    const { rows, text } = report(45);
    serve("main", { hangAbove: 6 });
    const { reading } = await read(text, { limits: { timeoutMs: 30 } });
    expect(reading.items).toHaveLength(rows.length);

    serve("main", { hangAbove: 0 });
    await expect(
      read(text, { limits: { timeoutMs: 30 } }),
    ).rejects.toMatchObject({
      limit: "time",
      message:
        "Line L0004 could not be read: reading it took longer than the limit of 0.03 seconds for one reading, even 1 line at a time.",
    });
  });
});

describe("failover per piece (C12)", () => {
  it("reads only the failed piece on the next provider, keeping the pieces already read", async () => {
    const { rows, text } = report(45);
    // Call 4 is the third piece (L0021-L0030).
    const main = serve("main", { failOn: { 4: httpError(401, "Bad key") } });
    const backup = serve("backup");
    const { reading } = await read(text, {}, [
      provider("main"),
      provider("backup"),
    ]);

    expect(main.calls.map((call) => call.owned)).toEqual([
      null,
      [1, 10],
      [11, 20],
      [21, 30],
    ]);
    // The backup reads that piece and, having answered, the rest.
    expect(backup.calls.map((call) => call.owned)).toEqual([
      [21, 30],
      [31, 40],
      [41, 49],
    ]);
    expect(reading.items.map((item) => item.reference)).toEqual(
      rows.map((row) => row.reference),
    );
  });

  it("reads the header on the next provider when the first runs out of time on it", async () => {
    const { rows, text } = report(45);
    const main = serve("main", { hangOn: new Set([1]) });
    const backup = serve("backup", {
      header: { stated_total: rowsTotalMinor(rows) / 100 },
    });
    const { reading } = await read(text, { limits: { timeoutMs: 30 } }, [
      provider("main"),
      provider("backup"),
    ]);

    expect(main.calls.map((call) => call.kind)).toEqual(["header"]);
    expect(backup.calls.map((call) => call.kind)).toEqual([
      "header",
      "lines",
      "lines",
      "lines",
      "lines",
      "lines",
    ]);
    expect(reading.items).toHaveLength(45);
    expect(reading.controlTotal).toEqual({ matches: true, differenceMinor: 0 });
  });

  it("reads the header on the next provider when the first is cut off on it", async () => {
    const { text } = report(45);
    const main = serve("main", { truncateOn: new Set([1]) });
    const backup = serve("backup");
    const { reading } = await read(text, {}, [
      provider("main"),
      provider("backup"),
    ]);

    expect(main.calls.map((call) => call.kind)).toEqual(["header"]);
    expect(backup.calls[0].kind).toBe("header");
    expect(reading.items).toHaveLength(45);
  });

  it("fails naming the limit when every provider runs out of time on the header", async () => {
    const { text } = report(45);
    serve("main", { hangOn: new Set([1]) });
    const backup = serve("backup", { hangOn: new Set([1]) });
    await expect(
      read(text, { limits: { timeoutMs: 30 } }, [
        provider("main"),
        provider("backup"),
      ]),
    ).rejects.toMatchObject({
      limit: "time",
      message:
        "This document's header could not be read: reading it took longer than the limit of 0.03 seconds for one reading.",
    });
    expect(backup.calls).toHaveLength(1);
  });

  it("reads a piece on the next provider, whole, when the first runs out of time on it", async () => {
    const { rows, text } = report(45);
    // Call 3 is the second piece (L0011-L0020).
    const main = serve("main", { hangOn: new Set([3]) });
    const backup = serve("backup");
    const { reading } = await read(text, { limits: { timeoutMs: 30 } }, [
      provider("main"),
      provider("backup"),
    ]);

    expect(main.calls.map((call) => call.owned)).toEqual([
      null,
      [1, 10],
      [11, 20],
    ]);
    expect(backup.calls.map((call) => call.owned)).toEqual([
      [11, 20],
      [21, 30],
      [31, 40],
      [41, 49],
    ]);
    expect(reading.items.map((item) => item.reference)).toEqual(
      rows.map((row) => row.reference),
    );
  });

  it("splits a piece only when every provider runs out of time on it", async () => {
    const { rows, text } = report(45);
    const main = serve("main", { hangOn: new Set([3]) });
    const backup = serve("backup", { hangOn: new Set([1]) });
    const { reading } = await read(text, { limits: { timeoutMs: 30 } }, [
      provider("main"),
      provider("backup"),
    ]);

    expect(backup.calls.map((call) => call.owned)).toEqual([[11, 20]]);
    expect(main.calls.slice(0, 5).map((call) => call.owned)).toEqual([
      null,
      [1, 10],
      [11, 20],
      [11, 15],
      [16, 20],
    ]);
    expect(reading.items.map((item) => item.reference)).toEqual(
      rows.map((row) => row.reference),
    );
  });

  it("splits a piece cut off at once, rather than read it in full on the next provider", async () => {
    const { rows, text } = report(45);
    const main = serve("main", { truncateOn: new Set([3]) });
    const backup = serve("backup");
    const { reading } = await read(text, {}, [
      provider("main"),
      provider("backup"),
    ]);

    expect(backup.calls).toEqual([]);
    expect(main.calls.slice(2, 5).map((call) => call.owned)).toEqual([
      [11, 20],
      [11, 15],
      [16, 20],
    ]);
    expect(reading.items.map((item) => item.reference)).toEqual(
      rows.map((row) => row.reference),
    );
  });

  it("fails the whole document, naming the lines, when every provider fails a piece", async () => {
    const { text } = report(45);
    serve("main", { failOn: { 3: httpError(401, "Bad key") } });
    serve("backup", { failOn: { 1: httpError(401, "Also a bad key") } });
    await expect(
      read(text, {}, [provider("main"), provider("backup")]),
    ).rejects.toThrow(
      "Reading lines L0011 to L0020 failed with every AI provider: Also a bad key",
    );
  });

  it("fails with the refusal of the profile's schema when a provider refused it", async () => {
    const { text } = report(45);
    serve("main", { failOn: { 1: httpError(400, "Schema too big") } });
    serve("backup", { failOn: { 1: httpError(401, "Bad key") } });
    const failure = read(text, {}, [provider("main"), provider("backup")]);
    await expect(failure).rejects.toBeInstanceOf(SchemaRejectedError);
    await expect(failure).rejects.toMatchObject({
      providerMessage: "Schema too big",
    });
  });
});

describe("a reading no longer wanted", () => {
  it("stops before the next piece and makes no more calls", async () => {
    const { text } = report(45);
    const fake = serve("main");
    let asked = 0;
    // Wanted for the header and the first two pieces, then not.
    const failure = read(text, { stillWanted: () => ++asked <= 3 });

    await expect(failure).rejects.toBeInstanceOf(ReadingStoppedError);
    expect(fake.calls.map((call) => call.kind)).toEqual([
      "header",
      "lines",
      "lines",
    ]);
  });
});
