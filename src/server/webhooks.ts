/**
 * Webhook processor for GitHub "PR Merged" and Linear "Ticket Done" events.
 *
 * Multi-tenant secret resolution hierarchy:
 *   - The inbound Authorization header carries a Locker API token (lkr_...).
 *   - The token resolves to a userId, scopeType, and scopeId.
 *   - The webhook signing secret is stored as an encrypted credential named
 *     __WEBHOOK_GITHUB__ or __WEBHOOK_LINEAR__ in the appropriate vault:
 *       · personal token  → user's personal credential vault (userId)
 *       · organization token → org's credential vault (org:orgId)
 *       · team token      → team inherits the parent org's credential vault (org:parentOrgId)
 *   - The HMAC signature on the inbound request is verified against that secret.
 *   - On success, the AI summary is committed as an encrypted memory into the
 *     vault that corresponds to the resolved project key.
 *
 * Flow:
 *  1. Resolve token → userId, scopeType, scopeId, projectKey.
 *  2. Determine vault scope for secret lookup (team → parent org).
 *  3. Read __WEBHOOK_GITHUB__ / __WEBHOOK_LINEAR__ from that vault's credentials.
 *  4. Verify HMAC-SHA256 signature on the raw request body.
 *  5. Parse payload; skip irrelevant events (200 skipped).
 *  6. Idempotency check on (source, external_id).
 *  7. Fetch diff/description ephemerally.
 *  8. Workers AI summarisation.
 *  9. Encrypt summary + fact with vault DEK.
 * 10. Insert memory (category: projects) + webhook_events audit row.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq, and, isNull } from "drizzle-orm";
import {
  apiTokens,
  memories,
  webhookEvents,
  credentials,
  teams,
  MCP_PERM_COMMIT,
  type NewWebhookEvent,
  type NewMemory,
} from "~/db/schema";
import { getOrCreateVaultKey, encrypt, decrypt, isEncrypted, verifyToken, extractTokenPrefix } from "~/server/crypto";
import type { CloudflareEnv } from "~/types/cloudflare";

// ── Constants ─────────────────────────────────────────────────────────────────

const AI_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8" as const;

// Well-known credential names for webhook secrets (uppercase per convention).
export const WEBHOOK_SECRET_GITHUB = "__WEBHOOK_GITHUB__";
export const WEBHOOK_SECRET_LINEAR = "__WEBHOOK_LINEAR__";

const SUMMARY_SYSTEM_PROMPT = `You are a senior software engineer writing concise technical changelog entries.
Given a code diff or ticket description, produce a single-paragraph technical summary (3-5 sentences, ≤ 150 words).
Focus on: what changed, why it matters, and any notable implementation decisions.
Do NOT include greetings, bullet points, or markdown headers — plain prose only.`;

const MAX_DIFF_BYTES = 128_000;
const MAX_DESCRIPTION_CHARS = 8_000;

// ── Public handler ────────────────────────────────────────────────────────────

export async function handleWebhookRequest(
  request: Request,
  env: CloudflareEnv,
  source: "github" | "linear"
): Promise<Response> {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const rawBody = await request.arrayBuffer();
  const bodyText = new TextDecoder().decode(rawBody);

  // ── Step 1: Resolve token ─────────────────────────────────────────────────
  const authResult = await resolveToken(request, env);
  if (!authResult) {
    return jsonResponse({ error: "Unauthorized: valid Locker API token with commit_memory permission required" }, 401);
  }
  const { userId, scopeType, scopeId, projectKey } = authResult;

  // ── Step 2: Determine secret vault scope (team inherits from parent org) ──
  const secretVaultId = await resolveSecretVaultId(env, userId, scopeType, scopeId);

  // ── Step 3: Fetch the per-tenant webhook secret from the credential vault ─
  const secretCredName = source === "github" ? WEBHOOK_SECRET_GITHUB : WEBHOOK_SECRET_LINEAR;
  const webhookSecret = await readWebhookSecret(env, secretVaultId, secretCredName, userId);

  if (!webhookSecret) {
    return jsonResponse({
      error: `Webhook secret not configured. Store a credential named ${secretCredName} in your vault to enable this integration.`,
      hint: source === "github"
        ? "Use Settings → Webhooks → GitHub to configure your webhook secret."
        : "Use Settings → Webhooks → Linear to configure your webhook secret.",
    }, 401);
  }

  // ── Step 4: Verify HMAC signature ────────────────────────────────────────
  const signatureError = await verifyWebhookSignature(request, rawBody, webhookSecret, source);
  if (signatureError) {
    console.error(`[webhook/${source}] Signature verification failed: ${signatureError}`);
    return jsonResponse({ error: signatureError }, 401);
  }

  // ── Step 5: Parse payload ─────────────────────────────────────────────────
  let parsed: ParsedEvent;
  try {
    parsed = parsePayload(bodyText, source);
  } catch (err) {
    console.log(`[webhook/${source}] Skipping irrelevant event: ${String(err)}`);
    return jsonResponse({ ok: true, skipped: true });
  }

  const db = drizzle(env.DB);

  // ── Step 6: Idempotency check ─────────────────────────────────────────────
  const existing = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(and(eq(webhookEvents.source, source), eq(webhookEvents.externalId, parsed.externalId)))
    .limit(1)
    .all();

  if (existing.length > 0) {
    console.log(`[webhook/${source}] Duplicate event ${parsed.externalId} — returning early`);
    return jsonResponse({ ok: true, duplicate: true });
  }

  // ── Step 7: Fetch diff / description ephemerally ──────────────────────────
  let rawContent: string;
  try {
    rawContent = await fetchContent(parsed);
  } catch (err) {
    console.error(`[webhook/${source}] Content fetch failed:`, err);
    rawContent = parsed.fallbackContent ?? "";
  }

  // ── Step 8: AI summarisation ───────────────────────────────────────────────
  const summary = await generateSummary(env.AI, parsed, rawContent);

  // ── Step 9: Encrypt with vault DEK for the resolved project key ───────────
  const vaultId = resolveVaultId(userId, projectKey);
  const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
  const encryptedSummary = await encrypt(summary, vaultKey);

  const factPlain = `[${source === "github" ? "PR Merged" : "Ticket Done"}] ${parsed.title}\n\n${summary}`;
  const encryptedFact = await encrypt(factPlain, vaultKey);

  // ── Step 10: Commit memory + audit row ────────────────────────────────────
  const memoryId = crypto.randomUUID();
  const now = Date.now();

  const { scopeType: memScopeType, scopeId: memScopeId } = parseScopeFromProjectKey(projectKey);

  const newMemory: NewMemory = {
    id: memoryId,
    userId,
    fact: encryptedFact,
    category: "projects",
    tags: `#webhook #${source}`,
    timestamp: now,
    isActive: true,
    projectKey: projectKey ?? null,
    scopeType: memScopeType,
    scopeId: memScopeId,
    isLocked: false,
    authorityType: "contributed",
    isQuarantined: false,
  };
  await db.insert(memories).values(newMemory);

  const eventRow: NewWebhookEvent = {
    id: crypto.randomUUID(),
    source,
    eventType: parsed.eventType,
    externalId: parsed.externalId,
    projectKey: projectKey ?? null,
    userId,
    memoryId,
    encryptedSummary,
    rawTitle: parsed.title,
    processedAt: now,
  };
  await db.insert(webhookEvents).values(eventRow);

  console.log(`[webhook/${source}] Committed memory ${memoryId} for event ${parsed.externalId} (vault=${vaultId})`);
  return jsonResponse({ ok: true, memoryId });
}

// ── Secret resolution helpers ─────────────────────────────────────────────────

/**
 * Determine which vault holds the webhook secret for this token scope.
 *
 * - personal   → user's personal vault (userId)
 * - org        → org's vault (org:orgId)
 * - team       → parent org's vault (org:parentOrgId); teams have no separate secrets
 */
