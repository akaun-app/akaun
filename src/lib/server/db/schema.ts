import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
  index,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("owner"),
  name: text("name"),
  bearerToken: text("bearer_token").unique(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const groups = sqliteTable("groups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  isSuperuser: integer("is_superuser", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const groupPermissions = sqliteTable(
  "group_permissions",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    canView: integer("can_view", { mode: "boolean" }).notNull().default(false),
    canAdd: integer("can_add", { mode: "boolean" }).notNull().default(false),
    canChange: integer("can_change", { mode: "boolean" })
      .notNull()
      .default(false),
    canDelete: integer("can_delete", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.resource] })],
);

export const userGroups = sqliteTable(
  "user_groups",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.groupId] })],
);

export const userPermissions = sqliteTable(
  "user_permissions",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    canView: integer("can_view", { mode: "boolean" }).notNull().default(false),
    canAdd: integer("can_add", { mode: "boolean" }).notNull().default(false),
    canChange: integer("can_change", { mode: "boolean" })
      .notNull()
      .default(false),
    canDelete: integer("can_delete", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.resource] })],
);

export const userNavPreferences = sqliteTable(
  "user_nav_preferences",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull(),
    sortOrder: integer("sort_order").notNull(),
    showOnMobile: integer("show_on_mobile", { mode: "boolean" })
      .notNull()
      .default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);

// Per-user scalar preferences (KV), the per-user mirror of the global `settings` table.
export const userPreferences = sqliteTable(
  "user_preferences",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  expiresAt: text("expires_at").notNull(),
});

// ---------------------------------------------------------------------------
// Contacts — shared directory of parties the ledger transacts with (Phase 2.6).
// entity_type / role are INTEGER codes; see src/lib/server/enums.ts.
// ---------------------------------------------------------------------------
export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // EntityType code (1 = individual, 2 = business). No default — UI forces choice.
  entityType: integer("entity_type").notNull(),
  legalName: text("legal_name").notNull(),
  registrationNo: text("registration_no"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  remark: text("remark"),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const contactRoles = sqliteTable(
  "contact_roles",
  {
    contactId: integer("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    // Role code (1 = customer, 2 = supplier, 3 = employee). See enums.ts.
    role: integer("role").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.contactId, t.role] }),
    // Required: makes the "all suppliers" filter (queries role first) index-only.
    index("contact_roles_role_contact_idx").on(t.role, t.contactId),
  ],
);

export const contactSearchText = sqliteTable("contact_search_text", {
  contactId: integer("contact_id")
    .primaryKey()
    .references(() => contacts.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
});

// `claims`, `expenses` and `incomes` were here, with their attachment and
// search-text side tables. Every one of them is dropped by this release: the
// double-entry conversion moved their rows into `ledger_records` +
// `ledger_movements`, and nothing has read them since (FR-037, data-model.md
// §1). The migration that drops them is gated by `legacy-drop-guard.ts`, which
// refuses to start a server whose records have not been converted yet.

// Document types that get an auto-generated running number. A local enum (not
// $lib/enums.ts's unrelated `DocumentType`/`TemplateDocumentType`) to avoid
// import collisions in files that touch both areas.
export const SEQUENCE_DOCUMENT_TYPE = {
  expense: 0,
  income: 1,
  // Renamed from `claim`; the code stays 2 and the prefix stays 'CL' so every
  // number already issued keeps counting from where it left off. See the note on
  // SEQUENCE_PREFIXES in $lib/sequence-template.ts.
  payment: 2,
  quotation: 3,
  invoice: 4,
} as const;
export type SequenceDocumentType = keyof typeof SEQUENCE_DOCUMENT_TYPE;
export type SequenceDocumentTypeCode =
  (typeof SEQUENCE_DOCUMENT_TYPE)[keyof typeof SEQUENCE_DOCUMENT_TYPE];

// Global running-number counters across the shared ledger (no per-user split).
// Bucket = (documentType, bucketKey), where bucketKey is derived by resolving
// {PREFIX}/date tokens in the shared template for a given date and stripping
// the {SEQ[:N]} token — see running-number.ts / $lib/sequence-template.ts.
export const appSequences = sqliteTable(
  "app_sequences",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    documentType: integer("document_type").notNull(), // SEQUENCE_DOCUMENT_TYPE code
    bucketKey: text("bucket_key").notNull(),
    lastSequence: integer("last_sequence").notNull().default(0),
  },
  (t) => [
    uniqueIndex("app_sequences_doctype_bucket_idx").on(
      t.documentType,
      t.bucketKey,
    ),
  ],
);

