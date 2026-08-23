import type { Allowed, LockResult, LockState } from "./types.js";

/**
 * What a record stops allowing once money has moved against it.
 *
 * Once a payment has settled a record, or a bank line has been matched to it,
 * its amount, its date and the accounts it touches are fixed — changing any of
 * them would silently make a settlement or a bank match wrong. What the record
 * *says* stays editable, because correcting a description or attaching a
 * missing receipt cannot make any other record wrong (FR-017a).
 *
 * The refusal always names what to undo, so a locked field is never a dead end.
 */

/**
 * Fixed while the record is settled or reconciled.
 *
 * `categoryAccountId` is deliberately not here: a settlement or a bank match
 * always points at the money side (a receivable/payable or a money-pot
 * movement), never at a category account, so correcting what an already-paid
 * or already-matched record was *for* cannot make either wrong.
 */
export const LOCKED_FIELDS = [
  "amount",
  "currency",
  "exchangeRate",
  "date",
  "paidFromAccountId",
  "receivedIntoAccountId",
  "fromAccountId",
  "toAccountId",
  "accountId",
  "incomeAccountId",
] as const;

/** Editable whatever has happened to the record. */
export const ALWAYS_EDITABLE_FIELDS = [
  "description",
  "contactId",
  "reference",
  "remark",
  "attachments",
] as const;

const LOCKED = new Set<string>(LOCKED_FIELDS);

const SETTLED_REASON =
  "A payment has settled this record. Undo the settlement before changing its amount, date or the account it moved through.";
const RECONCILED_REASON =
  "This record is matched to a bank line. Unmatch it first before changing its amount, date or the account it moved through.";
const BOTH_REASON =
  "A payment has settled this record and it is matched to a bank line. Undo the settlement and unmatch the bank line before changing its amount, date or the account it moved through.";

function reasonFor(state: LockState): string | null {
  if (state.settled && state.reconciled) return BOTH_REASON;
  if (state.settled) return SETTLED_REASON;
  if (state.reconciled) return RECONCILED_REASON;
  return null;
}

export function lockStateOf(state: LockState): LockResult {
  const locked = state.settled || state.reconciled;
  return {
    locked,
    lockedFields: locked ? LOCKED_FIELDS : [],
    reason: reasonFor(state),
  };
}

export function canEditField(field: string, state: LockState): boolean {
  if (!state.settled && !state.reconciled) return true;
  return !LOCKED.has(field);
}

/**
 * Deleting is refused outright while locked — there is no partial version of
 * removing a record a settlement or a bank match still points at.
 */
export function canDeleteRecord(state: LockState): Allowed {
  if (!state.settled && !state.reconciled) return { ok: true };
  if (state.settled && state.reconciled) {
    return {
      ok: false,
      reason:
        "A payment has settled this record and it is matched to a bank line. Undo the settlement and unmatch the bank line before deleting it.",
    };
  }
  if (state.settled) {
    return {
      ok: false,
      reason:
        "A payment has settled this record. Undo the settlement before deleting it.",
    };
  }
  return {
    ok: false,
    reason:
      "This record is matched to a bank line. Unmatch it first before deleting it.",
  };
}
