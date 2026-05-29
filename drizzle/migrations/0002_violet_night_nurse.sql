CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text,
	`userId` text NOT NULL,
	`tokenId` text,
	`action` text NOT NULL,
	`memoryId` text,
	`ipAddress` text,
	`userAgent` text,
	`timestamp` integer NOT NULL,
	`metadata` text,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memory_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`memoryId` text NOT NULL,
	`fact` text NOT NULL,
	`category` text NOT NULL,
	`tags` text NOT NULL,
	`changedBy` text NOT NULL,
	`changeReason` text,
	`timestamp` integer NOT NULL,
	FOREIGN KEY (`memoryId`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `org_quotas` (
	`orgId` text PRIMARY KEY NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`monthlyMemories` integer DEFAULT 100 NOT NULL,
	`monthlyRecalls` integer DEFAULT 1000 NOT NULL,
	`monthlyCommits` integer DEFAULT 500 NOT NULL,
	FOREIGN KEY (`orgId`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `organization_members` (
	`orgId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joinedAt` integer NOT NULL,
	FOREIGN KEY (`orgId`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`plan` text DEFAULT 'free' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `team_members` (
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`orgId` text NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`orgId`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `token_usages` (
	`id` text PRIMARY KEY NOT NULL,
	`tokenId` text NOT NULL,
	`date` text NOT NULL,
	`recallCount` integer DEFAULT 0 NOT NULL,
	`commitCount` integer DEFAULT 0 NOT NULL,
	`tokensConsumed` integer DEFAULT 0 NOT NULL
);
