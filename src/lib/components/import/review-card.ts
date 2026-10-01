import { AccountType, documentTypeEnum } from "$lib/enums.js";
import {
  defaultTargetForImportSource,
  importSourceIsIncome,
  targetAccountsForImportSource,
} from "$lib/import-account-groups.js";
import {
  ImportReadAs,
  ImportReadHow,
  controlTotal,
  parseExtractionNotes,
} from "$lib/import-reading.js";
import { formatCurrency } from "$lib/currency.js";
import type { AccountView } from "$lib/server/ledger/types.js";

/**
 * What the import screens need to know about one proposed record: a receipt on
 * the queue, or one item of a document read as several items. Both have the
 * same review fields (`reviewColumns` on the server), so one review card shows
 * either, and the rules below are written once for both.
 */

/** A contact the other party's name may be, best first. */
export type Candidate = { id: number; legalName: string; score?: number };

/**
 * The reviewer's corrections that are not saved yet, by field name. The names
 * are the ones the confirm route and the item edit route take
 * (`reviewOverridesSchema` on the server).
 */
export type ReviewEdits = Record<string, string | number>;

/** The review fields of a receipt or an item, as the screen holds them. */
export type ReviewRow = {
  id: string;
  /** "expense" or "income", as read; null when the reading did not say. */
  documentType: string | null;
  itemName: string | null;
  supplier: string | null;
  matchedContactId: number | null;
  matchCandidates: Candidate[];
  date: string | null;
  amount: number | null;
  currency: string | null;
  exchangeRate: number | null;
  reference: string | null;
  category: string | null;
  categoryAccountId: number | null;
  remark: string | null;
  /** Which account paid for this, or received it. */
  accountId: number | null;
  duplicateOf: number | null;
  duplicateConfidence: number | null;
  duplicateReasons: string[];
};

/** The accounts and defaults a review card chooses from. */
export type ReviewOptions = {
  allAccounts: AccountView[];
  categoryAccounts: AccountView[];
  payableAccountId: number | null;
  receivableAccountId: number | null;
  uncategorisedAccountId: number | null;
  uncategorisedIncomeAccountId: number | null;
};

