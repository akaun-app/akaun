import type { AccountTypeCode } from "$lib/enums.js";
import type { Allowed } from "./types.js";

export type HierarchyAccount = {
  id: number;
  type: AccountTypeCode;
  parentId: number | null;
};

export function descendantsOf(rows: HierarchyAccount[], accountId: number): number[] {
  const children = new Map<number, number[]>();
  for (const row of rows) {
    if (row.parentId == null) continue;
    children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);
  }
  const result: number[] = [];
  const seen = new Set<number>([accountId]);
  const visit = (id: number) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      result.push(child);
      visit(child);
    }
  };
  visit(accountId);
  return result;
}

export function validateAccountParent(
  rows: HierarchyAccount[],
  accountId: number,
  parentId: number | null,
): Allowed {
  if (parentId == null) return { ok: true };
  if (parentId === accountId) {
    return { ok: false, reason: "An account cannot be its own parent." };
  }
  const account = rows.find((row) => row.id === accountId);
  const parent = rows.find((row) => row.id === parentId);
  if (!account || !parent) {
    return { ok: false, reason: "That parent account no longer exists." };
  }
  if (account.type !== parent.type) {
    return { ok: false, reason: "A parent and child must have the same account type." };
  }
  if (descendantsOf(rows, accountId).includes(parentId)) {
    return { ok: false, reason: "That move would create a cycle in the account hierarchy." };
  }
  return { ok: true };
}
