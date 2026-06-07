-- Migration 0032: Extend memory_templates to support unified Agent Configs structure.
--
-- Adds structured columns for params, variables, and systemProperties so the
-- ConfigBuilder UI can persist a richer payload alongside the existing configPayload JSON.
-- All new columns are nullable to preserve compatibility with existing rows.
--
-- Also adds a source_type column to distinguish configs-category memories that were
-- written via the ConfigBuilder UI vs. via the store_config / update_config MCP tools.
-- This allows the backend to enforce that only UI-originated writes set source_type='ui'.

-- Step 1: Add structured payload columns to memory_templates.
ALTER TABLE memory_templates ADD COLUMN params TEXT;            -- JSON: { [key: string]: string }
ALTER TABLE memory_templates ADD COLUMN variables TEXT;         -- JSON: Array<{ key, description, default }>
ALTER TABLE memory_templates ADD COLUMN system_properties TEXT; -- JSON: { [key: string]: string }
ALTER TABLE memory_templates ADD COLUMN workflow_category TEXT; -- one of: configs|compliance|project_management|product_management|devops|devsecops|cicd (mirrors category, allows future divergence)
ALTER TABLE memory_templates ADD COLUMN updated_at INTEGER;     -- epoch ms — set on every update

-- Step 2: Backfill updated_at from created_at for all existing rows.
UPDATE memory_templates SET updated_at = created_at WHERE updated_at IS NULL;

-- Step 3: Backfill workflow_category from category for all existing rows.
UPDATE memory_templates SET workflow_category = category WHERE workflow_category IS NULL;

-- Step 4: Add source_type to memories table so backend can track write origin.
-- Values: 'ui' = written via ConfigBuilder, 'mcp' = written via store_config/update_config MCP tool.
ALTER TABLE memories ADD COLUMN source_type TEXT DEFAULT 'mcp'; -- 'ui' | 'mcp'

-- Step 5: Mark existing configs-category memories as mcp-sourced (safe default).
UPDATE memories SET source_type = 'mcp' WHERE category = 'configs' AND source_type IS NULL;
