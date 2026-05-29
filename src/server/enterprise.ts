import { drizzle } from "drizzle-orm/d1";
import { eq, and, sql } from "drizzle-orm";
import {
  organizations,
  organizationMembers,
  teams,
  teamMembers,
  auditLogs,
  tokenUsages,
  orgQuotas,
  memories,
  apiTokens
} from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

// Helper to get organization membership for a user
export async function getUserOrg(db: any, userId: string): Promise<string | null> {
  const rows = await db
    .select({ orgId: organizationMembers.orgId })
    .from(organizationMembers)
    .where(eq(organizationMembers.userId, userId))
    .limit(1)
    .all();
  return rows[0]?.orgId ?? null;
}

// Verify vault scoping access and return the organization ID
export async function verifyVaultAccess(
  db: any,
  userId: string,
  projectKey: string | undefined | null
): Promise<{ allowed: boolean; orgId: string | null }> {
  if (!projectKey || projectKey === "personal") {
    const orgId = await getUserOrg(db, userId);
    return { allowed: true, orgId };
  }

  if (projectKey.startsWith("team:")) {
    const teamId = projectKey.slice(5);
    const rows = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
      .limit(1)
      .all();
    
    if (rows.length === 0) return { allowed: false, orgId: null };

    const teamRows = await db
      .select({ orgId: teams.orgId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
      .all();
    return { allowed: true, orgId: teamRows[0]?.orgId ?? null };
  }

  if (projectKey.startsWith("org:")) {
    const orgId = projectKey.slice(4);
    const rows = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)))
      .limit(1)
      .all();
    return { allowed: rows.length > 0, orgId: rows.length > 0 ? orgId : null };
  }

  // Default fallback (arbitrary projectKey behaves as personal)
  const orgId = await getUserOrg(db, userId);
  return { allowed: true, orgId };
}

// Quota verification
export async function checkQuota(
  db: any,
  userId: string,
  tokenId: string,
  action: "recall" | "commit",
  orgId: string | null
): Promise<{ allowed: boolean; reason?: string }> {
  // Get quota rules
  let quota = {
    monthlyMemories: 100,
    monthlyRecalls: 1000,
    monthlyCommits: 500
  };

  if (orgId) {
    const quotaRows = await db
      .select()
      .from(orgQuotas)
      .where(eq(orgQuotas.orgId, orgId))
      .limit(1)
      .all();
    if (quotaRows.length > 0) {
      quota = {
        monthlyMemories: quotaRows[0].monthlyMemories,
        monthlyRecalls: quotaRows[0].monthlyRecalls,
        monthlyCommits: quotaRows[0].monthlyCommits
      };
    }
  }

  // Get user organization membership group
  let userIdsInOrg = [userId];
  if (orgId) {
    const members = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(eq(organizationMembers.orgId, orgId))
      .all();
    userIdsInOrg = members.map((m: any) => m.userId);
  }

  // Get all tokenIds for these users
  const tokens = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(sql`${apiTokens.userId} IN (${sql.join(userIdsInOrg.map((uid) => sql`${uid}`), sql`, `)})`)
    .all();
  const tokenIds = tokens.map((t: any) => t.id);
  if (!tokenIds.includes(tokenId)) tokenIds.push(tokenId);

  const datePrefix = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Compute monthly recalls & commits from token_usages
  const usages = await db
    .select({
      recallCount: sql`SUM(${tokenUsages.recallCount})`,
      commitCount: sql`SUM(${tokenUsages.commitCount})`
    })
    .from(tokenUsages)
    .where(and(
      sql`${tokenUsages.tokenId} IN (${sql.join(tokenIds.map((tid: string) => sql`${tid}`), sql`, `)})`,
      sql`${tokenUsages.date} LIKE ${datePrefix + "%"}`
    ))
    .all();

  const currentMonthRecalls = Number(usages[0]?.recallCount ?? 0);
  const currentMonthCommits = Number(usages[0]?.commitCount ?? 0);

  if (action === "recall") {
    if (currentMonthRecalls >= quota.monthlyRecalls) {
      return { allowed: false, reason: `Monthly recall quota exceeded (${currentMonthRecalls}/${quota.monthlyRecalls})` };
    }
  } else {
    // Check commits limit
    if (currentMonthCommits >= quota.monthlyCommits) {
      return { allowed: false, reason: `Monthly commit quota exceeded (${currentMonthCommits}/${quota.monthlyCommits})` };
    }

    // Check active memory count
    const memoriesCountRow = await db
      .select({ count: sql`COUNT(*)` })
      .from(memories)
      .where(and(
        sql`${memories.userId} IN (${sql.join(userIdsInOrg.map((uid) => sql`${uid}`), sql`, `)})`,
        eq(memories.isActive, true)
      ))
      .all();
    const currentMemoriesCount = Number(memoriesCountRow[0]?.count ?? 0);
    if (currentMemoriesCount >= quota.monthlyMemories) {
      return { allowed: false, reason: `Active memory quota exceeded (${currentMemoriesCount}/${quota.monthlyMemories})` };
    }
  }

  return { allowed: true };
}

// Log token usage increments
export async function logTokenUsage(
  db: any,
  tokenId: string,
  type: "recall" | "commit",
  tokensConsumed: number = 0,
  count: number = 1
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const id = `${tokenId}:${today}`;

  // Use D1 upsert/ON CONFLICT logic or select-then-update
  const rows = await db
    .select()
    .from(tokenUsages)
    .where(eq(tokenUsages.id, id))
    .limit(1)
    .all();

  if (rows.length === 0) {
    await db
      .insert(tokenUsages)
      .values({
        id,
        tokenId,
        date: today,
        recallCount: type === "recall" ? count : 0,
        commitCount: type === "commit" ? count : 0,
        tokensConsumed
      })
      .run()
      .catch(() => {});
  } else {
    const existing = rows[0];
    await db
      .update(tokenUsages)
      .set({
        recallCount: type === "recall" ? existing.recallCount + count : existing.recallCount,
        commitCount: type === "commit" ? existing.commitCount + count : existing.commitCount,
        tokensConsumed: existing.tokensConsumed + tokensConsumed
      })
      .where(eq(tokenUsages.id, id))
      .run()
      .catch(() => {});
  }
}

// Write a tamper-evident audit log entry
export async function logAudit(
  db: any,
  entry: {
    orgId: string | null;
    userId: string;
    tokenId: string | null;
    action: string;
    memoryId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    metadata?: Record<string, any> | null;
  }
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .insert(auditLogs)
    .values({
      id,
      orgId: entry.orgId,
      userId: entry.userId,
      tokenId: entry.tokenId,
      action: entry.action,
      memoryId: entry.memoryId ?? null,
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      timestamp: Date.now(),
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null
    })
    .run();
}
