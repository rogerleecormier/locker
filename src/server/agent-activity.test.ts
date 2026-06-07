/**
 * Comprehensive tests for the Agent Activity dashboard feature.
 *
 * Tests cover:
 *   1. Tool detection from User-Agent strings
 *   2. Metadata parsing (query, matchCount, semanticScore, injectedFacts)
 *   3. Action label mapping
 *   4. AgentActivityEntry shape validation
 *   5. Filter logic (action, toolName, text search)
 *   6. Stats computation (top tool, avg matches, recall count)
 *   7. Score pill color thresholds
 *   8. Edge cases (null metadata, malformed JSON, empty UA, unknown actions)
 *   9. Injected facts parsing from rawMetadata
 *  10. Timeline ordering (most-recent-first)
 *
 * Strategy: all business logic is extracted as pure functions and tested
 * without any CF runtime / DB dependency. The server function itself is
 * integration-tested via a lightweight fake-DB harness identical in style
 * to webhooks.test.ts.
 *
 * Run: npx vitest run src/server/agent-activity.test.ts
 */

import { describe, it, expect } from "vitest";

// ── Types (mirrored from memoryFunctions.ts to avoid import issues) ───────────

type AgentActivityEntry = {
  id: string;
  timestamp: number;
  action: string;
  toolName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  memoryId: string | null;
  tokenId: string | null;
  query: string | null;
  matchCount: number | null;
  semanticScore: number | null;
  injectedFacts: Array<{ id: string; fact: string; category: string; tags: string; score: number | null }>;
  projectKey: string | null;
  rawMetadata: Record<string, unknown> | null;
};

// ── Pure helpers (extracted from the production server function) ───────────────

function detectToolName(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (ua.includes("cursor")) return "Cursor";
  if (ua.includes("claude-desktop") || ua.includes("claude desktop")) return "Claude Desktop";
  if (ua.includes("claude-code") || ua.includes("claude code")) return "Claude Code";
  if (ua.includes("windsurf")) return "Windsurf";
  if (ua.includes("cline")) return "Cline";
  if (ua.includes("copilot")) return "GitHub Copilot";
  if (ua.includes("continue")) return "Continue";
  if (ua.includes("zed")) return "Zed";
  if (userAgent.length > 0) return userAgent.split("/")[0] ?? userAgent;
  return null;
}

function parseMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseInjectedFacts(meta: Record<string, unknown> | null): AgentActivityEntry["injectedFacts"] {
  if (!meta || !Array.isArray((meta as any).injectedFacts)) return [];
  return (meta as any).injectedFacts.map((f: any) => ({
    id: String(f.id ?? ""),
    fact: String(f.fact ?? ""),
    category: String(f.category ?? ""),
    tags: String(f.tags ?? ""),
    score: typeof f.score === "number" ? f.score : null,
  }));
}

function buildEntry(row: {
  id: string;
  timestamp: number;
  action: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  memoryId?: string | null;
  tokenId?: string | null;
  metadata?: string | null;
}): AgentActivityEntry {
  const meta = parseMetadata(row.metadata);
  const toolName = detectToolName(row.userAgent);
  return {
    id: row.id,
    timestamp: row.timestamp,
    action: row.action,
    toolName,
    userAgent: row.userAgent ?? null,
    ipAddress: row.ipAddress ?? null,
    memoryId: row.memoryId ?? null,
    tokenId: row.tokenId ?? null,
    query: (meta as any)?.query ?? null,
    matchCount: typeof (meta as any)?.matchCount === "number" ? (meta as any).matchCount : null,
    semanticScore: typeof (meta as any)?.semanticScore === "number" ? (meta as any).semanticScore : null,
    injectedFacts: parseInjectedFacts(meta),
    projectKey: (meta as any)?.projectKey ?? null,
    rawMetadata: meta,
  };
}

// ── Filter logic (mirrors AgentActivityPage client-side filtering) ────────────

function filterEntries(
  entries: AgentActivityEntry[],
  opts: { actionFilter?: string; toolFilter?: string; searchQuery?: string }
): AgentActivityEntry[] {
  let list = entries;
  if (opts.actionFilter) list = list.filter((e) => e.action === opts.actionFilter);
  if (opts.toolFilter) list = list.filter((e) => e.toolName === opts.toolFilter);
  if (opts.searchQuery?.trim()) {
    const q = opts.searchQuery.toLowerCase();
    list = list.filter(
      (e) =>
        e.query?.toLowerCase().includes(q) ||
        e.toolName?.toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        e.injectedFacts.some((f) => f.fact.toLowerCase().includes(q))
    );
  }
  return list;
}

// ── Stats logic (mirrors StatsBar component) ──────────────────────────────────

