CREATE TABLE IF NOT EXISTS `totp_secrets` (
  `id` text PRIMARY KEY NOT NULL,
  `userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `secret` text NOT NULL,
  `verified` integer NOT NULL DEFAULT 0,
  `backupCodes` text NOT NULL,
  `createdAt` integer NOT NULL,
  `verifiedAt` integer
);
