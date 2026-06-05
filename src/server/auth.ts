import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";
import * as schema from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

// ── Module-level cache ────────────────────────────────────────────────────────
// In Cloudflare Workers, module-level variables persist for the lifetime of an
// isolate (typically many requests). We cache the betterAuth instance keyed by
// a stable identity string so we only build it once per isolate warm-up, and
// we cache whether we have already ensured the Claude OAuth client row exists
// so we only do that D1 write once per isolate as well.

/** Isolate-scoped cache: identity key → betterAuth instance */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authCache = new Map<string, ReturnType<typeof betterAuth<BetterAuthOptions>>>();

/**
 * Tracks which CLAUDE_CLIENT_ID values have already been upserted into D1
 * within this isolate lifetime.  Once set, we skip all further writes.
 */
const claudeClientEnsured = new Set<string>();

/** TTL (ms) for the betterAuth instance cache before we allow a rebuild. */
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Timestamps of when each cached entry was created. */
const authCacheTimestamps = new Map<string, number>();

// ── One-time OAuth client bootstrap ──────────────────────────────────────────

/**
 * Ensures the Claude OAuth client row exists in D1.
 * Runs at most once per isolate lifetime per CLAUDE_CLIENT_ID value.
 * This is intentionally separated from the per-request auth path so that
 * D1 writes never block normal request handling after the first warm-up.
 */
type SchemaDb = ReturnType<typeof drizzle<typeof schema>>;

async function ensureClaudeOAuthClient(
  db: SchemaDb,
  env: CloudflareEnv,
): Promise<void> {
  if (!env.CLAUDE_CLIENT_ID) return;
  if (claudeClientEnsured.has(env.CLAUDE_CLIENT_ID)) return;

  const claudeClientValues = {
    clientId: env.CLAUDE_CLIENT_ID,
    clientSecret: env.CLAUDE_CLIENT_SECRET ?? null,
    name: "Claude",
    redirectUris: JSON.stringify(["https://claude.ai/api/mcp/auth_callback"]),
    scopes: JSON.stringify([
      "openid",
      "profile",
      "email",
      "offline_access",
      "openid:mcp:recall",
      "openid:mcp:commit",
      "openid:mcp:update",
      "openid:mcp:delete",
    ]),
    public: true,
    requirePKCE: true,
    tokenEndpointAuthMethod: "none",
    grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
    responseTypes: JSON.stringify(["code"]),
    updatedAt: new Date(),
  };

  const existing = await db.query.oauthClients.findFirst({
    where: (clients, { eq }) => eq(clients.clientId, env.CLAUDE_CLIENT_ID),
  });

  if (!existing) {
    await db.insert(schema.oauthClients).values({
      id: crypto.randomUUID(),
      createdAt: new Date(),
      ...claudeClientValues,
    });
  } else {
    await db
      .update(schema.oauthClients)
      .set(claudeClientValues)
      .where(eq(schema.oauthClients.clientId, env.CLAUDE_CLIENT_ID));
  }

  // Mark as done for this isolate — no more writes until isolate is evicted.
  claudeClientEnsured.add(env.CLAUDE_CLIENT_ID);
}

// ── Auth instance factory ─────────────────────────────────────────────────────

/**
 * Returns a betterAuth instance for the given environment.
 *
 * The instance is cached at module (isolate) scope so construction —
 * and the one-time Claude OAuth client upsert — happen only on the
 * first request after a cold start, not on every request.
 *
 * Cache entries expire after AUTH_CACHE_TTL_MS (5 min) so that
 * config changes propagate without requiring an isolate restart.
 */
export async function createAuth(env: CloudflareEnv) {
  const cacheKey = `${env.BETTER_AUTH_SECRET}:${env.BETTER_AUTH_URL}:${env.CLAUDE_CLIENT_ID ?? ""}`;
  const now = Date.now();
  const cachedAt = authCacheTimestamps.get(cacheKey) ?? 0;

  if (authCache.has(cacheKey) && now - cachedAt < AUTH_CACHE_TTL_MS) {
    return authCache.get(cacheKey)!;
  }

  const db = drizzle(env.DB, { schema });

  // Ensure the Claude OAuth client exists exactly once per isolate lifetime.
  // This replaces the previous per-request upsert that caused D1 write storms.
  await ensureClaudeOAuthClient(db, env);

  const auth = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    advanced: {
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
    },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        jwks: schema.jwks,
        oauthClient: schema.oauthClients,
        oauthAccessToken: schema.oauthAccessTokensV2,
        oauthRefreshToken: schema.oauthRefreshTokens,
        oauthConsent: schema.oauthConsentsV2,
      },
    }),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
      jwt({
        jwt: { issuer: env.BETTER_AUTH_URL },
        jwks: {
          keyPairConfig: {
            alg: "RS256",
          },
        },
        callbacks: {
          jwt: async ({ token, user }: { token: any; user: any }) => {
            if (user?.id) {
              // Fetch org and team memberships
              const [orgRows, teamRows] = await Promise.all([
                db.query.organizationMembers.findMany({
                  where: (members, { eq }) => eq(members.userId, user.id),
                  columns: { orgId: true },
                }),
                db.query.teamMembers.findMany({
                  where: (members, { eq }) => eq(members.userId, user.id),
                  columns: { teamId: true },
                }),
              ]);

              // Add org and team IDs to JWT claims
              token.orgIds = orgRows.map((o) => o.orgId);
              token.teamIds = teamRows.map((t) => t.teamId);
            }
            return token;
          },
        },
      }),
      oauthProvider({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        scopes: [
          "openid",
          "profile",
          "email",
          "offline_access",
          "openid:mcp:recall",
          "openid:mcp:commit",
          "openid:mcp:update",
          "openid:mcp:delete",
        ],
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        validAudiences: [env.BETTER_AUTH_URL, `${env.BETTER_AUTH_URL}/api/mcp`],
        silenceWarnings: {
          oauthAuthServerConfig: true,
          openidConfig: true,
        },
      }),
    ],
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authCache.set(cacheKey, auth as any);
  authCacheTimestamps.set(cacheKey, now);

  return auth;
}

export type Auth = ReturnType<typeof createAuth>;
