/**
 * Reads one queued document and leaves it ready for review, or failed with a
 * reason.
 *
 * A document is read one of two ways, by what the uploader chose under "Read
 * as" (006 FR-001):
 *
 * - **As a receipt or invoice** (the standard reading, and Auto-detect while
 *   no profile exists): one record, on the queue row itself, exactly as every
 *   document was read before 006 (FR-003, FR-004).
 * - **As a document with several items**: one proposed record per item. One
 *   item is reviewed as a receipt, on the queue row (FR-009). Several become a
 *   group: the items go into `import_items` and the queue row is marked
 *   Grouped. No item is saved unless all of them are (FR-011).
 * - **With an import profile** the user saved (006 US6-7): read the same way
 *   as several items, with the profile's sections, fee types and instructions
 *   in place of the built-in ones. A copy of the profile is kept on the row,
 *   so a later edit or delete never changes what was read (FR-038).
 * - **Auto-detect** (006 US9): with no enabled profile, the receipt reading
 *   above, unchanged. Otherwise `profile-detect.ts` decides first, and the
 *   document is read with the profile it found or as a receipt (FR-039,
 *   FR-040). The row keeps "auto" as what the uploader chose; `read_how`,
 *   `profile_id` and the copy of the profile say how it was read.
 * - **From its columns** (006 FR-055): a spreadsheet read with a profile whose
 *   sections in the chosen mode all have row rules is read by code
 *   (`table-reader.ts`), with no AI call. It needs no AI provider, so the check
 *   for one is made only where the AI is asked.
 * - **In pieces** (006 FR-043): a profile reading in Every transaction mode
 *   that the AI reads, from a PDF or a spreadsheet with no row rules, is read
 *   a run of lines at a time (`piece-reader.ts`). The queue row counts the
 *   pieces in `progress_done` / `progress_total` while it is read.
 *
 * The worker calls this with the app's database and storage folder; the tests
 * call it with their own, so nothing here reaches for either.
 */

import { randomUUID } from "crypto";
import { and, eq, ne } from "drizzle-orm";
import { readFileSync } from "fs";
import { join } from "path";
import {
  DocumentType,
  ImportState,
  documentTypeEnum,
  isTransferType,
  type ImportStateCode,
} from "$lib/enums.js";
import { readsFromColumns } from "$lib/import-profile-schema.js";
import {
  ImportMode,
  ImportReadAs,
  ImportReadHow,
  isImportMode,
  serializeExtractionNotes,
  type ImportModeValue,
} from "$lib/import-reading.js";
import { importItems, importQueue, users } from "../db/schema.js";
import {
  CSV_MIME_TYPE,
  extractDocumentSource,
  extractNumberedText,
  extractPlainAndNumberedText,
  extractText,
  inferMimeType,
  isEmptyWorkbook,
  isSpreadsheetMimeType,
  keepsReadText,
  numberDocumentLines,
  spreadsheetText,
  stripLineNumbers,
  type DocumentSource,
} from "../extraction/document-text.js";
import { readCsv } from "../extraction/spreadsheet/csv.js";
import { detectionText } from "../extraction/spreadsheet/render.js";
import type { Workbook } from "../extraction/spreadsheet/types.js";
import type { LedgerDb } from "../ledger/types.js";
import { getEnabledProviders, insertProvider } from "../llmProviders.js";
import { createLogger } from "../logger.js";
import {
  deletedProfileName,
  getImportProfile,
  listImportProfiles,
  savedProfileIdOf,
  type ImportProfileView,
} from "../services/import-profiles.js";
import { SchemaRejectedError } from "../llm/structured-call.js";
import { getSetting, SETTING_KEYS } from "../settings.js";
import {
  buildReviewFields,
  createReviewContext,
  type ReviewContext,
} from "./build-review-fields.js";
import {
  DocumentLimitError,
  readDocumentItems,
  type DocumentItem,
  type DocumentReading,
} from "./document-reader.js";
import { emitItemUpdates, emitJobUpdate } from "./group-state.js";
import { callLLMWithProviders } from "./llm.js";
import { detectProfile, phraseMatch } from "./profile-detect.js";
import { RECEIPT_TEXT_LIMIT } from "./providers/shared.js";
import { alreadyImported } from "./repeat-file.js";
import { sameMoneyNotes } from "./same-money.js";
import {
  detectTransferDuplicates,
  type TransferProbe,
} from "./transfer-duplicates.js";
import type { LLMCallParams } from "./providers/types.js";
import {
  ReadingStoppedError,
  readInPieces,
  type PieceProgress,
} from "./piece-reader.js";
import {
  ProfileModeError,
  SEVERAL_ITEMS_PROFILE,
  savedReadingProfile,
  type ReadingProfile,
} from "./profile-compiler.js";
import {
  parseProfileSnapshot,
  profileSnapshotOf,
  serializeProfileSnapshot,
} from "./profile-snapshot.js";
import type { ReviewFields } from "./review-fields.js";
import {
  TableReadError,
  columnsReadingId,
  layoutMatches,
  readFromColumns,
  type TableProfile,
} from "./table-reader.js";

const log = createLogger("import:worker");

type ImportJob = typeof importQueue.$inferSelect;
type ImportItemInsert = typeof importItems.$inferInsert;

export interface ProcessJobOptions {
  /** The folder the job's `temp_file_path` is relative to. */
  storageRoot: string;
}

/** The message a document with nothing to import fails with (FR-009). */
export const NO_ITEMS_FOUND = "No items found";

/** The message a reading that needs the AI fails with when none is set up. */
export const NO_PROVIDERS =
  "No LLM providers configured. Go to Settings → Intelligence to add one.";

/**
 * Items are inserted this many at a time, so a document of a thousand items
 * stays well inside SQLite's limit on values in one statement. All of them are
 * still in one transaction.
 */
const ITEM_INSERT_CHUNK = 100;

type ReadingPath = "receipt" | "items" | "profile" | "auto";

