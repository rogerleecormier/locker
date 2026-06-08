CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`name` text NOT NULL,
	`encryptedValue` text NOT NULL,
	`projectKey` text,
	`scopeType` text DEFAULT 'personal' NOT NULL,
	`scopeId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);