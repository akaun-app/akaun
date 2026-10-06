ALTER TABLE `import_items` ADD `counter_account_id` integer REFERENCES accounts(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `import_profiles` ADD `options_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `counter_account_id` integer REFERENCES accounts(id) ON DELETE SET NULL;