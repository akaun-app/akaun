// src/lib/server/enums.ts
// Single source of truth for ALL closed-set enum codes in the app.
// Stored in the DB as INTEGER. Codes are APPEND-ONLY — never reuse or renumber
// a retired code, or historical rows silently change meaning.
//
// Open-ended string keys that grow as the app gains features
// (e.g. group_permissions.resource, user-defined category) stay TEXT — they are
// keys, not value enums, and do not belong here.

// --- contacts ---
export const EntityType = { Individual: 1, Business: 2 } as const;
export const Role = {
  Customer: 1,
  Supplier: 2,
  Employee: 3,
  Partner: 4,
} as const;

// --- expenses / claims ---
// `ExpenseStatus` and `ClaimStatus` were here. Payment state is never stored:
// paid, part-paid and owed are derived from settlements at read time, so there
// is no status code left to name (FR-037, FR-012). `DocumentType` below stays —
// it is still live in the import pipeline.

// --- import_queue ---
export const ImportState = {
  Queued: 1,
  Extracting: 2,
  Processing: 3,
  PendingReview: 4,
  Confirmed: 5,
  Imported: 6,
  Skipped: 7,
  Failed: 8,
} as const;
// DocumentType is also used for import_queue.result_type
export const DocumentType = { Expense: 1, Income: 2 } as const;

// --- reset scope ---
export const ResetScope = { Settings: 1, Data: 2, Everything: 3 } as const;

// ---------------------------------------------------------------------------
// Label maps + helpers. API bodies use INT codes; responses may also include a
// resolved label for client convenience.
// ---------------------------------------------------------------------------

export type EntityTypeCode = (typeof EntityType)[keyof typeof EntityType];
export type RoleCode = (typeof Role)[keyof typeof Role];
export type ImportStateCode = (typeof ImportState)[keyof typeof ImportState];
export type DocumentTypeCode = (typeof DocumentType)[keyof typeof DocumentType];
export type ResetScopeCode = (typeof ResetScope)[keyof typeof ResetScope];

export const EntityTypeLabels: Record<number, string> = {
  [EntityType.Individual]: "Individual",
  [EntityType.Business]: "Business",
};

export const RoleLabels: Record<number, string> = {
  [Role.Customer]: "Customer",
  [Role.Supplier]: "Supplier",
  [Role.Employee]: "Employee",
  [Role.Partner]: "Partner",
};

export const ImportStateLabels: Record<number, string> = {
  [ImportState.Queued]: "queued",
  [ImportState.Extracting]: "extracting",
  [ImportState.Processing]: "processing",
  [ImportState.PendingReview]: "pending_review",
  [ImportState.Confirmed]: "confirmed",
  [ImportState.Imported]: "imported",
  [ImportState.Skipped]: "skipped",
  [ImportState.Failed]: "failed",
};

export const DocumentTypeLabels: Record<number, string> = {
  [DocumentType.Expense]: "expense",
  [DocumentType.Income]: "income",
};

export const ResetScopeLabels: Record<number, string> = {
  [ResetScope.Settings]: "settings",
  [ResetScope.Data]: "data",
  [ResetScope.Everything]: "everything",
};

function invert(labels: Record<number, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [code, label] of Object.entries(labels)) out[label] = Number(code);
  return out;
}

function makeEnum(labels: Record<number, string>) {
  const byLabel = invert(labels);
  return {
    toLabel(code: number | null | undefined): string | null {
      if (code == null) return null;
      return labels[code] ?? null;
    },
    fromLabel(label: string | null | undefined): number | null {
      if (label == null) return null;
      return byLabel[label] ?? null;
    },
  };
}

export const entityTypeEnum = makeEnum(EntityTypeLabels);
export const roleEnum = makeEnum(RoleLabels);
export const importStateEnum = makeEnum(ImportStateLabels);
export const documentTypeEnum = makeEnum(DocumentTypeLabels);
export const resetScopeEnum = makeEnum(ResetScopeLabels);

