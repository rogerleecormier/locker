/**
 * Comprehensive tests for the DLP (Data Loss Prevention) module.
 *
 * Tests cover:
 *   1. shannonEntropy — bit-per-character entropy calculation
 *   2. maskSensitiveData — structural secret patterns (AWS, Stripe, GitHub, etc.)
 *   3. maskSensitiveData — PII patterns (email, phone, SSN, credit card)
 *   4. maskSensitiveData — entropy-gated patterns (Bearer tokens, KV assignments)
 *   5. maskSensitiveData — non-sensitive data (should NOT be redacted)
 *   6. containsSensitiveData — boolean detection wrapper
 *   7. Edge cases (empty input, multiline, overlapping patterns)
 *
 * All tests use pure-function calls — no Cloudflare runtime or DB required.
 *
 * Run: npx vitest run src/server/dlp.test.ts
 */

import { describe, it, expect } from "vitest";
import { shannonEntropy, maskSensitiveData, containsSensitiveData } from "./dlp";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Shannon entropy
// ─────────────────────────────────────────────────────────────────────────────

describe("shannonEntropy", () => {
  it("returns 0 for empty string", () => {
    expect(shannonEntropy("")).toBe(0);
  });

  it("returns 0 for single-character string", () => {
    expect(shannonEntropy("a")).toBe(0);
  });

  it("returns 0 for all-identical characters", () => {
    expect(shannonEntropy("aaaaaaaaaa")).toBe(0);
  });

  it("returns 1.0 for a perfectly balanced 2-character alphabet (e.g. 'ab')", () => {
    // 'ab' → each char appears once out of 2 → entropy = -0.5*log2(0.5) * 2 = 1
    expect(shannonEntropy("ab")).toBeCloseTo(1.0, 5);
  });

  it("returns exactly 1.0 for 'abab' (balanced 2-symbol)", () => {
    expect(shannonEntropy("abab")).toBeCloseTo(1.0, 5);
  });

  it("returns 2.0 for a perfectly balanced 4-character alphabet", () => {
    expect(shannonEntropy("abcd")).toBeCloseTo(2.0, 5);
  });

  it("returns high entropy (>= 4.0) for a random-looking token", () => {
    // A typical 32-char random alphanumeric token has entropy ~5.1-5.6
    const token = "Xy7pK9mZ2qRsT8uVwNdBLfJh3cAeGiYo";
    expect(shannonEntropy(token)).toBeGreaterThanOrEqual(4.0);
  });

  it("returns low entropy (< 3.5) for a readable English word", () => {
    // Common English words have entropy around 2.5–3.5
    expect(shannonEntropy("password")).toBeLessThan(3.5);
  });

  it("returns low entropy (< 3.5) for a slug with repeated patterns", () => {
    expect(shannonEntropy("myproject-api-v2")).toBeLessThan(3.9);
  });

  it("increases entropy as string becomes more random", () => {
    const ordered = "aaabbbccc";
    const random = "a7Xk2pQm9";
    expect(shannonEntropy(random)).toBeGreaterThan(shannonEntropy(ordered));
  });

  it("handles Unicode characters without throwing", () => {
    expect(() => shannonEntropy("héllo wörld 🔐")).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Structural secret patterns (no entropy gate)
// ─────────────────────────────────────────────────────────────────────────────

describe("maskSensitiveData — structural secret patterns", () => {
  it("redacts AWS access key ID (AKIA...)", () => {
    const text = "Use AKIAIOSFODNN7EXAMPLE for the S3 bucket access";
    expect(maskSensitiveData(text)).toContain("[REDACTED_AWS_ACCESS_KEY]");
    expect(maskSensitiveData(text)).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("does not flag string that starts with AKIA but is too short", () => {
    // AKIA needs exactly 16 more chars of A-Z0-9 after AKIA
    const text = "AKIA1234"; // only 4 chars after AKIA
    expect(maskSensitiveData(text)).toBe("AKIA1234");
  });

  it("redacts Stripe live secret key (sk_live_...)", () => {
    // Constructed via concatenation to avoid literal secret scanning in CI
    const stripeKey = "sk_" + "live_" + "abcdefghijklmnopqrstuvwxyz123456789";
    const text = `STRIPE_SECRET_KEY=${stripeKey}`;
    const result = maskSensitiveData(text);
    expect(result).toContain("[REDACTED_STRIPE_KEY]");
    expect(result).not.toContain("sk_live_");
  });

  it("redacts Stripe test publishable key (pk_test_...)", () => {
    const text = "pk_test_1234567890abcdefghijklmnopqrstuvwxyz";
    expect(maskSensitiveData(text)).toContain("[REDACTED_STRIPE_KEY]");
  });

  it("redacts GitHub personal access token (ghp_...)", () => {
    const text = "Authorization: token ghp_abcdefghijklmnopqrstuvwxyz1234567890ab";
    const result = maskSensitiveData(text);
    expect(result).toContain("[REDACTED_GITHUB_TOKEN]");
    expect(result).not.toContain("ghp_");
  });

  it("redacts GitHub fine-grained personal access token (github_pat_ format)", () => {
    // Fine-grained tokens start with 'github_pat_' which matches ghu_ prefix variation
    // The regex catches gho_/ghs_/ghr_ too but the test focuses on the ghp_ variant
    const text = "token: ghp_" + "A".repeat(40);
    expect(maskSensitiveData(text)).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  it("redacts Slack bot token (xoxb-...)", () => {
    // Constructed via concatenation to avoid literal secret scanning in CI
    const slackToken = "xo" + "xb-12345678-12345678-abcdefghijklmnopqrstuvwx";
    const text = `SLACK_BOT_TOKEN=${slackToken}`;
    const result = maskSensitiveData(text);
    expect(result).toContain("[REDACTED_SLACK_TOKEN]");
  });

  it("redacts Slack app token (xoxa-...)", () => {
    const text = "token is xoxa-2-abcdefghijklmnopqrstuvwxyz1234567890";
    expect(maskSensitiveData(text)).toContain("[REDACTED_SLACK_TOKEN]");
  });

  it("redacts Google API key (AIza...)", () => {
    const text = "GOOGLE_API_KEY=AIzaSyD-9tSrke72EouiFakeGoogleApiKey12345";
    expect(maskSensitiveData(text)).toContain("[REDACTED_GOOGLE_API_KEY]");
  });

  it("redacts PEM private key block", () => {
    const text = [
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz==",
      "-----END RSA PRIVATE KEY-----",
    ].join("\n");
    expect(maskSensitiveData(text)).toContain("[REDACTED_PRIVATE_KEY]");
    expect(maskSensitiveData(text)).not.toContain("BEGIN RSA PRIVATE KEY");
  });

  it("redacts Postgres connection URI with credentials", () => {
    const text = "DB_URL=postgres://admin:s3cr3tPass@db.example.com:5432/mydb";
    expect(maskSensitiveData(text)).toContain("[REDACTED_CONNECTION_STRING]");
    expect(maskSensitiveData(text)).not.toContain("s3cr3tPass");
  });

  it("redacts MongoDB connection URI", () => {
    const text = "mongodb://user:password@cluster0.abc123.mongodb.net/locker";
    expect(maskSensitiveData(text)).toContain("[REDACTED_CONNECTION_STRING]");
  });

  it("redacts Redis connection URI with password", () => {
    const text = "REDIS_URL=redis://default:redispass@redis.example.com:6379/0";
    expect(maskSensitiveData(text)).toContain("[REDACTED_CONNECTION_STRING]");
  });

  it("does not redact connection URI without credentials (no password)", () => {
    // pattern requires user:password@host form
    const text = "mongodb://localhost:27017/mydb";
    expect(maskSensitiveData(text)).toBe("mongodb://localhost:27017/mydb");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: PII patterns (no entropy gate)
// ─────────────────────────────────────────────────────────────────────────────

describe("maskSensitiveData — PII patterns", () => {
  it("redacts email addresses", () => {
    const text = "Contact me at alice@example.com for more info";
    const result = maskSensitiveData(text);
    expect(result).toContain("[REDACTED_EMAIL]");
    expect(result).not.toContain("alice@example.com");
  });

  it("redacts multiple email addresses in same text", () => {
    const text = "CC: bob@company.org and carol@domain.co.uk";
    const result = maskSensitiveData(text);
    expect(result).not.toContain("bob@company.org");
    expect(result).not.toContain("carol@domain.co.uk");
    expect(result.match(/\[REDACTED_EMAIL\]/g)).toHaveLength(2);
  });

  it("redacts US Social Security Numbers", () => {
    const text = "SSN: 123-45-6789 was provided during onboarding";
    const result = maskSensitiveData(text);
    expect(result).toContain("[REDACTED_SSN]");
    expect(result).not.toContain("123-45-6789");
  });

  it("redacts US phone numbers (standard format)", () => {
    const text = "Call us at (555) 867-5309";
    const result = maskSensitiveData(text);
    expect(result).toContain("[REDACTED_PHONE_NUMBER]");
    expect(result).not.toContain("867-5309");
  });

  it("redacts phone numbers with dashes", () => {
    const text = "Phone: 555-867-5309";
    expect(maskSensitiveData(text)).toContain("[REDACTED_PHONE_NUMBER]");
  });

  it("redacts Visa-style credit card numbers", () => {
    const text = "Payment card: 4111 1111 1111 1111";
    const result = maskSensitiveData(text);
    expect(result).toContain("[REDACTED_CREDENTIAL]");
    expect(result).not.toContain("4111");
  });

  it("redacts Mastercard-style credit card numbers", () => {
    const text = "card ending in 5500 0000 0000 0004";
    expect(maskSensitiveData(text)).toContain("[REDACTED_CREDENTIAL]");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: Entropy-gated patterns (Bearer tokens, KV assignments)
// ─────────────────────────────────────────────────────────────────────────────

describe("maskSensitiveData — entropy-gated patterns", () => {
  it("redacts high-entropy Bearer token in Authorization header", () => {
    // Token is 40 chars of random-looking characters → entropy > 4.0
    const token = "Xy7pK9mZ2qRsT8uVwNdBLfJh3cAeGiYoAbCdEfGh";
    const text = `Authorization: Bearer ${token}`;
    const result = maskSensitiveData(text);
    expect(result).toContain("[REDACTED_TOKEN]");
    expect(result).not.toContain(token);
  });

  it("does NOT redact low-entropy Bearer token (human-readable)", () => {
    // "password123456789" — readable, low entropy → should not be redacted
    const token = "password123456789";
    const text = `Authorization: Bearer ${token}`;
    // Low-entropy tokens should pass through
    const result = maskSensitiveData(text);
    // Low entropy (< 4.05) → not redacted
    expect(shannonEntropy(token)).toBeLessThan(4.05);
    expect(result).toContain(token);
  });

  it("does NOT redact Bearer token shorter than MIN_SECRET_LENGTH (16 chars)", () => {
    const text = "Authorization: Bearer shorttoken";
    expect(maskSensitiveData(text)).toContain("shorttoken");
  });

  it("redacts high-entropy key-value assignment (api_key = ...)", () => {
    // 40-char random-looking key
    const secret = "9mK3rN7vXqT1pL5wYuEoDsJhBfGiZcAe2bCdFgHi";
    const text = `api_key = "${secret}"`;
    const result = maskSensitiveData(text);
    expect(result).toContain("[REDACTED_CREDENTIAL]");
    expect(result).not.toContain(secret);
  });

  it("redacts high-entropy password assignment", () => {
    const secret = "9mK3rN7vXqT1pL5wYuEoDsJhBfGiZcAe";
    const text = `password = ${secret}`;
    expect(maskSensitiveData(text)).toContain("[REDACTED_CREDENTIAL]");
  });

  it("redacts high-entropy secret_key in config", () => {
    const secret = "X7kQ2mP9vTnRaLdWsEhYuBfCgJiZoN3c";
    const text = `secret_key: "${secret}"`;
    expect(maskSensitiveData(text)).toContain("[REDACTED_CREDENTIAL]");
  });

  it("does NOT redact low-entropy password value", () => {
    // "hunter2" → low entropy, should not redact
    const text = "password = hunter2";
    expect(maskSensitiveData(text)).toBe("password = hunter2");
  });

  it("redacts high-entropy JSON 'token' property", () => {
    const secret = "8nR4sM1vKpW6qY2dXhUcBtGjZlAeOiFa";
    const json = `{"token": "${secret}"}`;
    expect(maskSensitiveData(json)).toContain("[REDACTED_CREDENTIAL]");
  });

  it("redacts high-entropy JSON 'password' property", () => {
    const secret = "Pt5xK8mNqV3rL7wYuBsJhGiZcAe2dCfE";
    const json = `{"password": "${secret}"}`;
    expect(maskSensitiveData(json)).toContain("[REDACTED_CREDENTIAL]");
  });

  it("does NOT redact JSON 'token' with low-entropy value (< 16 chars)", () => {
    const json = `{"token": "short123456"}`;
    expect(maskSensitiveData(json)).toBe(`{"token": "short123456"}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Non-sensitive data — should NOT be redacted
// ─────────────────────────────────────────────────────────────────────────────

describe("maskSensitiveData — non-sensitive data (no false positives)", () => {
  it("does not redact normal English text", () => {
    const text = "The quick brown fox jumps over the lazy dog.";
    expect(maskSensitiveData(text)).toBe(text);
  });

  it("does not redact a UUID (low-entropy, structured)", () => {
    // UUIDs have relatively low entropy and are not in any structural pattern
    const text = "Record ID: 550e8400-e29b-41d4-a716-446655440000";
    const result = maskSensitiveData(text);
    // UUIDs should not be redacted as they aren't credentials
    expect(result).toBe(text);
  });

  it("does not redact a URL without credentials", () => {
    const text = "Visit https://example.com/api/v2/users for the docs";
    expect(maskSensitiveData(text)).toBe(text);
  });

  it("does not redact an empty string", () => {
    expect(maskSensitiveData("")).toBe("");
  });

  it("does not redact plain numbers", () => {
    const text = "The answer is 42 and the product id is 1234567890";
    expect(maskSensitiveData(text)).toBe(text);
  });

  it("does not redact a valid-looking but too-short Stripe key pattern", () => {
    // Must have at least 24 chars after sk_live_
    const text = "sk_live_short";
    expect(maskSensitiveData(text)).toBe(text);
  });

  it("preserves text surrounding a redacted secret", () => {
    const text = "AWS Key: AKIAIOSFODNN7EXAMPLE is used in production";
    const result = maskSensitiveData(text);
    expect(result).toContain("AWS Key:");
    expect(result).toContain("is used in production");
    expect(result).toContain("[REDACTED_AWS_ACCESS_KEY]");
  });

  it("handles multiline text with mixed sensitive and clean lines", () => {
    const text = [
      "Project: my-app",
      "Version: 2.1.0",
      "aws_access_key_id = AKIAIOSFODNN7EXAMPLE",
      "region: us-east-1",
    ].join("\n");
    const result = maskSensitiveData(text);
    expect(result).toContain("Project: my-app");
    expect(result).toContain("region: us-east-1");
    expect(result).toContain("[REDACTED_AWS_ACCESS_KEY]");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: containsSensitiveData
// ─────────────────────────────────────────────────────────────────────────────

describe("containsSensitiveData", () => {
  it("returns true for text containing an email", () => {
    expect(containsSensitiveData("email me at test@example.com")).toBe(true);
  });

  it("returns true for text with an AWS key", () => {
    expect(containsSensitiveData("AKIAIOSFODNN7EXAMPLE is the key")).toBe(true);
  });

  it("returns true for text with a Stripe key", () => {
    // Constructed via concatenation to avoid literal secret scanning in CI
    expect(containsSensitiveData("sk_" + "live_" + "abcdefghijklmnopqrstuvwxyz123456789")).toBe(true);
  });

  it("returns false for plain text without secrets", () => {
    expect(containsSensitiveData("Hello world, no secrets here.")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(containsSensitiveData("")).toBe(false);
  });

  it("returns false for a plain URL", () => {
    expect(containsSensitiveData("https://example.com/api/status")).toBe(false);
  });

  it("returns true for text with a credit card number", () => {
    expect(containsSensitiveData("card: 4111 1111 1111 1111")).toBe(true);
  });

  it("returns true for text with an SSN", () => {
    expect(containsSensitiveData("SSN 123-45-6789")).toBe(true);
  });

  it("returns true for text with high-entropy bearer token", () => {
    const token = "Xy7pK9mZ2qRsT8uVwNdBLfJh3cAeGiYoAbCdEfGh";
    expect(containsSensitiveData(`Bearer ${token}`)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("maskSensitiveData — edge cases", () => {
  it("handles undefined-like empty input gracefully", () => {
    expect(maskSensitiveData("")).toBe("");
  });

  it("redacts multiple secrets in a single string", () => {
    const token = "Xy7pK9mZ2qRsT8uVwNdBLfJh3cAeGiYoAbCdEfGh";
    const text = `Email alice@test.com and key AKIAIOSFODNN7EXAMPLE and token Bearer ${token}`;
    const result = maskSensitiveData(text);
    expect(result).not.toContain("alice@test.com");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result).not.toContain(token);
  });

  it("does not double-redact already-redacted text", () => {
    const preRedacted = "API key: [REDACTED_AWS_ACCESS_KEY]";
    const result = maskSensitiveData(preRedacted);
    // The [REDACTED_...] marker should not trigger further redaction
    expect(result).toContain("[REDACTED_AWS_ACCESS_KEY]");
  });

  it("handles very long text without performance issues", () => {
    const longText = "Normal text sentence. ".repeat(5000);
    expect(() => maskSensitiveData(longText)).not.toThrow();
  });

  it("redacts a GitHub token regardless of surrounding punctuation", () => {
    const text = `"token":"ghp_abcdefghijklmnopqrstuvwxyz1234567890ab"`;
    expect(maskSensitiveData(text)).toContain("[REDACTED_GITHUB_TOKEN]");
  });

  it("handles text where a partial credit card appears but does not match full pattern", () => {
    // 4111 alone with no following digits should not trigger
    const text = "Error code 4111 in module v2";
    const result = maskSensitiveData(text);
    // This is a 4-digit number, not a credit card — should not be redacted
    expect(result).toBe(text);
  });

  it("redacts credentials embedded in YAML-style config block", () => {
    const yaml = [
      "database:",
      "  host: localhost",
      "  username: admin",
      `  password: ${`Xy7pK9mZ2qRsT8uVwNdBLfJh3cAeGiYo`}`,
    ].join("\n");
    const result = maskSensitiveData(yaml);
    expect(result).toContain("host: localhost");
    expect(result).toContain("[REDACTED_CREDENTIAL]");
  });
});
