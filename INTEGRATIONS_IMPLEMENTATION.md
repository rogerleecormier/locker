# Organization Integrations Panel — Implementation Summary

## Overview

Added a comprehensive "Integrations" management tab to the Organization admin view in `/organization` route. This panel enables organization owners/admins to:

1. **Configure webhook signing secrets** for GitHub and Linear integrations
2. **View processed webhook event logs** with metadata and direct links to memory records

## Implementation Details

### 1. Server Functions

#### `saveWebhookSecret(orgId, platform, secret)`
**Location:** `app/src/routes/organization.tsx` (lines 344–389)

Stores encrypted webhook signing secrets per organization and platform.

**Signature:**
```typescript
saveWebhookSecret({
  data: {
    orgId: string,           // Organization ID
    platform: "github" | "linear",
    secret: string           // Webhook signing secret
  }
}): Promise<{ success: true }>
```

**Behavior:**
- Input validation: requires non-empty `orgId`, valid `platform`, and non-empty `secret`
- Authorization check: restricts to org owners/admins via `verifyOrgAdminHelper()`
- Credential storage:
  - Reads existing credential from the org's vault (scope: `org:orgId`)
  - If exists: updates the encrypted value and timestamp
  - If not exist: creates new credential with well-known name
- Credential names:
  - GitHub: `__WEBHOOK_GITHUB__`
  - Linear: `__WEBHOOK_LINEAR__`
- Scope metadata: `scopeType: "organization"`, `scopeId: orgId`, `projectKey: org:orgId`

**Database Tables Used:**
- `credentials`: Stores encrypted secrets with vault scope and timestamp
- `organization_members`: For authorization checks

#### `getWebhookEventLog(orgId, limit)`
**Location:** `app/src/routes/organization.tsx` (lines 391–427)

Retrieves the most recent webhook events processed for an organization.

**Signature:**
```typescript
getWebhookEventLog({
  data: {
    orgId: string,
    limit?: number           // Clamped: [1, 500], default 50
  }
}): Promise<{
  events: Array<{
    id: string,
    source: "github" | "linear",
    eventType: "pr.merged" | "ticket.done",
    rawTitle: string,        // Plain-text title for display
    processedAt: number,     // Epoch milliseconds
    memoryId: string | null, // Link to encrypted summary
    externalId: string,
    userName: string | null
  }>
}>
```

**Behavior:**
- Input validation: requires `orgId`; clamps `limit` to [1, 500] (default: 50)
- Authorization check: restricts to org owners/admins
- Query: fetches events scoped to `org:orgId` (from `webhookEvents.projectKey`), ordered descending by `processedAt`
- Join with `users` table to populate `userName` (left join handles deleted users)
- Returns raw, unencrypted metadata (summary is still encrypted in `encryptedSummary`)

**Database Tables Used:**
- `webhook_events`: Event records with source, type, processed timestamp
- `users`: For user name resolution
- `organization_members`: For authorization checks

### 2. UI Component: IntegrationsPanel

**Location:** `app/src/routes/organization.tsx` (lines 1276–1388)

A new React functional component displayed when `activeTab === "integrations"`.

**Structure:**

1. **Webhook Configuration Section** (two-column grid on desktop, single-column on mobile)
   - **GitHub Webhook Card:**
     - Input field for webhook signing secret (password-masked)
     - Save button calls `saveWebhookSecret(orgId, "github", secret)`
     - On success: clears input, shows toast confirmation, refetches event log
   - **Linear Webhook Card:**
     - Identical layout for Linear platform
     - Save button calls `saveWebhookSecret(orgId, "linear", secret)`

2. **Webhook Event Log Section**
   - **Table layout** (responsive with horizontal scroll on mobile):
     - **Source**: Badge showing "🐙 github" or "⚡ linear"
     - **Event Type**: "PR Merged" or "Ticket Done"
     - **Title**: Event title (truncated, hoverable with full title in tooltip)
     - **Processed At**: Formatted timestamp via `toLocaleString()`
     - **Memory Link**: Clickable shortcut to memory record (shows first 8 chars of UUID + "…")
   
   - **Empty states:**
     - Loading: Animate-pulse skeleton message
     - No events: Informational message
     - No memory link: Shows "—" (em dash)

**State Management:**
- `githubSecret`, `setGithubSecret`: Form input for GitHub secret
- `linearSecret`, `setLinearSecret`: Form input for Linear secret
- Mutations: `saveGithubMut`, `saveLinearMut` (via `useMutation`)
- Query: `webhookEvents` (via `useQuery`, refetches on successful save)

**Styling:**
- Uses existing design system tokens (Tailwind, CSS variables)
- Matches `AdminAuditLog.tsx` aesthetic: `bg-surface`, `border-border`, rounded cards
- Badge variants for source icons
- Font scaling: form labels `text-[10px]`, table headers `text-[10px]`, table cells `text-xs`

### 3. Tab Integration

**Location:** `app/src/routes/organization.tsx` (lines 934–939)

- Added `"integrations"` to the union type for `activeTab`
- New tab button calls `setActiveTab("integrations")`
- Only visible to org admins: `{isAdmin && tabBtn(...)}`
- Tooltip: "Manage webhook configurations for GitHub and Linear integrations, and review processed webhook events."

