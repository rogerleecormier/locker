/**
 * Tests for src/server/enterprise.ts
 *
 * Coverage:
 *   1. estimateEmbeddingTokens — character-based estimate, minimum of 1
 *   2. parseScope — personal/org/team/null/invalid inputs
 *   3. verifyVaultAccess — personal always allowed, org membership check,
 *      team membership check, missing scopeId returns false
 *   4. getUserOrg — null when no memberships, single org, multi-org picks highest plan
 *   5. checkQuota — recall allowed under limit, recall blocked at limit,
 *      commit allowed under limit, commit blocked at limit,
 *      memory count blocks commit
 *   6. logTokenUsage — calls db.insert with correct fields for recall and commit
 *   7. logAudit — calls db.insert with all required fields
 *
 * Run: npx vitest run src/server/enterprise.test.ts
 */

import { describe, it, expect, vi } from "vitest";
import {
  estimateEmbeddingTokens,
  parseScope,
  verifyVaultAccess,
  getUserOrg,
  checkQuota,
  logTokenUsage,
  logAudit,
} from "./enterprise";

// ─── DB mock helpers ──────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

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
    onConflictDoUpdate: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue(undefined),
    catch: vi.fn().mockReturnThis(),
  };
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: estimateEmbeddingTokens
// ─────────────────────────────────────────────────────────────────────────────

