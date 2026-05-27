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

    // Claude constructs OAuth paths from the issuer URL instead of using discovery.
    // Proxy these directly to the better-auth OAuth2 endpoints (no redirect — POST bodies survive).
    if (url.pathname === "/authorize" || url.pathname === "/token") {
      const segment = url.pathname === "/authorize" ? "authorize" : "token";
      const target = new URL(`/api/auth/oauth2/${segment}`, url.origin);
      target.search = url.search;
      return fetch(new Request(target.toString(), request));
    }

    return handler(request, {
      context: { cloudflare: { env, ctx } } as Record<string, unknown>,
    });
  },
} satisfies ExportedHandler<CloudflareEnv>;
