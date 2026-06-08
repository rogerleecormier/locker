/**
 * Tests for the AES-256-GCM envelope encryption layer.
 *
 * Coverage:
 *   1. encrypt / decrypt round-trips — known inputs, UTF-8, empty string, symbols
 *   2. decryptEphemeral / EphemeralPlaintext — round-trips, drop() zeroing, post-drop throws
 *   3. isEncrypted — true/false for exact format spec, edge cases, false-positive guard
 *   4. hashToken / verifyToken — PBKDF2 format string, iteration count, uniqueness, verify semantics
 *   5. verifyToken constant-time path — wrong token returns false, legacy SHA-256 path
 *   6. extractTokenPrefix — lkr_ prefix extraction, null on bad input
 *   7. computeBlindIndex — deterministic, order-insensitive, vaultId domain separation
 *   8. sha256Hex — known-vector digest
 *   9. getOrCreateVaultKey — D1 mock create-and-fetch, idempotency on conflict
 *  10. deriveUserKey — determinism, hex output format
 *
 * Run: npx vitest run src/server/crypto.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  encrypt,
  decrypt,
  decryptEphemeral,
  EphemeralPlaintext,
  isEncrypted,
  hashToken,
  verifyToken,
  extractTokenPrefix,
  computeBlindIndex,
  sha256Hex,
  getOrCreateVaultKey,
  deriveUserKey,
  extractKeywordTokens,
  computeKeywordTokenHash,
  buildKeywordBlindIndex,
} from "./crypto";

// ─── Constants ───────────────────────────────────────────────────────────────

// A valid 64-char hex KEK (32 random bytes represented as hex).
const TEST_KEK = "a".repeat(64);
// A second KEK to verify domain separation / wrong-key failures.
const ALT_KEK = "b".repeat(64);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal D1Database mock that fulfils the interface used by getOrCreateVaultKey. */
function makeD1Mock(existingWrappedDEK?: string) {
  // Shared store so the "inserted" re-fetch sees what was stored.
  let stored: string | null = existingWrappedDEK ?? null;

  const firstMock = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockImplementation(async () =>
      stored ? { wrapped_dek: stored } : null
    ),
    run: vi.fn().mockImplementation(async () => {
      // Simulate the INSERT … ON CONFLICT DO NOTHING path:
      // if nothing was stored yet, store the value from the bind call.
      // We capture it from the bind spy.
      if (stored === null) {
        const bindArgs = firstMock.bind.mock.calls.at(-1) as string[] | undefined;
        if (bindArgs) stored = bindArgs[1] as string;
      }
    }),
  };

  return {
    prepare: vi.fn().mockReturnValue(firstMock),
    _getStored: () => stored,
  } as unknown as import("@cloudflare/workers-types").D1Database & { _getStored: () => string | null };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: encrypt / decrypt round-trips
// ─────────────────────────────────────────────────────────────────────────────

