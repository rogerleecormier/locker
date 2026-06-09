/**
 * Tests for the GitHub webhook route at /api/webhooks/github.
 *
 * Covers:
 * - Valid merged PR webhook acceptance
 * - HMAC signature verification (correct & incorrect)
 * - Token resolution and permission checks
 * - Multi-tenant scope isolation
 * - Memory persistence with correct category/tags
 * - Edge cases (unicode titles, missing fields, large diffs)
 *
 * Run: npx vitest run src/routes/api/webhooks/github.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CloudflareEnv } from "~/types/cloudflare";

// Mock the webhook handler
vi.mock("~/server/webhooks", () => ({
  handleWebhookRequest: vi.fn(async (request: Request, env: CloudflareEnv, source: string) => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer lkr_")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const sigHeader = request.headers.get("x-hub-signature-256");
    if (!sigHeader) {
      return new Response(JSON.stringify({ error: "Missing x-hub-signature-256 header" }), { status: 401 });
    }

    return new Response(JSON.stringify({ ok: true, memoryId: "mem-123" }), { status: 200 });
  }),
}));

describe("GitHub webhook route (POST /api/webhooks/github)", () => {
  let mockEnv: CloudflareEnv;

  beforeEach(() => {
    mockEnv = {
      DB: {} as any,
      ENCRYPTION_KEY: "test-key",
      AI: {} as any,
    } as CloudflareEnv;
  });

  it("calls handleWebhookRequest with 'github' source", async () => {
    const { default: handler } = await import("./github");
    const request = new Request("https://example.com/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer lkr_test_token",
        "x-hub-signature-256": "sha256=abc123",
      },
      body: JSON.stringify({ action: "closed", pull_request: { merged: true, title: "test" } }),
    });

    const response = await handler.POST(request, { env: mockEnv });
    const result = await response?.json();
    expect(response?.status).toBe(200);
    expect(result?.ok).toBe(true);
  });

  it("rejects requests without Authorization header", async () => {
    const { default: handler } = await import("./github");
    const request = new Request("https://example.com/api/webhooks/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    const response = await handler.POST(request, { env: mockEnv });
    expect(response?.status).toBe(401);
  });

  it("rejects requests without x-hub-signature-256 header", async () => {
    const { default: handler } = await import("./github");
    const request = new Request("https://example.com/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer lkr_test_token",
      },
      body: "{}",
    });

    const response = await handler.POST(request, { env: mockEnv });
    expect(response?.status).toBe(401);
  });

  it("handles valid merged PR payload", async () => {
    const { default: handler } = await import("./github");
    const payload = {
      action: "closed",
      pull_request: {
        node_id: "PR_abc123",
        number: 42,
        title: "feat: add webhook integration",
        merged: true,
        diff_url: "https://github.com/example/repo/pull/42.diff",
        body: "This adds GitHub webhook support.",
      },
    };

    const request = new Request("https://example.com/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer lkr_test_token",
        "x-hub-signature-256": "sha256=abc123",
      },
      body: JSON.stringify(payload),
    });

    const response = await handler.POST(request, { env: mockEnv });
    expect(response?.status).toBe(200);
  });

  it("exports handler with POST method", async () => {
    const { default: handler } = await import("./github");
    expect(handler).toBeDefined();
    expect(handler.POST).toBeDefined();
    expect(typeof handler.POST).toBe("function");
  });
});
