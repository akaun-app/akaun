import { describe, expect, it } from "vitest";
import { StatementDirection } from "$lib/enums.js";
import { findDuplicateLines, rankCandidates } from "./matching.js";
import type { MovementCandidate, StatementLineRow } from "./types.js";

/** Every statement in these tests belongs to this account. */
const STATEMENT_ACCOUNT = 7;

function line(overrides: Partial<StatementLineRow> = {}): StatementLineRow {
  return {
    id: 1,
    statementId: 10,
    date: "2026-07-15",
    description: "Grab ride",
    amount: 100,
    direction: StatementDirection.Out,
    note: "",
    createdAt: "2026-07-15T00:00:00Z",
    ...overrides,
  };
}

/**
 * A movement on the statement's account, money out by default — the sign is
 * the whole direction rule now, so every fixture states it in cents.
 */
function movement(
  overrides: Partial<MovementCandidate> & { movementId: number },
): MovementCandidate {
  return {
    recordId: overrides.movementId,
    accountId: STATEMENT_ACCOUNT,
    amountMinor: -10_000,
    amount: 100,
    label: `record-${overrides.movementId}`,
    date: "2026-07-15",
    description: "",
    contactName: null,
    ...overrides,
  };
}

describe("rankCandidates", () => {
  it("never offers a movement on another account", () => {
    const ranked = rankCandidates(line(), STATEMENT_ACCOUNT, [
      movement({ movementId: 1, accountId: STATEMENT_ACCOUNT + 1 }),
      movement({ movementId: 2 }),
    ]);

    expect(ranked.map((candidate) => candidate.movementId)).toEqual([2]);
  });

  it("uses the movement's sign as the direction filter", () => {
    const moneyIn = rankCandidates(
      line({ direction: StatementDirection.In }),
      STATEMENT_ACCOUNT,
      [
        movement({ movementId: 1, amountMinor: 10_000 }),
        movement({ movementId: 2, amountMinor: -10_000 }),
      ],
    );
    const moneyOut = rankCandidates(line(), STATEMENT_ACCOUNT, [
      movement({ movementId: 1, amountMinor: 10_000 }),
      movement({ movementId: 2, amountMinor: -10_000 }),
    ]);

    expect(moneyIn.map((candidate) => candidate.movementId)).toEqual([1]);
    expect(moneyOut.map((candidate) => candidate.movementId)).toEqual([2]);
  });

  it("scores exact amounts at 100 and amounts within one percent at 55", () => {
    const ranked = rankCandidates(
      line({ description: "unrelated" }),
      STATEMENT_ACCOUNT,
      [
        movement({ movementId: 1, label: "exact" }),
        movement({ movementId: 2, label: "near", amountMinor: -10_099 }),
        movement({ movementId: 3, label: "outside", amountMinor: -10_101 }),
      ],
    );

    expect(
      ranked.map(({ movementId, score }) => ({ movementId, score })),
    ).toEqual([
      { movementId: 1, score: 100 },
      { movementId: 2, score: 55 },
    ]);
  });

  it("subtracts two points per day and excludes candidates outside seven days", () => {
    const ranked = rankCandidates(
      line({ description: "unrelated" }),
      STATEMENT_ACCOUNT,
      [
        movement({ movementId: 1, label: "six days ago", date: "2026-07-09" }),
        movement({ movementId: 2, label: "same day" }),
        movement({
          movementId: 3,
          label: "eight days ago",
          date: "2026-07-07",
        }),
      ],
    );

    expect(
      ranked.map(({ movementId, score }) => ({ movementId, score })),
    ).toEqual([
      { movementId: 2, score: 100 },
      { movementId: 1, score: 88 },
    ]);
  });

  it("adds eight points when a normalised description token breaks a tie", () => {
    const ranked = rankCandidates(
      line({ description: "PAYMENT, ACME STORE" }),
      STATEMENT_ACCOUNT,
      [
        movement({ movementId: 1, label: "Other merchant" }),
        movement({ movementId: 2, label: "Invoice", contactName: "Acme" }),
      ],
    );

    expect(
      ranked.map(({ movementId, score }) => ({ movementId, score })),
    ).toEqual([
      { movementId: 2, score: 108 },
      { movementId: 1, score: 100 },
    ]);
  });

  it("compares amounts as whole cents, so no float tolerance is involved", () => {
    // 0.1 + 0.2 is 0.30000000000000004 as a float; both sides are cents here,
    // so a line for 0.30 matches a movement of 30 cents exactly.
    const ranked = rankCandidates(
      line({ amount: 0.1 + 0.2, description: "unrelated" }),
      STATEMENT_ACCOUNT,
      [movement({ movementId: 1, amountMinor: -30 })],
    );

    expect(
      ranked.map(({ movementId, score }) => ({ movementId, score })),
    ).toEqual([{ movementId: 1, score: 100 }]);
  });
});

describe("findDuplicateLines", () => {
  it("flags every line sharing statement, date, cent-equal amount, and normalised description", () => {
    const duplicates = findDuplicateLines([
      line({ id: 11, description: "  Grab   RIDE ", amount: 25 }),
      line({ id: 12, description: "grab ride", amount: 25.004 }),
      line({ id: 13, statementId: 11, description: "grab ride", amount: 25 }),
      line({ id: 14, description: "grab food", amount: 25 }),
      line({ id: 15, description: "grab ride", amount: 25.01 }),
      line({
        id: 16,
        date: "2026-07-16",
        description: "grab ride",
        amount: 25,
      }),
    ]);

    expect(duplicates).toEqual(new Set([11, 12]));
  });
});
