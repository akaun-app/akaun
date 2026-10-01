/**
 * Turns what was read off a document into the fields a reviewer checks: the
 * contact match, the exchange rate, the accounts the record starts on, the
 * category, and the duplicate warning.
 *
 * A receipt goes through this once, and each item of a document with several
 * items goes through it once per item, so a receipt card and an item show the
 * same kind of proposal worked out the same way (006 FR-007, FR-024).
 */

import { DefaultAccountPurpose, DocumentType, Role } from "$lib/enums.js";
import { getExchangeRate } from "../currency/rates.js";
import { mainCurrencyCode } from "../currency/form.js";
import type { LedgerDb } from "../ledger/types.js";
import { resolveContactCandidates } from "../queries/contacts.js";
import { requireAccountDefault } from "../services/account-defaults.js";
import {
  categoryAccountForImport,
  categoryChoices,
  type CategoryChoice,
} from "./category-accounts.js";
import { detectDuplicate } from "./duplicate-detector.js";
import type { ReviewFields } from "./review-fields.js";

/** What was read off the document for one record. */
export interface ReadFields {
  /** A DocumentType code: expense or income. */
  documentType: number;
  itemName: string;
  /** The other party's name, whether it was paid or it paid. */
  supplier: string;
  amount: number;
  /** `YYYY-MM-DD`. */
  date: string;
  reference: string;
  currency: string;
  /** The reader's pick of category; it is checked against the user's list. */
  categoryAccountId: number | null;
  remark: string | null;
  /**
   * What the duplicate check may use besides the fields above. A receipt gives
   * all three. An item gives none: its document's file name and wording are
   * shared by every item, and by last month's document too, so they are no
   * evidence that one item was booked before (FR-025).
   */
  duplicateEvidence: {
    originalFilename: string | null;
    fileHash: string | null;
    extractedText: string | null;
  };
}

type ContactMatch = ReturnType<typeof resolveContactCandidates>;

/**
 * What stays the same for every record read from one document. Look-ups that
 * give the same answer for every item (an exchange rate for one date, a
 * contact for one name) are kept here, so a document of a hundred items on one
 * date asks for its rate once.
 */
export interface ReviewContext {
  mainCurrency: string;
  expenseChoices: CategoryChoice[];
  incomeChoices: CategoryChoice[];
  rates: Map<string, Promise<number | null>>;
  contacts: Map<string, ContactMatch>;
}

export function createReviewContext(db: LedgerDb): ReviewContext {
  return {
    mainCurrency: mainCurrencyCode(db),
    // The AI picks from the chart of accounts, so what it answers can be
    // matched straight back to an account on confirm (FR-006a).
    expenseChoices: categoryChoices(db, "expense"),
    incomeChoices: categoryChoices(db, "income"),
    rates: new Map(),
    contacts: new Map(),
  };
}

function rateFor(
  db: LedgerDb,
  ctx: ReviewContext,
  currency: string,
  date: string,
): Promise<number | null> {
  if (currency === ctx.mainCurrency) return Promise.resolve(1);
  const key = `${currency}|${date}`;
  let rate = ctx.rates.get(key);
  if (!rate) {
    rate = getExchangeRate(db, {
      from: currency,
      to: ctx.mainCurrency,
      date,
    }).then((result) => result.rate);
    ctx.rates.set(key, rate);
  }
  return rate;
}

function contactFor(
  db: LedgerDb,
  ctx: ReviewContext,
  name: string,
  role: number,
): ContactMatch {
  const key = `${role}|${name}`;
  let match = ctx.contacts.get(key);
  if (!match) {
    match = resolveContactCandidates(db, name, role);
    ctx.contacts.set(key, match);
  }
  return match;
}

/** The review fields for one record read off a document. */
export async function buildReviewFields(
  db: LedgerDb,
  input: ReadFields,
  ctx: ReviewContext,
): Promise<ReviewFields> {
  const docType = input.documentType;
  const isIncome = docType === DocumentType.Income;

  const dup = detectDuplicate(db, {
    originalFilename: input.duplicateEvidence.originalFilename,
    fileHash: input.duplicateEvidence.fileHash,
    itemName: input.itemName,
    supplier: input.supplier,
    amount: input.amount,
    date: input.date,
    reference: input.reference,
    extractedText: input.duplicateEvidence.extractedText,
    documentType: docType,
  });

  // Contact resolution — deterministic backend step (the LLM is never given
  // the contact list). `supplier` always carries the other party's name,
  // whether it's who was paid (expense) or who paid (income) — only which
  // contact bucket to search (Supplier vs Customer) depends on the kind.
  const role = isIncome ? Role.Customer : Role.Supplier;
  const { matchedId, candidates } = contactFor(
    db,
    ctx,
    input.supplier ?? "",
    role,
  );

  // Resolve the exchange rate up front when the currency is foreign, so the
  // review card shows a converted preview. Left null when no API key or the
  // rate is unavailable — the reviewer then enters it by hand.
  const currency = input.currency.toUpperCase();
  const exchangeRate = await rateFor(db, ctx, currency, input.date);

  // An imported document proves an amount is owed, not that money moved.
  // Payment is a separate event, so imports always start on Payable/Receivable.
  const settlementDefault = requireAccountDefault(
    db,
    isIncome ? DefaultAccountPurpose.Receivable : DefaultAccountPurpose.Payable,
  );
  const categoryDefault = requireAccountDefault(
    db,
    isIncome
      ? DefaultAccountPurpose.UncategorisedIncome
      : DefaultAccountPurpose.UncategorisedExpense,
  );
  const kind = isIncome ? "income" : "expense";
  const choices = isIncome ? ctx.incomeChoices : ctx.expenseChoices;
  const categoryResult = categoryAccountForImport(
    kind,
    choices,
    input.categoryAccountId,
    categoryDefault.ok ? categoryDefault.value : null,
  );
  const categoryAccountId = categoryResult.ok
    ? categoryResult.value.accountId
    : null;
  const category =
    categoryAccountId == null
      ? null
      : (choices.find((choice) => choice.id === categoryAccountId)?.name ??
        null);

  return {
    documentType: docType,
    itemName: input.itemName,
    supplier: input.supplier,
    matchedContactId: matchedId,
    matchCandidates: candidates.length ? JSON.stringify(candidates) : null,
    date: input.date,
    amount: input.amount,
    currency,
    exchangeRate,
    reference: input.reference,
    category,
    categoryAccountId,
    remark: input.remark,
    duplicateOf: dup?.duplicateOf ?? null,
    duplicateConfidence: dup?.confidence ?? null,
    duplicateReasons: dup ? JSON.stringify(dup.reasons) : null,
    accountId: settlementDefault.ok ? settlementDefault.value : null,
    // Only the reading of an item has anything to say here; see `itemFields`
    // in `process-job.ts`.
    reviewNote: null,
  };
}
