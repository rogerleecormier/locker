import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  writePasscodeHash: text("writePasscodeHash"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  revokedAt: integer("revokedAt", { mode: "timestamp_ms" }), // null = active, set to revoke
});

export const accounts = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const verifications = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
});

// ── TOTP / Two-Factor Authentication ───────────────────────────────────────
export const totpSecrets = sqliteTable("totp_secrets", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(), // encrypted base32-encoded secret
  verified: integer("verified", { mode: "boolean" }).notNull().default(false),
  backupCodes: text("backupCodes").notNull(), // JSON array of hashed backup codes
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  verifiedAt: integer("verifiedAt", { mode: "timestamp_ms" }),
});

// api_tokens: MCP access tokens with per-tool permission bitmask
// permissions bitmask: bit 0 = recall_context, bit 1 = commit_memory, bit 2 = update_memory, bit 3 = delete_memory
export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("tokenHash").notNull().unique(),
  // First 8 chars of the raw token after the "lkr_" prefix (chars [4,12)).
  // Used as a cheap indexed pre-filter to avoid a full table scan before PBKDF2.
  // Not a secret — security still comes from the PBKDF2 hash.
  tokenPrefix: text("tokenPrefix"),
  permissions: integer("permissions").notNull().default(3), // 0b11 = all tools
  scopeType: text("scopeType", { enum: ["personal", "organization", "team"] }).notNull().default("personal"),
  scopeId: text("scopeId"),
  scopes: text("scopes"), // JSON array of allowed scopes, e.g. [{"type":"personal","id":null}]
  tokenType: text("tokenType", { enum: ["human", "agent"] }).notNull().default("human"),
  agentPolicy: text("agentPolicy"), // JSON: AgentPolicy — only set when tokenType === "agent"
  createdAt: integer("createdAt").notNull(),
  expiresAt: integer("expiresAt"),
  lastUsedAt: integer("lastUsedAt"),
}, (t) => [
  index("idx_api_tokens_prefix").on(t.tokenPrefix),
]);

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  fact: text("fact").notNull(),
  category: text("category", { enum: ["rules", "projects", "references", "configs"] }).notNull(),
  tags: text("tags").notNull().default(""),
  timestamp: integer("timestamp").notNull(),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  projectKey: text("projectKey"),
  scopeType: text("scopeType", { enum: ["personal", "organization", "team"] }).notNull().default("personal"),
  scopeId: text("scopeId"),
  isLocked: integer("isLocked", { mode: "boolean" }).notNull().default(false),
  authorityType: text("authorityType", { enum: ["authoritative", "contributed"] }).notNull().default("contributed"),
  lastAccessedAt: integer("lastAccessedAt"),
  isQuarantined: integer("isQuarantined", { mode: "boolean" }).notNull().default(false),
});

// ── better-auth jwt plugin ─────────────────────────────────────────────────────

export const jwks = sqliteTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("publicKey").notNull(),
  privateKey: text("privateKey").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }),
});

// ── @better-auth/oauth-provider tables ────────────────────────────────────────

export const oauthClients = sqliteTable("oauthClient", {
  id: text("id").primaryKey(),
  clientId: text("clientId").notNull().unique(),
  clientSecret: text("clientSecret"),
  name: text("name"),
  disabled: integer("disabled", { mode: "boolean" }).default(false),
  skipConsent: integer("skipConsent", { mode: "boolean" }),
  redirectUris: text("redirectUris").notNull(),
  scopes: text("scopes"),
  public: integer("public", { mode: "boolean" }),
  type: text("type"),
  requirePKCE: integer("requirePKCE", { mode: "boolean" }),
  userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("referenceId"),
  metadata: text("metadata"),
  icon: text("icon"),
  uri: text("uri"),
  tos: text("tos"),
  policy: text("policy"),
  softwareId: text("softwareId"),
  softwareVersion: text("softwareVersion"),
  softwareStatement: text("softwareStatement"),
  tokenEndpointAuthMethod: text("tokenEndpointAuthMethod"),
  grantTypes: text("grantTypes"),
  responseTypes: text("responseTypes"),
  contacts: text("contacts"),
  postLogoutRedirectUris: text("postLogoutRedirectUris"),
  enableEndSession: integer("enableEndSession", { mode: "boolean" }),
  subjectType: text("subjectType"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
});

export const oauthAccessTokensV2 = sqliteTable("oauthAccessTokenV2", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("clientId").notNull(),
  sessionId: text("sessionId"),
  userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("referenceId"),
  refreshId: text("refreshId"),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }),
  scopes: text("scopes").notNull(),
});

