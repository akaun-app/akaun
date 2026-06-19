CREATE TABLE `user_nav_preferences` (
	`user_id` integer NOT NULL,
	`item_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`show_on_mobile` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
