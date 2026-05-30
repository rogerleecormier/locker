CREATE TABLE `invitations` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`invitedBy` text NOT NULL,
	`token` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`orgId`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invitedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_unique` ON `invitations` (`token`);--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `scopeType` text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE `api_tokens` ADD `scopeId` text;--> statement-breakpoint
ALTER TABLE `memories` ADD `scopeType` text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD `scopeId` text;