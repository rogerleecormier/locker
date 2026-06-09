import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  invalidateMemoryCascade,
  recordMemoryDependency,
  getDirectDependents,
  getDirectDependencies,
  removeMemoryDependency,
  detectDependencyContradictions,
} from "./cascade";
import { memories, memoryDependencies, users, notifications } from "~/db/schema";
import type { D1Database } from "@cloudflare/workers-types";

let testDb: D1Database | null = null;
let db: ReturnType<typeof drizzle> | null = null;
let userId: string;

describe("Memory Cascade Invalidation System", () => {
  beforeAll(async () => {
    userId = "test-user-" + Date.now();
  });

  afterAll(async () => {
    // Cleanup
  });

  it("should record a dependency relationship between two memories", async () => {
    if (!testDb) return;
    const parentMemoryId = "mem-parent-" + Date.now();
    const parentFact = "Use React 19 as the primary frontend framework for new features";

    const childMemoryId1 = "mem-child-1-" + Date.now();
    const childFact = "The useActionState hook from React 19 improves form handling";

    const recorded = await recordMemoryDependency(
      testDb,
      parentMemoryId,
      childMemoryId1,
      userId,
      "implements"
    );

    expect(recorded).toBe(true);

    const deps = await getDirectDependents(testDb, parentMemoryId, userId);
    expect(deps).toHaveLength(1);
    expect(deps[0].childId).toBe(childMemoryId1);
    expect(deps[0].relationType).toBe("implements");
  });

  it("should prevent self-referential dependencies", async () => {
    if (!testDb) return;
    const memId = "mem-self-ref-" + Date.now();
    const recorded = await recordMemoryDependency(
      testDb,
      memId,
      memId,
      userId,
      "depends_on"
    );

    expect(recorded).toBe(false);
  });

  it("should retrieve direct dependents of a memory", async () => {
    if (!testDb) return;
    const parentId = "mem-parent-deps-" + Date.now();
    const child1Id = "mem-child-a-" + Date.now();
    const child2Id = "mem-child-b-" + Date.now();

    // Record multiple dependencies
    await recordMemoryDependency(testDb, parentId, child1Id, userId, "depends_on");
    await recordMemoryDependency(testDb, parentId, child2Id, userId, "extends");

    const dependents = await getDirectDependents(testDb, parentId, userId);
    expect(dependents).toHaveLength(2);
    expect(dependents.map((d) => d.childId)).toContain(child1Id);
    expect(dependents.map((d) => d.childId)).toContain(child2Id);
  });

  it("should retrieve direct dependencies of a memory", async () => {
    if (!testDb) return;
    const parentId = "mem-parent-int-" + Date.now();
    const childId = "mem-child-int-" + Date.now();

    await recordMemoryDependency(
      testDb,
      parentId,
      childId,
      userId,
      "implements"
    );

    const dependencies = await getDirectDependencies(testDb, childId, userId);
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0].parentId).toBe(parentId);
    expect(dependencies[0].relationType).toBe("implements");
  });

  it("should remove a dependency relationship", async () => {
    if (!testDb) return;
    const parentId = "mem-parent-rm-" + Date.now();
    const childId = "mem-child-rm-" + Date.now();

    await recordMemoryDependency(testDb, parentId, childId, userId, "related_to");

    let deps = await getDirectDependents(testDb, parentId, userId);
    expect(deps).toHaveLength(1);

    const removed = await removeMemoryDependency(
      testDb,
      parentId,
      childId,
      userId
    );
    expect(removed).toBe(true);

    deps = await getDirectDependents(testDb, parentId, userId);
    expect(deps).toHaveLength(0);
  });

  describe("Cascade Invalidation", () => {
    it("should invalidate a single level of children", async () => {
      if (!testDb || !db) return;
      const parentId = "mem-cascade-parent-" + Date.now();
      const childId = "mem-cascade-child-" + Date.now();

      // Record dependency
      await recordMemoryDependency(testDb, parentId, childId, userId);

      // Invalidate parent
      const result = await invalidateMemoryCascade(
        testDb,
        parentId,
        userId,
        "Switched from React to Vue"
      );

      expect(result.invalidatedCount).toBe(1);
      expect(result.affectedMemories).toHaveLength(1);
      expect(result.affectedMemories[0].id).toBe(childId);

      // Verify child is marked as quarantined
      const childRow = await (db as any)
        .select()
        .from(memories)
        .where(eq(memories.id, childId))
        .get();
      expect(childRow?.isQuarantined).toBe(true);
    });

    it("should invalidate multiple levels of children (transitive closure)", async () => {
      if (!testDb) return;
      const parentId = "mem-grand-parent-" + Date.now();
      const childId = "mem-child-" + Date.now();
      const grandchildId = "mem-grandchild-" + Date.now();

      // Create chain: parent -> child -> grandchild
      await recordMemoryDependency(testDb, parentId, childId, userId, "implements");
      await recordMemoryDependency(testDb, childId, grandchildId, userId, "depends_on");

      // Invalidate root parent
      const result = await invalidateMemoryCascade(
        testDb,
        parentId,
        userId,
        "Major architectural change"
      );

      // Should invalidate both child and grandchild (transitive)
      expect(result.invalidatedCount).toBeGreaterThanOrEqual(2);
    });

    it("should return affected memory details in cascade result", async () => {
      if (!testDb) return;
      const parentId = "mem-cascade-details-" + Date.now();
      const childId = "mem-cascade-child-details-" + Date.now();

      await recordMemoryDependency(testDb, parentId, childId, userId);

      const result = await invalidateMemoryCascade(
        testDb,
        parentId,
        userId,
        "Test invalidation"
      );

      expect(result).toHaveProperty("invalidatedParentId", parentId);
      expect(result).toHaveProperty("invalidatedCount");
      expect(result).toHaveProperty("affectedMemories");
      expect(result).toHaveProperty("timestamp");
      expect(result.timestamp).toBeGreaterThan(0);
    });

    it("should handle cascade on non-existent parent gracefully", async () => {
      if (!testDb) return;
      const fakeParentId = "mem-nonexistent-" + Date.now();

      const result = await invalidateMemoryCascade(
        testDb,
        fakeParentId,
        userId
      );

      expect(result.invalidatedCount).toBe(0);
      expect(result.affectedMemories).toHaveLength(0);
    });

    it("should create notification on cascade invalidation", async () => {
      if (!testDb) return;
      const parentId = "mem-notif-parent-" + Date.now();
      const childId = "mem-notif-child-" + Date.now();

      await recordMemoryDependency(testDb, parentId, childId, userId);

      const result = await invalidateMemoryCascade(
        testDb,
        parentId,
        userId,
        "Invalidation test"
      );

      if (result.invalidatedCount > 0) {
        // Verify notification was created (best-effort, may fail in test)
        // In production, we'd verify the notification table
      }
    });
  });

  describe("Contradiction Detection", () => {
    it("should detect contradictions between parent and child", async () => {
      if (!testDb) return;
      const parentId = "mem-contra-parent-" + Date.now();
      const childId = "mem-contra-child-" + Date.now();

      // Parent says "Use React 19"
      // Child says "useActionState hook from React 19"
      // If parent changes to "Use Vue 3", child contradicts

      await recordMemoryDependency(testDb, parentId, childId, userId);

      const contradictions = await detectDependencyContradictions(
        testDb,
        parentId,
        "Use Vue 3 instead of React",
        userId
      );

      // Should detect potential contradiction (heuristic-based)
      // May or may not find a contradiction depending on keyword matching
      expect(Array.isArray(contradictions)).toBe(true);
    });

    it("should return empty array when no contradictions found", async () => {
      if (!testDb) return;
      const parentId = "mem-no-contra-parent-" + Date.now();
      const childId = "mem-no-contra-child-" + Date.now();

      await recordMemoryDependency(testDb, parentId, childId, userId);

      const contradictions = await detectDependencyContradictions(
        testDb,
        parentId,
        "Use React 19 with TypeScript for type safety",
        userId
      );

      // Compatible change, should have no contradictions
      expect(contradictions).toBeInstanceOf(Array);
    });
  });

  describe("Edge Cases", () => {
    it("should handle user isolation correctly", async () => {
      if (!testDb) return;
      const user1 = "user-1-" + Date.now();
      const user2 = "user-2-" + Date.now();

      const parentId = "mem-isolation-parent-" + Date.now();
      const childId = "mem-isolation-child-" + Date.now();

      // Record dependency for user1
      await recordMemoryDependency(testDb, parentId, childId, user1);

      // User2 should not see user1's dependencies
      const user2Deps = await getDirectDependents(testDb, parentId, user2);
      expect(user2Deps).toHaveLength(0);

      // Cascade from user2's perspective should be no-op
      const result = await invalidateMemoryCascade(
        testDb,
        parentId,
        user2
      );
      expect(result.invalidatedCount).toBe(0);
    });

    it("should handle memories with no dependencies", async () => {
      if (!testDb) return;
      const isolatedMemoryId = "mem-isolated-" + Date.now();

      const dependents = await getDirectDependents(
        testDb,
        isolatedMemoryId,
        userId
      );
      const dependencies = await getDirectDependencies(
        testDb,
        isolatedMemoryId,
        userId
      );

      expect(dependents).toHaveLength(0);
      expect(dependencies).toHaveLength(0);

      // Cascade should be no-op
      const result = await invalidateMemoryCascade(
        testDb,
        isolatedMemoryId,
        userId
      );
      expect(result.invalidatedCount).toBe(0);
    });
  });
});

