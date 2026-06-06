-- Webhook event log for GitHub PR Merged and Linear Ticket Done events.
-- Stores an encrypted AI-generated technical summary per event, scoped to a project key.
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,                 -- 'github' | 'linear'
  event_type TEXT NOT NULL,             -- 'pr.merged' | 'ticket.done'
  external_id TEXT NOT NULL,            -- PR node_id or Linear issue id
  project_key TEXT,                     -- vault scope (null = personal, 'org:xxx', 'team:xxx')
  user_id TEXT,                         -- nullable: resolved from webhook token mapping
  memory_id TEXT,                       -- FK to memories.id once committed
  encrypted_summary TEXT NOT NULL,      -- AES-256-GCM encrypted AI summary
  raw_title TEXT,                       -- plain-text PR/ticket title for display
  processed_at INTEGER NOT NULL,        -- epoch ms
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_external
  ON webhook_events(source, external_id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_project_key
  ON webhook_events(project_key);

CREATE INDEX IF NOT EXISTS idx_webhook_events_user_id
  ON webhook_events(user_id);
