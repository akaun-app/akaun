import { ReconSessionStatus } from "$lib/enums.js";
import { ReconItemType } from "$lib/enums.js";
import type { BankFacingItem, SessionRow } from "./types.js";

export function isBankFacing(
  item: Pick<BankFacingItem, "itemType" | "claimId">,
): boolean {
  return item.itemType !== ReconItemType.Expense || item.claimId == null;
}

export function canStartSession(sessions: SessionRow[]): boolean {
  return sessions.every(
    (session) => session.status !== ReconSessionStatus.Open,
  );
}

export function canMutateSession(
  session: SessionRow,
  newestId: number,
): boolean {
  return session.id === newestId;
}

export function prefillFromLastClosed(
  sessions: SessionRow[],
  today = localCalendarDate(),
): { startingBalance: number; startingDate: string } {
  const lastClosed = sessions.reduce<SessionRow | undefined>(
    (latest, session) => {
      if (session.status === ReconSessionStatus.Open) return latest;
      return latest === undefined || session.id > latest.id ? session : latest;
    },
    undefined,
  );

  if (lastClosed === undefined) {
    return { startingBalance: 0, startingDate: today };
  }

  return {
    startingBalance: lastClosed.statementEndingBalance,
    startingDate: lastClosed.periodEndDate,
  };
}

function localCalendarDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
