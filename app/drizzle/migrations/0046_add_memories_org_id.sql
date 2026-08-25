-- Migration: add missing orgId column to memories
--
-- Problem: src/db/schema.ts declares `orgId` on the `memories` table
-- (used throughout org-scoped access control: orgContext.ts, planGate.ts,
-- enterprise.ts) but no migration ever added this column to the actual
-- database. Every insert into `memories` (commit_memory, mergeMemories,
-- etc) includes `orgId` in its column list because Drizzle generates SQL
-- from the schema definition, not from the live table -- so every insert
-- has been failing in production with "table memories has no column
-- named orgId", surfaced to callers as a generic "Failed query" error.
--
-- Fix: add the column to match the schema definition. Nullable (null =
-- personal/self-hosted vault, matching the comment in schema.ts), FK to
-- organizations with cascade delete.

ALTER TABLE memories ADD COLUMN orgId TEXT REFERENCES organizations(id) ON DELETE CASCADE;
