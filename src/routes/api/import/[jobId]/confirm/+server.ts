import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "$lib/server/db/client.js";
import { createLogger } from "$lib/server/logger.js";
import { importEvents } from "$lib/server/import/events.js";
import { importQueue } from "$lib/server/db/schema.js";
import { badRequest, forbidden, refused } from "$lib/server/api-response.js";
import { moveToRecordStorage, displayName } from "$lib/server/file-storage.js";
import { normalizeDate } from "$lib/server/date.js";
import { createRecord, emitRecordUpdate } from "$lib/server/services/ledger.js";
import { addAttachment } from "$lib/server/queries/ledger.js";
import {
  defaultAccountId,
  systemAccounts,
} from "$lib/server/queries/accounts.js";
import {
  categoryChoices,
  matchCategoryAccount,
} from "$lib/server/import/category-accounts.js";
import { resolveOrCreateContact } from "$lib/server/queries/contacts.js";
import { getExchangeRate } from "$lib/server/currency/rates.js";
import { mainCurrencyCode } from "$lib/server/currency/form.js";
import {
  ImportState,
  DocumentType,
  Role,
  documentTypeEnum,
} from "$lib/enums.js";
import type { RecordCreate } from "$lib/server/ledger/types.js";
import type { RequestHandler } from "./$types.js";
import { hasPermission } from "$lib/server/permissions.js";

const log = createLogger("import:confirm");

/**
 * Turning a reviewed document into a record.
 *
 * Every field the reviewer corrected arrives here as an override; anything they
 * left alone keeps what was read off the document. The result is one ledger
 * record with the account that paid or received it on one side and the category
 * on the other — the same shape the expenses and income screens write.
 */
