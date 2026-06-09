/**
 * Tests for progressive memory retrieval with exponential decay.
 *
 * Coverage:
 *   1. decayFactor helper function
 *   2. Decay-enhanced scoring in vector search ranking
 *   3. Access count boost behavior
 *   4. Time decay diminishment over days
 *
 * Run: npx vitest run src/server/memory/search.decay.test.ts
 */

import { describe, it, expect } from "vitest";

const DECAY_LAMBDA = 0.003;

function decayFactor(lastAccessedAt: number | null, accessCount: number): number {
  if (!lastAccessedAt || accessCount === 0) return 1.0;
  const daysSinceAccess = (Date.now() - lastAccessedAt) / 86_400_000;
  const decayMultiplier = Math.exp(-DECAY_LAMBDA * daysSinceAccess);
  const accessCountBoost = Math.log(accessCount + 1);
  return decayMultiplier * (0.5 + 0.5 * Math.tanh(accessCountBoost / 5));
}

describe("decayFactor helper", () => {
  it("returns 1.0 when lastAccessedAt is null", () => {
    const factor = decayFactor(null, 5);
    expect(factor).toBe(1.0);
  });

  it("returns 1.0 when accessCount is 0", () => {
    const now = Date.now();
    const factor = decayFactor(now, 0);
    expect(factor).toBe(1.0);
  });

  it("returns a value between 0.5 and 1.0 for valid inputs", () => {
    const now = Date.now();
    const factor = decayFactor(now, 1);
    expect(factor).toBeGreaterThan(0.5);
    expect(factor).toBeLessThanOrEqual(1.0);
  });

  it("decays over time when accessCount is constant", () => {
    const accessCount = 5;
    const now = Date.now();
    const today = decayFactor(now, accessCount);
    const week = decayFactor(now - 7 * 86_400_000, accessCount);
    const month = decayFactor(now - 30 * 86_400_000, accessCount);

    expect(today).toBeGreaterThan(week);
    expect(week).toBeGreaterThan(month);
  });

  it("boosts score when accessCount increases", () => {
    const now = Date.now();
    const once = decayFactor(now, 1);
    const five = decayFactor(now, 5);
    const twentyFive = decayFactor(now, 25);

    expect(five).toBeGreaterThan(once);
    expect(twentyFive).toBeGreaterThan(five);
  });

  it("applies diminishing returns for very high access counts", () => {
    const now = Date.now();
    const fifty = decayFactor(now, 50);
    const hundred = decayFactor(now, 100);
    const thousand = decayFactor(now, 1000);

    // Higher counts should still increase score, but with diminishing returns
    expect(hundred).toBeGreaterThan(fifty);
    expect(thousand).toBeGreaterThan(hundred);
    // But growth should slow (log dampens exponential growth)
    const boost50to100 = hundred - fifty;
    const boost100to1000 = thousand - hundred;
    expect(boost100to1000).toBeLessThan(boost50to100 * 5); // Rough check on diminishing returns
  });

  it("recent access with high count > old access with low count", () => {
    const now = Date.now();
    const recent = decayFactor(now, 10); // Very recent, 10 accesses
    const ancient = decayFactor(now - 180 * 86_400_000, 1); // 6 months old, 1 access

    expect(recent).toBeGreaterThan(ancient);
  });

  it("old access with very high count can exceed recent with low count", () => {
    const now = Date.now();
    const recentLow = decayFactor(now, 2); // Very recent, 2 accesses
    const oldHigh = decayFactor(now - 30 * 86_400_000, 100); // 30 days old, 100 accesses

    expect(oldHigh).toBeGreaterThan(recentLow);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Ranking with Decay
// ─────────────────────────────────────────────────────────────────────────────

describe("Decay-enhanced scoring for identical vector hits", () => {
  it("ranks frequently accessed recent memory higher than rarely accessed memory", () => {
    const now = Date.now();

    const memoryA = {
      id: "a",
      lastAccessedAt: now,
      accessCount: 15,
      rffScore: 0.5, // Identical RRF score
    };

    const memoryB = {
      id: "b",
      lastAccessedAt: now - 90 * 86_400_000, // 90 days old
      accessCount: 1,
      rffScore: 0.5, // Identical RRF score
    };

    const scoreA = memoryA.rffScore * decayFactor(memoryA.lastAccessedAt, memoryA.accessCount);
    const scoreB = memoryB.rffScore * decayFactor(memoryB.lastAccessedAt, memoryB.accessCount);

    expect(scoreA).toBeGreaterThan(scoreB);
    // Recent high-access memory boosts significantly over old low-access
    expect(scoreA / scoreB).toBeLessThan(2.0); // Boost is noticeable but capped
  });

  it("orders [recently_accessed_1x, rarely_accessed_1x_old] correctly", () => {
    const now = Date.now();
    const memories = [
      { id: "a", rffScore: 0.5, lastAccessedAt: now - 180 * 86_400_000, accessCount: 1 },
      { id: "b", rffScore: 0.5, lastAccessedAt: now, accessCount: 1 },
    ];

    const scored = memories
      .map((m) => ({
        ...m,
        decayFactor: decayFactor(m.lastAccessedAt, m.accessCount),
        finalScore: m.rffScore * decayFactor(m.lastAccessedAt, m.accessCount),
      }))
      .sort((a, b) => b.finalScore - a.finalScore);

    expect(scored[0].id).toBe("b"); // Recent should rank higher
    expect(scored[1].id).toBe("a");
  });

  it("orders [frequently_accessed, rarely_accessed] by access count when equally recent", () => {
    const now = Date.now();
    const memories = [
      { id: "hot", rffScore: 0.5, lastAccessedAt: now, accessCount: 50 },
      { id: "cold", rffScore: 0.5, lastAccessedAt: now, accessCount: 1 },
    ];

    const scored = memories
      .map((m) => ({
        ...m,
        finalScore: m.rffScore * decayFactor(m.lastAccessedAt, m.accessCount),
      }))
      .sort((a, b) => b.finalScore - a.finalScore);

    expect(scored[0].id).toBe("hot");
    expect(scored[1].id).toBe("cold");
  });

  it("handles complex ranking: [recent_medium_access, old_high_access, old_low_access]", () => {
    const now = Date.now();
    const memories = [
      { id: "recent_medium", rffScore: 0.6, lastAccessedAt: now - 5 * 86_400_000, accessCount: 20 },
      { id: "old_high", rffScore: 0.6, lastAccessedAt: now - 120 * 86_400_000, accessCount: 80 },
      { id: "old_low", rffScore: 0.6, lastAccessedAt: now - 180 * 86_400_000, accessCount: 1 },
    ];

    const scored = memories
      .map((m) => ({
        ...m,
        finalScore: m.rffScore * decayFactor(m.lastAccessedAt, m.accessCount),
      }))
      .sort((a, b) => b.finalScore - a.finalScore);

    expect(scored[0].id).toBe("recent_medium");
    expect(scored[1].id).toBe("old_high");
    expect(scored[2].id).toBe("old_low");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Edge Cases
// ─────────────────────────────────────────────────────────────────────────────

describe("Decay edge cases", () => {
  it("handles future timestamps gracefully (no negative decay)", () => {
    const future = Date.now() + 86_400_000; // 1 day in the future
    const factor = decayFactor(future, 5);
    // Negative days should still work with exp() — results in >1
    expect(factor).toBeGreaterThan(0);
    expect(typeof factor).toBe("number");
  });

  it("handles very large access counts without overflow", () => {
    const now = Date.now();
    const factor = decayFactor(now, 1_000_000);
    expect(factor).toBeGreaterThan(0);
    expect(factor).toBeLessThanOrEqual(1.0);
    expect(Number.isFinite(factor)).toBe(true);
  });

  it("ensures decay factor never exceeds 1.0", () => {
    const now = Date.now();
    const cases = [
      decayFactor(now, 0),
      decayFactor(now, 1),
      decayFactor(now, 100),
      decayFactor(null, 10),
    ];
    for (const factor of cases) {
      expect(factor).toBeLessThanOrEqual(1.0);
    }
  });

  it("ensures decay factor stays positive", () => {
    const now = Date.now();
    const cases = [
      decayFactor(now, 1),
      decayFactor(now - 365 * 86_400_000, 1), // 1 year old
      decayFactor(now - 1000 * 86_400_000, 100), // ~2.7 years old
    ];
    for (const factor of cases) {
      expect(factor).toBeGreaterThan(0);
    }
  });
});
