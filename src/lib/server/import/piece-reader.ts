/**
 * Reads a long document in pieces, for an Every transaction reading by the AI
 * (006 FR-043, FR-065, US8). A table of several hundred transactions needs
 * more written back than one call can give within its time, so the document
 * is read a run of lines at a time.
 *
 * **Every line belongs to exactly one piece.** The numbered lines (`L0412│`,
 * see `numberDocumentLines`) are cut into owned ranges that cover each line
 * once. A piece is shown a few lines either side of its own range as context,
 * so a row that starts or ends just outside it can be read whole, but only its
 * own lines become items:
 *
 * - an item whose line is in its piece's own range is kept;
 * - an item read from a context line is dropped when the piece that owns that
 *   line listed it too, and otherwise kept and flagged for the reviewer;
 * - an item with no line, or with a line its piece was never shown, is kept
 *   and flagged. Nothing the system is unsure of is removed;
 * - two identical rows on different lines are two items.
 *
 * **Pieces are sized by what the model writes back,** about
 * `PIECE_TARGET_OUTPUT_TOKENS` a call, so each call ends well inside its time
 * limit (the research model wrote 10 to 20 tokens a second; design.md, "S0.5
 * research results"). The tokens a line costs start as a guess and are
 * corrected from what each piece really used (`StructuredSpec.onUsage`). A
 * piece cut off at the output limit, or out of time, is split in half and read
 * again, up to `PIECE_MAX_SPLITS` times; past that the document fails naming
 * the lines that could not be read.
 *
 * **The header is read once,** in a call of its own, from the start and the
 * end of the document: the other party, date, reference, currency and stated
 * total. A document short enough for one piece is read in one call with the
 * whole schema, as any other reading is, and is split only if that call is
 * cut off.
 *
 * **Failover is per call** (C12): when a piece fails with one provider, the
 * next provider reads that piece only, and the pieces already read are kept.
 * A call out of time is tried on the next provider before the piece is split
 * (see `callAnyProvider`). The provider that answered last reads the next
 * piece first.
 *
 * **All or nothing** (FR-011): any failure fails the whole document, and
 * nothing is returned until every piece is read. Between pieces the caller is
 * asked whether the reading is still wanted (the job may have been deleted),
 * and is told how far the reading has got, for the queue to show.
 *
 * What comes back is a `DocumentReading` made by `readingFromEnvelope`, the
 * same as a reading in one call, with `notes.method` "ai_pieces"; a document
 * read whole in one call has "ai".
 */

import type { LanguageModel } from "ai";
import { DOCUMENT_ITEMS_MAX } from "$lib/import-reading.js";
import { createLogger } from "../logger.js";
import { createModel, type LLMProviderConfig } from "../llm/model-factory.js";
import {
  CallTimedOutError,
  OutputTruncatedError,
  SchemaRejectedError,
  callStructured,
  type CallUsage,
  type StructuredSpec,
} from "../llm/structured-call.js";
import {
  DOCUMENT_READ_TIMEOUT_MS,
  DocumentLimitError,
  buildItemsSystemPrompt,
  checkDocumentLength,
  checkItemCount,
  formatCount,
  formatDuration,
  readingFromEnvelope,
  tooManyItems,
  type DocumentReading,
  type DocumentReadingParams,
} from "./document-reader.js";
import {
  compileHeaderPart,
  compileLinesPart,
  compileProfile,
  type CompiledPart,
  type ReadEnvelope,
  type ReadEnvelopeHeader,
  type ReadEnvelopeLines,
  type ReadItem,
} from "./profile-compiler.js";
import {
  DOCUMENT_IS_DATA,
  JSON_ONLY,
  PROMPT_ROLE,
  customInstructionsBlock,
  wrapDocument,
} from "./providers/shared.js";

const log = createLogger("import:piece-reader");

/**
 * The most tokens one call may write. A piece is planned at about half of
 * this, so a piece that needs more than its share still fits; one that needs
 * more than this is split.
 */
export const PIECE_MAX_OUTPUT_TOKENS = 3_000;
/** About how much one piece is planned to write back. */
export const PIECE_TARGET_OUTPUT_TOKENS = 1_500;
/** How many lines a piece is shown either side of its own range. */
export const PIECE_CONTEXT_LINES = 15;
/** How many times a piece may be split in half before the document fails. */
export const PIECE_MAX_SPLITS = 3;

