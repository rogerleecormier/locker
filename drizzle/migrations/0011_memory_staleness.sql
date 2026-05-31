-- Add lastAccessedAt column for memory staleness tracking
ALTER TABLE memories ADD COLUMN lastAccessedAt INTEGER;

-- Create index for efficient staleness queries
CREATE INDEX idx_memories_user_active ON memories(userId, isActive, timestamp DESC);
