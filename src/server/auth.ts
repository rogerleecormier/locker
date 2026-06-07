import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";
import * as schema from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

// ── Module-level cache ────────────────────────────────────────────────────────
// betterAuth instance is cached for the isolate lifetime. No D1 bootstrap
// writes happen here — those live in src/server/setup.ts and are invoked
// from the scheduled handler and the /api/admin/setup endpoint only.

/** Isolate-scoped cache: identity key → betterAuth instance */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const authCache = new Map<string, ReturnType<typeof betterAuth<BetterAuthOptions>>>();

/** TTL (ms) for the betterAuth instance cache before we allow a rebuild. */
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Timestamps of when each cached entry was created. */
const authCacheTimestamps = new Map<string, number>();

// ── New-account memory seed ───────────────────────────────────────────────────

const DEFAULT_RULE_MEMORY = `# Locker Memory Vault Integration — Custom Instructions

You have access to Locker (MCP memory vault) for user profile, projects, rules, and secrets. Proactively read/write to it throughout our chat without prompting.

1. READ:
- Start: Call get_memory_summary or list_accessible_scopes on first turn to align context.
- Before coding/answering: Search relevant guidelines using recall_context (use optimize:true for summaries) or search_memories. Don't assume; check Locker first.

2. WRITE:
- Automatically call commit_memory when I state preferences, tech stack choices, rules, or project paths.
- Fact format: Atomic, third-person declarative statements (no "I" or "You").
- Categories: "rules" (guidelines), "projects" (configs/state), "references" (background). Assign lowercase tags.
- Update/Delete: If a rule/state changes, find the ID and call update_memory or delete_memory. Prevent duplicate/stale data.

3. SECRETS:
- Never commit plaintext API keys/secrets to normal memories. Use store_credential and retrieve_credential.

4. PROTOCOLS:
- Background use: Execute calls silently.
- Priority: Locker memories supersede your defaults.`;

/**
 * Seeds the default Locker integration rule into a newly created user's vault.
 * Called after signup (via databaseHooks) and after admin user creation.
 */
export async function seedNewUserMemory(
  userId: string,
  env: CloudflareEnv,
): Promise<void> {
  try {
    const { getOrCreateVaultKey, encrypt } = await import("./crypto");
    const db = drizzle(env.DB, { schema });
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, userId);

    const memId = crypto.randomUUID();
    const result = await env.AI.run("@cf/baai/bge-m3", { text: [DEFAULT_RULE_MEMORY] });
    const r = result as { data?: number[][] };
    const embedding = r.data?.[0] ?? [];
    const encryptedFact = await encrypt(DEFAULT_RULE_MEMORY, vaultKey);

    await db.insert(schema.memories).values({
      id: memId,
      userId,
      fact: encryptedFact,
      category: "rules",
      tags: "locker,memory-vault,integration,protocol,onboarding,mcp",
      timestamp: Date.now(),
      isActive: true,
      projectKey: null,
      scopeType: "personal",
      isLocked: false,
      authorityType: "contributed",
      isQuarantined: false,
    });

    await env.VECTOR_INDEX.insert([
      {
        id: memId,
        values: embedding,
        metadata: {
          userId,
          category: "rules",
          tags: "locker,memory-vault,integration,protocol,onboarding,mcp",
        } as any,
      },
    ]);

    console.log(`[auth] Seeded default rule memory for user ${userId}.`);
  } catch (err) {
    console.error(`[auth] Failed to seed default rule memory for user ${userId}:`, err);
  }
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

  const auth = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: ["http://localhost:*"],
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
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            seedNewUserMemory(user.id, env).catch(() => {});
          },
        },
      },
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
