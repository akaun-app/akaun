import { LedgerRecordKind, type LedgerRecordKindCode } from "$lib/enums.js";
import type { ActionName, ResourceName } from "../permissions.js";
import type { RecordCreate } from "./types.js";

/**
 * Which resource a record of a given kind is checked against.
 *
 * There is one store, but the existing screens keep their existing access
 * rules, so the permission follows the kind rather than the table. Transfers,
 * payments and opening balances are checked against `expenses` because that is
 * the screen they are recorded from — money going out. A journal entry has its
 * own resource, granted to no seeded group (FR-040).
 */
export function resourceForKind(kind: LedgerRecordKindCode): ResourceName {
  switch (kind) {
    case LedgerRecordKind.Income:
      return "income";
    case LedgerRecordKind.Journal:
      return "journal";
    default:
      return "expenses";
  }
}

const KIND_BY_NAME: Record<RecordCreate["kind"], LedgerRecordKindCode> = {
  expense: LedgerRecordKind.Expense,
  income: LedgerRecordKind.Income,
  transfer: LedgerRecordKind.Transfer,
  payment: LedgerRecordKind.Payment,
  "opening-balance": LedgerRecordKind.OpeningBalance,
  "invoice-issue": LedgerRecordKind.InvoiceIssue,
  journal: LedgerRecordKind.Journal,
};

export function resourceForKindName(kind: RecordCreate["kind"]): ResourceName {
  return resourceForKind(KIND_BY_NAME[kind]);
}

/**
 * An issued invoice's record is created only by the invoice endpoints, so the
 * records API never accepts one and never lets one be edited through it.
 */
export function isReadOnlyKind(kind: LedgerRecordKindCode): boolean {
  return kind === LedgerRecordKind.InvoiceIssue;
}

export type RecordAction = Extract<ActionName, "view" | "add" | "change" | "delete">;