/** The limits of a reading in pieces. Tests pass smaller ones. */
export interface PieceReadLimits {
  /** The longest one call may take: under Bun's own 300 s fetch timeout. */
  timeoutMs: number;
  maxOutputTokens: number;
  targetOutputTokens: number;
  contextLines: number;
  maxSplits: number;
  /**
   * What one line is taken to cost before any piece has been read: about an
   * item's worth, as if every line were a transaction, so the first pieces
   * are not too big.
   */
  initialTokensPerLine: number;
  /**
   * The least one line is taken to cost, however little the pieces so far
   * wrote: a run of lines with no transactions on it says nothing about the
   * table that follows.
   */
  minTokensPerLine: number;
  /** The most lines one piece owns, whatever the estimate allows. */
  maxPieceLines: number;
  /**
   * The most lines of the first page, and of the last, the header call is
   * shown: the whole page, as a printed page rarely has more, but not the
   * whole of a spreadsheet, whose rows are all one page.
   */
  headerLines: number;
}

const DEFAULT_LIMITS: PieceReadLimits = {
  timeoutMs: DOCUMENT_READ_TIMEOUT_MS,
  maxOutputTokens: PIECE_MAX_OUTPUT_TOKENS,
  targetOutputTokens: PIECE_TARGET_OUTPUT_TOKENS,
  contextLines: PIECE_CONTEXT_LINES,
  maxSplits: PIECE_MAX_SPLITS,
  initialTokensPerLine: 40,
  minTokensPerLine: 10,
  maxPieceLines: 150,
  headerLines: 120,
};

/** How far a reading in pieces has got: `done` of `total` pieces read. */
export interface PieceProgress {
  done: number;
  /**
   * How many pieces the reading is expected to take. It can change while the
   * reading goes on: the size of a piece is corrected from what the pieces
   * before it wrote, and a piece that is split counts as two.
   */
  total: number;
}

export interface PieceReadOptions {
  intervalMs?: number;
  limits?: Partial<PieceReadLimits>;
  /**
   * Told how far the reading has got, before each piece is read (not before
   * the header, which is not a part) and once when every piece is. Not
   * called for a document read in one call.
   */
  onProgress?: (progress: PieceProgress) => void;
  /**
   * Asked before each call, and once more when every piece is read. When it
   * answers false (the job was deleted, or moved on), the reading stops with
   * `ReadingStoppedError` and makes no more calls.
   */
  stillWanted?: () => boolean;
  /**
   * Lines every piece is shown above its own context, by their number: a
   * spreadsheet's "Sheet:" line and its column-heading row (FR-069), so a
   * piece from far down a sheet still knows what each column holds. They
   * are never a piece's own lines, so nothing is read from them twice.
   */
  pinned?: readonly number[];
}

/**
 * The reading was stopped because it is no longer wanted (see
 * `PieceReadOptions.stillWanted`). Nothing was read in full, so nothing is
 * to be saved, and the job is not to be marked as failed either: it is gone,
 * or something else has it now.
 */
export class ReadingStoppedError extends Error {
  constructor() {
    super(
      "The reading was stopped because the document is no longer waiting to be read",
    );
    this.name = "ReadingStoppedError";
  }
}

// ── The document's lines ────────────────────────────────────────────────────

const NUMBERED_LINE = /^L(\d+)│/;
const PAGE_MARKER = /^--- page \d+ ---$/;

/**
 * The numbered text, line by line. Only a numbered line belongs to a piece;
 * the page markers between them are shown with the lines they head.
 */
interface DocumentLines {
  rows: string[];
  /** For each numbered line, in order: its row in `rows`. */
  lineRows: number[];
  /** For each numbered line, in order: its number (12 for `L0012`). */
  numbers: number[];
  /** For each numbered line, in order: which page it is on, from 0. */
  pages: number[];
  /** A line's place among the numbered lines, by its number. */
  indexOf: Map<number, number>;
}