### 4. Schema Integration

**Database Tables (Pre-existing):**

| Table | Columns Used | Purpose |
|-------|---------|---------|
| `credentials` | `id`, `userId`, `name`, `encryptedValue`, `projectKey`, `scopeType`, `scopeId`, `createdAt`, `updatedAt` | Store webhook secrets per-org with vault scope |
| `webhook_events` | `id`, `source`, `eventType`, `rawTitle`, `processedAt`, `memoryId`, `externalId`, `projectKey`, `userId` | Audit log of processed webhook events |
| `users` | `id`, `name` | Join for user display names |
| `organization_members` | `orgId`, `userId`, `role` | Authorization checks |

**No schema migrations required** — leverages existing encrypted credential vault and webhook event infrastructure.

## Tests

**Location:** `app/src/routes/organization.test.ts`

**23 total test cases** across 5 describe blocks:

### 1. `saveWebhookSecret` (5 tests)
- Validates `orgId` is required
- Validates `platform` is 'github' or 'linear'
- Validates `secret` is required
- Accepts valid GitHub payload
- Accepts valid Linear payload

### 2. `getWebhookEventLog` (5 tests)
- Validates `orgId` is required
- Defaults to limit 50
- Clamps limit to minimum 1
- Clamps limit to maximum 500
- Accepts valid request with custom limit

### 3. `Webhook event processing flow` (5 tests)
- Tracks GitHub PR merged metadata correctly
- Tracks Linear ticket done metadata correctly
- Formats event timestamps correctly
- Handles missing `userName` gracefully (displays "—")
- Handles missing `memoryId` gracefully (displays "—")

### 4. `Secret credential storage` (4 tests)
- Maps GitHub → `__WEBHOOK_GITHUB__` credential name
- Maps Linear → `__WEBHOOK_LINEAR__` credential name
- Generates correct vault scope `org:orgId`
- Creates credential with correct scope metadata

### 5. `Event log display` (4 tests)
- Truncates long event titles
- Renders memory link with shortened ID (first 8 chars + "…")
- Displays empty state when no events
- Limits displayed events to 50 by default

**Test Coverage:**
- ✅ Input validation for both server functions
- ✅ Platform/credential name mapping
- ✅ Org-scoped vault resolution
- ✅ Event metadata tracking and display
- ✅ Edge cases (missing fields, long strings, empty lists)

**Test Execution:**
```bash
npm test                                    # All tests (1242 pass)
npm test -- src/routes/organization.test.ts # Organization tests only (23 pass)
```

## Usage Flow

### For Org Admins:

1. **Navigate** to Organization → [Select Org] → "Integrations" tab

2. **Configure GitHub:**
   - Enter GitHub webhook signing secret in the input field
   - Click "Save Secret"
   - Secret is encrypted and stored in org vault

3. **Configure Linear:**
   - Enter Linear webhook signing secret in the input field
   - Click "Save Secret"
   - Secret is encrypted and stored in org vault

4. **View Events:**
   - Table auto-populates with recent events (sorted newest first)
   - Click memory link to jump to the technical summary committed by the webhook
   - Inspect source, event type, and title to understand what triggered the entry

### For Webhooks:

When a GitHub PR or Linear ticket event arrives:
1. Webhook handler resolves the token scope → secret vault
2. Reads `__WEBHOOK_GITHUB__` or `__WEBHOOK_LINEAR__` from the org's credentials
3. Verifies HMAC signature
4. Encrypts AI-generated summary and commits to memory vault
5. Records row in `webhook_events` table (visible in this UI)

## Security & Compliance

- **Secrets Encryption:** All webhook signing secrets are encrypted via the vault encryption layer (AES-256-GCM with per-vault DEK)
- **Authorization:** Only org owners/admins can save or view webhook configurations
- **Audit Trail:** Every webhook event is recorded with timestamp, user, source, and memory link
- **Multi-tenancy:** Secrets are scoped to individual organizations (`org:orgId`); no cross-org leakage
- **No plaintext logging:** The webhook secret value is only handled on the server; form input is password-masked in the UI

## Files Changed

### New Files
- `app/src/routes/organization.test.ts` — Comprehensive test suite

### Modified Files
- `app/src/routes/organization.tsx`
  - Added 2 server functions: `saveWebhookSecret`, `getWebhookEventLog`
  - Added 1 React component: `IntegrationsPanel`
  - Updated `OrgVaultView` component to add "Integrations" tab
  - Added imports: `credentials`, `webhookEvents`, `memories`, `sql`
  
## Backwards Compatibility

- ✅ All existing tests pass (1242 tests)
- ✅ No breaking changes to existing server functions or UI
- ✅ No schema migrations required
- ✅ Feature gated behind org admin access (new tab only visible to admins)

## Future Enhancements

1. **Webhook configuration UI:** Allow admins to generate and copy webhook URLs
2. **Event filtering:** Filter log by source, date range, or title search
3. **Re-process button:** Manual trigger to re-summarize events
4. **Webhook delivery status:** Track whether webhook signature verification succeeded/failed
5. **Rate limiting dashboard:** Show webhook processing metrics over time
