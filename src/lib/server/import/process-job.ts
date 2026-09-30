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
 *
 * The worker calls this with the app's database and storage folder; the tests
 * call it with their own, so nothing here reaches for either.
 */

import { randomUUID } from "crypto";
import { and, eq, ne } from "drizzle-orm";
import { join } from "path";
import {
  DocumentType,
  ImportState,
  documentTypeEnum,
  type ImportStateCode,
} from "$lib/enums.js";
import { ImportReadAs, serializeExtractionNotes } from "$lib/import-reading.js";
import { importItems, importQueue, users } from "../db/schema.js";
import {
  extractNumberedText,
  extractText,
  inferMimeType,
  numberDocumentLines,
  stripLineNumbers,
} from "../extraction/document-text.js";
import type { LedgerDb } from "../ledger/types.js";
import { getEnabledProviders, insertProvider } from "../llmProviders.js";
import { createLogger } from "../logger.js";
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
import { importEvents } from "./events.js";
import { itemForEvent, jobForEvent } from "./job-event.js";
import { callLLMWithProviders } from "./llm.js";
import type { LLMCallParams } from "./providers/types.js";
import { SEVERAL_ITEMS_PROFILE } from "./profile-compiler.js";
import type { ReviewFields } from "./review-fields.js";

const log = createLogger("import:worker");

type ImportJob = typeof importQueue.$inferSelect;
type ImportItemInsert = typeof importItems.$inferInsert;

export interface ProcessJobOptions {
  /** The folder the job's `temp_file_path` is relative to. */
  storageRoot: string;
}

/** The message a document with nothing to import fails with (FR-009). */
export const NO_ITEMS_FOUND = "No items found";

/**
 * Items are inserted this many at a time, so a document of a thousand items
 * stays well inside SQLite's limit on values in one statement. All of them are
 * still in one transaction.
 */
const ITEM_INSERT_CHUNK = 100;

type ReadingPath = "receipt" | "items";

/**
 * How this job is read. Only the several-items choice reads items; a row from
 * before 006 has no choice stored and is a receipt, as it was when uploaded.
 */
function readingPath(job: ImportJob): ReadingPath {
  return job.readAs === ImportReadAs.SeveralItems ? "items" : "receipt";
}

function emitJobUpdate(db: LedgerDb, jobId: string, userId: number) {
  const row = db
    .select()
    .from(importQueue)
    .where(eq(importQueue.id, jobId))
    .get();
  if (row) importEvents.emit("job-update", { userId, job: jobForEvent(row) });
}

function markFailed(
  db: LedgerDb,
  jobId: string,
  userId: number,
  error: string,
) {
  log.error({ jobId, error }, "Job failed");
  db.update(importQueue)
    .set({ state: ImportState.Failed, error })
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
  db.update(importQueue).set({ state }).where(eq(importQueue.id, jobId)).run();
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

/** "as a receipt or invoice", in the words the upload screen uses. */
function howItWasRead(row: Pick<ImportJob, "readAs">): string {
  switch (row.readAs) {
    case ImportReadAs.SeveralItems:
      return "as a document with several items";
    case ImportReadAs.Profile:
      return "with an import profile";
    default:
      return "as a receipt or invoice";
  }
}

function records(count: number): string {
  return count === 1 ? "1 record" : `${count} records`;
}

/**
 * Why this file must not be read again, or null when it may be (FR-026).
 *
 * The same file already made at least one record: as a receipt, or as items
 * of a group. An earlier upload whose items were all skipped or discarded made
 * nothing, so the file is read as normal. Checked before the file is read, so
 * a stopped upload costs no AI call.
 */
export function alreadyImported(db: LedgerDb, job: ImportJob): string | null {
  if (!job.fileHash) return null;
  const earlier = db
    .select({
      id: importQueue.id,
      state: importQueue.state,
      readAs: importQueue.readAs,
      createdAt: importQueue.createdAt,
    })
    .from(importQueue)
    .where(
      and(eq(importQueue.fileHash, job.fileHash), ne(importQueue.id, job.id)),
    )
    .all()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const row of earlier) {
    // Count the imported items first: a finished group is itself marked
    // Imported, and it made one record per item, not one. A row with no items
    // is a receipt, which made one record when it was imported.
    const importedItems = db
      .select({ id: importItems.id })
      .from(importItems)
      .where(
        and(
          eq(importItems.jobId, row.id),
          eq(importItems.state, ImportState.Imported),
        ),
      )
      .all().length;
    const made =
      importedItems > 0
        ? importedItems
        : row.state === ImportState.Imported
          ? 1
          : 0;
    if (made > 0) {
      return `This file was already imported ${howItWasRead(row)}, which made ${records(made)}. It was not read again.`;
    }
  }
  return null;
}

/**
 * The document's text, as the chosen reading needs it: one run for a receipt,
 * numbered lines for items. Null when the job has already been failed.
 */
