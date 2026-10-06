CREATE TABLE `import_record_profiles` (
	`record_id` integer PRIMARY KEY NOT NULL,
	`profile_id` integer NOT NULL,
	FOREIGN KEY (`record_id`) REFERENCES `ledger_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_record_profiles_profile_idx` ON `import_record_profiles` (`profile_id`);--> statement-breakpoint
ALTER TABLE `import_items` ADD `check_note` text;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `check_note` text;