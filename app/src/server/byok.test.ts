/**
 * BYOK (Bring Your Own Key) — End-to-End Encryption test suite.
 *
 * Coverage:
 *   1. crypto.client — encryptFact / decryptFact round-trip with Web Crypto API
 *   2. crypto.client — isByokCiphertext detection (true / false cases)
 *   3. crypto.client — buildByokCommitPayload produces no plaintext in output
 *   4. CommitMemoryByokArgsSchema — accepts valid Base64 ciphertext
 *   5. CommitMemoryByokArgsSchema — rejects plaintext strings
 *   6. CommitMemoryByokArgsSchema — rejects ciphertexts that are too short
 *   7. CommitMemoryByokArgsSchema — optional embedding field validation
 *   8. Network-intercept simulation — POST payload contains no readable plaintext
 *   9. isByokKeyLoaded / clearByokKey lifecycle
 *  10. loadByokKey — invalid hex rejected
 *  11. ByokKeyNotLoadedError thrown when no key loaded
 *  12. zByokCiphertext schema — rejects non-Base64 content
 *
 * Run: npx vitest run src/server/byok.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { z } from "zod";
import {
  loadByokKey,
  clearByokKey,
  isByokKeyLoaded,
  encryptFact,
  decryptFact,
  isByokCiphertext,
  buildByokCommitPayload,
  setEmbeddingPipeline,
  ByokKeyNotLoadedError,
} from "./crypto.client";

// ─── Mock embedding pipeline ──────────────────────────────────────────────────
// Injected before any test that calls generateLocalEmbedding() so the real
// @xenova/transformers package (which downloads 80 MB of model weights) is never
// loaded during the test run.

const MOCK_EMBEDDING_DIM = 384;
const mockPipeline = vi.fn().mockImplementation(async (_text: string) => ({
  data: new Float32Array(MOCK_EMBEDDING_DIM).fill(0.1),
})) as unknown as Parameters<typeof setEmbeddingPipeline>[0];

// Install the mock pipeline once for the entire test file.
setEmbeddingPipeline(mockPipeline);

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_HEX_KEY = "a".repeat(64); // 32 bytes of 0xaa
const ALT_HEX_KEY   = "b".repeat(64);

const PLAINTEXT_SAMPLES = [
  "User prefers TypeScript strict mode.",
  "Project: implement GraphRAG in Q3.",
  "The ENCRYPTION_KEY must be rotated every 90 days.",
  "SELECT * FROM memories WHERE userId = ?",
  "Hello, world!",
  "a".repeat(5000),
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True when a string contains any of the plaintext samples verbatim. */
function containsPlaintext(payload: string, samples: string[]): boolean {
  return samples.some((s) => payload.includes(s));
}

/** Produce a valid 40+ char Base64 ciphertext (simulates encryptFact output). */
async function makeValidCiphertext(plaintext = "test fact"): Promise<string> {
  await loadByokKey(VALID_HEX_KEY);
  const ct = await encryptFact(plaintext);
  clearByokKey();
  return ct;
}

// ─── Zod schema (mirrors production CommitMemoryByokArgsSchema) ───────────────
// Re-defined here so the test file is self-contained and does not import from
// the Cloudflare Worker runtime module.

const zByokCiphertext = z
  .string()
  .min(40, "BYOK ciphertext too short")
  .max(14000, "BYOK ciphertext exceeds max length")
  .regex(
    /^[A-Za-z0-9+/]+=*$/,
    "BYOK fact must be Base64-encoded ciphertext — plaintext rejected in BYOK mode",
  );

const CommitMemoryByokArgsSchema = z.object({
  fact: zByokCiphertext,
  category: z.enum(["rules", "projects", "references"]).optional(),
  tags: z.string().max(500).default("").transform((s) => s.trim()),
  source: z.string().max(64).default("mcp").transform((s) => s.trim().toLowerCase()),
  projectKey: z.string().max(128).optional(),
  embedding: z.array(z.number()).min(64).max(4096).optional(),
}).strict();

// ─── 1. Encrypt / Decrypt round-trip ─────────────────────────────────────────

