CREATE TABLE `app_sequences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`prefix` text NOT NULL,
	`date_key` text NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_sequences_prefix_date_idx` ON `app_sequences` (`prefix`,`date_key`);--> statement-breakpoint
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
	`status` integer DEFAULT 1 NOT NULL,
	`created_by` integer,
	`updated_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `contact_roles` (
	`contact_id` integer NOT NULL,
	`role` integer NOT NULL,
	PRIMARY KEY(`contact_id`, `role`),
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contact_roles_role_contact_idx` ON `contact_roles` (`role`,`contact_id`);--> statement-breakpoint
CREATE TABLE `contact_search_text` (
	`contact_id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` integer NOT NULL,
	`legal_name` text NOT NULL,
	`registration_no` text,
	`email` text,
	`phone` text,
	`address` text,
	`remark` text,
	`created_by` integer,
	`updated_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`date` text NOT NULL,
	`code` text NOT NULL,
	`rate` real NOT NULL,
	`fetched_at` text DEFAULT (datetime('now')) NOT NULL,
	PRIMARY KEY(`date`, `code`)
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
	`contact_id` integer,
	`reference` text DEFAULT '' NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'Other' NOT NULL,
	`status` integer DEFAULT 1 NOT NULL,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`exchange_rate` real DEFAULT 1 NOT NULL,
	`claim_id` integer,
	`created_by` integer,
	`updated_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_expense_number_unique` ON `expenses` (`expense_number`);--> statement-breakpoint
CREATE TABLE `group_permissions` (
	`group_id` integer NOT NULL,
	`resource` text NOT NULL,
	`can_view` integer DEFAULT false NOT NULL,
	`can_add` integer DEFAULT false NOT NULL,
	`can_change` integer DEFAULT false NOT NULL,
	`can_delete` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`group_id`, `resource`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`is_superuser` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_name_unique` ON `groups` (`name`);--> statement-breakpoint
CREATE TABLE `import_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`created_by` integer NOT NULL,
	`state` integer DEFAULT 1 NOT NULL,
	`temp_file_path` text NOT NULL,
	`original_filename` text NOT NULL,
	`document_type` integer,
	`item_name` text,
	`supplier` text,
	`matched_contact_id` integer,
	`match_candidates` text,
	`date` text,
	`amount` real,
	`currency` text,
	`exchange_rate` real,
	`reference` text,
	`category` text,
	`remark` text,
	`duplicate_of` integer,
	`duplicate_signal` integer,
	`result_id` integer,
	`result_type` integer,
	`error` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`processed_at` text,
	`confirmed_at` text,
	`completed_at` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matched_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null
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
	`contact_id` integer,
	`description_text` text DEFAULT '' NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`remark` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'Other' NOT NULL,
	`date` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`exchange_rate` real DEFAULT 1 NOT NULL,
	`created_by` integer,
	`updated_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
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
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_groups` (
	`user_id` integer NOT NULL,
	`group_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `group_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_nav_preferences` (
	`user_id` integer NOT NULL,
	`item_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`show_on_mobile` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_permissions` (
	`user_id` integer NOT NULL,
	`resource` text NOT NULL,
	`can_view` integer DEFAULT false NOT NULL,
	`can_add` integer DEFAULT false NOT NULL,
	`can_change` integer DEFAULT false NOT NULL,
	`can_delete` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`user_id`, `resource`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'owner' NOT NULL,
	`name` text,
	`bearer_token` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_bearer_token_unique` ON `users` (`bearer_token`);