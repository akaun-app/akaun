ALTER TABLE `users` ADD `username` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);