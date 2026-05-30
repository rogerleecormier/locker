import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { oauthProvider } from "@better-auth/oauth-provider";
import { jwt } from "better-auth/plugins";
import * as schema from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

// Create a better-auth instance scoped to a single request's env bindings.
// Called once per request from the auth route handler.
export async function createAuth(env: CloudflareEnv) {
  const db = drizzle(env.DB, { schema });

  // Pre-register Claude client, upserting on every request to keep redirect URIs in sync.
  if (env.CLAUDE_CLIENT_ID) {
    const claudeClientValues = {
      clientId: env.CLAUDE_CLIENT_ID,
      clientSecret: env.CLAUDE_CLIENT_SECRET ?? null,
      name: "Claude",
      redirectUris: JSON.stringify(["https://claude.ai/api/mcp/auth_callback"]),
      scopes: JSON.stringify(["openid", "profile", "email", "offline_access"]),
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
  }

  return betterAuth({
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
          jwt: async ({ token, user }) => {
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
        scopes: ["openid", "profile", "email", "offline_access"],
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        validAudiences: [env.BETTER_AUTH_URL, `${env.BETTER_AUTH_URL}/api/mcp`],
        silenceWarnings: {
          oauthAuthServerConfig: true,
          openidConfig: true,
        },
        callbacks: {
          // Customize userinfo response to include orgIds and teamIds from JWT claims
          userinfoResponse: async ({ user, token }) => {
            const orgIds = (token as Record<string, unknown>).orgIds ?? [];
            const teamIds = (token as Record<string, unknown>).teamIds ?? [];
            return {
              sub: user.id,
              email: user.email,
              name: user.name,
              email_verified: user.emailVerified,
              picture: user.image,
              orgIds,
              teamIds,
            };
          },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
