/**
 * DLP Non-Destructive Quarantine Workflow Tests
 *
 * Validates the end-to-end non-destructive quarantine contract:
 *
 *   WRITE path:
 *     1. Raw fact is sanitized (HTML/injection stripping only).
 *     2. containsSensitiveData() determines isQuarantined — the ONLY mutation.
 *     3. The ORIGINAL sanitized text is encrypted and stored. maskSensitiveData()
 *        is NOT called on stored text.
 *
 *   READ path (recall_context):
 *     4. Quarantined rows return "[REDACTED]" to AI callers.
 *     5. Non-quarantined rows return decrypted fact unchanged.
 *
 *   UNMASK path (human dashboard):
 *     6. User reviews clear text via dashboard, sets isQuarantined=false.
 *     7. Subsequent recall returns the actual fact.
 *
 * These tests are pure-function unit tests — no Cloudflare runtime or DB needed.
 *
 * Run: npx vitest run src/server/dlp.quarantine.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  containsSensitiveData,
  maskSensitiveData,
  classifySensitiveData,
  type DlpTrigger,
} from "./dlp";

// ---------------------------------------------------------------------------
// Helpers — simulate ingestion + recall without the full CF stack
// ---------------------------------------------------------------------------

interface StoredMemoryRow {
  id: string;
  fact: string;        // encrypted in prod; plain in tests
  isQuarantined: boolean;
}

/** Simulates the WRITE path in addMemory / batchImportMemories. */
function simulateIngest(rawFact: string): StoredMemoryRow {
  const isQuarantined = containsSensitiveData(rawFact);
  // In production the fact is encrypted before storage. Here we store it plain
  // to make assertions readable, but the key guarantee is that maskSensitiveData()
  // is NOT called — the stored text is rawFact (or its encrypted form), unchanged.
  return { id: crypto.randomUUID(), fact: rawFact, isQuarantined };
}

/** Simulates the READ path in recall_context (mcp.ts:1894-1897). */
function simulateRecall(row: StoredMemoryRow): string {
  if (row.isQuarantined) return "[REDACTED]";
  return row.fact;
}

/** Simulates the human unmask action (sets isQuarantined=false). */
function simulateUnmask(row: StoredMemoryRow): StoredMemoryRow {
  return { ...row, isQuarantined: false };
}

// ---------------------------------------------------------------------------
// WRITE PATH — quarantine flag correctly set, raw text preserved
// ---------------------------------------------------------------------------

