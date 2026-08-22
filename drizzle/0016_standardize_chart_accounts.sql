CREATE TABLE `account_defaults` (
	`purpose` integer PRIMARY KEY NOT NULL,
	`account_id` integer NOT NULL,
	`updated_by` integer,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `account_defaults_account_idx` ON `account_defaults` (`account_id`);--> statement-breakpoint
CREATE TABLE `account_merge_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_account_id` integer NOT NULL,
	`survivor_account_id` integer NOT NULL,
	`run_id` integer NOT NULL,
	`normalized_name` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text,
	`reference_counts_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`survivor_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`run_id`) REFERENCES `account_migration_runs`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_merge_audits_source_idx` ON `account_merge_audits` (`source_account_id`);--> statement-breakpoint
CREATE INDEX `account_merge_audits_run_idx` ON `account_merge_audits` (`run_id`);--> statement-breakpoint
CREATE TABLE `account_migration_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`version` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`before_snapshot_json` text DEFAULT '{}' NOT NULL,
	`after_snapshot_json` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_migration_runs_version_unique` ON `account_migration_runs` (`version`);--> statement-breakpoint
DROP INDEX `accounts_role_name_idx`;--> statement-breakpoint
ALTER TABLE `accounts` ADD `type` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `code` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `parent_id` integer REFERENCES accounts(id);--> statement-breakpoint
ALTER TABLE `accounts` ADD `merged_into_account_id` integer REFERENCES accounts(id);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_code_idx` ON `accounts` (`code`);--> statement-breakpoint
CREATE INDEX `accounts_type_parent_code_idx` ON `accounts` (`type`,`parent_id`,`code`);--> statement-breakpoint
CREATE INDEX `accounts_parent_idx` ON `accounts` (`parent_id`);--> statement-breakpoint
CREATE INDEX `accounts_merged_into_idx` ON `accounts` (`merged_into_account_id`);--> statement-breakpoint
CREATE INDEX `accounts_role_name_idx` ON `accounts` (`role`,`name`);