CREATE TABLE IF NOT EXISTS `oauthApplication` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL UNIQUE,
	`clientSecret` text,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`icon` text,
	`metadata` text,
	`redirectUrls` text NOT NULL,
	`disabled` integer NOT NULL DEFAULT false,
	`userId` text REFERENCES `user`(`id`) ON DELETE CASCADE,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthAccessToken` (
	`id` text PRIMARY KEY NOT NULL,
	`accessToken` text NOT NULL UNIQUE,
	`refreshToken` text NOT NULL UNIQUE,
	`accessTokenExpiresAt` integer NOT NULL,
	`refreshTokenExpiresAt` integer NOT NULL,
	`scopes` text NOT NULL,
	`clientId` text NOT NULL,
	`userId` text REFERENCES `user`(`id`) ON DELETE CASCADE,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthConsent` (
	`id` text PRIMARY KEY NOT NULL,
	`clientId` text NOT NULL,
	`userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
	`scopes` text NOT NULL,
	`consentGiven` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthApplication_userId_idx` ON `oauthApplication` (`userId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthAccessToken_clientId_idx` ON `oauthAccessToken` (`clientId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthAccessToken_userId_idx` ON `oauthAccessToken` (`userId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthConsent_clientId_idx` ON `oauthConsent` (`clientId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthConsent_userId_idx` ON `oauthConsent` (`userId`);
