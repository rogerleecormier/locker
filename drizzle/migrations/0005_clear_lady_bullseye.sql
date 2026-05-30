ALTER TABLE `organizations` ADD `billingCustomerId` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `billingSubscriptionId` text;--> statement-breakpoint
ALTER TABLE `organizations` ADD `planActivatedAt` integer;--> statement-breakpoint
ALTER TABLE `organizations` ADD `planExpiresAt` integer;