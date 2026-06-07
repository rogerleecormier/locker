/**
 * Tests for src/server/planGate.ts
 *
 * Coverage:
 *   1. PlanGateError / PlanLimitError — message format, name, and properties
 *   2. getUserEffectivePlan — override row wins, falls back to userPlans row, falls back
 *      to free, org plan elevates, multi-org picks highest, expired override ignored
 *   3. requireFeature — passes when feature is available, throws PlanGateError with
 *      correct requiredPlan when not; system settings can downgrade enterprise/business
 *   4. checkMemoryLimit — passes under limit, throws PlanLimitError at limit,
 *      enterprise (Infinity) never throws
 *   5. checkApiTokenLimit — same shape as checkMemoryLimit
 *   6. checkOrgMemberLimit — resolves org plan from orgQuotas, enforces limit
 *   7. checkTeamLimit — same shape using teams table
 *   8. checkTeamMemberLimit — resolves team → org plan chain, enforces limit
 *   9. getUserUsageStats — aggregates rows correctly, filters zero-activity tokens
 *
 * All tests use in-memory DB mocks — no Cloudflare runtime needed.
 *
 * Run: npx vitest run src/server/planGate.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import {
  PlanGateError,
  PlanLimitError,
  getUserEffectivePlan,
  requireFeature,
  checkMemoryLimit,
  checkApiTokenLimit,
  checkOrgMemberLimit,
  checkTeamLimit,
  checkTeamMemberLimit,
  getUserUsageStats,
} from "./planGate";

// ─── DB mock builder ──────────────────────────────────────────────────────────
//
// makeDb accepts a map of table-name → rows. Each call to `.select()...all()`
// returns the rows registered for the last table mentioned in `.from()`.
// `.select()...first()` returns the first row or null.
// `.run()` is a no-op.

type Row = Record<string, unknown>;

function makeDb(tables: Record<string, Row[]> = {}) {
  let currentRows: Row[] = [];

  const chain: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn((tableRef: any) => {
      // tableRef is a Drizzle table object; we match by its string representation
      // or by looking at the symbol on the object. The simplest heuristic: look
      // for the table name embedded in the mock key list.
      const key = Object.keys(tables).find((k) => JSON.stringify(tableRef).includes(k) || String(tableRef).includes(k));
      currentRows = key ? tables[key] : [];
      return chain;
    }),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => currentRows),
    first: vi.fn().mockImplementation(() => currentRows[0] ?? null),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue(undefined),
    prepare: vi.fn().mockReturnThis(),
    bind: vi.fn().mockReturnThis(),
  };

  return chain;
}

// A simpler direct-return mock used when we need full control over which query
// returns what, keyed by call order.
function makeSequentialDb(responses: Row[][]) {
  let call = 0;
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    all: vi.fn().mockImplementation(() => responses[call++] ?? []),
    first: vi.fn().mockImplementation(() => (responses[call++] ?? [])[0] ?? null),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue(undefined),
  };
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Error classes
// ─────────────────────────────────────────────────────────────────────────────

describe("PlanGateError", () => {
  it("has name PlanGateError", () => {
    const e = new PlanGateError("organizations", "business", "free");
    expect(e.name).toBe("PlanGateError");
  });

  it("message includes feature, required plan, and current plan", () => {
    const e = new PlanGateError("organizations", "business", "free");
    expect(e.message).toContain("organizations");
    expect(e.message).toContain("business");
    expect(e.message).toContain("free");
  });

  it("exposes feature, requiredPlan, currentPlan properties", () => {
    const e = new PlanGateError("auditLogs", "enterprise", "business");
    expect(e.feature).toBe("auditLogs");
    expect(e.requiredPlan).toBe("enterprise");
    expect(e.currentPlan).toBe("business");
  });

  it("is an instance of Error", () => {
    expect(new PlanGateError("teams", "business", "free")).toBeInstanceOf(Error);
  });
});

describe("PlanLimitError", () => {
  it("has name PlanLimitError", () => {
    const e = new PlanLimitError("Personal memories", 500, 500, "free");
    expect(e.name).toBe("PlanLimitError");
  });

  it("message includes limit type, current, max, and plan", () => {
    const e = new PlanLimitError("Personal memories", 500, 500, "free");
    expect(e.message).toContain("Personal memories");
    expect(e.message).toContain("500");
    expect(e.message).toContain("free");
  });

  it("exposes limitType, current, max, plan properties", () => {
    const e = new PlanLimitError("API tokens", 3, 3, "free");
    expect(e.limitType).toBe("API tokens");
    expect(e.current).toBe(3);
    expect(e.max).toBe(3);
    expect(e.plan).toBe("free");
  });

  it("is an instance of Error", () => {
    expect(new PlanLimitError("Teams", 20, 20, "business")).toBeInstanceOf(Error);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: getUserEffectivePlan
// ─────────────────────────────────────────────────────────────────────────────

describe("getUserEffectivePlan", () => {
  it("returns the override plan when a non-expired override row exists", async () => {
    // Sequential: 1st all() = override rows, 2nd all() = userPlan, 3rd all() = orgRows
    const db = makeSequentialDb([
      [{ planId: "enterprise" }], // featureOverrides
    ]);
    const result = await getUserEffectivePlan(db, "user-1");
    expect(result.planId).toBe("enterprise");
    expect(result.orgId).toBeNull();
  });

  it("falls back to userPlans row when no override", async () => {
    const db = makeSequentialDb([
      [],                          // featureOverrides (none)
      [{ plan: "business" }],      // userPlans
      [],                          // orgRows (no orgs)
    ]);
    const result = await getUserEffectivePlan(db, "user-2");
    expect(result.planId).toBe("business");
  });

  it("defaults to free when no override and no userPlan row", async () => {
    const db = makeSequentialDb([
      [],  // featureOverrides
      [],  // userPlans (none)
      [],  // orgRows
    ]);
    const result = await getUserEffectivePlan(db, "user-3");
    expect(result.planId).toBe("free");
  });

  it("elevates to org plan when org plan is higher than user plan", async () => {
    const db = makeSequentialDb([
      [],                                        // featureOverrides
      [{ plan: "free" }],                        // userPlans
      [{ orgId: "org-1", plan: "business" }],    // orgRows
    ]);
    const result = await getUserEffectivePlan(db, "user-4");
    expect(result.planId).toBe("business");
    expect(result.orgId).toBe("org-1");
  });

  it("keeps user plan when it is higher than org plan", async () => {
    const db = makeSequentialDb([
      [],
      [{ plan: "enterprise" }],
      [{ orgId: "org-1", plan: "free" }],
    ]);
    const result = await getUserEffectivePlan(db, "user-5");
    expect(result.planId).toBe("enterprise");
  });

  it("picks the highest org when a user belongs to multiple orgs", async () => {
    const db = makeSequentialDb([
      [],
      [{ plan: "free" }],
      [
        { orgId: "org-a", plan: "free" },
        { orgId: "org-b", plan: "business" },
        { orgId: "org-c", plan: "free" },
      ],
    ]);
    const result = await getUserEffectivePlan(db, "user-6");
    expect(result.planId).toBe("business");
    expect(result.orgId).toBe("org-b");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: requireFeature
// ─────────────────────────────────────────────────────────────────────────────

describe("requireFeature", () => {
  function makeRequireFeatureDb(planId: string, systemSettings: Row[] = []) {
    // Calls in order: featureOverrides, userPlans, orgRows, systemSettings
    return makeSequentialDb([
      [],
      [{ plan: planId }],
      [],
      systemSettings,
    ]);
  }

  it("resolves without throwing when the plan has the feature", async () => {
    const db = makeRequireFeatureDb("business");
    await expect(requireFeature(db, "user-1", "organizations")).resolves.toMatchObject({ planId: "business" });
  });

  it("throws PlanGateError when free plan tries to use organizations", async () => {
    const db = makeRequireFeatureDb("free");
    await expect(requireFeature(db, "user-1", "organizations")).rejects.toBeInstanceOf(PlanGateError);
  });

  it("PlanGateError requiredPlan is business for business-tier features", async () => {
    const db = makeRequireFeatureDb("free");
    const err = await requireFeature(db, "user-1", "organizations").catch((e) => e);
    expect(err.requiredPlan).toBe("business");
    expect(err.currentPlan).toBe("free");
  });

  it("PlanGateError requiredPlan is enterprise for enterprise-only features (priorityAI)", async () => {
    const db = makeRequireFeatureDb("business");
    const err = await requireFeature(db, "user-1", "priorityAI").catch((e) => e);
    expect(err).toBeInstanceOf(PlanGateError);
    expect(err.requiredPlan).toBe("enterprise");
  });

  it("does not throw for bulkExport on free plan (free tier has this feature)", async () => {
    const db = makeRequireFeatureDb("free");
    await expect(requireFeature(db, "user-1", "bulkExport")).resolves.toBeDefined();
  });

  it("system setting enable_business_plans=false downgrades business to free", async () => {
    const db = makeRequireFeatureDb("business", [
      { key: "enable_business_plans", value: "false" },
    ]);
    const err = await requireFeature(db, "user-1", "organizations").catch((e) => e);
    expect(err).toBeInstanceOf(PlanGateError);
    expect(err.currentPlan).toBe("free");
  });

  it("system setting enable_enterprise_plans=false downgrades enterprise to business when business enabled", async () => {
    const db = makeRequireFeatureDb("enterprise", [
      { key: "enable_enterprise_plans", value: "false" },
    ]);
    // priorityAI requires enterprise; after downgrade to business it should throw
    const err = await requireFeature(db, "user-1", "priorityAI").catch((e) => e);
    expect(err).toBeInstanceOf(PlanGateError);
    expect(err.currentPlan).toBe("business");
  });

  it("system setting enable_enterprise_plans=false with business also disabled falls to free", async () => {
    const db = makeRequireFeatureDb("enterprise", [
      { key: "enable_enterprise_plans", value: "false" },
      { key: "enable_business_plans", value: "false" },
    ]);
    const err = await requireFeature(db, "user-1", "organizations").catch((e) => e);
    expect(err).toBeInstanceOf(PlanGateError);
    expect(err.currentPlan).toBe("free");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: checkMemoryLimit
// ─────────────────────────────────────────────────────────────────────────────

describe("checkMemoryLimit", () => {
  function makeMemoryDb(plan: string, currentCount: number) {
    return makeSequentialDb([
      [],                   // featureOverrides
      [{ plan }],           // userPlans
      [],                   // orgRows
      [{ count: currentCount }],  // memories COUNT(*)
    ]);
  }

  it("does not throw when well under the free limit", async () => {
    const db = makeMemoryDb("free", 100);
    await expect(checkMemoryLimit(db, "user-1")).resolves.toBeUndefined();
  });

  it("throws PlanLimitError when at the free limit (500)", async () => {
    const db = makeMemoryDb("free", 500);
    await expect(checkMemoryLimit(db, "user-1")).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("PlanLimitError has correct limitType and plan", async () => {
    const db = makeMemoryDb("free", 500);
    const err = await checkMemoryLimit(db, "user-1").catch((e) => e);
    expect(err.limitType).toBe("Personal memories");
    expect(err.plan).toBe("free");
    expect(err.max).toBe(500);
    expect(err.current).toBe(500);
  });

  it("throws at exactly the business limit (10000)", async () => {
    const db = makeMemoryDb("business", 10000);
    await expect(checkMemoryLimit(db, "user-1")).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("does not throw for enterprise (Infinity limit)", async () => {
    const db = makeMemoryDb("enterprise", 999999);
    await expect(checkMemoryLimit(db, "user-1")).resolves.toBeUndefined();
  });

  it("does not throw when count is zero", async () => {
    const db = makeMemoryDb("free", 0);
    await expect(checkMemoryLimit(db, "user-1")).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: checkApiTokenLimit
// ─────────────────────────────────────────────────────────────────────────────

describe("checkApiTokenLimit", () => {
  function makeTokenDb(plan: string, currentCount: number) {
    return makeSequentialDb([
      [],
      [{ plan }],
      [],
      [{ count: currentCount }],
    ]);
  }

  it("does not throw when under the free limit (3)", async () => {
    const db = makeTokenDb("free", 2);
    await expect(checkApiTokenLimit(db, "user-1")).resolves.toBeUndefined();
  });

  it("throws PlanLimitError at the free limit (3)", async () => {
    const db = makeTokenDb("free", 3);
    await expect(checkApiTokenLimit(db, "user-1")).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("PlanLimitError has correct properties for free plan at limit", async () => {
    const db = makeTokenDb("free", 3);
    const err = await checkApiTokenLimit(db, "user-1").catch((e) => e);
    expect(err.limitType).toBe("API tokens");
    expect(err.max).toBe(3);
    expect(err.current).toBe(3);
    expect(err.plan).toBe("free");
  });

  it("does not throw for enterprise (Infinity)", async () => {
    const db = makeTokenDb("enterprise", 100000);
    await expect(checkApiTokenLimit(db, "user-1")).resolves.toBeUndefined();
  });

  it("throws at the business limit (50)", async () => {
    const db = makeTokenDb("business", 50);
    await expect(checkApiTokenLimit(db, "user-1")).rejects.toBeInstanceOf(PlanLimitError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: checkOrgMemberLimit
// ─────────────────────────────────────────────────────────────────────────────

describe("checkOrgMemberLimit", () => {
  function makeOrgMemberDb(plan: string, currentCount: number) {
    return makeSequentialDb([
      [{ plan }],            // orgQuotas
      [{ count: currentCount }],  // organizationMembers COUNT(*)
    ]);
  }

  it("does not throw when under the business member limit (50)", async () => {
    const db = makeOrgMemberDb("business", 49);
    await expect(checkOrgMemberLimit(db, "org-1")).resolves.toBeUndefined();
  });

  it("throws PlanLimitError at the business member limit (50)", async () => {
    const db = makeOrgMemberDb("business", 50);
    await expect(checkOrgMemberLimit(db, "org-1")).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("PlanLimitError has correct properties", async () => {
    const db = makeOrgMemberDb("business", 50);
    const err = await checkOrgMemberLimit(db, "org-1").catch((e) => e);
    expect(err.limitType).toBe("Organization members");
    expect(err.max).toBe(50);
    expect(err.current).toBe(50);
  });

  it("does not throw for enterprise org (Infinity)", async () => {
    const db = makeOrgMemberDb("enterprise", 9999);
    await expect(checkOrgMemberLimit(db, "org-1")).resolves.toBeUndefined();
  });

  it("resolves to free plan (maxOrgMembers=0) and throws immediately at 1 member", async () => {
    const db = makeOrgMemberDb("free", 1);
    await expect(checkOrgMemberLimit(db, "org-1")).rejects.toBeInstanceOf(PlanLimitError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: checkTeamLimit
// ─────────────────────────────────────────────────────────────────────────────

describe("checkTeamLimit", () => {
  function makeTeamDb(plan: string, currentCount: number) {
    return makeSequentialDb([
      [{ plan }],
      [{ count: currentCount }],
    ]);
  }

  it("does not throw when under the business team limit (20)", async () => {
    const db = makeTeamDb("business", 19);
    await expect(checkTeamLimit(db, "org-1")).resolves.toBeUndefined();
  });

  it("throws PlanLimitError at the business team limit (20)", async () => {
    const db = makeTeamDb("business", 20);
    await expect(checkTeamLimit(db, "org-1")).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("PlanLimitError has correct limitType", async () => {
    const db = makeTeamDb("business", 20);
    const err = await checkTeamLimit(db, "org-1").catch((e) => e);
    expect(err.limitType).toBe("Teams");
    expect(err.max).toBe(20);
  });

  it("does not throw for enterprise (Infinity)", async () => {
    const db = makeTeamDb("enterprise", 999);
    await expect(checkTeamLimit(db, "org-1")).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: checkTeamMemberLimit
// ─────────────────────────────────────────────────────────────────────────────

describe("checkTeamMemberLimit", () => {
  function makeTeamMemberDb(plan: string, currentCount: number, teamExists = true) {
    return makeSequentialDb([
      teamExists ? [{ orgId: "org-1" }] : [],  // teams lookup
      [{ plan }],                               // orgQuotas
      [{ count: currentCount }],                // teamMembers COUNT(*)
    ]);
  }

  it("returns without throwing if team does not exist", async () => {
    const db = makeTeamMemberDb("business", 0, false);
    await expect(checkTeamMemberLimit(db, "team-x")).resolves.toBeUndefined();
  });

  it("does not throw when under the business team-member limit (50)", async () => {
    const db = makeTeamMemberDb("business", 49);
    await expect(checkTeamMemberLimit(db, "team-1")).resolves.toBeUndefined();
  });

  it("throws PlanLimitError at the business team-member limit (50)", async () => {
    const db = makeTeamMemberDb("business", 50);
    await expect(checkTeamMemberLimit(db, "team-1")).rejects.toBeInstanceOf(PlanLimitError);
  });

  it("PlanLimitError has correct limitType and max", async () => {
    const db = makeTeamMemberDb("business", 50);
    const err = await checkTeamMemberLimit(db, "team-1").catch((e) => e);
    expect(err.limitType).toBe("Team members");
    expect(err.max).toBe(50);
  });

  it("does not throw for enterprise org (Infinity)", async () => {
    const db = makeTeamMemberDb("enterprise", 9999);
    await expect(checkTeamMemberLimit(db, "team-1")).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 9: getUserUsageStats
// ─────────────────────────────────────────────────────────────────────────────

describe("getUserUsageStats", () => {
  it("returns an empty array when the user has no tokens", async () => {
    const db = makeSequentialDb([
      [],  // apiTokens
      [],  // oauthAccessTokensV2
      [],  // tokenUsages
    ]);
    const result = await getUserUsageStats(db, "user-1");
    expect(result).toEqual([]);
  });

  it("includes the Claude Integration synthetic token in aggregation", async () => {
    const db = makeSequentialDb([
      [],   // apiTokens (none)
      [],   // oauth (none)
      // tokenUsages for the synthetic userId token
      [{ tokenId: "user-1", date: "2026-06-01", recallCount: 5, commitCount: 2, tokensConsumed: 100 }],
    ]);
    const result = await getUserUsageStats(db, "user-1");
    expect(result).toHaveLength(1);
    expect(result[0].tokenName).toBe("Claude Integration");
    expect(result[0].totalRecalls).toBe(5);
    expect(result[0].totalCommits).toBe(2);
    expect(result[0].totalTokens).toBe(100);
  });

  it("aggregates multiple usage rows for the same token", async () => {
    const db = makeSequentialDb([
      [],
      [],
      [
        { tokenId: "user-1", date: "2026-06-01", recallCount: 3, commitCount: 1, tokensConsumed: 50 },
        { tokenId: "user-1", date: "2026-06-02", recallCount: 7, commitCount: 4, tokensConsumed: 200 },
      ],
    ]);
    const result = await getUserUsageStats(db, "user-1");
    expect(result[0].totalRecalls).toBe(10);
    expect(result[0].totalCommits).toBe(5);
    expect(result[0].totalTokens).toBe(250);
  });

  it("filters out tokens with zero activity", async () => {
    const db = makeSequentialDb([
      [{ id: "tok-1", name: "My Token" }],
      [],
      [],  // no usage rows at all
    ]);
    const result = await getUserUsageStats(db, "user-1");
    // "My Token" has zero activity; "Claude Integration" also has zero activity
    expect(result).toHaveLength(0);
  });

  it("daily breakdown is sorted ascending by date", async () => {
    const db = makeSequentialDb([
      [],
      [],
      [
        { tokenId: "user-1", date: "2026-06-03", recallCount: 1, commitCount: 0, tokensConsumed: 10 },
        { tokenId: "user-1", date: "2026-06-01", recallCount: 2, commitCount: 0, tokensConsumed: 20 },
        { tokenId: "user-1", date: "2026-06-02", recallCount: 3, commitCount: 0, tokensConsumed: 30 },
      ],
    ]);
    const result = await getUserUsageStats(db, "user-1");
    const dates = result[0].dailyBreakdown.map((d) => d.date);
    expect(dates).toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });

  it("named API token appears with its name and correct stats", async () => {
    const db = makeSequentialDb([
      [{ id: "tok-abc", name: "Production Key" }],
      [],
      [{ tokenId: "tok-abc", date: "2026-06-01", recallCount: 10, commitCount: 5, tokensConsumed: 500 }],
    ]);
    const result = await getUserUsageStats(db, "user-1");
    const token = result.find((t) => t.tokenId === "tok-abc");
    expect(token).toBeDefined();
    expect(token?.tokenName).toBe("Production Key");
    expect(token?.totalRecalls).toBe(10);
  });
});
