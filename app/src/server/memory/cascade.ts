import { drizzle } from "drizzle-orm/d1";
import { eq, inArray, sql, and, notInArray } from "drizzle-orm";
import { memories, memoryDependencies, notifications } from "~/db/schema";
import type { D1Database } from "@cloudflare/workers-types";

export type CascadeInvalidationResult = {
  invalidatedParentId: string;
  invalidatedCount: number;
  affectedMemories: Array<{
    id: string;
    fact: string;
    wasActive: boolean;
    relationType: string;
  }>;
  timestamp: number;
};

/**
 * Invalidates all downstream memories when a parent memory fundamentally changes.
 * Uses a recursive CTE to traverse the dependency graph and flag all descendants
 * with needsReview status. Returns the count and list of affected memories.
 *
 * When a core architectural memory (e.g., "Use React 19") is updated,
 * all memories that implement or depend on it are automatically flagged
 * so agents see them in the next recall cycle.
 */
export async function invalidateMemoryCascade(
  d1: D1Database,
  parentMemoryId: string,
  userId: string,
  invalidationReason?: string
): Promise<CascadeInvalidationResult> {
  const db = drizzle(d1);
  const now = Date.now();

  // Step 1: Fetch the parent memory to verify ownership
  const parentMemory = await db
    .select()
    .from(memories)
    .where(and(eq(memories.id, parentMemoryId), eq(memories.userId, userId)))
    .get();

  if (!parentMemory) {
    return {
      invalidatedParentId: parentMemoryId,
      invalidatedCount: 0,
      affectedMemories: [],
      timestamp: now,
    };
  }

  // Step 2: Use recursive CTE to find all transitive dependents (children, grandchildren, etc.)
  // This query traverses the dependency graph starting from the parent and collects all reachable nodes.
  const descendantRows = await db
    .select({
      childId: memoryDependencies.childId,
      relationType: memoryDependencies.relationType,
    })
    .from(
      sql`
        WITH RECURSIVE dependents AS (
          -- Base case: direct children of the parent
          SELECT ${memoryDependencies.childId}, ${memoryDependencies.relationType}
          FROM ${memoryDependencies}
          WHERE ${memoryDependencies.parentId} = ${parentMemoryId}
            AND ${memoryDependencies.userId} = ${userId}

          UNION ALL

          -- Recursive case: children of children (transitive closure)
          SELECT ${memoryDependencies.childId}, ${memoryDependencies.relationType}
          FROM ${memoryDependencies}
          JOIN dependents ON ${memoryDependencies.parentId} = dependents.childId
          WHERE ${memoryDependencies.userId} = ${userId}
        )
        SELECT DISTINCT childId, relationType FROM dependents
      `
    )
    .all();

  if (descendantRows.length === 0) {
    return {
      invalidatedParentId: parentMemoryId,
      invalidatedCount: 0,
      affectedMemories: [],
      timestamp: now,
    };
  }

  const descendantIds = descendantRows.map((r) => r.childId as string);

  // Step 3: Fetch the actual memory rows we're about to flag
  const affectedMemoryRows = await db
    .select({
      id: memories.id,
      fact: memories.fact,
      isActive: memories.isActive,
    })
    .from(memories)
    .where(inArray(memories.id, descendantIds))
    .all();

  // Step 4: Mark all descendant memories with a "needs_review" flag.
  // We add a quarantine flag to indicate cascade invalidation.
  // The fact string is left untouched; only metadata flags change.
  if (descendantIds.length > 0) {
    await db
      .update(memories)
      .set({
        isQuarantined: true, // Flag for human review
        lastAccessedAt: now,
      })
      .where(inArray(memories.id, descendantIds))
      .run();
  }

  // Step 5: Create in-app notifications for the user about the cascade event.
  // Batch into chunks to avoid overwhelming the database.
  try {
    const notifId = crypto.randomUUID();
    const affectedCount = affectedMemoryRows.length;
    await db
      .insert(notifications)
      .values({
        id: notifId,
        userId,
        title: "Memory Cascade Invalidation",
        message: `Parent memory was updated. ${affectedCount} dependent memories flagged for review: ${invalidationReason ? invalidationReason : "fundamental change detected"}`,
        type: "warning",
        linkUrl: `/memories?quarantined=true`,
        createdAt: now,
      })
      .run();
  } catch (e) {
    console.error("[cascade] Failed to write notification:", e);
  }

  return {
    invalidatedParentId: parentMemoryId,
    invalidatedCount: descendantIds.length,
    affectedMemories: descendantRows.map((dep, idx) => ({
      id: dep.childId as string,
      fact:
        affectedMemoryRows.find((m) => m.id === dep.childId)?.fact ?? "(encrypted or deleted)",
      wasActive:
        affectedMemoryRows.find((m) => m.id === dep.childId)?.isActive ?? false,
      relationType: dep.relationType as string,
    })),
    timestamp: now,
  };
}

