import { describe, expect, it } from "vitest";
import {
  controlTotal,
  ignoredSummary,
  IGNORED_LINE_MAX_CHARS,
  IGNORED_LINES_MAX,
  parseExtractionNotes,
  serializeExtractionNotes,
  type ExtractionNotes,
} from "./import-reading.js";

describe("extraction notes", () => {
  // The ads invoice: two expense lines, so both figures are money out.
  const notes: ExtractionNotes = {
    statedTotal: { minor: -181287, currency: "MYR" },
    itemsTotalMinor: -73287 - 108000,
    ignored: ["Subtotal 1,230.00", "Amount due 1,812.87"],
  };

  it("reads back what it stored", () => {
    expect(parseExtractionNotes(serializeExtractionNotes(notes))).toEqual(
      notes,
    );
  });

  it("keeps how the items were read and how many lines were left out, when it is said", () => {
    const columns: ExtractionNotes = {
      ...notes,
      ignoredCount: 726,
      method: "columns",
    };
    expect(parseExtractionNotes(serializeExtractionNotes(columns))).toEqual(
      columns,
    );
    // An AI reading says neither, and stores exactly what it stored before.
    expect(JSON.parse(serializeExtractionNotes(notes))).toEqual(notes);
    // A damaged count or method is dropped; the control total still shows.
    expect(
      parseExtractionNotes(
        JSON.stringify({ ...notes, ignoredCount: -1, method: "guess" }),
      ),
    ).toEqual(notes);
  });

  it("keeps no more than the capped number and length of ignored lines", () => {
    const long = "x".repeat(IGNORED_LINE_MAX_CHARS + 50);
    const many = Array.from({ length: IGNORED_LINES_MAX + 5 }, (_, i) =>
      i === 0 ? long : `Line ${i}`,
    );
    const stored = parseExtractionNotes(
      serializeExtractionNotes({ ...notes, ignored: many }),
    );
    expect(stored?.ignored).toHaveLength(IGNORED_LINES_MAX);
    expect(stored?.ignored[0]).toHaveLength(IGNORED_LINE_MAX_CHARS);
    expect(stored?.ignored[0].endsWith("…")).toBe(true);
  });

  it("drops empty and non-text ignored lines", () => {
    const stored = parseExtractionNotes(
      JSON.stringify({ ...notes, ignored: ["  ", 4, null, " Tax  total "] }),
    );
    expect(stored?.ignored).toEqual(["Tax total"]);
  });

  it("gives null for a damaged value, so no wrong control total shows", () => {
    expect(parseExtractionNotes(null)).toBeNull();
    expect(parseExtractionNotes("not json")).toBeNull();
    expect(parseExtractionNotes("[]")).toBeNull();
    // A decimal is not a number of cents.
    expect(
      parseExtractionNotes(JSON.stringify({ ...notes, itemsTotalMinor: 1.5 })),
    ).toBeNull();
    expect(
      parseExtractionNotes(
        JSON.stringify({ ...notes, statedTotal: { minor: "10" } }),
      ),
    ).toBeNull();
  });
});

describe("controlTotal", () => {
  it("matches only to the cent", () => {
    const stated = { minor: 1373256, currency: "MYR" };
    expect(
      controlTotal({
        statedTotal: stated,
        itemsTotalMinor: 1373256,
        ignored: [],
      }),
    ).toEqual({ matches: true, differenceMinor: 0 });
    expect(
      controlTotal({
        statedTotal: stated,
        itemsTotalMinor: 1373255,
        ignored: [],
      }),
    ).toEqual({ matches: false, differenceMinor: -1 });
  });

  it("matches an expense-only document, whose stated total is money out", () => {
    // The ads invoice: 732.87 and 1,080.00 of charges, "Total charges 1,812.87".
    expect(
      controlTotal({
        statedTotal: { minor: -181287, currency: "MYR" },
        itemsTotalMinor: -73287 + -108000,
        ignored: [],
      }),
    ).toEqual({ matches: true, differenceMinor: 0 });
  });

  it("shows a missed expense line as the exact difference", () => {
    // The 1,080.00 line was not read, so the items are 1,080.00 short of the
    // charges the document states.
    expect(
      controlTotal({
        statedTotal: { minor: -181287, currency: "MYR" },
        itemsTotalMinor: -73287,
        ignored: [],
      }),
    ).toEqual({ matches: false, differenceMinor: 108000 });
  });

  it("matches a Summary of sales less fees against the payout released", () => {
    // Income counts as plus and fees as minus; the payout is money in.
    const sales = 1650000;
    const fees = [-160000, -98744, -18000];
    expect(
      controlTotal({
        statedTotal: { minor: 1373256, currency: "MYR" },
        itemsTotalMinor: sales + fees.reduce((sum, fee) => sum + fee, 0),
        ignored: [],
      }),
    ).toEqual({ matches: true, differenceMinor: 0 });
  });

  it("is absent when the document states no total", () => {
    expect(
      controlTotal({ statedTotal: null, itemsTotalMinor: 500, ignored: [] }),
    ).toBeNull();
  });
});

describe("ignoredSummary", () => {
  it("says how many lines were left out, and how many are shown (FR-056)", () => {
    const sample = Array.from({ length: 20 }, (_, i) => `Row ${i}`);
    expect(ignoredSummary({ ignored: sample, ignoredCount: 726 })).toBe(
      "Ignored 726 lines (20 shown)",
    );
    expect(ignoredSummary({ ignored: ["Subtotal 1.00"] })).toBe(
      "Ignored 1 line",
    );
    expect(ignoredSummary({ ignored: ["a", "b"], ignoredCount: 2 })).toBe(
      "Ignored 2 lines",
    );
    expect(ignoredSummary({ ignored: [], ignoredCount: 0 })).toBeNull();
    expect(ignoredSummary({ ignored: [] })).toBeNull();
    expect(ignoredSummary({ ignored: [], ignoredCount: 1234 })).toBe(
      "Ignored 1,234 lines (0 shown)",
    );
  });
});
