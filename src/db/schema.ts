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

// api_tokens: MCP access tokens with per-tool permission bitmask
// permissions bitmask: bit 0 = recall_context, bit 1 = commit_memory
export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("tokenHash").notNull().unique(),
  permissions: integer("permissions").notNull().default(3), // 0b11 = all tools
  createdAt: integer("createdAt").notNull(),
  lastUsedAt: integer("lastUsedAt"),
});

export const memories = sqliteTable("memories", {
  id: text("id").primaryKey(),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  fact: text("fact").notNull(),
  category: text("category", { enum: ["rules", "projects", "references"] }).notNull(),
  tags: text("tags").notNull().default(""),
  timestamp: integer("timestamp").notNull(),
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

export const MCP_PERM_RECALL = 1 << 0;   // bit 0
export const MCP_PERM_COMMIT = 1 << 1;   // bit 1
