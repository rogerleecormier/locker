CREATE TABLE `feature_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`planId` text NOT NULL,
	`reason` text,
	`grantedBy` text NOT NULL,
	`grantedAt` integer NOT NULL,
	`expiresAt` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE cascade,
	FOREIGN KEY (`grantedBy`) REFERENCES `user`(`id`) ON DELETE restrict
);
