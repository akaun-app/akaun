import { describe, expect, it } from "vitest";
import { LedgerRecordKind } from "$lib/enums.js";
import { AGEING_BANDS, bandFor, groupIntoBands } from "./settlements.js";
import type { AgeingItem } from "./settlements.js";

/**
 * How overdue something is, and what each age group comes to.
 *
 * The read around this is covered by using it; what is pinned here is the
 * arithmetic, because a debt filed under the wrong age group still adds up to
 * the right total and so goes unnoticed (US6 AC1, AC3).
 */

let nextId = 1;

function owed(daysOverdue: number, outstandingMinor: number): AgeingItem {
  const id = nextId++;
  return {
    movementId: id,
    recordId: id,
    recordNumber: `INV-${id}`,
    kind: LedgerRecordKind.InvoiceIssue,
    invoiceId: id,
    date: "2026-01-01",
    dueDate: "2026-01-31",
    description: "Something owed",
    contactId: 7,
    contactName: "A customer",
    amountMinor: outstandingMinor,
    settledMinor: 0,
    outstandingMinor,
    daysOverdue,
    band: bandFor(daysOverdue),
  };
}

describe("which age group a debt falls in", () => {
  it("reads not yet due while nothing is late", () => {
    expect(bandFor(0)).toBe("Not yet due");
  });

  it("moves into the first group on the first late day", () => {
    expect(bandFor(1)).toBe("1–30 days");
  });

  it("keeps each group's far edge in the group it names", () => {
    expect(bandFor(30)).toBe("1–30 days");
    expect(bandFor(31)).toBe("31–60 days");
    expect(bandFor(60)).toBe("31–60 days");
    expect(bandFor(61)).toBe("61–90 days");
    expect(bandFor(90)).toBe("61–90 days");
    expect(bandFor(91)).toBe("Over 90 days");
  });

  it("has nowhere further to put something years late", () => {
    expect(bandFor(3_650)).toBe("Over 90 days");
  });
});

describe("grouping what is outstanding by how overdue", () => {
  it("adds up only what is still outstanding in each group", () => {
    const bands = groupIntoBands([
      owed(0, 10_000),
      owed(5, 2_500),
      owed(20, 7_500),
      owed(120, 100),
    ]);

    expect(bands.map((b) => [b.label, b.count, b.totalMinor])).toEqual([
      ["Not yet due", 1, 10_000],
      ["1–30 days", 2, 10_000],
      ["Over 90 days", 1, 100],
    ]);
  });

  it("leaves out a group nothing falls in", () => {
    const bands = groupIntoBands([owed(200, 500)]);
    expect(bands).toHaveLength(1);
    expect(bands[0].label).toBe("Over 90 days");
  });

  it("shows every group in the order they age", () => {
    const oldestFirst = groupIntoBands([owed(95, 1), owed(0, 1), owed(45, 1)]);
    expect(oldestFirst.map((b) => b.label)).toEqual([
      "Not yet due",
      "31–60 days",
      "Over 90 days",
    ]);
  });

  it("keeps every item, so no debt is lost between the groups", () => {
    const items = [
      owed(0, 1),
      owed(1, 2),
      owed(31, 3),
      owed(61, 4),
      owed(91, 5),
    ];
    const bands = groupIntoBands(items);

    expect(bands).toHaveLength(AGEING_BANDS.length);
    expect(bands.reduce((sum, band) => sum + band.count, 0)).toBe(items.length);
    expect(bands.reduce((sum, band) => sum + band.totalMinor, 0)).toBe(15);
  });
});
