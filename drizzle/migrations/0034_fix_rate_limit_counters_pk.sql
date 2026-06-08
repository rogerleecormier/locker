-- Restore rate_limit_counters to composite primary key (key, minuteStart)
-- The Drizzle schema incorrectly defined key as sole PK; realign with the
-- original 0031 migration and rateLimit.ts which use ON CONFLICT (key, minuteStart).

DROP TABLE IF EXISTS rate_limit_counters;

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key         TEXT    NOT NULL,
  minuteStart INTEGER NOT NULL,
  count       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, minuteStart)
);

CREATE INDEX IF NOT EXISTS idx_rlc_minuteStart ON rate_limit_counters (minuteStart);
