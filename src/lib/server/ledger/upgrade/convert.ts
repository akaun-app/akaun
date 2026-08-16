import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import {
  claimAttachments,
  claims,
  contacts,
  contactRoles,
  expenseAttachments,
  expenses,
  expenseSearchText,
  incomeAttachments,
  incomes,
  incomeSearchText,
  ledgerMovements,
  ledgerRecords,
  recordAttachments,
  recordSearchText,
  settlements,
  users,
} from "../../db/schema.js";
import {
  EntityType,
  ExpenseStatus,
  ClaimStatus,
  LedgerRecordKind,
  Role,
} from "$lib/enums.js";
import { toMinor } from "../money.js";
import { mainCurrencyCode } from "../../currency/form.js";
import { resolvePayer, resolveUnclaimedExpense } from "./payer.js";
import type { ContactRow, UserRow } from "./payer.js";
import type { SeededAccounts } from "./accounts.js";
import type {
  LedgerDb,
  LegacyKind,
  Minor,
  PayerDecision,
  UpgradeReport,
} from "../types.js";

/**
 * Turning what is already there into records, movements and settlements.
 *
 * Everything is keyed on `(legacy_kind, legacy_id)`, which the schema makes
 * unique — so a rerun skips what it already converted and a run interrupted
 * halfway picks up exactly where it stopped (FR-037, D-14).
 *
 * Two id rules, both about links that already exist:
 *  - a migrated expense KEEPS its id, so every `/expenses/[id]` link anyone has
 *    ever copied still resolves;
 *  - every other converted record is given an id above the highest old expense
 *    id, so it can never collide with one.
 *
 * Every payer decision is delegated to `payer.ts` and only written here, with
 * the step that chose it recorded in the report (FR-036b). This file's job is
 * writing down what the rule decided, not deciding.
 */

/** What one legacy row becomes, before it is written. */
type Conversion = {
  kind: number;
  legacyKind: LegacyKind;
  legacyId: number;
  id?: number;
  date: string;
  recordNumber: string | null;
  description: string;
  contactId: number | null;
  reference: string;
  remark: string;
  currency: string;
  exchangeRate: number;
  amount: number;
  extractedText: string | null;
  createdBy: number | null;
  movements: { accountId: number; amountMinor: Minor; sortOrder: number }[];
};

/** The highest id an expense already has — every other record starts above it. */
function firstFreeIdAboveExpenses(db: LedgerDb): number {
  const highestExpense =
    db
      .select({ max: sql<number | null>`max(${expenses.id})` })
      .from(expenses)
      .get()?.max ?? 0;
  const highestRecord =
    db
      .select({ max: sql<number | null>`max(${ledgerRecords.id})` })
      .from(ledgerRecords)
      .get()?.max ?? 0;
  return Math.max(highestExpense, highestRecord) + 1;
}

/** Which legacy rows have already been converted, so a rerun does nothing twice. */
function alreadyConverted(
  db: LedgerDb,
  legacyKind: LegacyKind,
): Map<number, number> {
  return new Map(
    db
      .select({ legacyId: ledgerRecords.legacyId, id: ledgerRecords.id })
      .from(ledgerRecords)
      .where(eq(ledgerRecords.legacyKind, legacyKind))
      .all()
      .filter((r): r is { legacyId: number; id: number } => r.legacyId !== null)
      .map((r) => [r.legacyId, r.id]),
  );
}

function writeRecord(db: LedgerDb, conversion: Conversion): number {
  const row = db
    .insert(ledgerRecords)
    .values({
      ...(conversion.id !== undefined ? { id: conversion.id } : {}),
      kind: conversion.kind,
      date: conversion.date,
      recordNumber: conversion.recordNumber,
      description: conversion.description,
      contactId: conversion.contactId,
      reference: conversion.reference,
      remark: conversion.remark,
      currency: conversion.currency,
      exchangeRate: conversion.exchangeRate,
      amount: conversion.amount,
      extractedText: conversion.extractedText,
      legacyKind: conversion.legacyKind,
      legacyId: conversion.legacyId,
      createdBy: conversion.createdBy,
      updatedBy: conversion.createdBy,
    })
    .returning({ id: ledgerRecords.id })
    .get()!;

  db.insert(ledgerMovements)
    .values(
      conversion.movements.map((m) => ({
        recordId: row.id,
        accountId: m.accountId,
        amountMinor: m.amountMinor,
        sortOrder: m.sortOrder,
      })),
    )
    .run();

  return row.id;
}

/**
 * The category account a legacy category string belongs to. An empty or unknown
 * one lands on Uncategorised and is flagged, rather than the record being
 * refused — a record with no category is still a record that happened.
 */