async function resolveSecretVaultId(
  env: CloudflareEnv,
  userId: string,
  scopeType: string,
  scopeId: string | null
): Promise<string> {
  if (scopeType === "organization" && scopeId) {
    return `org:${scopeId}`;
  }

  if (scopeType === "team" && scopeId) {
    // Look up the parent org for this team.
    const db = drizzle(env.DB);
    const row = await db
      .select({ orgId: teams.orgId })
      .from(teams)
      .where(eq(teams.id, scopeId))
      .limit(1)
      .all();
    if (row[0]?.orgId) {
      return `org:${row[0].orgId}`;
    }
    // Fallback: team vault (shouldn't normally happen if schema is consistent)
    return `team:${scopeId}`;
  }

  // personal
  return userId;
}

/**
 * Read a webhook secret credential from the given vault.
 * Returns null if not found or on decryption error.
 */
async function readWebhookSecret(
  env: CloudflareEnv,
  vaultId: string,
  credName: string,
  userId: string
): Promise<string | null> {
  const db = drizzle(env.DB);

  // Build scope condition matching how store_credential persists them.
  const isOrgOrTeam = vaultId.startsWith("org:") || vaultId.startsWith("team:");
  const scopeCondition = isOrgOrTeam
    ? eq(credentials.projectKey, vaultId)
    : and(eq(credentials.userId, userId), eq(credentials.name, credName));

  const rows = await db
    .select({ encryptedValue: credentials.encryptedValue })
    .from(credentials)
    .where(
      isOrgOrTeam
        ? and(eq(credentials.projectKey, vaultId), eq(credentials.name, credName))
        : and(eq(credentials.userId, userId), eq(credentials.name, credName))
    )
    .limit(1)
    .all();

  if (rows.length === 0) return null;

  try {
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    if (isEncrypted(rows[0].encryptedValue)) {
      return await decrypt(rows[0].encryptedValue, vaultKey);
    }
    return rows[0].encryptedValue;
  } catch (err) {
    console.error(`[webhook] Failed to decrypt webhook secret from vault ${vaultId}:`, err);
    return null;
  }
}