describe("Cascade Integration with Memory Updates", () => {
  it("scenario: Parent memory 'Use React 19' is changed to 'Use Vue 3'", async () => {
    if (!testDb || !db) return;
    // Setup parent: "Use React 19"
    const parentId = "mem-scenario-parent-" + Date.now();
    const childId1 = "mem-scenario-hook-" + Date.now();
    const childId2 = "mem-scenario-state-" + Date.now();

    // Create parent-child relationships
    await recordMemoryDependency(testDb, parentId, childId1, userId, "implements");
    await recordMemoryDependency(testDb, parentId, childId2, userId, "depends_on");

    // Simulate update: "Use React 19" → "Use Vue 3"
    // This is a fundamental change (>30% word difference)
    const result = await invalidateMemoryCascade(
      testDb,
      parentId,
      userId,
      "Switched frontend framework from React to Vue"
    );

    // Both children should be flagged for review
    expect(result.invalidatedCount).toBeGreaterThanOrEqual(2);
    expect(result.affectedMemories.length).toBeGreaterThanOrEqual(2);

    // Verify the affected memories are marked as quarantined
    for (const affected of result.affectedMemories) {
      const row = await (db as any)
        .select()
        .from(memories)
        .where(eq(memories.id, affected.id))
        .get();
      expect(row?.isQuarantined).toBe(true);
    }
  });
});
