import { AccountRole, AccountType } from "$lib/enums.js";
import type { MovementView } from "$lib/server/ledger/types.js";

// Mirrors src/lib/server/ledger/account-type.ts's isMoneyPotAccount and
// isCategoryAccount — for four of the five types "holds money" and "says what
// the money was for" are the same question as the type; assets are the
// exception, because equipment is an asset the everyday form offers beside the
// categories rather than beside the bank accounts (002 FR-006b).
//
// Hand-duplicated because $lib/server is stripped from client code at build
// time. Every screen that splits a record's sides into a paying side and a
// category side must go through this, or the record form and the list disagree
// about which side of a laptop purchase is the category.
type SideOfRecord = Pick<MovementView, "accountType" | "accountRole">;

export function isEquipmentSide(side: SideOfRecord): boolean {
  return (
    side.accountType === AccountType.Asset &&
    side.accountRole === AccountRole.Equipment
  );
}

/** The side that says what the record was *for*, not where the money sat. */
export function isCategorySide(side: SideOfRecord): boolean {
  return (
    side.accountType === AccountType.Expense ||
    side.accountType === AccountType.Revenue ||
    isEquipmentSide(side)
  );
}