// ── Signature verification ────────────────────────────────────────────────────

async function verifyWebhookSignature(
  request: Request,
  rawBody: ArrayBuffer,
  secret: string,
  source: "github" | "linear"
): Promise<string | null> {
  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, rawBody);
  const computed = bytesToHex(new Uint8Array(sig));

  if (source === "github") {
    const header = request.headers.get("x-hub-signature-256") ?? "";
    if (!header.startsWith("sha256=")) return "Missing x-hub-signature-256 header";
    if (!timingSafeEqual(computed, header.slice("sha256=".length))) return "GitHub signature mismatch";
    return null;
  }

  // Linear
  const header = request.headers.get("x-linear-signature") ?? "";
  if (!header) return "Missing x-linear-signature header";
  if (!timingSafeEqual(computed, header)) return "Linear signature mismatch";
  return null;
}

// ── Payload parsing ───────────────────────────────────────────────────────────

type ParsedEvent = {
  eventType: "pr.merged" | "ticket.done";
  externalId: string;
  title: string;
  diffUrl?: string;
  description?: string;
  fallbackContent?: string;
};

function parsePayload(body: string, source: "github" | "linear"): ParsedEvent {
  const payload = JSON.parse(body) as Record<string, unknown>;
  return source === "github" ? parseGitHub(payload) : parseLinear(payload);
}

function parseGitHub(payload: Record<string, unknown>): ParsedEvent {
  if (payload.action !== "closed") throw new Error("Not a closed PR event");
  const pr = payload.pull_request as Record<string, unknown> | undefined;
  if (!pr) throw new Error("No pull_request field");
  if (!pr.merged) throw new Error("PR was closed but not merged");
  return {
    eventType: "pr.merged",
    externalId: String(pr.node_id ?? pr.id ?? pr.number ?? Date.now()),
    title: String(pr.title ?? "Untitled PR"),
    diffUrl: pr.diff_url ? String(pr.diff_url) : undefined,
    fallbackContent: String(pr.body ?? pr.title ?? ""),
  };
}

function parseLinear(payload: Record<string, unknown>): ParsedEvent {
  const action = String(payload.action ?? "");
  const type = String(payload.type ?? "");
  const data = (payload.data ?? payload.issue ?? {}) as Record<string, unknown>;
  const state = (data.state ?? data.stateName ?? "") as Record<string, unknown> | string;
  const stateName = typeof state === "string" ? state : String((state as Record<string, unknown>).name ?? (state as Record<string, unknown>).type ?? "");
  const isDone = /\b(done|completed?|finished|closed|merged)\b/i.test(stateName);
  if (!isDone && action !== "done" && type !== "IssueDone") {
    throw new Error(`Linear event is not a Ticket Done (state=${stateName})`);
  }
  return {
    eventType: "ticket.done",
    externalId: String(data.id ?? data.identifier ?? Date.now()),
    title: String(data.title ?? data.name ?? "Untitled Ticket"),
    description: data.description ? String(data.description).slice(0, MAX_DESCRIPTION_CHARS) : undefined,
    fallbackContent: String(data.description ?? data.title ?? ""),
  };
}

// ── Content fetching ──────────────────────────────────────────────────────────