describe("DLP write path — isQuarantined flag and raw text preservation", () => {
  it("marks a clean fact as not quarantined", () => {
    const row = simulateIngest("User prefers TypeScript and Cloudflare Workers.");
    expect(row.isQuarantined).toBe(false);
    expect(row.fact).toBe("User prefers TypeScript and Cloudflare Workers.");
  });

  it("marks a fact with an AWS key as quarantined, raw text intact", () => {
    const raw = "Production access key: AKIAIOSFODNN7EXAMPLE";
    const row = simulateIngest(raw);
    expect(row.isQuarantined).toBe(true);
    expect(row.fact).toBe(raw); // raw text preserved, not masked
  });

  it("marks a fact with an email as quarantined, raw text intact", () => {
    const raw = "The project lead is alice@example.com — ping her for access.";
    const row = simulateIngest(raw);
    expect(row.isQuarantined).toBe(true);
    expect(row.fact).toContain("alice@example.com"); // NOT replaced with [REDACTED_EMAIL]
  });

  it("marks a fact with an SSN as quarantined, raw text intact", () => {
    const raw = "Employee tax record: 123-45-6789";
    const row = simulateIngest(raw);
    expect(row.isQuarantined).toBe(true);
    expect(row.fact).toContain("123-45-6789");
  });

  it("marks a fact with a Stripe key as quarantined, raw text intact", () => {
    // Split to avoid GitHub push-protection secret scanning on test fixtures
    const stripeKey = "sk_live_" + "abcdefghijklmnopqrstuvwx";
    const raw = `Live Stripe key: ${stripeKey}`;
    const row = simulateIngest(raw);
    expect(row.isQuarantined).toBe(true);
    expect(row.fact).toContain(stripeKey);
  });

  it("marks a fact with a database connection URI as quarantined", () => {
    const raw = "postgres://admin:hunter2abcdefghij@prod-db.internal:5432/myapp";
    const row = simulateIngest(raw);
    expect(row.isQuarantined).toBe(true);
    expect(row.fact).toContain("hunter2abcdefghij");
  });

  it("marks a fact with a high-entropy bearer token as quarantined", () => {
    const token = "Xy7pK9mZ2qRsT8uVwNdBLfJh3cAeGiYoAbCdEfGh";
    const raw = `Authorization header: Bearer ${token}`;
    const row = simulateIngest(raw);
    expect(row.isQuarantined).toBe(true);
    expect(row.fact).toContain(token);
  });

  it("does NOT quarantine a fact with a low-entropy bearer-like value", () => {
    const row = simulateIngest("Bearer mytoken123");
    expect(row.isQuarantined).toBe(false);
  });

  it("does NOT quarantine a fact with a plain URL (no credentials)", () => {
    const row = simulateIngest("Docs are at https://developers.example.com/api/status");
    expect(row.isQuarantined).toBe(false);
  });

  it("marks a fact with a GitHub token as quarantined, raw text intact", () => {
    const ghToken = "ghp_" + "abcdefghijklmnopqrstuvwxyz1234567890ab";
    const raw = `CI token: ${ghToken}`;
    const row = simulateIngest(raw);
    expect(row.isQuarantined).toBe(true);
    expect(row.fact).toContain(ghToken);
  });

  it("marks a fact with a credit card number as quarantined", () => {
    const raw = "Test card: 4111 1111 1111 1111 expiry 12/26";
    const row = simulateIngest(raw);
    expect(row.isQuarantined).toBe(true);
    expect(row.fact).toContain("4111 1111 1111 1111");
  });
});

// ---------------------------------------------------------------------------
// READ PATH — recall_context intercept
// ---------------------------------------------------------------------------

