# Webhook Intake Routes

Automated context capture pipelines for GitHub PRs and Linear tickets.

## Overview

These routes enable webhook-driven memory capture:
- **GitHub**: `POST /api/webhooks/github` — triggered on PR merged events
- **Linear**: `POST /api/webhooks/linear` — triggered on ticket done events

Both routes:
1. Verify HMAC-SHA256 signatures using per-tenant webhook secrets
2. Resolve Locker API tokens to determine vault scope (personal/org/team)
3. Fetch diff or description from the source platform
4. Generate AI summaries via Cloudflare Workers AI
5. Encrypt and persist as memories with category `projects` and tags `#webhook #source`

## Authentication

All webhook requests must include:
- **Authorization header**: `Bearer lkr_XXXXX` (Locker API token with `commit_memory` permission)
- **Platform-specific HMAC header**:
  - GitHub: `x-hub-signature-256: sha256=<hex>`
  - Linear: `x-linear-signature: <hex>`

## Setup

### GitHub Webhooks

1. Navigate to your GitHub repository settings → Webhooks
2. Create a new webhook with:
   - **Payload URL**: `https://your-locker-instance.com/api/webhooks/github`
   - **Content type**: `application/json`
   - **Secret**: Use `store_credential` to save as `__WEBHOOK_GITHUB__` in your Locker vault
   - **Events**: Enable "Pull Requests" (specifically "closed" action)

### Linear Webhooks

1. In Linear workspace settings → API → Webhooks
2. Create a new webhook:
   - **URL**: `https://your-locker-instance.com/api/webhooks/linear`
   - **Secret**: Use `store_credential` to save as `__WEBHOOK_LINEAR__` in your Locker vault
   - **Subscribe to**: "Issue updated" or "Issue changed"

### Configuring Secrets

#### Via CLI (Recommended)

```bash
locker store_credential --name __WEBHOOK_GITHUB__ --value "your-github-secret"
locker store_credential --name __WEBHOOK_LINEAR__ --value "your-linear-secret"
```

#### Via MCP (Programmatic)

```typescript
await mcp.store_credential({
  name: "__WEBHOOK_GITHUB__",
  value: "your-github-secret",
  projectKey: "org:org-uuid", // optional: org/team scope
});
```

## Payload Structure

### GitHub PR Merged

```json
{
  "action": "closed",
  "pull_request": {
    "node_id": "PR_abc...",
    "number": 42,
    "title": "feat: add feature",
    "merged": true,
    "diff_url": "https://...",
    "body": "Description..."
  }
}
```

**Response (201 success):**
```json
{
  "ok": true,
  "memoryId": "uuid",
  "category": "projects",
  "tags": "#webhook #github"
}
```

### Linear Ticket Done

```json
{
  "action": "update",
  "type": "Issue",
  "data": {
    "id": "LIN-123",
    "title": "Implement X",
    "description": "...",
    "state": {
      "name": "Done"
    }
  }
}
```

**Response (200 success):**
```json
{
  "ok": true,
  "memoryId": "uuid",
  "category": "projects",
  "tags": "#webhook #linear"
}
```

## Memory Storage

Each webhook creates a memory with:
- **Category**: `projects`
- **Tags**: `#webhook #github` or `#webhook #linear`
- **Fact**: `[PR Merged|Ticket Done] <title>\n\n<AI summary>`
- **Scope**: Determined by the API token's scope (personal/org/team)
- **Encryption**: Encrypted with the vault's data encryption key (DEK)

### Idempotency

Duplicate webhooks are detected via `(source, externalId)` tuple in the `webhook_events` table.
Replayed webhooks return `200 OK` with `duplicate: true`.

## Error Responses

| Status | Scenario |
|--------|----------|
| 200 | Success; memory committed |
| 200 | Skipped event (not merged PR / not done ticket) |
| 200 | Duplicate event (idempotent) |
| 401 | Missing or invalid Locker token |
| 401 | Token lacks `commit_memory` permission |
| 401 | Token expired |
| 401 | Webhook secret not configured |
| 401 | HMAC signature mismatch (tampered body) |
| 405 | Request method is not POST |

**Example 401 (missing secret):**
```json
{
  "error": "Webhook secret not configured. Store a credential named __WEBHOOK_GITHUB__ in your vault to enable this integration.",
  "hint": "Use Settings → Webhooks → GitHub to configure your webhook secret."
}
```

## Multi-Tenancy

### Personal Scope

Token with `scopeType: personal` → memory stored in user's personal vault.

**Secret lookup**: User's credential vault.

### Organization Scope

Token with `scopeType: organization` → memory stored in org vault (`org:<orgId>`).

**Secret lookup**: Org's credential vault.

### Team Scope

Token with `scopeType: team` → memory stored in team vault (`team:<teamId>`).

**Secret lookup**: **Parent org's** credential vault (teams inherit org secrets).

## Implementation Details

### Signature Verification

Timing-safe HMAC-SHA256 comparison prevents timing attacks.

```typescript
// GitHub
computed = HMAC-SHA256(secret, body)
expected = header.slice("sha256=".length)
timingSafeEqual(computed, expected)

// Linear
computed = HMAC-SHA256(secret, body)
expected = header
timingSafeEqual(computed, expected)
```

### AI Summarization

Uses Cloudflare Workers AI model `@cf/meta/llama-3.1-8b-instruct-fp8`.

**System prompt** (optimized for technical summaries):
> "You are a senior software engineer writing concise technical changelog entries.
> Given a code diff or ticket description, produce a single-paragraph technical summary (3-5 sentences, ≤ 150 words).
> Focus on: what changed, why it matters, and any notable implementation decisions.
> Do NOT include greetings, bullet points, or markdown headers — plain prose only."

### Diff Truncation

- GitHub diffs capped at 128 KB
- Linear descriptions capped at 8 KB
- Fallback to PR body / ticket title if diff fetch fails

## Testing

Run the comprehensive test suite:

```bash
npm test src/server/webhooks.test.ts
npm test src/routes/api/webhooks/github.test.ts
npm test src/routes/api/webhooks/linear.test.ts
```

Tests cover:
- HMAC signature verification (correct & incorrect)
- Multi-tenant secret resolution
- Payload parsing for both platforms
- Encryption/decryption round-trips
- Idempotency
- Edge cases (unicode, special chars, missing fields)

## Debugging

Enable debug logging by setting environment variable:

```bash
DEBUG=webhook:* npm run dev
```

Check `webhook_events` table for processed events:

```sql
SELECT id, source, externalId, eventType, projectKey, processedAt
FROM webhook_events
ORDER BY processedAt DESC
LIMIT 10;
```

View encrypted memories:

```bash
locker recall_context --query "webhook" --tag "webhook"
```

## Rate Limits

Governed by org quota (`org_quotas.monthlyCommits`). Each webhook counts as one commit operation.

Default quotas:
- Free: 500 commits/month
- Business: 5,000 commits/month
- Enterprise: Unlimited

## Migration from v0

If migrating from an earlier version:
1. Verify webhook secrets are stored in the credentials table (not env vars)
2. Confirm API token has `commit_memory` permission bit (value 2)
3. Rotate old webhook secrets in GitHub/Linear settings
4. Test with a real event (e.g., merge a PR to a test repo)
