import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { handleMcpRequest } from "./routes/-api.mcp";
import { createAuth } from "./server/auth";
import type { CloudflareEnv, ArchiveMessage } from "./types/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { memories } from "./db/schema";
import { archiveContradictingMemories } from "./server/memoryFunctions";

const handler = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const ip = request.headers.get("cf-connecting-ip") ?? "";
    // Log all requests from Anthropic's IP range (160.79.104.0/21)
    if (ip.startsWith("160.79.")) {
      const auth = request.headers.get("Authorization");
      console.log(`[anthropic] ${request.method} ${url.pathname} auth:${auth ? auth.slice(0,20) : "NONE"}`);
    }

    if (url.pathname === "/api/mcp") {
      return handleMcpRequest(request, env);
    }





    if (url.pathname.startsWith("/api/auth/")) {
      const auth = createAuth(env);
      const response = await auth.handler(request);
      if (url.pathname === "/api/auth/oauth2/token" || url.pathname === "/api/auth/oauth2/consent" || url.pathname === "/api/auth/oauth2/userinfo") {
        const text = await response.clone().text();
        console.log(`[${url.pathname}] response:`, response.status, text);
      }
      return response;
    }

    // OAuth 2.0 protected resource metadata (RFC 9728).
    // Claude fetches /.well-known/oauth-protected-resource[/<path>] to discover the auth server.
    if (url.pathname === "/.well-known/oauth-protected-resource" ||
        url.pathname.startsWith("/.well-known/oauth-protected-resource/")) {
      return Response.json({
        resource: `${url.origin}/api/mcp`,
        authorization_servers: [url.origin],
        bearer_methods_supported: ["header"],
        resource_documentation: `${url.origin}/connect`,
      });
    }

    // OAuth 2.0 authorization server metadata (RFC 8414).
    // Serve this ourselves rather than proxying to avoid routing issues.
    // Claude uses this to discover the authorization, token, and registration endpoints.
    if (url.pathname === "/.well-known/oauth-authorization-server" ||
        url.pathname === "/.well-known/oauth-authorization-server/api/auth" ||
        url.pathname === "/.well-known/openid-configuration" ||
        url.pathname === "/api/auth/.well-known/openid-configuration") {
      const base = url.origin;
      return Response.json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        jwks_uri: `${base}/api/auth/jwks`,
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
        scopes_supported: ["openid", "profile", "email", "offline_access"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        resource_indicators_supported: true,
      });
    }

    // Claude constructs OAuth paths from the issuer URL instead of using discovery.
    // Rewrite the URL in-process to the better-auth OAuth2 endpoints.
    if (url.pathname === "/authorize" || url.pathname === "/token" || url.pathname === "/register") {
      const segment = url.pathname === "/authorize" ? "authorize" : url.pathname === "/register" ? "register" : "token";
      const body = request.body ? await request.arrayBuffer() : null;
      const bodyText = body ? new TextDecoder().decode(body) : "(empty)";
      console.log(`[oauth/${segment}] request body:`, bodyText);
      const rewritten = new Request(
        `${url.origin}/api/auth/oauth2/${segment}${url.search}`,
        {
          method: request.method,
          headers: request.headers,
          body: body,
        },
      );
      const auth = createAuth(env);
      const response = await auth.handler(rewritten);
      const text = await response.clone().text();
      console.log(`[oauth/${segment}] response:`, response.status, text);

      // For token responses, normalize to strict RFC 6749 shape
      if (segment === "token" && response.ok) {
        try {
          const data = JSON.parse(text) as Record<string, unknown>;
          // Strip non-standard fields; keep Bearer and id_token (now using RS256 for OIDC validation by Claude)
          const cleaned = {
            access_token: data.access_token,
            token_type: "Bearer",
            expires_in: data.expires_in,
            ...(data.refresh_token ? { refresh_token: data.refresh_token } : {}),
            ...(data.id_token ? { id_token: data.id_token } : {}),
            scope: data.scope,
          };
          const headers = new Headers(response.headers);
          headers.set("Content-Type", "application/json");
          return new Response(JSON.stringify(cleaned), { status: response.status, headers });
        } catch {
          // Fall through to original response on parse error
        }
      }
      return response;
    }

    const ua = request.headers.get("user-agent") ?? "";
    if (ua.includes("python-httpx") || ua.includes("Claude")) {
      console.log(`[unhandled] ${request.method} ${url.pathname} ua:${ua.slice(0, 40)}`);
    }

    return handler(request, {
      context: { cloudflare: { env, ctx } } as Record<string, unknown>,
    });
  },
  async queue(batch: MessageBatch<ArchiveMessage>, env: CloudflareEnv, ctx: ExecutionContext) {
    const db = drizzle(env.DB, { schema: { memories } });
    for (const message of batch.messages) {
      try {
        const { userId, newFact, embedding, projectKey } = message.body;
        console.log(`[queue] Processing contradiction check for user ${userId}: "${newFact.slice(0, 50)}..."`);
        await archiveContradictingMemories(db, env, userId, newFact, embedding, projectKey ?? undefined);
      } catch (err) {
        console.error("[queue] Failed to process message:", err);
      }
    }
  }
} satisfies ExportedHandler<CloudflareEnv>;
