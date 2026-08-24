ALTER TABLE `import_queue` ADD `category_account_id` integer REFERENCES accounts(id) ON DELETE SET NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `account_defaults` (`purpose`, `account_id`)
SELECT 7, `id` FROM `accounts` WHERE `code` = 4100 AND `type` = 4 AND `archived_at` IS NULL LIMIT 1;
