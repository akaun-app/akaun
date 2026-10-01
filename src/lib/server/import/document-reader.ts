/**
 * Reads a document that holds several items into one proposed record per item
 * (006 US1-3). The model only copies what is printed: which lines are items,
 * and each line's wording and amount. Everything worked out from those figures
 * is done here in code, in whole cents: the kind of each item, the direction of
 * the stated total, and the control total. The model's own arithmetic is never
 * used, because the research on real documents found it wrong (design.md,
 * "S0.5 research results").
 *
 * The reading is all or nothing (FR-011): the document is read in one call on
 * one provider, and when that fails the next provider reads the whole document
 * again. Nothing is ever cut to fit (FR-010): a document over a limit fails
 * with the limit named.
 *
 * What it returns is not saved here. The import worker turns each item into
 * review fields (contact match, exchange rate, duplicate check).
 */

import { DocumentType, type DocumentTypeCode } from "$lib/enums.js";
import {
  DOCUMENT_ITEMS_MAX,
  DOCUMENT_TEXT_MAX_CHARS,
  capIgnored,
  controlTotal,
  type ExtractionNotes,
} from "$lib/import-reading.js";
import { fromMinor, toMinor } from "../ledger/money.js";
import type { Minor } from "../ledger/types.js";
import type { LLMProviderConfig } from "../llm/model-factory.js";
import {
  CallTimedOutError,
  OutputTruncatedError,
  callStructured,
  withProviderFailover,
  type StructuredSpec,
} from "../llm/structured-call.js";
import { createLogger } from "../logger.js";
import {
  compileProfile,
  type CompiledProfile,
  type ReadEnvelope,
  type ReadItem,
  type ReadingProfile,
  type SectionSpec,
} from "./profile-compiler.js";
import {
  DOCUMENT_IS_DATA,
  JSON_ONLY,
  MAX_LABEL_LENGTH,
  PROMPT_ROLE,
  accountChoicesJson,
  customInstructionsBlock,
  parseCurrency,
  parseDate,
  truncate,
  wrapDocument,
  type ImportAccountChoice,
} from "./providers/shared.js";

const log = createLogger("import:document-reader");

/** Which limit a document went over. */
export type DocumentLimit = "characters" | "items" | "output" | "time";

/**
 * The longest one request to the model may take while reading a document. It
 * is kept well under Bun's own 300 s fetch timeout, whose error names no limit,
 * so a slow reading fails with this limit named instead (FR-010). The research
 * model wrote about 10 to 20 tokens a second (design.md, "S0.5 research
 * results").
 */
export const DOCUMENT_READ_TIMEOUT_MS = 240_000;

/**
 * The most tokens the model may write in one reading. It is kept at 8,192, an
 * output length most models accept: a provider may refuse a figure above its
 * model's own limit with HTTP 400, and then every reading on it would fail. At
 * the research model's speed, the time limit above is reached first anyway. A
 * document whose answer needs more fails with the output limit named.
 */
export const DOCUMENT_READ_MAX_OUTPUT_TOKENS = 8_192;

/** The limits of one reading. Tests pass smaller ones. */
export interface DocumentReadLimits {
  timeoutMs: number;
  maxOutputTokens: number;
}

const DEFAULT_READ_LIMITS: DocumentReadLimits = {
  timeoutMs: DOCUMENT_READ_TIMEOUT_MS,
  maxOutputTokens: DOCUMENT_READ_MAX_OUTPUT_TOKENS,
};

/**
 * A document that cannot be read in full. Its message names the limit, so the
 * failed upload tells the user why (FR-010).
 */
export class DocumentLimitError extends Error {
  constructor(
    readonly limit: DocumentLimit,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DocumentLimitError";
  }
}

export interface DocumentReadingParams {
  /** The document's numbered text (`extractNumberedText`). */
  text: string;
  /** What to read. For now always `SEVERAL_ITEMS_PROFILE`. */
  profile: ReadingProfile;
  expenseAccounts: ImportAccountChoice[];
  incomeAccounts: ImportAccountChoice[];
  mainCurrency: string;
  /** The user's own notes about their documents, from Settings. */
  customInstructions?: string;
  /** YYYY-MM-DD; the date used when the document's own is unclear. */
  today?: string;
}