function documentLines(text: string): DocumentLines {
  const rows = text.split("\n");
  const lineRows: number[] = [];
  const numbers: number[] = [];
  const pages: number[] = [];
  const indexOf = new Map<number, number>();
  let page = -1;
  rows.forEach((row, at) => {
    if (PAGE_MARKER.test(row)) {
      page++;
      return;
    }
    const match = NUMBERED_LINE.exec(row);
    if (!match) return;
    const number = Number(match[1]);
    if (!indexOf.has(number)) indexOf.set(number, lineRows.length);
    lineRows.push(at);
    numbers.push(number);
    pages.push(Math.max(page, 0));
  });
  return { rows, lineRows, numbers, pages, indexOf };
}

/** A line's number as the document text prints it, such as "L0012". */
function lineLabel(number: number): string {
  return `L${String(number).padStart(4, "0")}`;
}

/** A run of numbered lines, by their place: `start` to before `end`. */
interface LineRange {
  start: number;
  end: number;
}

/** "L0101 to L0140", the lines of a range as the prompt and errors name them. */
function rangeLabel(doc: DocumentLines, range: LineRange): string {
  const first = lineLabel(doc.numbers[range.start]);
  const last = lineLabel(doc.numbers[range.end - 1]);
  return first === last ? first : `${first} to ${last}`;
}

/**
 * The rows of the text from the row of line `from` to the row of line
 * `to - 1`, with any page markers between them.
 */
function rowsOf(doc: DocumentLines, from: number, to: number): string[] {
  if (from >= to) return [];
  return doc.rows.slice(doc.lineRows[from], doc.lineRows[to - 1] + 1);
}

/** The page marker above line `index`, or null when the text has none. */
function markerAbove(doc: DocumentLines, index: number): string | null {
  for (let row = doc.lineRows[index] - 1; row >= 0; row--) {
    if (PAGE_MARKER.test(doc.rows[row])) return doc.rows[row];
  }
  return null;
}

/** The lines a piece is shown: its own, and its context either side. */
function windowOf(
  doc: DocumentLines,
  owned: LineRange,
  contextLines: number,
): LineRange {
  return {
    start: Math.max(0, owned.start - contextLines),
    end: Math.min(doc.lineRows.length, owned.end + contextLines),
  };
}

const PART_STARTS = "--- part starts ---";
const PART_ENDS = "--- part ends ---";

/**
 * The text one piece is sent: the page its first line is on, the pinned
 * lines of that page above its window, its context before, its own lines
 * between two marks, and its context after.
 */
function pieceText(
  doc: DocumentLines,
  owned: LineRange,
  window: LineRange,
  pinned: readonly number[] = [],
): string {
  const out: string[] = [];
  const marker = markerAbove(doc, window.start);
  if (marker) out.push(marker);
  for (const number of pinned) {
    const index = doc.indexOf.get(number);
    if (
      index !== undefined &&
      index < window.start &&
      doc.pages[index] === doc.pages[window.start]
    ) {
      out.push(doc.rows[doc.lineRows[index]]);
    }
  }
  if (window.start < owned.start) {
    out.push(
      ...doc.rows.slice(doc.lineRows[window.start], doc.lineRows[owned.start]),
    );
  }
  out.push(PART_STARTS, ...rowsOf(doc, owned.start, owned.end), PART_ENDS);
  if (window.end > owned.end) {
    out.push(
      ...doc.rows.slice(
        doc.lineRows[owned.end - 1] + 1,
        doc.lineRows[window.end - 1] + 1,
      ),
    );
  }
  return out.join("\n");
}

/**
 * The start and the end of the document, for the header call: the first
 * lines of the first page and the last lines of the last page. The lines left
 * out between them are named by one mark.
 */
function headerText(doc: DocumentLines, headerLines: number): string {
  const count = doc.lineRows.length;
  let firstEnd = 0;
  while (
    firstEnd < count &&
    firstEnd < headerLines &&
    doc.pages[firstEnd] === doc.pages[0]
  ) {
    firstEnd++;
  }
  let lastStart = count;
  while (
    lastStart > firstEnd &&
    count - lastStart < headerLines &&
    doc.pages[lastStart - 1] === doc.pages[count - 1]
  ) {
    lastStart--;
  }

  const out: string[] = [];
  const marker = markerAbove(doc, 0);
  if (marker) out.push(marker);
  if (lastStart === firstEnd) {
    out.push(...rowsOf(doc, 0, count));
    return out.join("\n");
  }
  out.push(...rowsOf(doc, 0, firstEnd));
  out.push(
    `--- lines ${rangeLabel(doc, { start: firstEnd, end: lastStart })} are not shown ---`,
  );
  const lastMarker = markerAbove(doc, lastStart);
  if (lastMarker && doc.pages[lastStart] !== doc.pages[firstEnd - 1]) {
    out.push(lastMarker);
  }
  out.push(...rowsOf(doc, lastStart, count));
  return out.join("\n");
}

