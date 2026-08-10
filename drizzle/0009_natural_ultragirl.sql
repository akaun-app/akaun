CREATE TABLE `bank_statement_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`date` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`amount` real NOT NULL,
	`direction` integer NOT NULL,
	`matched_item_type` integer,
	`matched_item_id` integer,
	`note` text DEFAULT '' NOT NULL,
	`source_file` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `reconciliation_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bank_statement_lines_session_idx` ON `bank_statement_lines` (`session_id`,`date`);--> statement-breakpoint
CREATE TABLE `reconciliation_item_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_type` integer NOT NULL,
	`item_id` integer NOT NULL,
	`cleared_session_id` integer,
	`cleared_line_id` integer,
	`cleared_amount` real,
	`cleared_at` text,
	`annotation` integer,
	`annotation_session_id` integer,
	`annotation_note` text DEFAULT '' NOT NULL,
	`updated_by` integer,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`cleared_session_id`) REFERENCES `reconciliation_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cleared_line_id`) REFERENCES `bank_statement_lines`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`annotation_session_id`) REFERENCES `reconciliation_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliation_item_state_item_idx` ON `reconciliation_item_state` (`item_type`,`item_id`);--> statement-breakpoint
CREATE INDEX `reconciliation_item_state_session_idx` ON `reconciliation_item_state` (`cleared_session_id`);--> statement-breakpoint
CREATE TABLE `reconciliation_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`starting_balance` real NOT NULL,
	`starting_date` text NOT NULL,
	`period_end_date` text NOT NULL,
	`statement_ending_balance` real NOT NULL,
	`computed_balance` real,
	`status` integer DEFAULT 1 NOT NULL,
	`cleared_count` integer DEFAULT 0 NOT NULL,
	`uncleared_count` integer DEFAULT 0 NOT NULL,
	`unmatched_line_count` integer DEFAULT 0 NOT NULL,
	`statement_state` integer DEFAULT 1 NOT NULL,
	`statement_error` text,
	`closed_at` text,
	`created_by` integer,
	`updated_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reconciliation_sessions_status_idx` ON `reconciliation_sessions` (`status`);