/**
 * How this job is read. The several-items choice and a saved profile read
 * items; Auto-detect decides once the text is read; a row from before 006 has
 * no choice stored and is a receipt, as it was when uploaded.
 */
function readingPath(job: ImportJob): ReadingPath {
  if (job.readAs === ImportReadAs.SeveralItems) return "items";
  if (job.readAs === ImportReadAs.Profile) return "profile";
  if (job.readAs === ImportReadAs.Auto) return "auto";
  return "receipt";
}

/** What a document read as items is read with. */
interface ItemsReading {
  profile: ReadingProfile;
  /** What the row's `profile_id` holds once it is read. */
  profileId: string;
  /** The saved profile's name; absent for the built-in reading. */
  profileName?: string;
  /**
   * Set when the document is a spreadsheet to be read from its columns, with
   * no AI (FR-055): the profile's layout and sections, and the mode.
   */
  columns?: { table: TableProfile; mode: ImportModeValue };
  /**
   * The import mode a saved profile reads in; absent for the built-in
   * reading. An Every transaction reading by the AI is read in pieces
   * (FR-043).
   */
  mode?: ImportModeValue;
}

/**
 * A reading's progress, cleared once it ends either way, so a later reading
 * of the same job never starts out showing the last one's count.
 */
const NO_PROGRESS = { progressDone: null, progressTotal: null } as const;

function markFailed(
  db: LedgerDb,
  jobId: string,
  userId: number,
  error: string,
) {
  log.error({ jobId, error }, "Job failed");
  db.update(importQueue)
    .set({ state: ImportState.Failed, error, ...NO_PROGRESS })
    .where(eq(importQueue.id, jobId))
    .run();
  emitJobUpdate(db, jobId, userId);
}

function setState(
  db: LedgerDb,
  jobId: string,
  userId: number,
  state: ImportStateCode,
) {
  // A job starting a stage has read no parts yet, whatever an earlier
  // reading of it left behind.
  db.update(importQueue)
    .set({ state, ...NO_PROGRESS })
    .where(eq(importQueue.id, jobId))
    .run();
  emitJobUpdate(db, jobId, userId);
}

/** Enabled providers; moves the old single OpenRouter setting over on first use. */
function loadProviders(db: LedgerDb) {
  let providers = getEnabledProviders(db);
  if (!providers.length) {
    const legacyKey = getSetting(db, SETTING_KEYS.autoImportApiKey);
    if (legacyKey) {
      const legacyModel =
        getSetting(db, SETTING_KEYS.autoImportModel) ??
        "anthropic/claude-3.5-sonnet";
      insertProvider(db, {
        type: "openrouter",
        name: "OpenRouter",
        apiKey: legacyKey,
        model: legacyModel,
      });
      providers = getEnabledProviders(db);
      log.info("Migrated legacy OpenRouter settings to llm_providers table");
    }
  }
  return providers;
}

// Stopped before reading when the same file already made a record (FR-026).
// The rule lives with the confirm's own check of it (FR-064).
export { alreadyImported };

/**
 * One form of a document's text, and how to get it: from the text a caller
 * gave with the upload, or from the file.
 */
interface TextForm<T> {
  given: (text: string) => T;
  /** From a PDF or a photo. */
  extract: (absPath: string, mimeType: string) => Promise<T>;
  /** From a spreadsheet, whose text comes in every form at once (FR-051). */
  fromSource: (source: DocumentSource) => T;
  /** What the document itself prints, to check there is enough of it. */
  printed: (text: T) => string;
}

/** One run of text, as the receipt reading has always sent it (FR-004). */
const PLAIN_TEXT: TextForm<string> = {
  given: (text) => text,
  extract: extractText,
  fromSource: (source) => source.plain,
  printed: (text) => text,
};

/**
 * Numbered lines, for a reading of items. Numbered text always has its page
 * markers, so what counts is what the document itself prints.
 */
const NUMBERED_TEXT: TextForm<string> = {
  given: (text) => numberDocumentLines([text]),
  extract: extractNumberedText,
  fromSource: (source) => source.numbered,
  printed: (text) => stripLineNumbers(text).trim(),
};

/**
 * Every form at once: both texts, and a spreadsheet's cells. For Auto-detect,
 * which knows which one it needs only after detection, and for a reading from
 * columns, which needs the cells and the numbered text both. Taken in one
 * pass, so an image is read by OCR once and a workbook unpacked once.
 */
const SOURCE_TEXTS: TextForm<DocumentSource> = {
  given: (text) => ({ plain: text, numbered: numberDocumentLines([text]) }),
  extract: extractPlainAndNumberedText,
  fromSource: (source) => source,
  printed: (texts) => texts.plain,
};

/** The message a spreadsheet with nothing in its cells fails with. */
export const EMPTY_SPREADSHEET =
  "This spreadsheet is empty: none of its sheets has anything in its cells.";

/** Whether the job's file is an Excel workbook or a CSV file (FR-050). */
function isSpreadsheetJob(job: Pick<ImportJob, "originalFilename">): boolean {
  return isSpreadsheetMimeType(inferMimeType(job.originalFilename));
}

/**
 * The document's text, in the form the reading needs. Null when the job has
 * already been failed.
 */
