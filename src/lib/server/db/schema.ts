import { sqliteTable, text, integer, real, primaryKey, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	email: text('email').notNull().unique(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	role: text('role').notNull().default('owner'),
	name: text('name'),
	bearerToken: text('bearer_token').unique(),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
});

export const groups = sqliteTable('groups', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull().unique(),
	description: text('description').notNull().default(''),
	isSuperuser: integer('is_superuser', { mode: 'boolean' }).notNull().default(false)
});

export const groupPermissions = sqliteTable(
	'group_permissions',
	{
		groupId: integer('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' }),
		resource: text('resource').notNull(),
		canView: integer('can_view', { mode: 'boolean' }).notNull().default(false),
		canAdd: integer('can_add', { mode: 'boolean' }).notNull().default(false),
		canChange: integer('can_change', { mode: 'boolean' }).notNull().default(false),
		canDelete: integer('can_delete', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [primaryKey({ columns: [t.groupId, t.resource] })]
);

export const userGroups = sqliteTable(
	'user_groups',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		groupId: integer('group_id')
			.notNull()
			.references(() => groups.id, { onDelete: 'cascade' })
	},
	(t) => [primaryKey({ columns: [t.userId, t.groupId] })]
);

export const userPermissions = sqliteTable(
	'user_permissions',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		resource: text('resource').notNull(),
		canView: integer('can_view', { mode: 'boolean' }).notNull().default(false),
		canAdd: integer('can_add', { mode: 'boolean' }).notNull().default(false),
		canChange: integer('can_change', { mode: 'boolean' }).notNull().default(false),
		canDelete: integer('can_delete', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [primaryKey({ columns: [t.userId, t.resource] })]
);

export const userNavPreferences = sqliteTable(
	'user_nav_preferences',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		itemId: text('item_id').notNull(),
		sortOrder: integer('sort_order').notNull(),
		showOnMobile: integer('show_on_mobile', { mode: 'boolean' }).notNull().default(true)
	},
	(t) => [primaryKey({ columns: [t.userId, t.itemId] })]
);

// Per-user scalar preferences (KV), the per-user mirror of the global `settings` table.
export const userPreferences = sqliteTable(
	'user_preferences',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		value: text('value').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.key] })]
);

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	expiresAt: text('expires_at').notNull()
});

// ---------------------------------------------------------------------------
// Contacts — shared directory of parties the ledger transacts with (Phase 2.6).
// entity_type / role are INTEGER codes; see src/lib/server/enums.ts.
// ---------------------------------------------------------------------------
export const contacts = sqliteTable('contacts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	// EntityType code (1 = individual, 2 = business). No default — UI forces choice.
	entityType: integer('entity_type').notNull(),
	legalName: text('legal_name').notNull(),
	registrationNo: text('registration_no'),
	email: text('email'),
	phone: text('phone'),
	address: text('address'),
	remark: text('remark'),
	createdBy: integer('created_by').references(() => users.id),
	updatedBy: integer('updated_by').references(() => users.id),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`)
});

export const contactRoles = sqliteTable(
	'contact_roles',
	{
		contactId: integer('contact_id')
			.notNull()
			.references(() => contacts.id, { onDelete: 'cascade' }),
		// Role code (1 = customer, 2 = supplier, 3 = employee). See enums.ts.
		role: integer('role').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.contactId, t.role] }),
		// Required: makes the "all suppliers" filter (queries role first) index-only.
		index('contact_roles_role_contact_idx').on(t.role, t.contactId)
	]
);

export const contactSearchText = sqliteTable('contact_search_text', {
	contactId: integer('contact_id')
		.primaryKey()
		.references(() => contacts.id, { onDelete: 'cascade' }),
	text: text('text').notNull()
});

export const claims = sqliteTable('claims', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	claimNumber: text('claim_number').notNull(),
	date: text('date').notNull(),
	// ClaimStatus code (1 = pending, 2 = done). See enums.ts.
	status: integer('status').notNull().default(1),
	createdBy: integer('created_by').references(() => users.id),
	updatedBy: integer('updated_by').references(() => users.id),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
});

export const expenses = sqliteTable('expenses', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	expenseNumber: text('expense_number').notNull().unique(),
	itemName: text('item_name').notNull(),
	// Replaces the old free-text `supplier` column. SET NULL: retiring a contact
	// must never delete financial records.
	contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
	reference: text('reference').notNull().default(''),
	remark: text('remark').notNull().default(''),
	category: text('category').notNull().default('Other'),
	// ExpenseStatus code (1 = unpaid, 2 = pending, 3 = paid). See enums.ts.
	status: integer('status').notNull().default(1),
	date: text('date').notNull(),
	amount: real('amount').notNull(),
	// The currency `amount` is denominated in. Main-currency value = amount * exchangeRate.
	currency: text('currency').notNull().default('USD'),
	// Main-currency units per 1 unit of `currency`. 1 when the record is already in the
	// main currency; locked at transaction time so historical conversions never drift.
	exchangeRate: real('exchange_rate').notNull().default(1),
	claimId: integer('claim_id').references(() => claims.id, { onDelete: 'set null' }),
	createdBy: integer('created_by').references(() => users.id),
	updatedBy: integer('updated_by').references(() => users.id),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`)
});

