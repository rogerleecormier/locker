import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";
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
      jwt({ jwt: { issuer: env.BETTER_AUTH_URL } }),
      oauthProvider({
        loginPage: "/login",
        consentPage: "/oauth/consent",
        scopes: ["openid", "profile", "email", "offline_access"],
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        validAudiences: [env.BETTER_AUTH_URL, `${env.BETTER_AUTH_URL}/api/mcp`],
        silenceWarnings: {
          oauthAuthServerConfig: true,
          openidConfig: true,
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