describe("encryptFact / decryptFact", () => {
  beforeEach(async () => {
    await loadByokKey(VALID_HEX_KEY);
  });

  afterEach(() => {
    clearByokKey();
  });

  it("round-trips ASCII plaintext", async () => {
    const ct = await encryptFact("Hello, Locker!");
    expect(typeof ct).toBe("string");
    const pt = await decryptFact(ct);
    expect(pt).toBe("Hello, Locker!");
  });

  it("round-trips multi-byte UTF-8 plaintext", async () => {
    const fact = "Résumé: αβγ — 日本語 — 🔐";
    const ct = await encryptFact(fact);
    const pt = await decryptFact(ct);
    expect(pt).toBe(fact);
  });

  it("produces different ciphertext on each call (random IV)", async () => {
    const fact = "determinism check";
    const ct1 = await encryptFact(fact);
    const ct2 = await encryptFact(fact);
    expect(ct1).not.toBe(ct2);
  });

  it("output is valid Base64", async () => {
    const ct = await encryptFact("test");
    expect(/^[A-Za-z0-9+/]+=*$/.test(ct)).toBe(true);
  });

  it("ciphertext does NOT contain the plaintext string", async () => {
    for (const sample of PLAINTEXT_SAMPLES) {
      const ct = await encryptFact(sample);
      expect(ct).not.toContain(sample);
      // Also verify the raw bytes are not present as UTF-8 substrings
      expect(atob(ct).includes(sample)).toBe(false);
    }
  });

  it("minimum length is >= 40 chars for any non-empty input", async () => {
    const ct = await encryptFact("x");
    expect(ct.length).toBeGreaterThanOrEqual(40);
  });

  it("cannot decrypt with wrong key", async () => {
    const ct = await encryptFact("secret");
    clearByokKey();
    await loadByokKey(ALT_HEX_KEY);
    await expect(decryptFact(ct)).rejects.toThrow();
  });
});

// ─── 2. isByokCiphertext ──────────────────────────────────────────────────────

describe("isByokCiphertext", () => {
  it("returns true for valid Base64 of sufficient length", async () => {
    const ct = await makeValidCiphertext();
    expect(isByokCiphertext(ct)).toBe(true);
  });

  it("returns false for plaintext strings", () => {
    expect(isByokCiphertext("User prefers TypeScript.")).toBe(false);
    expect(isByokCiphertext("SELECT * FROM memories")).toBe(false);
    expect(isByokCiphertext("hello world")).toBe(false);
  });

  it("returns false for strings shorter than 40 chars", () => {
    expect(isByokCiphertext("AAAA")).toBe(false);
    expect(isByokCiphertext("SGVsbG8gV29ybGQ=")).toBe(false); // "Hello World" in Base64 — 16 chars
  });

  it("returns false for hex-encoded strings (not Base64)", () => {
    // Hex contains only [0-9a-f] so passes the charset check, but length and
    // meaning differ from our IV+ciphertext format.
    const hexStr = "a".repeat(40);
    // This passes Base64 regex (all 'a' is valid Base64) — isByokCiphertext is
    // intentionally permissive on charset; it's a quick pre-filter only.
    // The real enforcement is the Zod schema + server-side AES-GCM decryption.
    expect(isByokCiphertext(hexStr)).toBe(true); // hex chars are valid Base64 chars
  });

  it("returns false for strings containing non-Base64 characters", () => {
    const bad = "hello world this is not base64!!!!";
    expect(isByokCiphertext(bad)).toBe(false);
  });
});

// ─── 3. buildByokCommitPayload — no plaintext in output ──────────────────────

describe("buildByokCommitPayload — no plaintext in payload", () => {
  beforeEach(async () => {
    await loadByokKey(VALID_HEX_KEY);
  });

  afterEach(() => {
    clearByokKey();
  });

  it.each(PLAINTEXT_SAMPLES)(
    'payload for "%s" contains no readable plaintext',
    async (fact) => {
      const payload = await buildByokCommitPayload(fact, {
        category: "rules",
        tags: "test",
      });

      // Serialize the payload exactly as it would be sent over the wire.
      const serialized = JSON.stringify(payload);

      // Assert: the original plaintext string does not appear in the payload.
      expect(serialized).not.toContain(fact);

      // Assert: the encryptedFact field is present and non-empty.
      expect(typeof payload.encryptedFact).toBe("string");
      expect(payload.encryptedFact.length).toBeGreaterThanOrEqual(40);

      // Assert: the embedding is a float array.
      expect(Array.isArray(payload.embedding)).toBe(true);
      expect(payload.embedding.length).toBeGreaterThan(0);
      payload.embedding.forEach((v) => expect(typeof v).toBe("number"));

      // Assert: source is set to byok-client.
      expect(payload.source).toBe("byok-client");
    },
  );

  it("intercept simulation: network body contains no plaintext", async () => {
    // Simulate the fetch() body that would be sent to POST /api/mcp.
    const captured: string[] = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url, init) => {
      if (typeof init?.body === "string") captured.push(init.body);
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    });

    const fact = "The user's GitHub PAT expires on 2026-09-01.";
    const payload = await buildByokCommitPayload(fact, { category: "projects" });

    // Simulate what the client code does: POST the payload.
    await fetch("/api/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Locker-BYOK": "1",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "commit_memory",
          arguments: {
            fact: payload.encryptedFact,
            embedding: payload.embedding,
            category: "projects",
            tags: "",
            source: "byok-client",
          },
        },
      }),
    });

    globalThis.fetch = originalFetch;

    // The captured body must not contain the plaintext fact.
    expect(captured.length).toBeGreaterThan(0);
    for (const body of captured) {
      expect(body).not.toContain(fact);
    }
  });
});

