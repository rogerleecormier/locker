export type ArchiveMessage = {
  userId: string;
  newFact: string;
  embedding: number[];
  projectKey?: string | null;
};

export type CloudflareEnv = {
  DB: D1Database;
  VECTOR_INDEX: VectorizeIndex;
  AI: Ai;
  ASSETS: Fetcher;
  ENCRYPTION_KEY: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  ADMIN_USER_ID: string;
  CLAUDE_CLIENT_ID: string;
  CLAUDE_CLIENT_SECRET: string;
  ARCHIVE_QUEUE: Queue<ArchiveMessage>;
  SE_EMAIL?: any;
  STRIPE_SECRET_KEY?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  RATE_LIMITER?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
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
