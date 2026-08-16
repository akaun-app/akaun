CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` integer NOT NULL,
	`name` text NOT NULL,
	`contact_id` integer,
	`is_system` integer DEFAULT false NOT NULL,
	`rank` text NOT NULL,
	`archived_at` text,
	`created_by` integer,
	`updated_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `accounts_role_rank_idx` ON `accounts` (`role`,`rank`);--> statement-breakpoint
CREATE INDEX `accounts_contact_idx` ON `accounts` (`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_role_name_idx` ON `accounts` (`role`,`name`);--> statement-breakpoint
CREATE TABLE `ledger_movements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` integer NOT NULL,
	`account_id` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `ledger_records`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ledger_movements_record_idx` ON `ledger_movements` (`record_id`);--> statement-breakpoint
CREATE INDEX `ledger_movements_account_date_idx` ON `ledger_movements` (`account_id`,`id`);--> statement-breakpoint
CREATE TABLE `ledger_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` integer NOT NULL,
	`date` text NOT NULL,
	`record_number` text,
	`description` text DEFAULT '' NOT NULL,
	`contact_id` integer,
	`reference` text DEFAULT '' NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`exchange_rate` real DEFAULT 1 NOT NULL,
	`amount` real NOT NULL,
	`extracted_text` text,
	`legacy_kind` text,
	`legacy_id` integer,
	`created_by` integer,
	`updated_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_records_record_number_unique` ON `ledger_records` (`record_number`);--> statement-breakpoint
CREATE INDEX `ledger_records_kind_date_idx` ON `ledger_records` (`kind`,`date`);--> statement-breakpoint
CREATE INDEX `ledger_records_contact_idx` ON `ledger_records` (`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ledger_records_legacy_idx` ON `ledger_records` (`legacy_kind`,`legacy_id`);--> statement-breakpoint
CREATE TABLE `record_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` integer NOT NULL,
	`filename` text NOT NULL,
	`display_name` text NOT NULL,
	`added_date` text DEFAULT (date('now')) NOT NULL,
	`legacy_filename` text,
	FOREIGN KEY (`record_id`) REFERENCES `ledger_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `record_attachments_record_idx` ON `record_attachments` (`record_id`);--> statement-breakpoint
CREATE TABLE `record_search_text` (
	`record_id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `ledger_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settlements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`payment_movement_id` integer NOT NULL,
	`owed_movement_id` integer NOT NULL,
	`amount_minor` integer NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`payment_movement_id`) REFERENCES `ledger_movements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owed_movement_id`) REFERENCES `ledger_movements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_pair_idx` ON `settlements` (`payment_movement_id`,`owed_movement_id`);--> statement-breakpoint
CREATE INDEX `settlements_owed_idx` ON `settlements` (`owed_movement_id`);--> statement-breakpoint
-- HAND-CORRECTED (see the note at the foot of this file): drizzle-kit emitted a
-- full table rewrite for `bank_statements`, whose INSERT…SELECT read an
-- `account_id` column the old table does not have, and whose DROP TABLE would
-- fail against the `bank_statement_lines` rows that reference it. Adding a
-- nullable column with a REFERENCES clause needs neither.
ALTER TABLE `bank_statements` ADD `account_id` integer REFERENCES accounts(id);--> statement-breakpoint
CREATE TABLE `__new_reconciliation_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`line_id` integer NOT NULL,
	`item_type` integer,
	`item_id` integer,
	`movement_id` integer,
	`amount` real NOT NULL,
	`item_amount_snapshot` real NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`line_id`) REFERENCES `bank_statement_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movement_id`) REFERENCES `ledger_movements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- HAND-CORRECTED: `movement_id` dropped from the copy. It is new in this
-- migration, so the old table cannot be read for it; omitting it lets every
-- copied row take the column's NULL default, which is what "not yet backfilled"
-- means. The upgrade's reconciliation phase fills it in (FR-034).
INSERT INTO `__new_reconciliation_allocations`("id", "line_id", "item_type", "item_id", "amount", "item_amount_snapshot", "created_by", "created_at") SELECT "id", "line_id", "item_type", "item_id", "amount", "item_amount_snapshot", "created_by", "created_at" FROM `reconciliation_allocations`;--> statement-breakpoint
DROP TABLE `reconciliation_allocations`;--> statement-breakpoint
ALTER TABLE `__new_reconciliation_allocations` RENAME TO `reconciliation_allocations`;--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliation_allocations_line_movement_idx` ON `reconciliation_allocations` (`line_id`,`movement_id`);--> statement-breakpoint
CREATE INDEX `reconciliation_allocations_movement_idx` ON `reconciliation_allocations` (`movement_id`);--> statement-breakpoint
ALTER TABLE `import_queue` ADD `account_id` integer REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `invoices` ADD `income_account_id` integer REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `invoices` ADD `ledger_record_id` integer REFERENCES ledger_records(id);

-- ---------------------------------------------------------------------------
-- Why this file was corrected after `drizzle-kit generate`
--
-- `schema.ts` remains the single source of truth and this migration was
-- generated from it; two statements it emitted could not run, and were replaced
-- rather than re-authored:
--
--   1. A column added in this migration cannot be read out of the table it is
--      being added to. drizzle-kit's SQLite table-rewrite names the NEW column
--      list on both sides of `INSERT INTO … SELECT … FROM <old table>`, so both
--      rewrites below referred to a column that does not exist yet.
--   2. Drizzle's rewrite brackets itself with `PRAGMA foreign_keys=OFF/ON`, but
--      drizzle-orm runs every migration inside `BEGIN … COMMIT`, and SQLite
--      treats that pragma as a no-op inside a transaction. So the rewrite's
--      `DROP TABLE bank_statements` runs with foreign keys still enforced, and
--      fails on any installation holding `bank_statement_lines` rows.
--
-- Nothing here changes the resulting schema: it is byte-for-byte what
-- meta/0014_snapshot.json describes, so the next `drizzle-kit generate` diffs
-- from the same place.
-- ---------------------------------------------------------------------------