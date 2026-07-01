PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_app_sequences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_type` integer NOT NULL,
	`bucket_key` text NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_app_sequences`("id", "document_type", "bucket_key", "last_sequence") SELECT "id", "document_type", "bucket_key", "last_sequence" FROM `app_sequences`;--> statement-breakpoint
DROP TABLE `app_sequences`;--> statement-breakpoint
ALTER TABLE `__new_app_sequences` RENAME TO `app_sequences`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `app_sequences_doctype_bucket_idx` ON `app_sequences` (`document_type`,`bucket_key`);