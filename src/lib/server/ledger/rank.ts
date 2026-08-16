import { LexoRank } from "lexorank";

/**
 * Lexorank ordering for the chart of accounts, carried over from `categories.rank`.
 *
 * A rank is a string that sorts between its neighbours, so reordering an account
 * rewrites one row rather than renumbering the list. Pure string work — no
 * database, so the accounts service and the upgrade's seeding share it.
 */

/** `count` ranks in ascending order, for seeding a list from nothing. */
export function generateRanks(count: number): string[] {
  if (count === 0) return [];
  const ranks: string[] = [LexoRank.middle().toString()];
  for (let i = 1; i < count; i++) {
    ranks.push(LexoRank.parse(ranks[i - 1]).genNext().toString());
  }
  return ranks;
}

/** The rank that sorts after `last`, or the first rank when there is no `last`. */
export function rankAfter(last: string | null | undefined): string {
  return last
    ? LexoRank.parse(last).genNext().toString()
    : LexoRank.middle().toString();
}
