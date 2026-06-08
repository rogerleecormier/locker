-- Migration: add partial index on api_tokens(token_prefix) WHERE token_prefix IS NOT NULL
--
-- Context: 0029_api_tokens_prefix_idx.sql added idx_api_tokens_prefix as a full-column
-- index (including NULL rows).  resolveToken() in webhooks.ts pass 1 queries:
--
--   WHERE token_prefix = ?
--
-- A partial index that excludes NULL rows is strictly smaller and faster for this
-- query because D1/SQLite can skip the NULL bucket entirely.  The legacy scan
-- (WHERE token_prefix IS NULL + LIMIT 200) uses a full-table path anyway so it
-- is unaffected by this index either way.
--
-- The original full index is retained for backward compatibility with any tooling
-- that may still reference it by name; the query planner will prefer the narrower
-- partial index for equality predicates.
--
-- App-layer change (webhooks.ts): resolveToken now returns null immediately for
-- tokens whose raw string cannot yield a valid 8-character prefix, eliminating
-- the previous last-resort full table scan (db.select().from(apiTokens).all()).
-- Legacy NULL-prefix tokens are still served via pass 2, capped at 200 rows.

CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix_notnull
  ON api_tokens(token_prefix)
  WHERE token_prefix IS NOT NULL;
