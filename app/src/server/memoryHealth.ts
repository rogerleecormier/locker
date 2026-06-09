import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { memories, userPlans, memoryConflicts } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { requireSession } from "~/server/session";
import { verifyVaultAccess, parseScope } from "~/server/enterprise";
import { getUserEffectivePlan } from "~/server/planGate";
import { isBusinessOrAbove } from "~/lib/plans";
import { upsertConflicts, clusterFingerprint, singleFingerprint, type ConflictUpsertInput } from "~/server/memoryConflicts";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

export type MemoryHealthCluster = {
  clusterLabel: string;
  memoryIds: string[];
  memoryDetails: Array<{ id: string; fact: string; category: string }>;
  reason: string;
  suggestedAction: "merge" | "review" | "delete";
};

export type StaleMemoryRecord = {
  memoryId: string;
  fact: string;
  lastAccessedAt: number | null;
  timestamp: number;
  staleDays: number;
  category: string;
};

export type MemoryAnomaly = {
  memoryId: string;
  fact: string;
  anomalyType: "oversized" | "empty_tags" | "duplicate_fact" | "contradictory" | "malformed";
  detail: string;
};

export type MemoryHealthReport = {
  analysisTimestamp: number;
  totalMemoriesAnalyzed: number;
  clusters: MemoryHealthCluster[];
  staleRecords: StaleMemoryRecord[];
  anomalies: MemoryAnomaly[];
  summary: string;
};

// Must match the client-side isMemoryStale() in memories.tsx
const STALE_THRESHOLD_DAYS = 30;
const STALE_THRESHOLD_MS = STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
const MAX_MEMORIES_FOR_ANALYSIS = 200;

const HealthCheckSchema = z.object({
  projectKey: z
    .string()
    .max(128)
    .refine(
      (v) =>
        v === "" ||
        v === "personal" ||
        /^org:[0-9a-f-]{36}$/.test(v) ||
        /^team:[0-9a-f-]{36}$/.test(v),
      { message: "Invalid projectKey" }
    )
    .optional(),
}).strict();