// ── Prompts ─────────────────────────────────────────────────────────────────

/** The rules added to the profile's own for one piece's lines. */
const PIECE_RULES = `- This document is long, so it is read in parts, and you are given one part. The prompt names the
  lines that are this part's own, for example L0101 to L0140. List only lines in that range.
- The lines before the mark ${PART_STARTS} and after the mark ${PART_ENDS} are shown only so that
  a row near the edge of the part can be read whole. Never list an amount printed on one of them,
  and never add one of them to ignored: the part they belong to reads them.
- Give every entry the source_line its amount is printed on.
- The document's header and its total are read separately, so this answer has no header.`;

/** The instructions for the header call. */
function headerSystemPrompt(
  compiled: CompiledPart<ReadEnvelopeHeader>,
  params: DocumentReadingParams,
): string {
  const guidance =
    params.profile.guidance === undefined
      ? params.customInstructions
      : params.profile.guidance;
  return `${PROMPT_ROLE}

${DOCUMENT_IS_DATA}
The system starts each line of the document with its number, such as L0001│, and each page with a
line such as --- page 2 ---. These marks are not printed on the document.

Instructions:
- This document is long, so it is read in parts. You are shown only its start and its end; a mark
  such as --- lines L0121 to L0940 are not shown --- stands for the lines between them.
- Read only the document's header: its other party, date, reference and currency, and the printed
  total the schema describes. The document's lines are read separately.
- Copy the total exactly as printed, with its sign. Never add up, subtract or work out a figure
  yourself. Null when the lines shown do not print it.
${customInstructionsBlock(guidance)}
The JSON must match this JSON Schema, and its descriptions say what each field holds:
${JSON.stringify(compiled.wire)}

${JSON_ONLY}`;
}

/** The prompt one piece is sent: which lines are its own, then the text. */
function piecePrompt(
  doc: DocumentLines,
  owned: LineRange,
  window: LineRange,
  pinned: readonly number[],
): string {
  return `This part's own lines are ${rangeLabel(doc, owned)}.

${wrapDocument(pieceText(doc, owned, window, pinned))}`;
}

// ── Calls ───────────────────────────────────────────────────────────────────

/** The providers of one reading, and the order the next call tries them. */
interface Callers {
  order: LLMProviderConfig[];
  models: Map<LLMProviderConfig, LanguageModel>;
  intervalMs: number;
}

function isSizeError(
  error: unknown,
): error is OutputTruncatedError | CallTimedOutError {
  return (
    error instanceof OutputTruncatedError || error instanceof CallTimedOutError
  );
}

/**
 * Makes one call, trying each provider in turn until one answers (C12).
 *
 * A call out of time is tried on the next provider, because a provider that
 * hangs looks the same as a piece that is too big; only when no provider
 * answers is the piece split. A call cut off at the output limit is tried on
 * the next provider too, unless `splittable`: every provider writes to the
 * same limit, so a piece of lines that one provider could not finish is split
 * at once rather than read again in full.
 *
 * When every provider fails, a limit any of them ran into is thrown first,
 * the output limit before the time limit, so the caller can split the piece
 * (or, for the header, name the limit). Then a refused required schema
 * (FR-037), since that is the reason the user can act on; otherwise an error
 * naming `what` and the last provider's reason.
 */
