import { and, eq } from "drizzle-orm";
import {
  DefaultAccountPurpose,
  DocumentType,
  ImportState,
  Role,
} from "$lib/enums.js";
import { importQueue } from "../db/schema.js";
import { STORAGE_PATH } from "../env.js";
import {
  displayName,
  fileExists,
  moveToRecordStorage,
  returnToTemp,
} from "../file-storage.js";
import { validateImportAccountPair } from "../import/account-policy.js";
import {
  categoryAccountForImport,
  categoryChoices,
  matchCategoryAccount,
  resolvePaidFromAccountId,
} from "../import/category-accounts.js";
import { importEvents } from "../import/events.js";
import type {
  LedgerDb,
  RecordCreate,
  RecordView,
  Refusable,
} from "../ledger/types.js";
import { createLogger } from "../logger.js";
import { defaultAccountId, getAccount } from "../queries/accounts.js";
import { resolveOrCreateContact } from "../queries/contacts.js";
import { addAttachment } from "../queries/ledger.js";
import { requireAccountDefault } from "./account-defaults.js";
import { createRecord, type DeferredEmits } from "./ledger.js";

const log = createLogger("import:confirm");

/**
 * Turning a reviewed document into a record.
 *
 * The route reads the request, checks it, and works out every field the
 * reviewer settled on: their correction where they made one, and what was read
 * off the document where they did not. This service takes those settled fields
 * and does the writing, so any caller that has review fields (today the
 * receipt's queue row) confirms the same way.
 */

/** The document being confirmed: what the queue row holds about the file. */
export type ImportJobSource = {
  jobId: string;
  /** Who uploaded the file. The record and any new contact are theirs. */
  uploadedBy: number;
  tempFilePath: string;
  /** Carried onto the record so it can be searched. */
  extractedText: string | null;
};

/** What the record will say, after the reviewer's corrections are applied. */
export type ImportReviewFields = {
  /** A DocumentType code. Two explicit accounts below can still change it. */
  documentType: number;
  description: string;
  /** The other party's name, for an expense or an income alike. */
  partyName: string;
  /** True when the reviewer typed the name, so an older match must not win. */
  partyEdited: boolean;
  /** `YYYY-MM-DD`. The record's date, and the month its file is filed under. */
  date: string;
  amount: number;
  currency: string;
  /** Already known here: the route looks it up before calling. */
  exchangeRate: number;
  reference: string;
  /** The category name, used when no category account was matched. */
  category: string;
  /** The category account the reader matched, if any. */
  categoryAccountId: number | null;
  remark: string;
  /** The account that paid or received it. Null means use the default. */
  accountId: number | null;
  /** Both accounts, when the reviewer chose them. */
  sides: { fromAccountId: number; toAccountId: number } | null;
  /** A contact the reviewer picked. */
  contactId?: number;
  /** A new contact name the reviewer typed. */
  newContactName?: string;
  /** The contact the reader matched, and the document type it matched for. */
  matchedContact: { id: number; documentType: number | null } | null;
};

export type ImportConfirmed = {
  record: RecordView;
  /** True when the record went to the Uncategorised account. */
  uncategorised: boolean;
};

/** Thrown inside the transaction to undo every write in it. */
class Refused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/**
 * Confirms one reviewed document.
 *
 * Every write happens in one transaction, and the first write is a claim: the
 * job moves out of review only if it is still in review. So when two confirms
 * of the same job arrive together, only one makes a record, and the other is
 * refused. When a rule refuses the record, the transaction is undone as a
 * whole: no contact is left behind, and the job is still waiting for review.
 *
 * Nothing is announced to open tabs until the transaction has committed.
 */
