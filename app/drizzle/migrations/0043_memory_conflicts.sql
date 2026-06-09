-- Persists vault health check findings across sessions.
-- Each row is one detected issue: duplicate cluster, stale memory, or quarantined memory.
-- Deduplication is handled by the unique fingerprint column.
CREATE TABLE IF NOT EXISTS memory_conflicts (
  id          TEXT    PRIMARY KEY,
  userId      TEXT    NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  scopeType   TEXT    NOT NULL DEFAULT 'personal',
  scopeId     TEXT,
  conflictType TEXT   NOT NULL CHECK(conflictType IN ('duplicate','stale','quarantined')),
  fingerprint TEXT    NOT NULL,
  label       TEXT    NOT NULL,
  reason      TEXT,
  memoryIds   TEXT    NOT NULL,
  memoryDetails TEXT,
  suggestedAction TEXT CHECK(suggestedAction IN ('merge','review','delete')),
  status      TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','snoozed','resolved')),
  snoozeUntil INTEGER,
  detectedAt  INTEGER NOT NULL,
  lastSeenAt  INTEGER NOT NULL,
  resolvedAt  INTEGER
);

CREATE INDEX IF NOT EXISTS idx_memory_conflicts_user_scope
  ON memory_conflicts(userId, scopeType, scopeId);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_conflicts_fingerprint
  ON memory_conflicts(fingerprint);

CREATE INDEX IF NOT EXISTS idx_memory_conflicts_status
  ON memory_conflicts(status);
