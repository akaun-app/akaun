CREATE TABLE `invoice_search_text` (
	`invoice_id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `quotation_search_text` (
	`quotation_id` integer PRIMARY KEY NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`quotation_id`) REFERENCES `quotations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `expenses` ADD `extracted_text` text;--> statement-breakpoint
ALTER TABLE `import_queue` ADD `extracted_text` text;--> statement-breakpoint
ALTER TABLE `incomes` ADD `extracted_text` text;