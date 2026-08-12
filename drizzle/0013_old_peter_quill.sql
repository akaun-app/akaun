PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `reconciliation_allocations`;--> statement-breakpoint
DROP TABLE IF EXISTS `reconciliation_item_state`;--> statement-breakpoint
DROP TABLE IF EXISTS `bank_statement_lines`;--> statement-breakpoint
DROP TABLE IF EXISTS `reconciliation_sessions`;--> statement-breakpoint
CREATE TABLE `bank_statements` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 `original_filename` text NOT NULL,
 `stored_file_path` text NOT NULL,
 `extraction_state` integer DEFAULT 2 NOT NULL,
 `extraction_error` text,
 `uploaded_by` integer,
 `created_at` text DEFAULT (datetime('now')) NOT NULL,
 `updated_at` text DEFAULT (datetime('now')) NOT NULL,
 FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);--> statement-breakpoint
CREATE INDEX `bank_statements_state_idx` ON `bank_statements` (`extraction_state`);--> statement-breakpoint
CREATE TABLE `bank_statement_lines` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 `statement_id` integer NOT NULL,
 `date` text NOT NULL,
 `description` text DEFAULT '' NOT NULL,
 `amount` real NOT NULL,
 `direction` integer NOT NULL,
 `note` text DEFAULT '' NOT NULL,
 `created_at` text DEFAULT (datetime('now')) NOT NULL,
 FOREIGN KEY (`statement_id`) REFERENCES `bank_statements`(`id`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX `bank_statement_lines_statement_idx` ON `bank_statement_lines` (`statement_id`,`date`);--> statement-breakpoint
CREATE TABLE `reconciliation_allocations` (
 `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
 `line_id` integer NOT NULL,
 `item_type` integer NOT NULL,
 `item_id` integer NOT NULL,
 `amount` real NOT NULL,
 `item_amount_snapshot` real NOT NULL,
 `created_by` integer,
 `created_at` text DEFAULT (datetime('now')) NOT NULL,
 FOREIGN KEY (`line_id`) REFERENCES `bank_statement_lines`(`id`) ON DELETE CASCADE,
 FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliation_allocations_line_item_idx` ON `reconciliation_allocations` (`line_id`,`item_type`,`item_id`);--> statement-breakpoint
CREATE INDEX `reconciliation_allocations_item_idx` ON `reconciliation_allocations` (`item_type`,`item_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;
