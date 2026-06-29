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
export const Role = { Customer: 1, Supplier: 2, Employee: 3 } as const;

// --- expenses / claims ---
export const ExpenseStatus = { Unpaid: 1, Pending: 2, Paid: 3 } as const;
export const ClaimStatus = { Pending: 1, Done: 2 } as const;

// --- import_queue ---
export const ImportState = {
	Queued: 1,
	Extracting: 2,
	Processing: 3,
	PendingReview: 4,
	Confirmed: 5,
	Imported: 6,
	Skipped: 7,
	Failed: 8
} as const;
// DocumentType is also used for import_queue.result_type
export const DocumentType = { Expense: 1, Income: 2 } as const;
export const DuplicateSignal = { Filename: 1, Reference: 2, AmountDateSupplier: 3 } as const;

// --- reset scope ---
export const ResetScope = { Settings: 1, Data: 2, Everything: 3 } as const;

// ---------------------------------------------------------------------------
// Label maps + helpers. API bodies use INT codes; responses may also include a
// resolved label for client convenience.
// ---------------------------------------------------------------------------

export type EntityTypeCode = (typeof EntityType)[keyof typeof EntityType];
export type RoleCode = (typeof Role)[keyof typeof Role];
export type ExpenseStatusCode = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];
export type ClaimStatusCode = (typeof ClaimStatus)[keyof typeof ClaimStatus];
export type ImportStateCode = (typeof ImportState)[keyof typeof ImportState];
export type DocumentTypeCode = (typeof DocumentType)[keyof typeof DocumentType];
export type DuplicateSignalCode = (typeof DuplicateSignal)[keyof typeof DuplicateSignal];
export type ResetScopeCode = (typeof ResetScope)[keyof typeof ResetScope];

export const EntityTypeLabels: Record<number, string> = {
	[EntityType.Individual]: 'Individual',
	[EntityType.Business]: 'Business'
};

export const RoleLabels: Record<number, string> = {
	[Role.Customer]: 'Customer',
	[Role.Supplier]: 'Supplier',
	[Role.Employee]: 'Employee'
};

export const ExpenseStatusLabels: Record<number, string> = {
	[ExpenseStatus.Unpaid]: 'unpaid',
	[ExpenseStatus.Pending]: 'pending',
	[ExpenseStatus.Paid]: 'paid'
};

export const ClaimStatusLabels: Record<number, string> = {
	[ClaimStatus.Pending]: 'pending',
	[ClaimStatus.Done]: 'done'
};

export const ImportStateLabels: Record<number, string> = {
	[ImportState.Queued]: 'queued',
	[ImportState.Extracting]: 'extracting',
	[ImportState.Processing]: 'processing',
	[ImportState.PendingReview]: 'pending_review',
	[ImportState.Confirmed]: 'confirmed',
	[ImportState.Imported]: 'imported',
	[ImportState.Skipped]: 'skipped',
	[ImportState.Failed]: 'failed'
};

export const DocumentTypeLabels: Record<number, string> = {
	[DocumentType.Expense]: 'expense',
	[DocumentType.Income]: 'income'
};

export const DuplicateSignalLabels: Record<number, string> = {
	[DuplicateSignal.Filename]: 'filename',
	[DuplicateSignal.Reference]: 'reference',
	[DuplicateSignal.AmountDateSupplier]: 'amount_date_supplier'
};

export const ResetScopeLabels: Record<number, string> = {
	[ResetScope.Settings]: 'settings',
	[ResetScope.Data]: 'data',
	[ResetScope.Everything]: 'everything'
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
		}
	};
}

export const entityTypeEnum = makeEnum(EntityTypeLabels);
export const roleEnum = makeEnum(RoleLabels);
export const expenseStatusEnum = makeEnum(ExpenseStatusLabels);
export const claimStatusEnum = makeEnum(ClaimStatusLabels);
export const importStateEnum = makeEnum(ImportStateLabels);
export const documentTypeEnum = makeEnum(DocumentTypeLabels);
export const duplicateSignalEnum = makeEnum(DuplicateSignalLabels);
export const resetScopeEnum = makeEnum(ResetScopeLabels);

// --- quotations ---
export const QuotationStatus = { Draft: 1, Sent: 2, Accepted: 3, Declined: 4, Converted: 5 } as const;
// reserved (DERIVED, never stored): Expired — expiry_date < today && status ∈ {Draft, Sent}
export type QuotationStatusCode = (typeof QuotationStatus)[keyof typeof QuotationStatus];
export const QuotationStatusLabels: Record<number, string> = {
	[QuotationStatus.Draft]: 'draft',
	[QuotationStatus.Sent]: 'sent',
	[QuotationStatus.Accepted]: 'accepted',
	[QuotationStatus.Declined]: 'declined',
	[QuotationStatus.Converted]: 'converted'
};
export const quotationStatusEnum = makeEnum(QuotationStatusLabels);

// --- invoices ---
export const InvoiceStatus = { Draft: 1, Sent: 2, Paid: 3, Cancelled: 4 } as const;
// reserved (DERIVED, never stored): Overdue — due_date < today && status !== Paid
// reserved (FUTURE): PartiallyPaid = 5
export type InvoiceStatusCode = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];
export const InvoiceStatusLabels: Record<number, string> = {
	[InvoiceStatus.Draft]: 'draft',
	[InvoiceStatus.Sent]: 'sent',
	[InvoiceStatus.Paid]: 'paid',
	[InvoiceStatus.Cancelled]: 'cancelled'
};
export const invoiceStatusEnum = makeEnum(InvoiceStatusLabels);

// --- document templates ---
export const TemplateDocumentType = { Quotation: 1, Invoice: 2, Both: 3 } as const;
// reserved: per-document override (future — no stored status change)
export type TemplateDocumentTypeCode = (typeof TemplateDocumentType)[keyof typeof TemplateDocumentType];
export const TemplateDocumentTypeLabels: Record<number, string> = {
	[TemplateDocumentType.Quotation]: 'quotation',
	[TemplateDocumentType.Invoice]: 'invoice',
	[TemplateDocumentType.Both]: 'both'
};
export const templateDocumentTypeEnum = makeEnum(TemplateDocumentTypeLabels);

export const TemplateFont = { Inter: 1, Roboto: 2, Lato: 3, Merriweather: 4 } as const;
export type TemplateFontCode = (typeof TemplateFont)[keyof typeof TemplateFont];
export const TemplateFontLabels: Record<number, string> = {
	[TemplateFont.Inter]: 'Inter',
	[TemplateFont.Roboto]: 'Roboto',
	[TemplateFont.Lato]: 'Lato',
	[TemplateFont.Merriweather]: 'Merriweather'
};
export const templateFontEnum = makeEnum(TemplateFontLabels);