/** One proposed record. */
export interface DocumentItem {
  sectionKey: string;
  kind: DocumentTypeCode;
  description: string;
  /** Positive whole cents in the document's own currency. */
  amountMinor: Minor;
  /** The same figure as a decimal, as a review field stores it. */
  amount: number;
  /** The item's own date when its line prints one, else the document's. */
  date: string;
  /** The item's own reference when its line prints one, else the document's. */
  reference: string;
  /** The document line the amount is printed on, when the model said. */
  sourceLine: number | null;
  feeType: string | null;
  /** The model's pick; the worker still checks it against the user's list. */
  categoryAccountId: number | null;
  extras: Record<string, unknown> | null;
}

/** What reading a document found. */
export interface DocumentReading {
  schemaId: string;
  /** The other party, never shortened: it is matched against contacts. */
  counterparty: string;
  date: string;
  reference: string;
  currency: string;
  items: DocumentItem[];
  /** The stated total, the items added up, and the lines left out. */
  notes: ExtractionNotes;
  /** The items against the stated total; null when none is printed. */
  controlTotal: { matches: boolean; differenceMinor: number } | null;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

/** "4 minutes", "1 minute" or "0.05 seconds", for a limit's message. */
function formatDuration(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const seconds = ms / 1000;
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** The instructions sent with the document. */
export function buildItemsSystemPrompt(
  compiled: CompiledProfile,
  params: Omit<DocumentReadingParams, "text">,
): string {
  const asksForCategory = params.profile.sections.some(
    (section) => section.categoryFromModel,
  );
  const categoryLines = asksForCategory
    ? `
- category_account_id = the id of the best matching account for that line, from the list for the
  document's kind. Null when the line does not say enough to choose one. Never invent an id.
  Expense and asset-purchase accounts: ${accountChoicesJson(params.expenseAccounts)}
  Income accounts: ${accountChoicesJson(params.incomeAccounts)}`
    : "";
  return `${PROMPT_ROLE}

${DOCUMENT_IS_DATA}
The system starts each line of the document with its number, such as L0001│, and each page with a
line such as --- page 2 ---. These marks are not printed on the document.

Instructions:
${params.profile.instructions}${categoryLines}
${customInstructionsBlock(params.customInstructions)}
The JSON must match this JSON Schema, and its descriptions say what each field holds:
${JSON.stringify(compiled.wire)}

${JSON_ONLY}`;
}

/**
 * Reads the document with the profile and returns its items, or throws. A
 * document over a limit throws `DocumentLimitError`.
 */
export async function readDocumentItems(
  params: DocumentReadingParams,
  providers: LLMProviderConfig[],
  intervalMs = 0,
  limits: Partial<DocumentReadLimits> = {},
): Promise<DocumentReading> {
  const { timeoutMs, maxOutputTokens } = { ...DEFAULT_READ_LIMITS, ...limits };
  if (params.text.length > DOCUMENT_TEXT_MAX_CHARS) {
    throw new DocumentLimitError(
      "characters",
      `This document is too long to read in full: it has ${formatCount(params.text.length)} characters of text, and the limit is ${formatCount(DOCUMENT_TEXT_MAX_CHARS)}.`,
    );
  }

  const today = params.today ?? new Date().toISOString().slice(0, 10);
  const compiled = compileProfile(params.profile);
  const spec: StructuredSpec<ReadEnvelope> = {
    schemaId: compiled.schemaId,
    schema: compiled.schema,
    parse: compiled.parse,
    instructions: buildItemsSystemPrompt(compiled, params),
    prompt: wrapDocument(params.text),
    maxOutputTokens,
    timeoutMs,
  };

  // Which limits any provider ran into. The failover keeps only the last
  // provider's error, so a first provider that was cut off would otherwise be
  // hidden behind a second that failed some other way.
  let truncated = false;
  let timedOut = false;
  let envelope: ReadEnvelope;
  try {
    envelope = await withProviderFailover(
      providers,
      async (model, provider) => {
        try {
          return await callStructured(model, provider, spec, intervalMs);
        } catch (error) {
          if (error instanceof OutputTruncatedError) truncated = true;
          if (error instanceof CallTimedOutError) timedOut = true;
          throw error;
        }
      },
      log,
    );
  } catch (error) {
    // The last provider's error, which the failover keeps as its cause.
    const cause = error instanceof Error ? (error.cause ?? error) : error;
    if (truncated) {
      throw new DocumentLimitError(
        "output",
        `This document is too long to read in full: the AI model's answer reached its output length limit of ${formatCount(maxOutputTokens)} tokens before every line was read.`,
        { cause },
      );
    }
    if (timedOut) {
      throw new DocumentLimitError(
        "time",
        `This document took longer to read than the limit of ${formatDuration(timeoutMs)} for one reading, so it was not read in full.`,
        { cause },
      );
    }
    throw error;
  }

  const lineCount = params.profile.sections.reduce(
    (sum, section) => sum + (envelope.sections[section.key]?.length ?? 0),
    0,
  );
  if (lineCount > DOCUMENT_ITEMS_MAX) {
    throw new DocumentLimitError(
      "items",
      `This document has too many items to import: ${formatCount(lineCount)} were read, and the limit is ${formatCount(DOCUMENT_ITEMS_MAX)}.`,
    );
  }

  const reading = readingFromEnvelope(envelope, params.profile, {
    today,
    mainCurrency: params.mainCurrency,
    schemaId: compiled.schemaId,
  });
  log.debug(
    {
      schemaId: reading.schemaId,
      items: reading.items.length,
      ignored: reading.notes.ignored.length,
      controlTotal: reading.controlTotal,
    },
    "Document read",
  );
  return reading;
}

/**
 * Which sign a section's charges carry on this document. Most documents print
 * charges as plain figures, but some print every fee with a minus. The charges
 * are the larger part of the money, so the sign of the lines' sum is theirs,
 * and a line with the other sign is a credit, discount or refund. Counting
 * lines instead would let two small credits outvote one large charge.
 *
 * The sum decides before the printed total does: a summary box can print a
 * total without the minus its lines carry. Only a sum of zero falls back to
 * the printed total's sign, and then to plus.
 */
function chargeSign(
  amounts: readonly Minor[],
  statedTotal: Minor | null,
): 1 | -1 {
  const sum = amounts.reduce((total, minor) => total + minor, 0);
  if (sum !== 0) return sum < 0 ? -1 : 1;
  return statedTotal != null && statedTotal < 0 ? -1 : 1;
}

/** A left-out line as the reviewer sees it, e.g. "Discount -5.00". */
function ignoredLine(line: ReadItem, minor: Minor): string {
  return `${line.description.trim()} ${fromMinor(minor).toFixed(2)}`.trim();
}

/**
 * The one kind every section of the profile shares, or null when they differ
 * or a section's kind depends on each line's sign.
 */
function sharedKind(
  sections: readonly SectionSpec[],
  documentKind: DocumentTypeCode,
): DocumentTypeCode | null {
  const kinds = new Set(
    sections.map((section) =>
      section.kind === "document"
        ? documentKind
        : section.kind === "income"
          ? DocumentType.Income
          : section.kind === "expense"
            ? DocumentType.Expense
            : null,
    ),
  );
  if (kinds.size !== 1 || kinds.has(null)) return null;
  return [...kinds][0];
}

/**
 * Turns the model's answer into proposed records, in code. Exported for the
 * tests; `readDocumentItems` is the way in.
 */
export function readingFromEnvelope(
  envelope: ReadEnvelope,
  profile: ReadingProfile,
  context: { today: string; mainCurrency: string; schemaId: string },
): DocumentReading {
  const { header } = envelope;
  const currency = parseCurrency(header.currency, context.mainCurrency);
  const date = parseDate(header.date ?? "", context.today);
  const reference = (header.reference ?? "").trim();
  const documentKind: DocumentTypeCode =
    header.document_type === "income"
      ? DocumentType.Income
      : DocumentType.Expense;

  // Lines code left out, ahead of the model's own list: these carry money the
  // reviewer should know about.
  const leftOut: string[] = [];
  const items: DocumentItem[] = [];
  const printedTotal =
    envelope.stated_total != null ? toMinor(envelope.stated_total, 1) : null;

  for (const section of profile.sections) {
    const lines = envelope.sections[section.key] ?? [];
    const amounts = lines.map((line) => toMinor(line.amount, 1));
    const charges =
      section.kind === "document" ? chargeSign(amounts, printedTotal) : 1;

    lines.forEach((line, index) => {
      const minor = amounts[index];
      if (minor === 0) {
        leftOut.push(ignoredLine(line, minor));
        return;
      }
      // A section with fee types keeps only lines of a known type (FR-034).
      if (section.feeTypes?.length && line.fee_type == null) {
        leftOut.push(ignoredLine(line, minor));
        return;
      }

      let kind: DocumentTypeCode;
      switch (section.kind) {
        case "document":
          // Against the charges' sign: a credit, discount or refund, which the
          // several-items reading does not import (FR-005).
          if (Math.sign(minor) !== charges) {
            leftOut.push(ignoredLine(line, minor));
            return;
          }
          kind = documentKind;
          break;
        case "income":
          kind = DocumentType.Income;
          break;
        case "expense":
          kind = DocumentType.Expense;
          break;
        case "by_sign":
          kind = minor > 0 ? DocumentType.Income : DocumentType.Expense;
          break;
      }

      // A record keeps its amount without a sign, as a receipt does; the
      // kind says which way the money went.
      const amountMinor = Math.abs(minor);
      const ownDate = line.date ? parseDate(line.date, "") : "";
      const sourceLine =
        line.source_line != null && line.source_line > 0
          ? line.source_line
          : null;
      const categoryAccountId =
        section.categoryFromModel &&
        line.category_account_id != null &&
        line.category_account_id > 0
          ? line.category_account_id
          : null;
      items.push({
        sectionKey: section.key,
        kind,
        description: truncate(line.description, MAX_LABEL_LENGTH),
        amountMinor,
        amount: fromMinor(amountMinor),
        date: ownDate || date,
        reference: line.reference?.trim() || reference,
        sourceLine,
        feeType: line.fee_type ?? null,
        categoryAccountId,
        extras: line.extras ?? null,
      });
    });
  }

  // Income counts as plus and expenses as minus (FR-013).
  const itemsTotalMinor = items.reduce(
    (sum, item) =>
      sum +
      (item.kind === DocumentType.Income
        ? item.amountMinor
        : -item.amountMinor),
    0,
  );

  // The printed total is given the direction of what it totals, so it can be
  // compared with the items as they are (see `ExtractionNotes.statedTotal`).
  // When the sections differ in kind the total is a net figure, and its
  // printed sign already says which way the money went.
  let statedTotal: ExtractionNotes["statedTotal"] = null;
  if (printedTotal != null) {
    const printed = printedTotal;
    const kind = sharedKind(profile.sections, documentKind);
    const minor =
      kind === null || printed === 0
        ? printed
        : kind === DocumentType.Income
          ? Math.abs(printed)
          : -Math.abs(printed);
    statedTotal = { minor, currency };
  }

  const notes: ExtractionNotes = {
    statedTotal,
    itemsTotalMinor,
    ignored: capIgnored([...leftOut, ...envelope.ignored]),
  };

  return {
    schemaId: context.schemaId,
    counterparty: (header.counterparty ?? "").trim(),
    date,
    reference,
    currency,
    items,
    notes,
    controlTotal: controlTotal(notes),
  };
}