const overridesSchema = z.object({
  // A label ("expense"/"income") from the review screen, or a code.
  document_type: z.union([z.number().int(), z.string()]).optional(),
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
});

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) return new Response("Unauthorized", { status: 401 });
  // Shared ledger: any user with import.change may confirm, not just the uploader.
  if (!hasPermission(locals, "import", "change")) return forbidden();

  const row = db
    .select()
    .from(importQueue)
    .where(eq(importQueue.id, params.jobId))
    .get();

  if (!row) return new Response("Not found", { status: 404 });
  if (row.state !== ImportState.PendingReview) {
    return json(
      { error: "Job is not in pending_review state" },
      { status: 400 },
    );
  }

  // Parse the optional correction body — only present fields override extracted values
  let overrides: z.infer<typeof overridesSchema> = {};
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const parsed = overridesSchema.safeParse(
      await request.json().catch(() => ({})),
    );
    if (!parsed.success) return badRequest(parsed.error);
    overrides = parsed.data;
  }

  // Resolve the document type → DocumentType code (overrides may be a label or a code).
  let docCode: number;
  if (typeof overrides.document_type === "number")
    docCode = overrides.document_type;
  else if (typeof overrides.document_type === "string")
    docCode =
      documentTypeEnum.fromLabel(overrides.document_type) ??
      row.documentType ??
      DocumentType.Expense;
  else docCode = row.documentType ?? DocumentType.Expense;
  const isIncome = docCode === DocumentType.Income;

  // Merge: start from queue row, apply only the overridden fields
  const itemName = overrides.item_name ?? row.itemName ?? "";
  const supplier = overrides.supplier ?? row.supplier ?? "";
  const date = normalizeDate(overrides.date ?? row.date);
  const amount = overrides.amount ?? row.amount ?? 0;
  const reference = overrides.reference ?? row.reference ?? "";
  const category = overrides.category ?? row.category ?? "";
  // remark is human-entered only — the import pipeline never sources it from the LLM.
  const remark = overrides.remark ?? "";

  // Resolve currency + rate (overrides win, then the queued values). For a foreign
  // currency with no rate yet, fetch for the date; if still unavailable, require one.
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
    return json(
      {
        error: `An exchange rate for ${currency} is required. Enter it manually.`,
      },
      { status: 400 },
    );
  }

  // Which account paid for this / received it. The review screen pre-selects one,
  // but a document that reached review before any account existed still has none.
  const accountId =
    overrides.accountId ?? row.accountId ?? defaultAccountId(db);
  if (accountId == null) {
    return refused(
      isIncome
        ? "Say which account received this before importing it."
        : "Say which account paid for this before importing it.",
    );
  }

  // A category that could not be read lands on Uncategorised and is flagged, the
  // same way the upgrade treats a record it could not place: a document that was
  // paid for is still a document that was paid for (spec edge case, FR-019).
  const kind = isIncome ? "income" : "expense";
  const matchedCategoryId = matchCategoryAccount(
    categoryChoices(db, kind),
    category,
  );
  const uncategorised = matchedCategoryId === null;
  const categoryAccountId =
    matchedCategoryId ?? systemAccounts(db).uncategorisedAccountId;

  // Resolve the contact party. createdBy = the uploader (audit), not the confirmer.
  // Priority: explicit contactId → typed new name → confident match → raw extracted name.
  const role = isIncome ? Role.Customer : Role.Supplier;
  const partyRawName = isIncome ? itemName : supplier;
  // If the user edited the party name as free text, don't let a stale fuzzy match win.
  const partyEdited = isIncome
    ? overrides.item_name !== undefined
    : overrides.supplier !== undefined;
  const uploader = row.createdBy;
  let contactId: number | null = null;
  if (typeof overrides.contactId === "number") {
    contactId = overrides.contactId;
  } else if (
    typeof overrides.newContactName === "string" &&
    overrides.newContactName.trim()
  ) {
    contactId = resolveOrCreateContact(
      db,
      overrides.newContactName,
      role,
      uploader,
    );
  } else if (row.matchedContactId && !partyEdited) {
    contactId = row.matchedContactId;
  } else if (partyRawName.trim()) {
    contactId = resolveOrCreateContact(db, partyRawName, role, uploader);
  }

  // Mark as confirmed before the write, so a second click on a slow connection
  // finds the job out of pending_review rather than importing it twice.
  db.update(importQueue)
    .set({
      state: ImportState.Confirmed,
      accountId,
      confirmedAt: new Date().toISOString(),
    })
    .where(eq(importQueue.id, params.jobId))
    .run();

  const sides: RecordCreate = isIncome
    ? {
        kind: "income",
        categoryAccountId,
        receivedIntoAccountId: accountId,
        date,
        description: supplier,
        amount,
        currency,
        exchangeRate,
        contactId,
        reference,
        remark,
        extractedText: row.extractedText,
      }
    : {
        kind: "expense",
        categoryAccountId,
        paidFromAccountId: accountId,
        date,
        description: itemName,
        amount,
        currency,
        exchangeRate,
        contactId,
        reference,
        remark,
        extractedText: row.extractedText,
      };

  const created = createRecord(db, uploader, sides);
  if (!created.ok) {
    // Nothing was written, so the job goes back to the reviewer with the sentence
    // that refused it rather than sitting confirmed against no record.
    db.update(importQueue)
      .set({ state: ImportState.PendingReview, confirmedAt: null })
      .where(eq(importQueue.id, params.jobId))
      .run();
    emitJobUpdate(params.jobId, locals.user.id);
    return refused(created.reason);
  }

  const resultId = created.value.id;

  // Move the file out of temp and attach it to the record. A failed move leaves
  // the temp file where it is and still attaches it, so nothing is lost.
  let attachmentPath = row.tempFilePath;
  try {
    attachmentPath = moveToRecordStorage(row.tempFilePath, date);
  } catch (err) {
    log.error(
      { err, jobId: params.jobId },
      "File move failed (temp file remains recoverable)",
    );
  }
  addAttachment(db, resultId, attachmentPath, displayName(attachmentPath));
  // The record was emitted before it had its receipt, so say it again — this is
  // the same thing adding an attachment by hand does.
  emitRecordUpdate(db, resultId);

  db.update(importQueue)
    .set({
      state: ImportState.Imported,
      resultId,
      resultType: docCode,
      completedAt: new Date().toISOString(),
    })
    .where(eq(importQueue.id, params.jobId))
    .run();
  emitJobUpdate(params.jobId, locals.user.id);

  return json(
    { id: resultId, number: created.value.recordNumber ?? "", uncategorised },
    { status: 201 },
  );
};

function emitJobUpdate(jobId: string, userId: number) {
  const job = db
    .select()
    .from(importQueue)
    .where(eq(importQueue.id, jobId))
    .get();
  if (job) importEvents.emit("job-update", { userId, job });
}
