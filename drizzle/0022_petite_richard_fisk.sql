CREATE TABLE `import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`state` integer DEFAULT 4 NOT NULL,
	`position` integer NOT NULL,
	`source_line` integer,
	`section_key` text NOT NULL,
	`fee_type` text,
	`extras_json` text,
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
	`category_account_id` integer,
	`remark` text,
	`duplicate_of` integer,
	`duplicate_confidence` integer,
	`duplicate_reasons` text,
	`account_id` integer,
	`result_id` integer,
	`result_type` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `import_queue`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`matched_contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `import_items_job_state_idx` ON `import_items` (`job_id`,`state`);--> statement-breakpoint
ALTER TABLE `import_queue` ADD `read_as` text;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `profile_id` text;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `profile_snapshot` text;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `import_mode` text;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `read_how` text;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `extraction_notes` text;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `progress_done` integer;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `progress_total` integer;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `group_account_id` integer REFERENCES accounts(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `record_attachments_filename_idx` ON `record_attachments` (`filename`);