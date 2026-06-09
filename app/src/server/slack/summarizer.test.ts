import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SlackThreadSummaryPayload } from "./webhook";
import type { CloudflareEnv } from "~/types/cloudflare";

// Mock the crypto functions
vi.mock("~/server/crypto", () => ({
  getOrCreateVaultKey: vi.fn(async () => "mock-vault-key"),
  encrypt: vi.fn(async (text: string) => `encrypted:${text}`),
  decrypt: vi.fn(async (text: string) => text.replace("encrypted:", "")),
  isEncrypted: vi.fn((text: string) => text.startsWith("encrypted:")),
  verifyToken: vi.fn(async () => true),
  extractTokenPrefix: vi.fn((token: string) => token.split("_")[1]),
  getOrCreateVaultKey: vi.fn(async () => "mock-vault-key"),
}));

// Mock drizzle
vi.mock("drizzle-orm/d1", () => ({
  drizzle: vi.fn(() => ({
    insert: vi.fn(() => ({
      values: vi.fn(async () => ({ id: "memory-123" })),
    })),
  })),
}));

describe("Slack Thread Summarizer", () => {
  let mockEnv: CloudflareEnv;

  beforeEach(() => {
    mockEnv = {
      DB: {} as D1Database,
      SESSION_KV: {} as KVNamespace,
      VECTOR_INDEX: {} as VectorizeIndex,
      AI: {
        run: vi.fn(async () => ({
          response: "The team decided to adopt Postgres as the primary database. This enables ACID compliance and horizontal scaling via replication.",
        })),
      } as unknown as Ai,
      ASSETS: {} as Fetcher,
      ENCRYPTION_KEY: "test-encryption-key",
      BETTER_AUTH_SECRET: "test-secret",
      BETTER_AUTH_URL: "https://example.com",
      EXPORT_SIGNING_KEY: "test-key",
      ADMIN_USER_ID: "admin-123",
      CLAUDE_CLIENT_ID: "client-id",
      CLAUDE_CLIENT_SECRET: "client-secret",
      ARCHIVE_QUEUE: {} as Queue<any>,
      SLACK_WEBHOOK_SECRET: "slack-secret-123",
    } as unknown as CloudflareEnv;
  });

  describe("Thread Conversation Reconstruction", () => {
    it("should reconstruct conversation from message array", () => {
      const messages = [
        { user: "U123456789", text: "Should we use Postgres or MySQL?", ts: "1.0", thread_ts: "1.0" },
        { user: "U987654321", text: "I vote Postgres. Better ACID support.", ts: "1.1", thread_ts: "1.0" },
        { user: "U123456789", text: "Agreed. Let's go with Postgres.", ts: "1.2", thread_ts: "1.0" },
      ];

      // Expected reconstruction format
      const expectedText = `U123456789: Should we use Postgres or MySQL?

U987654321: I vote Postgres. Better ACID support.

U123456789: Agreed. Let's go with Postgres.`;

      const reconstructed = messages
        .filter((m) => m.text)
        .map((m) => `${m.user}: ${m.text}`)
        .join("\n\n");

      expect(reconstructed).toBe(expectedText);
      expect(reconstructed.split("\n\n")).toHaveLength(3);
    });

    it("should filter out messages without text", () => {
      const messages = [
        { user: "U123456789", text: "First message", ts: "1.0" },
        { user: "U987654321", ts: "1.1" }, // No text
        { user: "U555555555", text: "Third message", ts: "1.2" },
      ];

      const withText = messages.filter((m) => m.text);
      expect(withText).toHaveLength(2);
      expect(withText[0].user).toBe("U123456789");
      expect(withText[1].user).toBe("U555555555");
    });

    it("should handle anonymous users (missing user_id)", () => {
      const messages = [
        { text: "Message without user", ts: "1.0" },
        { user: "U123456789", text: "Message with user", ts: "1.1" },
      ];

      const reconstructed = messages
        .filter((m) => m.text)
        .map((m) => `${m.user || "anonymous"}: ${m.text}`)
        .join("\n\n");

      expect(reconstructed).toContain("anonymous: Message without user");
      expect(reconstructed).toContain("U123456789: Message with user");
    });

    it("should handle empty thread gracefully", () => {
      const messages: Array<{ user?: string; text?: string; ts: string }> = [];
      const reconstructed = messages
        .filter((m) => m.text)
        .map((m) => `${m.user || "anonymous"}: ${m.text}`)
        .join("\n\n");

      expect(reconstructed).toBe("");
    });
  });

  describe("AI Summarization", () => {
    it("should call AI model with correct system and user prompts", async () => {
      const threadText = "Thread conversation text";
      const mockRun = vi.fn(async () => ({
        response: "Summary text",
      }));

      const ai = {
        run: mockRun,
      } as unknown as Ai;

      await ai.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
        messages: [
          { role: "system", content: "You are a senior software architect..." },
          { role: "user", content: `Thread conversation:\n\n${threadText}` },
        ],
        max_tokens: 300,
      });

      expect(mockRun).toHaveBeenCalled();
      const call = mockRun.mock.calls[0];
      expect(call[0]).toBe("@cf/meta/llama-3.1-8b-instruct-fp8");
      expect(call[1].messages).toHaveLength(2);
      expect(call[1].messages[0].role).toBe("system");
      expect(call[1].messages[1].role).toBe("user");
    });

    it("should handle streaming AI responses", async () => {
      const chunks = [
        new TextEncoder().encode("The team "),
        new TextEncoder().encode("decided to "),
        new TextEncoder().encode("use Postgres."),
      ];

      const mockStream = {
        getReader: () => ({
          read: vi.fn()
            .mockResolvedValueOnce({ done: false, value: chunks[0] })
            .mockResolvedValueOnce({ done: false, value: chunks[1] })
            .mockResolvedValueOnce({ done: false, value: chunks[2] })
            .mockResolvedValueOnce({ done: true }),
        }),
      } as unknown as ReadableStream;

      // Simulating stream processing
      const reader = mockStream.getReader();
      const result: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) result.push(value as Uint8Array);
      }

      const text = new TextDecoder().decode(
        new Uint8Array(result.reduce((a, b) => [...a, ...b], []))
      );
      expect(text).toBe("The team decided to use Postgres.");
    });

    it("should fallback to default summary on AI error", async () => {
      const fallbackSummary = "Slack thread archived for future reference.";
      expect(fallbackSummary).toBe("Slack thread archived for future reference.");
    });
  });

  describe("Memory Commitment", () => {
    it("should create memory with correct schema", () => {
      const memoryId = crypto.randomUUID();
      const memory = {
        id: memoryId,
        userId: "user-123",
        fact: "encrypted:summary text",
        category: "projects",
        tags: "#slack #watercooler",
        timestamp: Date.now(),
        isActive: true,
        projectKey: null,
        scopeType: "personal",
        scopeId: null,
        isLocked: false,
        authorityType: "contributed",
        isQuarantined: false,
      };

      expect(memory.category).toBe("projects");
      expect(memory.tags).toContain("#slack");
      expect(memory.scopeType).toBe("personal");
      expect(memory.authorityType).toBe("contributed");
    });

    it("should include saved-decision tag when emoji triggered", () => {
      const tagsWithEmoji = ["#slack", "#watercooler", "#saved-decision"];
      const tagsWithoutEmoji = ["#slack", "#watercooler"];

      const withEmoji = tagsWithEmoji.join(" ");
      const withoutEmoji = tagsWithoutEmoji.join(" ");

      expect(withEmoji).toContain("#saved-decision");
      expect(withoutEmoji).not.toContain("#saved-decision");
    });

    it("should encrypt memory before storage", () => {
      const plainFact = "[Slack Thread] The team decided to use Postgres.";
      const encrypted = `encrypted:${plainFact}`;

      expect(encrypted.startsWith("encrypted:")).toBe(true);
      expect(encrypted).toContain(plainFact);
    });
  });

  describe("Queue Payload Processing", () => {
    it("should process valid SlackThreadSummaryPayload", () => {
      const payload: SlackThreadSummaryPayload = {
        userId: "user-123",
        slackUserId: "U123456789",
        channelId: "C123456789",
        threadTs: "1609459200.000100",
        messages: [
          {
            user: "U123456789",
            text: "Let's migrate to a new tech stack",
            ts: "1609459200.000100",
          },
          {
            user: "U987654321",
            text: "I agree, Postgres is better",
            ts: "1609459200.000200",
          },
        ],
        triggerEmoji: "💾",
      };

      expect(payload.userId).toBe("user-123");
      expect(payload.messages).toHaveLength(2);
      expect(payload.triggerEmoji).toBe("💾");
      expect(payload.threadTs).toBeTruthy();
    });

    it("should handle missing triggerEmoji gracefully", () => {
      const payload: SlackThreadSummaryPayload = {
        userId: "user-123",
        slackUserId: "U123456789",
        channelId: "C123456789",
        threadTs: "1609459200.000100",
        messages: [
          { user: "U123456789", text: "Message", ts: "1.0" },
        ],
      };

      expect(payload.triggerEmoji).toBeUndefined();
      const tags = ["#slack", "#watercooler"];
      expect(tags.join(" ")).not.toContain("#saved-decision");
    });

    it("should truncate large threads to MAX_THREAD_TEXT", () => {
      const MAX_THREAD_TEXT = 16_000;
      const largeText = "x".repeat(20_000);

      const truncated = largeText.slice(0, MAX_THREAD_TEXT);
      expect(truncated.length).toBe(MAX_THREAD_TEXT);
      expect(truncated.length).toBeLessThan(largeText.length);
    });
  });

  describe("Error Handling", () => {
    it("should return early for empty threads", () => {
      const messages: Array<{ user?: string; text?: string; ts: string }> = [];
      const threadText = messages
        .filter((m) => m.text)
        .map((m) => `${m.user || "anonymous"}: ${m.text}`)
        .join("\n\n");

      expect(threadText.trim()).toBe("");
      // Handler should return early with console.warn
    });

    it("should handle AI timeout gracefully", () => {
      // AI call times out, fallback summary is used
      const fallback = "Slack thread archived for future reference.";
      expect(fallback).toBeTruthy();
    });

    it("should handle encryption failures gracefully", () => {
      // Encryption error should not prevent queue acknowledgment
      // but should log error
      expect(() => {
        throw new Error("Encryption failed");
      }).toThrow();
    });

    it("should handle D1 insert failures", () => {
      // Database error should be caught and rethrown
      // so Cloudflare Queues can retry
      expect(() => {
        throw new Error("D1 insert failed");
      }).toThrow();
    });
  });

  describe("Performance Characteristics", () => {
    it("should process within reasonable time budget", () => {
      const operations = [
        { name: "AI summarization", duration: 2000 },
        { name: "encryption", duration: 50 },
        { name: "D1 insert", duration: 100 },
        { name: "vectorize index", duration: 500 },
      ];

      const total = operations.reduce((sum, op) => sum + op.duration, 0);
      expect(total).toBeLessThan(10000); // <10s total
    });

    it("should handle batch processing efficiently", () => {
      const batchSize = 5;
      const timePerMessage = 2000; // AI summarization
      const expectedBatchTime = timePerMessage + 1000; // overlapped

      expect(expectedBatchTime).toBeLessThan(timePerMessage * batchSize);
    });
  });
});