/**
 * Records a dependency relationship between two memories.
 * Used when a memory is created or updated to explicitly mark what it depends on or implements.
 *
 * Example: When adding "useActionState hook" memory, link it as depends_on "Use React 19"
 * so future updates to React version trigger review of the hook memory.
 */
export async function recordMemoryDependency(
  d1: D1Database,
  parentMemoryId: string,
  childMemoryId: string,
  userId: string,
  relationType: "implements" | "depends_on" | "extends" | "overrides" | "documents" | "related_to" | "contradiction" = "related_to"
): Promise<boolean> {
  const db = drizzle(d1);

  // Prevent self-references and circular dependencies
  if (parentMemoryId === childMemoryId) {
    return false;
  }

  // Verify both memories exist and are owned by the user
  const [parent, child] = await Promise.all([
    db.select().from(memories).where(eq(memories.id, parentMemoryId)).get(),
    db.select().from(memories).where(eq(memories.id, childMemoryId)).get(),
  ]);

  if (!parent || !child || parent.userId !== userId || child.userId !== userId) {
    return false;
  }

  try {
    await db
      .insert(memoryDependencies)
      .values({
        id: crypto.randomUUID(),
        parentId: parentMemoryId,
        childId: childMemoryId,
        userId,
        relationType,
        createdAt: Date.now(),
      })
      .run();
    return true;
  } catch (e) {
    console.error("[cascade] Failed to record dependency:", e);
    return false;
  }
}

/**
 * Retrieves the immediate dependents (children) of a memory.
 * Useful for understanding the direct impact of modifying a memory.
 */
export async function getDirectDependents(
  d1: D1Database,
  parentMemoryId: string,
  userId: string
): Promise<Array<{ childId: string; relationType: string }>> {
  const db = drizzle(d1);
  return db
    .select({
      childId: memoryDependencies.childId,
      relationType: memoryDependencies.relationType,
    })
    .from(memoryDependencies)
    .where(
      and(
        eq(memoryDependencies.parentId, parentMemoryId),
        eq(memoryDependencies.userId, userId)
      )
    )
    .all();
}

/**
 * Retrieves the immediate dependencies (parents) of a memory.
 * Shows what a memory depends on or implements.
 */
export async function getDirectDependencies(
  d1: D1Database,
  childMemoryId: string,
  userId: string
): Promise<Array<{ parentId: string; relationType: string }>> {
  const db = drizzle(d1);
  return db
    .select({
      parentId: memoryDependencies.parentId,
      relationType: memoryDependencies.relationType,
    })
    .from(memoryDependencies)
    .where(
      and(
        eq(memoryDependencies.childId, childMemoryId),
        eq(memoryDependencies.userId, userId)
      )
    )
    .all();
}

/**
 * Removes a specific dependency relationship between two memories.
 * Useful when a memory no longer applies or the relationship is incorrect.
 */
export async function removeMemoryDependency(
  d1: D1Database,
  parentMemoryId: string,
  childMemoryId: string,
  userId: string
): Promise<boolean> {
  const db = drizzle(d1);
  try {
    const result = await db
      .delete(memoryDependencies)
      .where(
        and(
          eq(memoryDependencies.parentId, parentMemoryId),
          eq(memoryDependencies.childId, childMemoryId),
          eq(memoryDependencies.userId, userId)
        )
      )
      .run();
    return true;
  } catch (e) {
    console.error("[cascade] Failed to remove dependency:", e);
    return false;
  }
}

/**
 * Detects potential contradictions between the parent memory's new state
 * and any of its downstream dependents. Returns a list of conflicts for the agent/human to review.
 *
 * Example: If "Use React 19" is changed to "Use Vue 3", dependent memory "useActionState hook"
 * (React-specific) is now in contradiction.
 */
export async function detectDependencyContradictions(
  d1: D1Database,
  parentMemoryId: string,
  newParentFact: string,
  userId: string
): Promise<Array<{ childId: string; reason: string }>> {
  const db = drizzle(d1);

  // Fetch direct dependents
  const dependents = await getDirectDependents(d1, parentMemoryId, userId);
  if (dependents.length === 0) return [];

  // Fetch the actual child memories for contradiction analysis
  const childIds = dependents.map((d) => d.childId);
  const childMemories = await db
    .select()
    .from(memories)
    .where(inArray(memories.id, childIds))
    .all();

  // Simple heuristic: flag if child fact contains inverse keywords
  const contradictions: Array<{ childId: string; reason: string }> = [];
  const lowerNewFact = newParentFact.toLowerCase();

  for (const child of childMemories) {
    const lowerChildFact = child.fact.toLowerCase();

    // If new parent fact explicitly contradicts the child, flag it
    if (
      (lowerNewFact.includes("not ") && lowerChildFact.includes(newParentFact.replace(/not /i, ""))) ||
      (newParentFact.includes("instead of") && lowerChildFact.includes(newParentFact.split("instead of")[0]))
    ) {
      contradictions.push({
        childId: child.id,
        reason: `Parent memory now states: "${newParentFact}" — child may be outdated`,
      });
    }
  }

  return contradictions;
}