describe("encrypt / decrypt", () => {
  it("round-trips an ASCII string with a hex key", async () => {
    const plaintext = "hello, locker!";
    const ciphertext = await encrypt(plaintext, TEST_KEK);
    expect(await decrypt(ciphertext, TEST_KEK)).toBe(plaintext);
  });

  it("round-trips a multi-line UTF-8 string", async () => {
    const plaintext = "Ünïcödé\nnewlines\t\ttabs 🔒";
    const ciphertext = await encrypt(plaintext, TEST_KEK);
    expect(await decrypt(ciphertext, TEST_KEK)).toBe(plaintext);
  });

  it("round-trips an empty string", async () => {
    const ciphertext = await encrypt("", TEST_KEK);
    expect(await decrypt(ciphertext, TEST_KEK)).toBe("");
  });

  it("round-trips a long JSON blob", async () => {
    const plaintext = JSON.stringify({ key: "value", nums: [1, 2, 3], nested: { a: true } });
    const ciphertext = await encrypt(plaintext, TEST_KEK);
    expect(await decrypt(ciphertext, TEST_KEK)).toBe(plaintext);
  });

  it("produces ciphertext in iv_hex:ciphertext_hex format", async () => {
    const ciphertext = await encrypt("test", TEST_KEK);
    expect(isEncrypted(ciphertext)).toBe(true);
  });

  it("produces unique ciphertext for identical plaintext (probabilistic IV)", async () => {
    const [a, b] = await Promise.all([encrypt("same", TEST_KEK), encrypt("same", TEST_KEK)]);
    expect(a).not.toBe(b);
  });

  it("decrypt throws on wrong key", async () => {
    const ciphertext = await encrypt("secret", TEST_KEK);
    await expect(decrypt(ciphertext, ALT_KEK)).rejects.toThrow();
  });

  it("decrypt throws on tampered ciphertext", async () => {
    const ciphertext = await encrypt("secret", TEST_KEK);
    const tampered = ciphertext.slice(0, -4) + "0000"; // flip last 4 hex chars
    await expect(decrypt(tampered, TEST_KEK)).rejects.toThrow();
  });

  it("decrypt throws when format has no colon", async () => {
    await expect(decrypt("no-colon-here", TEST_KEK)).rejects.toThrow("Invalid encrypted format");
  });

  it("accepts a CryptoKey in place of a hex string", async () => {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(32),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
    const ciphertext = await encrypt("via-cryptokey", cryptoKey);
    expect(await decrypt(ciphertext, cryptoKey)).toBe("via-cryptokey");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: decryptEphemeral / EphemeralPlaintext
// ─────────────────────────────────────────────────────────────────────────────

describe("EphemeralPlaintext", () => {
  it("get() returns the correct plaintext string", () => {
    const bytes = new TextEncoder().encode("sensitive data");
    const ep = new EphemeralPlaintext(bytes);
    expect(ep.get()).toBe("sensitive data");
  });

  it("get() can be called multiple times before drop()", () => {
    const ep = new EphemeralPlaintext(new TextEncoder().encode("abc"));
    expect(ep.get()).toBe("abc");
    expect(ep.get()).toBe("abc");
  });

  it("drop() zeroes the underlying buffer", () => {
    const bytes = new TextEncoder().encode("zero-me");
    const ep = new EphemeralPlaintext(bytes);
    ep.drop();
    // Every byte in the original array should now be 0.
    expect([...bytes].every((b) => b === 0)).toBe(true);
  });

  it("get() throws after drop()", () => {
    const ep = new EphemeralPlaintext(new TextEncoder().encode("gone"));
    ep.drop();
    expect(() => ep.get()).toThrow("Plaintext has already been dropped");
  });

  it("drop() is idempotent — calling twice does not throw", () => {
    const ep = new EphemeralPlaintext(new TextEncoder().encode("idempotent"));
    ep.drop();
    expect(() => ep.drop()).not.toThrow();
  });
});

describe("decryptEphemeral", () => {
  it("round-trips via decryptEphemeral and EphemeralPlaintext.get()", async () => {
    const plaintext = "ephemeral secret";
    const ciphertext = await encrypt(plaintext, TEST_KEK);
    const ep = await decryptEphemeral(ciphertext, TEST_KEK);
    expect(ep.get()).toBe(plaintext);
    ep.drop();
  });

  it("throws on format missing a colon", async () => {
    await expect(decryptEphemeral("nocolon", TEST_KEK)).rejects.toThrow("Invalid encrypted format");
  });

  it("throws on wrong decryption key", async () => {
    const ciphertext = await encrypt("data", TEST_KEK);
    await expect(decryptEphemeral(ciphertext, ALT_KEK)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: isEncrypted
// ─────────────────────────────────────────────────────────────────────────────

describe("isEncrypted", () => {
  it("returns true for ciphertext produced by encrypt()", async () => {
    const ct = await encrypt("anything", TEST_KEK);
    expect(isEncrypted(ct)).toBe(true);
  });

  it("returns false for a plain English sentence", () => {
    expect(isEncrypted("this is a plain fact")).toBe(false);
  });

  it("returns false when colon is not at position 24", () => {
    // 20 hex chars + colon — IV would be 10 bytes, not 12
    expect(isEncrypted("a".repeat(20) + ":" + "b".repeat(32))).toBe(false);
    // 28 hex chars + colon — IV would be 14 bytes, not 12
    expect(isEncrypted("a".repeat(28) + ":" + "b".repeat(32))).toBe(false);
  });

  it("returns false when body after colon contains non-hex characters", () => {
    expect(isEncrypted("a".repeat(24) + ":ZZZZ")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isEncrypted("")).toBe(false);
  });

  it("returns false when value is only the IV with no ciphertext body", () => {
    // 24 hex chars + colon but nothing after
    expect(isEncrypted("a".repeat(24) + ":")).toBe(false);
  });

  it("returns true for a synthetic but correctly-shaped hex:hex string", () => {
    // 24-char IV (12 bytes) + colon + 32-char ciphertext body — valid shape
    expect(isEncrypted("a".repeat(24) + ":" + "f".repeat(32))).toBe(true);
  });

  it("is consistent across multiple calls on the same input", async () => {
    const ct = await encrypt("stable", TEST_KEK);
    for (let i = 0; i < 5; i++) {
      expect(isEncrypted(ct)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: hashToken — PBKDF2 format and properties
// ─────────────────────────────────────────────────────────────────────────────

describe("hashToken", () => {
  it("returns a string in pbkdf2$<iterations>$<base64-salt>$<base64-hash> format", async () => {
    const hash = await hashToken("lkr_testtoken");
    const parts = hash.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2");
  });

  it("encodes exactly 100,000 iterations", async () => {
    const hash = await hashToken("lkr_testtoken");
    const iterations = parseInt(hash.split("$")[1], 10);
    expect(iterations).toBe(100_000);
  });

  it("salt segment decodes to 16 bytes", async () => {
    const hash = await hashToken("lkr_testtoken");
    const saltBytes = Uint8Array.from(atob(hash.split("$")[2]), (c) => c.charCodeAt(0));
    expect(saltBytes.length).toBe(16);
  });

  it("hash segment decodes to 32 bytes (256 bits)", async () => {
    const hash = await hashToken("lkr_testtoken");
    const hashBytes = Uint8Array.from(atob(hash.split("$")[3]), (c) => c.charCodeAt(0));
    expect(hashBytes.length).toBe(32);
  });

  it("two hashes of the same token are never equal (unique salt per call)", async () => {
    const [h1, h2] = await Promise.all([hashToken("lkr_same"), hashToken("lkr_same")]);
    expect(h1).not.toBe(h2);
  });

  it("different tokens produce different hashes", async () => {
    const [h1, h2] = await Promise.all([hashToken("lkr_aaa"), hashToken("lkr_bbb")]);
    expect(h1).not.toBe(h2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: verifyToken — constant-time comparison and legacy path
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyToken", () => {
  it("returns true when token matches PBKDF2 hash", async () => {
    const token = "lkr_correcttoken";
    const hash = await hashToken(token);
    expect(await verifyToken(token, hash)).toBe(true);
  });

  it("returns false when token does not match PBKDF2 hash", async () => {
    const hash = await hashToken("lkr_correcttoken");
    expect(await verifyToken("lkr_wrongtoken", hash)).toBe(false);
  });

  it("returns false for a single-bit-off token (constant-time diff guard)", async () => {
    const token = "lkr_abcdefgh";
    const hash = await hashToken(token);
    // Flip the last character of the token
    const flipped = token.slice(0, -1) + (token.at(-1) === "h" ? "i" : "h");
    expect(await verifyToken(flipped, hash)).toBe(false);
  });

  it("returns false for an empty token against a valid hash", async () => {
    const hash = await hashToken("lkr_nonempty");
    expect(await verifyToken("", hash)).toBe(false);
  });

  it("returns false for a malformed pbkdf2$ hash (wrong part count)", async () => {
    expect(await verifyToken("lkr_token", "pbkdf2$100000$onlythreeparts")).toBe(false);
  });

  it("returns false when iteration count is zero", async () => {
    // Build a syntactically valid hash with 0 iterations — should be rejected
    const token = "lkr_x";
    const salt = btoa("0123456789abcdef");
    const fakeHash = btoa("a".repeat(32));
    expect(await verifyToken(token, `pbkdf2$0$${salt}$${fakeHash}`)).toBe(false);
  });

  it("returns false for a completely unrecognized hash format", async () => {
    expect(await verifyToken("lkr_token", "not-a-valid-format")).toBe(false);
  });

  // Legacy SHA-256 path
  it("accepts legacy SHA-256 hex hash (64 hex chars)", async () => {
    const token = "legacy_token_abc";
    const hash = await sha256Hex(token);
    expect(hash).toHaveLength(64);
    expect(await verifyToken(token, hash)).toBe(true);
  });

  it("rejects wrong token against legacy SHA-256 hash", async () => {
    const hash = await sha256Hex("legacy_token_abc");
    expect(await verifyToken("legacy_token_xyz", hash)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: extractTokenPrefix
// ─────────────────────────────────────────────────────────────────────────────

describe("extractTokenPrefix", () => {
  it("extracts chars [4,12) from a valid lkr_ token", () => {
    expect(extractTokenPrefix("lkr_12345678abcdef")).toBe("12345678");
  });

  it("returns null when prefix is not lkr_", () => {
    expect(extractTokenPrefix("tok_12345678abcdef")).toBeNull();
    expect(extractTokenPrefix("12345678abcdef")).toBeNull();
  });

  it("returns null when token is shorter than 12 chars", () => {
    expect(extractTokenPrefix("lkr_1234")).toBeNull(); // only 8 chars, needs ≥12
  });

  it("returns exactly 8 characters", () => {
    const prefix = extractTokenPrefix("lkr_abcdefghXXXX");
    expect(prefix).toHaveLength(8);
    expect(prefix).toBe("abcdefgh");
  });

  it("returns null for an empty string", () => {
    expect(extractTokenPrefix("")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: computeBlindIndex
// ─────────────────────────────────────────────────────────────────────────────

describe("computeBlindIndex", () => {
  it("returns a 64-char hex string", async () => {
    const idx = await computeBlindIndex("user123", "work,personal");
    expect(idx).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same vaultId and tags always yield the same hash", async () => {
    const [a, b] = await Promise.all([
      computeBlindIndex("user123", "work,personal"),
      computeBlindIndex("user123", "work,personal"),
    ]);
    expect(a).toBe(b);
  });

  it("is order-insensitive — tag order does not change the hash", async () => {
    const [a, b] = await Promise.all([
      computeBlindIndex("user123", "personal,work"),
      computeBlindIndex("user123", "work,personal"),
    ]);
    expect(a).toBe(b);
  });

  it("is case-insensitive — uppercase and lowercase tags hash identically", async () => {
    const [a, b] = await Promise.all([
      computeBlindIndex("user123", "Work,Personal"),
      computeBlindIndex("user123", "work,personal"),
    ]);
    expect(a).toBe(b);
  });

  it("different vaultIds produce different hashes for the same tags (domain separation)", async () => {
    const [a, b] = await Promise.all([
      computeBlindIndex("userA", "work"),
      computeBlindIndex("userB", "work"),
    ]);
    expect(a).not.toBe(b);
  });

  it("different tag sets produce different hashes for the same vaultId", async () => {
    const [a, b] = await Promise.all([
      computeBlindIndex("user123", "work"),
      computeBlindIndex("user123", "personal"),
    ]);
    expect(a).not.toBe(b);
  });

  it("repeated tags are preserved in the hash (no dedup in source)", async () => {
    // The implementation sorts but does not deduplicate — "work,work" != "work"
    const [a, b] = await Promise.all([
      computeBlindIndex("user123", "work,work"),
      computeBlindIndex("user123", "work"),
    ]);
    expect(a).not.toBe(b);
  });

  it("trims whitespace around tags", async () => {
    const [a, b] = await Promise.all([
      computeBlindIndex("user123", " work , personal "),
      computeBlindIndex("user123", "work,personal"),
    ]);
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: sha256Hex
// ─────────────────────────────────────────────────────────────────────────────

describe("sha256Hex", () => {
  it("returns a 64-char lowercase hex string", async () => {
    const result = await sha256Hex("hello");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("matches an independent SHA-256 computation for 'abc'", async () => {
    // Verify sha256Hex matches a direct crypto.subtle.digest call on the same input.
    const result = await sha256Hex("abc");
    const encoded = new TextEncoder().encode("abc");
    const buf = await crypto.subtle.digest("SHA-256", encoded);
    const expected = Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(result).toBe(expected);
  });

  it("is deterministic for the same input", async () => {
    const [a, b] = await Promise.all([sha256Hex("same"), sha256Hex("same")]);
    expect(a).toBe(b);
  });

  it("different inputs produce different digests", async () => {
    const [a, b] = await Promise.all([sha256Hex("aaa"), sha256Hex("bbb")]);
    expect(a).not.toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: getOrCreateVaultKey (D1 mock)
// ─────────────────────────────────────────────────────────────────────────────

describe("getOrCreateVaultKey", () => {
  it("creates a new vault key when vault_id does not exist and returns a CryptoKey", async () => {
    const db = makeD1Mock(); // no pre-existing entry
    const key = await getOrCreateVaultKey(db, TEST_KEK, "user:new-vault");
    expect(key).toBeDefined();
    expect(key.type).toBe("secret");
    expect(key.algorithm).toMatchObject({ name: "AES-GCM" });
  });

  it("the created DEK is usable for encrypt/decrypt", async () => {
    const db = makeD1Mock();
    const key = await getOrCreateVaultKey(db, TEST_KEK, "user:vault1");
    const ct = await encrypt("vault-data", key);
    // Re-fetch the same key from the same mock (simulates a second request)
    const stored = (db as ReturnType<typeof makeD1Mock>)._getStored();
    expect(stored).not.toBeNull();
    // Unwrap via a fresh getOrCreateVaultKey call using the stored wrapped DEK
    const db2 = makeD1Mock(stored!);
    const key2 = await getOrCreateVaultKey(db2, TEST_KEK, "user:vault1");
    expect(await decrypt(ct, key2)).toBe("vault-data");
  });

  it("returns the existing DEK when vault_id already exists in D1", async () => {
    // First call creates and stores the key
    const db = makeD1Mock();
    const key1 = await getOrCreateVaultKey(db, TEST_KEK, "user:existing");
    const ct = await encrypt("persistent", key1);

    // Second call on same mock (simulates row already in DB)
    const key2 = await getOrCreateVaultKey(db, TEST_KEK, "user:existing");
    expect(await decrypt(ct, key2)).toBe("persistent");
  });

  it("throws when masterKey is not valid hex (bad KEK)", async () => {
    const db = makeD1Mock();
    await expect(getOrCreateVaultKey(db, "not-hex-at-all!!", "user:x")).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: deriveUserKey (legacy / backward-compat)
// ─────────────────────────────────────────────────────────────────────────────

describe("deriveUserKey", () => {
  it("returns a 64-char lowercase hex string", async () => {
    const derived = await deriveUserKey(TEST_KEK, "user-abc");
    expect(derived).toHaveLength(64);
    expect(derived).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic — same masterKey and userId always yield the same output", async () => {
    const [a, b] = await Promise.all([
      deriveUserKey(TEST_KEK, "user-abc"),
      deriveUserKey(TEST_KEK, "user-abc"),
    ]);
    expect(a).toBe(b);
  });

  it("different userIds produce different derived keys", async () => {
    const [a, b] = await Promise.all([
      deriveUserKey(TEST_KEK, "user-abc"),
      deriveUserKey(TEST_KEK, "user-xyz"),
    ]);
    expect(a).not.toBe(b);
  });

  it("different masterKeys produce different derived keys for the same userId", async () => {
    const [a, b] = await Promise.all([
      deriveUserKey(TEST_KEK, "same-user"),
      deriveUserKey(ALT_KEK, "same-user"),
    ]);
    expect(a).not.toBe(b);
  });

  it("the derived key hex can be used directly with encrypt/decrypt", async () => {
    const derivedHex = await deriveUserKey(TEST_KEK, "legacy-user-1");
    const ct = await encrypt("legacy plaintext", derivedHex);
    expect(await decrypt(ct, derivedHex)).toBe("legacy plaintext");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: extractKeywordTokens
// ─────────────────────────────────────────────────────────────────────────────

describe("extractKeywordTokens", () => {
  it("splits on non-word characters and lowercases", () => {
    expect(extractKeywordTokens("Hello, World! foo")).toEqual(
      expect.arrayContaining(["hello", "world", "foo"])
    );
  });

  it("deduplicates repeated tokens", () => {
    const tokens = extractKeywordTokens("cat cat cat dog dog");
    expect(tokens.filter((t) => t === "cat")).toHaveLength(1);
    expect(tokens.filter((t) => t === "dog")).toHaveLength(1);
  });

  it("drops tokens strictly shorter than 3 characters (MIN_TOKEN_LEN = 3)", () => {
    // "a" (1 char) and "is" / "an" (2 chars) are dropped; "the" (3 chars) is kept.
    const tokens = extractKeywordTokens("a is an the hello");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("is");
    expect(tokens).not.toContain("an");
    expect(tokens).toContain("the");
    expect(tokens).toContain("hello");
  });

  it("returns an empty array for a fact with no qualifying tokens", () => {
    expect(extractKeywordTokens("a b c")).toEqual([]);
    expect(extractKeywordTokens("")).toEqual([]);
    expect(extractKeywordTokens("  ")).toEqual([]);
  });

  it("preserves alphanumeric tokens like identifiers and numbers", () => {
    const tokens = extractKeywordTokens("user123 config abc456");
    expect(tokens).toContain("user123");
    expect(tokens).toContain("config");
    expect(tokens).toContain("abc456");
  });

  it("caps output at 200 tokens", () => {
    // Build a fact with 300 unique 5-char words
    const words = Array.from({ length: 300 }, (_, i) => `word${String(i).padStart(3, "0")}`);
    const tokens = extractKeywordTokens(words.join(" "));
    expect(tokens.length).toBeLessThanOrEqual(200);
  });

  it("handles punctuation-separated words correctly", () => {
    const tokens = extractKeywordTokens("key=value&other-thing/path");
    expect(tokens).toContain("key");
    expect(tokens).toContain("value");
    expect(tokens).toContain("other");
    expect(tokens).toContain("thing");
    expect(tokens).toContain("path");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 12: computeKeywordTokenHash
// ─────────────────────────────────────────────────────────────────────────────

describe("computeKeywordTokenHash", () => {
  it("returns a 64-char lowercase hex string", async () => {
    const h = await computeKeywordTokenHash("user-vault", "token");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same vaultId and token", async () => {
    const [a, b] = await Promise.all([
      computeKeywordTokenHash("vault1", "keyword"),
      computeKeywordTokenHash("vault1", "keyword"),
    ]);
    expect(a).toBe(b);
  });

  it("different vaultIds produce different hashes for the same token (domain separation)", async () => {
    const [a, b] = await Promise.all([
      computeKeywordTokenHash("vaultA", "keyword"),
      computeKeywordTokenHash("vaultB", "keyword"),
    ]);
    expect(a).not.toBe(b);
  });

  it("different tokens produce different hashes for the same vaultId", async () => {
    const [a, b] = await Promise.all([
      computeKeywordTokenHash("vault1", "alpha"),
      computeKeywordTokenHash("vault1", "beta"),
    ]);
    expect(a).not.toBe(b);
  });

  it("is case-insensitive — uppercased token matches its lowercased form", async () => {
    const [lower, upper] = await Promise.all([
      computeKeywordTokenHash("vault1", "hello"),
      computeKeywordTokenHash("vault1", "HELLO"),
    ]);
    expect(lower).toBe(upper);
  });

  it("trims whitespace from the token before hashing", async () => {
    const [trimmed, padded] = await Promise.all([
      computeKeywordTokenHash("vault1", "hello"),
      computeKeywordTokenHash("vault1", "  hello  "),
    ]);
    expect(trimmed).toBe(padded);
  });

  it("is distinct from computeBlindIndex output for the same input (different namespace prefix)", async () => {
    // computeKeywordTokenHash uses 'kw:<vaultId>:<token>' while computeBlindIndex uses '<vaultId>:<normalised>'
    const kwHash = await computeKeywordTokenHash("vault1", "hello");
    const tagHash = await computeBlindIndex("vault1", "hello");
    expect(kwHash).not.toBe(tagHash);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 13: buildKeywordBlindIndex
// ─────────────────────────────────────────────────────────────────────────────

describe("buildKeywordBlindIndex", () => {
  it("returns a valid JSON array string for a normal fact", async () => {
    const result = await buildKeywordBlindIndex("vault1", "The user prefers dark mode settings");
    expect(result).not.toBeNull();
    const parsed = JSON.parse(result!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("every element in the returned array is a 64-char hex hash", async () => {
    const result = await buildKeywordBlindIndex("vault1", "Cloudflare Workers AI deployment config");
    const parsed: string[] = JSON.parse(result!);
    for (const h of parsed) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("returns null for a fact that produces no qualifying tokens", async () => {
    expect(await buildKeywordBlindIndex("vault1", "a b c")).toBeNull();
    expect(await buildKeywordBlindIndex("vault1", "")).toBeNull();
  });

  it("is deterministic — same vaultId and fact always produce the same JSON", async () => {
    const fact = "TypeScript React TanStack Cloudflare D1 Drizzle";
    const [a, b] = await Promise.all([
      buildKeywordBlindIndex("vault1", fact),
      buildKeywordBlindIndex("vault1", fact),
    ]);
    expect(a).toBe(b);
  });

  it("different vaultIds produce different JSON arrays for the same fact (domain separation)", async () => {
    const fact = "shared memory fact content here";
    const [a, b] = await Promise.all([
      buildKeywordBlindIndex("vaultA", fact),
      buildKeywordBlindIndex("vaultB", fact),
    ]);
    expect(a).not.toBe(b);
  });

  it("the hash of any extracted token appears in the resulting array", async () => {
    const vaultId = "vault-lookup-test";
    const fact = "authentication token refresh flow";
    const result = await buildKeywordBlindIndex(vaultId, fact);
    const parsed: string[] = JSON.parse(result!);

    // "authentication", "token", "refresh", "flow" are all ≥3 chars
    const tokenHash = await computeKeywordTokenHash(vaultId, "authentication");
    expect(parsed).toContain(tokenHash);

    const tokenHash2 = await computeKeywordTokenHash(vaultId, "refresh");
    expect(parsed).toContain(tokenHash2);
  });

  it("tokens shorter than 3 characters are not included in the index", async () => {
    const vaultId = "vault-stop-words";
    // "is" (2) and "an" (2) are < MIN_TOKEN_LEN and must be excluded.
    // "the" (3) and "authentication" (14) meet the threshold and must appear.
    const fact = "is an the authentication";
    const result = await buildKeywordBlindIndex(vaultId, fact);
    const parsed: string[] = JSON.parse(result!);

    const tooShortHashes = await Promise.all([
      computeKeywordTokenHash(vaultId, "is"),
      computeKeywordTokenHash(vaultId, "an"),
    ]);
    for (const h of tooShortHashes) {
      expect(parsed).not.toContain(h);
    }

    const theHash = await computeKeywordTokenHash(vaultId, "the");
    expect(parsed).toContain(theHash);
  });

  it("a hash produced at query time matches the stored hash for the same token", async () => {
    // Simulates the recall_context lookup: hash the query keyword and check json_each()
    const vaultId = "vault-query-sim";
    const fact = "user configured dark mode preferences and notification settings";
    const storedIndex = await buildKeywordBlindIndex(vaultId, fact);
    const stored: string[] = JSON.parse(storedIndex!);

    const queryHash = await computeKeywordTokenHash(vaultId, "preferences");
    expect(stored).toContain(queryHash);

    // A token not in the fact must not appear
    const missingHash = await computeKeywordTokenHash(vaultId, "cloudflare");
    expect(stored).not.toContain(missingHash);
  });

  it("different facts produce different arrays for the same vaultId", async () => {
    const [a, b] = await Promise.all([
      buildKeywordBlindIndex("vault1", "drizzle orm database schema migration"),
      buildKeywordBlindIndex("vault1", "react tanstack router frontend component"),
    ]);
    expect(a).not.toBe(b);
  });
});
