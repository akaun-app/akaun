/**
 * How an imported document is read, in the words the queue row stores them
 * (`import_queue.read_as`, `import_mode`, `read_how`, `extraction_notes`).
 *
 * These values are text in the database, not codes: each column is empty on a
 * row uploaded before it existed, and an empty row is read as one receipt,
 * which is how every document was read then (FR-048). The file has no server
 * imports, so the import screen reads the same words.
 */

/** What the uploader chose under "Read as" (FR-001). */
export const ImportReadAs = {
  /** Let the system decide; with no enabled profile this is the receipt. */
  Auto: "auto",
  /** "Single record": the standard reading of a receipt or invoice. */
  Receipt: "receipt",
  /** "Multiple records": one record per item on the document. */
  SeveralItems: "items",
  /** A saved profile, named by the row's profile id. */
  Profile: "profile",
} as const;
export type ImportReadAsValue =
  (typeof ImportReadAs)[keyof typeof ImportReadAs];

/**
 * How an upload names a saved profile under "Read as": `profile:<id>`, with
 * the profile's whole-number id. The row then stores `read_as` = "profile"
 * and the id on its own in `profile_id`, so the word an upload sends and the
 * words a row stores never mix (FR-048: an older row's `profile_id`, such as
 * "builtin:items@1", is never read as a saved profile).
 */
export const PROFILE_READ_AS_PREFIX = "profile:";

/** The "Read as" value that names a saved profile. */
export function profileReadAsValue(id: number | string): string {
  return `${PROFILE_READ_AS_PREFIX}${id}`;
}

/** Which part of a statement-like document is read (FR-002, FR-032). */
export const ImportMode = {
  Summary: "summary",
  EveryTransaction: "every_transaction",
} as const;
export type ImportModeValue = (typeof ImportMode)[keyof typeof ImportMode];

/** An import mode in the words the upload screen uses. */
export function importModeLabel(mode: ImportModeValue): string {
  return mode === ImportMode.EveryTransaction ? "Every transaction" : "Summary";
}

/** Whether a stored value is an import mode. */
export function isImportMode(value: unknown): value is ImportModeValue {
  return value === ImportMode.Summary || value === ImportMode.EveryTransaction;
}

/** How the reading was picked, for the screen to say (FR-041). */
export const ImportReadHow = {
  /** The uploader named the reading. */
  Chosen: "chosen",
  /** Auto-detect found a profile that fits. */
  Detected: "detected",
  /** Auto-detect found none, so the document was read as a receipt. */
  Standard: "standard",
} as const;
export type ImportReadHowValue =
  (typeof ImportReadHow)[keyof typeof ImportReadHow];

/**
 * The most document text one reading sends to the model, in characters,
 * counted as the model receives it (with its line numbers). A longer document
 * fails with this limit named; it is never cut short (006 FR-010).
 */
export const DOCUMENT_TEXT_MAX_CHARS = 200_000;
/** The most items one document may yield. More fails with the limit named. */
export const DOCUMENT_ITEMS_MAX = 1_000;

/** At most this many ignored lines are kept for one document. */
export const IGNORED_LINES_MAX = 20;
/** Each ignored line is cut to this many characters. */
export const IGNORED_LINE_MAX_CHARS = 120;

/**
 * How a document's items were read (FR-041): by the AI in one call, by the AI
 * in pieces (FR-043), from a spreadsheet's columns by code (FR-055), or its
 * table by code and the rest of the sheet by the AI (FR-057).
 */
export type ReadMethod = "ai" | "ai_pieces" | "columns" | "columns_ai";
const READ_METHODS: readonly ReadMethod[] = [
  "ai",
  "ai_pieces",
  "columns",
  "columns_ai",
];

/**
 * What reading a document found besides its items. All money is whole cents in
 * the document's own currency, never a decimal.
 */
export type ExtractionNotes = {
  /**
   * The total the document prints for exactly the lines being imported, such
   * as "Total charges". Null when it prints none, and then no control total is
   * shown (FR-013 to FR-015).
   *
   * `minor` carries the same sign as `itemsTotalMinor`, not the sign printed
   * on the page. Documents print their totals as plain positive figures, so the
   * reading gives the figure the direction of what it totals: plus when it is
   * money in, minus when it is money out. "Total charges 1,812.87" on a fee
   * notice is stored as -181287, because its lines are expenses. "Total payout
   * released 13,732.56" on a marketplace statement is stored as +1373256,
   * because it is sales less fees and the seller receives it. The control total
   * then compares the two figures directly.
   */
  statedTotal: { minor: number; currency: string } | null;
  /**
   * The items as read, added up: income as plus, expenses as minus. Kept as it
   * was at reading, because the control total checks the reading, not later
   * edits or skips (FR-013).
   */
  itemsTotalMinor: number;
  /**
   * A short piece of text for each line the reading left out on purpose, such
   * as "Subtotal 1,230.00". A guide for the reviewer, never a complete list
   * (FR-012).
   */
  ignored: string[];
  /**
   * How many lines were left out in all, when the reading counted them: a
   * reading from columns leaves out every row no section takes, often
   * hundreds, and keeps only a sample in `ignored` (FR-056). Absent when only
   * the sample is known, as for an AI reading.
   */
  ignoredCount?: number;
  /**
   * How the items were read. "ai" is an Every transaction reading by the AI
   * in one call. Absent on a Summary reading by the AI in one call, and on
   * every row from before the methods existed, which were all read that way.
   */
  method?: ReadMethod;
  /**
   * What the running-balance check of a reading from columns found, when the
   * profile's layout names a balance column: whether each row's balance
   * follows from the row before it and its amount, and a sentence saying so
   * for the reviewer. A note only: it never holds an item back. Absent when
   * nothing was checked.
   */
  balance?: { matches: boolean; message: string };
};