export function confirmImportRow(
  db: LedgerDb,
  job: ImportJobSource,
  fields: ImportReviewFields,
  options: { actingUserId: number; storageRoot?: string },
): Refusable<ImportConfirmed> {
  const root = options.storageRoot ?? STORAGE_PATH;
  const emits: DeferredEmits = [];
  // The file move is not part of the transaction, so it is undone by hand.
  // It runs as the last step before the attachment row: after the claim and
  // after the record was accepted, so a refusal never touches the file. If
  // the transaction still fails after the move, the file goes back to its temp
  // path, and the job in review finds its file again. On success the file is
  // already where the attachment points. The move and the transaction are one
  // synchronous run, so no other request in this process can come between them.
  const file: { moved: { from: string; to: string } | null } = { moved: null };

  let confirmed: ImportConfirmed;
  try {
    confirmed = db.transaction(() => {
      const written = writeConfirmation(db, job, fields, root, emits, file);
      if (!written.ok) throw new Refused(written.reason);
      return written.value;
    });
  } catch (err) {
    if (file.moved) returnToTemp(file.moved.to, file.moved.from, root);
    if (err instanceof Refused) return { ok: false, reason: err.reason };
    throw err;
  }

  for (const emit of emits) emit();
  emitJobUpdate(db, job.jobId, options.actingUserId);
  return { ok: true, value: confirmed };
}

/** Every write of a confirm. Runs inside the caller's transaction. */
function writeConfirmation(
  db: LedgerDb,
  job: ImportJobSource,
  fields: ImportReviewFields,
  root: string,
  emits: DeferredEmits,
  file: { moved: { from: string; to: string } | null },
): Refusable<ImportConfirmed> {
  const resolved = resolveSides(db, fields);
  if (!resolved.ok) return resolved;
  const {
    docCode,
    isIncome,
    categoryAccountId,
    accountId,
    paidFromAccountId,
    uncategorised,
  } = resolved.value;

  // The claim. It only matches a job that is still in review, so a second
  // confirm of the same job (a double click, a second tab) changes no row.
  const claimed = db
    .update(importQueue)
    .set({
      state: ImportState.Confirmed,
      accountId,
      documentType: docCode,
      confirmedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(importQueue.id, job.jobId),
        eq(importQueue.state, ImportState.PendingReview),
      ),
    )
    .returning({ id: importQueue.id })
    .get();
  if (!claimed) {
    return {
      ok: false,
      reason:
        "This document is no longer waiting for review, so it was not imported again.",
    };
  }

  const contactId = resolveContact(db, job, fields, docCode, isIncome);

  const common = {
    categoryAccountId,
    date: fields.date,
    description: fields.description,
    amount: fields.amount,
    currency: fields.currency,
    exchangeRate: fields.exchangeRate,
    contactId,
    reference: fields.reference,
    remark: fields.remark,
    extractedText: job.extractedText,
  };
  const sides: RecordCreate = isIncome
    ? { kind: "income", receivedIntoAccountId: accountId, ...common }
    : { kind: "expense", paidFromAccountId, ...common };

  const created = createRecord(db, job.uploadedBy, sides, emits);
  if (!created.ok) return created;

  // Move the file out of temp and attach it to the record. A failed move
  // leaves the temp file where it is and still attaches it, so nothing is lost.
  let attachmentPath = job.tempFilePath;
  try {
    const movedHere = fileExists(job.tempFilePath, root);
    attachmentPath = moveToRecordStorage(job.tempFilePath, fields.date, root);
    if (movedHere) file.moved = { from: job.tempFilePath, to: attachmentPath };
  } catch (err) {
    log.error(
      { err, jobId: job.jobId },
      "File move failed (temp file remains recoverable)",
    );
  }
  addAttachment(
    db,
    created.value.id,
    attachmentPath,
    displayName(attachmentPath),
  );

  db.update(importQueue)
    .set({
      state: ImportState.Imported,
      resultId: created.value.id,
      resultType: docCode,
      completedAt: new Date().toISOString(),
    })
    .where(eq(importQueue.id, job.jobId))
    .run();

  return { ok: true, value: { record: created.value, uncategorised } };
}

type ResolvedSides = {
  docCode: number;
  isIncome: boolean;
  categoryAccountId: number;
  accountId: number;
  paidFromAccountId: number | null;
  uncategorised: boolean;
};

/**
 * Which accounts the record names. Only reads: a refusal here has written
 * nothing yet.
 */
