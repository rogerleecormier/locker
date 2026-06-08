-- Migration: add tokenPrefix lookup column to api_tokens
--
-- Problem: resolveToken() called db.select().from(apiTokens).all() on every
-- inbound webhook payload, loading the entire table into memory before running
-- 100,000-iteration PBKDF2 on each row — O(n) per request.
--
-- Fix: store the first 8 characters of the raw token that follow the "lkr_"
-- prefix (chars [4,12)) as a plain-text indexed column.  At lookup time we
-- filter WHERE token_prefix = ? first, reducing the PBKDF2 candidate set from
-- O(n) to O(1) for any token minted after this migration.
--
-- Rows created before this migration will have token_prefix = NULL.  The
-- application falls back to scanning those rows until tokens are rotated (at
-- which point the prefix is written and this fallback path naturally empties).
-- The SHA-256 → PBKDF2 opportunistic upgrade in -_api.mcp.ts now also writes
-- token_prefix so legacy tokens self-heal on first successful auth.

ALTER TABLE api_tokens ADD COLUMN token_prefix TEXT;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens(token_prefix);
