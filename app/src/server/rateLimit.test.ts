/**
 * Tests for the IP/token rate-limiting layer.
 *
 * Coverage:
 *   1. isStaticPath — static extensions, static prefixes, dynamic paths
 *   2. tooManyRequests — 429 status, Retry-After header, JSON body
 *   3. checkIpRateLimit (D1 fallback) — allowed under limit, blocked at limit, window resets
 *   4. checkIpRateLimit (native RATE_LIMITER) — passes through success/failure
 *   5. checkTokenRateLimit (D1 fallback) — allowed under limit, blocked at limit
 *   6. checkTokenRateLimit (native RATE_LIMITER) — passes through success/failure
 *   7. pruneOldWindows — schedules D1 delete without blocking
 *
 * Run: npx vitest run src/server/rateLimit.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isStaticPath,
  tooManyRequests,
  checkIpRateLimit,
  checkTokenRateLimit,
  pruneOldWindows,
  RateLimitResult,
} from "./rateLimit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeD1(firstCount: number, subsequentCount?: number): D1Database {
  let calls = 0;
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockImplementation(async () => {
          const count = calls === 0 ? firstCount : (subsequentCount ?? firstCount);
          calls++;
          return { count };
        }),
        run: vi.fn().mockResolvedValue({}),
      }),
      run: vi.fn().mockResolvedValue({}),
    }),
    exec: vi.fn(),
    batch: vi.fn(),
    dump: vi.fn(),
  } as unknown as D1Database;
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function makeRequest(ip: string): Request {
  return new Request("https://example.com/api/data", {
    headers: { "cf-connecting-ip": ip },
  });
}

type MockEnv = {
  DB: D1Database;
  RATE_LIMITER?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> };
  [k: string]: unknown;
};

// ---------------------------------------------------------------------------
// 1. isStaticPath
// ---------------------------------------------------------------------------

describe("isStaticPath", () => {
  it.each([
    "/assets/app.js",
    "/_build/chunk.css",
    "/favicon.ico",
    "/__vite/hmr",
    "/logo.png",
    "/font.woff2",
    "/bundle.js",
    "/styles.css",
    "/data.json",
    "/image.webp",
  ])("returns true for static path: %s", (path) => {
    expect(isStaticPath(path)).toBe(true);
  });

  it.each([
    "/api/mcp",
    "/api/auth/login",
    "/api/export",
    "/",
    "/connect",
    "/dashboard",
    "/register",
    "/authorize",
  ])("returns false for dynamic path: %s", (path) => {
    expect(isStaticPath(path)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. tooManyRequests
// ---------------------------------------------------------------------------

describe("tooManyRequests", () => {
  it("returns a 429 response", () => {
    const res = tooManyRequests(42);
    expect(res.status).toBe(429);
  });

  it("sets Retry-After header to the retryAfter value", () => {
    const res = tooManyRequests(30);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("sets X-RateLimit-Reset to a future epoch second", () => {
    const before = Math.floor(Date.now() / 1000);
    const res = tooManyRequests(60);
    const reset = Number(res.headers.get("X-RateLimit-Reset"));
    expect(reset).toBeGreaterThanOrEqual(before + 59);
    expect(reset).toBeLessThanOrEqual(before + 61);
  });

  it("returns JSON body with error and retryAfter fields", async () => {
    const res = tooManyRequests(15);
    const body = await res.json() as { error: string; retryAfter: number };
    expect(body.error).toBe("Too Many Requests");
    expect(body.retryAfter).toBe(15);
  });

  it("sets Content-Type to application/json", () => {
    const res = tooManyRequests(1);
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// 3. checkIpRateLimit — D1 fallback
// ---------------------------------------------------------------------------

describe("checkIpRateLimit (D1 fallback)", () => {
  it("returns limited:false when count is under the cap (60)", async () => {
    const db = makeD1(1);
    const env: MockEnv = { DB: db };
    const ctx = makeCtx();
    const req = makeRequest("1.2.3.4");

    const result = await checkIpRateLimit(req, env as any, ctx);

    expect(result.limited).toBe(false);
  });

  it("returns limited:false when count is exactly at the cap (60)", async () => {
    const db = makeD1(60);
    const env: MockEnv = { DB: db };
    const ctx = makeCtx();
    const req = makeRequest("1.2.3.4");

    const result = await checkIpRateLimit(req, env as any, ctx);

    expect(result.limited).toBe(false);
  });

  it("returns limited:true when count exceeds the cap (61)", async () => {
    const db = makeD1(61);
    const env: MockEnv = { DB: db };
    const ctx = makeCtx();
    const req = makeRequest("1.2.3.4");

    const result = await checkIpRateLimit(req, env as any, ctx);

    expect(result.limited).toBe(true);
    if (result.limited) {
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(60);
    }
  });

  it("uses 'unknown' as the key when cf-connecting-ip is absent", async () => {
    const db = makeD1(1);
    const env: MockEnv = { DB: db };
    const ctx = makeCtx();
    const req = new Request("https://example.com/api/data");

    const result = await checkIpRateLimit(req, env as any, ctx);

    expect(result.limited).toBe(false);
    // Verify the prepare call was made (D1 was used)
    expect(db.prepare).toHaveBeenCalled();
  });

  it("schedules window pruning via ctx.waitUntil", async () => {
    const db = makeD1(1);
    const env: MockEnv = { DB: db };
    const ctx = makeCtx();
    const req = makeRequest("5.6.7.8");

    await checkIpRateLimit(req, env as any, ctx);

    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 4. checkIpRateLimit — native RATE_LIMITER
// ---------------------------------------------------------------------------

describe("checkIpRateLimit (native RATE_LIMITER)", () => {
  it("returns limited:false when native limiter succeeds", async () => {
    const env: MockEnv = {
      DB: makeD1(0),
      RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    };
    const ctx = makeCtx();
    const req = makeRequest("9.9.9.9");

    const result = await checkIpRateLimit(req, env as any, ctx);

    expect(result.limited).toBe(false);
  });

  it("returns limited:true with 60s retryAfter when native limiter fails", async () => {
    const env: MockEnv = {
      DB: makeD1(0),
      RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) },
    };
    const ctx = makeCtx();
    const req = makeRequest("10.10.10.10");

    const result = await checkIpRateLimit(req, env as any, ctx);

    expect(result.limited).toBe(true);
    if (result.limited) expect(result.retryAfter).toBe(60);
  });

  it("does not call D1 when the native limiter is present", async () => {
    const db = makeD1(0);
    const env: MockEnv = {
      DB: db,
      RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    };
    const ctx = makeCtx();
    const req = makeRequest("11.11.11.11");

    await checkIpRateLimit(req, env as any, ctx);

    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("keys the native limiter by ip: prefix", async () => {
    const limitFn = vi.fn().mockResolvedValue({ success: true });
    const env: MockEnv = {
      DB: makeD1(0),
      RATE_LIMITER: { limit: limitFn },
    };
    const ctx = makeCtx();
    const req = makeRequest("12.13.14.15");

    await checkIpRateLimit(req, env as any, ctx);

    expect(limitFn).toHaveBeenCalledWith({ key: "ip:12.13.14.15" });
  });
});

// ---------------------------------------------------------------------------
// 5. checkTokenRateLimit — D1 fallback
// ---------------------------------------------------------------------------

describe("checkTokenRateLimit (D1 fallback)", () => {
  it("returns limited:false when count is under the cap (300)", async () => {
    const db = makeD1(1);
    const env: MockEnv = { DB: db };
    const ctx = makeCtx();

    const result = await checkTokenRateLimit("secret-token", env as any, ctx);

    expect(result.limited).toBe(false);
  });

  it("returns limited:false when count is exactly at the cap (300)", async () => {
    const db = makeD1(300);
    const env: MockEnv = { DB: db };
    const ctx = makeCtx();

    const result = await checkTokenRateLimit("secret-token", env as any, ctx);

    expect(result.limited).toBe(false);
  });

  it("returns limited:true when count exceeds the cap (301)", async () => {
    const db = makeD1(301);
    const env: MockEnv = { DB: db };
    const ctx = makeCtx();

    const result = await checkTokenRateLimit("secret-token", env as any, ctx);

    expect(result.limited).toBe(true);
    if (result.limited) {
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(60);
    }
  });

  it("hashes the token so the raw credential never appears in the D1 key", async () => {
    const db = makeD1(1);
    const env: MockEnv = { DB: db };
    const ctx = makeCtx();

    await checkTokenRateLimit("my-raw-token", env as any, ctx);

    // prepare() is called twice via the same mock: once for prune (bind[0]), once for the
    // rate-limit UPSERT (bind[1]). The key is the first arg of the second bind call.
    const bindMock = (db.prepare as ReturnType<typeof vi.fn>).mock.results[0].value.bind;
    const keyArg: string = bindMock.mock.calls[1][0];
    expect(keyArg).toMatch(/^token:[a-f0-9]{32}$/);
    expect(keyArg).not.toContain("my-raw-token");
  });

  it("produces the same hash for the same token (deterministic)", async () => {
    const db1 = makeD1(1);
    const db2 = makeD1(1);
    const env1: MockEnv = { DB: db1 };
    const env2: MockEnv = { DB: db2 };
    const ctx = makeCtx();

    await checkTokenRateLimit("same-token", env1 as any, ctx);
    await checkTokenRateLimit("same-token", env2 as any, ctx);

    const key1 = (db1.prepare as ReturnType<typeof vi.fn>).mock.results[0].value.bind.mock.calls[1][0];
    const key2 = (db2.prepare as ReturnType<typeof vi.fn>).mock.results[0].value.bind.mock.calls[1][0];
    expect(key1).toBe(key2);
  });

  it("produces different hashes for different tokens", async () => {
    const db1 = makeD1(1);
    const db2 = makeD1(1);
    const env1: MockEnv = { DB: db1 };
    const env2: MockEnv = { DB: db2 };
    const ctx = makeCtx();

    await checkTokenRateLimit("token-A", env1 as any, ctx);
    await checkTokenRateLimit("token-B", env2 as any, ctx);

    const key1 = (db1.prepare as ReturnType<typeof vi.fn>).mock.results[0].value.bind.mock.calls[1][0];
    const key2 = (db2.prepare as ReturnType<typeof vi.fn>).mock.results[0].value.bind.mock.calls[1][0];
    expect(key1).not.toBe(key2);
  });

  it("schedules window pruning via ctx.waitUntil", async () => {
    const db = makeD1(1);
    const env: MockEnv = { DB: db };
    const ctx = makeCtx();

    await checkTokenRateLimit("tok", env as any, ctx);

    expect(ctx.waitUntil).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 6. checkTokenRateLimit — native RATE_LIMITER
// ---------------------------------------------------------------------------

describe("checkTokenRateLimit (native RATE_LIMITER)", () => {
  it("returns limited:false when native limiter succeeds", async () => {
    const env: MockEnv = {
      DB: makeD1(0),
      RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    };
    const ctx = makeCtx();

    const result = await checkTokenRateLimit("bearer-token", env as any, ctx);

    expect(result.limited).toBe(false);
  });

  it("returns limited:true with 60s retryAfter when native limiter fails", async () => {
    const env: MockEnv = {
      DB: makeD1(0),
      RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) },
    };
    const ctx = makeCtx();

    const result = await checkTokenRateLimit("bearer-token", env as any, ctx);

    expect(result.limited).toBe(true);
    if (result.limited) expect(result.retryAfter).toBe(60);
  });

  it("does not call D1 when the native limiter is present", async () => {
    const db = makeD1(0);
    const env: MockEnv = {
      DB: db,
      RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
    };
    const ctx = makeCtx();

    await checkTokenRateLimit("bearer-token", env as any, ctx);

    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("keys the native limiter with a hashed token: prefix", async () => {
    const limitFn = vi.fn().mockResolvedValue({ success: true });
    const env: MockEnv = {
      DB: makeD1(0),
      RATE_LIMITER: { limit: limitFn },
    };
    const ctx = makeCtx();

    await checkTokenRateLimit("some-bearer", env as any, ctx);

    const { key } = limitFn.mock.calls[0][0];
    expect(key).toMatch(/^token:[a-f0-9]{32}$/);
    expect(key).not.toContain("some-bearer");
  });
});

// ---------------------------------------------------------------------------
// 7. pruneOldWindows
// ---------------------------------------------------------------------------

describe("pruneOldWindows", () => {
  it("calls ctx.waitUntil with a D1 delete promise", () => {
    const runMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });
    const db = { prepare: prepareMock } as unknown as D1Database;
    const ctx = makeCtx();

    pruneOldWindows(ctx, db);

    expect(ctx.waitUntil).toHaveBeenCalledOnce();
    expect(prepareMock).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM rate_limit_counters"),
    );
  });

  it("uses a cutoff 120 seconds in the past", () => {
    const bindMock = vi.fn().mockReturnValue({ run: vi.fn().mockResolvedValue({}) });
    const db = {
      prepare: vi.fn().mockReturnValue({ bind: bindMock }),
    } as unknown as D1Database;
    const ctx = makeCtx();

    const before = Math.floor(Date.now() / 1000) - 120;
    pruneOldWindows(ctx, db);
    const after = Math.floor(Date.now() / 1000) - 120;

    const cutoff: number = bindMock.mock.calls[0][0];
    expect(cutoff).toBeGreaterThanOrEqual(before);
    expect(cutoff).toBeLessThanOrEqual(after);
  });
});