async function fetchContent(parsed: ParsedEvent): Promise<string> {
  if (parsed.diffUrl) {
    const resp = await fetch(parsed.diffUrl, { headers: { Accept: "application/vnd.github.v3.diff" } });
    if (!resp.ok) throw new Error(`GitHub diff fetch failed: ${resp.status}`);
    const ab = await resp.arrayBuffer();
    return new TextDecoder().decode(new Uint8Array(ab.slice(0, MAX_DIFF_BYTES)));
  }
  return parsed.description ?? parsed.fallbackContent ?? "";
}

// ── AI summarisation ──────────────────────────────────────────────────────────

async function generateSummary(ai: Ai, parsed: ParsedEvent, content: string): Promise<string> {
  const userMessage = parsed.eventType === "pr.merged"
    ? `PR title: ${parsed.title}\n\nDiff (may be truncated):\n\`\`\`diff\n${content.slice(0, MAX_DIFF_BYTES)}\n\`\`\``
    : `Ticket title: ${parsed.title}\n\nDescription:\n${content.slice(0, MAX_DESCRIPTION_CHARS)}`;

  try {
    const result = await ai.run(AI_MODEL, {
      messages: [
        { role: "system", content: SUMMARY_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 300,
    }) as { response?: string } | ReadableStream;

    if (result instanceof ReadableStream) {
      const reader = result.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value instanceof Uint8Array ? value : new TextEncoder().encode(String(value)));
      }
      const text = new TextDecoder().decode(concatUint8Arrays(chunks)).trim();
      return text || fallbackSummary(parsed);
    }

    return (result as { response?: string }).response?.trim() || fallbackSummary(parsed);
  } catch (err) {
    console.error("[webhook] AI summarisation failed:", err);
    return fallbackSummary(parsed);
  }
}

function fallbackSummary(parsed: ParsedEvent): string {
  return parsed.eventType === "pr.merged"
    ? `PR merged: ${parsed.title}`
    : `Ticket completed: ${parsed.title}`;
}

// ── Token resolution ──────────────────────────────────────────────────────────

type ResolvedToken = {
  userId: string;
  scopeType: "personal" | "organization" | "team";
  scopeId: string | null;
  projectKey: string | null;
};

async function resolveToken(request: Request, env: CloudflareEnv): Promise<ResolvedToken | null> {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer lkr_")) return null;

  const raw = authHeader.slice("Bearer ".length).trim();
  const prefix = extractTokenPrefix(raw);
  const db = drizzle(env.DB);

  // Two-pass lookup:
  //   Pass 1 — indexed prefix hit:  O(1) rows for tokens minted after migration.
  //   Pass 2 — legacy NULL-prefix:  O(legacy) rows only; shrinks to zero once all
  //            tokens are rotated. Skip pass 2 entirely if prefix extraction failed.
  const prefixRows = prefix
    ? await db.select().from(apiTokens).where(eq(apiTokens.tokenPrefix, prefix)).all()
    : [];

  const legacyRows = prefix
    ? await db.select().from(apiTokens).where(isNull(apiTokens.tokenPrefix)).all()
    : await db.select().from(apiTokens).all(); // no prefix = malformed token; scan all as last resort

  for (const row of [...prefixRows, ...legacyRows]) {
    if (!(await verifyToken(raw, row.tokenHash))) continue;
    if (row.expiresAt && row.expiresAt < Date.now()) continue;
    if (!(row.permissions & MCP_PERM_COMMIT)) continue;

    const scopeType = row.scopeType as "personal" | "organization" | "team";
    const scopeId = row.scopeId ?? null;

    let projectKey: string | null = null;
    if (scopeType === "organization" && scopeId) projectKey = `org:${scopeId}`;
    else if (scopeType === "team" && scopeId) projectKey = `team:${scopeId}`;

    return { userId: row.userId, scopeType, scopeId, projectKey };
  }

  return null;
}

// ── Utility ───────────────────────────────────────────────────────────────────

function resolveVaultId(userId: string, projectKey: string | null | undefined): string {
  if (!projectKey || projectKey === "personal") return userId;
  return projectKey;
}

function parseScopeFromProjectKey(projectKey: string | null | undefined): {
  scopeType: "personal" | "organization" | "team";
  scopeId: string | null;
} {
  if (!projectKey || projectKey === "personal") return { scopeType: "personal", scopeId: null };
  if (projectKey.startsWith("org:")) return { scopeType: "organization", scopeId: projectKey.slice(4) };
  if (projectKey.startsWith("team:")) return { scopeType: "team", scopeId: projectKey.slice(5) };
  return { scopeType: "personal", scopeId: null };
}

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

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
