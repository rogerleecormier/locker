-- Agent approval queue: extend memory_recommendations to carry pending update/delete payloads.
-- recommendationType gains two new values: 'update' (agent wants to rewrite a memory) and
-- 'delete' (agent wants to permanently remove a memory). The three proposedXxx columns
-- capture the agent's intended new state so the human can compare old vs new before approving.
-- agentContext stores the human-readable agent label from the API token's agentPolicy.
ALTER TABLE `memory_recommendations` ADD COLUMN `proposedFact` text;
--> statement-breakpoint
ALTER TABLE `memory_recommendations` ADD COLUMN `proposedCategory` text;
--> statement-breakpoint
ALTER TABLE `memory_recommendations` ADD COLUMN `proposedTags` text;
--> statement-breakpoint
ALTER TABLE `memory_recommendations` ADD COLUMN `agentContext` text;
