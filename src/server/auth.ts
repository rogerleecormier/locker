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

/** Tracks if the demo user has been created/verified in this isolate. */
let demoUserEnsured = false;

// ── One-time OAuth client bootstrap ──────────────────────────────────────────

/**
 * Ensures the demo user exists in D1 and Vectorize.
 */
async function ensureDemoUser(
  db: SchemaDb,
  env: CloudflareEnv,
): Promise<void> {
  if (demoUserEnsured) return;
  const email = "demo@locker.rcormier.dev";
  const password = "demopassword123";

  try {
    const existing = await db.query.users.findFirst({
      where: (u, { eq }) => eq(u.email, email),
    });

    if (existing) {
      demoUserEnsured = true;
      return;
    }

    const userId = "demo_user_id_locker_dev";
    const { hashPassword } = await import("better-auth/crypto");
    const hashedPassword = await hashPassword(password);

    // 1. Create demo user
    await db.insert(schema.users).values({
      id: userId,
      name: "Demo User",
      email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 2. Create demo plan
    await db.insert(schema.userPlans).values({
      userId,
      plan: "free",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 3. Create demo credentials account
    await db.insert(schema.accounts).values({
      id: "demo_account_id_locker_dev",
      accountId: email,
      providerId: "credential",
      userId,
      password: hashedPassword,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    console.log("[auth] Seeded demo user account in D1.");

    // 4. Seed default memories in Vectorize & D1
    const defaultMemories = [
      "Locker is a secure context and rule engine for AI-native engineering.",
      "Locker uses envelope encryption with AES-256-GCM for all memories.",
      "Locker integrates with Cursor, Claude Desktop, and Copilot via the Model Context Protocol (MCP)."
    ];

    const { getOrCreateVaultKey, encrypt } = await import("./crypto");
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, userId);

    for (const text of defaultMemories) {
      const memId = crypto.randomUUID();
      
      // Generate embedding using Workers AI
      const result = await env.AI.run("@cf/baai/bge-m3", { text: [text] });
      const r = result as { data?: number[][] };
      const embedding = r.data?.[0] ?? [];

      const encryptedFact = await encrypt(text, vaultKey);

      await db.insert(schema.memories).values({
        id: memId,
        userId,
        fact: encryptedFact,
        category: "references",
        tags: "demo-default",
        timestamp: Date.now(),
        isActive: true,
        projectKey: "demo:default",
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
            category: "references",
            tags: "demo-default",
            projectKey: "demo:default",
          } as any,
        },
      ]);
    }
    console.log("[auth] Seeded default sandbox memories in Vectorize.");
    demoUserEnsured = true;
  } catch (err) {
    console.error("[auth] Failed to check or seed demo user:", err);
  }
}

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

  // Ensure the Claude OAuth client exists exactly once per isolate lifetime.
  // This replaces the previous per-request upsert that caused D1 write storms.
  await ensureClaudeOAuthClient(db, env);
  
  // Ensure the demo user and default memories exist
  await ensureDemoUser(db, env);

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
