/**
 * One-time deployment setup: OAuth client seeding and demo user provisioning.
 *
 * This module is intentionally decoupled from the request lifecycle. It is
 * invoked from three places — never from createAuth or any request handler:
 *   1. POST /api/admin/setup  (deploy scripts, manual ops)
 *   2. The Cloudflare scheduled handler (daily cron, via ctx.waitUntil)
 *   3. Optionally: a local migration script run via wrangler
 *
 * All operations are idempotent — safe to run multiple times.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

type SchemaDb = ReturnType<typeof drizzle<typeof schema>>;

// ── Claude OAuth client ───────────────────────────────────────────────────────

export async function ensureClaudeOAuthClient(
  db: SchemaDb,
  env: CloudflareEnv,
): Promise<{ status: "created" | "updated" | "skipped" }> {
  if (!env.CLAUDE_CLIENT_ID) {
    return { status: "skipped" };
  }

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
    console.log("[setup] Created Claude OAuth client.");
    return { status: "created" };
  }

  await db
    .update(schema.oauthClients)
    .set(claudeClientValues)
    .where(eq(schema.oauthClients.clientId, env.CLAUDE_CLIENT_ID));
  console.log("[setup] Updated Claude OAuth client.");
  return { status: "updated" };
}

// ── Demo user ─────────────────────────────────────────────────────────────────

export async function ensureDemoUser(
  db: SchemaDb,
  env: CloudflareEnv,
): Promise<{ status: "created" | "skipped" }> {
  const email = env.DEMO_EMAIL;
  const password = env.DEMO_PASSWORD;

  if (!email || !password) {
    return { status: "skipped" };
  }

  const existing = await db.query.users.findFirst({
    where: (u, { eq }) => eq(u.email, email),
  });

  if (existing) {
    return { status: "skipped" };
  }

  const userId = "demo_user_id_locker_dev";
  const { hashPassword } = await import("better-auth/crypto");
  const hashedPassword = await hashPassword(password);

  await db.insert(schema.users).values({
    id: userId,
    name: "Demo User",
    email,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(schema.userPlans).values({
    userId,
    plan: "free",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await db.insert(schema.accounts).values({
    id: "demo_account_id_locker_dev",
    accountId: email,
    providerId: "credential",
    userId,
    password: hashedPassword,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  console.log("[setup] Seeded demo user account in D1.");

  const defaultMemories = [
    "Locker is a secure context and rule engine for AI-native engineering.",
    "Locker uses envelope encryption with AES-256-GCM for all memories.",
    "Locker integrates with Cursor, Claude Desktop, and Copilot via the Model Context Protocol (MCP).",
  ];

  const { getOrCreateVaultKey, encrypt } = await import("./crypto");
  const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, userId);

  for (const text of defaultMemories) {
    const memId = crypto.randomUUID();
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

  console.log("[setup] Seeded default sandbox memories in Vectorize.");
  return { status: "created" };
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

export type SetupResult = {
  claudeOAuthClient: { status: "created" | "updated" | "skipped" };
  demoUser: { status: "created" | "skipped" };
};

export async function runSetup(env: CloudflareEnv): Promise<SetupResult> {
  const db = drizzle(env.DB, { schema });

  const [claudeOAuthClient, demoUser] = await Promise.allSettled([
    ensureClaudeOAuthClient(db, env),
    ensureDemoUser(db, env),
  ]);

  return {
    claudeOAuthClient:
      claudeOAuthClient.status === "fulfilled"
        ? claudeOAuthClient.value
        : (() => { console.error("[setup] ensureClaudeOAuthClient failed:", (claudeOAuthClient as PromiseRejectedResult).reason); return { status: "skipped" as const }; })(),
    demoUser:
      demoUser.status === "fulfilled"
        ? demoUser.value
        : (() => { console.error("[setup] ensureDemoUser failed:", (demoUser as PromiseRejectedResult).reason); return { status: "skipped" as const }; })(),
  };
}