// --- quotations ---
export const QuotationStatus = {
  Draft: 1,
  Sent: 2,
  Accepted: 3,
  Declined: 4,
  Converted: 5,
} as const;
// reserved (DERIVED, never stored): Expired — expiry_date < today && status ∈ {Draft, Sent}
export type QuotationStatusCode =
  (typeof QuotationStatus)[keyof typeof QuotationStatus];
export const QuotationStatusLabels: Record<number, string> = {
  [QuotationStatus.Draft]: "draft",
  [QuotationStatus.Sent]: "sent",
  [QuotationStatus.Accepted]: "accepted",
  [QuotationStatus.Declined]: "declined",
  [QuotationStatus.Converted]: "converted",
};
export const quotationStatusEnum = makeEnum(QuotationStatusLabels);

// --- invoices ---
export const InvoiceStatus = {
  Draft: 1,
  Sent: 2,
  Paid: 3,
  Cancelled: 4,
} as const;
// reserved (DERIVED, never stored): Overdue — due_date < today && status !== Paid
// reserved (FUTURE): PartiallyPaid = 5
export type InvoiceStatusCode =
  (typeof InvoiceStatus)[keyof typeof InvoiceStatus];
export const InvoiceStatusLabels: Record<number, string> = {
  [InvoiceStatus.Draft]: "draft",
  [InvoiceStatus.Sent]: "sent",
  [InvoiceStatus.Paid]: "paid",
  [InvoiceStatus.Cancelled]: "cancelled",
};
export const invoiceStatusEnum = makeEnum(InvoiceStatusLabels);

// --- document templates ---
export const TemplateDocumentType = {
  Quotation: 1,
  Invoice: 2,
  Both: 3,
} as const;
// reserved: per-document override (future — no stored status change)
export type TemplateDocumentTypeCode =
  (typeof TemplateDocumentType)[keyof typeof TemplateDocumentType];
export const TemplateDocumentTypeLabels: Record<number, string> = {
  [TemplateDocumentType.Quotation]: "quotation",
  [TemplateDocumentType.Invoice]: "invoice",
  [TemplateDocumentType.Both]: "both",
};
export const templateDocumentTypeEnum = makeEnum(TemplateDocumentTypeLabels);

// --- reconciliation ---
// RETIRED, RESERVED. Which ledger table a polymorphic reconciliation reference
// used to point at, before an allocation began pointing at a ledger movement
// (`reconciliation_allocations.movement_id`). Nothing writes these codes any
// more; they stay here so codes 1-3 are never reused and any surviving
// pre-upgrade `item_type` value keeps its original meaning while the two legacy
// columns are still readable. Removed with them in the release that drops the
// legacy tables. See specs/002-double-entry-ledger research.md D-11.
export const ReconItemType = { Expense: 1, Claim: 2, Income: 3 } as const;
// ClosedMatched = every statement line was matched; ClosedWithLeftovers = the
// session closed with unresolved records or statement lines.
// Statement amounts are stored positive; the sign lives here.
export const StatementDirection = { In: 1, Out: 2 } as const;
// NotYetCleared = a timing difference, the item stays in scope. WillNotClear =
// never a bank transaction, excluded from candidates and from leftovers.
// Progress of the most recent statement upload into a session.
export const StatementExtractionState = {
  Idle: 1,
  Extracting: 2,
  Ready: 3,
  Failed: 4,
} as const;

export type ReconItemTypeCode =
  (typeof ReconItemType)[keyof typeof ReconItemType];
export type StatementDirectionCode =
  (typeof StatementDirection)[keyof typeof StatementDirection];
export type StatementExtractionStateCode =
  (typeof StatementExtractionState)[keyof typeof StatementExtractionState];

export const ReconItemTypeLabels: Record<number, string> = {
  [ReconItemType.Expense]: "expense",
  [ReconItemType.Claim]: "claim",
  [ReconItemType.Income]: "income",
};

export const StatementDirectionLabels: Record<number, string> = {
  [StatementDirection.In]: "in",
  [StatementDirection.Out]: "out",
};

export const StatementExtractionStateLabels: Record<number, string> = {
  [StatementExtractionState.Idle]: "idle",
  [StatementExtractionState.Extracting]: "extracting",
  [StatementExtractionState.Ready]: "ready",
  [StatementExtractionState.Failed]: "failed",
};

