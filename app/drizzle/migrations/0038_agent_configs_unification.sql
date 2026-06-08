-- Migration 0038: Formal unification of "stacks" and "templates" into Agent Configs.
--
-- This migration:
--   1. Adds a `locked_to_configs` guard column to memory_templates so that rows whose
--      category = 'configs' can be explicitly flagged as protected — they can only be
--      mutated through the ConfigBuilder UI or the store_config / update_config MCP tools.
--   2. Adds an `exported_workflow_categories` column to memory_templates to record which
--      workflow exports (compliance, devops, devsecops …) were derived from a given config
--      template at creation time.  Values are stored as a comma-separated string.
--   3. Adds a `claude_desktop_config` column to memories so that when sync_agent_configs
--      compiles output it can attach the Claude Desktop JSON fragment for quick reference.
--      This column is write-once by the sync operation and never exposed through MCP recall.
--   4. Creates an index on (category, source_type, is_active) on the memories table to
--      accelerate the hot path used by sync_agent_configs and ConfigBuilder list queries.
--
-- No existing data is removed or altered — all new columns are nullable / have safe defaults.

-- 1. Guard flag on memory_templates for configs-category rows.
ALTER TABLE memory_templates
  ADD COLUMN locked_to_configs INTEGER DEFAULT 0;  -- 0 = normal, 1 = configs-only (write-protected)

-- Backfill: existing configs-category templates are already locked.
UPDATE memory_templates
   SET locked_to_configs = 1
 WHERE category = 'configs';

-- 2. Record which workflow categories were exported when a config template was created.
ALTER TABLE memory_templates
  ADD COLUMN exported_workflow_categories TEXT;  -- CSV: e.g. 'compliance,devops'

-- 3. Claude Desktop config fragment attached to compiled config memories.
--    Populated by sync_agent_configs, ignored by all other read paths.
ALTER TABLE memories
  ADD COLUMN claude_desktop_config TEXT;  -- JSON fragment for ~/.config/claude/config.json

-- 4. Composite index to speed up sync_agent_configs + ConfigBuilder list queries.
CREATE INDEX IF NOT EXISTS idx_memories_config_sync
  ON memories (category, source_type, isActive);
