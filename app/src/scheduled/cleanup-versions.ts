import { drizzle } from "drizzle-orm/d1";
import { eq, and, lt, sql } from "drizzle-orm";
import { memoryVersions, memories, organizations } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

export async function handleMemoryVersionCleanup(env: CloudflareEnv, _ctx: ExecutionContext) {
  const db = drizzle(env.DB, { schema: { memoryVersions, memories, organizations } });

  // Get all organizations with their retention policies
  const orgs = await db.select().from(organizations).all();

  let totalDeleted = 0;

  for (const org of orgs) {
    const retentionDays = org.memoryVersionRetentionDays || 365;
    const retentionCount = org.memoryVersionRetentionCount || 50;
    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    // Delete by retention window first
    const deletedByWindow = await db
      .delete(memoryVersions)
      .where(
        and(
          sql`${memoryVersions.memoryId} IN (
            SELECT ${memories.id} FROM ${memories} WHERE ${memories.scopeId} = ${org.id} AND ${memories.scopeType} = 'organization'
          )`,
          lt(memoryVersions.timestamp, cutoffTime)
        )
      )
      .run();

    console.log(`[cleanup-versions] Org ${org.id}: deleted ${deletedByWindow.meta?.duration || 0} old versions by retention window`);
    totalDeleted += deletedByWindow.meta?.changes || 0;

    // For each memory, keep only the latest N versions
    const allMemories = await db
      .select({ id: memories.id })
      .from(memories)
      .where(and(eq(memories.scopeId, org.id), eq(memories.scopeType, "organization")))
      .all();

    for (const memory of allMemories) {
      const versions = await db
        .select({ id: memoryVersions.id })
        .from(memoryVersions)
        .where(eq(memoryVersions.memoryId, memory.id))
        .orderBy(sql`${memoryVersions.timestamp} DESC`)
        .all();

      if (versions.length > retentionCount) {
        const toDelete = versions.slice(retentionCount);
        for (const v of toDelete) {
          await db.delete(memoryVersions).where(eq(memoryVersions.id, v.id)).run();
          totalDeleted++;
        }
      }
    }
  }

  console.log(`[cleanup-versions] Total versions deleted: ${totalDeleted}`);
  return { success: true, deleted: totalDeleted };
}
