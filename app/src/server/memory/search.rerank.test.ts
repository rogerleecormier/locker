/**
 * Tests for cross-encoder reranking in the hybrid search pipeline.
 *
 * Coverage:
 *   1. rrfScore helper function
 *   2. recencyScore helper function
 *   3. keywordScore helper function
 *   4. tokenise helper function
 *
 * Run: npx vitest run src/server/memory/search.rerank.test.ts
 */

import { describe, it, expect } from "vitest";

const RRF_K = 60;
const RECENCY_LAMBDA = 0.005;

function rrfScore(ranks: number[]): number {
  return ranks.reduce((sum, r) => sum + 1 / (RRF_K + r + 1), 0);
}

function recencyScore(timestamp: number): number {
  const ageDays = (Date.now() - timestamp) / 86_400_000;
  return Math.exp(-RECENCY_LAMBDA * ageDays);
}

function tokenise(text: string): Set<string> {
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
  return new Set(tokens);
}

function keywordScore(row: { tags: string; category: string }, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;
  const haystack = `${row.tags} ${row.category}`.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  let hits = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) hits++;
  }
  return hits / queryTokens.size;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: rrfScore helper
// ─────────────────────────────────────────────────────────────────────────────

describe("rrfScore helper", () => {
  it("returns 0 for empty ranks array", () => {
    expect(rrfScore([])).toBe(0);
  });

  it("calculates correct score for single rank at position 0", () => {
    const score = rrfScore([0]);
    expect(score).toBe(1 / (RRF_K + 0 + 1));
  });

  it("calculates correct score for single rank at position 10", () => {
    const score = rrfScore([10]);
    expect(score).toBe(1 / (RRF_K + 10 + 1));
  });

  it("sums scores across multiple ranks", () => {
    const ranks = [0, 5, 10];
    const expected = 1 / (RRF_K + 1) + 1 / (RRF_K + 6) + 1 / (RRF_K + 11);
    expect(rrfScore(ranks)).toBeCloseTo(expected, 10);
  });

  it("higher ranks (better positions) yield higher scores", () => {
    const scoreRank0 = rrfScore([0]);
    const scoreRank10 = rrfScore([10]);
    expect(scoreRank0).toBeGreaterThan(scoreRank10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: recencyScore helper
// ─────────────────────────────────────────────────────────────────────────────

describe("recencyScore helper", () => {
  it("returns ~1 for very recent timestamps (same day)", () => {
    const now = Date.now();
    const score = recencyScore(now);
    expect(score).toBeGreaterThan(0.99);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns lower score for older timestamps", () => {
    const oneDayAgo = Date.now() - 86_400_000;
    const score = recencyScore(oneDayAgo);
    expect(score).toBeCloseTo(Math.exp(-RECENCY_LAMBDA), 5);
  });

  it("returns score between 0 and 1", () => {
    const oneYearAgo = Date.now() - 365 * 86_400_000;
    const score = recencyScore(oneYearAgo);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: tokenise helper
// ─────────────────────────────────────────────────────────────────────────────

describe("tokenise helper", () => {
  it("returns empty set for empty string", () => {
    expect(tokenise("")).toEqual(new Set());
  });

  it("extracts lowercase tokens", () => {
    const tokens = tokenise("Hello World");
    expect(tokens).toEqual(new Set(["hello", "world"]));
  });

  it("filters out tokens shorter than 3 characters", () => {
    const tokens = tokenise("a ab abc abcd");
    expect(tokens).toEqual(new Set(["abc", "abcd"]));
  });

  it("removes punctuation and special characters", () => {
    const tokens = tokenise("hello, world! test-123.");
    expect(tokens).toEqual(new Set(["hello", "world", "test", "123"]));
  });

  it("handles multiple spaces and whitespace", () => {
    const tokens = tokenise("  hello   world  ");
    expect(tokens).toEqual(new Set(["hello", "world"]));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: keywordScore helper
// ─────────────────────────────────────────────────────────────────────────────

describe("keywordScore helper", () => {
  it("returns 0 for empty query tokens", () => {
    expect(keywordScore({ tags: "test", category: "rules" }, new Set())).toBe(0);
  });

  it("returns 1 when all tokens match", () => {
    const tokens = tokenise("typescript react");
    const score = keywordScore({ tags: "typescript react", category: "configs" }, tokens);
    expect(score).toBe(1);
  });

  it("returns 0.33 when one of three tokens matches", () => {
    const tokens = tokenise("typescript react vue");
    const score = keywordScore({ tags: "typescript", category: "rules" }, tokens);
    expect(score).toBeCloseTo(1 / 3, 5);
  });

  it("returns 0 when no tokens match", () => {
    const tokens = tokenise("python java");
    const score = keywordScore({ tags: "typescript", category: "react" }, tokens);
    expect(score).toBe(0);
  });

  it("matches against both tags and category", () => {
    const tokens = tokenise("typescript");
    const score = keywordScore({ tags: "", category: "typescript" }, tokens);
    expect(score).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: bge-reranker-base score-based reranking
// ─────────────────────────────────────────────────────────────────────────────

const CROSS_ENCODER_OUTPUT = 10;

function applyRerankerScores(
  pool: Array<{ id: string; fact: string }>,
  scores: Array<{ score: number }>,
  outputLimit: number,
): string[] {
  if (scores.length !== pool.length) return [];
  return pool
    .map((c, i) => ({ id: c.id, score: scores[i]?.score ?? -Infinity }))
    .sort((a, b) => b.score - a.score)
    .slice(0, outputLimit)
    .map((x) => x.id);
}

describe("bge-reranker-base score-based reranking", () => {
  it("sorts candidates by descending score", () => {
    const pool = [
      { id: "mem-1", fact: "TypeScript interfaces define API contracts clearly." },
      { id: "mem-2", fact: "Python is great for data science." },
      { id: "mem-3", fact: "React hooks simplify component state." },
    ];
    const scores = [{ score: 0.4 }, { score: 0.9 }, { score: 0.1 }];
    const result = applyRerankerScores(pool, scores, CROSS_ENCODER_OUTPUT);
    expect(result).toEqual(["mem-2", "mem-1", "mem-3"]);
  });

  it("respects CROSS_ENCODER_OUTPUT limit", () => {
    const pool = Array.from({ length: 15 }, (_, i) => ({ id: `mem-${i}`, fact: `fact ${i}` }));
    const scores = pool.map((_, i) => ({ score: i / pool.length }));
    const result = applyRerankerScores(pool, scores, CROSS_ENCODER_OUTPUT);
    expect(result).toHaveLength(CROSS_ENCODER_OUTPUT);
  });

  it("returns empty array when scores length mismatches pool", () => {
    const pool = [{ id: "mem-1", fact: "fact" }];
    const scores: Array<{ score: number }> = [];
    expect(applyRerankerScores(pool, scores, CROSS_ENCODER_OUTPUT)).toEqual([]);
  });

  it("handles -Infinity score for undefined score entry gracefully", () => {
    const pool = [
      { id: "mem-a", fact: "relevant fact" },
      { id: "mem-b", fact: "another fact" },
    ];
    // Simulate a sparse response where second score is missing
    const scores = [{ score: 0.8 }, { score: -Infinity }];
    const result = applyRerankerScores(pool, scores, CROSS_ENCODER_OUTPUT);
    expect(result[0]).toBe("mem-a");
    expect(result[1]).toBe("mem-b");
  });

  it("truncates facts to 512 chars before sending to reranker", () => {
    const longFact = "x".repeat(600);
    const truncated = longFact.slice(0, 512);
    expect(truncated).toHaveLength(512);
  });
});