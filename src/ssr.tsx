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
      if (url.pathname === "/api/auth/oauth2/token") {
        const text = await response.clone().text();
        console.log("[api/auth/oauth2/token] response:", response.status, text);
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
    // Maps to the OIDC discovery doc that better-auth exposes.
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      const rewritten = new Request(
        `${url.origin}/api/auth/.well-known/openid-configuration`,
        { method: "GET", headers: request.headers },
      );
      const auth = createAuth(env);
      return auth.handler(rewritten);
    }

    // Claude constructs OAuth paths from the issuer URL instead of using discovery.
    // Rewrite the URL in-process to the better-auth OAuth2 endpoints.
    if (url.pathname === "/authorize" || url.pathname === "/token") {
      const segment = url.pathname === "/authorize" ? "authorize" : "token";
      const body = request.body ? await request.arrayBuffer() : null;
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
      // Log token responses to debug Claude rejections
      if (segment === "token") {
        const text = await response.clone().text();
        console.log("[oauth/token] response:", response.status, text);
      }
      return response;
    }

    return handler(request, {
      context: { cloudflare: { env, ctx } } as Record<string, unknown>,
    });
  },
} satisfies ExportedHandler<CloudflareEnv>;
