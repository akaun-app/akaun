CREATE TABLE `app_sequences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prefix` text NOT NULL,
	`date_key` text NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`user_id` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_sequences_prefix_date_user_idx` ON `app_sequences` (`prefix`,`date_key`,`user_id`);--> statement-breakpoint
CREATE TABLE `claim_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`claim_id` integer NOT NULL,
	`filename` text NOT NULL,
	`display_name` text NOT NULL,
	`added_date` text DEFAULT (date('now')) NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `claims` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`claim_number` text NOT NULL,
	`date` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `expense_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expense_id` integer NOT NULL,
	`filename` text NOT NULL,
	`display_name` text NOT NULL,
	`added_date` text DEFAULT (date('now')) NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `expense_search_text` (
	`expense_id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`expense_number` text NOT NULL,
	`item_name` text NOT NULL,
	`supplier` text DEFAULT '' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'Other' NOT NULL,
	`status` text DEFAULT 'unpaid' NOT NULL,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`claim_id` integer,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_expense_number_unique` ON `expenses` (`expense_number`);--> statement-breakpoint
CREATE TABLE `import_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`temp_file_path` text NOT NULL,
	`original_filename` text NOT NULL,
	`document_type` text,
	`item_name` text,
	`supplier` text,
	`date` text,
	`amount` real,
	`reference` text,
	`category` text,
	`remark` text,
	`duplicate_of` integer,
	`duplicate_signal` text,
	`result_id` integer,
	`result_type` text,
	`error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`processed_at` text,
	`confirmed_at` text,
	`completed_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `income_attachments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`income_id` integer NOT NULL,
	`filename` text NOT NULL,
	`display_name` text NOT NULL,
	`added_date` text DEFAULT (date('now')) NOT NULL,
	FOREIGN KEY (`income_id`) REFERENCES `incomes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `income_search_text` (
	`income_id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`income_id`) REFERENCES `incomes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `incomes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`income_number` text NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`description_text` text DEFAULT '' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'Other' NOT NULL,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`user_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);