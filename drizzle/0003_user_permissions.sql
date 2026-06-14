CREATE TABLE `user_permissions` (
	`user_id` integer NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
	`resource` text NOT NULL,
	`can_view` integer NOT NULL DEFAULT false,
	`can_add` integer NOT NULL DEFAULT false,
	`can_change` integer NOT NULL DEFAULT false,
	`can_delete` integer NOT NULL DEFAULT false,
	PRIMARY KEY(`user_id`, `resource`)
);