function resolveSides(
  db: LedgerDb,
  fields: ImportReviewFields,
): Refusable<ResolvedSides> {
  let docCode = fields.documentType;
  let isIncome = docCode === DocumentType.Income;

  const payableDefault = requireAccountDefault(
    db,
    DefaultAccountPurpose.Payable,
  );
  const payableAccountId = payableDefault.ok ? payableDefault.value : null;

  // A category that could not be read lands on Uncategorised and is flagged, the
  // same way the upgrade treats a record it could not place: a document that was
  // paid for is still a document that was paid for (spec edge case, FR-019).
  const uncategorisedExpenseDefault = requireAccountDefault(
    db,
    DefaultAccountPurpose.UncategorisedExpense,
  );
  const uncategorisedIncomeDefault = requireAccountDefault(
    db,
    DefaultAccountPurpose.UncategorisedIncome,
  );
  let categoryAccountId: number;
  let uncategorised: boolean;
  if (fields.sides) {
    const from = getAccount(db, fields.sides.fromAccountId);
    const to = getAccount(db, fields.sides.toAccountId);
    if (!from || !to) {
      return { ok: false, reason: "Choose accounts that are still available." };
    }
    const receivableDefault = requireAccountDefault(
      db,
      DefaultAccountPurpose.Receivable,
    );
    const pair = validateImportAccountPair(
      from,
      to,
      payableAccountId,
      receivableDefault.ok ? receivableDefault.value : null,
    );
    if (!pair.ok) return pair;
    docCode =
      pair.kind === "income" ? DocumentType.Income : DocumentType.Expense;
    isIncome = docCode === DocumentType.Income;
    categoryAccountId = isIncome ? from.id : to.id;
    const categoryDefault = isIncome
      ? uncategorisedIncomeDefault
      : uncategorisedExpenseDefault;
    uncategorised =
      categoryDefault.ok && categoryAccountId === categoryDefault.value;
  } else {
    const kind = isIncome ? "income" : "expense";
    const choices = categoryChoices(db, kind);
    const categoryDefault = isIncome
      ? uncategorisedIncomeDefault
      : uncategorisedExpenseDefault;
    const selectedAccountId =
      fields.categoryAccountId ??
      matchCategoryAccount(choices, fields.category);
    const selectedCategory = categoryAccountForImport(
      kind,
      choices,
      selectedAccountId,
      categoryDefault.ok ? categoryDefault.value : null,
    );
    if (!selectedCategory.ok) return selectedCategory;
    categoryAccountId = selectedCategory.value.accountId;
    uncategorised = selectedCategory.value.uncategorised;
  }

  const accountId = fields.sides
    ? isIncome
      ? fields.sides.toAccountId
      : fields.sides.fromAccountId
    : (fields.accountId ?? defaultAccountId(db));
  if (accountId == null) {
    return {
      ok: false,
      reason: isIncome
        ? "Say which account received this before importing it."
        : "Say which account paid for this before importing it.",
    };
  }

  return {
    ok: true,
    value: {
      docCode,
      isIncome,
      categoryAccountId,
      accountId,
      paidFromAccountId: resolvePaidFromAccountId(
        accountId,
        isIncome,
        payableAccountId,
      ),
      uncategorised,
    },
  };
}

/**
 * The contact the record names. The uploader creates any new contact, not the
 * person confirming. Order: a contact the reviewer picked, then a name they
 * typed, then a confident match from reading, then the name as read. Which
 * contacts are searched (suppliers or customers) depends on the kind.
 */
function resolveContact(
  db: LedgerDb,
  job: ImportJobSource,
  fields: ImportReviewFields,
  docCode: number,
  isIncome: boolean,
): number | null {
  const role = isIncome ? Role.Customer : Role.Supplier;
  if (typeof fields.contactId === "number") return fields.contactId;
  if (
    typeof fields.newContactName === "string" &&
    fields.newContactName.trim()
  ) {
    return resolveOrCreateContact(
      db,
      fields.newContactName,
      role,
      job.uploadedBy,
    );
  }
  // A match made for the other kind searched the wrong contacts, and a name
  // the reviewer edited replaces whatever was matched.
  if (
    fields.matchedContact?.id &&
    !fields.partyEdited &&
    fields.matchedContact.documentType === docCode
  ) {
    return fields.matchedContact.id;
  }
  if (fields.partyName.trim()) {
    return resolveOrCreateContact(db, fields.partyName, role, job.uploadedBy);
  }
  return null;
}

function emitJobUpdate(db: LedgerDb, jobId: string, userId: number) {
  const job = db
    .select()
    .from(importQueue)
    .where(eq(importQueue.id, jobId))
    .get();
  if (job) importEvents.emit("job-update", { userId, job });
}