function categoryAccountFor(
  seeded: SeededAccounts,
  kind: "expense" | "income",
  name: string | null,
  report: UpgradeReport,
  recordId: number,
): number {
  const trimmed = (name ?? "").trim();
  const byName =
    kind === "expense"
      ? seeded.expenseCategoryByName
      : seeded.incomeCategoryByName;

  const found = trimmed ? byName.get(trimmed) : undefined;
  if (found !== undefined) return found;

  if (!report.uncategorisedRecordIds.includes(recordId)) {
    report.uncategorisedRecordIds.push(recordId);
  }
  return seeded.uncategorisedAccountId;
}

/**
 * Who each claim is owed to, worked out once per creating user account rather
 * than once per claim — the answer cannot differ between two claims the same
 * account created, and creating the same contact twice would be a bug.
 */
function payerByCreator(
  db: LedgerDb,
  creatorIds: number[],
): Map<number, PayerDecision> {
  const decisions = new Map<number, PayerDecision>();
  if (creatorIds.length === 0) return decisions;

  const allUsers: UserRow[] = db
    .select({
      id: users.id,
      username: users.username,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .all();

  const allContacts = (): ContactRow[] =>
    db
      .select({
        id: contacts.id,
        legalName: contacts.legalName,
        email: contacts.email,
      })
      .from(contacts)
      .all();

  for (const creatorId of new Set(creatorIds)) {
    const creator = allUsers.find((u) => u.id === creatorId);
    if (!creator) continue;

    // Re-read the contacts each time round: a contact created for an earlier
    // account must be found by a later one rather than created twice.
    const decision = resolvePayer(creator, allUsers, allContacts());

    if (decision.step === "created-contact" && decision.createName) {
      const created = db
        .insert(contacts)
        .values({
          entityType: EntityType.Individual,
          legalName: decision.createName,
          email: creator.email || null,
        })
        .returning({ id: contacts.id })
        .get()!;
      db.insert(contactRoles)
        .values({ contactId: created.id, role: Role.Employee })
        .onConflictDoNothing()
        .run();
      decisions.set(creatorId, { ...decision, contactId: created.id });
    } else {
      decisions.set(creatorId, decision);
    }
  }

  return decisions;
}

export function convertLegacyRecords(
  db: LedgerDb,
  seeded: SeededAccounts,
  report: UpgradeReport,
): void {
  let nextId = firstFreeIdAboveExpenses(db);

  const expenseRows = db
    .select()
    .from(expenses)
    .orderBy(asc(expenses.id))
    .all();
  const incomeRows = db.select().from(incomes).orderBy(asc(incomes.id)).all();
  const claimRows = db.select().from(claims).orderBy(asc(claims.id)).all();

  const doneExpenses = alreadyConverted(db, "expense");
  const doneIncomes = alreadyConverted(db, "income");
  const doneClaims = alreadyConverted(db, "claim");

  // --- Who each reimbursement is owed to (FR-036b) ------------------------
  const payers = payerByCreator(
    db,
    claimRows.map((c) => c.createdBy).filter((id): id is number => id !== null),
  );

  /** The contact a claimed expense is owed to: whoever the claim is owed to. */
  const contactForClaim = new Map<number, number | null>();
  for (const claim of claimRows) {
    const decision = claim.createdBy ? payers.get(claim.createdBy) : undefined;
    contactForClaim.set(claim.id, decision?.contactId ?? null);
  }

  // --- Expenses -----------------------------------------------------------
  const expenseRecordIds = new Map<number, number>(doneExpenses);
  const payableForExpense = new Map<number, boolean>();

  for (const row of expenseRows) {
    const claimed = row.claimId !== null;
    const owedContactId = claimed
      ? (contactForClaim.get(row.claimId!) ?? null)
      : null;

    // FR-036c — an expense that was never marked paid and was never on a
    // reimbursement stays owed to whoever it names, and falls back to the bank
    // when it names nobody.
    const unclaimedDecision =
      !claimed && row.status !== ExpenseStatus.Paid
        ? resolveUnclaimedExpense(row.contactId)
        : null;

    const contactId = claimed
      ? owedContactId
      : (unclaimedDecision?.contactId ?? row.contactId);

    // The other side is Money we owe when somebody else's money paid for it —
    // a reimbursement, or an unpaid bill naming a supplier. Otherwise it came
    // out of the default bank account, which is what today's one-sided model
    // already assumes (FR-032a).
    const owed =
      (claimed && owedContactId !== null) ||
      unclaimedDecision?.step === "named-contact";

    payableForExpense.set(row.id, owed);

    if (doneExpenses.has(row.id)) continue;

    const amountMinor = toMinor(row.amount, row.exchangeRate);
    const categoryAccountId = categoryAccountFor(
      seeded,
      "expense",
      row.category,
      report,
      row.id,
    );

    if (unclaimedDecision?.step === "bank-fallback") {
      report.bankFallbackRecordIds.push(row.id);
    }

    const recordId = writeRecord(db, {
      // A migrated expense keeps its id, so every existing link still resolves.
      id: row.id,
      kind: LedgerRecordKind.Expense,
      legacyKind: "expense",
      legacyId: row.id,
      date: row.date,
      recordNumber: row.expenseNumber,
      description: row.itemName,
      contactId,
      reference: row.reference,
      remark: row.remark,
      currency: row.currency,
      exchangeRate: row.exchangeRate,
      amount: row.amount,
      extractedText: row.extractedText,
      createdBy: row.createdBy,
      movements: [
        { accountId: categoryAccountId, amountMinor, sortOrder: 0 },
        {
          accountId: owed ? seeded.payableAccountId : seeded.defaultAccountId,
          amountMinor: -amountMinor,
          sortOrder: 1,
        },
      ],
    });
    expenseRecordIds.set(row.id, recordId);
    nextId = Math.max(nextId, recordId + 1);
  }

  // --- Income -------------------------------------------------------------
  for (const row of incomeRows) {
    if (doneIncomes.has(row.id)) continue;

    const amountMinor = toMinor(row.amount, row.exchangeRate);
    const categoryAccountId = categoryAccountFor(
      seeded,
      "income",
      row.category,
      report,
      nextId,
    );

    writeRecord(db, {
      id: nextId,
      kind: LedgerRecordKind.Income,
      legacyKind: "income",
      legacyId: row.id,
      date: row.date,
      recordNumber: row.incomeNumber,
      description: row.descriptionText,
      contactId: row.contactId,
      reference: row.reference,
      remark: row.remark,
      currency: row.currency,
      exchangeRate: row.exchangeRate,
      amount: row.amount,
      extractedText: row.extractedText,
      createdBy: row.createdBy,
      movements: [
        { accountId: seeded.defaultAccountId, amountMinor, sortOrder: 0 },
        {
          accountId: categoryAccountId,
          amountMinor: -amountMinor,
          sortOrder: 1,
        },
      ],
    });
    nextId += 1;
  }

  // --- Claims → payments + settlements ------------------------------------
  for (const claim of claimRows) {
    if (doneClaims.has(claim.id)) continue;

    const covered = expenseRows.filter((e) => e.claimId === claim.id);
    if (covered.length === 0) continue;

    const contactId = contactForClaim.get(claim.id) ?? null;
    // Without a contact there is nobody for the payment to be from, and
    // invariant 4 would refuse it. The expenses stay owed and the report says
    // which reimbursement could not be attributed.
    if (contactId === null) continue;

    const decision = claim.createdBy ? payers.get(claim.createdBy) : undefined;
    if (decision) {
      report.payerAttributions.push({
        legacyKind: "claim",
        legacyId: claim.id,
        step: decision.step,
        contactId,
        contactName:
          db
            .select({ legalName: contacts.legalName })
            .from(contacts)
            .where(eq(contacts.id, contactId))
            .get()?.legalName ?? null,
      });
    }

    // A claim has no amount of its own — it is the sum of what it covered.
    const totalMinor = covered.reduce(
      (sum, e) => sum + toMinor(e.amount, e.exchangeRate),
      0,
    );
    if (totalMinor === 0) continue;

    // A claim that was never completed means no money has actually moved, so
    // there is no payment to record — the amounts simply stay outstanding
    // against the payer (FR-036).
    if (claim.status !== ClaimStatus.Done) continue;

    const paymentRecordId = writeRecord(db, {
      id: nextId,
      kind: LedgerRecordKind.Payment,
      legacyKind: "claim",
      legacyId: claim.id,
      date: claim.date,
      // The claim carries its own number onto the payment it becomes; no number
      // is ever regenerated (FR-032d, FR-032e).
      recordNumber: claim.claimNumber,
      description: `Reimbursement ${claim.claimNumber}`,
      contactId,
      reference: "",
      remark: "",
      // A claim carried no currency of its own; it settles expenses that are
      // already converted to the main currency, so that is what it is in.
      currency: mainCurrencyCode(db),
      exchangeRate: 1,
      amount: totalMinor / 100,
      extractedText: null,
      createdBy: claim.createdBy,
      movements: [
        {
          accountId: seeded.payableAccountId,
          amountMinor: totalMinor,
          sortOrder: 0,
        },
        {
          accountId: seeded.defaultAccountId,
          amountMinor: -totalMinor,
          sortOrder: 1,
        },
      ],
    });
    nextId += 1;

    // One settlement per covered expense, linking the payment's Payable
    // movement to that expense's Payable movement (FR-035, FR-036).
    const paymentMovement = db
      .select({ id: ledgerMovements.id })
      .from(ledgerMovements)
      .where(
        and(
          eq(ledgerMovements.recordId, paymentRecordId),
          eq(ledgerMovements.accountId, seeded.payableAccountId),
        ),
      )
      .get();

    if (!paymentMovement) continue;

    for (const expense of covered) {
      const recordId = expenseRecordIds.get(expense.id);
      if (recordId === undefined) continue;

      const owedMovement = db
        .select({
          id: ledgerMovements.id,
          amountMinor: ledgerMovements.amountMinor,
        })
        .from(ledgerMovements)
        .where(
          and(
            eq(ledgerMovements.recordId, recordId),
            eq(ledgerMovements.accountId, seeded.payableAccountId),
          ),
        )
        .get();
      if (!owedMovement) continue;

      db.insert(settlements)
        .values({
          paymentMovementId: paymentMovement.id,
          owedMovementId: owedMovement.id,
          amountMinor: Math.abs(owedMovement.amountMinor),
          createdBy: claim.createdBy,
        })
        .onConflictDoNothing()
        .run();
    }
  }

  convertSearchText(db);
  convertAttachmentRows(db);
}

/**
 * Search text carries across unchanged in shape, so every reference number stays
 * findable exactly as it was typed (SC-013).
 */
function convertSearchText(db: LedgerDb): void {
  const pairs: {
    legacyKind: LegacyKind;
    rows: { id: number; text: string }[];
  }[] = [
    {
      legacyKind: "expense",
      rows: db
        .select({
          id: expenseSearchText.expenseId,
          text: expenseSearchText.text,
        })
        .from(expenseSearchText)
        .all(),
    },
    {
      legacyKind: "income",
      rows: db
        .select({ id: incomeSearchText.incomeId, text: incomeSearchText.text })
        .from(incomeSearchText)
        .all(),
    },
  ];

  for (const { legacyKind, rows } of pairs) {
    const byLegacyId = alreadyConverted(db, legacyKind);
    for (const row of rows) {
      const recordId = byLegacyId.get(row.id);
      if (recordId === undefined) continue;
      db.insert(recordSearchText)
        .values({ recordId, text: row.text })
        .onConflictDoUpdate({
          target: recordSearchText.recordId,
          set: { text: row.text },
        })
        .run();
    }
  }
}

/**
 * The attachment ROWS move here; the FILES move in `attachments.ts`, which
 * copies and verifies them before anything is removed. Splitting the two is
 * what lets the row point at its old path until the copy is proven (D-16).
 */
function convertAttachmentRows(db: LedgerDb): void {
  const sources: {
    legacyKind: LegacyKind;
    rows: {
      legacyId: number;
      filename: string;
      displayName: string;
      addedDate: string;
    }[];
  }[] = [
    {
      legacyKind: "expense",
      rows: db
        .select({
          legacyId: expenseAttachments.expenseId,
          filename: expenseAttachments.filename,
          displayName: expenseAttachments.displayName,
          addedDate: expenseAttachments.addedDate,
        })
        .from(expenseAttachments)
        .all(),
    },
    {
      legacyKind: "income",
      rows: db
        .select({
          legacyId: incomeAttachments.incomeId,
          filename: incomeAttachments.filename,
          displayName: incomeAttachments.displayName,
          addedDate: incomeAttachments.addedDate,
        })
        .from(incomeAttachments)
        .all(),
    },
    {
      legacyKind: "claim",
      rows: db
        .select({
          legacyId: claimAttachments.claimId,
          filename: claimAttachments.filename,
          displayName: claimAttachments.displayName,
          addedDate: claimAttachments.addedDate,
        })
        .from(claimAttachments)
        .all(),
    },
  ];

  // A rerun must not attach the same file twice, and the file's original path
  // is what identifies it — `legacy_filename` is set on the way in and is
  // therefore the idempotency key here too.
  const existing = new Set(
    db
      .select({ legacyFilename: recordAttachments.legacyFilename })
      .from(recordAttachments)
      .where(isNotNull(recordAttachments.legacyFilename))
      .all()
      .map((r) => r.legacyFilename as string),
  );

  for (const { legacyKind, rows } of sources) {
    const byLegacyId = alreadyConverted(db, legacyKind);
    for (const row of rows) {
      if (existing.has(row.filename)) continue;
      const recordId = byLegacyId.get(row.legacyId);
      if (recordId === undefined) continue;

      db.insert(recordAttachments)
        .values({
          recordId,
          // Still pointing where it was: the file has not moved yet, and must
          // not be assumed to have until `attachments.ts` proves the copy.
          filename: row.filename,
          displayName: row.displayName,
          addedDate: row.addedDate,
          legacyFilename: row.filename,
        })
        .run();
      existing.add(row.filename);
    }
  }
}