async function documentText(
  db: LedgerDb,
  job: ImportJob,
  userId: number,
  path: ReadingPath,
  storageRoot: string,
): Promise<string | null> {
  let text: string;
  if (job.preExtractedText && job.preExtractedText.trim().length > 0) {
    // Caller already ran its own OCR/extraction — skip server-side extraction entirely.
    const given = job.preExtractedText.trim();
    text = path === "items" ? numberDocumentLines([given]) : given;
    log.debug(
      { jobId: job.id, textLength: text.length },
      "Using caller-provided text (OCR bypassed)",
    );
  } else {
    setState(db, job.id, userId, ImportState.Extracting);

    const absPath = join(storageRoot, job.tempFilePath);
    const mimeType = inferMimeType(job.originalFilename);
    try {
      text =
        path === "items"
          ? await extractNumberedText(absPath, mimeType)
          : await extractText(absPath, mimeType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ jobId: job.id, err }, "Text extraction failed");
      markFailed(db, job.id, userId, msg);
      return null;
    }
  }

  // Numbered text always has its page markers, so what counts is what the
  // document itself prints.
  const printed = path === "items" ? stripLineNumbers(text).trim() : text;
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

  log.debug(
    { jobId: job.id, textLength: text.length, preview: text.slice(0, 200) },
    "Text extracted",
  );
  return text;
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
  const path = readingPath(job);

  if (path === "items") {
    const stop = alreadyImported(db, job);
    if (stop) {
      markFailed(db, job.id, userId, stop);
      return;
    }
  }

  const providers = loadProviders(db);
  if (!providers.length) {
    markFailed(
      db,
      job.id,
      userId,
      "No LLM providers configured. Go to Settings → Intelligence to add one.",
    );
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

  const text = await documentText(db, job, userId, path, options.storageRoot);
  if (text === null) return;

  // Processing — LLM call
  setState(db, job.id, userId, ImportState.Processing);

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

  if (path === "receipt") {
    await readReceipt(db, job, userId, ctx, {
      text,
      providers,
      rateLimitMs,
      accountLists,
    });
  } else {
    await readItems(db, job, userId, ctx, {
      text,
      providers,
      rateLimitMs,
      accountLists,
    });
  }
}

type ReadingInput = {
  text: string;
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
      processedAt: new Date().toISOString(),
    })
    .where(eq(importQueue.id, jobId))
    .run();
  emitJobUpdate(db, jobId, userId);
}

async function readReceipt(
  db: LedgerDb,
  job: ImportJob,
  userId: number,
  ctx: ReviewContext,
  input: ReadingInput,
) {
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
      documentType:
        documentTypeEnum.fromLabel(result.document_type) ??
        DocumentType.Expense,
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
 * The remark an item starts with: its fee type, then each extra field as
 * "name: value" (FR-034, FR-035). Null when it has neither, as for every item
 * of the built-in several-items reading.
 */
function itemRemark(item: DocumentItem): string | null {
  const parts: string[] = [];
  if (item.feeType) parts.push(item.feeType);
  for (const [name, value] of Object.entries(item.extras ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    parts.push(`${name}: ${String(value)}`);
  }
  return parts.length ? parts.join("; ") : null;
}

async function itemFields(
  db: LedgerDb,
  reading: DocumentReading,
  ctx: ReviewContext,
): Promise<ReviewFields[]> {
  const out: ReviewFields[] = [];
  for (const item of reading.items) {
    out.push(
      await buildReviewFields(
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
          categoryAccountId: item.categoryAccountId,
          remark: itemRemark(item),
          // No file name, hash or text: shared by every item of the document
          // and by last month's, so none of them says an item is a duplicate.
          // The file hash was checked for the whole document before reading.
          duplicateEvidence: {
            originalFilename: null,
            fileHash: null,
            extractedText: null,
          },
        },
        ctx,
      ),
    );
  }
  return out;
}

async function readItems(
  db: LedgerDb,
  job: ImportJob,
  userId: number,
  ctx: ReviewContext,
  input: ReadingInput,
) {
  const profile = SEVERAL_ITEMS_PROFILE;
  let reading: DocumentReading;
  try {
    reading = await readDocumentItems(
      { text: input.text, profile, ...input.accountLists },
      input.providers,
      input.rateLimitMs,
    );
  } catch (err) {
    if (err instanceof DocumentLimitError) {
      markFailed(db, job.id, userId, err.message);
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
  const fields = await itemFields(db, reading, ctx);
  const extractionNotes = serializeExtractionNotes(reading.notes);

  if (fields.length === 1) {
    // One item is a receipt: one card, no group (FR-009). It keeps the text
    // for search as a receipt does, without the line numbers.
    writeReviewCard(db, job.id, userId, fields[0], {
      extractedText: stripLineNumbers(input.text),
      profileId: profile.schemaId,
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
      profileId: profile.schemaId,
      extractionNotes,
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
  const saved = db
    .select()
    .from(importItems)
    .where(eq(importItems.jobId, job.id))
    .all()
    .sort((a, b) => a.position - b.position);
  for (const item of saved) {
    importEvents.emit("item-update", {
      userId,
      jobId: job.id,
      item: itemForEvent(item),
    });
  }
  log.info(
    { jobId: job.id, items: saved.length },
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
  notes: { profileId: string; extractionNotes: string },
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
        profileId: notes.profileId,
        extractionNotes: notes.extractionNotes,
        error: null,
        processedAt: new Date().toISOString(),
      })
      .where(eq(importQueue.id, jobId))
      .run();
    return true;
  });
}
