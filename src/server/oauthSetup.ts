import { drizzle } from "drizzle-orm/d1";
import * as schema from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

export async function registerClaudeOAuthClient(env: CloudflareEnv) {
  if (!env.CLAUDE_CLIENT_ID || !env.CLAUDE_CLIENT_SECRET) {
    throw new Error("CLAUDE_CLIENT_ID and CLAUDE_CLIENT_SECRET environment variables are required");
  }

  const db = drizzle(env.DB, { schema });

  const existing = await db.query.oauthClients.findFirst({
    where: (clients, { eq }) => eq(clients.clientId, env.CLAUDE_CLIENT_ID),
  });

  if (existing) {
    return {
      success: true,
      message: `Claude OAuth client already registered (ID: ${existing.clientId})`,
      clientId: existing.clientId,
    };
  }

  const now = new Date();
  await db.insert(schema.oauthClients).values({
    id: crypto.randomUUID(),
    clientId: env.CLAUDE_CLIENT_ID,
    clientSecret: env.CLAUDE_CLIENT_SECRET,
    name: "Claude",
    redirectUris: JSON.stringify([`${env.BETTER_AUTH_URL}/oauth/callback`]),
    scopes: JSON.stringify(["openid", "profile", "email", "offline_access"]),
    public: false,
    requirePKCE: true,
    tokenEndpointAuthMethod: "client_secret_basic",
    grantTypes: JSON.stringify(["authorization_code", "refresh_token"]),
    responseTypes: JSON.stringify(["code"]),
    icon: `${env.BETTER_AUTH_URL}/logo.png`,
    createdAt: now,
    updatedAt: now,
  });

  return {
    success: true,
    message: `Claude OAuth client registered successfully`,
    clientId: env.CLAUDE_CLIENT_ID,
  };
}
