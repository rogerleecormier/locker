export type CloudflareEnv = {
  DB: D1Database;
  VECTOR_INDEX: VectorizeIndex;
  AI: Ai;
  ASSETS: Fetcher;
  ENCRYPTION_KEY: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ADMIN_USER_ID: string;
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