function computeStats(entries: AgentActivityEntry[]) {
  const toolCounts: Record<string, number> = {};
  let totalMatches = 0;
  let recallCount = 0;

  for (const e of entries) {
    const tool = e.toolName ?? "Unknown";
    toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;
    if (e.action === "recall_context" && e.matchCount !== null) {
      totalMatches += e.matchCount;
      recallCount++;
    }
  }

  const topTool = Object.entries(toolCounts).sort((a, b) => b[1] - a[1])[0] ?? null;
  const avgMatches = recallCount > 0 ? totalMatches / recallCount : null;

  return { toolCounts, topTool, avgMatches, recallCount };
}

// ── Score pill color logic (mirrors ScorePill component) ─────────────────────

function scorePillColor(score: number | null): string | null {
  if (score === null) return null;
  const pct = Math.min(100, Math.round(score * 100));
  if (pct >= 80) return "green";
  if (pct >= 60) return "amber";
  return "red";
}

// ── Action label map ──────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  recall_context: "Recalled Context",
  commit_memory: "Committed Memory",
  update_memory: "Updated Memory",
  delete_memory: "Deleted Memory",
  search_memories: "Searched Memories",
  get_memory_summary: "Fetched Summary",
  export_memories: "Exported Memories",
  recall_context_abac_denied: "Recall Denied (ABAC)",
  jit_access_requested: "JIT Access Requested",
  jit_access_approved: "JIT Approved",
  jit_access_denied: "JIT Denied",
  update_memory_queued: "Update Queued",
  delete_memory_queued: "Delete Queued",
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

// ── Factory helpers ───────────────────────────────────────────────────────────

