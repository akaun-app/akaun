import { describe, expect, it } from "vitest";
import { StatementDirection } from "$lib/enums.js";
import {
  StatementLinesSchema,
  normaliseExtractedLines,
} from "./statement-parse.js";

const PERIOD_END = "2026-07-31";

describe("StatementLinesSchema", () => {
  it("rejects a malformed row without discarding valid rows beside it", () => {
    const parsed = StatementLinesSchema.parse({
      lines: [
        { date: "2026-07-02", description: "Salary", amount: 2500 },
        { date: "not a date", description: "Broken", amount: "many" },
        { date: "2026-07-03", description: "Rent", amount: -900 },
      ],
    });

    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines.map((line) => line.description)).toEqual([
      "Salary",
      "Rent",
    ]);
  });
});

describe("normaliseExtractedLines", () => {
  it("ignores a running-balance column and drops summary rows", () => {
    const result = normaliseExtractedLines(
      {
        lines: [
          {
            date: "01/07/2026",
            description: "Card purchase",
            amount: -24.5,
            balance: 975.5,
          },
          {
            date: "31/07/2026",
            description: "Total transactions",
            amount: -24.5,
            balance: 975.5,
          },
          {
            date: "31/07/2026",
            description: "Closing balance",
            amount: 975.5,
          },
        ],
      },
      PERIOD_END,
    );

    expect(result).toEqual([
      {
        date: "2026-07-01",
        description: "Card purchase",
        amount: 24.5,
        direction: StatementDirection.Out,
      },
    ]);
    expect(result[0]).not.toHaveProperty("balance");
  });

  it("normalises negative amounts to positive money-out lines", () => {
    const [line] = normaliseExtractedLines(
      { lines: [{ date: "Jul 4, 2026", description: "ATM", amount: -80 }] },
      PERIOD_END,
    );

    expect(line).toEqual({
      date: "2026-07-04",
      description: "ATM",
      amount: 80,
      direction: StatementDirection.Out,
    });
  });

  it("honours an explicit direction for positive extracted amounts", () => {
    const [line] = normaliseExtractedLines(
      {
        lines: [
          {
            date: "2026-07-05",
            description: "Direct debit",
            amount: 42,
            direction: "out",
          },
        ],
      },
      PERIOD_END,
    );

    expect(line.direction).toBe(StatementDirection.Out);
    expect(line.amount).toBe(42);
  });

  it("keeps rows after periodEnd for the user to review and delete", () => {
    const result = normaliseExtractedLines(
      {
        lines: [{ date: "2026-08-01", description: "Next month", amount: 10 }],
      },
      PERIOD_END,
    );

    expect(result).toEqual([
      {
        date: "2026-08-01",
        description: "Next month",
        amount: 10,
        direction: StatementDirection.In,
      },
    ]);
  });
});
