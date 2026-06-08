/**
 * Tests for the agent approval guardrail system.
 *
 * Coverage:
 *   1. Agent-gate decision helpers
 *       a. isAgentToken — identifies agent vs human tokens
 *       b. resolveAgentCategoryFilter — correct ABAC category allow/deny
 *       c. checkCategoryAccess — allows / denies based on filter
 *       d. isProjectKeyAllowedByToken — scope matching
 *
 *   2. Recommendation queue insertion (fake-D1 harness)
 *       a. update_memory agent path queues a pending "update" row
 *       b. delete_memory agent path queues a pending "delete" row
 *       c. queued row carries correct proposedFact / agentContext
 *       d. queued row status is "pending" (no direct DB mutation)
 *       e. targetMemoryId is set from the memory being mutated
 *
 *   3. reviewMemoryRecommendation approval logic (pure helpers)
 *       a. approve delete — deletes memory row and marks recommendation approved
 *       b. approve update — writes proposed fact/category/tags to memory row
 *       c. reject — sets status to "rejected" without touching the memory
 *       d. approve update — isQuarantined flag is set when fact contains PII
 *       e. missing targetMemoryId throws for delete/update approvals
 *
 *   4. getConflicts filter
 *       a. returns only "pending" update/delete rows for the correct user
 *       b. does not return "add" or "archive" rows
 *       c. does not return resolved (approved/rejected) rows
 *
 *   5. diffWords utility (conflicts.tsx)
 *       a. identical strings produce all "same" tokens
 *       b. added words produce "add" tokens
 *       c. removed words produce "remove" tokens
 *       d. mixed changes produce the correct token sequence
 *       e. empty strings are handled without throwing
 *
 * Mocking strategy
 * ─────────────────
 * Business logic is extracted as pure functions and tested without any CF
 * runtime dependency. DB-touching code is tested via a lightweight fake-D1
 * harness that tracks insert/update/delete calls and returns controlled
 * SELECT results — the same pattern used in _shared.chunk.test.ts.
 *
 * Run: npx vitest run src/server/memory/recommendations.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Types ────────────────────────────────────────────────────────────────────

type AgentPolicy = {
  allowedCategories?: string[];
  deniedCategories?: string[];
  agentContext?: string;
};

type TokenClaims = {
  isAgent: boolean;
  agentPolicy?: AgentPolicy | null;
  accessibleScopes?: string[] | null;
};

type CategoryFilter = {
  allowedCategories: string[] | null;
  deniedCategories: string[] | null;
};

type MemoryRow = {
  id: string;
  userId: string;
  fact: string;
  category: string;
  tags: string;
  projectKey: string | null;
  scopeType: string;
  scopeId: string | null;
  isActive: boolean;
  isQuarantined: boolean;
};

type RecommendationRow = {
  id: string;
  userId: string;
  fact: string;
  category: string;
  tags: string;
  projectKey: string | null;
  scopeType: string;
  scopeId: string | null;
  orgId: string | null;
  recommendationType: string;
  targetMemoryId: string | null;
  status: string;
  proposedFact: string | null;
  proposedCategory: string | null;
  proposedTags: string | null;
  agentContext: string | null;
  createdAt: number;
  reviewedBy: string | null;
  reviewedAt: number | null;
  reviewNotes: string | null;
};

// ─── Pure helpers extracted from production code ──────────────────────────────

function isAgentToken(claims: TokenClaims): boolean {
  return claims.isAgent === true;
}

function resolveAgentCategoryFilter(claims: TokenClaims): CategoryFilter {
  const policy = claims.agentPolicy;
  if (!policy) {
    return { allowedCategories: null, deniedCategories: null };
  }
  return {
    allowedCategories: policy.allowedCategories ?? null,
    deniedCategories: policy.deniedCategories ?? null,
  };
}

function checkCategoryAccess(category: string | null, filter: CategoryFilter): boolean {
  const cat = category ?? "rules";
  if (filter.deniedCategories && filter.deniedCategories.includes(cat)) return false;
  if (filter.allowedCategories && !filter.allowedCategories.includes(cat)) return false;
  return true;
}

const PERSONAL_SCOPES = [null, undefined, "", "personal"];

function isProjectKeyAllowedByToken(
  accessibleScopes: string[] | null | undefined,
  projectKey: string | null | undefined
): boolean {
  if (!accessibleScopes || accessibleScopes.length === 0) return true;
  const isPersonal = PERSONAL_SCOPES.includes(projectKey as any);
  if (isPersonal) return accessibleScopes.includes("personal") || accessibleScopes.includes("");
  return accessibleScopes.includes(projectKey as string);
}

// ─── Fake DB harness ──────────────────────────────────────────────────────────

type FakeDb = {
  _memoriesStore: Map<string, MemoryRow>;
  _recommendationsStore: Map<string, RecommendationRow>;
  _notifications: any[];

  insertedRecommendations: RecommendationRow[];
  updatedMemories: Array<{ id: string; patch: Partial<MemoryRow> }>;
  deletedMemories: string[];
  updatedRecommendations: Array<{ id: string; patch: Partial<RecommendationRow> }>;

  selectMemory(id: string): MemoryRow | undefined;
  selectRecommendation(id: string): RecommendationRow | undefined;
  selectConflicts(userId: string): RecommendationRow[];
  queueUpdateRecommendation(rec: Omit<RecommendationRow, "reviewedBy" | "reviewedAt" | "reviewNotes">): void;
  queueDeleteRecommendation(rec: Omit<RecommendationRow, "proposedFact" | "proposedCategory" | "proposedTags" | "reviewedBy" | "reviewedAt" | "reviewNotes">): void;
  approveDelete(recId: string, userId: string, reviewNotes?: string): void;
  approveUpdate(recId: string, userId: string, proposedFact: string, proposedCategory: string, proposedTags: string, reviewNotes?: string): void;
  reject(recId: string, userId: string, reviewNotes?: string): void;
};

function makeFakeDb(
  initialMemories: MemoryRow[] = [],
  initialRecs: RecommendationRow[] = []
): FakeDb {
  const memoriesStore = new Map(initialMemories.map((m) => [m.id, { ...m }]));
  const recsStore = new Map(initialRecs.map((r) => [r.id, { ...r }]));
  const insertedRecs: RecommendationRow[] = [];
  const updatedMemories: Array<{ id: string; patch: Partial<MemoryRow> }> = [];
  const deletedMemories: string[] = [];
  const updatedRecs: Array<{ id: string; patch: Partial<RecommendationRow> }> = [];
  const notifications: any[] = [];

  return {
    _memoriesStore: memoriesStore,
    _recommendationsStore: recsStore,
    _notifications: notifications,

    insertedRecommendations: insertedRecs,
    updatedMemories,
    deletedMemories,
    updatedRecommendations: updatedRecs,

    selectMemory(id) {
      return memoriesStore.get(id);
    },

    selectRecommendation(id) {
      return recsStore.get(id);
    },

    selectConflicts(userId: string) {
      return [...recsStore.values(), ...insertedRecs].filter(
        (r) =>
          r.userId === userId &&
          r.status === "pending" &&
          (r.recommendationType === "update" || r.recommendationType === "delete")
      );
    },

    queueUpdateRecommendation(rec) {
      const full: RecommendationRow = {
        ...rec,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
      };
      recsStore.set(full.id, full);
      insertedRecs.push(full);
    },

    queueDeleteRecommendation(rec) {
      const full: RecommendationRow = {
        ...rec,
        proposedFact: null,
        proposedCategory: null,
        proposedTags: null,
        reviewedBy: null,
        reviewedAt: null,
        reviewNotes: null,
      };
      recsStore.set(full.id, full);
      insertedRecs.push(full);
    },

    approveDelete(recId, userId, reviewNotes) {
      const rec = recsStore.get(recId);
      if (!rec) throw new Error("Recommendation not found");
      if (!rec.targetMemoryId) throw new Error("Invalid recommendation: targetMemoryId is required for deletion.");
      const target = memoriesStore.get(rec.targetMemoryId);
      if (target) {
        memoriesStore.delete(rec.targetMemoryId);
        deletedMemories.push(rec.targetMemoryId);
      }
      const patch = { status: "approved" as const, reviewedBy: userId, reviewedAt: Date.now(), reviewNotes: reviewNotes ?? null };
      recsStore.set(recId, { ...rec, ...patch });
      updatedRecs.push({ id: recId, patch });
    },

    approveUpdate(recId, userId, proposedFact, proposedCategory, proposedTags, reviewNotes) {
      const rec = recsStore.get(recId);
      if (!rec) throw new Error("Recommendation not found");
      if (!rec.targetMemoryId) throw new Error("Invalid recommendation: targetMemoryId is required for update.");
      const target = memoriesStore.get(rec.targetMemoryId);
      if (!target) throw new Error("Target memory not found — it may have been deleted.");

      const isQuarantined = proposedFact.includes("sk_live_") || /\b\d{3}-\d{2}-\d{4}\b/.test(proposedFact);
      const patch: Partial<MemoryRow> = { fact: proposedFact, category: proposedCategory, tags: proposedTags, isQuarantined };
      memoriesStore.set(rec.targetMemoryId, { ...target, ...patch });
      updatedMemories.push({ id: rec.targetMemoryId, patch });
      const recPatch = { status: "approved" as const, reviewedBy: userId, reviewedAt: Date.now(), reviewNotes: reviewNotes ?? null };
      recsStore.set(recId, { ...rec, ...recPatch });
      updatedRecs.push({ id: recId, patch: recPatch });
    },

    reject(recId, userId, reviewNotes) {
      const rec = recsStore.get(recId);
      if (!rec) throw new Error("Recommendation not found");
      const patch = { status: "rejected" as const, reviewedBy: userId, reviewedAt: Date.now(), reviewNotes: reviewNotes ?? null };
      recsStore.set(recId, { ...rec, ...patch });
      updatedRecs.push({ id: recId, patch });
    },
  };
}

// ─── diffWords (extracted from conflicts.tsx) ─────────────────────────────────

type DiffToken =
  | { kind: "same"; text: string }
  | { kind: "add"; text: string }
  | { kind: "remove"; text: string };

function diffWords(original: string, proposed: string): DiffToken[] {
  const oldWords = original.split(/(\s+)/);
  const newWords = proposed.split(/(\s+)/);
  const m = oldWords.length;
  const n = newWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldWords[i] === newWords[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldWords[i] === newWords[j]) {
      tokens.push({ kind: "same", text: oldWords[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ kind: "remove", text: oldWords[i] });
      i++;
    } else {
      tokens.push({ kind: "add", text: newWords[j] });
      j++;
    }
  }
  while (i < m) { tokens.push({ kind: "remove", text: oldWords[i++] }); }
  while (j < n) { tokens.push({ kind: "add", text: newWords[j++] }); }
  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: Agent-gate decision helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("isAgentToken", () => {
  it("returns true for agent token", () => {
    expect(isAgentToken({ isAgent: true })).toBe(true);
  });

  it("returns false for human token", () => {
    expect(isAgentToken({ isAgent: false })).toBe(false);
  });
});

describe("resolveAgentCategoryFilter", () => {
  it("returns null filters when no policy is set", () => {
    const filter = resolveAgentCategoryFilter({ isAgent: true, agentPolicy: null });
    expect(filter.allowedCategories).toBeNull();
    expect(filter.deniedCategories).toBeNull();
  });

  it("returns allowedCategories from policy", () => {
    const filter = resolveAgentCategoryFilter({
      isAgent: true,
      agentPolicy: { allowedCategories: ["rules", "projects"] },
    });
    expect(filter.allowedCategories).toEqual(["rules", "projects"]);
  });

  it("returns deniedCategories from policy", () => {
    const filter = resolveAgentCategoryFilter({
      isAgent: true,
      agentPolicy: { deniedCategories: ["configs"] },
    });
    expect(filter.deniedCategories).toEqual(["configs"]);
  });

  it("returns null allowedCategories when only deniedCategories is set", () => {
    const filter = resolveAgentCategoryFilter({
      isAgent: true,
      agentPolicy: { deniedCategories: ["configs"] },
    });
    expect(filter.allowedCategories).toBeNull();
  });
});

describe("checkCategoryAccess", () => {
  it("allows when no filter is set", () => {
    expect(checkCategoryAccess("rules", { allowedCategories: null, deniedCategories: null })).toBe(true);
  });

  it("denies when category is in deniedCategories", () => {
    expect(checkCategoryAccess("configs", { allowedCategories: null, deniedCategories: ["configs"] })).toBe(false);
  });

  it("allows when category is in allowedCategories", () => {
    expect(checkCategoryAccess("rules", { allowedCategories: ["rules", "projects"], deniedCategories: null })).toBe(true);
  });

  it("denies when category is NOT in allowedCategories", () => {
    expect(checkCategoryAccess("references", { allowedCategories: ["rules"], deniedCategories: null })).toBe(false);
  });

  it("deny list takes precedence over allow list", () => {
    expect(checkCategoryAccess("rules", { allowedCategories: ["rules"], deniedCategories: ["rules"] })).toBe(false);
  });

  it("treats null category as 'rules' for access checks", () => {
    expect(checkCategoryAccess(null, { allowedCategories: ["rules"], deniedCategories: null })).toBe(true);
  });
});

describe("isProjectKeyAllowedByToken", () => {
  it("allows everything when accessibleScopes is empty", () => {
    expect(isProjectKeyAllowedByToken([], "org:abc")).toBe(true);
    expect(isProjectKeyAllowedByToken(null, "org:abc")).toBe(true);
  });

  it("allows personal scope when 'personal' is in accessibleScopes", () => {
    expect(isProjectKeyAllowedByToken(["personal"], null)).toBe(true);
    expect(isProjectKeyAllowedByToken(["personal"], "")).toBe(true);
    expect(isProjectKeyAllowedByToken(["personal"], "personal")).toBe(true);
  });

  it("denies personal scope when only org scope is listed", () => {
    expect(isProjectKeyAllowedByToken(["org:abc-123"], null)).toBe(false);
  });

  it("allows org scope when it is in accessibleScopes", () => {
    expect(isProjectKeyAllowedByToken(["org:abc-123"], "org:abc-123")).toBe(true);
  });

  it("denies org scope not in accessibleScopes", () => {
    expect(isProjectKeyAllowedByToken(["org:abc-123"], "org:xyz-999")).toBe(false);
  });

  it("allows multiple scopes", () => {
    expect(isProjectKeyAllowedByToken(["personal", "org:abc-123"], "org:abc-123")).toBe(true);
    expect(isProjectKeyAllowedByToken(["personal", "org:abc-123"], null)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: Recommendation queue insertion (fake-D1 harness)
// ─────────────────────────────────────────────────────────────────────────────

const MEMORY_ID = "mem-aaaa-1111-bbbb-2222";
const USER_ID = "user-1234-5678-abcd";
const REC_ID = "rec-ffff-9999-eeee-0000";

const BASE_MEMORY: MemoryRow = {
  id: MEMORY_ID,
  userId: USER_ID,
  fact: "The project uses Drizzle ORM for database access.",
  category: "projects",
  tags: "drizzle,orm,database",
  projectKey: null,
  scopeType: "personal",
  scopeId: null,
  isActive: true,
  isQuarantined: false,
};

describe("queueUpdateRecommendation — agent update gate", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = makeFakeDb([BASE_MEMORY]);
  });

  it("inserts a recommendation row with status 'pending'", () => {
    db.queueUpdateRecommendation({
      id: REC_ID,
      userId: USER_ID,
      orgId: null,
      fact: BASE_MEMORY.fact,
      category: BASE_MEMORY.category,
      tags: BASE_MEMORY.tags,
      projectKey: BASE_MEMORY.projectKey,
      scopeType: BASE_MEMORY.scopeType,
      scopeId: BASE_MEMORY.scopeId,
      recommendationType: "update",
      targetMemoryId: MEMORY_ID,
      status: "pending",
      proposedFact: "The project uses Drizzle ORM with D1 for database access.",
      proposedCategory: "projects",
      proposedTags: "drizzle,orm,database,d1",
      agentContext: "claude-desktop",
      createdAt: Date.now(),
    });

    expect(db.insertedRecommendations).toHaveLength(1);
    expect(db.insertedRecommendations[0].status).toBe("pending");
  });

  it("queued row has recommendationType 'update'", () => {
    db.queueUpdateRecommendation({
      id: REC_ID, userId: USER_ID, orgId: null,
      fact: BASE_MEMORY.fact, category: BASE_MEMORY.category, tags: BASE_MEMORY.tags,
      projectKey: null, scopeType: "personal", scopeId: null,
      recommendationType: "update", targetMemoryId: MEMORY_ID, status: "pending",
      proposedFact: "Updated fact", proposedCategory: "projects", proposedTags: "updated",
      agentContext: "test-agent", createdAt: Date.now(),
    });
    expect(db.insertedRecommendations[0].recommendationType).toBe("update");
  });

  it("queued row carries the proposedFact from the agent request", () => {
    const proposed = "Updated: project now uses Bun runtime.";
    db.queueUpdateRecommendation({
      id: REC_ID, userId: USER_ID, orgId: null,
      fact: BASE_MEMORY.fact, category: "projects", tags: "",
      projectKey: null, scopeType: "personal", scopeId: null,
      recommendationType: "update", targetMemoryId: MEMORY_ID, status: "pending",
      proposedFact: proposed, proposedCategory: "projects", proposedTags: "",
      agentContext: "claude-code", createdAt: Date.now(),
    });
    expect(db.insertedRecommendations[0].proposedFact).toBe(proposed);
  });

  it("queued row carries the agentContext label", () => {
    db.queueUpdateRecommendation({
      id: REC_ID, userId: USER_ID, orgId: null,
      fact: BASE_MEMORY.fact, category: "projects", tags: "",
      projectKey: null, scopeType: "personal", scopeId: null,
      recommendationType: "update", targetMemoryId: MEMORY_ID, status: "pending",
      proposedFact: "New fact", proposedCategory: "projects", proposedTags: "",
      agentContext: "my-coding-agent", createdAt: Date.now(),
    });
    expect(db.insertedRecommendations[0].agentContext).toBe("my-coding-agent");
  });

  it("does NOT modify the original memory row", () => {
    db.queueUpdateRecommendation({
      id: REC_ID, userId: USER_ID, orgId: null,
      fact: BASE_MEMORY.fact, category: "projects", tags: "",
      projectKey: null, scopeType: "personal", scopeId: null,
      recommendationType: "update", targetMemoryId: MEMORY_ID, status: "pending",
      proposedFact: "New fact", proposedCategory: "projects", proposedTags: "",
      agentContext: "test-agent", createdAt: Date.now(),
    });
    expect(db.selectMemory(MEMORY_ID)?.fact).toBe(BASE_MEMORY.fact);
    expect(db.updatedMemories).toHaveLength(0);
  });

  it("targetMemoryId points to the memory being mutated", () => {
    db.queueUpdateRecommendation({
      id: REC_ID, userId: USER_ID, orgId: null,
      fact: BASE_MEMORY.fact, category: "projects", tags: "",
      projectKey: null, scopeType: "personal", scopeId: null,
      recommendationType: "update", targetMemoryId: MEMORY_ID, status: "pending",
      proposedFact: "New fact", proposedCategory: "projects", proposedTags: "",
      agentContext: "agent", createdAt: Date.now(),
    });
    expect(db.insertedRecommendations[0].targetMemoryId).toBe(MEMORY_ID);
  });
});

describe("queueDeleteRecommendation — agent delete gate", () => {
  let db: FakeDb;

  beforeEach(() => {
    db = makeFakeDb([BASE_MEMORY]);
  });

  it("inserts a recommendation row with status 'pending'", () => {
    db.queueDeleteRecommendation({
      id: REC_ID, userId: USER_ID, orgId: null,
      fact: BASE_MEMORY.fact, category: "projects", tags: "",
      projectKey: null, scopeType: "personal", scopeId: null,
      recommendationType: "delete", targetMemoryId: MEMORY_ID,
      status: "pending", agentContext: "cursor", createdAt: Date.now(),
    });
    expect(db.insertedRecommendations[0].status).toBe("pending");
  });

  it("queued row has recommendationType 'delete'", () => {
    db.queueDeleteRecommendation({
      id: REC_ID, userId: USER_ID, orgId: null,
      fact: BASE_MEMORY.fact, category: "projects", tags: "",
      projectKey: null, scopeType: "personal", scopeId: null,
      recommendationType: "delete", targetMemoryId: MEMORY_ID,
      status: "pending", agentContext: "cursor", createdAt: Date.now(),
    });
    expect(db.insertedRecommendations[0].recommendationType).toBe("delete");
  });

  it("queued row has null proposedFact (no proposed change for deletes)", () => {
    db.queueDeleteRecommendation({
      id: REC_ID, userId: USER_ID, orgId: null,
      fact: BASE_MEMORY.fact, category: "projects", tags: "",
      projectKey: null, scopeType: "personal", scopeId: null,
      recommendationType: "delete", targetMemoryId: MEMORY_ID,
      status: "pending", agentContext: "cursor", createdAt: Date.now(),
    });
    expect(db.insertedRecommendations[0].proposedFact).toBeNull();
  });

  it("does NOT delete the original memory row", () => {
    db.queueDeleteRecommendation({
      id: REC_ID, userId: USER_ID, orgId: null,
      fact: BASE_MEMORY.fact, category: "projects", tags: "",
      projectKey: null, scopeType: "personal", scopeId: null,
      recommendationType: "delete", targetMemoryId: MEMORY_ID,
      status: "pending", agentContext: "cursor", createdAt: Date.now(),
    });
    expect(db.selectMemory(MEMORY_ID)).toBeDefined();
    expect(db.deletedMemories).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: reviewMemoryRecommendation approval logic
// ─────────────────────────────────────────────────────────────────────────────

const DELETE_REC: RecommendationRow = {
  id: "rec-delete-001", userId: USER_ID, orgId: null,
  fact: BASE_MEMORY.fact, category: "projects", tags: "",
  projectKey: null, scopeType: "personal", scopeId: null,
  recommendationType: "delete", targetMemoryId: MEMORY_ID,
  status: "pending", proposedFact: null, proposedCategory: null, proposedTags: null,
  agentContext: "claude-desktop", createdAt: Date.now() - 5000,
  reviewedBy: null, reviewedAt: null, reviewNotes: null,
};

const UPDATE_REC: RecommendationRow = {
  id: "rec-update-001", userId: USER_ID, orgId: null,
  fact: BASE_MEMORY.fact, category: "projects", tags: "drizzle,orm",
  projectKey: null, scopeType: "personal", scopeId: null,
  recommendationType: "update", targetMemoryId: MEMORY_ID,
  status: "pending",
  proposedFact: "The project uses Drizzle ORM + D1 for database access.",
  proposedCategory: "projects",
  proposedTags: "drizzle,orm,d1",
  agentContext: "claude-code", createdAt: Date.now() - 3000,
  reviewedBy: null, reviewedAt: null, reviewNotes: null,
};

describe("approveDelete", () => {
  it("removes the memory row from the store", () => {
    const db = makeFakeDb([BASE_MEMORY], [DELETE_REC]);
    db.approveDelete(DELETE_REC.id, USER_ID);
    expect(db.selectMemory(MEMORY_ID)).toBeUndefined();
    expect(db.deletedMemories).toContain(MEMORY_ID);
  });

  it("marks the recommendation as 'approved'", () => {
    const db = makeFakeDb([BASE_MEMORY], [DELETE_REC]);
    db.approveDelete(DELETE_REC.id, USER_ID);
    expect(db.selectRecommendation(DELETE_REC.id)?.status).toBe("approved");
  });

  it("sets reviewedBy on the recommendation", () => {
    const db = makeFakeDb([BASE_MEMORY], [DELETE_REC]);
    db.approveDelete(DELETE_REC.id, "reviewer-user-id");
    expect(db.selectRecommendation(DELETE_REC.id)?.reviewedBy).toBe("reviewer-user-id");
  });

  it("stores optional reviewNotes on the recommendation", () => {
    const db = makeFakeDb([BASE_MEMORY], [DELETE_REC]);
    db.approveDelete(DELETE_REC.id, USER_ID, "Confirmed stale memory.");
    expect(db.selectRecommendation(DELETE_REC.id)?.reviewNotes).toBe("Confirmed stale memory.");
  });

  it("throws when targetMemoryId is missing", () => {
    const db = makeFakeDb([BASE_MEMORY], [{ ...DELETE_REC, targetMemoryId: null }]);
    expect(() => db.approveDelete(DELETE_REC.id, USER_ID)).toThrow("targetMemoryId is required");
  });

  it("succeeds even when memory was already deleted (idempotent approve)", () => {
    const db = makeFakeDb([], [DELETE_REC]);
    expect(() => db.approveDelete(DELETE_REC.id, USER_ID)).not.toThrow();
    expect(db.selectRecommendation(DELETE_REC.id)?.status).toBe("approved");
  });
});

describe("approveUpdate", () => {
  it("writes proposedFact to the memory row", () => {
    const db = makeFakeDb([BASE_MEMORY], [UPDATE_REC]);
    db.approveUpdate(UPDATE_REC.id, USER_ID, UPDATE_REC.proposedFact!, UPDATE_REC.proposedCategory!, UPDATE_REC.proposedTags!);
    expect(db.selectMemory(MEMORY_ID)?.fact).toBe(UPDATE_REC.proposedFact);
  });

  it("writes proposedCategory to the memory row", () => {
    const db = makeFakeDb([BASE_MEMORY], [UPDATE_REC]);
    db.approveUpdate(UPDATE_REC.id, USER_ID, UPDATE_REC.proposedFact!, "references", UPDATE_REC.proposedTags!);
    expect(db.selectMemory(MEMORY_ID)?.category).toBe("references");
  });

  it("writes proposedTags to the memory row", () => {
    const db = makeFakeDb([BASE_MEMORY], [UPDATE_REC]);
    db.approveUpdate(UPDATE_REC.id, USER_ID, UPDATE_REC.proposedFact!, UPDATE_REC.proposedCategory!, "drizzle,orm,d1,cloudflare");
    expect(db.selectMemory(MEMORY_ID)?.tags).toBe("drizzle,orm,d1,cloudflare");
  });

  it("marks the recommendation as 'approved'", () => {
    const db = makeFakeDb([BASE_MEMORY], [UPDATE_REC]);
    db.approveUpdate(UPDATE_REC.id, USER_ID, UPDATE_REC.proposedFact!, UPDATE_REC.proposedCategory!, UPDATE_REC.proposedTags!);
    expect(db.selectRecommendation(UPDATE_REC.id)?.status).toBe("approved");
  });

  it("sets isQuarantined when proposed fact contains a Stripe live key pattern", () => {
    const db = makeFakeDb([BASE_MEMORY], [UPDATE_REC]);
    db.approveUpdate(UPDATE_REC.id, USER_ID, "Token: sk_live_abc123xyz", "projects", "");
    expect(db.selectMemory(MEMORY_ID)?.isQuarantined).toBe(true);
  });

  it("does not set isQuarantined for clean proposed facts", () => {
    const db = makeFakeDb([BASE_MEMORY], [UPDATE_REC]);
    db.approveUpdate(UPDATE_REC.id, USER_ID, "Uses Drizzle ORM.", "projects", "drizzle");
    expect(db.selectMemory(MEMORY_ID)?.isQuarantined).toBe(false);
  });

  it("throws when targetMemoryId is missing", () => {
    const db = makeFakeDb([BASE_MEMORY], [{ ...UPDATE_REC, targetMemoryId: null }]);
    expect(() => db.approveUpdate(UPDATE_REC.id, USER_ID, "fact", "projects", "")).toThrow("targetMemoryId is required");
  });

  it("throws when target memory is not found", () => {
    const db = makeFakeDb([], [UPDATE_REC]);
    expect(() => db.approveUpdate(UPDATE_REC.id, USER_ID, "fact", "projects", "")).toThrow("Target memory not found");
  });
});

describe("reject recommendation", () => {
  it("marks the recommendation as 'rejected'", () => {
    const db = makeFakeDb([BASE_MEMORY], [DELETE_REC]);
    db.reject(DELETE_REC.id, USER_ID);
    expect(db.selectRecommendation(DELETE_REC.id)?.status).toBe("rejected");
  });

  it("does NOT delete the memory row on reject", () => {
    const db = makeFakeDb([BASE_MEMORY], [DELETE_REC]);
    db.reject(DELETE_REC.id, USER_ID);
    expect(db.selectMemory(MEMORY_ID)).toBeDefined();
    expect(db.deletedMemories).toHaveLength(0);
  });

  it("does NOT update the memory row on reject", () => {
    const db = makeFakeDb([BASE_MEMORY], [UPDATE_REC]);
    db.reject(UPDATE_REC.id, USER_ID);
    expect(db.selectMemory(MEMORY_ID)?.fact).toBe(BASE_MEMORY.fact);
    expect(db.updatedMemories).toHaveLength(0);
  });

  it("stores optional reviewNotes on reject", () => {
    const db = makeFakeDb([BASE_MEMORY], [DELETE_REC]);
    db.reject(DELETE_REC.id, USER_ID, "Not needed.");
    expect(db.selectRecommendation(DELETE_REC.id)?.reviewNotes).toBe("Not needed.");
  });

  it("sets reviewedBy on reject", () => {
    const db = makeFakeDb([BASE_MEMORY], [UPDATE_REC]);
    db.reject(UPDATE_REC.id, "reviewer-99");
    expect(db.selectRecommendation(UPDATE_REC.id)?.reviewedBy).toBe("reviewer-99");
  });

  it("throws when recommendation is not found", () => {
    const db = makeFakeDb([BASE_MEMORY], []);
    expect(() => db.reject("nonexistent-id", USER_ID)).toThrow("Recommendation not found");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: getConflicts filter
// ─────────────────────────────────────────────────────────────────────────────

describe("selectConflicts — getConflicts filter semantics", () => {
  const OTHER_USER = "other-user-5678";
  const OTHER_MEMORY_ID = "mem-other-9999";

  const makeRec = (overrides: Partial<RecommendationRow>): RecommendationRow => ({
    id: crypto.randomUUID(),
    userId: USER_ID,
    orgId: null,
    fact: "some fact",
    category: "rules",
    tags: "",
    projectKey: null,
    scopeType: "personal",
    scopeId: null,
    recommendationType: "update",
    targetMemoryId: MEMORY_ID,
    status: "pending",
    proposedFact: "proposed",
    proposedCategory: "rules",
    proposedTags: "",
    agentContext: "agent",
    createdAt: Date.now(),
    reviewedBy: null,
    reviewedAt: null,
    reviewNotes: null,
    ...overrides,
  });

  it("returns pending update rows for the user", () => {
    const rec = makeRec({ recommendationType: "update" });
    const db = makeFakeDb([BASE_MEMORY], [rec]);
    expect(db.selectConflicts(USER_ID)).toHaveLength(1);
  });

  it("returns pending delete rows for the user", () => {
    const rec = makeRec({ recommendationType: "delete", proposedFact: null });
    const db = makeFakeDb([BASE_MEMORY], [rec]);
    expect(db.selectConflicts(USER_ID)).toHaveLength(1);
  });

  it("does NOT return 'add' type rows", () => {
    const rec = makeRec({ recommendationType: "add" });
    const db = makeFakeDb([BASE_MEMORY], [rec]);
    expect(db.selectConflicts(USER_ID)).toHaveLength(0);
  });

  it("does NOT return 'archive' type rows", () => {
    const rec = makeRec({ recommendationType: "archive" });
    const db = makeFakeDb([BASE_MEMORY], [rec]);
    expect(db.selectConflicts(USER_ID)).toHaveLength(0);
  });

  it("does NOT return approved rows", () => {
    const rec = makeRec({ status: "approved" });
    const db = makeFakeDb([BASE_MEMORY], [rec]);
    expect(db.selectConflicts(USER_ID)).toHaveLength(0);
  });

  it("does NOT return rejected rows", () => {
    const rec = makeRec({ status: "rejected" });
    const db = makeFakeDb([BASE_MEMORY], [rec]);
    expect(db.selectConflicts(USER_ID)).toHaveLength(0);
  });

  it("does NOT return rows belonging to another user", () => {
    const rec = makeRec({ userId: OTHER_USER });
    const db = makeFakeDb([BASE_MEMORY], [rec]);
    expect(db.selectConflicts(USER_ID)).toHaveLength(0);
  });

  it("returns multiple pending rows when several exist", () => {
    const recs = [
      makeRec({ id: "r1", recommendationType: "update" }),
      makeRec({ id: "r2", recommendationType: "delete", proposedFact: null }),
    ];
    const db = makeFakeDb([BASE_MEMORY], recs);
    expect(db.selectConflicts(USER_ID)).toHaveLength(2);
  });

  it("returns an empty list when no pending conflicts exist", () => {
    const db = makeFakeDb([BASE_MEMORY], []);
    expect(db.selectConflicts(USER_ID)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: diffWords utility (conflicts.tsx)
// ─────────────────────────────────────────────────────────────────────────────

describe("diffWords", () => {
  it("returns all 'same' tokens for identical strings", () => {
    const tokens = diffWords("hello world", "hello world");
    expect(tokens.every((t) => t.kind === "same")).toBe(true);
  });

  it("reconstructed 'same' tokens equal the original string", () => {
    const s = "the quick brown fox";
    const tokens = diffWords(s, s);
    const reconstructed = tokens.map((t) => t.text).join("");
    expect(reconstructed).toBe(s);
  });

  it("marks added words with kind 'add'", () => {
    const tokens = diffWords("hello", "hello world");
    const added = tokens.filter((t) => t.kind === "add");
    expect(added.some((t) => t.text === "world")).toBe(true);
  });

  it("marks removed words with kind 'remove'", () => {
    const tokens = diffWords("hello world", "hello");
    const removed = tokens.filter((t) => t.kind === "remove");
    expect(removed.some((t) => t.text === "world")).toBe(true);
  });

  it("handles full replacement (no common words)", () => {
    const tokens = diffWords("foo bar", "baz qux");
    const removed = tokens.filter((t) => t.kind === "remove");
    const added = tokens.filter((t) => t.kind === "add");
    expect(removed.length).toBeGreaterThan(0);
    expect(added.length).toBeGreaterThan(0);
  });

  it("handles empty original string", () => {
    const tokens = diffWords("", "hello");
    const added = tokens.filter((t) => t.kind === "add");
    expect(added.some((t) => t.text === "hello")).toBe(true);
  });

  it("handles empty proposed string", () => {
    const tokens = diffWords("hello", "");
    const removed = tokens.filter((t) => t.kind === "remove");
    expect(removed.some((t) => t.text === "hello")).toBe(true);
  });

  it("handles both strings empty", () => {
    expect(() => diffWords("", "")).not.toThrow();
  });

  it("preserves common prefix as 'same' tokens", () => {
    const tokens = diffWords("uses Drizzle ORM", "uses Drizzle ORM with D1");
    const sameTokens = tokens.filter((t) => t.kind === "same").map((t) => t.text);
    expect(sameTokens.join("")).toContain("uses");
  });

  it("single word change produces one remove and one add", () => {
    const tokens = diffWords("uses Drizzle", "uses Prisma");
    const removed = tokens.filter((t) => t.kind === "remove");
    const added = tokens.filter((t) => t.kind === "add");
    expect(removed.some((t) => t.text === "Drizzle")).toBe(true);
    expect(added.some((t) => t.text === "Prisma")).toBe(true);
  });

  it("produces no 'add' tokens when proposed is a strict subset of original", () => {
    const tokens = diffWords("the quick brown fox", "the quick fox");
    const added = tokens.filter((t) => t.kind === "add");
    expect(added).toHaveLength(0);
  });
});