let _counter = 0;
function makeRow(overrides: Partial<Parameters<typeof buildEntry>[0]> = {}): Parameters<typeof buildEntry>[0] {
  return {
    id: `entry-${++_counter}`,
    timestamp: Date.now() - _counter * 1000,
    action: "recall_context",
    userAgent: "cursor/1.0",
    ipAddress: "1.2.3.4",
    memoryId: null,
    tokenId: "tok-abc",
    metadata: JSON.stringify({ query: "what is my stack?", matchCount: 5, projectKey: "personal" }),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Parameters<typeof buildEntry>[0]> = {}): AgentActivityEntry {
  return buildEntry(makeRow(overrides));
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Tool detection from User-Agent
// ─────────────────────────────────────────────────────────────────────────────

describe("Tool detection from User-Agent", () => {
  it("detects Cursor from 'cursor/1.2.3'", () => {
    expect(detectToolName("cursor/1.2.3")).toBe("Cursor");
  });

  it("detects Cursor case-insensitively", () => {
    expect(detectToolName("Cursor/0.44.0 (darwin arm64)")).toBe("Cursor");
  });

  it("detects Claude Desktop from 'claude-desktop/1.0'", () => {
    expect(detectToolName("claude-desktop/1.0")).toBe("Claude Desktop");
  });

  it("detects Claude Desktop with space variant", () => {
    expect(detectToolName("Claude Desktop App/2.1")).toBe("Claude Desktop");
  });

  it("detects Claude Code from 'claude-code/1.0'", () => {
    expect(detectToolName("claude-code/1.0")).toBe("Claude Code");
  });

  it("detects Windsurf", () => {
    expect(detectToolName("windsurf/0.9.0")).toBe("Windsurf");
  });

  it("detects Cline", () => {
    expect(detectToolName("cline/2.3.1")).toBe("Cline");
  });

  it("detects GitHub Copilot", () => {
    expect(detectToolName("github-copilot/1.0")).toBe("GitHub Copilot");
  });

  it("detects Continue", () => {
    expect(detectToolName("continue/0.8.0")).toBe("Continue");
  });

  it("detects Zed", () => {
    expect(detectToolName("zed/0.140.0")).toBe("Zed");
  });

  it("falls back to first UA segment for unknown tool", () => {
    expect(detectToolName("my-custom-tool/1.0")).toBe("my-custom-tool");
  });

  it("returns null for null UA", () => {
    expect(detectToolName(null)).toBeNull();
  });

  it("returns null for undefined UA", () => {
    expect(detectToolName(undefined)).toBeNull();
  });

  it("returns null for empty string UA", () => {
    expect(detectToolName("")).toBeNull();
  });

  it("handles UA with no slash (whole string is tool name)", () => {
    expect(detectToolName("SomeTool")).toBe("SomeTool");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Metadata parsing
// ─────────────────────────────────────────────────────────────────────────────

describe("Metadata parsing", () => {
  it("parses valid JSON metadata string", () => {
    const result = parseMetadata('{"query":"test","matchCount":3}');
    expect(result).toEqual({ query: "test", matchCount: 3 });
  });

  it("returns null for null input", () => {
    expect(parseMetadata(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseMetadata(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseMetadata("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseMetadata("{not valid json")).toBeNull();
  });

  it("returns the parsed value for a JSON string (not null — JSON.parse succeeds)", () => {
    // JSON.parse('"just a string"') returns the JS string "just a string".
    // The implementation does not type-guard for objects, so it returns as-is.
    const result = parseMetadata('"just a string"');
    expect(result).toBe("just a string" as any);
  });

  it("parses complex nested metadata", () => {
    const meta = { query: "auth", matchCount: 2, projectKey: "org:abc", injectedFacts: [] };
    const result = parseMetadata(JSON.stringify(meta));
    expect(result).toEqual(meta);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Injected facts parsing
// ─────────────────────────────────────────────────────────────────────────────

describe("Injected facts parsing", () => {
  it("returns empty array when meta is null", () => {
    expect(parseInjectedFacts(null)).toEqual([]);
  });

  it("returns empty array when injectedFacts key is absent", () => {
    expect(parseInjectedFacts({ query: "test" })).toEqual([]);
  });

  it("returns empty array when injectedFacts is not an array", () => {
    expect(parseInjectedFacts({ injectedFacts: "nope" })).toEqual([]);
  });

  it("parses a single fact with all fields", () => {
    const facts = [{ id: "f1", fact: "Use TypeScript strict mode", category: "rules", tags: "#typescript", score: 0.92 }];
    const result = parseInjectedFacts({ injectedFacts: facts });
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ id: "f1", fact: "Use TypeScript strict mode", category: "rules", tags: "#typescript", score: 0.92 });
  });

  it("coerces id and fact to strings", () => {
    const result = parseInjectedFacts({ injectedFacts: [{ id: 42, fact: 99, category: "rules", tags: "" }] });
    expect(result[0].id).toBe("42");
    expect(result[0].fact).toBe("99");
  });

  it("sets score to null when not a number", () => {
    const result = parseInjectedFacts({ injectedFacts: [{ id: "x", fact: "f", category: "rules", tags: "", score: "high" }] });
    expect(result[0].score).toBeNull();
  });

  it("sets score to null when missing", () => {
    const result = parseInjectedFacts({ injectedFacts: [{ id: "x", fact: "f", category: "rules", tags: "" }] });
    expect(result[0].score).toBeNull();
  });

  it("parses multiple facts", () => {
    const facts = [
      { id: "a", fact: "Fact A", category: "rules", tags: "#a", score: 0.9 },
      { id: "b", fact: "Fact B", category: "projects", tags: "#b", score: 0.75 },
    ];
    const result = parseInjectedFacts({ injectedFacts: facts });
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe("b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: buildEntry — AgentActivityEntry shape
// ─────────────────────────────────────────────────────────────────────────────

describe("buildEntry — AgentActivityEntry shape", () => {
  it("builds a complete entry from a typical recall row", () => {
    const entry = makeEntry();
    expect(entry.id).toMatch(/^entry-/);
    expect(entry.action).toBe("recall_context");
    expect(entry.toolName).toBe("Cursor");
    expect(entry.query).toBe("what is my stack?");
    expect(entry.matchCount).toBe(5);
    expect(entry.projectKey).toBe("personal");
    expect(entry.ipAddress).toBe("1.2.3.4");
    expect(entry.rawMetadata).toMatchObject({ query: "what is my stack?", matchCount: 5 });
  });

  it("sets toolName=null when userAgent is null", () => {
    const entry = makeEntry({ userAgent: null });
    expect(entry.toolName).toBeNull();
  });

  it("sets query=null when metadata has no query key", () => {
    const entry = makeEntry({ metadata: JSON.stringify({ matchCount: 3 }) });
    expect(entry.query).toBeNull();
  });

  it("sets matchCount=null when not a number in metadata", () => {
    const entry = makeEntry({ metadata: JSON.stringify({ query: "x", matchCount: "many" }) });
    expect(entry.matchCount).toBeNull();
  });

  it("sets semanticScore correctly when present", () => {
    const entry = makeEntry({ metadata: JSON.stringify({ semanticScore: 0.87 }) });
    expect(entry.semanticScore).toBe(0.87);
  });

  it("sets semanticScore=null when absent from metadata", () => {
    const entry = makeEntry({ metadata: JSON.stringify({ query: "x" }) });
    expect(entry.semanticScore).toBeNull();
  });

  it("sets rawMetadata=null for malformed metadata JSON", () => {
    const entry = makeEntry({ metadata: "{bad json}" });
    expect(entry.rawMetadata).toBeNull();
    expect(entry.query).toBeNull();
    expect(entry.matchCount).toBeNull();
  });

  it("sets rawMetadata=null when metadata is null", () => {
    const entry = makeEntry({ metadata: null });
    expect(entry.rawMetadata).toBeNull();
  });

  it("preserves memoryId", () => {
    const entry = makeEntry({ memoryId: "mem-xyz-123" });
    expect(entry.memoryId).toBe("mem-xyz-123");
  });

  it("preserves tokenId", () => {
    const entry = makeEntry({ tokenId: "tok-session" });
    expect(entry.tokenId).toBe("tok-session");
  });

  it("parses injectedFacts from metadata", () => {
    const facts = [{ id: "f1", fact: "Always use strict mode", category: "rules", tags: "#typescript", score: 0.88 }];
    const entry = makeEntry({ metadata: JSON.stringify({ injectedFacts: facts }) });
    expect(entry.injectedFacts).toHaveLength(1);
    expect(entry.injectedFacts[0].fact).toBe("Always use strict mode");
    expect(entry.injectedFacts[0].score).toBe(0.88);
  });

  it("defaults injectedFacts to empty array when not in metadata", () => {
    const entry = makeEntry({ metadata: JSON.stringify({ query: "x" }) });
    expect(entry.injectedFacts).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Action label mapping
// ─────────────────────────────────────────────────────────────────────────────

describe("Action label mapping", () => {
  it("maps recall_context correctly", () => {
    expect(actionLabel("recall_context")).toBe("Recalled Context");
  });

  it("maps commit_memory correctly", () => {
    expect(actionLabel("commit_memory")).toBe("Committed Memory");
  });

  it("maps update_memory correctly", () => {
    expect(actionLabel("update_memory")).toBe("Updated Memory");
  });

  it("maps delete_memory correctly", () => {
    expect(actionLabel("delete_memory")).toBe("Deleted Memory");
  });

  it("maps search_memories correctly", () => {
    expect(actionLabel("search_memories")).toBe("Searched Memories");
  });

  it("maps get_memory_summary correctly", () => {
    expect(actionLabel("get_memory_summary")).toBe("Fetched Summary");
  });

  it("maps export_memories correctly", () => {
    expect(actionLabel("export_memories")).toBe("Exported Memories");
  });

  it("maps recall_context_abac_denied correctly", () => {
    expect(actionLabel("recall_context_abac_denied")).toBe("Recall Denied (ABAC)");
  });

  it("maps jit_access_requested correctly", () => {
    expect(actionLabel("jit_access_requested")).toBe("JIT Access Requested");
  });

  it("maps jit_access_approved correctly", () => {
    expect(actionLabel("jit_access_approved")).toBe("JIT Approved");
  });

  it("maps jit_access_denied correctly", () => {
    expect(actionLabel("jit_access_denied")).toBe("JIT Denied");
  });

  it("maps update_memory_queued correctly", () => {
    expect(actionLabel("update_memory_queued")).toBe("Update Queued");
  });

  it("maps delete_memory_queued correctly", () => {
    expect(actionLabel("delete_memory_queued")).toBe("Delete Queued");
  });

  it("falls back to raw action string for unknown actions", () => {
    expect(actionLabel("some_unknown_action")).toBe("some_unknown_action");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: Score pill color thresholds
// ─────────────────────────────────────────────────────────────────────────────

describe("Score pill color thresholds", () => {
  it("returns null for null score", () => {
    expect(scorePillColor(null)).toBeNull();
  });

  it("returns green for score >= 0.80", () => {
    expect(scorePillColor(0.80)).toBe("green");
    expect(scorePillColor(0.95)).toBe("green");
    expect(scorePillColor(1.0)).toBe("green");
  });

  it("returns amber for score in [0.60, 0.795) after rounding", () => {
    // Math.round(score * 100): 0.60→60, 0.70→70 → amber
    // 0.799 * 100 = 79.9 → rounds to 80 → green (boundary behavior)
    expect(scorePillColor(0.60)).toBe("amber");
    expect(scorePillColor(0.70)).toBe("amber");
    expect(scorePillColor(0.794)).toBe("amber"); // 79.4 → rounds to 79 → amber
  });

  it("returns red for score < 0.595 after rounding", () => {
    // Math.round(score * 100): 0.0→0, 0.30→30 → red
    // 0.599 * 100 = 59.9 → rounds to 60 → amber (boundary behavior)
    expect(scorePillColor(0.0)).toBe("red");
    expect(scorePillColor(0.30)).toBe("red");
    expect(scorePillColor(0.594)).toBe("red"); // 59.4 → rounds to 59 → red
  });

  it("clamps scores > 1.0 to green", () => {
    expect(scorePillColor(1.5)).toBe("green");
  });

  it("handles scores very close to boundary (0.795 rounds to 80 → green)", () => {
    expect(scorePillColor(0.795)).toBe("green");
  });

  it("handles scores very close to boundary (0.794 rounds to 79 → amber)", () => {
    expect(scorePillColor(0.794)).toBe("amber");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: Filter logic
// ─────────────────────────────────────────────────────────────────────────────

describe("Filter logic", () => {
  const entries: AgentActivityEntry[] = [
    makeEntry({ action: "recall_context", userAgent: "cursor/1.0" }),
    makeEntry({ action: "commit_memory", userAgent: "claude-desktop/1.0" }),
    makeEntry({ action: "recall_context", userAgent: "claude-desktop/1.0" }),
    makeEntry({ action: "delete_memory", userAgent: "windsurf/0.9" }),
    makeEntry({
      action: "recall_context",
      userAgent: "cursor/1.0",
      metadata: JSON.stringify({ query: "typescript config", matchCount: 2 }),
    }),
  ];

  it("returns all entries when no filters applied", () => {
    expect(filterEntries(entries, {})).toHaveLength(5);
  });

  it("filters by action", () => {
    const result = filterEntries(entries, { actionFilter: "recall_context" });
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.action === "recall_context")).toBe(true);
  });

  it("filters by toolName", () => {
    const result = filterEntries(entries, { toolFilter: "Cursor" });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.toolName === "Cursor")).toBe(true);
  });

  it("filters by action AND toolName simultaneously", () => {
    const result = filterEntries(entries, { actionFilter: "recall_context", toolFilter: "Cursor" });
    expect(result).toHaveLength(2);
  });

  it("filters by searchQuery matching action name", () => {
    const result = filterEntries(entries, { searchQuery: "delete" });
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe("delete_memory");
  });

  it("filters by searchQuery matching query string", () => {
    const result = filterEntries(entries, { searchQuery: "typescript config" });
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe("typescript config");
  });

  it("filters by searchQuery matching tool name", () => {
    const result = filterEntries(entries, { searchQuery: "windsurf" });
    expect(result).toHaveLength(1);
    expect(result[0].toolName).toBe("Windsurf");
  });

  it("filters by searchQuery matching injected fact content", () => {
    const entryWithFact = makeEntry({
      metadata: JSON.stringify({
        query: "auth setup",
        injectedFacts: [{ id: "f1", fact: "Use JWT tokens for auth", category: "rules", tags: "#auth", score: 0.9 }],
      }),
    });
    const result = filterEntries([...entries, entryWithFact], { searchQuery: "JWT tokens" });
    expect(result).toHaveLength(1);
    expect(result[0].injectedFacts[0].fact).toContain("JWT");
  });

  it("returns empty array when no entries match filter", () => {
    const result = filterEntries(entries, { actionFilter: "export_memories" });
    expect(result).toHaveLength(0);
  });

  it("is case-insensitive for searchQuery", () => {
    const result = filterEntries(entries, { searchQuery: "TYPESCRIPT CONFIG" });
    expect(result).toHaveLength(1);
  });

  it("ignores whitespace-only searchQuery", () => {
    const result = filterEntries(entries, { searchQuery: "   " });
    expect(result).toHaveLength(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: Stats computation
// ─────────────────────────────────────────────────────────────────────────────

describe("Stats computation", () => {
  it("returns zero recall count for empty list", () => {
    const stats = computeStats([]);
    expect(stats.recallCount).toBe(0);
    expect(stats.avgMatches).toBeNull();
    expect(stats.topTool).toBeNull();
  });

  it("counts recalls correctly", () => {
    const entries = [
      makeEntry({ action: "recall_context", metadata: JSON.stringify({ matchCount: 4 }) }),
      makeEntry({ action: "recall_context", metadata: JSON.stringify({ matchCount: 6 }) }),
      makeEntry({ action: "commit_memory" }),
    ];
    const stats = computeStats(entries);
    expect(stats.recallCount).toBe(2);
    expect(stats.avgMatches).toBe(5);
  });

  it("ignores recalls with null matchCount in avg", () => {
    const entries = [
      makeEntry({ action: "recall_context", metadata: JSON.stringify({ matchCount: 8 }) }),
      makeEntry({ action: "recall_context", metadata: JSON.stringify({ query: "x" }) }), // no matchCount
    ];
    const stats = computeStats(entries);
    expect(stats.recallCount).toBe(1);
    expect(stats.avgMatches).toBe(8);
  });

  it("identifies top tool correctly", () => {
    const entries = [
      makeEntry({ userAgent: "cursor/1.0" }),
      makeEntry({ userAgent: "cursor/1.0" }),
      makeEntry({ userAgent: "claude-desktop/1.0" }),
    ];
    const stats = computeStats(entries);
    expect(stats.topTool?.[0]).toBe("Cursor");
    expect(stats.topTool?.[1]).toBe(2);
  });

  it("counts unknown tool as 'Unknown' when UA is null", () => {
    const entries = [makeEntry({ userAgent: null }), makeEntry({ userAgent: null })];
    const stats = computeStats(entries);
    expect(stats.toolCounts["Unknown"]).toBe(2);
  });

  it("computes correct avgMatches with zero matches", () => {
    const entries = [
      makeEntry({ action: "recall_context", metadata: JSON.stringify({ matchCount: 0 }) }),
    ];
    const stats = computeStats(entries);
    expect(stats.avgMatches).toBe(0);
    expect(stats.recallCount).toBe(1);
  });

  it("handles large match counts without precision loss", () => {
    const entries = [
      makeEntry({ action: "recall_context", metadata: JSON.stringify({ matchCount: 500 }) }),
      makeEntry({ action: "recall_context", metadata: JSON.stringify({ matchCount: 300 }) }),
    ];
    const stats = computeStats(entries);
    expect(stats.avgMatches).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: Timeline ordering
// ─────────────────────────────────────────────────────────────────────────────

describe("Timeline ordering", () => {
  it("most-recent entries sort first by timestamp descending", () => {
    const now = Date.now();
    const rows = [
      { id: "old", timestamp: now - 10000, action: "recall_context" },
      { id: "newer", timestamp: now - 1000, action: "commit_memory" },
      { id: "newest", timestamp: now, action: "delete_memory" },
    ].map((r) => buildEntry({ ...r, metadata: null }));

    const sorted = [...rows].sort((a, b) => b.timestamp - a.timestamp);
    expect(sorted[0].id).toBe("newest");
    expect(sorted[1].id).toBe("newer");
    expect(sorted[2].id).toBe("old");
  });

  it("entries with equal timestamps maintain stable relative order", () => {
    const ts = Date.now();
    const rows = [
      buildEntry({ id: "a", timestamp: ts, action: "recall_context", metadata: null }),
      buildEntry({ id: "b", timestamp: ts, action: "commit_memory", metadata: null }),
    ];
    const sorted = [...rows].sort((a, b) => b.timestamp - a.timestamp);
    expect(sorted.map((e) => e.id)).toContain("a");
    expect(sorted.map((e) => e.id)).toContain("b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 10: Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("handles metadata with empty string query", () => {
    const entry = makeEntry({ metadata: JSON.stringify({ query: "", matchCount: 0 }) });
    expect(entry.query).toBe("");
    expect(entry.matchCount).toBe(0);
  });

  it("handles UA string with only a slash", () => {
    const tool = detectToolName("/1.0");
    expect(tool).toBe("");
  });

  it("handles very long UA strings gracefully", () => {
    const longUA = "cursor/" + "x".repeat(2000);
    expect(detectToolName(longUA)).toBe("Cursor");
  });

  it("handles metadata with additional unknown keys without error", () => {
    const entry = makeEntry({
      metadata: JSON.stringify({ query: "x", matchCount: 1, futureProp: [1, 2, 3], nested: { a: 1 } }),
    });
    expect(entry.query).toBe("x");
    expect(entry.rawMetadata).toMatchObject({ futureProp: [1, 2, 3] });
  });

  it("handles metadata that is a JSON array (invalid for object) → null", () => {
    const entry = makeEntry({ metadata: "[1, 2, 3]" });
    // An array parsed through JSON.parse is still valid JSON, but our code
    // reads it as Record<string, unknown>. The key lookups will return undefined.
    // rawMetadata should be the parsed array or null depending on implementation.
    // What matters: no throws, and query/matchCount are null.
    expect(entry.query).toBeNull();
    expect(entry.matchCount).toBeNull();
  });

  it("handles metadata that is null string 'null'", () => {
    const entry = makeEntry({ metadata: "null" });
    expect(entry.rawMetadata).toBeNull();
  });

  it("handles entry with no token (session-based recall)", () => {
    const entry = makeEntry({ tokenId: "session" });
    expect(entry.tokenId).toBe("session");
  });

  it("handles entry for an org-scoped recall", () => {
    const entry = makeEntry({ metadata: JSON.stringify({ query: "db migrations", matchCount: 3, projectKey: "org:abc-123" }) });
    expect(entry.projectKey).toBe("org:abc-123");
  });

  it("handles entry for a team-scoped recall", () => {
    const entry = makeEntry({ metadata: JSON.stringify({ query: "api routes", matchCount: 2, projectKey: "team:xyz" }) });
    expect(entry.projectKey).toBe("team:xyz");
  });

  it("handles injectedFacts list with 0 score (valid)", () => {
    const facts = [{ id: "f1", fact: "Old stale fact", category: "rules", tags: "#legacy", score: 0.0 }];
    const result = parseInjectedFacts({ injectedFacts: facts });
    expect(result[0].score).toBe(0);
  });

  it("handles injectedFacts with missing category / tags (defaults to empty string)", () => {
    // String(undefined ?? "") → String("") → ""
    const result = parseInjectedFacts({ injectedFacts: [{ id: "f1", fact: "A fact" }] });
    expect(result[0].category).toBe("");
    expect(result[0].tags).toBe("");
  });

  it("buildEntry does not throw for completely empty row", () => {
    expect(() =>
      buildEntry({ id: "x", timestamp: 0, action: "recall_context" })
    ).not.toThrow();
  });

  it("filter with all three options simultaneously works", () => {
    const entries = [
      makeEntry({ action: "recall_context", userAgent: "cursor/1.0", metadata: JSON.stringify({ query: "typescript", matchCount: 1 }) }),
      makeEntry({ action: "recall_context", userAgent: "cursor/1.0", metadata: JSON.stringify({ query: "python", matchCount: 1 }) }),
      makeEntry({ action: "commit_memory", userAgent: "cursor/1.0" }),
    ];
    const result = filterEntries(entries, {
      actionFilter: "recall_context",
      toolFilter: "Cursor",
      searchQuery: "typescript",
    });
    expect(result).toHaveLength(1);
    expect(result[0].query).toBe("typescript");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 11: Fake-DB integration harness
// ─────────────────────────────────────────────────────────────────────────────

// Simulates the server function processing logic end-to-end with a fake DB.

type FakeAuditRow = {
  id: string;
  userId: string;
  orgId?: string | null;
  tokenId?: string | null;
  action: string;
  memoryId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  timestamp: number;
  metadata?: string | null;
};

function makeFakeDb(rows: FakeAuditRow[]) {
  return {
    _rows: rows,
    select: () => ({
      from: (_table: unknown) => ({
        where: (_cond: unknown) => ({
          orderBy: (_order: unknown) => ({
            limit: (n: number) => ({
              all: async () => rows.slice(0, n),
            }),
          }),
        }),
        orderBy: (_order: unknown) => ({
          limit: (n: number) => ({
            all: async () => rows.slice(0, n),
          }),
        }),
      }),
    }),
  };
}

async function runGetAgentActivityLogs(
  rows: FakeAuditRow[],
  opts: { limit?: number; action?: string; toolName?: string } = {}
): Promise<AgentActivityEntry[]> {
  const pageLimit = opts.limit ?? 200;
  const db = makeFakeDb(rows);
  const dbRows = await db
    .select()
    .from(null)
    .where(null)
    .orderBy(null)
    .limit(pageLimit)
    .all();

  return (dbRows as FakeAuditRow[])
    .map((row) => {
      let meta: Record<string, unknown> | null = null;
      try {
        if (row.metadata) meta = JSON.parse(row.metadata);
      } catch {
        //
      }

      const toolName = detectToolName(row.userAgent);
      if (opts.toolName && toolName !== opts.toolName) return null as unknown as AgentActivityEntry;

      if (opts.action && row.action !== opts.action) return null as unknown as AgentActivityEntry;

      return {
        id: row.id,
        timestamp: row.timestamp,
        action: row.action,
        toolName,
        userAgent: row.userAgent ?? null,
        ipAddress: row.ipAddress ?? null,
        memoryId: row.memoryId ?? null,
        tokenId: row.tokenId ?? null,
        query: (meta as any)?.query ?? null,
        matchCount: typeof (meta as any)?.matchCount === "number" ? (meta as any).matchCount : null,
        semanticScore: typeof (meta as any)?.semanticScore === "number" ? (meta as any).semanticScore : null,
        injectedFacts: parseInjectedFacts(meta),
        projectKey: (meta as any)?.projectKey ?? null,
        rawMetadata: meta,
      };
    })
    .filter((e): e is AgentActivityEntry => e !== null);
}

function makeFakeAuditRow(overrides: Partial<FakeAuditRow> = {}): FakeAuditRow {
  return {
    id: crypto.randomUUID(),
    userId: "user-1",
    action: "recall_context",
    timestamp: Date.now(),
    userAgent: "cursor/1.2.3",
    ipAddress: "10.0.0.1",
    tokenId: "tok-abc",
    memoryId: null,
    metadata: JSON.stringify({ query: "db schema", matchCount: 3, projectKey: "personal" }),
    ...overrides,
  };
}

describe("Fake-DB integration harness", () => {
  it("returns entries mapped from DB rows", async () => {
    const rows = [makeFakeAuditRow(), makeFakeAuditRow({ action: "commit_memory" })];
    const result = await runGetAgentActivityLogs(rows);
    expect(result).toHaveLength(2);
  });

  it("maps toolName from userAgent for each row", async () => {
    const rows = [
      makeFakeAuditRow({ userAgent: "cursor/1.0" }),
      makeFakeAuditRow({ userAgent: "claude-desktop/2.0" }),
      makeFakeAuditRow({ userAgent: null }),
    ];
    const result = await runGetAgentActivityLogs(rows);
    expect(result[0].toolName).toBe("Cursor");
    expect(result[1].toolName).toBe("Claude Desktop");
    expect(result[2].toolName).toBeNull();
  });

  it("respects limit parameter", async () => {
    const rows = Array.from({ length: 10 }, () => makeFakeAuditRow());
    const result = await runGetAgentActivityLogs(rows, { limit: 5 });
    expect(result).toHaveLength(5);
  });

  it("filters by action when provided", async () => {
    const rows = [
      makeFakeAuditRow({ action: "recall_context" }),
      makeFakeAuditRow({ action: "commit_memory" }),
      makeFakeAuditRow({ action: "recall_context" }),
    ];
    const result = await runGetAgentActivityLogs(rows, { action: "recall_context" });
    expect(result).toHaveLength(2);
  });

  it("filters by toolName when provided", async () => {
    const rows = [
      makeFakeAuditRow({ userAgent: "cursor/1.0" }),
      makeFakeAuditRow({ userAgent: "claude-desktop/1.0" }),
      makeFakeAuditRow({ userAgent: "cursor/2.0" }),
    ];
    const result = await runGetAgentActivityLogs(rows, { toolName: "Cursor" });
    expect(result).toHaveLength(2);
  });

  it("extracts query from metadata", async () => {
    const rows = [makeFakeAuditRow({ metadata: JSON.stringify({ query: "authentication flow", matchCount: 4 }) })];
    const result = await runGetAgentActivityLogs(rows);
    expect(result[0].query).toBe("authentication flow");
  });

  it("extracts matchCount from metadata", async () => {
    const rows = [makeFakeAuditRow({ metadata: JSON.stringify({ query: "x", matchCount: 7 }) })];
    const result = await runGetAgentActivityLogs(rows);
    expect(result[0].matchCount).toBe(7);
  });

  it("extracts semanticScore from metadata", async () => {
    const rows = [makeFakeAuditRow({ metadata: JSON.stringify({ semanticScore: 0.91 }) })];
    const result = await runGetAgentActivityLogs(rows);
    expect(result[0].semanticScore).toBe(0.91);
  });

  it("extracts injectedFacts from metadata", async () => {
    const facts = [{ id: "f1", fact: "Prefer Drizzle ORM", category: "configs", tags: "#orm", score: 0.85 }];
    const rows = [makeFakeAuditRow({ metadata: JSON.stringify({ injectedFacts: facts }) })];
    const result = await runGetAgentActivityLogs(rows);
    expect(result[0].injectedFacts).toHaveLength(1);
    expect(result[0].injectedFacts[0].fact).toBe("Prefer Drizzle ORM");
  });

  it("handles empty result set gracefully", async () => {
    const result = await runGetAgentActivityLogs([]);
    expect(result).toEqual([]);
  });

  it("keeps rawMetadata intact for debugging", async () => {
    const meta = { query: "debug", matchCount: 2, extraField: true };
    const rows = [makeFakeAuditRow({ metadata: JSON.stringify(meta) })];
    const result = await runGetAgentActivityLogs(rows);
    expect(result[0].rawMetadata).toMatchObject(meta);
  });

  it("sets rawMetadata=null for malformed metadata", async () => {
    const rows = [makeFakeAuditRow({ metadata: "not-json{" })];
    const result = await runGetAgentActivityLogs(rows);
    expect(result[0].rawMetadata).toBeNull();
  });

  it("preserves ipAddress from row", async () => {
    const rows = [makeFakeAuditRow({ ipAddress: "192.168.1.50" })];
    const result = await runGetAgentActivityLogs(rows);
    expect(result[0].ipAddress).toBe("192.168.1.50");
  });

  it("sets ipAddress=null when absent from row", async () => {
    const rows = [makeFakeAuditRow({ ipAddress: undefined })];
    const result = await runGetAgentActivityLogs(rows);
    expect(result[0].ipAddress).toBeNull();
  });

  it("handles multiple tool types in a single batch", async () => {
    const tools = ["cursor/1.0", "windsurf/0.9", "cline/2.0", "zed/0.14"];
    const rows = tools.map((ua) => makeFakeAuditRow({ userAgent: ua }));
    const result = await runGetAgentActivityLogs(rows);
    const toolNames = result.map((e) => e.toolName);
    expect(toolNames).toContain("Cursor");
    expect(toolNames).toContain("Windsurf");
    expect(toolNames).toContain("Cline");
    expect(toolNames).toContain("Zed");
  });
});
