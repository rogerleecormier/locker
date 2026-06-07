CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key        TEXT    NOT NULL,
  window     INTEGER NOT NULL,  -- unix epoch second of the window start (floor(now/60)*60)
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window)
);

CREATE INDEX IF NOT EXISTS idx_rlc_window ON rate_limit_counters (window);