export const oauthRefreshTokens = sqliteTable("oauthRefreshToken", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  clientId: text("clientId").notNull(),
  sessionId: text("sessionId"),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("referenceId"),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }),
  revoked: integer("revoked", { mode: "timestamp_ms" }),
  authTime: integer("authTime", { mode: "timestamp_ms" }),
  scopes: text("scopes").notNull(),
});

export const oauthConsentsV2 = sqliteTable("oauthConsentV2", {
  id: text("id").primaryKey(),
  clientId: text("clientId").notNull(),
  userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
  referenceId: text("referenceId"),
  scopes: text("scopes").notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type TotpSecret = typeof totpSecrets.$inferSelect;

export const MCP_PERM_RECALL = 1 << 0;   // bit 0
export const MCP_PERM_COMMIT = 1 << 1;   // bit 1
export const MCP_PERM_UPDATE = 1 << 2;   // bit 2
export const MCP_PERM_DELETE = 1 << 3;   // bit 3

// ── ABAC types for agent tokens ───────────────────────────────────────────────
export type MemoryCategory = "rules" | "projects" | "references" | "configs";

export type AgentPolicy = {
  agentContext: string;              // human-readable label for the agent, max 128 chars
  allowedCategories: MemoryCategory[]; // empty = ABAC_DEFAULT_ALLOW applies
  deniedCategories: MemoryCategory[];  // always wins over allowedCategories
  // Tag-level least-privilege: explicit allowlist / denylist applied after category filter.
  // allowedTags: if non-empty, only memories whose tags intersect this set are visible.
  // deniedTags:  memories whose tags intersect this set are always blocked (wins over allowedTags).
  // A tag value of "#confidential" triggers the JIT approval workflow rather than a hard deny.
  allowedTags: string[];             // normalised lowercase, e.g. ["#internal","#architecture"]
  deniedTags: string[];              // normalised lowercase, e.g. ["#pii","#secret"]
  allowCredentials: boolean;         // whether retrieve/store/delete_credential are permitted
};

// "configs" is sensitive-by-default — agent tokens are denied access unless explicitly allowed.
// Add future categories like "financial" or "legal" here when introduced.
export const ABAC_SENSITIVE_CATEGORIES: MemoryCategory[] = ["configs"];
export const ABAC_DEFAULT_ALLOW: MemoryCategory[] = ["rules", "projects", "references"];

// Tag that triggers JIT approval rather than a hard ABAC deny.
export const JIT_PROTECTED_TAG = "#confidential";

// ── Multi-tenancy layer (organizations & teams) ──────────────────────────────
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan", { enum: ["free", "business", "business_comp", "enterprise"] }).notNull().default("free"),
  settings: text("settings").notNull().default("{}"), // JSON settings
  billingCustomerId: text("billingCustomerId"),
  billingSubscriptionId: text("billingSubscriptionId"),
  planActivatedAt: integer("planActivatedAt"),
  planExpiresAt: integer("planExpiresAt"),
  memoryVersionRetentionDays: integer("memoryVersionRetentionDays").notNull().default(365), // days to keep versions
  memoryVersionRetentionCount: integer("memoryVersionRetentionCount").notNull().default(50), // max versions per memory
  createdAt: integer("createdAt").notNull(),
});

export const organizationMembers = sqliteTable("organization_members", {
  orgId: text("orgId").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["owner", "admin", "member"] }).notNull().default("member"),
  joinedAt: integer("joinedAt").notNull(),
});

export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  orgId: text("orgId").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: integer("createdAt").notNull(),
});

export const teamMembers = sqliteTable("team_members", {
  teamId: text("teamId").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
});

