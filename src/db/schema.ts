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

export const oauthApplications = sqliteTable("oauthApplication", {
  id: text("id").primaryKey(),
  clientId: text("clientId").notNull().unique(),
  clientSecret: text("clientSecret"),
  name: text("name").notNull(),
  type: text("type", { enum: ["web", "native", "user-agent-based", "public"] }).notNull(),
  icon: text("icon"),
  metadata: text("metadata"),
  redirectUrls: text("redirectUrls").notNull(),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const oauthAccessTokens = sqliteTable("oauthAccessToken", {
  id: text("id").primaryKey(),
  accessToken: text("accessToken").notNull().unique(),
  refreshToken: text("refreshToken").notNull().unique(),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp_ms" }).notNull(),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", { mode: "timestamp_ms" }).notNull(),
  scopes: text("scopes").notNull(),
  clientId: text("clientId").notNull().references(() => oauthApplications.clientId, { onDelete: "cascade" }),
  userId: text("userId").references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export const oauthConsents = sqliteTable("oauthConsent", {
  id: text("id").primaryKey(),
  clientId: text("clientId").notNull().references(() => oauthApplications.clientId, { onDelete: "cascade" }),
  userId: text("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  scopes: text("scopes").notNull(),
  consentGiven: integer("consentGiven", { mode: "boolean" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;

export const MCP_PERM_RECALL = 1 << 0;   // bit 0
export const MCP_PERM_COMMIT = 1 << 1;   // bit 1
