CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_type` text NOT NULL,
	`record_id` integer NOT NULL,
	`user_id` integer,
	`action` text NOT NULL,
	`changes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_log_record_idx` ON `audit_log` (`record_type`,`record_id`,`created_at`);