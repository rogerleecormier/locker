CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key         TEXT    NOT NULL,
  minuteStart INTEGER NOT NULL,
  count       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (key, minuteStart)
);

CREATE INDEX IF NOT EXISTS idx_rlc_minuteStart ON rate_limit_counters (minuteStart);
