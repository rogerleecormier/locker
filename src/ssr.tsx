import {
  createStartHandler,
  defaultStreamHandler,
} from "@tanstack/react-start/server";
import { handleMcpRequest } from "./routes/-api.mcp";
import type { CloudflareEnv } from "./types/cloudflare";

const handler = createStartHandler(defaultStreamHandler);

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/api/mcp") {
      return handleMcpRequest(request, env);
    }

    return handler(request, {
      context: { cloudflare: { env, ctx } } as Record<string, unknown>,
    });
  },
} satisfies ExportedHandler<CloudflareEnv>;
