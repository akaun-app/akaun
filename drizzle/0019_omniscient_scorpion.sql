PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` integer NOT NULL,
	`type` integer,
	`sub_type` integer,
	`code` integer,
	`name` text NOT NULL,
	`merged_into_account_id` integer,
	`contact_id` integer,
	`is_system` integer DEFAULT false NOT NULL,
	`rank` text NOT NULL,
	`archived_at` text,
	`created_by` integer,
	`updated_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`merged_into_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "role", "type", "sub_type", "code", "name", "merged_into_account_id", "contact_id", "is_system", "rank", "archived_at", "created_by", "updated_by", "created_at", "updated_at") SELECT "id", "role", "type", "sub_type", "code", "name", "merged_into_account_id", "contact_id", "is_system", "rank", "archived_at", "created_by", "updated_by", "created_at", "updated_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `accounts_role_rank_idx` ON `accounts` (`role`,`rank`);--> statement-breakpoint
CREATE INDEX `accounts_contact_idx` ON `accounts` (`contact_id`);--> statement-breakpoint
CREATE INDEX `accounts_role_name_idx` ON `accounts` (`role`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_code_idx` ON `accounts` (`code`);--> statement-breakpoint
CREATE INDEX `accounts_merged_into_idx` ON `accounts` (`merged_into_account_id`);