CREATE TABLE `document_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`uuid` text NOT NULL,
	`name` text NOT NULL,
	`document_type` integer NOT NULL,
	`is_default` integer DEFAULT 0 NOT NULL,
	`theme_color` text DEFAULT '#1a56db' NOT NULL,
	`theme_font` integer DEFAULT 1 NOT NULL,
	`layout_json` text NOT NULL,
	`created_by` integer,
	`updated_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_templates_uuid_unique` ON `document_templates` (`uuid`);