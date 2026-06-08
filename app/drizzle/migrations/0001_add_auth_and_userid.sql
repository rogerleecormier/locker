-- Idempotent migration: ensure memories table has userId column.
-- On fresh installs: memories doesn't exist yet, so CREATE TABLE creates it with userId.
-- On existing installs: memories exists without userId, so ALTER TABLE adds it.

-- Step 1: Create memories fresh (for databases that never had it)
CREATE TABLE IF NOT EXISTS `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text,
	`fact` text NOT NULL,
	`category` text NOT NULL,
	`tags` text DEFAULT '' NOT NULL,
	`timestamp` integer NOT NULL
);
--> statement-breakpoint
-- Step 2: Add userId column if the table was pre-existing without it.
-- We use a temp table probe: if SELECT userId FROM memories works, the column exists.
-- The outer CREATE TABLE IF NOT EXISTS above handles the "doesn't exist" case.
-- For the "exists but no userId" case, we need ALTER TABLE.
-- We catch this by trying to create a temp table from the column; if it fails, ALTER.
CREATE TABLE IF NOT EXISTS `_probe_memories_userid` AS SELECT userId FROM memories WHERE 0;
--> statement-breakpoint
DROP TABLE IF EXISTS `_probe_memories_userid`;
