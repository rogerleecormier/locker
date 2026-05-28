import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { handleMcpRequest } from "./routes/-api.mcp";
import { createAuth } from "./server/auth";
import type { CloudflareEnv } from "./types/cloudflare";

const handler = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);

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
        id_token_signing_alg_values_supported: ["EdDSA"],
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
} satisfies ExportedHandler<CloudflareEnv>;
