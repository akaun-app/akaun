import { z } from "zod";
import { DocumentType, documentTypeEnum, isTransferType } from "$lib/enums.js";
import { mainCurrencyCode } from "../currency/form.js";
import { getExchangeRate } from "../currency/rates.js";
import { normalizeDate } from "../date.js";
import type { LedgerDb } from "../ledger/types.js";
import type { ImportReviewFields } from "../services/import.js";
import type { ReviewFields } from "./review-fields.js";

/**
 * What a reviewer may change on a proposed record before it is confirmed.
 *
 * The receipt card sends these with its confirm, and an item of a group saves
 * them with its own edit request. Both use this one list, so an item can be
 * corrected in every way a receipt can (006 FR-007, FR-020).
 */
export const reviewOverridesSchema = z.object({
  // A label ("expense"/"income") from the review screen, or a code.
  document_type: z.union([z.number().int(), z.string()]).optional(),
  // item_name = the description; supplier = the other party's name — always,
  // whether it is an expense or an income.
  item_name: z.string().optional(),
  supplier: z.string().optional(),
  date: z.string().optional(),
  amount: z.number().finite().optional(),
  currency: z.string().trim().length(3).optional(),
  // Typed by hand as text when no rate could be fetched.
  exchangeRate: z.union([z.number(), z.string()]).optional(),
  reference: z.string().optional(),
  category: z.string().optional(),
  remark: z.string().optional(),
  contactId: z.number().int().positive().optional(),
  newContactName: z.string().optional(),
  // Which account paid for this / received it (FR-011, FR-019). On a
  // transfer: the account the document is about, one of its two sides.
  accountId: z.number().int().positive().nullable().optional(),
  // A transfer's other side (FR-058). Refused on anything else.
  counterAccountId: z.number().int().positive().nullable().optional(),
  fromAccountId: z.number().int().positive().optional(),
  toAccountId: z.number().int().positive().optional(),
});

export type ReviewOverrides = z.infer<typeof reviewOverridesSchema>;

/** Why the fields could not be settled. `rate` means no exchange rate is known. */
export type SettleRefusal = {
  ok: false;
  reason: string;
  kind: "rate" | "rule";
};

/**
 * Why the reviewer's choice of kind cannot be taken, or null. A transfer stays
 * a transfer, and anything else never becomes one (FR-059): a transfer names
 * two accounts that hold money and no category, so turning one into the other
 * would leave a record with a side that means nothing. Only a profile's
 * transfer section reads a transfer.
 *
 * Nor does a transfer turn round: out of the document's account or into it is
 * read off the sign on the document, and the reviewer changes which accounts
 * it names, not which way it went.
 */
export function kindChangeRefusal(
  stored: number | null,
  chosen: number,
): string | null {
  if (isTransferType(stored) && isTransferType(chosen) && stored !== chosen) {
    return "The document says which way this money moved. Change its accounts instead, or skip it if it is not a transfer.";
  }
  if (isTransferType(stored) === isTransferType(chosen)) return null;
  return isTransferType(stored)
    ? "This is a transfer between two of your own accounts. It cannot become an expense or an income; skip it if it is not a transfer."
    : "Only a transfer section of an import profile reads a transfer. Choose expense or income.";
}

/**
 * Turns a transfer's two sides into the document's account and the other
 * account, by the way the money moved: out of the document's account to the
 * other one, or into it from there.
 */
export function transferAccountsOf(
  documentType: number,
  sides: { fromAccountId: number; toAccountId: number },
): { accountId: number; counterAccountId: number } {
  return documentType === DocumentType.TransferIn
    ? { accountId: sides.toAccountId, counterAccountId: sides.fromAccountId }
    : { accountId: sides.fromAccountId, counterAccountId: sides.toAccountId };
}

/**
 * A transfer's two sides from its two accounts: the reverse of
 * `transferAccountsOf`. Null while either account is missing.
 */
export function transferSidesOf(
  documentType: number,
  accountId: number | null,
  counterAccountId: number | null,
): { fromAccountId: number; toAccountId: number } | null {
  if (accountId == null || counterAccountId == null) return null;
  return documentType === DocumentType.TransferIn
    ? { fromAccountId: counterAccountId, toAccountId: accountId }
    : { fromAccountId: accountId, toAccountId: counterAccountId };
}

/** The DocumentType code the reviewer chose, or the one read off the document. */
export function documentTypeOf(
  overrides: Pick<ReviewOverrides, "document_type">,
  stored: number | null,
): number {
  if (typeof overrides.document_type === "number") {
    return overrides.document_type;
  }
  if (typeof overrides.document_type === "string") {
    return (
      documentTypeEnum.fromLabel(overrides.document_type) ??
      stored ??
      DocumentType.Expense
    );
  }
  return stored ?? DocumentType.Expense;
}

