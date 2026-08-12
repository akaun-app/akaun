CREATE TABLE `reconciliation_allocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`line_id` integer NOT NULL,
	`item_type` integer NOT NULL,
	`item_id` integer NOT NULL,
	`amount` real NOT NULL,
	`item_amount_snapshot` real NOT NULL,
	`created_by` integer,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `reconciliation_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`line_id`) REFERENCES `bank_statement_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reconciliation_allocations_line_item_idx` ON `reconciliation_allocations` (`line_id`,`item_type`,`item_id`);
--> statement-breakpoint
CREATE INDEX `reconciliation_allocations_item_idx` ON `reconciliation_allocations` (`item_type`,`item_id`);
--> statement-breakpoint
CREATE INDEX `reconciliation_allocations_session_idx` ON `reconciliation_allocations` (`session_id`);
--> statement-breakpoint
INSERT INTO `reconciliation_allocations` (`session_id`, `line_id`, `item_type`, `item_id`, `amount`, `item_amount_snapshot`, `created_by`)
SELECT l.`session_id`, l.`id`, l.`matched_item_type`, l.`matched_item_id`, l.`amount`,
	coalesce(s.`cleared_amount`, l.`amount`), s.`updated_by`
FROM `bank_statement_lines` l
LEFT JOIN `reconciliation_item_state` s
	ON s.`item_type` = l.`matched_item_type` AND s.`item_id` = l.`matched_item_id`
WHERE l.`matched_item_type` IS NOT NULL AND l.`matched_item_id` IS NOT NULL;