// ── Audit Log ────────────────────────────────────────────────────────────────
export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  orgId: text("orgId"),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenId: text("tokenId"),
  action: text("action").notNull(), // 'recall_context' | 'commit_memory' | 'delete_memory' | 'update_memory' | 'export_memories'
  memoryId: text("memoryId"),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  timestamp: integer("timestamp").notNull(),
  metadata: text("metadata"), // JSON string
});

// ── Rate Limiting & Quotas ───────────────────────────────────────────────────
export const tokenUsages = sqliteTable("token_usages", {
  id: text("id").primaryKey(),
  tokenId: text("tokenId").notNull(),
  date: text("date").notNull(), // YYYY-MM-DD
  recallCount: integer("recallCount").notNull().default(0),
  commitCount: integer("commitCount").notNull().default(0),
  tokensConsumed: integer("tokensConsumed").notNull().default(0),
});

export const orgQuotas = sqliteTable("org_quotas", {
  orgId: text("orgId").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["free", "business", "business_comp", "enterprise"] }).notNull().default("free"),
  monthlyMemories: integer("monthlyMemories").notNull().default(100),
  monthlyRecalls: integer("monthlyRecalls").notNull().default(1000),
  monthlyCommits: integer("monthlyCommits").notNull().default(500),
});

// ── Memory Versioning / Change History ────────────────────────────────────────
export const memoryVersions = sqliteTable("memory_versions", {
  id: text("id").primaryKey(),
  memoryId: text("memoryId").notNull().references(() => memories.id, { onDelete: "cascade" }),
  fact: text("fact").notNull(),
  category: text("category", { enum: ["rules", "projects", "references", "configs"] }).notNull(),
  tags: text("tags").notNull(),
  changedBy: text("changedBy").notNull(), // userId or 'system'
  changeReason: text("changeReason"), // 'created', 'updated', 'contradiction (archived)', etc.
  timestamp: integer("timestamp").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp_ms" }), // null = keep forever, set for auto-cleanup
});

export type Organization = typeof organizations.$inferSelect;
export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type TeamMember = typeof teamMembers.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type TokenUsage = typeof tokenUsages.$inferSelect;
export type OrgQuota = typeof orgQuotas.$inferSelect;
export type MemoryVersion = typeof memoryVersions.$inferSelect;

// ── User Plans & Billing ──────────────────────────────────────────────────────
export const userPlans = sqliteTable("user_plans", {
  userId: text("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  plan: text("plan", { enum: ["free", "business", "business_comp", "enterprise"] }).notNull().default("free"),
  billingCustomerId: text("billingCustomerId"),
  billingSubscriptionId: text("billingSubscriptionId"),
  planActivatedAt: integer("planActivatedAt"),
  planExpiresAt: integer("planExpiresAt"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const planEvents = sqliteTable("plan_events", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromPlan: text("fromPlan").notNull().default("free"),
  toPlan: text("toPlan").notNull(),
  reason: text("reason"),
  metadata: text("metadata"),
  timestamp: integer("timestamp").notNull(),
});

export const waitlist = sqliteTable("waitlist", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  plan: text("plan").notNull().default("business"),
  notes: text("notes"),
  createdAt: integer("createdAt").notNull(),
});

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  orgId: text("orgId").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  invitedBy: text("invitedBy").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expiresAt").notNull(),
  createdAt: integer("createdAt").notNull(),
});

