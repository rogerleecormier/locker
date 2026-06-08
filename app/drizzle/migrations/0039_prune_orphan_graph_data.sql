-- Migration 0039: Prune orphaned graph edges and nodes left behind by deleted memories.
--
-- D1 does not enforce foreign key constraints (PRAGMA foreign_keys = ON is not
-- supported), so ON DELETE CASCADE on memory_graph_edges.memoryId never fires.
-- This migration performs a one-time cleanup of stale rows accumulated before
-- application-level pruning was added in the deleteMemory / bulkDeleteMemories
-- / nukeEverything server functions.

-- 1. Delete edges whose memoryId no longer exists in memories.
DELETE FROM memory_graph_edges
 WHERE memoryId NOT IN (SELECT id FROM memories);

-- 2. Delete nodes that are no longer referenced by any edge (as source or target).
DELETE FROM memory_graph_nodes
 WHERE id NOT IN (SELECT sourceNodeId FROM memory_graph_edges)
   AND id NOT IN (SELECT targetNodeId FROM memory_graph_edges);
