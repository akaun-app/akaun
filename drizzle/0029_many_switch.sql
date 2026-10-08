CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`auth_method` text DEFAULT 'none' NOT NULL,
	`secret_hash` text,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`hash` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`client_id` text NOT NULL,
	`issuer` text NOT NULL,
	`resource` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_grants_user_idx` ON `oauth_grants` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_pending` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`browser_hash` text NOT NULL,
	`params` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_tokens` (
	`access_hash` text PRIMARY KEY NOT NULL,
	`refresh_hash` text NOT NULL,
	`grant_id` text NOT NULL,
	`scopes` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_expires_at` integer NOT NULL,
	`refresh_used_at` integer,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_tokens_refresh_hash_unique` ON `oauth_tokens` (`refresh_hash`);--> statement-breakpoint
CREATE INDEX `oauth_tokens_grant_idx` ON `oauth_tokens` (`grant_id`);