async function callAnyProvider<T>(
  spec: StructuredSpec<T>,
  callers: Callers,
  what: string | null,
  splittable: boolean,
): Promise<T> {
  let lastError: unknown;
  let rejected: SchemaRejectedError | null = null;
  let truncated: OutputTruncatedError | null = null;
  let timedOut: CallTimedOutError | null = null;
  for (const provider of [...callers.order]) {
    let model = callers.models.get(provider);
    if (!model) {
      model = createModel(provider);
      callers.models.set(provider, model);
    }
    try {
      const value = await callStructured(
        model,
        provider,
        spec,
        callers.intervalMs,
      );
      if (callers.order[0] !== provider) {
        callers.order = [
          provider,
          ...callers.order.filter((other) => other !== provider),
        ];
      }
      return value;
    } catch (error) {
      if (error instanceof OutputTruncatedError) {
        if (splittable) throw error;
        truncated ??= error;
      }
      if (error instanceof CallTimedOutError) timedOut ??= error;
      if (error instanceof SchemaRejectedError) rejected ??= error;
      lastError = error;
      log.warn(
        {
          provider: provider.name,
          type: provider.type,
          model: provider.model,
          schemaId: spec.schemaId,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorType: error instanceof Error ? error.name : typeof error,
        },
        "Provider failed for this call, trying the next",
      );
    }
  }
  if (truncated) throw truncated;
  if (timedOut) throw timedOut;
  if (rejected) throw rejected;
  const reason =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    what ? `Reading ${what} failed with every AI provider: ${reason}` : reason,
    { cause: lastError },
  );
}

/**
 * The size of the next piece, from what the pieces so far wrote back. A
 * piece that was cut off counts as having written the whole output limit, so
 * the pieces after it are smaller; it is one figure among the others, not a
 * floor, so a run of dense lines (or a model that repeated itself) does not
 * keep the pieces small for the rest of the document once later pieces write
 * less.
 */
class PieceSizer {
  private written = 0;
  private lines = 0;

  constructor(private readonly limits: PieceReadLimits) {}

  private tokensPerLine(): number {
    const seen =
      this.lines > 0
        ? this.written / this.lines
        : this.limits.initialTokensPerLine;
    return Math.max(this.limits.minTokensPerLine, seen);
  }

  /** How many lines the next piece owns. */
  pieceLines(): number {
    const lines = Math.floor(
      this.limits.targetOutputTokens / this.tokensPerLine(),
    );
    return Math.min(this.limits.maxPieceLines, Math.max(1, lines));
  }

  /** A piece of `lines` lines was read, and wrote `usage`. */
  read(lines: number, usage: CallUsage | undefined): void {
    const written = usage?.outputTokens;
    if (written == null || !Number.isFinite(written) || written < 0) return;
    this.written += written;
    this.lines += lines;
  }

  /** A piece of `lines` lines was cut off, or ran out of time. */
  cutOff(lines: number): void {
    this.written += this.limits.maxOutputTokens;
    this.lines += Math.max(1, lines);
  }
}

// ── Merging ─────────────────────────────────────────────────────────────────

/** One piece as it was read. */
interface ReadPiece {
  owned: LineRange;
  window: LineRange;
  lines: ReadEnvelopeLines;
}

/** What the reviewer is told about an item the merge is unsure of (FR-065). */
export const PIECE_NOTES = {
  noLine:
    "The AI did not say which line of the document this item is printed on, so it could not be checked against the part of the document it was read from. Check it against the document.",
  outside: (line: number) =>
    `The AI said this item is printed on line ${line}, which was not among the lines it was shown. Check it against the document.`,
  context: (line: number) =>
    `This item was read from line ${line}, near the edge of a part of the document, and the part that line belongs to did not list it. Check it against the document, so it is neither missed nor counted twice.`,
} as const;

/**
 * The items of every piece, each kept once (see the file's comment), in the
 * document's order, and the lines the pieces left out.
 */
