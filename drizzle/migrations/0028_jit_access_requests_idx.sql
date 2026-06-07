CREATE INDEX IF NOT EXISTS idx_jit_access_requests_token_status
ON jit_access_requests(tokenId, status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_jit_access_requests_status
ON jit_access_requests(status);