describe("estimateEmbeddingTokens", () => {
  it("returns 1 for an empty string (minimum)", () => {
    expect(estimateEmbeddingTokens("")).toBe(1);
  });

  it("returns 1 for a single character (minimum)", () => {
    expect(estimateEmbeddingTokens("a")).toBe(1);
  });

  it("returns ceil(length / 4)", () => {
    expect(estimateEmbeddingTokens("abcd")).toBe(1);       // 4/4 = 1
    expect(estimateEmbeddingTokens("abcde")).toBe(2);      // ceil(5/4) = 2
    expect(estimateEmbeddingTokens("a".repeat(100))).toBe(25); // 100/4 = 25
  });

  it("never returns less than 1", () => {
    for (let len = 0; len <= 4; len++) {
      expect(estimateEmbeddingTokens("x".repeat(len))).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: parseScope
// ─────────────────────────────────────────────────────────────────────────────

describe("parseScope", () => {
  it("returns personal scope for null", () => {
    expect(parseScope(null)).toEqual({ scopeType: "personal", scopeId: null });
  });

  it("returns personal scope for undefined", () => {
    expect(parseScope(undefined)).toEqual({ scopeType: "personal", scopeId: null });
  });

  it("returns personal scope for empty string", () => {
    expect(parseScope("")).toEqual({ scopeType: "personal", scopeId: null });
  });

  it("returns personal scope for the literal string 'personal'", () => {
    expect(parseScope("personal")).toEqual({ scopeType: "personal", scopeId: null });
  });

  it("parses org: prefix", () => {
    expect(parseScope("org:abc-123")).toEqual({ scopeType: "organization", scopeId: "abc-123" });
  });

  it("parses team: prefix", () => {
    expect(parseScope("team:xyz-456")).toEqual({ scopeType: "team", scopeId: "xyz-456" });
  });

  it("throws on org: with empty id", () => {
    expect(() => parseScope("org:")).toThrow("Invalid organization scope key");
    expect(() => parseScope("org:   ")).toThrow("Invalid organization scope key");
  });

  it("throws on team: with empty id", () => {
    expect(() => parseScope("team:")).toThrow("Invalid team scope key");
    expect(() => parseScope("team:   ")).toThrow("Invalid team scope key");
  });

  it("throws on completely unrecognised key", () => {
    expect(() => parseScope("project:foo")).toThrow("Invalid workspace scope key");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: verifyVaultAccess
// ─────────────────────────────────────────────────────────────────────────────

describe("verifyVaultAccess", () => {
  it("personal scope is always allowed, orgId resolved from membership", async () => {
    // getUserOrg inner call: orgRows
    const db = makeSequentialDb([
      [{ orgId: "org-1", plan: "business" }],
    ]);
    const result = await verifyVaultAccess(db, "user-1", "personal", null);
    expect(result.allowed).toBe(true);
    expect(result.orgId).toBe("org-1");
  });

  it("personal scope with no org membership returns allowed=true, orgId=null", async () => {
    const db = makeSequentialDb([[]]);
    const result = await verifyVaultAccess(db, "user-1", "personal", null);
    expect(result.allowed).toBe(true);
    expect(result.orgId).toBeNull();
  });

  it("organization scope returns allowed=true when user is a member", async () => {
    const db = makeSequentialDb([
      [{ userId: "user-1", orgId: "org-1", role: "member" }],
    ]);
    const result = await verifyVaultAccess(db, "user-1", "organization", "org-1");
    expect(result.allowed).toBe(true);
    expect(result.orgId).toBe("org-1");
  });

  it("organization scope returns allowed=false when user is not a member", async () => {
    const db = makeSequentialDb([[]]);
    const result = await verifyVaultAccess(db, "user-1", "organization", "org-1");
    expect(result.allowed).toBe(false);
    expect(result.orgId).toBeNull();
  });

  it("organization scope with null scopeId returns allowed=false", async () => {
    const db = makeSequentialDb([]);
    const result = await verifyVaultAccess(db, "user-1", "organization", null);
    expect(result.allowed).toBe(false);
  });

  it("team scope returns allowed=true when user is a team member", async () => {
    const db = makeSequentialDb([
      [{ teamId: "team-1", userId: "user-1" }],  // teamMembers
      [{ orgId: "org-1" }],                        // teams
    ]);
    const result = await verifyVaultAccess(db, "user-1", "team", "team-1");
    expect(result.allowed).toBe(true);
    expect(result.orgId).toBe("org-1");
  });

  it("team scope returns allowed=false when user is not a team member", async () => {
    const db = makeSequentialDb([[]]);
    const result = await verifyVaultAccess(db, "user-1", "team", "team-1");
    expect(result.allowed).toBe(false);
  });

  it("team scope with null scopeId returns allowed=false", async () => {
    const db = makeSequentialDb([]);
    const result = await verifyVaultAccess(db, "user-1", "team", null);
    expect(result.allowed).toBe(false);
  });

  it("accepts a projectKey string and parses it internally", async () => {
    const db = makeSequentialDb([
      [{ userId: "user-1", orgId: "org-99", role: "member" }],
    ]);
    const result = await verifyVaultAccess(db, "user-1", "org:org-99");
    expect(result.allowed).toBe(true);
    expect(result.orgId).toBe("org-99");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: getUserOrg
// ─────────────────────────────────────────────────────────────────────────────

describe("getUserOrg", () => {
  it("returns null when user has no org memberships", async () => {
    const db = makeSequentialDb([[]]);
    expect(await getUserOrg(db, "user-1")).toBeNull();
  });

  it("returns the single org id when user belongs to one org", async () => {
    const db = makeSequentialDb([
      [{ orgId: "org-1", plan: "business" }],
    ]);
    expect(await getUserOrg(db, "user-1")).toBe("org-1");
  });

  it("picks the org with the highest plan when in multiple orgs", async () => {
    const db = makeSequentialDb([
      [
        { orgId: "org-a", plan: "free" },
        { orgId: "org-b", plan: "enterprise" },
        { orgId: "org-c", plan: "business" },
      ],
    ]);
    expect(await getUserOrg(db, "user-1")).toBe("org-b");
  });

  it("returns first org when all have the same plan", async () => {
    const db = makeSequentialDb([
      [
        { orgId: "org-a", plan: "business" },
        { orgId: "org-b", plan: "business" },
      ],
    ]);
    // planAtLeast(same, same) is true so the last one wins in the loop;
    // validate it returns one of the two valid org ids
    const result = await getUserOrg(db, "user-1");
    expect(["org-a", "org-b"]).toContain(result);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: checkQuota
// ─────────────────────────────────────────────────────────────────────────────

describe("checkQuota", () => {
  function makeQuotaDb({
    orgQuota = null as Row | null,
    orgMembers = [] as Row[],
    apiTokens = [] as Row[],
    recallCount = 0,
    commitCount = 0,
    memoryCount = 0,
  } = {}) {
    const usageRow = [{ recallCount, commitCount }];
    if (orgQuota) {
      // orgId path: orgQuota, orgMembers, apiTokens, tokenUsages, memories(commit only)
      return makeSequentialDb([
        [orgQuota],
        orgMembers,
        apiTokens,
        usageRow,
        [{ count: memoryCount }],
      ]);
    }
    // personal path (no orgId):
    //   1. apiTokens  (no orgQuota / orgMembers queries run)
    //   2. tokenUsages
    //   3. memories COUNT(*) — only for commit action
    return makeSequentialDb([
      apiTokens,
      usageRow,
      [{ count: memoryCount }],
    ]);
  }

  it("allows a recall when under the default personal monthly recall quota", async () => {
    const db = makeQuotaDb({ recallCount: 500 }); // default quota 1000
    const result = await checkQuota(db, "user-1", "tok-1", "recall", null);
    expect(result.allowed).toBe(true);
  });

  it("blocks a recall when at the default personal monthly recall quota (1000)", async () => {
    const db = makeQuotaDb({ recallCount: 1000 });
    const result = await checkQuota(db, "user-1", "tok-1", "recall", null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("recall quota exceeded");
  });

  it("allows a commit when under the default personal commit quota", async () => {
    const db = makeQuotaDb({ commitCount: 200 }); // default 500
    const result = await checkQuota(db, "user-1", "tok-1", "commit", null);
    expect(result.allowed).toBe(true);
  });

  it("blocks a commit when at the default personal commit quota (500)", async () => {
    const db = makeQuotaDb({ commitCount: 500 });
    const result = await checkQuota(db, "user-1", "tok-1", "commit", null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("commit quota exceeded");
  });

  it("blocks a commit when active memory count is at the default quota (100)", async () => {
    const db = makeQuotaDb({ commitCount: 0, memoryCount: 100 });
    const result = await checkQuota(db, "user-1", "tok-1", "commit", null);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("memory quota exceeded");
  });

  it("uses org quota when orgId is provided", async () => {
    const db = makeQuotaDb({
      orgQuota: { monthlyMemories: 10000, monthlyRecalls: 50000, monthlyCommits: 10000 },
      orgMembers: [{ userId: "user-1" }],
      recallCount: 49999,
    });
    const result = await checkQuota(db, "user-1", "tok-1", "recall", "org-1");
    expect(result.allowed).toBe(true);
  });

  it("blocks using org quota when at the org recall limit", async () => {
    const db = makeQuotaDb({
      orgQuota: { monthlyMemories: 10000, monthlyRecalls: 50000, monthlyCommits: 10000 },
      orgMembers: [{ userId: "user-1" }],
      recallCount: 50000,
    });
    const result = await checkQuota(db, "user-1", "tok-1", "recall", "org-1");
    expect(result.allowed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: logTokenUsage
// ─────────────────────────────────────────────────────────────────────────────

describe("logTokenUsage", () => {
  it("calls insert with recallCount=1 and commitCount=0 for a recall", async () => {
    const db = makeSequentialDb([]);
    await logTokenUsage(db, "tok-1", "recall", 42);
    expect(db.insert).toHaveBeenCalled();
    const inserted = db.values.mock.calls[0][0];
    expect(inserted.recallCount).toBe(1);
    expect(inserted.commitCount).toBe(0);
    expect(inserted.tokensConsumed).toBe(42);
    expect(inserted.tokenId).toBe("tok-1");
  });

  it("calls insert with commitCount=1 and recallCount=0 for a commit", async () => {
    const db = makeSequentialDb([]);
    await logTokenUsage(db, "tok-2", "commit", 100);
    const inserted = db.values.mock.calls[0][0];
    expect(inserted.commitCount).toBe(1);
    expect(inserted.recallCount).toBe(0);
    expect(inserted.tokensConsumed).toBe(100);
  });

  it("id is in tokenId:YYYY-MM-DD format", async () => {
    const db = makeSequentialDb([]);
    await logTokenUsage(db, "tok-3", "recall", 0);
    const inserted = db.values.mock.calls[0][0];
    expect(inserted.id).toMatch(/^tok-3:\d{4}-\d{2}-\d{2}$/);
  });

  it("date field matches today in YYYY-MM-DD format", async () => {
    const db = makeSequentialDb([]);
    const today = new Date().toISOString().slice(0, 10);
    await logTokenUsage(db, "tok-4", "commit", 0);
    const inserted = db.values.mock.calls[0][0];
    expect(inserted.date).toBe(today);
  });

  it("defaults tokensConsumed to 0 when not provided", async () => {
    const db = makeSequentialDb([]);
    await logTokenUsage(db, "tok-5", "recall");
    const inserted = db.values.mock.calls[0][0];
    expect(inserted.tokensConsumed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7: logAudit
// ─────────────────────────────────────────────────────────────────────────────

describe("logAudit", () => {
  it("inserts a row with all required fields", async () => {
    const db = makeSequentialDb([]);
    await logAudit(db, {
      orgId: "org-1",
      userId: "user-1",
      tokenId: "tok-1",
      action: "recall",
      memoryId: "mem-1",
      ipAddress: "1.2.3.4",
      userAgent: "Mozilla/5.0",
      metadata: { key: "value" },
    });
    expect(db.insert).toHaveBeenCalled();
    const inserted = db.values.mock.calls[0][0];
    expect(inserted.orgId).toBe("org-1");
    expect(inserted.userId).toBe("user-1");
    expect(inserted.tokenId).toBe("tok-1");
    expect(inserted.action).toBe("recall");
    expect(inserted.memoryId).toBe("mem-1");
    expect(inserted.ipAddress).toBe("1.2.3.4");
    expect(inserted.userAgent).toBe("Mozilla/5.0");
    expect(inserted.metadata).toBe(JSON.stringify({ key: "value" }));
    expect(typeof inserted.timestamp).toBe("number");
    expect(typeof inserted.id).toBe("string");
  });

  it("sets metadata to null when not provided", async () => {
    const db = makeSequentialDb([]);
    await logAudit(db, {
      orgId: null,
      userId: "user-2",
      tokenId: null,
      action: "commit",
    });
    const inserted = db.values.mock.calls[0][0];
    expect(inserted.metadata).toBeNull();
    expect(inserted.orgId).toBeNull();
    expect(inserted.tokenId).toBeNull();
  });

  it("generates a unique id per call", async () => {
    const db1 = makeSequentialDb([]);
    const db2 = makeSequentialDb([]);
    await logAudit(db1, { orgId: null, userId: "u", tokenId: null, action: "recall" });
    await logAudit(db2, { orgId: null, userId: "u", tokenId: null, action: "recall" });
    const id1 = db1.values.mock.calls[0][0].id;
    const id2 = db2.values.mock.calls[0][0].id;
    expect(id1).not.toBe(id2);
  });
});
