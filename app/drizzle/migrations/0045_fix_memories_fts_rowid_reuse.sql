-- Migration: fix memories_fts rowid-reuse bug
--
-- Problem: memories_fts (migration 0030) is an FTS5 content table keyed off
-- SQLite's implicit rowid on `memories`. Since `memories.id` is a TEXT primary
-- key (not INTEGER PRIMARY KEY), the implicit rowid is an ordinary, reusable
-- integer -- SQLite can and does assign a deleted row's old rowid to a new
-- row inserted later. Several call sites hard-delete from `memories`
-- (deleteMemory, quarantine cleanup, agent-config replace, etc). If a rowid
-- gets reused, memories_ai's plain `INSERT INTO memories_fts(rowid, ...)`
-- collides with the leftover shadow-table entry at that rowid, throwing a
-- UNIQUE constraint failure from inside the trigger. That exception surfaces
-- to the caller as a generic failure of the outer `insert into "memories"`
-- statement (commit_memory, mergeMemories, etc), even though `memories` itself
-- is fine -- only the FTS shadow index is desynced.
--
-- Fix:
-- 1. Rebuild memories_fts from scratch to clear out any existing desync.
-- 2. Make memories_ai defensive: delete any stale FTS entry at the target
--    rowid before inserting, so a reused rowid can never collide again.

-- 1. Repair: rebuild the FTS5 index from the current state of `memories`.
INSERT INTO memories_fts(memories_fts) VALUES('rebuild');
--> statement-breakpoint

-- 2. Replace the insert trigger with a defensive version.
DROP TRIGGER IF EXISTS memories_ai;
--> statement-breakpoint
CREATE TRIGGER memories_ai AFTER INSERT ON memories BEGIN
  DELETE FROM memories_fts WHERE rowid = new.rowid;
  INSERT INTO memories_fts(rowid, category, tags) VALUES (new.rowid, new.category, new.tags);
END;
