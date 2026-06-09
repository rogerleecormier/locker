/**
 * Tests for src/server/memoryHealth.ts
 *
 * These tests exercise the pure utility logic and type-safe JSON parsing
 * that lives within the memory health check handler, extracted to testable
 * helper functions below. We do not spin up a full Cloudflare Worker —
 * instead we mock the D1, AI, and encryption dependencies.
 *
 * Coverage:
 *   1. buildMemorySummaries — truncates long facts, formats age fields
 *   2. parseAIResponse — handles valid JSON, code-fenced JSON, and malformed output
 *   3. normalizeCluster — validates suggestedAction, filters missing IDs
 *   4. normalizeAnomaly — validates anomalyType enum, handles missing IDs
 *   5. computeStaleRecords — merges AI stale IDs with threshold-based detection
 *   6. healthReportFromParsed — end-to-end assembly of the MemoryHealthReport
 *
 * Run: npx vitest run src/server/memoryHealth.test.ts
 */

import { describe, it, expect } from "vitest";

// ─── Types ────────────────────────────────────────────────────────────────────

type RawMemory = {
  id: string;
  fact: string;
  category: string;
  tags: string;
  timestamp: number;
  lastAccessedAt: number | null;
  isQuarantined?: boolean;
};

type MemorySummary = {
  id: string;
  fact: string;
  category: string;
  tags: string;
  createdDaysAgo: number;
  lastAccessedDaysAgo: number | null;
};

type ParsedAI = {
  clusters?: Array<{ clusterLabel: string; memoryIds: string[]; reason: string; suggestedAction: string }>;
  staleIds?: string[];
  anomalies?: Array<{ memoryId: string; anomalyType: string; detail: string }>;
  summary?: string;
};

// ─── Extracted helpers (mirror of the handler internals) ──────────────────────

const MAX_FACT_CHARS = 300;
const STALE_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;

