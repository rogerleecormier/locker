-- Snapshot of the agent token's metadata at the time a JIT request was created.
-- Stored as JSON: { name, agentContext, tokenType, permissions, scopeType, scopeId }.
-- Allows Slack notifications and admin UIs to display rich context without a JOIN.
ALTER TABLE `jit_access_requests` ADD COLUMN `agentTokenMetadata` text;
