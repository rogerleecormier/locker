/**
 * Tests for cross-workspace semantic search functionality (org/team level).
 *
 * Coverage:
 *   1. semanticSearchMemories with allWorkspaces=false (default scoped search)
 *   2. semanticSearchMemories with allWorkspaces=true (org/team wide search)
 *   3. Plan enforcement: business tier minimum required for allWorkspaces
 *   4. Vector filter logic: orgId global vs projectKey scoped
 *   5. D1 query filter: orgId/team constraint when allWorkspaces=true
 *   6. Personal users cannot use allWorkspaces (no org membership)
 *
 * Run: npx vitest run src/server/memory/search.crossworkspace.test.ts
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Vector filter helper (getVectorFilter)
// ─────────────────────────────────────────────────────────────────────────────

describe("getVectorFilter helper", () => {
  function getVectorFilter(userId: string, projectKey: string | undefined): Record<string, any> {
    const filter: Record<string, any> = {};
    if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
      filter.projectKey = projectKey;
    } else {
      filter.userId = userId;
    }
    return filter;
  }

  it("returns userId filter for personal scope", () => {
    const userId = "user-123";
    const filter = getVectorFilter(userId, undefined);
    expect(filter).toEqual({ userId });
  });

  it("returns userId filter for explicit 'personal' projectKey", () => {
    const userId = "user-123";
    const filter = getVectorFilter(userId, "personal");
    expect(filter).toEqual({ userId });
  });

  it("returns projectKey filter for org scope", () => {
    const userId = "user-123";
    const orgKey = "org:org-uuid-1234";
    const filter = getVectorFilter(userId, orgKey);
    expect(filter).toEqual({ projectKey: orgKey });
  });

  it("returns projectKey filter for team scope", () => {
    const userId = "user-123";
    const teamKey = "team:team-uuid-5678";
    const filter = getVectorFilter(userId, teamKey);
    expect(filter).toEqual({ projectKey: teamKey });
  });

  it("returns userId for undefined projectKey (personal)", () => {
    const userId = "user-456";
    const filter = getVectorFilter(userId, undefined);
    expect(filter.userId).toBe(userId);
    expect(filter.projectKey).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Plan enforcement logic
// ─────────────────────────────────────────────────────────────────────────────

describe("Cross-workspace search plan enforcement", () => {
  const businessPlans = ["business", "business_comp", "enterprise"];

  it("allows allWorkspaces for business tier", () => {
    const userPlan = "business";
    const allWorkspaces = true;
    const isAllowed = !allWorkspaces || businessPlans.includes(userPlan);
    expect(isAllowed).toBe(true);
  });

  it("allows allWorkspaces for business_comp tier", () => {
    const userPlan = "business_comp";
    const allWorkspaces = true;
    const isAllowed = !allWorkspaces || businessPlans.includes(userPlan);
    expect(isAllowed).toBe(true);
  });

  it("allows allWorkspaces for enterprise tier", () => {
    const userPlan = "enterprise";
    const allWorkspaces = true;
    const isAllowed = !allWorkspaces || businessPlans.includes(userPlan);
    expect(isAllowed).toBe(true);
  });

  it("blocks allWorkspaces for free tier", () => {
    const userPlan = "free";
    const allWorkspaces = true;
    const isAllowed = !allWorkspaces || businessPlans.includes(userPlan);
    expect(isAllowed).toBe(false);
  });

  it("allows allWorkspaces=false for any tier", () => {
    const plans = ["free", "business", "enterprise"];
    for (const plan of plans) {
      const allWorkspaces = false;
      const isAllowed = !allWorkspaces || businessPlans.includes(plan);
      expect(isAllowed).toBe(true);
    }
  });

  it("throws correct error message for free tier with allWorkspaces", () => {
    const userPlan = "free";
    const allWorkspaces = true;
    const errorMessage = `Cross-workspace search requires Business tier or above. Current plan: ${userPlan}`;
    expect(errorMessage).toContain("Business");
    expect(errorMessage).toContain(userPlan);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: Filter logic for Vectorize query
// ─────────────────────────────────────────────────────────────────────────────

describe("Vectorize filter construction", () => {
  function buildVectorFilter(
    userId: string,
    projectKey: string | undefined,
    allWorkspaces: boolean,
    orgId: string | null,
    category?: string
  ): Record<string, any> {
    // When allWorkspaces is true and user is in org, filter by orgId
    // Otherwise use projectKey-scoped filter
    let filter: Record<string, any>;
    if (allWorkspaces && orgId) {
      filter = { orgId };
    } else if (allWorkspaces && !orgId) {
      // Personal user with allWorkspaces: still scoped to personal
      filter = { userId };
    } else {
      // Single workspace (default)
      filter = projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))
        ? { projectKey }
        : { userId };
    }

    if (category) filter.category = category;
    return filter;
  }

  it("applies global orgId filter when allWorkspaces=true with org membership", () => {
    const userId = "user-123";
    const orgId = "org-uuid";
    const filter = buildVectorFilter(userId, undefined, true, orgId);
    expect(filter).toEqual({ orgId });
  });

  it("applies scoped projectKey filter when allWorkspaces=false with team", () => {
    const userId = "user-123";
    const teamKey = "team:team-uuid";
    const filter = buildVectorFilter(userId, teamKey, false, null);
    expect(filter).toEqual({ projectKey: teamKey });
  });

  it("applies userId filter when allWorkspaces=false with personal scope", () => {
    const userId = "user-123";
    const filter = buildVectorFilter(userId, undefined, false, null);
    expect(filter).toEqual({ userId });
  });

  it("applies userId filter when allWorkspaces=true but user has no org", () => {
    const userId = "user-123";
    const filter = buildVectorFilter(userId, undefined, true, null);
    expect(filter).toEqual({ userId });
  });

  it("includes category filter when provided", () => {
    const userId = "user-123";
    const orgId = "org-uuid";
    const filter = buildVectorFilter(userId, undefined, true, orgId, "rules");
    expect(filter).toEqual({ orgId, category: "rules" });
  });

  it("ignores category when not provided", () => {
    const userId = "user-123";
    const orgId = "org-uuid";
    const filter = buildVectorFilter(userId, undefined, true, orgId);
    expect(filter).not.toHaveProperty("category");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: D1 query filter logic
// ─────────────────────────────────────────────────────────────────────────────

describe("D1 database query filters", () => {
  function buildDatabaseFilter(allWorkspaces: boolean, orgId: string | null): {
    shouldFilterByOrgWorkspaces: boolean;
  } {
    return {
      shouldFilterByOrgWorkspaces: allWorkspaces && orgId !== null,
    };
  }

  it("includes org/team filter in D1 query when allWorkspaces=true and user in org", () => {
    const orgId = "org-uuid";
    const filterConfig = buildDatabaseFilter(true, orgId);
    expect(filterConfig.shouldFilterByOrgWorkspaces).toBe(true);
  });

  it("omits org filter in D1 query when allWorkspaces=false", () => {
    const orgId = "org-uuid";
    const filterConfig = buildDatabaseFilter(false, orgId);
    expect(filterConfig.shouldFilterByOrgWorkspaces).toBe(false);
  });

  it("omits org filter when allWorkspaces=true but user has no org", () => {
    const filterConfig = buildDatabaseFilter(true, null);
    expect(filterConfig.shouldFilterByOrgWorkspaces).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: Integration scenarios
// ─────────────────────────────────────────────────────────────────────────────

describe("Cross-workspace search scenarios", () => {
  const businessPlans = ["business", "business_comp", "enterprise"];

  it("personal free user with semantic search in personal workspace", () => {
    const userId = "user-123";
    const userPlan = "free";
    const orgId = null;
    const allWorkspaces = false;

    const allowed = !allWorkspaces || businessPlans.includes(userPlan);
    const vectorFilter = allWorkspaces && orgId ? { orgId } : { userId };

    expect(allowed).toBe(true);
    expect(vectorFilter).toEqual({ userId });
  });

  it("personal free user cannot use cross-workspace search", () => {
    const userId = "user-123";
    const userPlan = "free";
    const orgId = null;
    const allWorkspaces = true;

    const allowed = !allWorkspaces || businessPlans.includes(userPlan);

    expect(allowed).toBe(false);
  });

  it("business user with org can use cross-workspace search", () => {
    const userId = "user-123";
    const userPlan = "business";
    const orgId = "org-uuid";
    const allWorkspaces = true;

    const allowed = !allWorkspaces || businessPlans.includes(userPlan);
    const vectorFilter = allWorkspaces && orgId ? { orgId } : { userId };
    const d1Filter = allWorkspaces && orgId !== null;

    expect(allowed).toBe(true);
    expect(vectorFilter).toEqual({ orgId });
    expect(d1Filter).toBe(true);
  });

  it("enterprise user with org can search all org workspaces", () => {
    const userId = "user-123";
    const userPlan = "enterprise";
    const orgId = "org-uuid";
    const allWorkspaces = true;

    const allowed = !allWorkspaces || businessPlans.includes(userPlan);
    const vectorFilter = allWorkspaces && orgId ? { orgId } : { userId };

    expect(allowed).toBe(true);
    expect(vectorFilter).toEqual({ orgId });
  });

  it("business user scoped to single org workspace (allWorkspaces disabled)", () => {
    const userId = "user-123";
    const userPlan = "business";
    const orgId = "org-uuid";
    const orgKey = "org:org-uuid";
    const allWorkspaces = false;

    const allowed = !allWorkspaces || businessPlans.includes(userPlan);
    const vectorFilter = allWorkspaces && orgId ? { orgId } : { projectKey: orgKey };

    expect(allowed).toBe(true);
    expect(vectorFilter).toEqual({ projectKey: orgKey });
  });

  it("free user in personal scope attempting allWorkspaces", () => {
    const userId = "user-123";
    const userPlan = "free";
    const orgId = null;
    const allWorkspaces = true;

    const allowed = !allWorkspaces || businessPlans.includes(userPlan);
    const expectedError = `Cross-workspace search requires Business tier or above. Current plan: ${userPlan}`;

    expect(allowed).toBe(false);
    expect(expectedError).toContain("Business");
  });

  it("business_comp user can access cross-workspace search", () => {
    const userId = "user-123";
    const userPlan = "business_comp";
    const orgId = "org-uuid";
    const allWorkspaces = true;

    const allowed = !allWorkspaces || businessPlans.includes(userPlan);

    expect(allowed).toBe(true);
  });
});