export const reconItemTypeEnum = makeEnum(ReconItemTypeLabels);
export const statementDirectionEnum = makeEnum(StatementDirectionLabels);
export const statementExtractionStateEnum = makeEnum(
  StatementExtractionStateLabels,
);

// --- ledger ---
// A role belongs to a *pot* and is set once when the account is created,
// outliving thousands of records. It is what the account is for, and it is what
// `AccountType` is derived from (never stored — see ledger/account-type.ts).
export const AccountRole = {
  Bank: 1,
  Wallet: 2,
  Cash: 3,
  Card: 4, // places money sits
  Equipment: 5, // things the business owns and keeps
  Receivable: 6, // shared "money owed to us"   (system)
  Payable: 7, // shared "money we owe"       (system)
  OpeningBalances: 8, // where opening balances come from (system)
  PartnerCapital: 9,
  PartnerDrawings: 10, // one pair per partner contact
  ExpenseCategory: 11,
  IncomeCategory: 12, // what everyday screens call a category
} as const;

export const AccountType = {
  Asset: 1,
  Liability: 2,
  Equity: 3,
  Income: 4,
  Expense: 5,
} as const;

// A kind belongs to one *event* on one date. It carries intent the movements
// cannot: equipment bought looks exactly like money moved, and a direct journal
// entry looks exactly like an expense.
export const LedgerRecordKind = {
  Expense: 1,
  Income: 2,
  Transfer: 3,
  Payment: 4,
  OpeningBalance: 5,
  InvoiceIssue: 6,
  Journal: 7,
} as const;

export type AccountRoleCode = (typeof AccountRole)[keyof typeof AccountRole];
export type AccountTypeCode = (typeof AccountType)[keyof typeof AccountType];
export type LedgerRecordKindCode =
  (typeof LedgerRecordKind)[keyof typeof LedgerRecordKind];

export const AccountRoleLabels: Record<number, string> = {
  [AccountRole.Bank]: "bank",
  [AccountRole.Wallet]: "wallet",
  [AccountRole.Cash]: "cash",
  [AccountRole.Card]: "card",
  [AccountRole.Equipment]: "equipment",
  [AccountRole.Receivable]: "receivable",
  [AccountRole.Payable]: "payable",
  [AccountRole.OpeningBalances]: "opening_balances",
  [AccountRole.PartnerCapital]: "partner_capital",
  [AccountRole.PartnerDrawings]: "partner_drawings",
  [AccountRole.ExpenseCategory]: "expense_category",
  [AccountRole.IncomeCategory]: "income_category",
};

export const AccountTypeLabels: Record<number, string> = {
  [AccountType.Asset]: "asset",
  [AccountType.Liability]: "liability",
  [AccountType.Equity]: "equity",
  [AccountType.Income]: "income",
  [AccountType.Expense]: "expense",
};

export const LedgerRecordKindLabels: Record<number, string> = {
  [LedgerRecordKind.Expense]: "expense",
  [LedgerRecordKind.Income]: "income",
  [LedgerRecordKind.Transfer]: "transfer",
  [LedgerRecordKind.Payment]: "payment",
  [LedgerRecordKind.OpeningBalance]: "opening_balance",
  [LedgerRecordKind.InvoiceIssue]: "invoice_issue",
  [LedgerRecordKind.Journal]: "journal",
};

export const accountRoleEnum = makeEnum(AccountRoleLabels);
export const accountTypeEnum = makeEnum(AccountTypeLabels);
export const ledgerRecordKindEnum = makeEnum(LedgerRecordKindLabels);

export const TemplateFont = {
  Inter: 1,
  Roboto: 2,
  Lato: 3,
  Merriweather: 4,
} as const;
export type TemplateFontCode = (typeof TemplateFont)[keyof typeof TemplateFont];
export const TemplateFontLabels: Record<number, string> = {
  [TemplateFont.Inter]: "Inter",
  [TemplateFont.Roboto]: "Roboto",
  [TemplateFont.Lato]: "Lato",
  [TemplateFont.Merriweather]: "Merriweather",
};
export const templateFontEnum = makeEnum(TemplateFontLabels);