/**
 * Works out what the record will say: the reviewer's correction where there is
 * one, and what was read off the document where there is not.
 *
 * A foreign currency with no rate yet gets one looked up for the record's date,
 * which can take a moment, so this is async and runs before the confirm's
 * transaction. When no rate can be found, the reviewer must type one.
 */
export async function settleReviewFields(
  db: LedgerDb,
  row: ReviewFields,
  overrides: ReviewOverrides,
): Promise<{ ok: true; value: ImportReviewFields } | SettleRefusal> {
  const docCode = documentTypeOf(overrides, row.documentType);
  const kindRefusal = kindChangeRefusal(row.documentType, docCode);
  if (kindRefusal) return { ok: false, kind: "rule", reason: kindRefusal };
  const transfer = isTransferType(docCode);
  if (!transfer && overrides.counterAccountId != null) {
    return {
      ok: false,
      kind: "rule",
      reason: "Only a transfer has another account.",
    };
  }

  const itemName = overrides.item_name ?? row.itemName ?? "";
  const supplier = overrides.supplier ?? row.supplier ?? "";
  const date = normalizeDate(overrides.date ?? row.date);
  const amount = overrides.amount ?? row.amount ?? 0;
  const reference = overrides.reference ?? row.reference ?? "";
  const category = overrides.category ?? row.category ?? "";
  // The reviewer's remark, else the one stored with what was read. Reading
  // never stores one now: the remark is the reviewer's to write. Only an item
  // read before that rule still has one, until it is read again.
  const remark = overrides.remark ?? row.remark ?? "";

  // Currency and rate: the reviewer's, then the ones read. For a foreign
  // currency with no rate yet, fetch one for the date.
  const main = mainCurrencyCode(db);
  const currency = (overrides.currency ?? row.currency ?? main).toUpperCase();
  // The books record a transfer at one rate between two of the business's
  // own accounts, so a transfer in another currency is left for the reviewer
  // rather than converted at a guess (FR-059).
  if (transfer && currency !== main) {
    return {
      ok: false,
      kind: "rule",
      reason: transferCurrencyReason(currency, main),
    };
  }
  let exchangeRate: number | null;
  if (currency === main) {
    exchangeRate = 1;
  } else if (overrides.exchangeRate != null) {
    exchangeRate = Number(overrides.exchangeRate);
  } else if (row.exchangeRate != null) {
    exchangeRate = row.exchangeRate;
  } else {
    exchangeRate = (
      await getExchangeRate(db, { from: currency, to: main, date })
    ).rate;
  }
  if (exchangeRate == null || !(exchangeRate > 0)) {
    return {
      ok: false,
      kind: "rate",
      reason: `An exchange rate for ${currency} is required. Enter it manually.`,
    };
  }

  // Both accounts, or neither. The review screen pre-selects them, but a
  // document that reached review before any account existed still has none.
  if (
    (overrides.fromAccountId === undefined) !==
    (overrides.toAccountId === undefined)
  ) {
    return {
      ok: false,
      kind: "rule",
      reason: "Choose both the source and target account before importing.",
    };
  }
  let sides =
    overrides.fromAccountId !== undefined && overrides.toAccountId !== undefined
      ? {
          fromAccountId: overrides.fromAccountId,
          toAccountId: overrides.toAccountId,
        }
      : null;
  // A transfer's sides are its two accounts when the reviewer did not send
  // them, so a transfer always names both (FR-058).
  if (transfer && sides === null) {
    sides = transferSidesOf(
      docCode,
      overrides.accountId ?? row.accountId ?? null,
      overrides.counterAccountId ?? row.counterAccountId ?? null,
    );
    if (sides === null) {
      return {
        ok: false,
        kind: "rule",
        reason: "Choose both accounts of this transfer before importing it.",
      };
    }
  }

  return {
    ok: true,
    value: {
      documentType: docCode,
      description: itemName,
      partyName: supplier,
      // A name the reviewer typed as free text must not lose to an older match.
      partyEdited: overrides.supplier !== undefined,
      date,
      amount,
      currency,
      exchangeRate,
      reference,
      category,
      categoryAccountId: row.categoryAccountId,
      remark,
      accountId: overrides.accountId ?? row.accountId ?? null,
      counterAccountId: transfer
        ? (overrides.counterAccountId ?? row.counterAccountId ?? null)
        : null,
      sides,
      contactId: overrides.contactId,
      newContactName: overrides.newContactName,
      matchedContact: row.matchedContactId
        ? { id: row.matchedContactId, documentType: row.documentType }
        : null,
    },
  };
}

/** Why a transfer in another currency cannot be imported (FR-059). */
export function transferCurrencyReason(currency: string, main: string): string {
  return `A transfer is recorded in ${main} only, and this one is in ${currency}. Record it by hand, or skip it.`;
}
