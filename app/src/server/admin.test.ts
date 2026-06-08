/**
 * Tests for src/server/admin.ts
 *
 * Coverage:
 *   grantAdminBusinessComp:
 *     1. Revokes featureOverrides, then updates existing userPlans record to business_comp
 *     2. Revokes featureOverrides, then inserts new userPlans record when none exists
 *
 *   auditAdminPlans:
 *     3. Returns all-zero report when no org members have owner/admin role
 *     4. Counts admins already on business_comp as alreadyCorrect
 *     5. Counts admins already on enterprise as alreadyCorrect
 *     6. Upgrades admins with a non-qualifying plan, counts as upgraded
 *     7. Creates plans for admins with no plan record, counts as created
 *     8. Deduplicates users appearing in multiple orgs (same userId, multiple rows)
 *     9. Mixed scenario: correct + upgraded + created all counted accurately
 *
 * Run: npx vitest run src/server/admin.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { grantAdminBusinessComp, auditAdminPlans } from "./admin";

// ─── Schema mock ──────────────────────────────────────────────────────────────

vi.mock("~/db/schema", () => ({
  userPlans: { userId: "userPlans.userId", plan: "userPlans.plan" },
  featureOverrides: { userId: "featureOverrides.userId" },
  organizationMembers: { userId: "organizationMembers.userId", role: "organizationMembers.role" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, _val: unknown) => ({ type: "eq", _col, _val }),
  inArray: (_col: unknown, _vals: unknown) => ({ type: "inArray", _col, _vals }),
}));

// ─── DB mock builder ──────────────────────────────────────────────────────────

function makeDb({
  orgMembers = [] as { userId: string }[],
  existingPlans = [] as { userId: string; plan: string }[],
  existingUserPlanForGrant = [] as { userId: string }[],
} = {}) {
  const deleteFn = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) });
  const selectFn = vi.fn();
  const updateFn = vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: vi.fn() }) }),
  });
  const insertFn = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ run: vi.fn() }) });

  let selectCallCount = 0;

  selectFn.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          all: vi.fn().mockImplementation(() => {
            // grantAdminBusinessComp inner select (existingUserPlanForGrant)
            return Promise.resolve(existingUserPlanForGrant);
          }),
        }),
        all: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) return Promise.resolve(orgMembers);
          return Promise.resolve(existingPlans);
        }),
      }),
    }),
  }));

  return { delete: deleteFn, select: selectFn, update: updateFn, insert: insertFn };
}

// ─── grantAdminBusinessComp ───────────────────────────────────────────────────

describe("grantAdminBusinessComp", () => {
  it("updates existing userPlans record to business_comp", async () => {
    const db = makeDb({ existingUserPlanForGrant: [{ userId: "u1" }] });
    await grantAdminBusinessComp(db, "u1", "system", "test");

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("inserts new userPlans record when none exists", async () => {
    const db = makeDb({ existingUserPlanForGrant: [] });
    await grantAdminBusinessComp(db, "u2", "system", "test");

    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.update).not.toHaveBeenCalled();
  });
});

// ─── auditAdminPlans ──────────────────────────────────────────────────────────

describe("auditAdminPlans", () => {
  it("returns all zeros when no admin/owner org members exist", async () => {
    const db = makeDb({ orgMembers: [] });
    const result = await auditAdminPlans(db);
    expect(result).toEqual({ totalAdmins: 0, alreadyCorrect: 0, upgraded: 0, created: 0 });
  });

  it("counts business_comp users as alreadyCorrect", async () => {
    const db = makeDb({
      orgMembers: [{ userId: "u1" }],
      existingPlans: [{ userId: "u1", plan: "business_comp" }],
    });
    const result = await auditAdminPlans(db);
    expect(result).toEqual({ totalAdmins: 1, alreadyCorrect: 1, upgraded: 0, created: 0 });
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("counts enterprise users as alreadyCorrect", async () => {
    const db = makeDb({
      orgMembers: [{ userId: "u1" }],
      existingPlans: [{ userId: "u1", plan: "enterprise" }],
    });
    const result = await auditAdminPlans(db);
    expect(result).toEqual({ totalAdmins: 1, alreadyCorrect: 1, upgraded: 0, created: 0 });
  });

  it("upgrades admins on a non-qualifying plan", async () => {
    const db = makeDb({
      orgMembers: [{ userId: "u1" }],
      existingPlans: [{ userId: "u1", plan: "free" }],
      existingUserPlanForGrant: [{ userId: "u1" }],
    });
    const result = await auditAdminPlans(db);
    expect(result).toEqual({ totalAdmins: 1, alreadyCorrect: 0, upgraded: 1, created: 0 });
  });

  it("creates plan for admins with no plan record", async () => {
    const db = makeDb({
      orgMembers: [{ userId: "u1" }],
      existingPlans: [],
      existingUserPlanForGrant: [],
    });
    const result = await auditAdminPlans(db);
    expect(result).toEqual({ totalAdmins: 1, alreadyCorrect: 0, upgraded: 0, created: 1 });
  });

  it("deduplicates users appearing in multiple org roles", async () => {
    // u1 appears twice (e.g. owner in org A and admin in org B)
    const db = makeDb({
      orgMembers: [{ userId: "u1" }, { userId: "u1" }],
      existingPlans: [{ userId: "u1", plan: "business_comp" }],
    });
    const result = await auditAdminPlans(db);
    expect(result.totalAdmins).toBe(1);
    expect(result.alreadyCorrect).toBe(1);
  });

  it("handles mixed scenario: correct + upgraded + created", async () => {
    const db = makeDb({
      orgMembers: [{ userId: "correct" }, { userId: "needs-upgrade" }, { userId: "no-plan" }],
      existingPlans: [
        { userId: "correct", plan: "enterprise" },
        { userId: "needs-upgrade", plan: "business" },
      ],
      existingUserPlanForGrant: [{ userId: "needs-upgrade" }],
    });
    const result = await auditAdminPlans(db);
    expect(result).toEqual({ totalAdmins: 3, alreadyCorrect: 1, upgraded: 1, created: 1 });
  });
});