function parseList<T>(raw: unknown): T[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * The review fields of a row as the server sends it (codes, and lists stored
 * as JSON text), in the shape the card reads.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function reviewRowFrom(raw: any): ReviewRow {
  return {
    id: raw.id,
    documentType: documentTypeEnum.toLabel(raw.documentType),
    itemName: raw.itemName ?? null,
    supplier: raw.supplier ?? null,
    matchedContactId: raw.matchedContactId ?? null,
    matchCandidates: parseList<Candidate>(raw.matchCandidates),
    date: raw.date ?? null,
    amount: raw.amount ?? null,
    currency: raw.currency ?? null,
    exchangeRate: raw.exchangeRate ?? null,
    reference: raw.reference ?? null,
    category: raw.category ?? null,
    categoryAccountId: raw.categoryAccountId ?? null,
    remark: raw.remark ?? null,
    accountId: raw.accountId ?? null,
    duplicateOf: raw.duplicateOf ?? null,
    duplicateConfidence: raw.duplicateConfidence ?? null,
    duplicateReasons: parseList<string>(raw.duplicateReasons),
  };
}

// ── Fields ──────────────────────────────────────────────────────────────────

/** A field's value: the reviewer's correction, else what was read. */
export function editedValue(
  row: ReviewRow,
  edits: ReviewEdits,
  key: string,
  mainCurrency: string,
): string | number {
  if (key in edits) return edits[key];
  if (key === "item_name") return row.itemName ?? "";
  if (key === "supplier") return row.supplier ?? "";
  if (key === "amount") return row.amount ?? 0;
  if (key === "currency") return (row.currency ?? mainCurrency).toUpperCase();
  if (key === "exchangeRate") return row.exchangeRate ?? "";
  if (key === "category") return row.category ?? "";
  if (key === "date") return row.date ?? "";
  if (key === "reference") return row.reference ?? "";
  if (key === "remark") return row.remark ?? "";
  return "";
}

/** The currency the record will be in. */
export function reviewCurrency(
  row: ReviewRow,
  edits: ReviewEdits,
  mainCurrency: string,
): string {
  return String(
    editedValue(row, edits, "currency", mainCurrency) || mainCurrency,
  ).toUpperCase();
}

export function reviewIsForeign(
  row: ReviewRow,
  edits: ReviewEdits,
  mainCurrency: string,
): boolean {
  return reviewCurrency(row, edits, mainCurrency) !== mainCurrency;
}

/** The exchange rate as text, or "" when there is none. */
export function reviewRateText(
  row: ReviewRow,
  edits: ReviewEdits,
  mainCurrency: string,
): string {
  const v = editedValue(row, edits, "exchangeRate", mainCurrency);
  return v === "" || v == null ? "" : String(v);
}

/** A foreign currency with no rate cannot be valued, so it cannot be imported. */
export function reviewRateMissing(
  row: ReviewRow,
  edits: ReviewEdits,
  mainCurrency: string,
): boolean {
  return (
    reviewIsForeign(row, edits, mainCurrency) &&
    !(parseFloat(reviewRateText(row, edits, mainCurrency)) > 0)
  );
}

/**
 * The amount in the main currency, for the read-only preview only. The record
 * itself is converted on the server, in whole cents.
 */
export function reviewConverted(
  row: ReviewRow,
  edits: ReviewEdits,
  mainCurrency: string,
): number | null {
  const a = parseFloat(String(editedValue(row, edits, "amount", mainCurrency)));
  const r = parseFloat(reviewRateText(row, edits, mainCurrency));
  if (
    !reviewIsForeign(row, edits, mainCurrency) ||
    isNaN(a) ||
    isNaN(r) ||
    r <= 0
  )
    return null;
  return a * r;
}

/** Two decimals with thousands separators, or a dash. For display only. */
export function formatMoney(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

// ── Possible duplicates ─────────────────────────────────────────────────────

const DUP_REASON_LABELS: Record<string, string> = {
  file_hash: "identical file",
  reference: "reference",
  amount: "amount",
  date: "date",
  supplier: "supplier",
  filename: "filename",
  content: "content",
};

export function dupReasonsLabel(row: ReviewRow): string {
  return row.duplicateReasons.map((r) => DUP_REASON_LABELS[r] ?? r).join(" · ");
}

export function dupMessage(row: ReviewRow): string {
  if (row.duplicateReasons.includes("file_hash"))
    return `This exact file was already imported.`;
  return `${row.duplicateConfidence}% match on ${dupReasonsLabel(row)} against an existing record.`;
}

// ── Accounts ────────────────────────────────────────────────────────────────

/**
 * The category account a row was read under: its own when that is still one of
 * the categories, else the category whose name it read, for its kind.
 */
export function initialCategoryAccountId(
  row: Pick<ReviewRow, "category" | "categoryAccountId" | "documentType">,
  options: ReviewOptions,
): number | null {
  if (
    row.categoryAccountId != null &&
    options.categoryAccounts.some(
      (account) => account.id === row.categoryAccountId,
    )
  ) {
    return row.categoryAccountId;
  }
  const wanted = (row.category ?? "").trim().toLowerCase();
  if (!wanted) return null;
  const candidates = options.categoryAccounts.filter(
    (account) =>
      account.name.trim().toLowerCase() === wanted &&
      (row.documentType === "income"
        ? account.type === AccountType.Revenue
        : account.type !== AccountType.Revenue),
  );
  return candidates[0]?.id ?? null;
}

/**
 * The two accounts a receipt's card starts with. The source sets the
 * direction: an income starts from its category, an expense from Accounts
 * Payable (an imported document proves an amount is owed, not that it was
 * paid).
 */
export function receiptSides(
  row: ReviewRow,
  options: ReviewOptions,
): { source: number | null; target: number | null } {
  if (row.documentType === "income") {
    return {
      source:
        initialCategoryAccountId(row, options) ??
        options.uncategorisedIncomeAccountId,
      target: options.receivableAccountId ?? row.accountId ?? null,
    };
  }
  return {
    source: options.payableAccountId ?? row.accountId ?? null,
    target:
      initialCategoryAccountId(row, options) ?? options.uncategorisedAccountId,
  };
}

/**
 * The two accounts an item's card shows. An item keeps its account and its
 * category on the server, so they are read from the item as it is: the account
 * that paid is the source of an expense, and the account that received is the
 * target of an income.
 */
export function itemSides(
  row: ReviewRow,
  options: ReviewOptions,
): { source: number | null; target: number | null } {
  if (row.documentType === "income") {
    return {
      source:
        initialCategoryAccountId(row, options) ??
        options.uncategorisedIncomeAccountId,
      target: row.accountId,
    };
  }
  return {
    source: row.accountId,
    target:
      initialCategoryAccountId(row, options) ?? options.uncategorisedAccountId,
  };
}

/** The accounts the target may be, once the source has set the direction. */
export function targetChoices(
  options: ReviewOptions,
  source: number | null,
): AccountView[] {
  return targetAccountsForImportSource(
    options.allAccounts,
    source,
    options.payableAccountId,
    options.receivableAccountId,
  );
}

/**
 * The target after the source changed: the one chosen, while it still fits the
 * new source, else the usual default for that direction, else none.
 */
export function targetAfterSourceChange(
  options: ReviewOptions,
  source: number,
  currentTarget: number | null,
): number | null {
  const targets = targetChoices(options, source);
  if (targets.some((account) => account.id === currentTarget))
    return currentTarget;
  const defaultTarget = defaultTargetForImportSource(
    options.allAccounts,
    source,
    options.receivableAccountId,
    options.uncategorisedAccountId,
  );
  return targets.some((account) => account.id === defaultTarget)
    ? defaultTarget
    : null;
}

/** Whether the chosen source makes this an income. */
export function sideIsIncome(
  row: Pick<ReviewRow, "documentType">,
  options: ReviewOptions,
  source: number | null,
): boolean {
  return source == null
    ? row.documentType === "income"
    : importSourceIsIncome(options.allAccounts, source);
}

// ── A document read as several items ────────────────────────────────────────

/** How a document was read, in the words the queue card and the group page use. */
export function describeReading(job: {
  readAs?: string | null;
  readHow?: string | null;
}): string {
  if (job.readAs === ImportReadAs.SeveralItems) {
    return "Read as several items";
  }
  if (
    job.readAs === ImportReadAs.Auto &&
    job.readHow === ImportReadHow.Standard
  ) {
    return "Read as one receipt (auto-detect)";
  }
  return "Read as one receipt";
}

/** The control total as the screens say it, or null when there is none. */
export function describeControlTotal(
  extractionNotes: string | null | undefined,
): { matches: boolean; text: string } | null {
  const notes = parseExtractionNotes(extractionNotes);
  if (!notes) return null;
  const total = controlTotal(notes);
  if (!total || !notes.statedTotal) return null;
  if (total.matches) {
    return { matches: true, text: "Control total matches" };
  }
  // Cents to a decimal for display only: the comparison above is in cents.
  const difference = formatCurrency(
    Math.abs(total.differenceMinor) / 100,
    notes.statedTotal.currency,
  );
  return { matches: false, text: `Control total differs by ${difference}` };
}
