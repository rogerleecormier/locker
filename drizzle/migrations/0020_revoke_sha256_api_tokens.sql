-- Revoke any API tokens whose hash is still a raw SHA-256 hex digest (64 lowercase hex chars).
-- These tokens predate PBKDF2 and cannot be re-hashed without the plaintext secret.
-- Deleting them forces owners to regenerate, ensuring every live token is protected by PBKDF2.
-- The MCP auth path also performs an opportunistic in-place upgrade on first use for any
-- SHA-256 token that authenticates before this migration runs (belt-and-suspenders).
DELETE FROM api_tokens
WHERE tokenHash NOT LIKE 'pbkdf2$%'
  AND length(tokenHash) = 64
  AND tokenHash GLOB '[0-9a-f]*';