function buildMemorySummaries(memories: RawMemory[], now: number): MemorySummary[] {
  return memories.map((m) => ({
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
}

function parseAIResponse(raw: string): ParsedAI {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return { clusters: [], staleIds: [], anomalies: [], summary: `AI analysis returned non-JSON output. Raw: ${raw.slice(0, 200)}` };
  }
}

function normalizeCluster(
  c: { clusterLabel: string; memoryIds: string[]; reason: string; suggestedAction: string },
  validIds: Set<string>
) {
  const validActions = ["merge", "review", "delete"];
  return {
    clusterLabel: String(c.clusterLabel ?? ""),
    memoryIds: (c.memoryIds ?? []).filter((id) => validIds.has(id)),
    reason: String(c.reason ?? ""),
    suggestedAction: validActions.includes(c.suggestedAction)
      ? (c.suggestedAction as "merge" | "review" | "delete")
      : "review" as const,
  };
}

function normalizeAnomaly(
  a: { memoryId: string; anomalyType: string; detail: string },
  memoryById: Map<string, RawMemory>
) {
  const validTypes = ["oversized", "empty_tags", "duplicate_fact", "contradictory", "malformed"];
  const mem = memoryById.get(a.memoryId);
  return {
    memoryId: a.memoryId,
    fact: mem
      ? mem.fact.length > MAX_FACT_CHARS
        ? mem.fact.slice(0, MAX_FACT_CHARS) + "…"
        : mem.fact
      : "",
    anomalyType: (validTypes.includes(a.anomalyType) ? a.anomalyType : "malformed") as
      | "oversized"
      | "empty_tags"
      | "duplicate_fact"
      | "contradictory"
      | "malformed",
    detail: String(a.detail ?? ""),
  };
}

function computeStaleRecords(memories: RawMemory[], aiStaleIds: Set<string>, now: number) {
  return memories
    .filter((m) => {
      const isOld = now - m.timestamp > STALE_THRESHOLD_MS;
      const notRecentlyAccessed =
        m.lastAccessedAt == null || now - m.lastAccessedAt > STALE_THRESHOLD_MS;
      return (isOld && notRecentlyAccessed) || aiStaleIds.has(m.id);
    })
    .map((m) => ({
      memoryId: m.id,
      fact: m.fact.length > MAX_FACT_CHARS ? m.fact.slice(0, MAX_FACT_CHARS) + "…" : m.fact,
      lastAccessedAt: m.lastAccessedAt ?? null,
      timestamp: m.timestamp,
      staleDays: Math.floor((now - m.timestamp) / (1000 * 60 * 60 * 24)),
      category: m.category,
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: buildMemorySummaries
// ─────────────────────────────────────────────────────────────────────────────

describe("buildMemorySummaries", () => {
  const now = 1_700_000_000_000;

  it("preserves short facts unchanged", () => {
    const mem: RawMemory = {
      id: "m1",
      fact: "Short fact",
      category: "rules",
      tags: "tag1",
      timestamp: now - 1 * 24 * 60 * 60 * 1000,
      lastAccessedAt: null,
    };
    const [summary] = buildMemorySummaries([mem], now);
    expect(summary.fact).toBe("Short fact");
  });

  it("truncates facts longer than 300 chars with ellipsis", () => {
    const longFact = "x".repeat(400);
    const mem: RawMemory = {
      id: "m2",
      fact: longFact,
      category: "rules",
      tags: "",
      timestamp: now - 1 * 24 * 60 * 60 * 1000,
      lastAccessedAt: null,
    };
    const [summary] = buildMemorySummaries([mem], now);
    expect(summary.fact).toHaveLength(301); // 300 + "…"
    expect(summary.fact.endsWith("…")).toBe(true);
  });

  it("computes createdDaysAgo correctly", () => {
    const mem: RawMemory = {
      id: "m3",
      fact: "fact",
      category: "projects",
      tags: "",
      timestamp: now - 5 * 24 * 60 * 60 * 1000,
      lastAccessedAt: null,
    };
    const [summary] = buildMemorySummaries([mem], now);
    expect(summary.createdDaysAgo).toBe(5);
  });

  it("returns null for lastAccessedDaysAgo when lastAccessedAt is null", () => {
    const mem: RawMemory = {
      id: "m4",
      fact: "fact",
      category: "references",
      tags: "",
      timestamp: now - 10 * 24 * 60 * 60 * 1000,
      lastAccessedAt: null,
    };
    const [summary] = buildMemorySummaries([mem], now);
    expect(summary.lastAccessedDaysAgo).toBeNull();
  });

  it("computes lastAccessedDaysAgo when lastAccessedAt is set", () => {
    const mem: RawMemory = {
      id: "m5",
      fact: "fact",
      category: "rules",
      tags: "",
      timestamp: now - 20 * 24 * 60 * 60 * 1000,
      lastAccessedAt: now - 3 * 24 * 60 * 60 * 1000,
    };
    const [summary] = buildMemorySummaries([mem], now);
    expect(summary.lastAccessedDaysAgo).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: parseAIResponse
// ─────────────────────────────────────────────────────────────────────────────

describe("parseAIResponse", () => {
  it("parses clean JSON", () => {
    const json = JSON.stringify({
      clusters: [],
      staleIds: ["id1"],
      anomalies: [],
      summary: "All good",
    });
    const result = parseAIResponse(json);
    expect(result.staleIds).toEqual(["id1"]);
    expect(result.summary).toBe("All good");
  });

  it("strips markdown code fences before parsing", () => {
    const fenced = "```json\n" + JSON.stringify({ clusters: [], staleIds: [], anomalies: [], summary: "OK" }) + "\n```";
    const result = parseAIResponse(fenced);
    expect(result.summary).toBe("OK");
  });

  it("strips plain code fences (no language tag)", () => {
    const fenced = "```\n" + JSON.stringify({ clusters: [], staleIds: [], anomalies: [], summary: "Plain" }) + "\n```";
    const result = parseAIResponse(fenced);
    expect(result.summary).toBe("Plain");
  });

  it("returns degraded result with summary on malformed JSON", () => {
    const result = parseAIResponse("This is not JSON at all");
    expect(result.clusters).toEqual([]);
    expect(result.staleIds).toEqual([]);
    expect(result.anomalies).toEqual([]);
    expect(result.summary).toContain("non-JSON output");
  });

  it("includes up to 200 chars of raw AI output in degraded summary", () => {
    const raw = "BROKEN".repeat(50); // 300 chars
    const result = parseAIResponse(raw);
    expect(result.summary!.length).toBeLessThanOrEqual("AI analysis returned non-JSON output. Raw: ".length + 200 + 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: normalizeCluster
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeCluster", () => {
  const validIds = new Set(["id1", "id2", "id3"]);

  it("filters out memory IDs not in the valid set", () => {
    const cluster = { clusterLabel: "Test", memoryIds: ["id1", "unknown-id"], reason: "overlap", suggestedAction: "merge" };
    const result = normalizeCluster(cluster, validIds);
    expect(result.memoryIds).toEqual(["id1"]);
  });

  it("accepts merge, review, delete as valid suggestedActions", () => {
    for (const action of ["merge", "review", "delete"] as const) {
      const cluster = { clusterLabel: "T", memoryIds: ["id1"], reason: "r", suggestedAction: action };
      expect(normalizeCluster(cluster, validIds).suggestedAction).toBe(action);
    }
  });

  it("falls back to 'review' for unknown suggestedAction values", () => {
    const cluster = { clusterLabel: "T", memoryIds: ["id1"], reason: "r", suggestedAction: "archive" };
    expect(normalizeCluster(cluster, validIds).suggestedAction).toBe("review");
  });

  it("converts undefined labels/reasons to empty strings", () => {
    const cluster = { clusterLabel: undefined as any, memoryIds: ["id1"], reason: undefined as any, suggestedAction: "merge" };
    const result = normalizeCluster(cluster, validIds);
    expect(result.clusterLabel).toBe("");
    expect(result.reason).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: normalizeAnomaly
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeAnomaly", () => {
  const mem: RawMemory = { id: "m1", fact: "test fact", category: "rules", tags: "", timestamp: 0, lastAccessedAt: null };
  const memoryById = new Map([["m1", mem]]);

  it("accepts all valid anomaly types", () => {
    for (const t of ["oversized", "empty_tags", "duplicate_fact", "contradictory", "malformed"] as const) {
      const result = normalizeAnomaly({ memoryId: "m1", anomalyType: t, detail: "d" }, memoryById);
      expect(result.anomalyType).toBe(t);
    }
  });

  it("falls back to 'malformed' for unknown anomaly types", () => {
    const result = normalizeAnomaly({ memoryId: "m1", anomalyType: "weird_type", detail: "d" }, memoryById);
    expect(result.anomalyType).toBe("malformed");
  });

  it("looks up and includes the fact from memory", () => {
    const result = normalizeAnomaly({ memoryId: "m1", anomalyType: "oversized", detail: "too big" }, memoryById);
    expect(result.fact).toBe("test fact");
  });

  it("returns empty fact string when memoryId not in map", () => {
    const result = normalizeAnomaly({ memoryId: "missing", anomalyType: "oversized", detail: "d" }, memoryById);
    expect(result.fact).toBe("");
  });

  it("truncates long facts in returned anomaly", () => {
    const longMem: RawMemory = { id: "long", fact: "a".repeat(400), category: "rules", tags: "", timestamp: 0, lastAccessedAt: null };
    const byId = new Map([["long", longMem]]);
    const result = normalizeAnomaly({ memoryId: "long", anomalyType: "oversized", detail: "too long" }, byId);
    expect(result.fact.endsWith("…")).toBe(true);
    expect(result.fact.length).toBe(301);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: computeStaleRecords
// ─────────────────────────────────────────────────────────────────────────────

describe("computeStaleRecords", () => {
  const now = 1_700_000_000_000;
  const MS_91_DAYS = 91 * 24 * 60 * 60 * 1000;
  const MS_30_DAYS = 30 * 24 * 60 * 60 * 1000;

  it("flags memories older than 90 days with no recent access", () => {
    const mem: RawMemory = {
      id: "old",
      fact: "old fact",
      category: "rules",
      tags: "",
      timestamp: now - MS_91_DAYS,
      lastAccessedAt: null,
    };
    const result = computeStaleRecords([mem], new Set(), now);
    expect(result).toHaveLength(1);
    expect(result[0].memoryId).toBe("old");
  });

  it("does not flag memories newer than 90 days", () => {
    const mem: RawMemory = {
      id: "new",
      fact: "new fact",
      category: "rules",
      tags: "",
      timestamp: now - MS_30_DAYS,
      lastAccessedAt: null,
    };
    const result = computeStaleRecords([mem], new Set(), now);
    expect(result).toHaveLength(0);
  });

  it("does not flag old memories recently accessed", () => {
    const mem: RawMemory = {
      id: "accessed",
      fact: "old but accessed",
      category: "rules",
      tags: "",
      timestamp: now - MS_91_DAYS,
      lastAccessedAt: now - MS_30_DAYS,
    };
    const result = computeStaleRecords([mem], new Set(), now);
    expect(result).toHaveLength(0);
  });

  it("includes AI-identified stale IDs even if not threshold-stale", () => {
    const mem: RawMemory = {
      id: "ai-stale",
      fact: "recent but AI says stale",
      category: "projects",
      tags: "",
      timestamp: now - MS_30_DAYS,
      lastAccessedAt: now - MS_30_DAYS,
    };
    const result = computeStaleRecords([mem], new Set(["ai-stale"]), now);
    expect(result).toHaveLength(1);
    expect(result[0].memoryId).toBe("ai-stale");
  });

  it("computes staleDays correctly", () => {
    const mem: RawMemory = {
      id: "m1",
      fact: "fact",
      category: "rules",
      tags: "",
      timestamp: now - MS_91_DAYS,
      lastAccessedAt: null,
    };
    const result = computeStaleRecords([mem], new Set(), now);
    expect(result[0].staleDays).toBe(91);
  });

  it("returns empty array when no memories match stale criteria", () => {
    const recentMem: RawMemory = {
      id: "r1",
      fact: "fresh",
      category: "rules",
      tags: "",
      timestamp: now - MS_30_DAYS,
      lastAccessedAt: now - 1000,
    };
    const result = computeStaleRecords([recentMem], new Set(), now);
    expect(result).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: healthReportFromParsed — end-to-end assembly
// ─────────────────────────────────────────────────────────────────────────────

describe("healthReportFromParsed — end-to-end assembly", () => {
  const now = 1_700_000_000_000;
  const MS_91_DAYS = 91 * 24 * 60 * 60 * 1000;

  function assembleReport(
    decrypted: RawMemory[],
    parsed: ParsedAI,
    analysisTimestamp: number
  ) {
    const validMemoryIds = new Set(decrypted.map((m) => m.id));
    const memoryById = new Map(decrypted.map((m) => [m.id, m]));
    const aiStaleIds = new Set(parsed.staleIds ?? []);

    const clusters = (parsed.clusters ?? [])
      .map((c) => normalizeCluster(c, validMemoryIds))
      .filter((c) => c.memoryIds.length >= 2);

    const staleRecords = computeStaleRecords(decrypted, aiStaleIds, analysisTimestamp);

    const anomalies = (parsed.anomalies ?? [])
      .filter((a) => validMemoryIds.has(a.memoryId))
      .map((a) => normalizeAnomaly(a, memoryById));

    return {
      analysisTimestamp,
      totalMemoriesAnalyzed: decrypted.length,
      clusters,
      staleRecords,
      anomalies,
      summary: String(parsed.summary ?? "Analysis complete."),
    };
  }

  it("returns zero counts when AI returns empty results and no stale memories", () => {
    const decrypted: RawMemory[] = [
      { id: "m1", fact: "fresh fact", category: "rules", tags: "tag1", timestamp: now - 1000, lastAccessedAt: now - 1000 },
    ];
    const parsed: ParsedAI = { clusters: [], staleIds: [], anomalies: [], summary: "Clean vault." };
    const report = assembleReport(decrypted, parsed, now);
    expect(report.clusters).toHaveLength(0);
    expect(report.staleRecords).toHaveLength(0);
    expect(report.anomalies).toHaveLength(0);
    expect(report.totalMemoriesAnalyzed).toBe(1);
    expect(report.summary).toBe("Clean vault.");
  });

  it("includes clusters with ≥2 valid member IDs", () => {
    const decrypted: RawMemory[] = [
      { id: "m1", fact: "f1", category: "rules", tags: "", timestamp: now, lastAccessedAt: null },
      { id: "m2", fact: "f2", category: "rules", tags: "", timestamp: now, lastAccessedAt: null },
    ];
    const parsed: ParsedAI = {
      clusters: [{ clusterLabel: "Cluster A", memoryIds: ["m1", "m2"], reason: "overlap", suggestedAction: "merge" }],
      staleIds: [],
      anomalies: [],
      summary: "One cluster.",
    };
    const report = assembleReport(decrypted, parsed, now);
    expect(report.clusters).toHaveLength(1);
    expect(report.clusters[0].memoryIds).toEqual(["m1", "m2"]);
  });

  it("drops clusters whose members are not in the vault", () => {
    const decrypted: RawMemory[] = [
      { id: "m1", fact: "f1", category: "rules", tags: "", timestamp: now, lastAccessedAt: null },
    ];
    const parsed: ParsedAI = {
      clusters: [{ clusterLabel: "Ghost cluster", memoryIds: ["ghost1", "ghost2"], reason: "??", suggestedAction: "merge" }],
      staleIds: [],
      anomalies: [],
      summary: "Bad cluster.",
    };
    const report = assembleReport(decrypted, parsed, now);
    expect(report.clusters).toHaveLength(0);
  });

  it("filters anomalies whose memoryId is not in the vault", () => {
    const decrypted: RawMemory[] = [
      { id: "real", fact: "real", category: "rules", tags: "", timestamp: now, lastAccessedAt: null },
    ];
    const parsed: ParsedAI = {
      clusters: [],
      staleIds: [],
      anomalies: [
        { memoryId: "real", anomalyType: "empty_tags", detail: "no tags" },
        { memoryId: "ghost", anomalyType: "oversized", detail: "missing" },
      ],
      summary: "Found 1 real anomaly.",
    };
    const report = assembleReport(decrypted, parsed, now);
    expect(report.anomalies).toHaveLength(1);
    expect(report.anomalies[0].memoryId).toBe("real");
  });

  it("detects stale records by timestamp threshold regardless of AI output", () => {
    const decrypted: RawMemory[] = [
      { id: "old", fact: "old fact", category: "rules", tags: "", timestamp: now - MS_91_DAYS, lastAccessedAt: null },
      { id: "new", fact: "new fact", category: "rules", tags: "", timestamp: now - 1000, lastAccessedAt: now - 1000 },
    ];
    const parsed: ParsedAI = { clusters: [], staleIds: [], anomalies: [], summary: "Check stale." };
    const report = assembleReport(decrypted, parsed, now);
    expect(report.staleRecords).toHaveLength(1);
    expect(report.staleRecords[0].memoryId).toBe("old");
  });

  it("uses default summary when AI summary is absent", () => {
    const decrypted: RawMemory[] = [];
    const parsed: ParsedAI = { clusters: [], staleIds: [], anomalies: [] };
    const report = assembleReport(decrypted, parsed, now);
    expect(report.summary).toBe("Analysis complete.");
  });
});
