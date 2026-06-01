import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
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
  permissions: integer("permissions").notNull().default(3), // 0b11 = all tools
  scopeType: text("scopeType", { enum: ["personal", "organization", "team"] }).notNull().default("personal"),
  scopeId: text("scopeId"),
  scopes: text("scopes"), // JSON array of allowed scopes, e.g. [{"type":"personal","id":null}]
  createdAt: integer("createdAt").notNull(),
  expiresAt: integer("expiresAt"),
  lastUsedAt: integer("lastUsedAt"),
});

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  fact: text("fact").notNull(),
  category: text("category", { enum: ["rules", "projects", "references"] }).notNull(),
  tags: text("tags").notNull().default(""),
  timestamp: integer("timestamp").notNull(),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  projectKey: text("projectKey"),
  scopeType: text("scopeType", { enum: ["personal", "organization", "team"] }).notNull().default("personal"),
  scopeId: text("scopeId"),
  isLocked: integer("isLocked", { mode: "boolean" }).notNull().default(false),
  authorityType: text("authorityType", { enum: ["authoritative", "contributed"] }).notNull().default("contributed"),
  lastAccessedAt: integer("lastAccessedAt"),
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

// ── Multi-tenancy layer (organizations & teams) ──────────────────────────────
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"), // 'free' | 'pro' | 'enterprise'
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
  plan: text("plan").notNull().default("free"),
  monthlyMemories: integer("monthlyMemories").notNull().default(100),
  monthlyRecalls: integer("monthlyRecalls").notNull().default(1000),
  monthlyCommits: integer("monthlyCommits").notNull().default(500),
});

// ── Memory Versioning / Change History ────────────────────────────────────────
export const memoryVersions = sqliteTable("memory_versions", {
  id: text("id").primaryKey(),
  memoryId: text("memoryId").notNull().references(() => memories.id, { onDelete: "cascade" }),
  fact: text("fact").notNull(),
  category: text("category", { enum: ["rules", "projects", "references"] }).notNull(),
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
  plan: text("plan").notNull().default("free"),
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
  orgId: text("orgId").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  fact: text("fact").notNull(),
  category: text("category", { enum: ["rules", "projects", "references"] }).notNull(),
  tags: text("tags").notNull().default(""),
  projectKey: text("projectKey"),
  status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
  reviewedBy: text("reviewedBy").references(() => users.id),
  reviewNotes: text("reviewNotes"),
  createdAt: integer("createdAt").notNull(),
  reviewedAt: integer("reviewedAt"),
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
  planId: text("planId").notNull(), // 'free' | 'business' | 'enterprise'
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

