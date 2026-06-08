-- Child segments for memories that exceed BGE-M3's token limit.
-- Each row maps a Vectorize vector id (= memory_chunks.id) to its parent memory.
CREATE TABLE `memory_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`parentId` text NOT NULL REFERENCES `memories`(`id`) ON DELETE CASCADE,
	`chunkIndex` integer NOT NULL,
	`startOffset` integer NOT NULL,
	`createdAt` integer NOT NULL
);

CREATE INDEX `idx_memory_chunks_parent` ON `memory_chunks` (`parentId`);
