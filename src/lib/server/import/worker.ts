import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { importQueue, users } from "../db/schema.js";
import { STORAGE_PATH } from "../env.js";
import { createLogger } from "../logger.js";
import { getSetting, SETTING_KEYS } from "../settings.js";
import { categoryChoices } from "./category-accounts.js";
import {
  getAccount,
  lastPaymentAccountForContact,
} from "../queries/accounts.js";
import { getEnabledProviders, insertProvider } from "../llmProviders.js";
import { extractText, inferMimeType } from "../extraction/document-text.js";
import { callLLMWithProviders } from "./llm.js";
import { detectDuplicate } from "./duplicate-detector.js";
import { importEvents } from "./events.js";
import { resolveContactCandidates } from "../queries/contacts.js";
import { getExchangeRate } from "../currency/rates.js";
import { mainCurrencyCode } from "../currency/form.js";
import {
  ImportState,
  DocumentType,
  LedgerRecordKind,
  Role,
  documentTypeEnum,
  DefaultAccountPurpose,
} from "$lib/enums.js";
import { requireAccountDefault } from "../services/account-defaults.js";
import {
  isImportIncomeTarget,
  isImportPurchaseSource,
} from "./account-policy.js";
import { join } from "path";

const log = createLogger("import:worker");

const TICK_INTERVAL = 2000;

const activeJobs = new Set<string>();

function emitJobUpdate(jobId: string, userId: number) {
  const row = db
    .select()
    .from(importQueue)
    .where(eq(importQueue.id, jobId))
    .get();
  if (row) importEvents.emit("job-update", { userId, job: row });
}

export function startImportWorker(): void {
  recoverStaleJobs();
  scheduleTick();
}

function scheduleTick() {
  setTimeout(async () => {
    try {
      await tick();
    } catch (err) {
      log.error({ err }, "Tick error");
    }
    scheduleTick();
  }, TICK_INTERVAL);
}

function recoverStaleJobs() {
  db.update(importQueue)
    .set({ state: ImportState.Queued })
    .where(
      inArray(importQueue.state, [
        ImportState.Extracting,
        ImportState.Processing,
      ]),
    )
    .run();
}

async function tick() {
  const queued = db
    .select()
    .from(importQueue)
    .where(eq(importQueue.state, ImportState.Queued))
    .all();

  const maxConcurrency = Math.min(
    10,
    Math.max(
      1,
      parseInt(
        getSetting(db, SETTING_KEYS.autoImportParallelTasks) ?? "3",
        10,
      ) || 3,
    ),
  );
  const slots = maxConcurrency - activeJobs.size;
  if (slots <= 0 || queued.length === 0) return;

  const toProcess = queued.slice(0, slots);
  await Promise.all(toProcess.map((job) => processJob(job)));
}