// App-wide settings shared by all users (global KV).
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

// Cache of historical exchange rates, stored in the provider's native pair shape: each
// row is `rate` = `quote` units per 1 `base` on `date`. Rows are self-describing, so a
// later main-currency change needs no invalidation — new lookups simply use a different
// `base` and old rows remain valid historical facts. Same-day same-pair transactions
// reuse a row and avoid extra API calls. Rows are immutable (historical rates don't
// change); no TTL.
export const exchangeRates = sqliteTable(
  "exchange_rates",
  {
    date: text("date").notNull(),
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: real("rate").notNull(),
    fetchedAt: text("fetched_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [primaryKey({ columns: [t.date, t.base, t.quote] })],
);

export const llmProviders = sqliteTable("llm_providers", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  name: text("name").notNull(),
  apiKey: text("api_key").notNull().default(""),
  model: text("model").notNull(),
  baseUrl: text("base_url"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortKey: text("sort_key").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const importQueue = sqliteTable("import_queue", {
  id: text("id").primaryKey(),
  // Who uploaded the file; used for `created_by` on the resulting contact/record,
  // not for visibility filtering (shared ledger).
  createdBy: integer("created_by")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  // ImportState code. See enums.ts.
  state: integer("state").notNull().default(1),
  tempFilePath: text("temp_file_path").notNull(),
  originalFilename: text("original_filename").notNull(),
  // SHA-256 hex of the raw uploaded bytes, for byte-identical duplicate detection.
  // Null for rows uploaded before this column existed.
  fileHash: text("file_hash"),
  // Caller-supplied text (e.g. from client-side OCR) that skips server-side
  // extraction/OCR entirely when present. See worker.ts processJob().
  preExtractedText: text("pre_extracted_text"),
  // Raw OCR/PDF text actually used for this job (either preExtractedText or the
  // server-side extraction result), carried through to the confirmed expense/income
  // row so it becomes searchable. See worker.ts processJob() and the confirm route.
  extractedText: text("extracted_text"),
  // DocumentType code (1 = expense, 2 = income). See enums.ts.
  documentType: integer("document_type"),
  itemName: text("item_name"),
  // RAW extracted name string (entity tables carry no text name).
  supplier: text("supplier"),
  // Set only on a confident exact-normalized match against contacts.legal_name.
  matchedContactId: integer("matched_contact_id").references(
    () => contacts.id,
    {
      onDelete: "set null",
    },
  ),
  // JSON array of ranked fuzzy candidates [{id, legalName, score}].
  matchCandidates: text("match_candidates"),
  date: text("date"),
  amount: real("amount"),
  // Detected currency (ISO-4217) and its rate to the main currency. Null until the
  // LLM/worker resolve them; rate stays null when no API key (manual entry at review).
  currency: text("currency"),
  exchangeRate: real("exchange_rate"),
  reference: text("reference"),
  category: text("category"),
  remark: text("remark"),
  duplicateOf: integer("duplicate_of"),
  // 0-100 weighted-match confidence; set only when duplicateOf is set. See duplicate-detector.ts.
  duplicateConfidence: integer("duplicate_confidence"),
  // JSON array of contributing signal labels (e.g. ["reference","content"]), highest-weight first.
  duplicateReasons: text("duplicate_reasons"),
  // Which account the imported record affected — "which account paid?" /
  // "which account received it?" (FR-019, FR-011). Nullable because a queued
  // document may reach review before the user has said; the review screen
  // pre-selects the default account and confirm requires one.
  accountId: integer("account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  resultId: integer("result_id"),
  // DocumentType code, mirrors document_type post-confirm.
  resultType: integer("result_type"),
  error: text("error"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  processedAt: text("processed_at"),
  confirmedAt: text("confirmed_at"),
  completedAt: text("completed_at"),
});

// ---------------------------------------------------------------------------
// Phase 7 — Quotations & Invoicing
// sourceQuotationId / convertedInvoiceId are plain integers (no cross-FK) to
// avoid circular FK issues between the two tables. App logic enforces the link.
// ---------------------------------------------------------------------------

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceNumber: text("invoice_number").notNull().unique(),
  contactId: integer("contact_id").references(() => contacts.id, {
    onDelete: "set null",
  }),
  // InvoiceStatus code (1=Draft, 2=Sent, 3=Paid, 4=Cancelled). See enums.ts.
  status: integer("status").notNull().default(1),
  reference: text("reference"),
  issueDate: text("issue_date").notNull(),
  dueDate: text("due_date"),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: real("exchange_rate").notNull().default(1),
  subtotal: real("subtotal").notNull(),
  taxAmount: real("tax_amount").notNull().default(0),
  total: real("total").notNull(),
  /** @deprecated Stops being read — how much is paid is derived from settlements (D-10). */
  amountPaid: real("amount_paid").notNull().default(0),
  notes: text("notes"),
  terms: text("terms"),
  // Plain integer — no FK to avoid circular reference with quotations.
  sourceQuotationId: integer("source_quotation_id"),
  // `result_income_id` was here. Its job passed to `ledger_record_id`, and its
  // foreign key pointed into `incomes` — one of the tables this release drops,
  // which is why the migration has to rebuild this table rather than only drop
  // the column (FR-037b, data-model.md §1).
  // Which income category the invoice earns into, chosen on issue and defaulting
  // to the seeded Sales income account (FR-018a).
  incomeAccountId: integer("income_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  // The record that issuing this invoice created: +total into Money owed to us,
  // −total into `income_account_id` (FR-018a).
  ledgerRecordId: integer("ledger_record_id").references(
    () => ledgerRecords.id,
    { onDelete: "set null" },
  ),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const quotations = sqliteTable("quotations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quotationNumber: text("quotation_number").notNull().unique(),
  contactId: integer("contact_id").references(() => contacts.id, {
    onDelete: "set null",
  }),
  // QuotationStatus code (1=Draft, 2=Sent, 3=Accepted, 4=Declined, 5=Converted). See enums.ts.
  status: integer("status").notNull().default(1),
  reference: text("reference"),
  issueDate: text("issue_date").notNull(),
  expiryDate: text("expiry_date"),
  currency: text("currency").notNull().default("USD"),
  exchangeRate: real("exchange_rate").notNull().default(1),
  subtotal: real("subtotal").notNull(),
  taxAmount: real("tax_amount").notNull().default(0),
  total: real("total").notNull(),
  notes: text("notes"),
  terms: text("terms"),
  // Plain integer — no FK to avoid circular reference with invoices.
  convertedInvoiceId: integer("converted_invoice_id"),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

export const quotationLines = sqliteTable("quotation_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  quotationId: integer("quotation_id")
    .notNull()
    .references(() => quotations.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: real("quantity").notNull(),
  unitPrice: real("unit_price").notNull(),
  lineTotal: real("line_total").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const invoiceLines = sqliteTable("invoice_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceId: integer("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: real("quantity").notNull(),
  unitPrice: real("unit_price").notNull(),
  lineTotal: real("line_total").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const quotationSearchText = sqliteTable("quotation_search_text", {
  quotationId: integer("quotation_id")
    .primaryKey()
    .references(() => quotations.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
});

export const invoiceSearchText = sqliteTable("invoice_search_text", {
  invoiceId: integer("invoice_id")
    .primaryKey()
    .references(() => invoices.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
});

// --- document templates (Phase 7.5) ---
// Stores PDF layout JSON + theme. Active template per document type resolved via settings keys.
export const documentTemplates = sqliteTable("document_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  uuid: text("uuid").notNull().unique(),
  name: text("name").notNull(),
  // TemplateDocumentType code: 1=Quotation, 2=Invoice, 3=Both. See enums.ts.
  documentType: integer("document_type").notNull(),
  // 1 = this template is the default for its document_type. App layer enforces one-per-type.
  isDefault: integer("is_default").notNull().default(0),
  themeColor: text("theme_color").notNull().default("#1a56db"),
  // TemplateFont code: 1=Inter(Helvetica), 2=Roboto(Helvetica), 3=Lato(Helvetica), 4=Merriweather(Times). See enums.ts.
  themeFont: integer("theme_font").notNull().default(1),
  layoutJson: text("layout_json").notNull(),
  createdBy: integer("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  updatedBy: integer("updated_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ---------------------------------------------------------------------------
// Audit trail — one row per create/update/delete across every editable record
// type. Standard editing (no more "god mode") is offset by always knowing who
// changed what and when. See src/lib/server/audit.ts.
// ---------------------------------------------------------------------------
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // 'expense' | 'income' | 'claim' | 'contact' | 'quotation' | 'invoice'
    recordType: text("record_type").notNull(),
    recordId: integer("record_id").notNull(),
    userId: integer("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // 'create' | 'update' | 'delete'
    action: text("action").notNull(),
    // JSON: FieldChange[] — [{ field, before, after }]. Null for create/delete.
    changes: text("changes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index("audit_log_record_idx").on(t.recordType, t.recordId, t.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Reconciliation — checks the ledger against a bank statement without changing
// the cash-basis single-entry model. No column is added to expenses, incomes,
// or claims: allocation state is derived from reconciliation_allocations.
// See specs/001-bank-reconciliation/data-model.md.
// ---------------------------------------------------------------------------
export const bankStatements = sqliteTable(
  "bank_statements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    originalFilename: text("original_filename").notNull(),
    storedFilePath: text("stored_file_path").notNull(),
    extractionState: integer("extraction_state").notNull().default(2),
    extractionError: text("extraction_error"),
    uploadedBy: integer("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    // Which account this statement belongs to (FR-021). Only movements on this
    // account are ever offered as matches for its lines.
    //
    // Required in behaviour, nullable in the column, and it cannot be otherwise:
    // a pre-upgrade statement predates the chart of accounts, which the ledger
    // upgrade seeds *after* Drizzle has applied the migration. SQLite will not
    // add a NOT NULL column without a default, and any non-null default here
    // would name an account row that does not exist yet — a foreign-key
    // violation during the migration itself. So the column arrives nullable, the
    // upgrade's reconciliation phase assigns the default bank account to every
    // existing statement (FR-034a), and `POST /api/reconciliation/statements`
    // requires an accountId from then on (FR-021). Null means "not yet
    // assigned", and only a row that predates the upgrade can be in that state.
    //
    // Declared LAST on purpose: Drizzle rewrites a SQLite table wholesale when a
    // column is inserted mid-list, and rewriting this one would mean dropping a
    // table `bank_statement_lines` still references. Migrations run inside a
    // transaction, where `PRAGMA foreign_keys=OFF` is a no-op, so that drop
    // fails on any database that holds real statement lines. Appending keeps the
    // migration a plain ADD COLUMN.
    //
    // Required now (FR-055, invariant 9). It was nullable only because a
    // pre-upgrade statement predated the chart of accounts; the conversion
    // backfilled every one of those, and this release's migration backfills any
    // that are somehow left before adding the constraint. Reconciling starts
    // from an account, so a statement without one cannot be reached at all.
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
  },
  (t) => [index("bank_statements_state_idx").on(t.extractionState)],
);

export const bankStatementLines = sqliteTable(
  "bank_statement_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    statementId: integer("statement_id")
      .notNull()
      .references(() => bankStatements.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    description: text("description").notNull().default(""),
    // Always positive; the sign is carried by `direction`.
    amount: real("amount").notNull(),
    // StatementDirection code (1 = in, 2 = out). See enums.ts.
    direction: integer("direction").notNull(),
    // ReconItemType code. Non-null ⟺ the line is cleared — there is no separate
    // `cleared` column, so two fields can never disagree.
    note: text("note").notNull().default(""),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    index("bank_statement_lines_statement_idx").on(t.statementId, t.date),
  ],
);

// Many-to-many allocation ledger. A bank line may cover several Akaun records and
// one record may be covered by lines from several reconciliation sessions.
export const reconciliationAllocations = sqliteTable(
  "reconciliation_allocations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lineId: integer("line_id")
      .notNull()
      .references(() => bankStatementLines.id, { onDelete: "cascade" }),
    // `item_type` and `item_id` were here: the pre-upgrade way of naming what a
    // bank line covered, replaced by `movement_id`. They were kept nullable and
    // unread for one release so the backfill stayed inspectable against what it
    // came from; that release is over, and no reader remains anywhere in `src/`
    // (FR-037b, R-10).
    // The ledger movement this bank line covers. Nullable for exactly the reason
    // `bank_statements.account_id` is — a pre-upgrade allocation predates every
    // movement, and the upgrade's reconciliation phase repoints it at the bank
    // movement of the record it named (FR-034). Every allocation written after
    // the upgrade sets it, and the service layer requires it.
    movementId: integer("movement_id").references(() => ledgerMovements.id, {
      onDelete: "cascade",
    }),
    amount: real("amount").notNull(),
    itemAmountSnapshot: real("item_amount_snapshot").notNull(),
    createdBy: integer("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("reconciliation_allocations_line_movement_idx").on(
      t.lineId,
      t.movementId,
    ),
    index("reconciliation_allocations_movement_idx").on(t.movementId),
  ],
);

// ---------------------------------------------------------------------------
// Ledger — one record store with two sides (specs/002-double-entry-ledger).
//
// `ledger_records` is what happened; `ledger_movements` is each side of it,
// against an account in `accounts`. A movement's amount is POSITIVE when value
// goes into that account and NEGATIVE when it leaves, and every record's
// movements add up to zero. Money is whole cents of the main currency in an
// INTEGER column, which is what makes "the two sides cancel out exactly"
// provable rather than approximate. `ledger/entry-builder.ts` is the only place
// movements are constructed. See data-model.md.
// ---------------------------------------------------------------------------

// One line in the Chart of Accounts. Type and code become required after the
// explicit conversion has populated every legacy row; parent and merge links
// preserve hierarchy and old deep links.
export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // AccountRole code. See $lib/enums.ts.
    role: integer("role").notNull(),
    // Fixed accounting type and system-owned number. `role` remains during the
    // conversion release only, so migration 0016 can map old installations in
    // one transaction before later readers stop depending on it.
    type: integer("type"),
    // AccountSubType code. Meaningful only when type = Asset; NULL there means
    // "needs review", not a distinct sentinel value. NULL/unused for every
    // other type. See $lib/enums.ts.
    subType: integer("sub_type"),
    code: integer("code"),
    name: text("name").notNull(),
    parentId: integer("parent_id").references(
      (): AnySQLiteColumn => accounts.id,
      { onDelete: "restrict" },
    ),
    mergedIntoAccountId: integer("merged_into_account_id").references(
      (): AnySQLiteColumn => accounts.id,
      { onDelete: "restrict" },
    ),
    // Only partner capital/drawings accounts set this (FR-008b). SET NULL so
    // retiring a contact never destroys the account's history.
    contactId: integer("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    // System accounts can never be deleted (FR-009).
    isSystem: integer("is_system", { mode: "boolean" })
      .notNull()
      .default(false),
    // Lexorank ordering, carried over from categories.rank.
    rank: text("rank").notNull(),
    // Non-null = hidden from pickers for new records; history untouched.
    archivedAt: text("archived_at"),
    createdBy: integer("created_by").references(() => users.id),
    updatedBy: integer("updated_by").references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    // Transitional index used only while migration readers still classify old rows.
    index("accounts_role_rank_idx").on(t.role, t.rank),
    // The partner statement's lookup.
    index("accounts_contact_idx").on(t.contactId),
    // Names are intentionally not unique: code is the stable identity.
    index("accounts_role_name_idx").on(t.role, t.name),
    uniqueIndex("accounts_code_idx").on(t.code),
    index("accounts_type_parent_code_idx").on(t.type, t.parentId, t.code),
    index("accounts_parent_idx").on(t.parentId),
    index("accounts_merged_into_idx").on(t.mergedIntoAccountId),
  ],
);

// Six workflow choices replace role/name lookup. Purpose and required type are
// fixed in $lib/enums.ts; services validate that each target is an active leaf.
export const accountDefaults = sqliteTable(
  "account_defaults",
  {
    purpose: integer("purpose").primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    updatedBy: integer("updated_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [index("account_defaults_account_idx").on(t.accountId)],
);

export const accountMigrationRuns = sqliteTable("account_migration_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  version: text("version").notNull().unique(),
  status: text("status").notNull(),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  completedAt: text("completed_at"),
  summaryJson: text("summary_json").notNull().default("{}"),
  beforeSnapshotJson: text("before_snapshot_json").notNull().default("{}"),
  afterSnapshotJson: text("after_snapshot_json").notNull().default("{}"),
});

export const accountMergeAudits = sqliteTable(
  "account_merge_audits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceAccountId: integer("source_account_id").notNull(),
    survivorAccountId: integer("survivor_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    runId: integer("run_id")
      .notNull()
      .references(() => accountMigrationRuns.id, { onDelete: "restrict" }),
    normalizedName: text("normalized_name").notNull(),
    outcome: text("outcome").notNull(),
    reason: text("reason"),
    referenceCountsJson: text("reference_counts_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("account_merge_audits_source_idx").on(t.sourceAccountId),
    index("account_merge_audits_run_idx").on(t.runId),
  ],
);

// One thing that happened, on one date, with its human context.
export const ledgerRecords = sqliteTable(
  "ledger_records",
  {
    // Migrated expenses keep their original id, so every pre-upgrade
    // /expenses/[id] link still resolves (D-14).
    id: integer("id").primaryKey({ autoIncrement: true }),
    // LedgerRecordKind code. See $lib/enums.ts.
    kind: integer("kind").notNull(),
    date: text("date").notNull(),
    // From the existing sequences; null for transfers, opening balances and
    // journal entries (D-13). No reference number is ever regenerated.
    recordNumber: text("record_number").unique(),
    description: text("description").notNull().default(""),
    // Required when any movement touches a shared owed account (FR-008).
    contactId: integer("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    reference: text("reference").notNull().default(""),
    remark: text("remark").notNull().default(""),
    // The currency `amount` is denominated in.
    currency: text("currency").notNull().default("USD"),
    // Locked at creation so historical conversions never drift.
    exchangeRate: real("exchange_rate").notNull().default(1),
    // The figure as entered, in `currency`. Display and audit only — NEVER
    // summed for a report. Every total reads ledger_movements.amount_minor
    // (D-02). Invariant 6 ties the two together.
    amount: real("amount").notNull(),
    // Raw OCR/PDF text captured during auto-import.
    extractedText: text("extracted_text"),
    // Upgrade provenance and idempotency key: 'expense' | 'income' | 'claim'
    // and the row's id in that old table (D-14).
    legacyKind: text("legacy_kind"),
    legacyId: integer("legacy_id"),
    createdBy: integer("created_by").references(() => users.id),
    updatedBy: integer("updated_by").references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    // Every list screen.
    index("ledger_records_kind_date_idx").on(t.kind, t.date),
    index("ledger_records_contact_idx").on(t.contactId),
    // Makes a rerun of the upgrade skip what it already converted (FR-037).
    // Both columns are null for records created after the upgrade, and SQLite
    // treats nulls as distinct in a unique index, so those never collide.
    uniqueIndex("ledger_records_legacy_idx").on(t.legacyKind, t.legacyId),
  ],
);

// One side of a record: an amount against one account.
export const ledgerMovements = sqliteTable(
  "ledger_movements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // Deleting a record deletes its sides.
    recordId: integer("record_id")
      .notNull()
      .references(() => ledgerRecords.id, { onDelete: "cascade" }),
    // No cascade — an account holding movements cannot be deleted (FR-009).
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id),
    // Whole cents of the main currency, signed. Positive = value in.
    amountMinor: integer("amount_minor").notNull(),
    // Stable display order of the sides on the journal screen.
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    // The balance check and every record read.
    index("ledger_movements_record_idx").on(t.recordId),
    // Account balance and account history.
    index("ledger_movements_account_date_idx").on(t.accountId, t.id),
  ],
);

// A note that a payment paid off a particular outstanding item, for a particular
// amount. Changes no balance (D-09) — it is what makes "paid" and "how much is
// left" derivable rather than stored (FR-012).
export const settlements = sqliteTable(
  "settlements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    // The paying side, on a shared owed account.
    paymentMovementId: integer("payment_movement_id")
      .notNull()
      .references(() => ledgerMovements.id, { onDelete: "cascade" }),
    // The outstanding side, on the same shared owed account.
    owedMovementId: integer("owed_movement_id")
      .notNull()
      .references(() => ledgerMovements.id, { onDelete: "cascade" }),
    // How much of the outstanding item this payment covers. Always > 0; the
    // total against one owed movement may never exceed its own amount (FR-016).
    amountMinor: integer("amount_minor").notNull(),
    createdBy: integer("created_by").references(() => users.id),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [
    uniqueIndex("settlements_pair_idx").on(
      t.paymentMovementId,
      t.owedMovementId,
    ),
    // The "how much is left" aggregate.
    index("settlements_owed_idx").on(t.owedMovementId),
  ],
);

// Replaces expense_attachments, income_attachments and claim_attachments (FR-032b).
export const recordAttachments = sqliteTable(
  "record_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recordId: integer("record_id")
      .notNull()
      .references(() => ledgerRecords.id, { onDelete: "cascade" }),
    // Path relative to STORAGE_PATH; records/YYYY/MM/... after the upgrade (D-16).
    filename: text("filename").notNull(),
    displayName: text("display_name").notNull(),
    addedDate: text("added_date")
      .notNull()
      .default(sql`(date('now'))`),
    // Where the file was before the upgrade. This is what makes the file move
    // resumable and checkable: a rerun sees the file already at its destination
    // and skips it, and verification compares the two hashes before any
    // original is removed (D-16, SC-014). Cleared by the release that drops the
    // legacy tables.
    legacyFilename: text("legacy_filename"),
  },
  (t) => [index("record_attachments_record_idx").on(t.recordId)],
);

// Replaces expense_search_text and income_search_text, unchanged in shape.
// Every existing reference number is folded in exactly as typed (SC-013).
export const recordSearchText = sqliteTable("record_search_text", {
  recordId: integer("record_id")
    .primaryKey()
    .references(() => ledgerRecords.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
});
