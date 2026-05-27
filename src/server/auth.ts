import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { oidcProvider } from "better-auth/plugins/oidc-provider";
import * as schema from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

// Create a better-auth instance scoped to a single request's env bindings.
// Called once per request from the auth route handler.
export function createAuth(env: CloudflareEnv) {
  const db = drizzle(env.DB, { schema });

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        oauthApplication: schema.oauthApplications,
        oauthAccessToken: schema.oauthAccessTokens,
        oauthConsent: schema.oauthConsents,
      },
    }),
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
      oidcProvider({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        requirePKCE: false,
        scopes: ["openid", "profile", "email"],
        trustedClients: env.CLAUDE_CLIENT_ID ? [
          {
            clientId: env.CLAUDE_CLIENT_ID,
            clientSecret: env.CLAUDE_CLIENT_SECRET,
            name: "Claude (claude.ai)",
            redirectUrls: ["https://claude.ai/api/mcp/auth_callback"],
          },
        ] : [],
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
