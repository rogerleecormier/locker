-- GraphRAG: entity nodes and relationship edges extracted by Workers AI.
-- Entity IDs are stored space-separated in Vectorize metadata so recall_context
-- can perform a single IN (...) lookup to hydrate adjacent nodes with no SQL joins.

CREATE TABLE IF NOT EXISTS `memory_graph_nodes` (
  `id` text PRIMARY KEY NOT NULL,
  `userId` text NOT NULL REFERENCES `user`(`id`) ON DELETE CASCADE,
  `projectKey` text,
  `label` text NOT NULL,
  `type` text NOT NULL,
  `createdAt` integer NOT NULL
);

CREATE TABLE IF NOT EXISTS `memory_graph_edges` (
  `id` text PRIMARY KEY NOT NULL,
  `memoryId` text NOT NULL REFERENCES `memories`(`id`) ON DELETE CASCADE,
  `sourceNodeId` text NOT NULL REFERENCES `memory_graph_nodes`(`id`) ON DELETE CASCADE,
  `targetNodeId` text NOT NULL REFERENCES `memory_graph_nodes`(`id`) ON DELETE CASCADE,
  `relation` text NOT NULL,
  `createdAt` integer NOT NULL
);

CREATE INDEX IF NOT EXISTS `idx_graph_nodes_user` ON `memory_graph_nodes` (`userId`, `projectKey`);
CREATE INDEX IF NOT EXISTS `idx_graph_edges_memory` ON `memory_graph_edges` (`memoryId`);
CREATE INDEX IF NOT EXISTS `idx_graph_edges_source` ON `memory_graph_edges` (`sourceNodeId`);
CREATE INDEX IF NOT EXISTS `idx_graph_edges_target` ON `memory_graph_edges` (`targetNodeId`);
