-- Migration: 0012_add_missing_retention_and_expiry.sql
-- Adds missing retention and expiry columns that are expected by schema.ts

-- ── organizations: add retention days and count
ALTER TABLE `organizations` ADD COLUMN `memoryVersionRetentionDays` integer DEFAULT 365 NOT NULL;
ALTER TABLE `organizations` ADD COLUMN `memoryVersionRetentionCount` integer DEFAULT 50 NOT NULL;

-- ── memory_versions: add expiresAt
ALTER TABLE `memory_versions` ADD COLUMN `expiresAt` integer;
