import { json } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "$lib/server/db/client.js";
import { importQueue } from "$lib/server/db/schema.js";
import { badRequest, forbidden, refused } from "$lib/server/api-response.js";
import { normalizeDate } from "$lib/server/date.js";
import { confirmImportRow } from "$lib/server/services/import.js";
import { getExchangeRate } from "$lib/server/currency/rates.js";
import { mainCurrencyCode } from "$lib/server/currency/form.js";
import { ImportState, DocumentType, documentTypeEnum } from "$lib/enums.js";
import type { RequestHandler } from "./$types.js";
import { hasPermission } from "$lib/server/permissions.js";

/**
 * Turning a reviewed document into a record.
 *
 * Every field the reviewer corrected arrives here as an override; anything they
 * left alone keeps what was read off the document. The result is one ledger
 * record with the account that paid or received it on one side and the category
 * on the other — the same shape the expenses and income screens write.
 *
 * This route reads and checks the request, and looks up an exchange rate when
 * one is missing, which can take a moment. `confirmImportRow` then does every
 * write in one transaction.
 */
const overridesSchema = z.object({
  // A label ("expense"/"income") from the review screen, or a code.
  document_type: z.union([z.number().int(), z.string()]).optional(),
  // item_name = the description; supplier = the other party's name — always, regardless
  // of expense or income (see partyName / description below).
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
  // An early answer for the usual case. The final check is the claim inside
  // `confirmImportRow`, because the job can change while this route waits.
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
  if (
    (overrides.fromAccountId === undefined) !==
    (overrides.toAccountId === undefined)
  ) {
    return refused(
      "Choose both the source and target account before importing.",
    );
  }
  const sides =
    overrides.fromAccountId !== undefined && overrides.toAccountId !== undefined
      ? {
          fromAccountId: overrides.fromAccountId,
          toAccountId: overrides.toAccountId,
        }
      : null;

  const confirmed = confirmImportRow(
    db,
    {
      jobId: params.jobId,
      uploadedBy: row.createdBy,
      tempFilePath: row.tempFilePath,
      extractedText: row.extractedText,
    },
    {
      documentType: docCode,
      description: itemName,
      partyName: supplier,
      // If the user edited the party name as free text, don't let a stale fuzzy match win.
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
    { actingUserId: locals.user.id },
  );
  if (!confirmed.ok) return refused(confirmed.reason);

  const { record, uncategorised } = confirmed.value;
  return json(
    { id: record.id, number: record.recordNumber ?? "", uncategorised },
    { status: 201 },
  );
};