function mergePieces(
  doc: DocumentLines,
  pieces: readonly ReadPiece[],
  sectionKeys: readonly string[],
): ReadEnvelopeLines {
  type Kept = {
    section: string;
    item: ReadItem;
    order: number;
    /** The line, when it was read from another piece's context. */
    fromContext: number | null;
  };
  const kept: Kept[] = [];
  // The lines a piece listed an item on, from its own range.
  const listedByOwner = new Set<number>();
  // For each line read from context: the piece whose copy is kept. A piece
  // that owns only a few lines leaves a line in the context of two pieces,
  // and both copies are the same row.
  const contextReader = new Map<number, number>();
  const ignored: string[] = [];

  for (const [index, piece] of pieces.entries()) {
    for (const section of sectionKeys) {
      for (const item of piece.lines.sections[section] ?? []) {
        const line = item.source_line;
        const at = line != null ? doc.indexOf.get(line) : undefined;
        if (line == null || at === undefined) {
          kept.push({
            section,
            item: flagged(
              item,
              line == null ? PIECE_NOTES.noLine : PIECE_NOTES.outside(line),
            ),
            order: piece.owned.start,
            fromContext: null,
          });
        } else if (at < piece.window.start || at >= piece.window.end) {
          kept.push({
            section,
            item: flagged(item, PIECE_NOTES.outside(line)),
            order: at,
            fromContext: null,
          });
        } else if (at >= piece.owned.start && at < piece.owned.end) {
          listedByOwner.add(at);
          kept.push({ section, item, order: at, fromContext: null });
        } else {
          const reader = contextReader.get(at) ?? index;
          if (reader !== index) continue;
          contextReader.set(at, index);
          kept.push({ section, item, order: at, fromContext: at });
        }
      }
    }
    ignored.push(...piece.lines.ignored);
  }

  const sections: Record<string, ReadItem[]> = Object.fromEntries(
    sectionKeys.map((key) => [key, []]),
  );
  // A sort keeps equal keys in the order they came, so identical rows on one
  // line, or items with no line, keep the model's order.
  for (const entry of [...kept].sort((a, b) => a.order - b.order)) {
    if (entry.fromContext !== null) {
      // The owning piece read this line and listed it: this is the same row.
      if (listedByOwner.has(entry.fromContext)) continue;
      entry.item = flagged(
        entry.item,
        PIECE_NOTES.context(doc.numbers[entry.fromContext]),
      );
    }
    sections[entry.section].push(entry.item);
  }
  return { sections, ignored };
}

function flagged(item: ReadItem, note: string): ReadItem {
  return { ...item, review_note: note };
}

// ── Reading ─────────────────────────────────────────────────────────────────

/** A piece to read, and how many times it has been split to get here. */
interface PlannedPiece extends LineRange {
  splits: number;
}

/**
 * Reads the document with the profile in pieces, or in one call when it is
 * short, and returns its items, or throws. A document over a limit throws
 * `DocumentLimitError`; a provider's refusal of the profile's schema throws
 * `SchemaRejectedError`; a reading no longer wanted throws
 * `ReadingStoppedError`.
 */
export async function readInPieces(
  params: DocumentReadingParams,
  providers: LLMProviderConfig[],
  options: PieceReadOptions = {},
): Promise<DocumentReading> {
  const { profile } = params;
  const read = await readEnvelopeInPieces(params, providers, options);
  const reading = readingFromEnvelope(read.envelope, profile, {
    today: params.today ?? new Date().toISOString().slice(0, 10),
    mainCurrency: params.mainCurrency,
    schemaId: profile.schemaId,
  });
  // Marked as read by the AI in one call, so the reference check of FR-063
  // applies to it as it does to a reading in pieces: in Every transaction
  // mode each item carries only its own reference.
  if (read.method === "ai") {
    return { ...reading, notes: { ...reading.notes, method: "ai" } };
  }
  const ignoredCount = piecesIgnoredCount(read.envelope, reading.items.length);
  log.debug(
    {
      schemaId: reading.schemaId,
      items: reading.items.length,
      ignoredCount,
      controlTotal: reading.controlTotal,
    },
    "Document read in pieces",
  );
  return {
    ...reading,
    notes: { ...reading.notes, ignoredCount, method: "ai_pieces" },
  };
}

/**
 * Every line a reading in pieces left out, not only the sample `ignored`
 * keeps: those the pieces listed as ignored, and those of a section that the
 * reading's own rules left out (an amount of zero, say). A line a model
 * listed as ignored from its context, against its rules, counts twice; the
 * count is a guide for the reviewer, as the list is (FR-012).
 */
export function piecesIgnoredCount(
  envelope: Pick<ReadEnvelope, "sections" | "ignored">,
  itemCount: number,
): number {
  const listed = Object.values(envelope.sections).reduce(
    (sum, items) => sum + items.length,
    0,
  );
  return (
    envelope.ignored.filter((line) => line.trim() !== "").length +
    listed -
    itemCount
  );
}

/**
 * Reads the document as `readInPieces` does, and returns the model's answer
 * with the pieces joined, before any item is made: `method` says whether it
 * took one call or pieces. The part of a spreadsheet the AI reads beside its
 * table is read this way, and joined with the table's rows (FR-057).
 */
