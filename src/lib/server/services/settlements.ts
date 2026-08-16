import { recordAudit } from "../audit.js";
import { checkAllocations } from "../ledger/settlement-rules.js";
import type {
  AllocationRequest,
  LedgerDb,
  Refusable,
  SettlementSide,
} from "../ledger/types.js";
import {
  deleteSettlement,
  getSettlement,
  getSide,
  getSides,
  insertSettlements,
  recordIdsForSettlement,
} from "../queries/settlements.js";
import { emitSettlementChanged } from "./ledger.js";

/**
 * Saying that this payment covered those items, and taking it back.
 *
 * A settlement changes no balance — it is a note, and every "paid" figure on
 * every screen is worked out from it (D-09, FR-012). That is why it is audited
 * in its own right (FR-041): settling is the one action that changes what a
 * record reads as without anyone editing the record.
 */

export function createSettlements(
  db: LedgerDb,
  actingUserId: number,
  paymentMovementId: number,
  allocations: AllocationRequest[],
): Refusable<number[]> {
  if (allocations.length === 0) {
    return {
      ok: false,
      reason: "Tick at least one item for this payment to cover.",
    };
  }

  const payment = getSide(db, paymentMovementId);
  if (!payment) {
    return {
      ok: false,
      reason: "That payment no longer exists. Reload and try again.",
    };
  }

  const owedSides = getSides(
    db,
    allocations.map((a) => a.owedMovementId),
  );

  // Both sides of a settlement must be on the same shared owed account, and
  // must belong to the same person — otherwise one contact's payment would be
  // ticking off another contact's debt, and both balances would be wrong.
  for (const allocation of allocations) {
    const owed = owedSides.get(allocation.owedMovementId);
    if (!owed) {
      return {
        ok: false,
        reason:
          "One of the items this payment covers cannot be found — it may have been deleted. Reload and try again.",
      };
    }
    if (owed.accountId !== payment.accountId) {
      return {
        ok: false,
        reason:
          "A payment can only cover items of the same kind — money we owe, or money owed to us, not both.",
      };
    }
    if (owed.contactId !== payment.contactId) {
      return {
        ok: false,
        reason:
          "This payment and that item belong to different people. A payment can only cover what the same person is owed.",
      };
    }
    // One side has to be the money going out and the other the money coming in;
    // two sides facing the same way would add to the debt rather than clear it.
    if (Math.sign(owed.amountMinor) === Math.sign(payment.amountMinor)) {
      return {
        ok: false,
        reason: "That item is not something this payment can pay off.",
      };
    }
  }

  const sidesForCheck = new Map<number, SettlementSide>(
    [...owedSides].map(([id, side]) => [id, side]),
  );
  const check = checkAllocations(
    allocations,
    sidesForCheck,
    payment.amountMinor,
  );
  if (!check.ok) return check;

  const ids = insertSettlements(
    db,
    actingUserId,
    paymentMovementId,
    allocations,
  );

  const touched = new Set<number>();
  for (const [index, allocation] of allocations.entries()) {
    recordAudit(db, {
      recordType: "settlement",
      recordId: ids[index],
      userId: actingUserId,
      action: "create",
    });
    for (const recordId of recordIdsForSettlement(
      db,
      paymentMovementId,
      allocation.owedMovementId,
    )) {
      touched.add(recordId);
    }
  }

  emitSettlementChanged(db, [...touched]);
  return { ok: true, value: ids };
}

/**
 * Undoes one allocation. Both sides return to outstanding, and any field the
 * settlement was locking becomes editable again (FR-017).
 */
export function undoSettlement(
  db: LedgerDb,
  id: number,
  actingUserId: number,
): Refusable<null> {
  const existing = getSettlement(db, id);
  if (!existing) {
    return { ok: false, reason: "That settlement has already been undone." };
  }

  const touched = recordIdsForSettlement(
    db,
    existing.paymentMovementId,
    existing.owedMovementId,
  );

  if (!deleteSettlement(db, id)) {
    return { ok: false, reason: "That settlement has already been undone." };
  }

  recordAudit(db, {
    recordType: "settlement",
    recordId: id,
    userId: actingUserId,
    action: "delete",
  });

  emitSettlementChanged(db, touched);
  return { ok: true, value: null };
}
