import { z } from "zod";
import { DocumentType, documentTypeEnum } from "$lib/enums.js";
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
  // Which account paid for this / received it (FR-011, FR-019).
  accountId: z.number().int().positive().nullable().optional(),
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

  const itemName = overrides.item_name ?? row.itemName ?? "";
  const supplier = overrides.supplier ?? row.supplier ?? "";
  const date = normalizeDate(overrides.date ?? row.date);
  const amount = overrides.amount ?? row.amount ?? 0;
  const reference = overrides.reference ?? row.reference ?? "";
  const category = overrides.category ?? row.category ?? "";
  // A receipt's remark is typed by the reviewer only: reading never fills it.
  // An item's remark starts with its fee type, and its caller passes it here.
  const remark = overrides.remark ?? "";

  // Currency and rate: the reviewer's, then the ones read. For a foreign
  // currency with no rate yet, fetch one for the date.
  const main = mainCurrencyCode(db);
  const currency = (overrides.currency ?? row.currency ?? main).toUpperCase();
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
  const sides =
    overrides.fromAccountId !== undefined && overrides.toAccountId !== undefined
      ? {
          fromAccountId: overrides.fromAccountId,
          toAccountId: overrides.toAccountId,
        }
      : null;

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
      sides,
      contactId: overrides.contactId,
      newContactName: overrides.newContactName,
      matchedContact: row.matchedContactId
        ? { id: row.matchedContactId, documentType: row.documentType }
        : null,
    },
  };
}