async function documentText<T>(
  db: LedgerDb,
  job: ImportJob,
  userId: number,
  form: TextForm<T>,
  storageRoot: string,
): Promise<T | null> {
  let text: T;
  let extracted = false;
  const kept = keptText(job);
  if (job.preExtractedText && job.preExtractedText.trim().length > 0) {
    // Caller already ran its own OCR/extraction — skip server-side extraction entirely.
    text = form.given(job.preExtractedText.trim());
    log.debug(
      { jobId: job.id, textLength: form.printed(text).length },
      "Using caller-provided text (OCR bypassed)",
    );
  } else if (kept !== null) {
    // OCR already read this image, for an earlier reading of this job: it is
    // being read again, or the server restarted while it was read.
    text = form.given(kept);
    log.debug(
      { jobId: job.id, textLength: form.printed(text).length },
      "Using the text read from this image before (OCR not repeated)",
    );
  } else {
    extracted = true;
    setState(db, job.id, userId, ImportState.Extracting);

    const absPath = join(storageRoot, job.tempFilePath);
    const mimeType = inferMimeType(job.originalFilename);
    try {
      if (isSpreadsheetMimeType(mimeType)) {
        // Read cell by cell and turned into text (FR-051). A workbook that
        // cannot be read fails here with its reason, such as a password.
        const source = await extractDocumentSource(absPath, mimeType);
        if (source.workbook && isEmptyWorkbook(source.workbook)) {
          markFailed(db, job.id, userId, EMPTY_SPREADSHEET);
          return null;
        }
        text = form.fromSource(source);
      } else {
        text = await form.extract(absPath, mimeType);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ jobId: job.id, err }, "Text extraction failed");
      markFailed(db, job.id, userId, msg);
      return null;
    }
  }

  const printed = form.printed(text);
  if (!printed || printed.length < 10) {
    log.warn(
      { jobId: job.id, textLength: printed?.length ?? 0 },
      "Insufficient text extracted",
    );
    markFailed(
      db,
      job.id,
      userId,
      "Couldn't read enough text from this file. Try a clearer image or a text PDF.",
    );
    return null;
  }

  // An image's text is kept as soon as OCR has read it, so a reading that
  // fails after this, or is read again, never runs OCR on it twice.
  if (extracted && keepsReadText(job.originalFilename)) {
    db.update(importQueue)
      .set({ extractedText: printed })
      .where(eq(importQueue.id, job.id))
      .run();
  }

  log.debug(
    {
      jobId: job.id,
      textLength: printed.length,
      preview: printed.slice(0, 200),
    },
    "Text extracted",
  );
  return text;
}

/**
 * The text OCR read from this job's image at an earlier reading, or null.
 * Only an image's is used again; see `keepsReadText`.
 */
function keptText(job: ImportJob): string | null {
  if (!keepsReadText(job.originalFilename)) return null;
  const text = job.extractedText?.trim();
  return text ? text : null;
}

/** Reads a job and leaves it for review, grouped, or failed. */
export async function processImportJob(
  db: LedgerDb,
  job: ImportJob,
  options: ProcessJobOptions,
): Promise<void> {
  // The uploader (for event routing / audit). Settings are global.
  const ownerUser = db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, job.createdBy))
    .get();
  const userId = ownerUser?.id ?? job.createdBy;
  let path = readingPath(job);

  // Auto-detect with no enabled profile is the receipt reading, with no
  // detection step and no extra AI call (FR-003, US9 AS3).
  let candidates: ImportProfileView[] = [];
  if (path === "auto") {
    candidates = listImportProfiles(db, { enabledOnly: true });
    if (candidates.length === 0) {
      clearDetectedProfile(db, job);
      path = "receipt";
    }
  }

  // A file already imported is stopped before it is read with items or a
  // profile (FR-026). Auto-detect checks this once it has found a profile:
  // read the standard way, it is a receipt, and a receipt is never stopped.
  if (path === "items" || path === "profile") {
    const stop = alreadyImported(db, job);
    if (stop) {
      markFailed(db, job.id, userId, stop);
      return;
    }
  }

  let itemsReading: ItemsReading | null = null;
  if (path === "items") {
    itemsReading = {
      profile: SEVERAL_ITEMS_PROFILE,
      profileId: SEVERAL_ITEMS_PROFILE.schemaId,
    };
  } else if (path === "profile") {
    const chosen = profileForJob(db, job);
    if (!chosen.ok) {
      markFailed(db, job.id, userId, chosen.reason);
      return;
    }
    itemsReading = chosen.value;
  }

  // A reading that will certainly ask the AI stops here, before the file is
  // read, as it always has. One that may be read from columns goes on: it
  // needs no provider, and the check is made where the AI is asked.
  const providers = loadProviders(db);
  if (
    !providers.length &&
    !mayReadWithoutAi(job, path, itemsReading, candidates)
  ) {
    markFailed(db, job.id, userId, NO_PROVIDERS);
    return;
  }

  const ctx = createReviewContext(db);
  const rateLimitMs = parseInt(
    getSetting(db, SETTING_KEYS.autoImportRateLimitMs) ?? "0",
    10,
  );
  const customInstructions =
    getSetting(db, SETTING_KEYS.autoImportCustomInstructions) ?? "";

  log.info(
    {
      jobId: job.id,
      filename: job.originalFilename,
      providerCount: providers.length,
      reading: path,
    },
    "Processing job",
  );

  const accountLists = {
    expenseAccounts: ctx.expenseChoices.map(({ id, code, path }) => ({
      id,
      code,
      path,
    })),
    incomeAccounts: ctx.incomeChoices.map(({ id, code, path }) => ({
      id,
      code,
      path,
    })),
    mainCurrency: ctx.mainCurrency,
    customInstructions,
  };
  const calls = { providers, rateLimitMs, accountLists };

  if (path === "auto") {
    await readAutoDetected(db, job, userId, ctx, candidates, calls, options);
    return;
  }

  if (itemsReading?.columns) {
    // The cells themselves, and the numbered text for each item's line.
    const source = await documentText(
      db,
      job,
      userId,
      SOURCE_TEXTS,
      options.storageRoot,
    );
    if (source === null) return;
    setState(db, job.id, userId, ImportState.Processing);
    const cells = cellsForColumns(job, source, itemsReading, options);
    if (typeof cells === "string") {
      markFailed(db, job.id, userId, cells);
      return;
    }
    await readItems(db, job, userId, ctx, { ...cells, ...calls }, itemsReading);
    return;
  }

  const text = await documentText(
    db,
    job,
    userId,
    path === "receipt" ? PLAIN_TEXT : NUMBERED_TEXT,
    options.storageRoot,
  );
  if (text === null) return;

  // Processing — LLM call
  setState(db, job.id, userId, ImportState.Processing);

  if (itemsReading === null) {
    await readReceipt(db, job, userId, ctx, { text, ...calls });
  } else {
    await readItems(db, job, userId, ctx, { text, ...calls }, itemsReading);
  }
}

