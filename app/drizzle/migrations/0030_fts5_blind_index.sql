-- Migration: FTS5 virtual table + blind_index_hash column on memories
--
-- Problem: recall_context pulled ALL memories for the requesting user into the
-- V8 isolate, decrypted every fact, then ran JavaScript .includes() to filter
-- by category/tag/keyword.  On large vaults this caused:
--   - High memory pressure (all ciphertext + plaintext simultaneously live)
--   - Worker crashes when the vault exceeded ~128 MB RSS
--   - O(n) decryption cost even when only a handful of results were needed
--
-- Fix (two complementary layers):
--
-- 1. blind_index_hash column — a salted SHA-256 of the normalised tag list.
--    Tags are plaintext metadata so hashing them is sufficient to let the DB
--    filter rows by tag before any decryption happens.  The salt is the vaultId
--    so the hash leaks nothing about the tag string to a D1-only attacker.
--    Used in: tag pre-filter in both recall_context and search_memories.
--
-- 2. memories_fts — SQLite FTS5 virtual table that indexes two unencrypted
--    columns that already exist in plaintext: `category` and `tags`.
--    keyword search is handled by the FTS5 index when the keyword can be
--    matched against those plaintext columns.  For keyword matches against the
--    encrypted fact body, FTS5 cannot help — the application still decrypts
--    only the candidate set returned by prior DB-layer filters.
--
-- Together these filters shrink the candidate set that must be decrypted from
-- O(all user memories) to O(matching memories), eliminating the root cause of
-- memory exhaustion.

-- 1. Add blind_index_hash to memories
ALTER TABLE memories ADD COLUMN blind_index_hash TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_memories_blind_index ON memories(blind_index_hash);
--> statement-breakpoint

-- 2. FTS5 virtual table over unencrypted metadata columns.
--    content=memories makes it a content table so FTS rows stay in sync
--    automatically when memories rows are inserted/updated/deleted via triggers.
--    tokenize="unicode61 tokenchars '-_#'" preserves tag prefixes like #confidential.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  category,
  tags,
  content=memories,
  content_rowid=rowid,
  tokenize="unicode61 tokenchars '-_#'"
);
--> statement-breakpoint

-- Populate FTS from existing rows
INSERT INTO memories_fts(rowid, category, tags)
SELECT rowid, category, tags FROM memories;
--> statement-breakpoint

-- Triggers to keep memories_fts in sync with memories
CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, category, tags) VALUES (new.rowid, new.category, new.tags);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, category, tags) VALUES ('delete', old.rowid, old.category, old.tags);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, category, tags) VALUES ('delete', old.rowid, old.category, old.tags);
  INSERT INTO memories_fts(rowid, category, tags) VALUES (new.rowid, new.category, new.tags);
END;