export async function readEnvelopeInPieces(
  params: DocumentReadingParams,
  providers: LLMProviderConfig[],
  options: PieceReadOptions = {},
): Promise<{ envelope: ReadEnvelope; method: "ai" | "ai_pieces" }> {
  const limits: PieceReadLimits = { ...DEFAULT_LIMITS, ...options.limits };
  if (providers.length === 0) throw new Error("No LLM provider is configured");
  checkDocumentLength(params.text);

  const { profile } = params;
  const doc = documentLines(params.text);
  // In order, so they are shown as the document has them.
  const pinned = [...(options.pinned ?? [])].sort((a, b) => a - b);
  const lineCount = doc.lineRows.length;
  const callers: Callers = {
    order: [...providers],
    models: new Map(),
    intervalMs: options.intervalMs ?? 0,
  };
  const sizer = new PieceSizer(limits);
  const wanted = () => {
    if (options.stillWanted && !options.stillWanted()) {
      throw new ReadingStoppedError();
    }
  };
  const callLimits = {
    maxOutputTokens: limits.maxOutputTokens,
    timeoutMs: limits.timeoutMs,
    schemaRequired: profile.schemaRequired ?? false,
  };

  let pending: PlannedPiece[] = [];
  let planned = 0;

  // A document that fits one piece is read whole, in one call, as any
  // reading is. Only when that call is cut off is it read in pieces.
  if (lineCount <= sizer.pieceLines()) {
    wanted();
    const compiled = compileProfile(profile);
    try {
      const envelope = await callAnyProvider<ReadEnvelope>(
        {
          schemaId: compiled.schemaId,
          schema: compiled.schema,
          parse: compiled.parse,
          instructions: buildItemsSystemPrompt(compiled, params),
          prompt: wrapDocument(params.text),
          ...callLimits,
        },
        callers,
        null,
        true,
      );
      checkItemCount(envelope, profile);
      return { envelope, method: "ai" };
    } catch (error) {
      if (!isSizeError(error)) throw error;
      if (lineCount <= 1 || limits.maxSplits < 1) {
        throw sizeLimitError(doc, { start: 0, end: lineCount }, error, limits);
      }
      sizer.cutOff(lineCount);
      const middle = Math.ceil(lineCount / 2);
      pending = [
        { start: 0, end: middle, splits: 1 },
        { start: middle, end: lineCount, splits: 1 },
      ];
      planned = lineCount;
      log.info(
        { lines: lineCount, reason: error.name },
        "Reading in one call was cut off; reading in pieces",
      );
    }
  }

  const pieces: ReadPiece[] = [];
  /** Before a piece is read: the pieces read, and how many there will be. */
  const progress = () => {
    const unplanned = lineCount - planned;
    const total =
      pieces.length +
      1 +
      pending.length +
      Math.ceil(unplanned / sizer.pieceLines());
    options.onProgress?.({ done: pieces.length, total });
  };

  // The header, once, from the start and the end of the document. It is not
  // a part, so no progress is told until the first piece.
  wanted();
  const headerPart = compileHeaderPart(profile);
  let header: ReadEnvelopeHeader;
  try {
    header = await callAnyProvider(
      {
        schemaId: headerPart.schemaId,
        schema: headerPart.schema,
        parse: headerPart.parse,
        instructions: headerSystemPrompt(headerPart, params),
        prompt: wrapDocument(headerText(doc, limits.headerLines)),
        ...callLimits,
      },
      callers,
      "the document's header",
      false,
    );
  } catch (error) {
    if (isSizeError(error)) throw headerLimitError(error, limits);
    throw error;
  }

  const linesPart = compileLinesPart(profile);
  const instructions = buildItemsSystemPrompt(linesPart, {
    ...params,
    profile: {
      ...profile,
      instructions: `${profile.instructions}\n${PIECE_RULES}`,
    },
  });
  let ownedItems = 0;

  while (pending.length > 0 || planned < lineCount) {
    let piece = pending.shift();
    if (!piece) {
      const end = Math.min(lineCount, planned + sizer.pieceLines());
      piece = { start: planned, end, splits: 0 };
      planned = end;
    }
    wanted();
    progress();

    const window = windowOf(doc, piece, limits.contextLines);
    let usage: CallUsage | undefined;
    try {
      const lines = await callAnyProvider<ReadEnvelopeLines>(
        {
          schemaId: linesPart.schemaId,
          schema: linesPart.schema,
          parse: linesPart.parse,
          instructions,
          prompt: piecePrompt(doc, piece, window, pinned),
          ...callLimits,
          onUsage: (reported) => {
            usage = reported;
          },
        },
        callers,
        `lines ${rangeLabel(doc, piece)}`,
        true,
      );
      const size = piece.end - piece.start;
      sizer.read(size, usage);
      pieces.push({
        owned: { start: piece.start, end: piece.end },
        window,
        lines,
      });
      log.debug(
        {
          lines: rangeLabel(doc, piece),
          outputTokens: usage?.outputTokens,
          next: sizer.pieceLines(),
        },
        "Piece read",
      );

      // An item from a piece's own lines is never dropped, so once these
      // alone are over the limit the document fails without reading on.
      ownedItems += countOwned(doc, lines, piece);
      if (ownedItems > DOCUMENT_ITEMS_MAX) throw tooManyItems(ownedItems);
    } catch (error) {
      if (!isSizeError(error)) throw error;
      const size = piece.end - piece.start;
      if (piece.splits >= limits.maxSplits || size <= 1) {
        throw sizeLimitError(doc, piece, error, limits);
      }
      sizer.cutOff(size);
      const middle = piece.start + Math.ceil(size / 2);
      pending.unshift(
        { start: piece.start, end: middle, splits: piece.splits + 1 },
        { start: middle, end: piece.end, splits: piece.splits + 1 },
      );
      log.info(
        { lines: rangeLabel(doc, piece), reason: error.name },
        "Piece was cut off; splitting it in half",
      );
    }
  }
  wanted();
  options.onProgress?.({ done: pieces.length, total: pieces.length });

  const merged = mergePieces(
    doc,
    pieces,
    profile.sections.map((section) => section.key),
  );
  checkItemCount(merged, profile);
  log.debug({ pieces: pieces.length }, "Pieces read");
  return {
    envelope: {
      header: header.header,
      stated_total: header.stated_total,
      sections: merged.sections,
      ignored: merged.ignored,
    },
    method: "ai_pieces",
  };
}

