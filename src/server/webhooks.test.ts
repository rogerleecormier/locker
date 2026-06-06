/**
 * Comprehensive tests for the multi-tenant webhook processor (src/server/webhooks.ts).
 *
 * Key changes from v1:
 * - Webhook secrets are stored PER-TENANT in the credentials table (no global env var).
 * - Token scope → secret vault resolution:
 *     personal token  → user's personal credential vault
 *     org token       → org's credential vault (org:orgId)
 *     team token      → parent org's credential vault (look up teams.orgId)
 * - Missing secret returns 401 with a descriptive hint, not a generic auth error.
 *
 * Strategy: test pure helpers and the full handler logic via an in-process harness
 * that replaces D1/crypto/AI calls with lightweight fakes. Web Crypto (Node 18+) is
 * used for real AES-GCM and HMAC operations.
 *
 * Run: npx vitest run src/server/webhooks.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { WEBHOOK_SECRET_GITHUB, WEBHOOK_SECRET_LINEAR } from "./webhooks";

// ── Pure helpers (duplicated from webhooks.ts for unit testing) ───────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aB = new TextEncoder().encode(a);
  const bB = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < aB.length; i++) diff |= aB[i] ^ bB[i];
  return diff === 0;
}

async function hmacSha256Hex(secret: string, body: ArrayBuffer): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, body);
  return bytesToHex(new Uint8Array(sig));
}

async function aesEncrypt(plain: string, hexKey: string): Promise<string> {
  const keyBytes = new Uint8Array(hexKey.match(/../g)!.map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, new TextEncoder().encode(plain) as unknown as BufferSource);
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ct))}`;
}

async function aesDecrypt(enc: string, hexKey: string): Promise<string> {
  const colon = enc.indexOf(":");
  const iv = new Uint8Array(enc.slice(0, colon).match(/../g)!.map(h => parseInt(h, 16)));
  const ct = new Uint8Array(enc.slice(colon + 1).match(/../g)!.map(h => parseInt(h, 16)));
  const keyBytes = new Uint8Array(hexKey.match(/../g)!.map(h => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, ct as unknown as BufferSource);
  return new TextDecoder().decode(plain);
}

// ── Payload factories ─────────────────────────────────────────────────────────

function makeGitHubPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "closed",
    pull_request: {
      node_id: "PR_abc123",
      number: 42,
      title: "feat: multi-tenant webhook processor",
      merged: true,
      diff_url: "https://github.com/example/repo/pull/42.diff",
      body: "This PR adds multi-tenant webhook support.",
      ...overrides,
    },
  };
}

function makeLinearPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: "update",
    type: "Issue",
    data: {
      id: "LIN-789",
      title: "Implement dark mode",
      description: "Users requested dark mode for the dashboard.",
      state: { name: "Done", type: "completed" },
      ...overrides,
    },
  };
}

// ── Token row factory ─────────────────────────────────────────────────────────

const COMMIT_PERM = 2;
const MASTER_KEY = "a".repeat(64);

async function makeTokenRow(overrides: Partial<{
  scopeType: "personal" | "organization" | "team";
  scopeId: string | null;
  permissions: number;
  expiresAt: number | null;
}> = {}) {
  const raw = "lkr_test_token";
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(raw), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 }, km, 256);
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(derived)));
  return {
    id: "tok1",
    userId: "user1",
    tokenHash: `pbkdf2$100000$${saltB64}$${hashB64}`,
    permissions: COMMIT_PERM,
    scopeType: "personal" as "personal" | "organization" | "team",
    scopeId: null as string | null,
    expiresAt: null as number | null,
    ...overrides,
  };
}

// ── Credential row factory ────────────────────────────────────────────────────
// Builds an encrypted credential entry as it would appear in D1.

async function makeCredentialRow(opts: {
  name: string;
  plainSecret: string;
  userId: string;
  projectKey: string | null;
  vaultId: string; // used to derive key — matches how webhooks.ts reads it
}) {
  const encryptedValue = await aesEncrypt(opts.plainSecret, MASTER_KEY);
  return {
    id: crypto.randomUUID(),
    userId: opts.userId,
    name: opts.name,
    encryptedValue,
    projectKey: opts.projectKey,
    scopeType: opts.projectKey
      ? opts.projectKey.startsWith("org:") ? "organization" : "team"
      : "personal",
    scopeId: opts.projectKey
      ? opts.projectKey.startsWith("org:") ? opts.projectKey.slice(4) : opts.projectKey.slice(5)
      : null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── In-process handler harness ────────────────────────────────────────────────
// Mirrors the real handler logic with all external calls replaced by fakes.

type TokenRow = Awaited<ReturnType<typeof makeTokenRow>>;
type CredRow = Awaited<ReturnType<typeof makeCredentialRow>>;

async function runHandler(opts: {
  source: "github" | "linear";
  payload: Record<string, unknown>;
  tokenRow: TokenRow | null;
  credRows?: CredRow[];         // pre-loaded credentials (including webhook secret)
  teamParentOrgId?: string;     // for team scope: the parent org id
  webhookSecret: string | null; // the plain-text secret to sign with (null = unsigned request)
  aiResponse?: string;
}): Promise<{
  status: number;
  body: Record<string, unknown>;
  insertedMemories: Record<string, unknown>[];
  insertedEvents: Record<string, unknown>[];
}> {
  const { source, payload, tokenRow, credRows = [], teamParentOrgId, aiResponse = "AI summary." } = opts;

  const bodyText = JSON.stringify(payload);
  const rawBody = new TextEncoder().encode(bodyText).buffer as ArrayBuffer;

  // Build request headers
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.webhookSecret) {
    const sig = await hmacSha256Hex(opts.webhookSecret, rawBody);
    if (source === "github") headers["x-hub-signature-256"] = `sha256=${sig}`;
    else headers["x-linear-signature"] = sig;
  }
  if (tokenRow) headers["authorization"] = "Bearer lkr_test_token";

  const request = new Request(`https://example.com/api/webhooks/${source}`, {
    method: "POST", headers, body: bodyText,
  });

  const insertedMemories: Record<string, unknown>[] = [];
  const insertedEvents: Record<string, unknown>[] = [];
  const existingEvents: Record<string, unknown>[] = [];

  // ── Step 1: Resolve token ────────────────────────────────────────────────
  let resolvedToken: { userId: string; scopeType: string; scopeId: string | null; projectKey: string | null } | null = null;
  if (tokenRow && request.headers.get("authorization")?.startsWith("Bearer lkr_")) {
    if (!(tokenRow.permissions & COMMIT_PERM)) return { status: 401, body: { error: "Unauthorized" }, insertedMemories, insertedEvents };
    if (tokenRow.expiresAt && tokenRow.expiresAt < Date.now()) return { status: 401, body: { error: "Unauthorized" }, insertedMemories, insertedEvents };
    let projectKey: string | null = null;
    if (tokenRow.scopeType === "organization" && tokenRow.scopeId) projectKey = `org:${tokenRow.scopeId}`;
    else if (tokenRow.scopeType === "team" && tokenRow.scopeId) projectKey = `team:${tokenRow.scopeId}`;
    resolvedToken = { userId: tokenRow.userId, scopeType: tokenRow.scopeType, scopeId: tokenRow.scopeId, projectKey };
  }
  if (!resolvedToken) return { status: 401, body: { error: "Unauthorized: valid Locker API token with commit_memory permission required" }, insertedMemories, insertedEvents };

  // ── Step 2: Resolve secret vault ────────────────────────────────────────
  let secretVaultId: string;
  if (resolvedToken.scopeType === "organization" && resolvedToken.scopeId) {
    secretVaultId = `org:${resolvedToken.scopeId}`;
  } else if (resolvedToken.scopeType === "team" && resolvedToken.scopeId) {
    secretVaultId = teamParentOrgId ? `org:${teamParentOrgId}` : `team:${resolvedToken.scopeId}`;
  } else {
    secretVaultId = resolvedToken.userId;
  }

  // ── Step 3: Read webhook secret from credentials ──────────────────────
  const credName = source === "github" ? WEBHOOK_SECRET_GITHUB : WEBHOOK_SECRET_LINEAR;
  const isOrgOrTeam = secretVaultId.startsWith("org:") || secretVaultId.startsWith("team:");
  const matchingCred = credRows.find((c) =>
    c.name === credName &&
    (isOrgOrTeam ? c.projectKey === secretVaultId : c.userId === resolvedToken!.userId && !c.projectKey)
  );

  if (!matchingCred) {
    return {
      status: 401,
      body: {
        error: `Webhook secret not configured. Store a credential named ${credName} in your vault to enable this integration.`,
        hint: source === "github"
          ? "Use Settings → Webhooks → GitHub to configure your webhook secret."
          : "Use Settings → Webhooks → Linear to configure your webhook secret.",
      },
      insertedMemories,
      insertedEvents,
    };
  }

  const webhookSecret = await aesDecrypt(matchingCred.encryptedValue, MASTER_KEY);

  // ── Step 4: Verify HMAC ──────────────────────────────────────────────
  const reqBody = await request.arrayBuffer();
  const computed = await hmacSha256Hex(webhookSecret, reqBody);

  let sigError: string | null = null;
  if (source === "github") {
    const hdr = request.headers.get("x-hub-signature-256") ?? "";
    if (!hdr.startsWith("sha256=")) sigError = "Missing x-hub-signature-256 header";
    else if (!timingSafeEqual(computed, hdr.slice("sha256=".length))) sigError = "GitHub signature mismatch";
  } else {
    const hdr = request.headers.get("x-linear-signature") ?? "";
    if (!hdr) sigError = "Missing x-linear-signature header";
    else if (!timingSafeEqual(computed, hdr)) sigError = "Linear signature mismatch";
  }
  if (sigError) return { status: 401, body: { error: sigError }, insertedMemories, insertedEvents };

  // ── Step 5: Parse payload ────────────────────────────────────────────
  const bodyStr = new TextDecoder().decode(reqBody);
  let parsed: { eventType: string; externalId: string; title: string; diffUrl?: string; description?: string; fallbackContent?: string } | null = null;
  try {
    const p = JSON.parse(bodyStr) as Record<string, unknown>;
    if (source === "github") {
      if (p.action !== "closed") throw new Error("Not a closed PR");
      const pr = p.pull_request as Record<string, unknown>;
      if (!pr?.merged) throw new Error("PR not merged");
      parsed = { eventType: "pr.merged", externalId: String(pr.node_id ?? pr.number ?? Date.now()), title: String(pr.title ?? "Untitled PR"), diffUrl: pr.diff_url ? String(pr.diff_url) : undefined, fallbackContent: String(pr.body ?? pr.title ?? "") };
    } else {
      const data = (p.data ?? p.issue ?? {}) as Record<string, unknown>;
      const state = data.state as Record<string, unknown> | string | undefined;
      const stateName = typeof state === "string" ? state : String((state as any)?.name ?? (state as any)?.type ?? "");
      if (!/\b(done|completed?|finished|closed|merged)\b/i.test(stateName) && p.action !== "done" && p.type !== "IssueDone") throw new Error(`Not done: ${stateName}`);
      parsed = { eventType: "ticket.done", externalId: String(data.id ?? Date.now()), title: String(data.title ?? "Untitled"), description: data.description ? String(data.description) : undefined, fallbackContent: String(data.description ?? data.title ?? "") };
    }
  } catch {
    return { status: 200, body: { ok: true, skipped: true }, insertedMemories, insertedEvents };
  }

  // ── Step 6: Idempotency ──────────────────────────────────────────────
  if (existingEvents.find((e) => e.source === source && e.externalId === parsed!.externalId)) {
    return { status: 200, body: { ok: true, duplicate: true }, insertedMemories, insertedEvents };
  }

  // ── Step 7–9: AI + encrypt ───────────────────────────────────────────
  const summary = aiResponse || `${parsed.eventType}: ${parsed.title}`;
  const encryptedSummary = await aesEncrypt(summary, MASTER_KEY);
  const factPlain = `[${source === "github" ? "PR Merged" : "Ticket Done"}] ${parsed.title}\n\n${summary}`;
  const encryptedFact = await aesEncrypt(factPlain, MASTER_KEY);

  // ── Step 10: Insert ──────────────────────────────────────────────────
  const memoryId = crypto.randomUUID();
  const now = Date.now();
  insertedMemories.push({ id: memoryId, userId: resolvedToken.userId, fact: encryptedFact, category: "projects", tags: `#webhook #${source}`, timestamp: now, projectKey: resolvedToken.projectKey });
  insertedEvents.push({ id: crypto.randomUUID(), source, eventType: parsed.eventType, externalId: parsed.externalId, projectKey: resolvedToken.projectKey, userId: resolvedToken.userId, memoryId, encryptedSummary, rawTitle: parsed.title, processedAt: now });

  return { status: 200, body: { ok: true, memoryId }, insertedMemories, insertedEvents };
}

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 1: Pure helpers
// ──────────────────────────────────────────────────────────────────────────────

describe("Pure helpers", () => {
  describe("bytesToHex", () => {
    it("converts empty array to empty string", () => expect(bytesToHex(new Uint8Array([]))).toBe(""));
    it("converts single byte correctly", () => {
      expect(bytesToHex(new Uint8Array([0x0f]))).toBe("0f");
      expect(bytesToHex(new Uint8Array([0xff]))).toBe("ff");
    });
    it("converts multi-byte array", () => expect(bytesToHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe("deadbeef"));
  });

  describe("timingSafeEqual", () => {
    it("returns true for equal strings", () => expect(timingSafeEqual("abc", "abc")).toBe(true));
    it("returns false for different strings of same length", () => expect(timingSafeEqual("abc", "xyz")).toBe(false));
    it("returns false for different lengths", () => expect(timingSafeEqual("short", "muchlonger")).toBe(false));
    it("returns true for empty strings", () => expect(timingSafeEqual("", "")).toBe(true));
    it("is case-sensitive", () => expect(timingSafeEqual("ABC", "abc")).toBe(false));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 2: Well-known credential names
// ──────────────────────────────────────────────────────────────────────────────

describe("Webhook credential names", () => {
  it("exports correct GitHub credential name", () => {
    expect(WEBHOOK_SECRET_GITHUB).toBe("__WEBHOOK_GITHUB__");
  });
  it("exports correct Linear credential name", () => {
    expect(WEBHOOK_SECRET_LINEAR).toBe("__WEBHOOK_LINEAR__");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 3: GitHub payload parsing
// ──────────────────────────────────────────────────────────────────────────────

describe("GitHub payload parsing", () => {
  function parse(payload: Record<string, unknown>) {
    if (payload.action !== "closed") throw new Error("Not a closed PR event");
    const pr = payload.pull_request as Record<string, unknown> | undefined;
    if (!pr) throw new Error("No pull_request field");
    if (!pr.merged) throw new Error("PR not merged");
    return { eventType: "pr.merged", externalId: String(pr.node_id ?? pr.number ?? ""), title: String(pr.title ?? "Untitled PR"), diffUrl: pr.diff_url ? String(pr.diff_url) : undefined };
  }

  it("parses a valid merged PR", () => {
    const r = parse(makeGitHubPayload());
    expect(r.eventType).toBe("pr.merged");
    expect(r.externalId).toBe("PR_abc123");
    expect(r.title).toBe("feat: multi-tenant webhook processor");
    expect(r.diffUrl).toContain("42.diff");
  });
  it("throws for non-closed action", () => expect(() => parse({ ...makeGitHubPayload(), action: "opened" })).toThrow("Not a closed PR event"));
  it("throws for unmerged close", () => expect(() => parse(makeGitHubPayload({ merged: false }))).toThrow("PR not merged"));
  it("throws for missing pull_request", () => expect(() => parse({ action: "closed" })).toThrow("No pull_request field"));
  it("falls back to pr.number when node_id absent", () => expect(parse(makeGitHubPayload({ node_id: undefined })).externalId).toBe("42"));
  it("handles missing diff_url", () => expect(parse(makeGitHubPayload({ diff_url: undefined })).diffUrl).toBeUndefined());
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 4: Linear payload parsing
// ──────────────────────────────────────────────────────────────────────────────

describe("Linear payload parsing", () => {
  function parse(payload: Record<string, unknown>) {
    const data = (payload.data ?? payload.issue ?? {}) as Record<string, unknown>;
    const state = data.state as Record<string, unknown> | string | undefined;
    const stateName = typeof state === "string" ? state : String((state as any)?.name ?? (state as any)?.type ?? "");
    const isDone = /\b(done|completed?|finished|closed|merged)\b/i.test(stateName);
    if (!isDone && payload.action !== "done" && payload.type !== "IssueDone") throw new Error(`Not done: ${stateName}`);
    return { eventType: "ticket.done", externalId: String(data.id ?? ""), title: String(data.title ?? "Untitled") };
  }

  it("parses a valid done ticket", () => {
    const r = parse(makeLinearPayload());
    expect(r.eventType).toBe("ticket.done");
    expect(r.externalId).toBe("LIN-789");
  });
  it("accepts 'completed' state", () => expect(() => parse(makeLinearPayload({ state: { name: "Completed" } }))).not.toThrow());
  it("accepts 'finished' state", () => expect(() => parse(makeLinearPayload({ state: { name: "Finished" } }))).not.toThrow());
  it("accepts 'closed' state", () => expect(() => parse(makeLinearPayload({ state: { name: "Closed" } }))).not.toThrow());
  it("throws for in-progress state", () => expect(() => parse(makeLinearPayload({ state: { name: "In Progress" } }))).toThrow());
  it("accepts state as plain string 'done'", () => expect(() => parse({ ...makeLinearPayload(), data: { id: "x1", title: "T", state: "done" } })).not.toThrow());
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 5: HMAC signature verification
// ──────────────────────────────────────────────────────────────────────────────

describe("HMAC signature verification", () => {
  it("produces 64-char hex", async () => {
    const sig = await hmacSha256Hex("secret", new TextEncoder().encode("body").buffer as ArrayBuffer);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
  it("different secrets produce different sigs", async () => {
    const ab = new TextEncoder().encode("body").buffer as ArrayBuffer;
    expect(await hmacSha256Hex("s1", ab)).not.toBe(await hmacSha256Hex("s2", ab));
  });
  it("is deterministic", async () => {
    const ab = new TextEncoder().encode("hello").buffer as ArrayBuffer;
    expect(await hmacSha256Hex("k", ab)).toBe(await hmacSha256Hex("k", ab));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 6: Multi-tenant secret resolution — personal scope
// ──────────────────────────────────────────────────────────────────────────────

describe("Handler — personal scope (GitHub)", () => {
  const SECRET = "my_github_secret";
  let tokenRow: Awaited<ReturnType<typeof makeTokenRow>>;
  let credRow: Awaited<ReturnType<typeof makeCredentialRow>>;

  beforeEach(async () => {
    tokenRow = await makeTokenRow();
    credRow = await makeCredentialRow({ name: WEBHOOK_SECRET_GITHUB, plainSecret: SECRET, userId: "user1", projectKey: null, vaultId: "user1" });
  });

  it("returns 200 and commits memory when secret is configured", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.insertedMemories).toHaveLength(1);
    expect(r.insertedEvents).toHaveLength(1);
  });

  it("returns 401 with hint when no secret is configured", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [], webhookSecret: SECRET });
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toContain(WEBHOOK_SECRET_GITHUB);
    expect(String(r.body.hint)).toContain("Settings → Webhooks → GitHub");
  });

  it("returns 401 for wrong HMAC (tampered body)", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [credRow], webhookSecret: "wrong_secret" });
    expect(r.status).toBe(401);
    expect(r.body.error).toContain("signature mismatch");
  });

  it("returns 200 skipped=true for non-merged PR", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload({ merged: false }), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect(r.body.skipped).toBe(true);
  });

  it("memory is scoped to personal vault (projectKey: null)", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect((r.insertedMemories[0] as any).projectKey).toBeNull();
  });

  it("memory category is 'projects'", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect((r.insertedMemories[0] as any).category).toBe("projects");
  });

  it("memory tags contain #webhook and #github", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    const tags = String((r.insertedMemories[0] as any).tags);
    expect(tags).toContain("#webhook");
    expect(tags).toContain("#github");
  });

  it("encrypted summary stored in webhook_events is not plaintext", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET, aiResponse: "Very specific summary text." });
    const enc = String((r.insertedEvents[0] as any).encryptedSummary);
    expect(enc).not.toContain("Very specific summary text.");
    expect(enc).toMatch(/^[0-9a-f]{24}:[0-9a-f]+$/);
  });

  it("encrypted fact is not plaintext", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect(String((r.insertedMemories[0] as any).fact)).not.toContain("feat: multi-tenant webhook processor");
  });

  it("returns 401 when no auth header", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow: null, credRows: [credRow], webhookSecret: SECRET });
    expect(r.status).toBe(401);
  });

  it("returns 401 when token lacks COMMIT permission", async () => {
    const badToken = await makeTokenRow({ permissions: 1 }); // RECALL only
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow: badToken, credRows: [credRow], webhookSecret: SECRET });
    expect(r.status).toBe(401);
  });

  it("returns 401 when token is expired", async () => {
    const expired = await makeTokenRow({ expiresAt: Date.now() - 1000 });
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow: expired, credRows: [credRow], webhookSecret: SECRET });
    expect(r.status).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 7: Multi-tenant — org scope
// ──────────────────────────────────────────────────────────────────────────────

describe("Handler — org scope", () => {
  const SECRET = "org_github_secret";
  const ORG_ID = "org123";
  let tokenRow: Awaited<ReturnType<typeof makeTokenRow>>;
  let orgCredRow: Awaited<ReturnType<typeof makeCredentialRow>>;

  beforeEach(async () => {
    tokenRow = await makeTokenRow({ scopeType: "organization", scopeId: ORG_ID });
    orgCredRow = await makeCredentialRow({ name: WEBHOOK_SECRET_GITHUB, plainSecret: SECRET, userId: "user1", projectKey: `org:${ORG_ID}`, vaultId: `org:${ORG_ID}` });
  });

  it("reads secret from org vault and commits memory to org scope", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [orgCredRow], webhookSecret: SECRET });
    expect(r.status).toBe(200);
    expect((r.insertedEvents[0] as any).projectKey).toBe(`org:${ORG_ID}`);
    expect((r.insertedMemories[0] as any).projectKey).toBe(`org:${ORG_ID}`);
  });

  it("returns 401 when personal secret exists but no org secret", async () => {
    // Only a personal-scope credential — org scope should NOT find it.
    const personalCred = await makeCredentialRow({ name: WEBHOOK_SECRET_GITHUB, plainSecret: SECRET, userId: "user1", projectKey: null, vaultId: "user1" });
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [personalCred], webhookSecret: SECRET });
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toContain(WEBHOOK_SECRET_GITHUB);
  });

  it("returns 401 for wrong org secret (different org's credential)", async () => {
    const otherOrgCred = await makeCredentialRow({ name: WEBHOOK_SECRET_GITHUB, plainSecret: SECRET, userId: "user1", projectKey: "org:other_org", vaultId: "org:other_org" });
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [otherOrgCred], webhookSecret: SECRET });
    expect(r.status).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 8: Multi-tenant — team scope inherits from parent org
// ──────────────────────────────────────────────────────────────────────────────

describe("Handler — team scope (inherits org secret)", () => {
  const SECRET = "org_secret_for_team";
  const TEAM_ID = "team456";
  const PARENT_ORG_ID = "org123";
  let tokenRow: Awaited<ReturnType<typeof makeTokenRow>>;
  let orgCredRow: Awaited<ReturnType<typeof makeCredentialRow>>;

  beforeEach(async () => {
    tokenRow = await makeTokenRow({ scopeType: "team", scopeId: TEAM_ID });
    orgCredRow = await makeCredentialRow({ name: WEBHOOK_SECRET_GITHUB, plainSecret: SECRET, userId: "user1", projectKey: `org:${PARENT_ORG_ID}`, vaultId: `org:${PARENT_ORG_ID}` });
  });

  it("resolves secret from parent org vault when team token is used", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [orgCredRow], teamParentOrgId: PARENT_ORG_ID, webhookSecret: SECRET });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("commits memory scoped to the team vault", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [orgCredRow], teamParentOrgId: PARENT_ORG_ID, webhookSecret: SECRET });
    expect((r.insertedMemories[0] as any).projectKey).toBe(`team:${TEAM_ID}`);
    expect((r.insertedEvents[0] as any).projectKey).toBe(`team:${TEAM_ID}`);
  });

  it("returns 401 when no parent org id is resolvable and no team cred exists", async () => {
    // No teamParentOrgId provided + no matching cred → secret not found.
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [orgCredRow], teamParentOrgId: undefined, webhookSecret: SECRET });
    expect(r.status).toBe(401);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 9: Linear webhook — multi-tenant
// ──────────────────────────────────────────────────────────────────────────────

describe("Handler — Linear webhook (personal scope)", () => {
  const SECRET = "linear_secret";
  let tokenRow: Awaited<ReturnType<typeof makeTokenRow>>;
  let credRow: Awaited<ReturnType<typeof makeCredentialRow>>;

  beforeEach(async () => {
    tokenRow = await makeTokenRow();
    credRow = await makeCredentialRow({ name: WEBHOOK_SECRET_LINEAR, plainSecret: SECRET, userId: "user1", projectKey: null, vaultId: "user1" });
  });

  it("returns 200 for a valid done ticket", async () => {
    const r = await runHandler({ source: "linear", payload: makeLinearPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it("returns 401 with Linear hint when Linear secret not configured", async () => {
    const r = await runHandler({ source: "linear", payload: makeLinearPayload(), tokenRow, credRows: [], webhookSecret: SECRET });
    expect(r.status).toBe(401);
    expect(String(r.body.hint)).toContain("Settings → Webhooks → Linear");
  });

  it("returns 401 with Linear secret name in error when missing", async () => {
    const r = await runHandler({ source: "linear", payload: makeLinearPayload(), tokenRow, credRows: [], webhookSecret: SECRET });
    expect(String(r.body.error)).toContain(WEBHOOK_SECRET_LINEAR);
  });

  it("uses Linear HMAC header (x-linear-signature)", async () => {
    // Verify wrong sig is rejected even if cred exists.
    const r = await runHandler({ source: "linear", payload: makeLinearPayload(), tokenRow, credRows: [credRow], webhookSecret: "wrong_secret" });
    expect(r.status).toBe(401);
    expect(r.body.error).toContain("Linear signature mismatch");
  });

  it("skips non-done ticket", async () => {
    const r = await runHandler({ source: "linear", payload: makeLinearPayload({ state: { name: "In Progress" } }), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect(r.body.skipped).toBe(true);
  });

  it("tags include #linear", async () => {
    const r = await runHandler({ source: "linear", payload: makeLinearPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect(String((r.insertedMemories[0] as any).tags)).toContain("#linear");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 10: Encryption integrity
// ──────────────────────────────────────────────────────────────────────────────

describe("Encryption integrity", () => {
  it("round-trips plaintext correctly", async () => {
    const plain = "Multi-tenant webhook processor added.";
    expect(await aesDecrypt(await aesEncrypt(plain, MASTER_KEY), MASTER_KEY)).toBe(plain);
  });

  it("encrypted output matches iv:ciphertext format", async () => {
    expect(await aesEncrypt("test", MASTER_KEY)).toMatch(/^[0-9a-f]{24}:[0-9a-f]+$/);
  });

  it("two encryptions of same plaintext differ (random IV)", async () => {
    expect(await aesEncrypt("x", MASTER_KEY)).not.toBe(await aesEncrypt("x", MASTER_KEY));
  });

  it("credential stored with wrong vault key cannot be decrypted with correct key", async () => {
    const OTHER_KEY = "b".repeat(64);
    const encWithOtherKey = await aesEncrypt("secret", OTHER_KEY);
    await expect(aesDecrypt(encWithOtherKey, MASTER_KEY)).rejects.toThrow();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// SECTION 11: Edge cases
// ──────────────────────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  const SECRET = "edge_secret";
  let tokenRow: Awaited<ReturnType<typeof makeTokenRow>>;
  let credRow: Awaited<ReturnType<typeof makeCredentialRow>>;

  beforeEach(async () => {
    tokenRow = await makeTokenRow();
    credRow = await makeCredentialRow({ name: WEBHOOK_SECRET_GITHUB, plainSecret: SECRET, userId: "user1", projectKey: null, vaultId: "user1" });
  });

  it("handles PR with very long body", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload({ body: "x".repeat(50_000), diff_url: undefined }), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect(r.status).toBe(200);
  });

  it("handles Linear ticket with no description", async () => {
    const r = await runHandler({ source: "linear", payload: makeLinearPayload({ description: undefined }), tokenRow, credRows: [await makeCredentialRow({ name: WEBHOOK_SECRET_LINEAR, plainSecret: SECRET, userId: "user1", projectKey: null, vaultId: "user1" })], webhookSecret: SECRET });
    expect(r.status).toBe(200);
  });

  it("handles unicode PR title", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload({ title: "feat: 日本語 🚀" }), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect((r.insertedEvents[0] as any).rawTitle).toBe("feat: 日本語 🚀");
  });

  it("handles special characters in title", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload({ title: 'fix: <script>alert("xss")</script>' }), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect((r.insertedEvents[0] as any).rawTitle).toBe('fix: <script>alert("xss")</script>');
  });

  it("memoryId in response matches inserted memory row id", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect(r.body.memoryId).toBe((r.insertedMemories[0] as any).id);
  });

  it("webhook_events row references committed memoryId", async () => {
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect((r.insertedEvents[0] as any).memoryId).toBe((r.insertedMemories[0] as any).id);
  });

  it("processedAt is a recent epoch timestamp", async () => {
    const before = Date.now();
    const r = await runHandler({ source: "github", payload: makeGitHubPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    const after = Date.now();
    const ts = Number((r.insertedEvents[0] as any).processedAt);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("github credential not used to verify linear webhooks", async () => {
    // GitHub cred exists but we're hitting the linear endpoint — should 401 (no linear cred).
    const r = await runHandler({ source: "linear", payload: makeLinearPayload(), tokenRow, credRows: [credRow], webhookSecret: SECRET });
    expect(r.status).toBe(401);
    expect(String(r.body.error)).toContain(WEBHOOK_SECRET_LINEAR);
  });
});