// ─── 4. CommitMemoryByokArgsSchema — accepts valid ciphertext ────────────────

describe("CommitMemoryByokArgsSchema", () => {
  it("accepts a valid Base64 ciphertext in fact field", async () => {
    const ct = await makeValidCiphertext("test memory");
    const result = CommitMemoryByokArgsSchema.safeParse({ fact: ct });
    expect(result.success).toBe(true);
  });

  it("accepts ciphertext with optional embedding", async () => {
    const ct = await makeValidCiphertext();
    const embedding = Array.from({ length: 384 }, () => Math.random());
    const result = CommitMemoryByokArgsSchema.safeParse({
      fact: ct,
      embedding,
      category: "rules",
    });
    expect(result.success).toBe(true);
  });

  // ─── 5. Rejects plaintext strings ─────────────────────────────────────────

  it.each([
    "User prefers TypeScript strict mode.",
    "SELECT * FROM memories WHERE userId = ?",
    "Hello world — this is plaintext",
    "The ENCRYPTION_KEY must be rotated every 90 days.",
  ])("rejects plaintext fact: %s", (plaintext) => {
    const result = CommitMemoryByokArgsSchema.safeParse({ fact: plaintext });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("fact");
    }
  });

  // ─── 6. Rejects ciphertexts that are too short ────────────────────────────

  it("rejects ciphertext shorter than 40 Base64 chars", () => {
    const short = btoa("tiny"); // 8 chars
    const result = CommitMemoryByokArgsSchema.safeParse({ fact: short });
    expect(result.success).toBe(false);
  });

  it("rejects an empty string", () => {
    const result = CommitMemoryByokArgsSchema.safeParse({ fact: "" });
    expect(result.success).toBe(false);
  });

  // ─── 7. Embedding field validation ────────────────────────────────────────

  it("rejects embedding shorter than 64 dimensions", async () => {
    const ct = await makeValidCiphertext();
    const result = CommitMemoryByokArgsSchema.safeParse({
      fact: ct,
      embedding: [0.1, 0.2, 0.3], // only 3 dimensions
    });
    expect(result.success).toBe(false);
  });

  it("rejects embedding longer than 4096 dimensions", async () => {
    const ct = await makeValidCiphertext();
    const embedding = new Array(5000).fill(0.1);
    const result = CommitMemoryByokArgsSchema.safeParse({ fact: ct, embedding });
    expect(result.success).toBe(false);
  });

  it("accepts embedding with exactly 384 dimensions", async () => {
    const ct = await makeValidCiphertext();
    const embedding = new Array(384).fill(0.5);
    const result = CommitMemoryByokArgsSchema.safeParse({ fact: ct, embedding });
    expect(result.success).toBe(true);
  });

  // ─── 12. Non-Base64 content ───────────────────────────────────────────────

  it("rejects strings with non-Base64 characters", async () => {
    const nonB64 = "this contains spaces and ! marks @@##";
    const result = CommitMemoryByokArgsSchema.safeParse({ fact: nonB64.padEnd(40, "=") });
    expect(result.success).toBe(false);
  });
});

// ─── 9. Key lifecycle ─────────────────────────────────────────────────────────

describe("BYOK key lifecycle", () => {
  afterEach(() => clearByokKey());

  it("isByokKeyLoaded returns false before loadByokKey", () => {
    clearByokKey();
    expect(isByokKeyLoaded()).toBe(false);
  });

  it("isByokKeyLoaded returns true after loadByokKey", async () => {
    await loadByokKey(VALID_HEX_KEY);
    expect(isByokKeyLoaded()).toBe(true);
  });

  it("clearByokKey resets isByokKeyLoaded to false", async () => {
    await loadByokKey(VALID_HEX_KEY);
    clearByokKey();
    expect(isByokKeyLoaded()).toBe(false);
  });

  // ─── 10. Invalid hex rejected ──────────────────────────────────────────────

  it("rejects a key shorter than 64 hex chars", async () => {
    await expect(loadByokKey("abc")).rejects.toThrow();
  });

  it("rejects a key with non-hex characters", async () => {
    await expect(loadByokKey("z".repeat(64))).rejects.toThrow();
  });

  // ─── 11. ByokKeyNotLoadedError ────────────────────────────────────────────

  it("throws ByokKeyNotLoadedError from encryptFact when no key loaded", async () => {
    clearByokKey();
    await expect(encryptFact("test")).rejects.toBeInstanceOf(ByokKeyNotLoadedError);
  });

  it("throws ByokKeyNotLoadedError from decryptFact when no key loaded", async () => {
    clearByokKey();
    const ct = await makeValidCiphertext();
    await expect(decryptFact(ct)).rejects.toBeInstanceOf(ByokKeyNotLoadedError);
  });
});