/** How many of a piece's items are on its own lines. */
function countOwned(
  doc: DocumentLines,
  lines: ReadEnvelopeLines,
  owned: LineRange,
): number {
  let count = 0;
  for (const items of Object.values(lines.sections)) {
    for (const item of items ?? []) {
      const at =
        item.source_line != null
          ? doc.indexOf.get(item.source_line)
          : undefined;
      if (at !== undefined && at >= owned.start && at < owned.end) count++;
    }
  }
  return count;
}

/** The lines of a piece could not be read even when split (FR-043). */
function sizeLimitError(
  doc: DocumentLines,
  range: LineRange,
  error: OutputTruncatedError | CallTimedOutError,
  limits: PieceReadLimits,
): DocumentLimitError {
  const lines = range.end - range.start;
  const which =
    lines === 0
      ? "This document"
      : `${lines === 1 ? "Line" : "Lines"} ${rangeLabel(doc, range)}`;
  const at = `${formatCount(lines)} line${lines === 1 ? "" : "s"} at a time`;
  if (error instanceof CallTimedOutError) {
    return new DocumentLimitError(
      "time",
      `${which} could not be read: reading ${lines > 1 ? "them" : "it"} took longer than the limit of ${formatDuration(limits.timeoutMs)} for one reading, even ${at}.`,
      { cause: error },
    );
  }
  return new DocumentLimitError(
    "output",
    `${which} could not be read: the AI model's answer reached its output length limit of ${formatCount(limits.maxOutputTokens)} tokens, even ${at}.`,
    { cause: error },
  );
}

/** The header call was cut off or ran out of time; it cannot be split. */
function headerLimitError(
  error: OutputTruncatedError | CallTimedOutError,
  limits: PieceReadLimits,
): DocumentLimitError {
  if (error instanceof CallTimedOutError) {
    return new DocumentLimitError(
      "time",
      `This document's header could not be read: reading it took longer than the limit of ${formatDuration(limits.timeoutMs)} for one reading.`,
      { cause: error },
    );
  }
  return new DocumentLimitError(
    "output",
    `This document's header could not be read: the AI model's answer reached its output length limit of ${formatCount(limits.maxOutputTokens)} tokens.`,
    { cause: error },
  );
}