/**
 * Whether this job may be read with no AI at all, so a missing provider is
 * not yet a reason to fail it: a spreadsheet read with a profile from its
 * columns, or a spreadsheet Auto-detect may find such a profile for. Anything
 * else asks the AI, and is stopped before its file is read, as before.
 */
function mayReadWithoutAi(
  job: ImportJob,
  path: ReadingPath,
  itemsReading: ItemsReading | null,
  candidates: readonly ImportProfileView[],
): boolean {
  if (path === "profile") return itemsReading?.columns !== undefined;
  if (path !== "auto" || !readsCells(job)) return false;
  const mode = modeOf(job);
  return candidates.some((profile) => readsFromColumns(profile, mode));
}

/** The import mode the uploader chose; Summary on a row from before it. */
function modeOf(job: Pick<ImportJob, "importMode">): ImportModeValue {
  return isImportMode(job.importMode) ? job.importMode : ImportMode.Summary;
}

/**
 * Whether the job's cells can be read: a spreadsheet whose text was not
 * given with the upload. Text given in its place has no cells to go by.
 */
function readsCells(
  job: Pick<ImportJob, "originalFilename" | "preExtractedText">,
): boolean {
  return isSpreadsheetJob(job) && !job.preExtractedText?.trim();
}

/**
 * Auto-detect with at least one enabled profile (FR-039): the text is read,
 * `detectProfile` decides, and the document is then read the way it decided.
 *
 * - **A profile was found:** the row records it as detected, with a copy of
 *   the profile as it is now (FR-038, FR-041), and is read with it exactly as
 *   if it had been chosen. A file already imported is stopped here, before
 *   the reading (FR-026).
 * - **No profile fits**, or detection failed: the receipt reading, with the
 *   same text and the same call as a receipt chosen at upload (FR-040).
 */
async function readAutoDetected(
  db: LedgerDb,
  job: ImportJob,
  userId: number,
  ctx: ReviewContext,
  profiles: ImportProfileView[],
  calls: Omit<ReadingInput, "text">,
  options: ProcessJobOptions,
) {
  const texts = await documentText(
    db,
    job,
    userId,
    SOURCE_TEXTS,
    options.storageRoot,
  );
  if (texts === null) return;

  setState(db, job.id, userId, ImportState.Processing);

  const detection = texts.workbook
    ? await detectSpreadsheet(job, texts, texts.workbook, profiles, calls)
    : await detectProfile({
        text: texts.plain,
        profiles,
        providers: calls.providers,
        intervalMs: calls.rateLimitMs,
        jobId: job.id,
      });
  if (typeof detection === "string") {
    markFailed(db, job.id, userId, detection);
    return;
  }

  if (detection.route === "standard") {
    clearDetectedProfile(db, job);
    await readReceipt(db, job, userId, ctx, { text: texts.plain, ...calls });
    return;
  }

  // The found profile is read in the mode the uploader chose under "Import"
  // (FR-002): the modes are the same for every profile, so the choice is
  // made before any profile is found. A row from before the choice existed
  // has none and is read as Summary, as it always was.
  const detected: ImportJob = {
    ...job,
    profileId: String(detection.route),
    readHow: ImportReadHow.Detected,
    importMode: modeOf(job),
  };
  const found = profileForJob(db, detected);
  if (!found.ok) {
    markFailed(db, job.id, userId, found.reason);
    return;
  }
  // Every screen now says which profile reads the document, and that it was
  // detected (FR-041), while the reading runs.
  emitJobUpdate(db, job.id, userId);

  const stop = alreadyImported(db, detected);
  if (stop) {
    markFailed(db, job.id, userId, stop);
    return;
  }

  const cells = cellsForColumns(detected, texts, found.value, options);
  if (typeof cells === "string") {
    markFailed(db, job.id, userId, cells);
    return;
  }
  await readItems(
    db,
    detected,
    userId,
    ctx,
    { ...cells, ...calls },
    found.value,
  );
}

/**
 * The cells and numbered text a reading goes by. A CSV file read from its
 * columns with a layout that names the file's separator is read again with
 * that separator, rather than the one worked out from the file: a file of
 * amounts with decimal commas can look as if it were split by commas. The
 * numbered text is made from the same cells, so each item's line is the
 * line its row has. Returns the reason when the file cannot be read again.
 */