export const runMemoryHealthCheck = createServerFn({ method: "POST" })
  .inputValidator((data) => HealthCheckSchema.parse(data))
  .handler(async ({ data, context }): Promise<MemoryHealthReport> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { memories, userPlans, memoryConflicts } });

    // Gate: business plan or above required
    const { planId } = await getUserEffectivePlan(db, user.id);
    if (!isBusinessOrAbove(planId)) {
      throw new Error("Memory Health Check requires a Business plan or above.");
    }

    const { scopeType, scopeId } = parseScope(data?.projectKey);
    const { allowed } = await verifyVaultAccess(db, user.id, scopeType, scopeId);
    if (!allowed) {
      throw new Error(`Forbidden: no access to vault scope '${data?.projectKey ?? "personal"}'`);
    }

    // Fetch active memories for the scope
    let whereClause;
    if (scopeType === "personal") {
      whereClause = and(
        eq(memories.userId, user.id),
        eq(memories.scopeType, "personal"),
        eq(memories.isActive, true)
      );
    } else {
      whereClause = and(
        eq(memories.scopeType, scopeType),
        eq(memories.scopeId, scopeId!),
        eq(memories.isActive, true)
      );
    }

    const rows = await db
      .select({
        id: memories.id,
        userId: memories.userId,
        fact: memories.fact,
        category: memories.category,
        tags: memories.tags,
        timestamp: memories.timestamp,
        lastAccessedAt: memories.lastAccessedAt,
        isQuarantined: memories.isQuarantined,
        projectKey: memories.projectKey,
      })
      .from(memories)
      .where(whereClause)
      .limit(MAX_MEMORIES_FOR_ANALYSIS)
      .all();

    // Decrypt facts for analysis
    const { decryptMemories } = await import("~/server/memory/_shared");
    const decrypted = await decryptMemories(rows as any, env.DB, env.ENCRYPTION_KEY);

    const now = Date.now();
    const analysisTimestamp = now;

    if (decrypted.length === 0) {
      return {
        analysisTimestamp,
        totalMemoriesAnalyzed: 0,
        clusters: [],
        staleRecords: [],
        anomalies: [],
        summary: "No active memories found in this vault scope.",
      };
    }

    // Build a concise representation of memories for the AI prompt (limit total chars)
    const MAX_FACT_CHARS = 300;
    const memorySummaries = decrypted.map((m) => ({
      id: m.id,
      fact: m.fact.length > MAX_FACT_CHARS ? m.fact.slice(0, MAX_FACT_CHARS) + "…" : m.fact,
      category: m.category,
      tags: m.tags,
      createdDaysAgo: Math.floor((now - m.timestamp) / (1000 * 60 * 60 * 24)),
      lastAccessedDaysAgo:
        m.lastAccessedAt != null
          ? Math.floor((now - m.lastAccessedAt) / (1000 * 60 * 60 * 24))
          : null,
    }));

    const prompt = `You are a memory data health analyst. Analyze the following collection of memory records from a personal knowledge vault and return ONLY a JSON object (no markdown, no explanation) matching this exact schema:

{
  "clusters": [
    {
      "clusterLabel": "string — short label for the cluster topic",
      "memoryIds": ["id1", "id2"],
      "reason": "string — why these are near-duplicates or related",
      "suggestedAction": "merge" | "review" | "delete"
    }
  ],
  "staleIds": ["id1", "id2"],
  "anomalies": [
    {
      "memoryId": "string",
      "anomalyType": "oversized" | "empty_tags" | "duplicate_fact" | "contradictory" | "malformed",
      "detail": "string — brief explanation"
    }
  ],
  "summary": "string — 1–2 sentence plain-language overview of vault health"
}

Rules:
- clusters: group memories whose facts are near-identical or tightly overlap in meaning. Only include clusters with ≥2 members. Limit to 10 clusters max.
- staleIds: IDs of memories where lastAccessedDaysAgo is null OR lastAccessedDaysAgo >30. These have never been recalled or haven't been accessed recently.
- anomalies: flag oversized facts (>500 chars), empty/missing tags, apparent duplicate facts, contradictory facts, or malformed content. Limit to 15 anomalies max.
- summary: concise health summary.
- Return only the JSON. Do not include any text outside the JSON.

Memory records:
${JSON.stringify(memorySummaries, null, 2)}`;

    let aiResponse: string;
    try {
      const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2048,
      });
      const r = result as { response?: string; result?: { response?: string } };
      aiResponse = r.response ?? r.result?.response ?? "";
    } catch (err) {
      throw new Error(`Workers AI analysis failed: ${String(err)}`);
    }

    // Parse the JSON from the AI response
    let parsed: {
      clusters?: Array<{ clusterLabel: string; memoryIds: string[]; reason: string; suggestedAction: string }>;
      staleIds?: string[];
      anomalies?: Array<{ memoryId: string; anomalyType: string; detail: string }>;
      summary?: string;
    };

    try {
      // Strip any accidental markdown code fences
      const cleaned = aiResponse.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // If AI returned malformed JSON, return a degraded report with raw AI text in summary
      parsed = { clusters: [], staleIds: [], anomalies: [], summary: `AI analysis returned non-JSON output. Raw: ${aiResponse.slice(0, 200)}` };
    }

    // Build typed stale records — mirrors isMemoryStale() on the client:
    // stale if never recalled (lastAccessedAt null) OR last accessed >30 days ago
    const memoryById = new Map(decrypted.map((m) => [m.id, m]));

    const staleRecords: StaleMemoryRecord[] = decrypted
      .filter((m) => m.lastAccessedAt == null || now - m.lastAccessedAt > STALE_THRESHOLD_MS)
      .map((m) => ({
        memoryId: m.id,
        fact: m.fact.length > MAX_FACT_CHARS ? m.fact.slice(0, MAX_FACT_CHARS) + "…" : m.fact,
        lastAccessedAt: m.lastAccessedAt ?? null,
        timestamp: m.timestamp,
        staleDays: m.lastAccessedAt != null
          ? Math.floor((now - m.lastAccessedAt) / (1000 * 60 * 60 * 24))
          : Math.floor((now - m.timestamp) / (1000 * 60 * 60 * 24)),
        category: m.category,
      }));

    // Validate cluster member IDs exist in the vault
    const validMemoryIds = new Set(decrypted.map((m) => m.id));
    const clusters: MemoryHealthCluster[] = (parsed.clusters ?? [])
      .map((c) => {
        const validIds = (c.memoryIds ?? []).filter((id) => validMemoryIds.has(id));
        return {
          clusterLabel: String(c.clusterLabel ?? ""),
          memoryIds: validIds,
          memoryDetails: validIds.map((id) => {
            const mem = memoryById.get(id);
            return {
              id,
              fact: mem ? (mem.fact.length > MAX_FACT_CHARS ? mem.fact.slice(0, MAX_FACT_CHARS) + "…" : mem.fact) : "",
              category: mem?.category ?? "",
            };
          }),
          reason: String(c.reason ?? ""),
          suggestedAction: (["merge", "review", "delete"].includes(c.suggestedAction) ? c.suggestedAction : "review") as MemoryHealthCluster["suggestedAction"],
        };
      })
      .filter((c) => c.memoryIds.length >= 2);

    const anomalies: MemoryAnomaly[] = (parsed.anomalies ?? [])
      .filter((a) => validMemoryIds.has(a.memoryId))
      .map((a) => {
        const mem = memoryById.get(a.memoryId);
        return {
          memoryId: a.memoryId,
          fact: mem ? (mem.fact.length > MAX_FACT_CHARS ? mem.fact.slice(0, MAX_FACT_CHARS) + "…" : mem.fact) : "",
          anomalyType: (["oversized", "empty_tags", "duplicate_fact", "contradictory", "malformed"].includes(a.anomalyType)
            ? a.anomalyType
            : "malformed") as MemoryAnomaly["anomalyType"],
          detail: String(a.detail ?? ""),
        };
      });

    // Persist detected conflicts so they survive page refresh and deduplicate on re-run
    const conflictInputs: ConflictUpsertInput[] = [
      ...clusters.map((c) => ({
        fingerprint: clusterFingerprint(c.memoryIds),
        conflictType: "duplicate" as const,
        label: c.clusterLabel,
        reason: c.reason,
        memoryIds: c.memoryIds,
        memoryDetails: c.memoryDetails,
        suggestedAction: c.suggestedAction,
      })),
      ...staleRecords.map((s) => ({
        fingerprint: singleFingerprint(s.memoryId, "stale"),
        conflictType: "stale" as const,
        label: s.fact.slice(0, 80) + (s.fact.length > 80 ? "…" : ""),
        reason: s.lastAccessedAt
          ? `Not accessed in ${s.staleDays} days`
          : "Never recalled",
        memoryIds: [s.memoryId],
        suggestedAction: "review" as const,
      })),
      ...anomalies.map((a) => ({
        fingerprint: singleFingerprint(a.memoryId, "quarantined"),
        conflictType: "quarantined" as const,
        label: a.fact.slice(0, 80) + (a.fact.length > 80 ? "…" : ""),
        reason: `${a.anomalyType}: ${a.detail}`,
        memoryIds: [a.memoryId],
        suggestedAction: "review" as const,
      })),
    ];

    await upsertConflicts(env.DB, user.id, scopeType, scopeId, conflictInputs);

    return {
      analysisTimestamp,
      totalMemoriesAnalyzed: decrypted.length,
      clusters,
      staleRecords,
      anomalies,
      summary: String(parsed.summary ?? "Analysis complete."),
    };
  });
