export type CloudflareEnv = {
  DB: D1Database;
  VECTOR_INDEX: VectorizeIndex;
  AI: Ai;
  ASSETS: Fetcher;
};

declare module "@tanstack/router-core" {
  interface Register {
    server: {
      requestContext: {
        cloudflare: {
          env: CloudflareEnv;
          ctx: ExecutionContext;
        };
      };
    };
  }
}