export const memoryRecommendations = sqliteTable("memory_recommendations", {
  id: text("id").primaryKey(),
  orgId: text("orgId").references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  fact: text("fact").notNull(),
  category: text("category", { enum: ["rules", "projects", "references", "configs"] }).notNull(),
  tags: text("tags").notNull().default(""),
  projectKey: text("projectKey"),
  scopeType: text("scopeType", { enum: ["personal", "organization", "team"] }).notNull().default("personal"),
  scopeId: text("scopeId"),
  // "add" = suggest adding a new memory (org workflow)
  // "archive" = suggest archiving a contradicted memory (contradiction detector)
  // "update" = agent wants to rewrite an existing memory (requires human approval)
  // "delete" = agent wants to permanently delete a memory (requires human approval)
  recommendationType: text("recommendationType", { enum: ["add", "archive", "update", "delete"] }).notNull().default("add"),
  targetMemoryId: text("targetMemoryId").references(() => memories.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  reviewedBy: text("reviewedBy").references(() => users.id),
  reviewNotes: text("reviewNotes"),
  createdAt: integer("createdAt").notNull(),
  reviewedAt: integer("reviewedAt"),
  // Populated for "update" type: the agent's proposed new state (old state is in fact/category/tags).
  proposedFact: text("proposedFact"),
  proposedCategory: text("proposedCategory"),
  proposedTags: text("proposedTags"),
  // Human-readable label of the agent that created this request.
  agentContext: text("agentContext"),
});

export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: text("type").notNull().default("info"),
  status: text("status", { enum: ["unread", "read", "archived"] }).notNull().default("unread"),
  linkUrl: text("linkUrl"),
  createdAt: integer("createdAt").notNull(),
});

export const rateLimitCounters = sqliteTable("rate_limit_counters", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  minuteStart: integer("minuteStart").notNull(),
});

export const featureOverrides = sqliteTable("feature_overrides", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: text("planId", { enum: ["free", "business", "business_comp", "enterprise"] }).notNull(),
  reason: text("reason"), // e.g., 'admin', 'beta_access', 'custom_deal'
  grantedBy: text("grantedBy").notNull().references(() => users.id, { onDelete: "restrict" }),
  grantedAt: integer("grantedAt").notNull(),
  expiresAt: integer("expiresAt"), // null = permanent
  createdAt: integer("createdAt").notNull(),
});

export const stripeEvents = sqliteTable("stripe_events", {
  id: text("id").primaryKey(), // Stripe event.id
  type: text("type").notNull(), // e.g., 'checkout.session.completed', 'customer.subscription.updated'
  processedAt: integer("processedAt").notNull(),
});

export type UserPlan = typeof userPlans.$inferSelect;
export type PlanEvent = typeof planEvents.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type MemoryRecommendation = typeof memoryRecommendations.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type FeatureOverride = typeof featureOverrides.$inferSelect;

export const memoryTemplates = sqliteTable("memory_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category", { enum: ["configs", "compliance", "project_management", "product_management", "devops", "devsecops", "cicd"] }).notNull().default("configs"),
  configPayload: text("config_payload").notNull(), // JSON string tracking directories, rules, constraints
  createdAt: integer("created_at").notNull(),
});

export type MemoryTemplate = typeof memoryTemplates.$inferSelect;

// ── Envelope Encryption — Vault Keys ─────────────────────────────────────────
// Stores one wrapped Data Encryption Key (DEK) per vault.
// The DEK is encrypted with the KEK (ENCRYPTION_KEY env var) using AES-256-GCM.
// vault_id is either a userId (personal vault) or a projectKey ("org:xxx" / "team:xxx").
export const vaultKeys = sqliteTable("vault_keys", {
  vaultId: text("vault_id").primaryKey(),
  wrappedDek: text("wrapped_dek").notNull(), // "iv_hex:ciphertext_hex" of the AES-256-GCM-wrapped DEK
  createdAt: integer("created_at").notNull(),
});

export type VaultKey = typeof vaultKeys.$inferSelect;

