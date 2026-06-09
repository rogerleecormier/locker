-- Migration: Add memory dependency tracking for cascade invalidation
-- Purpose: Enable causal invalidation where updating a parent memory
--          automatically flags dependent child memories as stale

CREATE TABLE memory_dependencies (
	id text PRIMARY KEY NOT NULL,
	parentId text NOT NULL,
	childId text NOT NULL,
	userId text NOT NULL,
	relationType text NOT NULL DEFAULT 'related_to',
	createdAt integer NOT NULL,
	FOREIGN KEY (parentId) REFERENCES memories(id) ON DELETE CASCADE,
	FOREIGN KEY (childId) REFERENCES memories(id) ON DELETE CASCADE,
	FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

CREATE INDEX idx_memory_dependencies_parent ON memory_dependencies (parentId);
CREATE INDEX idx_memory_dependencies_child ON memory_dependencies (childId);
