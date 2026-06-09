-- Billing webhook event log for Paddle and Stripe events
-- Stores event IDs to prevent duplicate processing of the same webhook
CREATE TABLE IF NOT EXISTS billing_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  processedAt INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_events_processed_at
  ON billing_events(processedAt);
