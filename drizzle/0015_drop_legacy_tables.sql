-- The remains of the one-sided shape, removed.
--
-- HAND-ORDERED. `drizzle-kit generate` emits these statements in dependency-
-- blind order; the order below is load-bearing and must not be regenerated over
-- (data-model.md §1, research.md R-05):
--
--   1. the five leaf tables — nothing references them
--   2. rebuild `invoices` without `result_income_id` — a LIVE table losing its
--      foreign key into `incomes`, which has to go before `incomes` does
--   3. `expenses` (FK into `claims`), then `incomes`, then `claims`
--   4. `categories` — no incoming FK, independent
--   5. backfill and rebuild `bank_statements` so `account_id` can be NOT NULL
--   6. `reconciliation_allocations` loses two dead columns
--
-- Drizzle wraps every migration in BEGIN … COMMIT, so a `PRAGMA foreign_keys`
-- inside this file is a no-op. Enforcement is turned off on the connection in
-- db/client.ts around the call to `migrate()` instead — without that, the two
-- table rebuilds below would drop a parent table and CASCADE-DELETE its live
-- children (invoice lines, statement lines).

--> 1. The five leaf tables.
DROP TABLE `expense_search_text`;--> statement-breakpoint
DROP TABLE `income_search_text`;--> statement-breakpoint
DROP TABLE `expense_attachments`;--> statement-breakpoint
DROP TABLE `income_attachments`;--> statement-breakpoint
DROP TABLE `claim_attachments`;--> statement-breakpoint

--> 2. `invoices` loses `result_income_id`, and with it its FK into `incomes`.
CREATE TABLE `__new_invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invoice_number` text NOT NULL,
	`contact_id` integer,
	`status` integer DEFAULT 1 NOT NULL,
	`reference` text,
	`issue_date` text NOT NULL,
	`due_date` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`exchange_rate` real DEFAULT 1 NOT NULL,
	`subtotal` real NOT NULL,
	`tax_amount` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`amount_paid` real DEFAULT 0 NOT NULL,
	`notes` text,
	`terms` text,
	`source_quotation_id` integer,
	`income_account_id` integer,
	`ledger_record_id` integer,
	`created_by` integer,
	`updated_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`income_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ledger_record_id`) REFERENCES `ledger_records`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_invoices`("id", "invoice_number", "contact_id", "status", "reference", "issue_date", "due_date", "currency", "exchange_rate", "subtotal", "tax_amount", "total", "amount_paid", "notes", "terms", "source_quotation_id", "income_account_id", "ledger_record_id", "created_by", "updated_by", "created_at", "updated_at") SELECT "id", "invoice_number", "contact_id", "status", "reference", "issue_date", "due_date", "currency", "exchange_rate", "subtotal", "tax_amount", "total", "amount_paid", "notes", "terms", "source_quotation_id", "income_account_id", "ledger_record_id", "created_by", "updated_by", "created_at", "updated_at" FROM `invoices`;--> statement-breakpoint
DROP TABLE `invoices`;--> statement-breakpoint
ALTER TABLE `__new_invoices` RENAME TO `invoices`;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_invoice_number_unique` ON `invoices` (`invoice_number`);--> statement-breakpoint

--> 3. The three record tables, children first.
DROP TABLE `expenses`;--> statement-breakpoint
DROP TABLE `incomes`;--> statement-breakpoint
DROP TABLE `claims`;--> statement-breakpoint

--> 4. `categories` — a category is an account now.
DROP TABLE `categories`;--> statement-breakpoint

--> 5. `bank_statements.account_id` becomes required (FR-055, invariant 9).
--    Backfilled FIRST: a statement uploaded before the chart of accounts
--    existed has no account, and the constraint would refuse it. The default
--    money-holding account is the one the conversion's own backfill used.
UPDATE `bank_statements`
SET `account_id` = COALESCE(
	(SELECT CAST(`value` AS INTEGER) FROM `settings` WHERE `key` = 'ledger_default_account_id'),
	(SELECT `id` FROM `accounts` WHERE `role` = 1 ORDER BY `id` LIMIT 1)
)
WHERE `account_id` IS NULL;--> statement-breakpoint
CREATE TABLE `__new_bank_statements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_filename` text NOT NULL,
	`stored_file_path` text NOT NULL,
	`extraction_state` integer DEFAULT 2 NOT NULL,
	`extraction_error` text,
	`uploaded_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`account_id` integer NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_bank_statements`("id", "original_filename", "stored_file_path", "extraction_state", "extraction_error", "uploaded_by", "created_at", "updated_at", "account_id") SELECT "id", "original_filename", "stored_file_path", "extraction_state", "extraction_error", "uploaded_by", "created_at", "updated_at", "account_id" FROM `bank_statements`;--> statement-breakpoint
DROP TABLE `bank_statements`;--> statement-breakpoint
ALTER TABLE `__new_bank_statements` RENAME TO `bank_statements`;--> statement-breakpoint
CREATE INDEX `bank_statements_state_idx` ON `bank_statements` (`extraction_state`);--> statement-breakpoint

--> 6. Two dead columns. A plain DROP COLUMN, not a rebuild: neither is part of
--    an index, so SQLite can remove them in place.
ALTER TABLE `reconciliation_allocations` DROP COLUMN `item_type`;--> statement-breakpoint
ALTER TABLE `reconciliation_allocations` DROP COLUMN `item_id`;