function cellsForColumns(
  job: ImportJob,
  source: DocumentSource,
  chosen: ItemsReading,
  options: ProcessJobOptions,
): { text: string; workbook?: Workbook } | string {
  const delimiter = chosen.columns?.table.layout.csvDelimiter ?? null;
  const isCsv = inferMimeType(job.originalFilename) === CSV_MIME_TYPE;
  if (!chosen.columns || delimiter === null || !isCsv) {
    return { text: source.numbered, workbook: source.workbook };
  }
  try {
    const bytes = readFileSync(join(options.storageRoot, job.tempFilePath));
    const workbook = readCsv(bytes, { delimiter });
    return { text: spreadsheetText(workbook).numbered, workbook };
  } catch (err) {
    log.error({ jobId: job.id, err }, "Reading the CSV file again failed");
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Auto-detect for a spreadsheet (FR-039, US10 AS12), cheapest first:
 *
 * 1. **The table's headings.** Exactly one enabled profile whose layout's
 *    headings are all in one row of the workbook is used, with no AI.
 * 2. **Several profiles' headings match.** Their recognition phrases, looked
 *    for in the cells' words (`detectionText`), decide among those profiles
 *    only; then the AI detect call, among those profiles only. With no
 *    provider the job fails, naming them: the table fits each of them, and
 *    the standard reading would be the wrong answer.
 * 3. **No profile's headings match.** The phrases decide among every enabled
 *    profile. Otherwise the AI detect call chooses among the profiles that
 *    could read the document: a profile that reads this mode from columns
 *    could not, since its headings are not there. When there are none, or no
 *    provider is set up, no AI is asked and the standard reading follows,
 *    whose own checks name a spreadsheet too long for it (FR-052) or the
 *    missing provider.
 *
 * Returns the detection, or the reason the job fails.
 */
async function detectSpreadsheet(
  job: ImportJob,
  texts: DocumentSource,
  workbook: Workbook,
  profiles: ImportProfileView[],
  calls: Omit<ReadingInput, "text">,
): Promise<{ route: number | "standard" } | string> {
  const byHeadings = profiles.filter(
    (profile) => profile.layout && layoutMatches(workbook, profile.layout),
  );
  if (byHeadings.length === 1) {
    log.info(
      { jobId: job.id, route: byHeadings[0].id, via: "layout" },
      "Auto-detect decided",
    );
    return { route: byHeadings[0].id };
  }

  const words = detectionText(workbook);
  const among = byHeadings.length > 1 ? byHeadings : profiles;
  const byPhrases = phraseMatch(words, among);
  if (byPhrases.length === 1) {
    log.info(
      { jobId: job.id, route: byPhrases[0].id, via: "phrases" },
      "Auto-detect decided",
    );
    return { route: byPhrases[0].id };
  }

  if (byHeadings.length > 1 && calls.providers.length === 0) {
    return severalLayoutsFit(byHeadings);
  }
  const mode = modeOf(job);
  const choices =
    byHeadings.length > 1
      ? byHeadings
      : profiles.filter((profile) => !readsFromColumns(profile, mode));
  if (choices.length === 0 || calls.providers.length === 0) {
    return { route: "standard" };
  }

  return detectProfile({
    text: texts.plain,
    phraseText: words,
    profiles: choices,
    providers: calls.providers,
    intervalMs: calls.rateLimitMs,
    jobId: job.id,
  });
}

/**
 * Why Auto-detect cannot choose among the profiles whose headings a
 * spreadsheet has, with no AI provider to ask.
 */
export function severalLayoutsFit(
  profiles: readonly Pick<ImportProfileView, "name">[],
): string {
  const names = profiles.map((profile) => `"${profile.name}"`).join(", ");
  return `This spreadsheet has the column headings of ${profiles.length} import profiles (${names}), their recognition phrases do not tell them apart, and no AI provider is set up to choose. Read it again with one of them chosen, or give each recognition phrases only its own documents have.`;
}

/**
 * Marks an auto-detect row as read the standard way, and removes any profile
 * left on it. A reading stopped part-way by a restart may have left a detected
 * profile on the row; the receipt reading that follows does not use it, so the
 * card, the group page and a later repeat-file stop must not name it (FR-003,
 * FR-041). A fresh row has nothing to clear, so it gets no extra write.
 *
 * The import mode stays: it is what the uploader chose under "Import", not
 * something a profile set, and Retry and "Read again" offer it again. Nothing
 * reads it for a receipt.
 */
function clearDetectedProfile(db: LedgerDb, job: ImportJob) {
  const leftOver =
    job.readHow !== ImportReadHow.Standard ||
    job.profileId !== null ||
    job.profileSnapshot !== null;
  if (!leftOver) return;
  db.update(importQueue)
    .set({
      readHow: ImportReadHow.Standard,
      profileId: null,
      profileSnapshot: null,
    })
    .where(eq(importQueue.id, job.id))
    .run();
}

/**
 * The saved profile a job is to be read with, compiled for its import mode,
 * or why it cannot be read (spec edge cases). A profile disabled or deleted
 * after the upload is not used, and the message names it.
 *
 * On success the profile is copied onto the row with the mode, before any
 * reading starts, so every screen can say which profile reads the document
 * from the first update on (FR-041), and an edit made while it is read, or
 * later, never changes the group (FR-038). Auto-detect passes the job with
 * the profile it found and `read_how` already set to detected.
 */
function profileForJob(
  db: LedgerDb,
  job: ImportJob,
): { ok: true; value: ItemsReading } | { ok: false; reason: string } {
  const picked = job.readHow === ImportReadHow.Detected ? "detected" : "chosen";
  const id = savedProfileIdOf(job);
  if (id === null) {
    return {
      ok: false,
      reason:
        "This document was to be read with an import profile, but no profile is named. Upload it again and choose how to read it.",
    };
  }
  const saved = getImportProfile(db, id);
  if (!saved) {
    const name =
      parseProfileSnapshot(job.profileSnapshot)?.name ??
      deletedProfileName(db, id);
    const named = name ? `"${name}"` : `#${id}`;
    return {
      ok: false,
      reason: `The import profile ${named} ${picked} for this document was deleted before it was read. Upload it again and choose another way to read it.`,
    };
  }
  if (!saved.enabled) {
    return {
      ok: false,
      reason: `The import profile "${saved.name}" ${picked} for this document was disabled before it was read. Turn it on again, or upload the document again and choose another way to read it.`,
    };
  }

  const mode = modeOf(job);
  let profile: ReadingProfile;
  try {
    profile = savedReadingProfile(saved, mode);
  } catch (err) {
    if (err instanceof ProfileModeError)
      return { ok: false, reason: err.message };
    throw err;
  }

  // A spreadsheet the profile reads from its columns (FR-055). Its copy
  // names what was read, the layout and the sections, not a schema the AI
  // was never sent.
  const fromColumns = readsCells(job) && readsFromColumns(saved, mode);
  const schemaId = fromColumns
    ? columnsReadingId(saved, mode)
    : profile.schemaId;

  db.update(importQueue)
    .set({
      profileId: String(saved.id),
      importMode: mode,
      readHow: job.readHow ?? ImportReadHow.Chosen,
      profileSnapshot: serializeProfileSnapshot(
        profileSnapshotOf(saved, mode, schemaId),
      ),
    })
    .where(eq(importQueue.id, job.id))
    .run();

  return {
    ok: true,
    value: {
      profile: fromColumns ? { ...profile, schemaId } : profile,
      profileId: String(saved.id),
      profileName: saved.name,
      mode,
      ...(fromColumns && saved.layout
        ? {
            columns: {
              table: {
                name: saved.name,
                layout: saved.layout,
                sections: saved.sections,
              },
              mode,
            },
          }
        : {}),
    },
  };
}

type ReadingInput = {
  text: string;
  /** A spreadsheet's cells, for a reading from its columns. */
  workbook?: Workbook;
  providers: ReturnType<typeof getEnabledProviders>;
  rateLimitMs: number;
  accountLists: Omit<LLMCallParams, "text">;
};

/** Writes one set of review fields onto the queue row: a receipt's card. */
function writeReviewCard(
  db: LedgerDb,
  jobId: string,
  userId: number,
  fields: ReviewFields,
  extra: Partial<typeof importQueue.$inferInsert>,
) {
  db.update(importQueue)
    .set({
      state: ImportState.PendingReview,
      ...fields,
      ...extra,
      ...NO_PROGRESS,
      processedAt: new Date().toISOString(),
    })
    .where(eq(importQueue.id, jobId))
    .run();
  emitJobUpdate(db, jobId, userId);
}

/**
 * Why a spreadsheet cannot be read the standard way, or null (FR-052). The
 * receipt reading sends only the start of a document; a spreadsheet longer
 * than that would be read from a shortened text, with the rows past the cut
 * never seen, so it is refused and the limit named. A PDF or a photo is cut as
 * it always has been (FR-004).
 */
export function receiptTextRefusal(
  job: Pick<ImportJob, "originalFilename">,
  text: string,
): string | null {
  if (!isSpreadsheetJob(job) || text.length <= RECEIPT_TEXT_LIMIT) return null;
  const limit = RECEIPT_TEXT_LIMIT.toLocaleString("en");
  const length = text.length.toLocaleString("en");
  return `This spreadsheet is too long to be read as a receipt or invoice: its text is ${length} characters, and that reading takes at most ${limit}. Read it again as a document with several items, or with an import profile.`;
}

async function readReceipt(
  db: LedgerDb,
  job: ImportJob,
  userId: number,
  ctx: ReviewContext,
  input: ReadingInput,
) {
  const tooLong = receiptTextRefusal(job, input.text);
  if (tooLong) {
    markFailed(db, job.id, userId, tooLong);
    return;
  }
  if (input.providers.length === 0) {
    markFailed(db, job.id, userId, NO_PROVIDERS);
    return;
  }

  let result;
  try {
    result = await callLLMWithProviders(
      { text: input.text, ...input.accountLists },
      input.providers,
      input.rateLimitMs,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ jobId: job.id, msg }, "LLM extraction failed");
    markFailed(db, job.id, userId, `AI extraction failed: ${msg}`);
    return;
  }

  log.info(
    {
      jobId: job.id,
      documentType: result.document_type,
      amount: result.amount,
      date: result.date,
    },
    "LLM result",
  );

  const fields = await buildReviewFields(
    db,
    {
      // A receipt is an expense or an income, never a transfer (FR-059):
      // only a profile's transfer section reads one.
      documentType:
        documentTypeEnum.fromLabel(result.document_type) === DocumentType.Income
          ? DocumentType.Income
          : DocumentType.Expense,
      itemName: result.item_name,
      supplier: result.supplier,
      amount: result.amount,
      date: result.date,
      reference: result.reference,
      currency: result.currency,
      categoryAccountId: result.category_account_id,
      remark: null,
      duplicateEvidence: {
        originalFilename: job.originalFilename,
        fileHash: job.fileHash,
        extractedText: input.text,
      },
    },
    ctx,
  );

  writeReviewCard(db, job.id, userId, fields, { extractedText: input.text });
  log.info({ jobId: job.id }, "Job completed — pending review");
}

/**
 * The remark an item starts with: its fee type, then each extra field, each as
 * "name: value" (FR-034, FR-035), for example "Fee type: commission_fee;
 * order_no: 2408". Null when it has neither, as for every item of the built-in
 * several-items reading.
 */
function itemRemark(item: DocumentItem): string | null {
  const parts: string[] = [];
  if (item.feeType) parts.push(`Fee type: ${item.feeType}`);
  for (const [name, value] of Object.entries(item.extras ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    parts.push(`${name}: ${String(value)}`);
  }
  return parts.length ? parts.join("; ") : null;
}

/**
 * What to tell the reviewer when the category the item's fee type is tied to
 * could not be used because it is for the other kind of record, or null.
 *
 * A by-sign section reads each line's kind from its printed sign, so a fee
 * type tied to an income category can still give a line printed negative,
 * which is an expense. The tied category is then not used (it would file an
 * expense under income), the item keeps what it would have had without it,
 * and this says so, on the item, rather than dropping the tie silently.
 */
export function tiedCategoryNote(
  item: Pick<DocumentItem, "kind" | "feeType" | "tiedCategoryAccountId">,
  sectionKind: string | undefined,
  filedUnder: Pick<ReviewFields, "categoryAccountId" | "category">,
  ctx: Pick<ReviewContext, "incomeChoices" | "expenseChoices">,
): string | null {
  const tied = item.tiedCategoryAccountId;
  if (tied == null || filedUnder.categoryAccountId === tied) return null;
  const isIncome = item.kind === DocumentType.Income;
  const otherKind = (isIncome ? ctx.expenseChoices : ctx.incomeChoices).find(
    (choice) => choice.id === tied,
  );
  // Archived since the profile was saved, or one of this kind after all:
  // either way nothing contradicts the line, so there is nothing to say.
  if (!otherKind) return null;
  const tiedKind = isIncome ? "an expense category" : "an income category";
  const lineKind = isIncome ? "an income" : "an expense";
  const why =
    sectionKind === "by_sign"
      ? `this line is printed ${isIncome ? "positive" : "negative"}, so it is ${lineKind}`
      : `this line is ${lineKind}`;
  const instead = filedUnder.category
    ? `It is filed under “${filedUnder.category}” instead`
    : "It has no category instead";
  return `The category “${otherKind.name}” tied to the fee type “${item.feeType}” is ${tiedKind}, but ${why}. ${instead}: choose its category.`;
}

async function itemFields(
  db: LedgerDb,
  jobId: string,
  reading: DocumentReading,
  ctx: ReviewContext,
  profile: ReadingProfile,
): Promise<ReviewFields[]> {
  const sectionKinds = new Map(
    profile.sections.map((section) => [section.key, section.kind]),
  );
  // Income and expenses another profile's records may already hold (FR-066).
  const overlaps = sameMoneyNotes(
    db,
    reading.items.map((item) => ({
      sectionKey: item.sectionKey,
      kind: item.kind,
      date: item.date,
    })),
    profile.sections,
    jobId,
  );
  // A row read from a table, or in pieces, carries its own reference, and a
  // record with a different one is a different transaction (FR-063).
  const referenceVeto =
    reading.notes.method === "columns" || reading.notes.method === "ai_pieces";
  const out: ReviewFields[] = [];
  for (const [index, item] of reading.items.entries()) {
    // The first category the item could take that is still one of its kind
    // (FR-034): a tied category archived since the profile was saved is
    // passed over. None leaves Uncategorised to `buildReviewFields`.
    const choices =
      item.kind === DocumentType.Income
        ? ctx.incomeChoices
        : ctx.expenseChoices;
    const categoryAccountId =
      item.categoryCandidates.find((id) =>
        choices.some((choice) => choice.id === id),
      ) ?? null;
    const fields = await buildReviewFields(
      db,
      {
        documentType: item.kind,
        itemName: item.description,
        // The other party and currency are the document's; the date and
        // reference are the item's own when its line prints one (FR-006).
        supplier: reading.counterparty,
        amount: item.amount,
        date: item.date,
        reference: item.reference,
        currency: reading.currency,
        categoryAccountId,
        remark: itemRemark(item),
        // No file name, hash or text: shared by every item of the document
        // and by last month's, so none of them says an item is a duplicate.
        // The file hash was checked for the whole document before reading.
        duplicateEvidence: {
          originalFilename: null,
          fileHash: null,
          extractedText: null,
          referenceVeto,
        },
        // The profile's own account, and a transfer's other one (FR-058).
        documentAccountId: profile.documentAccountId ?? null,
        counterAccountId: item.counterAccountId,
      },
      ctx,
    );
    // What the reading says to check. Any of it holds the item back from
    // "Confirm all" until the reviewer has looked. A tied category it could
    // not use (FR-034) is answered by choosing a category, so it is kept
    // apart from its section's flag rule (FR-061) and money another
    // profile's records may already hold (FR-066), which no category choice
    // answers: a bulk "Set category" must not clear a double-count warning.
    fields.reviewNote = tiedCategoryNote(
      item,
      sectionKinds.get(item.sectionKey),
      fields,
      ctx,
    );
    const checks = [item.reviewNote, overlaps[index]].filter(
      (note): note is string => Boolean(note),
    );
    fields.checkNote = checks.length ? checks.join(" ") : null;
    out.push(fields);
  }
  flagTransferDuplicates(db, reading, out, ctx);
  return out;
}

/**
 * Flags each transfer item that repeats a transfer already in the books
 * (FR-060), such as one made in Reconciliation. Asked for the whole reading at
 * once, so one existing transfer flags one item only. A transfer in another
 * currency is not looked for: it cannot be imported as it is (FR-059), and
 * its amount is not in the books' cents.
 */
function flagTransferDuplicates(
  db: LedgerDb,
  reading: DocumentReading,
  fields: ReviewFields[],
  ctx: ReviewContext,
) {
  const probed: number[] = [];
  const probes: TransferProbe[] = [];
  for (const [index, item] of reading.items.entries()) {
    const row = fields[index];
    if (!isTransferType(item.kind)) continue;
    if (row.accountId == null || row.counterAccountId == null) continue;
    if (row.currency !== ctx.mainCurrency) continue;
    probed.push(index);
    probes.push({
      documentType: item.kind,
      accountId: row.accountId,
      counterAccountId: row.counterAccountId,
      amountMinor: item.amountMinor,
      date: item.date,
    });
  }
  if (probes.length === 0) return;
  for (const [at, found] of detectTransferDuplicates(db, probes)) {
    const row = fields[probed[at]];
    row.duplicateOf = found.duplicateOf;
    row.duplicateConfidence = found.confidence;
    row.duplicateReasons = JSON.stringify(found.reasons);
  }
}

/**
 * Shows how far a reading in pieces has got, on the queue row and every open
 * screen: "Reading part 3 of 25" (FR-043, US8 AS2).
 */
function showProgress(
  db: LedgerDb,
  jobId: string,
  userId: number,
  progress: PieceProgress,
) {
  db.update(importQueue)
    .set({ progressDone: progress.done, progressTotal: progress.total })
    .where(eq(importQueue.id, jobId))
    .run();
  emitJobUpdate(db, jobId, userId);
}

/**
 * Whether the job is still being read: it exists, and nothing else has moved
 * it on. A reading in pieces asks between pieces, so a document discarded
 * while it is read makes no more AI calls (FR-011).
 */
function isStillReading(db: LedgerDb, jobId: string): boolean {
  const current = db
    .select({ state: importQueue.state })
    .from(importQueue)
    .where(eq(importQueue.id, jobId))
    .get();
  return current?.state === ImportState.Processing;
}

async function readItems(
  db: LedgerDb,
  job: ImportJob,
  userId: number,
  ctx: ReviewContext,
  input: ReadingInput,
  chosen: ItemsReading,
) {
  const { profile, profileId } = chosen;
  if (!chosen.columns && input.providers.length === 0) {
    markFailed(db, job.id, userId, NO_PROVIDERS);
    return;
  }
  let reading: DocumentReading;
  try {
    if (chosen.columns) {
      // Read by code from the cells (FR-055): no AI call, no provider.
      if (!input.workbook) {
        throw new TableReadError(
          "This spreadsheet's cells could not be read, so it was not read from its columns.",
        );
      }
      reading = readFromColumns(
        input.workbook,
        chosen.columns.table,
        chosen.columns.mode,
        profile,
        {
          today: new Date().toISOString().slice(0, 10),
          mainCurrency: input.accountLists.mainCurrency,
          schemaId: profile.schemaId,
        },
      );
    } else if (chosen.mode === ImportMode.EveryTransaction) {
      // One record per row, of a document that may run to hundreds of
      // rows: read in pieces, each sized to finish in time (FR-043).
      reading = await readInPieces(
        { text: input.text, profile, ...input.accountLists },
        input.providers,
        {
          intervalMs: input.rateLimitMs,
          onProgress: (progress) => showProgress(db, job.id, userId, progress),
          stillWanted: () => isStillReading(db, job.id),
        },
      );
    } else {
      reading = await readDocumentItems(
        { text: input.text, profile, ...input.accountLists },
        input.providers,
        input.rateLimitMs,
      );
    }
  } catch (err) {
    if (err instanceof ReadingStoppedError) {
      // Deleted, or moved on by something else, between two pieces. A job
      // moved on keeps its new state, but not this reading's count.
      db.update(importQueue)
        .set(NO_PROGRESS)
        .where(
          and(
            eq(importQueue.id, job.id),
            ne(importQueue.state, ImportState.Processing),
          ),
        )
        .run();
      log.warn(
        { jobId: job.id },
        "Job changed during reading; reading stopped",
      );
      return;
    }
    if (err instanceof DocumentLimitError || err instanceof TableReadError) {
      markFailed(db, job.id, userId, err.message);
      return;
    }
    if (err instanceof SchemaRejectedError) {
      // Only this document fails, and with no reading without the schema
      // (FR-037). Nothing is remembered about the refusal, so no other
      // document is read differently.
      const whose = chosen.profileName
        ? `the import profile "${chosen.profileName}"`
        : "the chosen reading";
      markFailed(
        db,
        job.id,
        userId,
        `The AI provider refused the request to read this document with ${whose} (HTTP 400), so it was not read: ${err.providerMessage}`,
      );
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ jobId: job.id, msg }, "LLM extraction failed");
    markFailed(db, job.id, userId, `AI extraction failed: ${msg}`);
    return;
  }

  log.info(
    {
      jobId: job.id,
      items: reading.items.length,
      ignored: reading.notes.ignored.length,
      controlTotal: reading.controlTotal,
    },
    "Document read",
  );

  if (reading.items.length === 0) {
    markFailed(db, job.id, userId, NO_ITEMS_FOUND);
    return;
  }

  // Every look-up that waits (exchange rates) is done here, before the write,
  // so the write below can be one transaction that never waits.
  const fields = await itemFields(db, job.id, reading, ctx, profile);
  const extractionNotes = serializeExtractionNotes(reading.notes);

  if (fields.length === 1) {
    // One item is a receipt: one card, no group (FR-009). It keeps the text
    // for search as a receipt does, without the line numbers.
    writeReviewCard(db, job.id, userId, fields[0], {
      extractedText: stripLineNumbers(input.text),
      profileId,
      extractionNotes,
    });
    log.info({ jobId: job.id }, "Job completed — one item, pending review");
    return;
  }

  const rows: ImportItemInsert[] = reading.items.map((item, position) => ({
    id: randomUUID(),
    jobId: job.id,
    state: ImportState.PendingReview,
    position,
    sourceLine: item.sourceLine,
    sectionKey: item.sectionKey,
    feeType: item.feeType,
    extrasJson: item.extras ? JSON.stringify(item.extras) : null,
    ...fields[position],
  }));

  let grouped: boolean;
  try {
    grouped = saveGroup(db, job.id, rows, {
      profileId,
      extractionNotes,
      document: {
        date: reading.date,
        supplier: reading.counterparty,
        reference: reading.reference,
        currency: reading.currency,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ jobId: job.id, err }, "Saving the items failed");
    markFailed(
      db,
      job.id,
      userId,
      `Couldn't save the items read from this document: ${msg}`,
    );
    return;
  }
  if (!grouped) {
    // Deleted, or moved on by something else, while it was being read.
    log.warn({ jobId: job.id }, "Job changed during reading; items not saved");
    return;
  }

  // Announced only now that the group has committed.
  emitJobUpdate(db, job.id, userId);
  emitItemUpdates(
    db,
    job.id,
    rows.map((row) => row.id),
    userId,
  );
  log.info(
    { jobId: job.id, items: rows.length },
    "Job completed — grouped for review",
  );
}

/**
 * Saves every item and marks the queue row Grouped, all in one transaction, or
 * nothing at all. The row must still exist and still be reading: a document
 * discarded while it was read leaves no items behind. Returns whether the
 * group was saved. Throws, with nothing written, when a write fails.
 */
export function saveGroup(
  db: LedgerDb,
  jobId: string,
  rows: ImportItemInsert[],
  notes: {
    profileId: string;
    extractionNotes: string;
    /**
     * The document's own header. Kept on the group, whose review columns are
     * otherwise unused: the date is the month every record of the group files
     * the shared document under (see `confirmImportRow`).
     */
    document?: Pick<
      typeof importQueue.$inferInsert,
      "date" | "supplier" | "reference" | "currency"
    >;
  },
): boolean {
  return db.transaction((tx) => {
    const current = tx
      .select({ state: importQueue.state })
      .from(importQueue)
      .where(eq(importQueue.id, jobId))
      .get();
    if (!current || current.state !== ImportState.Processing) return false;

    for (let start = 0; start < rows.length; start += ITEM_INSERT_CHUNK) {
      tx.insert(importItems)
        .values(rows.slice(start, start + ITEM_INSERT_CHUNK))
        .run();
    }
    tx.update(importQueue)
      .set({
        state: ImportState.Grouped,
        ...notes.document,
        profileId: notes.profileId,
        extractionNotes: notes.extractionNotes,
        error: null,
        ...NO_PROGRESS,
        processedAt: new Date().toISOString(),
      })
      .where(eq(importQueue.id, jobId))
      .run();
    return true;
  });
}
