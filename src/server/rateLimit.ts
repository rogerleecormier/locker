import type { CloudflareEnv } from "../types/cloudflare";

// Static asset path patterns — excluded from rate limiting
const STATIC_EXTENSIONS = /\.(js|jsx|ts|tsx|css|map|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|webp|avif|json|txt|xml|pdf)$/i;
const STATIC_PREFIXES = ["/assets/", "/_build/", "/favicon", "/__vite"];

export function isStaticPath(pathname: string): boolean {
  if (STATIC_EXTENSIONS.test(pathname)) return true;
  for (const prefix of STATIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  return false;
}

export type RateLimitResult =
  | { limited: false }
  | { limited: true; retryAfter: number };

// Cloudflare native rate limiter (env.RATE_LIMITER).
// The binding is configured with a fixed window; we key it as "<type>:<identifier>".
async function checkNative(
  limiter: NonNullable<CloudflareEnv["RATE_LIMITER"]>,
  key: string,
): Promise<{ success: boolean }> {
  return limiter.limit({ key });
}

// D1 fixed-window fallback.
// Uses a single UPSERT so it works safely under concurrent requests.
async function checkD1(
  db: D1Database,
  key: string,
  windowSec: number,
  maxRequests: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const window = now - (now % windowSec);
  const windowEnd = window + windowSec;

  // Atomically increment and read the new count in one round-trip.
  const result = await db
    .prepare(
      `INSERT INTO rate_limit_counters (key, window, count)
       VALUES (?1, ?2, 1)
       ON CONFLICT (key, window) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, window)
    .first<{ count: number }>();

  const count = result?.count ?? 1;

  if (count > maxRequests) {
    return { limited: true, retryAfter: windowEnd - now };
  }
  return { limited: false };
}

// Prune stale windows in the background (keeps the table small).
export function pruneOldWindows(ctx: ExecutionContext, db: D1Database): void {
  const cutoff = Math.floor(Date.now() / 1000) - 120;
  ctx.waitUntil(
    db.prepare("DELETE FROM rate_limit_counters WHERE window < ?1").bind(cutoff).run(),
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// 60 req/min per IP for unauthenticated endpoints.
export async function checkIpRateLimit(
  request: Request,
  env: CloudflareEnv,
  ctx: ExecutionContext,
): Promise<RateLimitResult> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const key = `ip:${ip}`;
  const MAX = 60;
  const WINDOW = 60;

  if (env.RATE_LIMITER) {
    const { success } = await checkNative(env.RATE_LIMITER, key);
    if (!success) {
      // Native limiter has no reset info; use a conservative 60 s.
      return { limited: true, retryAfter: WINDOW };
    }
    return { limited: false };
  }

  pruneOldWindows(ctx, env.DB);
  return checkD1(env.DB, key, WINDOW, MAX);
}

// 300 req/min per token for MCP endpoints.
export async function checkTokenRateLimit(
  token: string,
  env: CloudflareEnv,
  ctx: ExecutionContext,
): Promise<RateLimitResult> {
  // Hash the token so raw credentials never appear in the table.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);

  const key = `token:${hash}`;
  const MAX = 300;
  const WINDOW = 60;

  if (env.RATE_LIMITER) {
    const { success } = await checkNative(env.RATE_LIMITER, key);
    if (!success) {
      return { limited: true, retryAfter: WINDOW };
    }
    return { limited: false };
  }

  pruneOldWindows(ctx, env.DB);
  return checkD1(env.DB, key, WINDOW, MAX);
}

export function tooManyRequests(retryAfter: number): Response {
  return new Response(
    JSON.stringify({ error: "Too Many Requests", retryAfter }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + retryAfter),
      },
    },
  );
}
