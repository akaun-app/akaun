import { LedgerRecordKind, type LedgerRecordKindCode } from "$lib/enums.js";
import type { ActionName, ResourceName } from "../permissions.js";
import type { RecordCreate } from "./types.js";

/**
 * Which resource a record of a given kind is checked against: `records`, for
 * every kind.
 *
 * What this used to say, and why it stopped being true: the permission followed
 * the kind rather than the table, so income was checked against `income`, a
 * journal entry against `journal`, and transfers, payments and opening balances
 * against `expenses` — "because that is the screen they are recorded from".
 * That screen is gone. There is one list of everything that happened, so there
 * is one ability to see and write it (FR-028).
 *
 * Both functions are kept, and every call site keeps calling them. The answer
 * is now the same for every kind, but the call sites are where a future kind
 * would need a different one, and deleting them would scatter the string
 * "records" across every route instead.
 *
 * Free choice of account and a third side are a separate question, answered by
 * the `adjustments` ability at the point of derivation — not here, because
 * whether a record needs that ability is a fact about the accounts it names,
 * not about its kind (FR-031c).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter is kept so every call site stays unchanged; see the note above.
export function resourceForKind(_kind: LedgerRecordKindCode): ResourceName {
  return "records";
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
