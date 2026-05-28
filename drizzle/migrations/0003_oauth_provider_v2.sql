-- @better-auth/oauth-provider tables (replaces deprecated oidcProvider tables)

CREATE TABLE IF NOT EXISTS `oauthClient` (
  `id` text PRIMARY KEY NOT NULL,
  `clientId` text NOT NULL UNIQUE,
  `clientSecret` text,
  `name` text,
  `disabled` integer DEFAULT false,
  `skipConsent` integer,
  `redirectUris` text NOT NULL,
  `scopes` text,
  `public` integer,
  `type` text,
  `requirePKCE` integer,
  `userId` text REFERENCES `user`(`id`) ON DELETE CASCADE,
  `referenceId` text,
  `metadata` text,
  `icon` text,
  `uri` text,
  `tos` text,
  `policy` text,
  `softwareId` text,
  `softwareVersion` text,
  `softwareStatement` text,
  `tokenEndpointAuthMethod` text,
  `grantTypes` text,
  `responseTypes` text,
  `contacts` text,
  `postLogoutRedirectUris` text,
  `enableEndSession` integer,
  `subjectType` text,
  `createdAt` integer,
  `updatedAt` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthAccessTokenV2` (
  `id` text PRIMARY KEY NOT NULL,
  `token` text NOT NULL UNIQUE,
  `clientId` text NOT NULL,
  `sessionId` text,
  `userId` text REFERENCES `user`(`id`) ON DELETE CASCADE,
  `referenceId` text,
  `refreshId` text,
  `expiresAt` integer NOT NULL,
  `createdAt` integer,
  `scopes` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthRefreshToken` (
  `id` text PRIMARY KEY NOT NULL,
  `token` text NOT NULL UNIQUE,
  `clientId` text NOT NULL,
  `sessionId` text,
  `userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `referenceId` text,
  `expiresAt` integer NOT NULL,
  `createdAt` integer,
  `revoked` integer,
  `authTime` integer,
  `scopes` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `oauthConsentV2` (
  `id` text PRIMARY KEY NOT NULL,
  `clientId` text NOT NULL,
  `userId` text REFERENCES `user`(`id`) ON DELETE CASCADE,
  `referenceId` text,
  `scopes` text NOT NULL,
  `createdAt` integer,
  `updatedAt` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthClient_userId_idx` ON `oauthClient` (`userId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthAccessTokenV2_clientId_idx` ON `oauthAccessTokenV2` (`clientId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthAccessTokenV2_userId_idx` ON `oauthAccessTokenV2` (`userId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthAccessTokenV2_refreshId_idx` ON `oauthAccessTokenV2` (`refreshId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthRefreshToken_clientId_idx` ON `oauthRefreshToken` (`clientId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthRefreshToken_userId_idx` ON `oauthRefreshToken` (`userId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthRefreshToken_sessionId_idx` ON `oauthRefreshToken` (`sessionId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthConsentV2_clientId_idx` ON `oauthConsentV2` (`clientId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `oauthConsentV2_userId_idx` ON `oauthConsentV2` (`userId`);