/** Cuts the ignored lines to the kept number and length. */
export function capIgnored(lines: readonly unknown[]): string[] {
  const kept: string[] = [];
  for (const line of lines) {
    if (typeof line !== "string") continue;
    const text = line.replace(/\s+/g, " ").trim();
    if (!text) continue;
    kept.push(
      text.length > IGNORED_LINE_MAX_CHARS
        ? `${text.slice(0, IGNORED_LINE_MAX_CHARS - 1)}…`
        : text,
    );
    if (kept.length === IGNORED_LINES_MAX) break;
  }
  return kept;
}

function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** The notes as the column stores them, with the ignored lines capped. */
export function serializeExtractionNotes(notes: ExtractionNotes): string {
  return JSON.stringify({
    statedTotal: notes.statedTotal,
    itemsTotalMinor: notes.itemsTotalMinor,
    ignored: capIgnored(notes.ignored),
    ...(notes.ignoredCount !== undefined
      ? { ignoredCount: notes.ignoredCount }
      : {}),
    ...(notes.method !== undefined ? { method: notes.method } : {}),
    ...(notes.balance !== undefined ? { balance: notes.balance } : {}),
  } satisfies ExtractionNotes);
}

/**
 * Reads the column back. Anything it cannot read as notes gives null, so a
 * damaged value shows no control total rather than a wrong one.
 */
export function parseExtractionNotes(
  stored: string | null | undefined,
): ExtractionNotes | null {
  if (!stored) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (!isCents(value.itemsTotalMinor)) return null;

  let statedTotal: ExtractionNotes["statedTotal"] = null;
  const stated = value.statedTotal;
  if (stated != null) {
    if (typeof stated !== "object") return null;
    const { minor, currency } = stated as Record<string, unknown>;
    if (!isCents(minor) || typeof currency !== "string") return null;
    statedTotal = { minor, currency };
  }

  const notes: ExtractionNotes = {
    statedTotal,
    itemsTotalMinor: value.itemsTotalMinor,
    ignored: Array.isArray(value.ignored) ? capIgnored(value.ignored) : [],
  };
  // Each is dropped when it is not what it should be, rather than the whole
  // value: neither changes the control total.
  if (isCents(value.ignoredCount) && value.ignoredCount >= 0) {
    notes.ignoredCount = value.ignoredCount;
  }
  if ((READ_METHODS as readonly unknown[]).includes(value.method)) {
    notes.method = value.method as ReadMethod;
  }
  const balance = value.balance as Record<string, unknown> | null | undefined;
  if (
    balance &&
    typeof balance === "object" &&
    typeof balance.matches === "boolean" &&
    typeof balance.message === "string"
  ) {
    notes.balance = { matches: balance.matches, message: balance.message };
  }
  return notes;
}

/**
 * How many lines a reading left out, and how many of them it lists: "Ignored
 * 726 lines (20 shown)" (FR-056). Null when it left out none.
 */
export function ignoredSummary(
  notes: Pick<ExtractionNotes, "ignored" | "ignoredCount">,
): string | null {
  const shown = notes.ignored.length;
  const count = Math.max(notes.ignoredCount ?? shown, shown);
  if (count === 0) return null;
  const lines = `Ignored ${count.toLocaleString("en-US")} line${count === 1 ? "" : "s"}`;
  return count > shown ? `${lines} (${shown} shown)` : lines;
}

/**
 * The control total: the items against the stated total, to the cent. Null when
 * the document states no total, so nothing implies a check that did not happen.
 * Both figures are signed the same way (see `ExtractionNotes.statedTotal`), so
 * they are compared as they are. `differenceMinor` is the items less the stated
 * total; zero means it matches.
 */
export function controlTotal(
  notes: ExtractionNotes,
): { matches: boolean; differenceMinor: number } | null {
  if (!notes.statedTotal) return null;
  const differenceMinor = notes.itemsTotalMinor - notes.statedTotal.minor;
  return { matches: differenceMinor === 0, differenceMinor };
}
