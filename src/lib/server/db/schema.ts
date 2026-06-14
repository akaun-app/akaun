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

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	expiresAt: text('expires_at').notNull()
});

export const claims = sqliteTable('claims', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	claimNumber: text('claim_number').notNull(),
	date: text('date').notNull(),
	status: text('status').notNull().default('pending'),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`)
});

export const expenses = sqliteTable('expenses', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	expenseNumber: text('expense_number').notNull().unique(),
	itemName: text('item_name').notNull(),
	supplier: text('supplier').notNull().default(''),
	reference: text('reference').notNull().default(''),
	remark: text('remark').notNull().default(''),
	category: text('category').notNull().default('Other'),
	status: text('status').notNull().default('unpaid'),
	date: text('date').notNull(),
	amount: real('amount').notNull(),
	claimId: integer('claim_id').references(() => claims.id, { onDelete: 'set null' }),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`)
});

export const incomes = sqliteTable('incomes', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	incomeNumber: text('income_number').notNull(),
	source: text('source').notNull().default(''),
	descriptionText: text('description_text').notNull().default(''),
	reference: text('reference').notNull().default(''),
	remark: text('remark').notNull().default(''),
	category: text('category').notNull().default('Other'),
	date: text('date').notNull(),
	amount: real('amount').notNull(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
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

export const appSequences = sqliteTable(
	'app_sequences',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		prefix: text('prefix').notNull(),
		dateKey: text('date_key').notNull(),
		lastSequence: integer('last_sequence').notNull().default(0),
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' })
	},
	(t) => [uniqueIndex('app_sequences_prefix_date_user_idx').on(t.prefix, t.dateKey, t.userId)]
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

export const settings = sqliteTable(
	'settings',
	{
		userId: integer('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		value: text('value').notNull()
	},
	(t) => [primaryKey({ columns: [t.userId, t.key] })]
);

export const importQueue = sqliteTable('import_queue', {
	id: text('id').primaryKey(),
	userId: integer('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	state: text('state').notNull().default('queued'),
	tempFilePath: text('temp_file_path').notNull(),
	originalFilename: text('original_filename').notNull(),
	documentType: text('document_type'),
	itemName: text('item_name'),
	supplier: text('supplier'),
	date: text('date'),
	amount: real('amount'),
	reference: text('reference'),
	category: text('category'),
	remark: text('remark'),
	duplicateOf: integer('duplicate_of'),
	duplicateSignal: text('duplicate_signal'),
	resultId: integer('result_id'),
	resultType: text('result_type'),
	error: text('error'),
	createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
	processedAt: text('processed_at'),
	confirmedAt: text('confirmed_at'),
	completedAt: text('completed_at')
});