// ── Just-in-Time (JIT) Access Requests ───────────────────────────────────────
// Created when an agent queries a memory tagged #confidential.
// status: pending → approved → denied (or auto-expired).
// When approved, a short-lived JIT token is minted and written back here so
// the agent can retry its query with the token to get the unredacted result.
export const jitAccessRequests = sqliteTable("jit_access_requests", {
  id: text("id").primaryKey(),
  tokenId: text("tokenId").notNull().references(() => apiTokens.id, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  // Snapshot of the original MCP request so the agent can replay it after approval.
  mcpMethod: text("mcpMethod").notNull(),   // "recall_context" | "search_memories"
  mcpArgs: text("mcpArgs").notNull(),       // JSON-serialised original tool arguments
  // Which memory IDs were blocked (comma-separated). Used for targeted unredaction.
  blockedMemoryIds: text("blockedMemoryIds").notNull().default(""),
  status: text("status", { enum: ["pending", "approved", "denied"] }).notNull().default("pending"),
  // Short-lived token issued on approval; the agent presents this as its Bearer token.
  jitTokenHash: text("jitTokenHash"),       // PBKDF2 hash of the raw JIT token
  jitExpiresAt: integer("jitExpiresAt"),    // epoch ms — 15 min from approval
  createdAt: integer("createdAt").notNull(),
  reviewedAt: integer("reviewedAt"),
  reviewedBy: text("reviewedBy").references(() => users.id),
  reviewNotes: text("reviewNotes"),
}, (t) => [
  index("idx_jit_access_requests_token_status").on(t.tokenId, t.status),
  index("idx_jit_access_requests_status").on(t.status),
]);

export type JitAccessRequest = typeof jitAccessRequests.$inferSelect;
export type NewJitAccessRequest = typeof jitAccessRequests.$inferInsert;

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  encryptedValue: text("encryptedValue").notNull(),
  projectKey: text("projectKey"),
  scopeType: text("scopeType", { enum: ["personal", "organization", "team"] }).notNull().default("personal"),
  scopeId: text("scopeId"),
  createdAt: integer("createdAt").notNull(),
  updatedAt: integer("updatedAt").notNull(),
});

export type Credential = typeof credentials.$inferSelect;
export type NewCredential = typeof credentials.$inferInsert;

// ── GraphRAG — Entity nodes and relationship edges ────────────────────────────
// Entities are extracted ephemerally by Workers AI on each addMemory/commit_memory.
// entity_ids are stored as a space-separated list in Vectorize metadata so a single
// IN (...) lookup against this table can hydrate adjacent nodes without SQL joins.
export const memoryGraphNodes = sqliteTable("memory_graph_nodes", {
  id: text("id").primaryKey(),                          // stable UUID for this entity
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectKey: text("projectKey"),                       // vault scope, mirrors memories.projectKey
  label: text("label").notNull(),                       // canonical name, e.g. "AuthService"
  type: text("type").notNull(),                         // e.g. "service" | "file" | "concept" | "person"
  createdAt: integer("createdAt").notNull(),
});

export const memoryGraphEdges = sqliteTable("memory_graph_edges", {
  id: text("id").primaryKey(),
  memoryId: text("memoryId").notNull().references(() => memories.id, { onDelete: "cascade" }),
  sourceNodeId: text("sourceNodeId").notNull().references(() => memoryGraphNodes.id, { onDelete: "cascade" }),
  targetNodeId: text("targetNodeId").notNull().references(() => memoryGraphNodes.id, { onDelete: "cascade" }),
  relation: text("relation").notNull(),                 // e.g. "calls" | "depends_on" | "implements"
  createdAt: integer("createdAt").notNull(),
});

export type MemoryGraphNode = typeof memoryGraphNodes.$inferSelect;
export type MemoryGraphEdge = typeof memoryGraphEdges.$inferSelect;

export const systemSettings = sqliteTable("system_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export type SystemSetting = typeof systemSettings.$inferSelect;

// ── Webhook Event Log ─────────────────────────────────────────────────────────
// Records inbound GitHub "PR Merged" and Linear "Ticket Done" webhook events.
// An AI-generated technical summary is encrypted and committed to the memory
// vault automatically when the event is processed.
export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  source: text("source", { enum: ["github", "linear"] }).notNull(),
  eventType: text("event_type", { enum: ["pr.merged", "ticket.done"] }).notNull(),
  externalId: text("external_id").notNull(),        // PR node_id or Linear issue id
  projectKey: text("project_key"),                  // vault scope; null = personal
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  memoryId: text("memory_id").references(() => memories.id, { onDelete: "set null" }),
  encryptedSummary: text("encrypted_summary").notNull(), // AES-256-GCM
  rawTitle: text("raw_title"),                      // plain-text title for display
  processedAt: integer("processed_at").notNull(),   // epoch ms
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type NewWebhookEvent = typeof webhookEvents.$inferInsert;

