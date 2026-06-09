-- Migration 0040: Add project_aliases table for workspace routing disambiguation.
--
-- Problem: when the same vault is reached from multiple machines, CI pipelines,
-- or IDE sessions the incoming workspace identifier (folder path, git remote URL,
-- local slug, workspace URI) differs per environment, producing orphaned context
-- records tied to unrecognised projectKey values.
--
-- Solution: a lookup table that maps any number of alias strings back to a single
-- authoritative projectKey (the canonical scope key stored in memories.project_key).
-- The MCP endpoint resolves aliases before executing vault lookups so that all
-- variants collapse to the same vault.

CREATE TABLE IF NOT EXISTS project_aliases (
  id           TEXT    NOT NULL PRIMARY KEY,
  -- Canonical vault scope key: null / "personal" / "org:<uuid>" / "team:<uuid>"
  project_key  TEXT    NOT NULL,
  -- "path" | "git_remote" | "uri" | "slug"
  alias_type   TEXT    NOT NULL CHECK (alias_type IN ('path', 'git_remote', 'uri', 'slug')),
  -- Raw alias string as supplied by the workspace client
  alias_value  TEXT    NOT NULL,
  -- NULL for shared-scope aliases; set for personal-scope aliases
  user_id      TEXT    REFERENCES user(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

-- Fast lookup by alias value (primary access pattern: "does this string resolve?")
CREATE INDEX IF NOT EXISTS idx_project_aliases_value
  ON project_aliases (alias_value);

-- Fast enumeration of all aliases for a given canonical key (used for auditing / cleanup)
CREATE INDEX IF NOT EXISTS idx_project_aliases_project_key
  ON project_aliases (project_key);

-- Prevent duplicate (aliasValue, userId) combinations so the same path cannot
-- map to two different projectKeys for the same user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_aliases_unique_user_value
  ON project_aliases (alias_value, COALESCE(user_id, ''));
