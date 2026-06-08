/**
 * Tests for src/lib/plans.ts
 *
 * Coverage:
 *   1. PLANS shape — every plan has required keys and self-consistent values
 *   2. resolvePlan — known strings map correctly, unknowns fall back to "free"
 *   3. planAtLeast — ordering correctness across all plan pairs
 *   4. planHasFeature — spot-checks against the defined feature matrix
 *   5. getPlanLimits — returns the correct limit object per plan
 *   6. isBusinessOrAbove — correct set membership
 *   7. isStripeBilled — only billed plans return true
 *   8. PLAN_ORDER / SELF_SERVE_PLAN_ORDER — shape and content
 *
 * Run: npx vitest run src/lib/plans.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  PLANS,
  PLAN_ORDER,
  SELF_SERVE_PLAN_ORDER,
  resolvePlan,
  planAtLeast,
  planHasFeature,
  getPlanLimits,
  isBusinessOrAbove,
  isStripeBilled,
  type PlanId,
} from "./plans";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: PLANS shape
// ─────────────────────────────────────────────────────────────────────────────

describe("PLANS", () => {
  const planIds: PlanId[] = ["free", "business", "business_comp", "enterprise"];

  it("defines all four plan ids", () => {
    for (const id of planIds) {
      expect(PLANS[id]).toBeDefined();
    }
  });

  it("each plan id matches its record key", () => {
    for (const id of planIds) {
      expect(PLANS[id].id).toBe(id);
    }
  });

  it("each plan has a non-empty label and price", () => {
    for (const id of planIds) {
      expect(PLANS[id].label.length).toBeGreaterThan(0);
      expect(PLANS[id].price.length).toBeGreaterThan(0);
    }
  });

  it("all limit fields are non-negative numbers or Infinity", () => {
    const limitKeys = [
      "maxMemories", "maxMonthlyRecalls", "maxMonthlyCommits",
      "maxMonthlyTokens", "maxApiTokens", "maxOrgMembers",
      "maxTeams", "maxTeamMembers",
    ] as const;
    for (const id of planIds) {
      for (const key of limitKeys) {
        const val = PLANS[id].limits[key];
        expect(typeof val).toBe("number");
        expect(val >= 0 || val === Infinity).toBe(true);
      }
    }
  });

  it("all feature flags are booleans", () => {
    const featureKeys = [
      "organizations", "teams", "sharedVault", "auditLogs",
      "usageAnalytics", "bulkExport", "priorityAI",
      "customProjectKeys", "crossWorkspaceSearch",
    ] as const;
    for (const id of planIds) {
      for (const key of featureKeys) {
        expect(typeof PLANS[id].features[key]).toBe("boolean");
      }
    }
  });

  it("free plan has no organizations, teams, or sharedVault", () => {
    expect(PLANS.free.features.organizations).toBe(false);
    expect(PLANS.free.features.teams).toBe(false);
    expect(PLANS.free.features.sharedVault).toBe(false);
  });

  it("free plan org/team limits are 0", () => {
    expect(PLANS.free.limits.maxOrgMembers).toBe(0);
    expect(PLANS.free.limits.maxTeams).toBe(0);
    expect(PLANS.free.limits.maxTeamMembers).toBe(0);
  });

  it("enterprise plan has all limits as Infinity", () => {
    const limits = PLANS.enterprise.limits;
    for (const val of Object.values(limits)) {
      expect(val).toBe(Infinity);
    }
  });

  it("enterprise plan has all features enabled", () => {
    const features = PLANS.enterprise.features;
    for (const val of Object.values(features)) {
      expect(val).toBe(true);
    }
  });

  it("business and business_comp have identical limits and features", () => {
    expect(PLANS.business.limits).toEqual(PLANS.business_comp.limits);
    expect(PLANS.business.features).toEqual(PLANS.business_comp.features);
  });

  it("priorityAI is only true for enterprise", () => {
    expect(PLANS.free.features.priorityAI).toBe(false);
    expect(PLANS.business.features.priorityAI).toBe(false);
    expect(PLANS.business_comp.features.priorityAI).toBe(false);
    expect(PLANS.enterprise.features.priorityAI).toBe(true);
  });

  it("bulkExport is true for all plans", () => {
    for (const id of planIds) {
      expect(PLANS[id].features.bulkExport).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: resolvePlan
// ─────────────────────────────────────────────────────────────────────────────

describe("resolvePlan", () => {
  it("returns 'business' for 'business'", () => {
    expect(resolvePlan("business")).toBe("business");
  });

  it("returns 'business_comp' for 'business_comp'", () => {
    expect(resolvePlan("business_comp")).toBe("business_comp");
  });

  it("returns 'enterprise' for 'enterprise'", () => {
    expect(resolvePlan("enterprise")).toBe("enterprise");
  });

  it("returns 'free' for null", () => {
    expect(resolvePlan(null)).toBe("free");
  });

  it("returns 'free' for undefined", () => {
    expect(resolvePlan(undefined)).toBe("free");
  });

  it("returns 'free' for an empty string", () => {
    expect(resolvePlan("")).toBe("free");
  });

  it("returns 'free' for an unrecognised string", () => {
    expect(resolvePlan("pro")).toBe("free");
    expect(resolvePlan("BUSINESS")).toBe("free"); // case-sensitive
    expect(resolvePlan("premium")).toBe("free");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: planAtLeast
// ─────────────────────────────────────────────────────────────────────────────

describe("planAtLeast", () => {
  it("free >= free", () => expect(planAtLeast("free", "free")).toBe(true));
  it("business >= free", () => expect(planAtLeast("business", "free")).toBe(true));
  it("business >= business", () => expect(planAtLeast("business", "business")).toBe(true));
  it("enterprise >= business", () => expect(planAtLeast("enterprise", "business")).toBe(true));
  it("enterprise >= enterprise", () => expect(planAtLeast("enterprise", "enterprise")).toBe(true));

  it("free is NOT >= business", () => expect(planAtLeast("free", "business")).toBe(false));
  it("free is NOT >= enterprise", () => expect(planAtLeast("free", "enterprise")).toBe(false));
  it("business is NOT >= enterprise", () => expect(planAtLeast("business", "enterprise")).toBe(false));

  it("business_comp >= free", () => expect(planAtLeast("business_comp", "free")).toBe(true));
  it("enterprise >= business_comp", () => expect(planAtLeast("enterprise", "business_comp")).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: planHasFeature
// ─────────────────────────────────────────────────────────────────────────────

describe("planHasFeature", () => {
  it("free plan does not have organizations", () => {
    expect(planHasFeature("free", "organizations")).toBe(false);
  });

  it("business plan has organizations", () => {
    expect(planHasFeature("business", "organizations")).toBe(true);
  });

  it("business_comp plan has sharedVault", () => {
    expect(planHasFeature("business_comp", "sharedVault")).toBe(true);
  });

  it("enterprise has priorityAI, business does not", () => {
    expect(planHasFeature("enterprise", "priorityAI")).toBe(true);
    expect(planHasFeature("business", "priorityAI")).toBe(false);
  });

  it("all plans have bulkExport", () => {
    for (const id of ["free", "business", "business_comp", "enterprise"] as PlanId[]) {
      expect(planHasFeature(id, "bulkExport")).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: getPlanLimits
// ─────────────────────────────────────────────────────────────────────────────

describe("getPlanLimits", () => {
  it("returns the exact limits object for free", () => {
    expect(getPlanLimits("free")).toBe(PLANS.free.limits);
  });

  it("free maxMemories is 500", () => {
    expect(getPlanLimits("free").maxMemories).toBe(500);
  });

  it("free maxApiTokens is 3", () => {
    expect(getPlanLimits("free").maxApiTokens).toBe(3);
  });

  it("business maxMemories is 10000", () => {
    expect(getPlanLimits("business").maxMemories).toBe(10000);
  });

  it("enterprise all limits are Infinity", () => {
    const limits = getPlanLimits("enterprise");
    for (const val of Object.values(limits)) {
      expect(val).toBe(Infinity);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: isBusinessOrAbove
// ─────────────────────────────────────────────────────────────────────────────

describe("isBusinessOrAbove", () => {
  it("returns false for free", () => expect(isBusinessOrAbove("free")).toBe(false));
  it("returns true for business", () => expect(isBusinessOrAbove("business")).toBe(true));
  it("returns true for business_comp", () => expect(isBusinessOrAbove("business_comp")).toBe(true));
  it("returns true for enterprise", () => expect(isBusinessOrAbove("enterprise")).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: isStripeBilled
// ─────────────────────────────────────────────────────────────────────────────

describe("isStripeBilled", () => {
  it("returns false for free", () => expect(isStripeBilled("free")).toBe(false));
  it("returns true for business", () => expect(isStripeBilled("business")).toBe(true));
  it("returns false for business_comp (comp is not billed)", () => expect(isStripeBilled("business_comp")).toBe(false));
  it("returns true for enterprise", () => expect(isStripeBilled("enterprise")).toBe(true));
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8: PLAN_ORDER / SELF_SERVE_PLAN_ORDER
// ─────────────────────────────────────────────────────────────────────────────

describe("PLAN_ORDER", () => {
  it("contains all four plan ids", () => {
    expect(PLAN_ORDER).toContain("free");
    expect(PLAN_ORDER).toContain("business");
    expect(PLAN_ORDER).toContain("business_comp");
    expect(PLAN_ORDER).toContain("enterprise");
  });

  it("free comes before business", () => {
    expect(PLAN_ORDER.indexOf("free")).toBeLessThan(PLAN_ORDER.indexOf("business"));
  });

  it("business comes before enterprise", () => {
    expect(PLAN_ORDER.indexOf("business")).toBeLessThan(PLAN_ORDER.indexOf("enterprise"));
  });
});

describe("SELF_SERVE_PLAN_ORDER", () => {
  it("does not include business_comp", () => {
    expect(SELF_SERVE_PLAN_ORDER).not.toContain("business_comp");
  });

  it("includes free, business, and enterprise", () => {
    expect(SELF_SERVE_PLAN_ORDER).toContain("free");
    expect(SELF_SERVE_PLAN_ORDER).toContain("business");
    expect(SELF_SERVE_PLAN_ORDER).toContain("enterprise");
  });
});
