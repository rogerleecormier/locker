CREATE TABLE `memory_recommendations` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text NOT NULL,
	`userId` text NOT NULL,
	`fact` text NOT NULL,
	`category` text NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`projectKey` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`reviewedBy` text,
	`reviewNotes` text,
	`createdAt` integer NOT NULL,
	`reviewedAt` integer,
	FOREIGN KEY (`orgId`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reviewedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`type` text DEFAULT 'info' NOT NULL,
	`status` text DEFAULT 'unread' NOT NULL,
	`linkUrl` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `memories` ADD `isLocked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `memories` ADD `authorityType` text DEFAULT 'contributed' NOT NULL;