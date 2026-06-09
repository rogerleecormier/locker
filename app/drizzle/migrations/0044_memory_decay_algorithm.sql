-- Add accessCount field to memories table for progressive retrieval decay algorithm
ALTER TABLE memories ADD COLUMN accessCount INTEGER NOT NULL DEFAULT 0;

-- Create index on (lastAccessedAt, accessCount) for efficient decay scoring queries
CREATE INDEX idx_memories_decay ON memories(lastAccessedAt DESC, accessCount DESC);
