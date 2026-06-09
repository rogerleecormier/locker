export type ArchiveMessage = {
  userId: string;
  newFact: string;
  embedding: number[];
  projectKey?: string | null;
};

export type SlackSummaryMessage = {
  userId: string;
  slackUserId: string;
  channelId: string;
  threadTs: string;
  messages: Array<{ user?: string; text?: string; ts: string; thread_ts?: string }>;
  triggerEmoji?: string;
};

export type CloudflareEnv = {
  DB: D1Database;
  DB_REPLICA?: D1Database;
  SESSION_KV: KVNamespace;
  VECTOR_INDEX: VectorizeIndex;
  AI: Ai;
  ASSETS: Fetcher;
  ENCRYPTION_KEY: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  EXPORT_SIGNING_KEY: string;
  ADMIN_USER_ID: string;
  CLAUDE_CLIENT_ID: string;
  CLAUDE_CLIENT_SECRET: string;
  ARCHIVE_QUEUE: Queue<ArchiveMessage>;
  SLACK_SUMMARIZER_QUEUE?: Queue<SlackSummaryMessage>;
  SE_EMAIL?: any;
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_CHECKOUT_URL?: string;
  GITHUB_WEBHOOK_SECRET?: string;
  LINEAR_WEBHOOK_SECRET?: string;
  SLACK_WEBHOOK_SECRET?: string;
  DEMO_EMAIL?: string;
  DEMO_PASSWORD?: string;
  OWNER_EMAIL?: string;
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