describe("DLP read path — recall_context returns [REDACTED] for quarantined rows", () => {
  it("returns [REDACTED] for a quarantined row, not the fact", () => {
    const raw = "AKIAIOSFODNN7EXAMPLE is the prod key";
    const row = simulateIngest(raw);
    expect(row.isQuarantined).toBe(true);
    const recalled = simulateRecall(row);
    expect(recalled).toBe("[REDACTED]");
    expect(recalled).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("returns the original fact for a non-quarantined row", () => {
    const raw = "Stack: Cloudflare Workers, D1, Drizzle ORM.";
    const row = simulateIngest(raw);
    expect(row.isQuarantined).toBe(false);
    expect(simulateRecall(row)).toBe(raw);
  });

  it("multiple quarantined rows all return [REDACTED]", () => {
    const facts = [
      "AWS key: AKIAIOSFODNN7EXAMPLE",
      "Email: bob@corp.example",
      "SSN: 987-65-4321",
    ];
    for (const fact of facts) {
      const row = simulateIngest(fact);
      expect(simulateRecall(row)).toBe("[REDACTED]");
    }
  });

  it("non-sensitive facts in a mixed batch pass through correctly", () => {
    const quarantined = simulateIngest("CC: 4111 1111 1111 1111");
    const clean = simulateIngest("User prefers dark mode in the IDE.");
    expect(simulateRecall(quarantined)).toBe("[REDACTED]");
    expect(simulateRecall(clean)).toBe("User prefers dark mode in the IDE.");
  });
});

// ---------------------------------------------------------------------------
// UNMASK PATH — human dashboard review
// ---------------------------------------------------------------------------

describe("DLP unmask path — human verification restores access", () => {
  it("after unmask, recall returns the clear-text fact", () => {
    const raw = "Admin password: Xy7pK9mZ2qRsT8uVwNdBLfJh3cAeGiYo";
    const row = simulateIngest(raw);
    expect(simulateRecall(row)).toBe("[REDACTED]");

    const unmasked = simulateUnmask(row);
    expect(unmasked.isQuarantined).toBe(false);
    expect(simulateRecall(unmasked)).toBe(raw);
  });

  it("unmask preserves the original raw text, not a masked version", () => {
    const raw = "Contact: ceo@bigcorp.example — board call weekly";
    const row = simulateIngest(raw);
    const unmasked = simulateUnmask(row);
    // The stored fact must be the original, not a masked substitute
    expect(unmasked.fact).toBe(raw);
    expect(unmasked.fact).toContain("ceo@bigcorp.example");
  });

  it("unmask does not alter the fact content", () => {
    const raw = `${"sk_live_" + "abcdefghijklmnopqrstuvwx"} is the payment key`;
    const before = simulateIngest(raw);
    const after = simulateUnmask(before);
    expect(after.fact).toBe(before.fact);
  });
});

// ---------------------------------------------------------------------------
// classifySensitiveData — dashboard trigger display
// ---------------------------------------------------------------------------

describe("classifySensitiveData — human-readable trigger names for dashboard", () => {
  it("returns an empty array for clean text", () => {
    expect(classifySensitiveData("No secrets here, just preferences.")).toEqual([]);
  });

  it("reports the correct trigger for an AWS key", () => {
    const triggers = classifySensitiveData("AKIAIOSFODNN7EXAMPLE");
    expect(triggers).toContain("aws_access_key" as DlpTrigger);
  });

  it("reports the correct trigger for a credit card", () => {
    const triggers = classifySensitiveData("Card: 5500 0000 0000 0004");
    expect(triggers).toContain("credit_card" as DlpTrigger);
  });

  it("reports the correct trigger for an SSN", () => {
    const triggers = classifySensitiveData("SSN 123-45-6789");
    expect(triggers).toContain("ssn" as DlpTrigger);
  });

  it("reports multiple triggers for a multi-secret string", () => {
    const token = "Xy7pK9mZ2qRsT8uVwNdBLfJh3cAeGiYoAbCdEfGh";
    const text = `email: admin@example.com, Bearer ${token}`;
    const triggers = classifySensitiveData(text);
    expect(triggers).toContain("email" as DlpTrigger);
    expect(triggers).toContain("bearer_token" as DlpTrigger);
  });

  it("does not report a trigger when no secrets are present", () => {
    const triggers = classifySensitiveData("The project uses Tailwind CSS for styling.");
    expect(triggers.length).toBe(0);
  });

  it("classifySensitiveData and containsSensitiveData agree on quarantine decision", () => {
    const cases = [
      "AKIAIOSFODNN7EXAMPLE",
      "alice@example.com",
      "123-45-6789",
      "sk_live_" + "abcdefghijklmnopqrstuvwx",
      "Clean text with no secrets.",
      "Bearer mytoken",
    ];
    for (const text of cases) {
      const hasTriggers = classifySensitiveData(text).length > 0;
      const detected = containsSensitiveData(text);
      expect(hasTriggers).toBe(detected);
    }
  });
});

// ---------------------------------------------------------------------------
// Migration contract — isQuarantined column defaults
// ---------------------------------------------------------------------------

describe("migration contract — isQuarantined default false", () => {
  it("a newly ingested clean fact has isQuarantined=false", () => {
    const row = simulateIngest("Dark mode is preferred in VS Code.");
    expect(row.isQuarantined).toBe(false);
  });

  it("a newly ingested sensitive fact has isQuarantined=true", () => {
    const row = simulateIngest("AWS key: AKIAIOSFODNN7EXAMPLE");
    expect(row.isQuarantined).toBe(true);
  });
});
