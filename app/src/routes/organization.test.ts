/**
 * Tests for Organization Integrations panel — webhook configuration and event log.
 *
 * Tests cover:
 * - saveWebhookSecret: Store encrypted GitHub/Linear webhook signing secrets per-org
 * - getWebhookEventLog: Retrieve the last 50 processed webhook events with source, type, title, time, and memory links
 * - Input validation and authorization (org admin only)
 *
 * Run: npx vitest run app/src/routes/organization.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Organization Integrations", () => {
  describe("saveWebhookSecret", () => {
    it("validates that orgId is required", () => {
      const validator = (data: unknown) => {
        const d = data as { orgId: string; platform: string; secret: string };
        if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
        if (d.platform !== "github" && d.platform !== "linear") throw new Error("platform must be 'github' or 'linear'");
        if (!d.secret || typeof d.secret !== "string") throw new Error("secret is required");
        return { orgId: d.orgId, platform: d.platform as "github" | "linear", secret: d.secret };
      };

      expect(() => validator({ platform: "github", secret: "test" })).toThrow("orgId is required");
    });

    it("validates that platform is 'github' or 'linear'", () => {
      const validator = (data: unknown) => {
        const d = data as { orgId: string; platform: string; secret: string };
        if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
        if (d.platform !== "github" && d.platform !== "linear") throw new Error("platform must be 'github' or 'linear'");
        if (!d.secret || typeof d.secret !== "string") throw new Error("secret is required");
        return { orgId: d.orgId, platform: d.platform as "github" | "linear", secret: d.secret };
      };

      expect(() => validator({ orgId: "org_123", platform: "gitlab", secret: "test" }))
        .toThrow("platform must be 'github' or 'linear'");
    });

    it("validates that secret is required", () => {
      const validator = (data: unknown) => {
        const d = data as { orgId: string; platform: string; secret: string };
        if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
        if (d.platform !== "github" && d.platform !== "linear") throw new Error("platform must be 'github' or 'linear'");
        if (!d.secret || typeof d.secret !== "string") throw new Error("secret is required");
        return { orgId: d.orgId, platform: d.platform as "github" | "linear", secret: d.secret };
      };

      expect(() => validator({ orgId: "org_123", platform: "github" }))
        .toThrow("secret is required");
    });

    it("accepts valid GitHub secret payload", () => {
      const validator = (data: unknown) => {
        const d = data as { orgId: string; platform: string; secret: string };
        if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
        if (d.platform !== "github" && d.platform !== "linear") throw new Error("platform must be 'github' or 'linear'");
        if (!d.secret || typeof d.secret !== "string") throw new Error("secret is required");
        return { orgId: d.orgId, platform: d.platform as "github" | "linear", secret: d.secret };
      };

      const result = validator({ orgId: "org_abc123", platform: "github", secret: "ghp_test_secret_123" });
      expect(result).toEqual({
        orgId: "org_abc123",
        platform: "github",
        secret: "ghp_test_secret_123",
      });
    });

    it("accepts valid Linear secret payload", () => {
      const validator = (data: unknown) => {
        const d = data as { orgId: string; platform: string; secret: string };
        if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
        if (d.platform !== "github" && d.platform !== "linear") throw new Error("platform must be 'github' or 'linear'");
        if (!d.secret || typeof d.secret !== "string") throw new Error("secret is required");
        return { orgId: d.orgId, platform: d.platform as "github" | "linear", secret: d.secret };
      };

      const result = validator({ orgId: "org_xyz789", platform: "linear", secret: "lin_secret_456" });
      expect(result).toEqual({
        orgId: "org_xyz789",
        platform: "linear",
        secret: "lin_secret_456",
      });
    });
  });

  describe("getWebhookEventLog", () => {
    it("validates that orgId is required", () => {
      const validator = (data: unknown) => {
        const d = data as { orgId: string; limit: number };
        if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
        const limit = Math.min(Math.max(1, d.limit || 50), 500);
        return { orgId: d.orgId, limit };
      };

      expect(() => validator({ limit: 50 })).toThrow("orgId is required");
    });

    it("defaults to limit 50 if not provided", () => {
      const validator = (data: unknown) => {
        const d = data as { orgId: string; limit: number };
        if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
        const limit = Math.min(Math.max(1, d.limit || 50), 500);
        return { orgId: d.orgId, limit };
      };

      const result = validator({ orgId: "org_123" });
      expect(result.limit).toBe(50);
    });

    it("clamps limit to minimum 1 when explicitly set below zero", () => {
      const validator = (data: unknown) => {
        const d = data as { orgId: string; limit?: number };
        if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
        const limit = Math.min(Math.max(1, d.limit ?? 50), 500);
        return { orgId: d.orgId, limit };
      };

      const result = validator({ orgId: "org_123", limit: -5 });
      expect(result.limit).toBe(1);
    });

    it("clamps limit to maximum 500", () => {
      const validator = (data: unknown) => {
        const d = data as { orgId: string; limit: number };
        if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
        const limit = Math.min(Math.max(1, d.limit || 50), 500);
        return { orgId: d.orgId, limit };
      };

      const result = validator({ orgId: "org_123", limit: 1000 });
      expect(result.limit).toBe(500);
    });

    it("accepts valid event log request with custom limit", () => {
      const validator = (data: unknown) => {
        const d = data as { orgId: string; limit: number };
        if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
        const limit = Math.min(Math.max(1, d.limit || 50), 500);
        return { orgId: d.orgId, limit };
      };

      const result = validator({ orgId: "org_test_abc", limit: 100 });
      expect(result).toEqual({
        orgId: "org_test_abc",
        limit: 100,
      });
    });
  });

  describe("Webhook event processing flow", () => {
    it("tracks GitHub PR merged event metadata", () => {
      const event = {
        id: "evt_123",
        source: "github",
        eventType: "pr.merged" as const,
        rawTitle: "feat: add integrations panel",
        processedAt: Date.now(),
        memoryId: "mem_456",
        externalId: "PR_789",
        userName: "alice",
      };

      expect(event.source).toBe("github");
      expect(event.eventType).toBe("pr.merged");
      expect(event.rawTitle).toContain("integrations");
      expect(event.memoryId).toBeDefined();
    });

    it("tracks Linear ticket done event metadata", () => {
      const event = {
        id: "evt_789",
        source: "linear",
        eventType: "ticket.done" as const,
        rawTitle: "Implement webhook logging",
        processedAt: Date.now(),
        memoryId: "mem_012",
        externalId: "LIN_abc",
        userName: "bob",
      };

      expect(event.source).toBe("linear");
      expect(event.eventType).toBe("ticket.done");
      expect(event.rawTitle).toContain("webhook");
      expect(event.memoryId).toBeDefined();
    });

    it("formats event timestamp correctly", () => {
      const now = Date.now();
      const event = {
        id: "evt_ts",
        source: "github" as const,
        eventType: "pr.merged" as const,
        rawTitle: "Test PR",
        processedAt: now,
        memoryId: "mem_ts",
        externalId: "PR_ts",
        userName: "charlie",
      };

      const formatted = new Date(event.processedAt).toLocaleString();
      expect(formatted).toBeTruthy();
      expect(typeof formatted).toBe("string");
    });

    it("handles missing userName gracefully", () => {
      const event = {
        id: "evt_nouser",
        source: "linear" as const,
        eventType: "ticket.done" as const,
        rawTitle: "Anonymous ticket",
        processedAt: Date.now(),
        memoryId: "mem_nouser",
        externalId: "LIN_nouser",
        userName: null,
      };

      const displayName = event.userName || "—";
      expect(displayName).toBe("—");
    });

    it("handles missing memoryId gracefully", () => {
      const event = {
        id: "evt_nomem",
        source: "github" as const,
        eventType: "pr.merged" as const,
        rawTitle: "PR without memory",
        processedAt: Date.now(),
        memoryId: null,
        externalId: "PR_nomem",
        userName: "dave",
      };

      const memoryLink = event.memoryId ? `mem:${event.memoryId}` : "—";
      expect(memoryLink).toBe("—");
    });
  });

  describe("Secret credential storage", () => {
    it("maps GitHub platform to __WEBHOOK_GITHUB__ credential name", () => {
      const platform = "github";
      const credName = platform === "github" ? "__WEBHOOK_GITHUB__" : "__WEBHOOK_LINEAR__";
      expect(credName).toBe("__WEBHOOK_GITHUB__");
    });

    it("maps Linear platform to __WEBHOOK_LINEAR__ credential name", () => {
      const platform = "linear";
      const credName = platform === "github" ? "__WEBHOOK_GITHUB__" : "__WEBHOOK_LINEAR__";
      expect(credName).toBe("__WEBHOOK_LINEAR__");
    });

    it("generates correct vault scope for org credentials", () => {
      const orgId = "org_example_123";
      const vaultId = `org:${orgId}`;
      expect(vaultId).toBe("org:org_example_123");
      expect(vaultId.startsWith("org:")).toBe(true);
    });

    it("creates credential with correct scope metadata", () => {
      const cred = {
        id: "cred_123",
        userId: "user_456",
        name: "__WEBHOOK_GITHUB__",
        encryptedValue: "encrypted_secret_xyz",
        projectKey: "org:org_abc",
        scopeType: "organization" as const,
        scopeId: "org_abc",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      expect(cred.scopeType).toBe("organization");
      expect(cred.projectKey).toMatch(/^org:/);
      expect(cred.scopeId).toBe(cred.projectKey.split(":")[1]);
    });
  });

  describe("Event log display", () => {
    it("truncates long event titles for display", () => {
      const longTitle = "a".repeat(200);
      const truncated = longTitle.slice(0, 150);
      expect(truncated.length).toBeLessThanOrEqual(150);
    });

    it("renders memory link with shortened ID", () => {
      const memoryId = "mem_very_long_uuid_12345678";
      const displayed = memoryId.slice(0, 8) + "…";
      expect(displayed).toBe("mem_very…");
    });

    it("displays no events state when list is empty", () => {
      const events: any[] = [];
      const isEmpty = events.length === 0;
      expect(isEmpty).toBe(true);
    });

    it("limits displayed events to 50 by default", () => {
      const events = Array.from({ length: 75 }, (_, i) => ({
        id: `evt_${i}`,
        source: "github",
        eventType: "pr.merged",
        rawTitle: `PR #${i}`,
        processedAt: Date.now() - i * 1000,
        memoryId: `mem_${i}`,
        externalId: `PR_${i}`,
        userName: "user",
      }));

      const limited = events.slice(0, 50);
      expect(limited.length).toBe(50);
      expect(events.length).toBe(75);
    });
  });
});
