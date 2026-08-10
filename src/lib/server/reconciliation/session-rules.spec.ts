// Rules for the session chain: when a new session may be started, which session
// may still be changed, and what a new session's form is pre-filled with.
//
// The load-bearing claim these tests pin down (research.md D-08): the chain is
// ordered by `id` (creation order), NEVER by period dates — periods are allowed
// to overlap, so dates cannot order the chain but creation order always can.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ReconSessionStatus, StatementExtractionState } from "$lib/enums.js";
import type { ReconSessionStatusCode } from "$lib/enums.js";
import type { SessionRow } from "./types.js";
import {
  canMutateSession,
  canStartSession,
  prefillFromLastClosed,
} from "./session-rules.js";

/**
 * A SessionRow with only the fields these rules read spelled out; everything
 * else takes an inert default so each test reads as just its own scenario.
 */
function session(fields: {
  id: number;
  status: ReconSessionStatusCode;
  periodEndDate?: string;
  statementEndingBalance?: number;
}): SessionRow {
  return {
    id: fields.id,
    startingBalance: 0,
    startingDate: "2026-01-01",
    periodEndDate: fields.periodEndDate ?? "2026-01-31",
    statementEndingBalance: fields.statementEndingBalance ?? 0,
    computedBalance: null,
    status: fields.status,
    clearedCount: 0,
    unclearedCount: 0,
    unmatchedLineCount: 0,
    statementState: StatementExtractionState.Idle,
    statementError: null,
    closedAt: null,
    createdBy: null,
    updatedBy: null,
    createdAt: "2026-01-01 00:00:00",
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("canStartSession", () => {
  it("is true when there are no sessions at all", () => {
    expect(canStartSession([])).toBe(true);
  });

  it("is false while a session is Open (FR-010)", () => {
    const sessions = [
      session({ id: 1, status: ReconSessionStatus.ClosedMatched }),
      session({ id: 2, status: ReconSessionStatus.Open }),
    ];

    expect(canStartSession(sessions)).toBe(false);
  });

  it("is false even when the Open session is not the newest by id", () => {
    const sessions = [
      session({ id: 7, status: ReconSessionStatus.Open }),
      session({ id: 8, status: ReconSessionStatus.ClosedWithLeftovers }),
    ];

    expect(canStartSession(sessions)).toBe(false);
  });

  it("is true when every session is closed, matched or with leftovers", () => {
    const sessions = [
      session({ id: 1, status: ReconSessionStatus.ClosedMatched }),
      session({ id: 2, status: ReconSessionStatus.ClosedWithLeftovers }),
    ];

    expect(canStartSession(sessions)).toBe(true);
  });
});

describe("canMutateSession", () => {
  it("is true for the newest session (FR-036)", () => {
    const newest = session({
      id: 12,
      status: ReconSessionStatus.ClosedMatched,
    });

    expect(canMutateSession(newest, 12)).toBe(true);
  });

  it("is false for a session older than the newest", () => {
    const older = session({ id: 11, status: ReconSessionStatus.ClosedMatched });

    expect(canMutateSession(older, 12)).toBe(false);
  });

  it("is false for an older session even while it is still Open", () => {
    const staleOpen = session({ id: 3, status: ReconSessionStatus.Open });

    expect(canMutateSession(staleOpen, 4)).toBe(false);
  });

  it("follows id order, not period dates — the highest-id session is the mutable one", () => {
    // id 9 covers a LATER period than id 10, which was created afterwards to
    // reconcile a back-dated statement. Creation order still decides.
    const laterPeriodOlderId = session({
      id: 9,
      status: ReconSessionStatus.ClosedMatched,
      periodEndDate: "2026-06-30",
    });
    const earlierPeriodNewestId = session({
      id: 10,
      status: ReconSessionStatus.ClosedMatched,
      periodEndDate: "2026-03-31",
    });
    const newestId = 10;

    expect(canMutateSession(laterPeriodOlderId, newestId)).toBe(false);
    expect(canMutateSession(earlierPeriodNewestId, newestId)).toBe(true);
  });
});

describe("prefillFromLastClosed", () => {
  it("takes the ending balance and period end date of the most recently closed session (FR-008)", () => {
    const sessions = [
      session({
        id: 1,
        status: ReconSessionStatus.ClosedMatched,
        periodEndDate: "2026-01-31",
        statementEndingBalance: 1000,
      }),
      session({
        id: 2,
        status: ReconSessionStatus.ClosedWithLeftovers,
        periodEndDate: "2026-02-28",
        statementEndingBalance: 2450.75,
      }),
    ];

    expect(prefillFromLastClosed(sessions)).toEqual({
      startingBalance: 2450.75,
      startingDate: "2026-02-28",
    });
  });

  it("ignores an Open session with a higher id than the newest closed one", () => {
    const sessions = [
      session({
        id: 4,
        status: ReconSessionStatus.ClosedMatched,
        periodEndDate: "2026-04-30",
        statementEndingBalance: 800,
      }),
      session({
        id: 5,
        status: ReconSessionStatus.Open,
        periodEndDate: "2026-05-31",
        statementEndingBalance: 9999,
      }),
    ];

    expect(prefillFromLastClosed(sessions)).toEqual({
      startingBalance: 800,
      startingDate: "2026-04-30",
    });
  });

  it("picks the closed session by highest id, not by latest period end date", () => {
    const sessions = [
      session({
        id: 1,
        status: ReconSessionStatus.ClosedMatched,
        periodEndDate: "2026-09-30",
        statementEndingBalance: 111,
      }),
      session({
        id: 2,
        status: ReconSessionStatus.ClosedMatched,
        periodEndDate: "2026-03-31",
        statementEndingBalance: 222,
      }),
    ];

    expect(prefillFromLastClosed(sessions)).toEqual({
      startingBalance: 222,
      startingDate: "2026-03-31",
    });
  });

  it("falls back to zero and today when there is no session at all", () => {
    expect(prefillFromLastClosed([], "2026-08-10")).toEqual({
      startingBalance: 0,
      startingDate: "2026-08-10",
    });
  });

  it("falls back to zero and today when the only session is still Open", () => {
    const sessions = [
      session({
        id: 1,
        status: ReconSessionStatus.Open,
        periodEndDate: "2026-07-31",
        statementEndingBalance: 500,
      }),
    ];

    expect(prefillFromLastClosed(sessions, "2026-08-10")).toEqual({
      startingBalance: 0,
      startingDate: "2026-08-10",
    });
  });

  it("defaults its fallback date to the current calendar day when none is supplied", () => {
    // Local noon, so the answer is the same calendar day in every timezone.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 10, 12, 0, 0));

    expect(prefillFromLastClosed([])).toEqual({
      startingBalance: 0,
      startingDate: "2026-08-10",
    });
  });
});
