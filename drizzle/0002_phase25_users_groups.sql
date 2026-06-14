ALTER TABLE `users` ADD `name` text;--> statement-breakpoint
ALTER TABLE `users` ADD `bearer_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_bearer_token_unique` ON `users` (`bearer_token`) WHERE `bearer_token` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL UNIQUE,
	`description` text NOT NULL DEFAULT '',
	`is_superuser` integer NOT NULL DEFAULT false
);--> statement-breakpoint
CREATE TABLE `group_permissions` (
	`group_id` integer NOT NULL REFERENCES `groups`(`id`) ON DELETE CASCADE,
	`resource` text NOT NULL,
	`can_view` integer NOT NULL DEFAULT false,
	`can_add` integer NOT NULL DEFAULT false,
	`can_change` integer NOT NULL DEFAULT false,
	`can_delete` integer NOT NULL DEFAULT false,
	PRIMARY KEY(`group_id`, `resource`)
);--> statement-breakpoint
CREATE TABLE `user_groups` (
	`user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE CASCADE,
	`group_id` integer NOT NULL REFERENCES `groups`(`id`) ON DELETE CASCADE,
	PRIMARY KEY(`user_id`, `group_id`)
);
