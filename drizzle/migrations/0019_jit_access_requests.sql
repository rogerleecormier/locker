-- Just-in-Time access request queue.
-- Created when an agent token queries a memory tagged #confidential.
-- On approval a 15-minute JIT token is issued; on expiry the row is cleaned up
-- by the scheduled cleanup job.
CREATE TABLE `jit_access_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `tokenId` text NOT NULL REFERENCES `api_tokens`(`id`) ON DELETE CASCADE,
  `userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `mcpMethod` text NOT NULL,
  `mcpArgs` text NOT NULL,
  `blockedMemoryIds` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'pending' CHECK(`status` IN ('pending','approved','denied')),
  `jitTokenHash` text,
  `jitExpiresAt` integer,
  `createdAt` integer NOT NULL,
  `reviewedAt` integer,
  `reviewedBy` text REFERENCES `user`(`id`),
  `reviewNotes` text
);

CREATE INDEX `jit_token_status_idx` ON `jit_access_requests` (`tokenId`, `status`);
CREATE INDEX `jit_user_pending_idx`  ON `jit_access_requests` (`userId`, `status`);
