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
      return auth.handler(request);
    }

    // Claude constructs /authorize from the issuer URL instead of using discovery.
    // Redirect to the actual better-auth OAuth2 authorization endpoint.
    if (url.pathname === "/authorize") {
      const target = new URL("/api/auth/oauth2/authorize", url.origin);
      target.search = url.search;
      return Response.redirect(target.toString(), 302);
    }

    return handler(request, {
      context: { cloudflare: { env, ctx } } as Record<string, unknown>,
    });
  },
} satisfies ExportedHandler<CloudflareEnv>;