export const incomes = sqliteTable('incomes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	incomeNumber: text('income_number').notNull(),
	// Replaces the old free-text `source` column (the customer/payer party).
	contactId: integer('contact_id').references(() => contacts.id, { onDelete: 'set null' }),
	descriptionText: text('description_text').notNull().default(''),
	reference: text('reference').notNull().default(''),
	remark: text('remark').notNull().default(''),
	category: text('category').notNull().default('Other'),
	date: text('date').notNull(),
	amount: real('amount').notNull(),
	// See expenses.currency / expenses.exchangeRate.
	currency: text('currency').notNull().default('USD'),
	exchangeRate: real('exchange_rate').notNull().default(1),
	createdBy: integer('created_by').references(() => users.id),
	updatedBy: integer('updated_by').references(() => users.id),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
});

export const expenseAttachments = sqliteTable('expense_attachments', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	expenseId: integer('expense_id')
		.notNull()
		.references(() => expenses.id, { onDelete: 'cascade' }),
	filename: text('filename').notNull(),
	displayName: text('display_name').notNull(),
	addedDate: text('added_date').notNull().default(sql`(date('now'))`)
});

export const incomeAttachments = sqliteTable('income_attachments', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	incomeId: integer('income_id')
		.notNull()
		.references(() => incomes.id, { onDelete: 'cascade' }),
	filename: text('filename').notNull(),
	displayName: text('display_name').notNull(),
	addedDate: text('added_date').notNull().default(sql`(date('now'))`)
});

export const claimAttachments = sqliteTable('claim_attachments', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	claimId: integer('claim_id')
		.notNull()
		.references(() => claims.id, { onDelete: 'cascade' }),
	filename: text('filename').notNull(),
	displayName: text('display_name').notNull(),
	addedDate: text('added_date').notNull().default(sql`(date('now'))`)
});

// Global running-number sequences across the shared ledger (no per-user split).
export const appSequences = sqliteTable(
	'app_sequences',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		prefix: text('prefix').notNull(),
		dateKey: text('date_key').notNull(),
		lastSequence: integer('last_sequence').notNull().default(0)
	},
	(t) => [uniqueIndex('app_sequences_prefix_date_idx').on(t.prefix, t.dateKey)]
);

export const expenseSearchText = sqliteTable('expense_search_text', {
	expenseId: integer('expense_id')
		.primaryKey()
		.references(() => expenses.id, { onDelete: 'cascade' }),
	text: text('text').notNull()
});

export const incomeSearchText = sqliteTable('income_search_text', {
	incomeId: integer('income_id')
		.primaryKey()
		.references(() => incomes.id, { onDelete: 'cascade' }),
	text: text('text').notNull()
});

// App-wide settings shared by all users (global KV).
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

// Cache of historical exchange rates, stored in the provider's native pair shape: each
// row is `rate` = `quote` units per 1 `base` on `date`. Rows are self-describing, so a
// later main-currency change needs no invalidation — new lookups simply use a different
// `base` and old rows remain valid historical facts. Same-day same-pair transactions
// reuse a row and avoid extra API calls. Rows are immutable (historical rates don't
// change); no TTL.
export const exchangeRates = sqliteTable(
	'exchange_rates',
	{
		date: text('date').notNull(),
		base: text('base').notNull(),
		quote: text('quote').notNull(),
		rate: real('rate').notNull(),
		fetchedAt: text('fetched_at').notNull().default(sql`(datetime('now'))`)
	},
	(t) => [primaryKey({ columns: [t.date, t.base, t.quote] })]
);

export const llmProviders = sqliteTable('llm_providers', {
	id: text('id').primaryKey(),
	type: text('type').notNull(),
	name: text('name').notNull(),
	apiKey: text('api_key').notNull().default(''),
	model: text('model').notNull(),
	baseUrl: text('base_url'),
	enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
	sortKey: text('sort_key').notNull(),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
});

export const importQueue = sqliteTable('import_queue', {
	id: text('id').primaryKey(),
	// Who uploaded the file; used for `created_by` on the resulting contact/record,
	// not for visibility filtering (shared ledger).
	createdBy: integer('created_by')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	// ImportState code. See enums.ts.
	state: integer('state').notNull().default(1),
	tempFilePath: text('temp_file_path').notNull(),
	originalFilename: text('original_filename').notNull(),
	// DocumentType code (1 = expense, 2 = income). See enums.ts.
	documentType: integer('document_type'),
	itemName: text('item_name'),
	// RAW extracted name string (entity tables carry no text name).
	supplier: text('supplier'),
	// Set only on a confident exact-normalized match against contacts.legal_name.
	matchedContactId: integer('matched_contact_id').references(() => contacts.id, {
		onDelete: 'set null'
	}),
	// JSON array of ranked fuzzy candidates [{id, legalName, score}].
	matchCandidates: text('match_candidates'),
	date: text('date'),
	amount: real('amount'),
	// Detected currency (ISO-4217) and its rate to the main currency. Null until the
	// LLM/worker resolve them; rate stays null when no API key (manual entry at review).
	currency: text('currency'),
	exchangeRate: real('exchange_rate'),
	reference: text('reference'),
	category: text('category'),
	remark: text('remark'),
	duplicateOf: integer('duplicate_of'),
	// DuplicateSignal code. See enums.ts.
	duplicateSignal: integer('duplicate_signal'),
	resultId: integer('result_id'),
	// DocumentType code, mirrors document_type post-confirm.
	resultType: integer('result_type'),
	error: text('error'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	processedAt: text('processed_at'),
	confirmedAt: text('confirmed_at'),
	completedAt: text('completed_at')
});