async function processJob(job: typeof importQueue.$inferSelect) {
  if (activeJobs.has(job.id)) return;
  activeJobs.add(job.id);

  try {
    // The uploader (for event routing / audit). Settings are global.
    const ownerUser = db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, job.createdBy))
      .get();
    const userId = ownerUser?.id ?? job.createdBy;

    // Load enabled providers; auto-migrate from legacy settings on first run
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

    if (!providers.length) {
      markFailed(
        job.id,
        userId,
        "No LLM providers configured. Go to Settings → Intelligence to add one.",
      );
      return;
    }

    // The AI picks from the chart of accounts, so what it answers can be matched
    // straight back to an account on confirm (FR-006a).
    const expenseCategories = categoryChoices(db, "expense").map((c) => c.name);
    const incomeCategories = categoryChoices(db, "income").map((c) => c.name);
    const mainCurrency = mainCurrencyCode(db);
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
      },
      "Processing job",
    );

    let text: string;
    if (job.preExtractedText && job.preExtractedText.trim().length > 0) {
      // Caller already ran its own OCR/extraction — skip server-side extraction entirely.
      text = job.preExtractedText.trim();
      log.debug(
        { jobId: job.id, textLength: text.length },
        "Using caller-provided text (OCR bypassed)",
      );
    } else {
      // Extracting
      db.update(importQueue)
        .set({ state: ImportState.Extracting })
        .where(eq(importQueue.id, job.id))
        .run();
      emitJobUpdate(job.id, userId);

      const absPath = join(STORAGE_PATH, job.tempFilePath);
      const mimeType = inferMimeType(job.originalFilename);
      try {
        text = await extractText(absPath, mimeType);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error({ jobId: job.id, err }, "Text extraction failed");
        markFailed(job.id, userId, msg);
        return;
      }
    }

    if (!text || text.length < 10) {
      log.warn(
        { jobId: job.id, textLength: text?.length ?? 0 },
        "Insufficient text extracted",
      );
      markFailed(
        job.id,
        userId,
        "Couldn't read enough text from this file. Try a clearer image or a text PDF.",
      );
      return;
    }

    log.debug(
      { jobId: job.id, textLength: text.length, preview: text.slice(0, 200) },
      "Text extracted",
    );

    // Processing — LLM call
    db.update(importQueue)
      .set({ state: ImportState.Processing })
      .where(eq(importQueue.id, job.id))
      .run();
    emitJobUpdate(job.id, userId);

    let result;
    try {
      result = await callLLMWithProviders(
        {
          text,
          expenseCategories,
          incomeCategories,
          mainCurrency,
          customInstructions,
        },
        providers,
        rateLimitMs,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ jobId: job.id, msg }, "LLM extraction failed");
      markFailed(job.id, userId, `AI extraction failed: ${msg}`);
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

    const docType =
      documentTypeEnum.fromLabel(result.document_type) ?? DocumentType.Expense;

    // Duplicate detection
    const dup = detectDuplicate(db, {
      originalFilename: job.originalFilename,
      fileHash: job.fileHash,
      itemName: result.item_name,
      supplier: result.supplier,
      amount: result.amount,
      date: result.date,
      reference: result.reference,
      extractedText: text,
      documentType: docType,
    });

    // Contact resolution — deterministic backend step (LLM is never given the
    // contact list). `supplier` always carries the other party's name, whether
    // it's who was paid (expense) or who paid (income) — only which contact
    // bucket to search (Supplier vs Customer) depends on document_type.
    const role =
      docType === DocumentType.Income ? Role.Customer : Role.Supplier;
    const partyName = result.supplier;
    const { matchedId, candidates } = resolveContactCandidates(
      db,
      partyName ?? "",
      role,
    );

    // Resolve the exchange rate up front when the detected currency is foreign, so the
    // review card shows a converted preview. Left null when no API key / unavailable —
    // the reviewer then enters it manually.
    const detectedCurrency = result.currency.toUpperCase();
    let exchangeRate: number | null =
      detectedCurrency === mainCurrency ? 1 : null;
    if (exchangeRate === null) {
      const rate = await getExchangeRate(db, {
        from: detectedCurrency,
        to: mainCurrency,
        date: result.date,
      });
      exchangeRate = rate.rate;
    }

    // Which account paid or received it. A repeat contact pre-fills whatever
    // account was actually used for them last time (FR-011, FR-019) — a
    // vendor usually paid from the same wallet, a customer usually pays into
    // the same bank account, and this is also how a reviewer's own choice of
    // Accounts Payable ("I paid this personally") carries forward to the
    // vendor's next receipt. Falls back to the one global default when the
    // contact has no matching history yet.
    const learnedAccountId =
      matchedId != null
        ? lastPaymentAccountForContact(
            db,
            matchedId,
            docType === DocumentType.Income
              ? LedgerRecordKind.Income
              : LedgerRecordKind.Expense,
          )
        : null;
    const learnedAccount =
      learnedAccountId == null ? null : getAccount(db, learnedAccountId);
    const payableDefault = requireAccountDefault(
      db,
      DefaultAccountPurpose.Payable,
    );
    const receivableDefault = requireAccountDefault(
      db,
      DefaultAccountPurpose.Receivable,
    );
    const transactionDefault = requireAccountDefault(
      db,
      DefaultAccountPurpose.EverydayTransaction,
    );
    const learnedEligible = learnedAccount
      ? docType === DocumentType.Income
        ? isImportIncomeTarget(
            learnedAccount,
            receivableDefault.ok ? receivableDefault.value : null,
          )
        : isImportPurchaseSource(
            learnedAccount,
            payableDefault.ok ? payableDefault.value : null,
          )
      : false;
    const dueDefault =
      result.payment_status === "due"
        ? requireAccountDefault(
            db,
            docType === DocumentType.Income
              ? DefaultAccountPurpose.Receivable
              : DefaultAccountPurpose.Payable,
          )
        : null;

    const now = new Date().toISOString();
    db.update(importQueue)
      .set({
        state: ImportState.PendingReview,
        documentType: docType,
        extractedText: text,
        itemName: result.item_name,
        supplier: result.supplier,
        matchedContactId: matchedId,
        matchCandidates: candidates.length ? JSON.stringify(candidates) : null,
        date: result.date,
        amount: result.amount,
        currency: detectedCurrency,
        exchangeRate,
        reference: result.reference,
        category: result.category,
        accountId:
          dueDefault?.ok === true
            ? dueDefault.value
            : learnedEligible
              ? learnedAccountId
              : transactionDefault.ok
                ? transactionDefault.value
                : null,
        duplicateOf: dup?.duplicateOf ?? null,
        duplicateConfidence: dup?.confidence ?? null,
        duplicateReasons: dup ? JSON.stringify(dup.reasons) : null,
        processedAt: now,
      })
      .where(eq(importQueue.id, job.id))
      .run();
    emitJobUpdate(job.id, userId);

    log.info({ jobId: job.id }, "Job completed — pending review");
  } finally {
    activeJobs.delete(job.id);
  }
}

function markFailed(jobId: string, userId: number, error: string) {
  log.error({ jobId, error }, "Job failed");
  db.update(importQueue)
    .set({ state: ImportState.Failed, error })
    .where(eq(importQueue.id, jobId))
    .run();
  emitJobUpdate(jobId, userId);
}
