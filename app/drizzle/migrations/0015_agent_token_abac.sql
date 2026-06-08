ALTER TABLE `api_tokens` ADD COLUMN `tokenType` text NOT NULL DEFAULT 'human';
ALTER TABLE `api_tokens` ADD COLUMN `agentPolicy` text;
