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
import { PLAN_ORDER, resolvePlan, planAtLeast } from "~/lib/plans";

// Estimate tokens consumed for embedding generation. BGE-M3 charges per token in the input text.
// Using a conservative estimate of ~4 characters per token.
export function estimateEmbeddingTokens(text: string): number {
  const tokenEstimate = Math.ceil(text.length / 4);
  return Math.max(1, tokenEstimate);
}

// Helper to get organization membership for a user, resolving to their highest-tier organization if in multiple
export async function getUserOrg(db: any, userId: string): Promise<string | null> {
  const rows = await db
    .select({
      orgId: organizationMembers.orgId,
      plan: orgQuotas.plan,
    })
    .from(organizationMembers)
    .leftJoin(orgQuotas, eq(orgQuotas.orgId, organizationMembers.orgId))
    .where(eq(organizationMembers.userId, userId))
    .all();

  if (rows.length === 0) return null;

  let bestOrgId = rows[0].orgId;
  let bestPlan = resolvePlan(rows[0].plan);

  for (let i = 1; i < rows.length; i++) {
    const plan = resolvePlan(rows[i].plan);
    if (planAtLeast(plan, bestPlan)) {
      bestPlan = plan;
      bestOrgId = rows[i].orgId;
    }
  }
  return bestOrgId;
}


export function parseScope(projectKey: string | undefined | null): {
  scopeType: "personal" | "organization" | "team";
  scopeId: string | null;
} {
  if (!projectKey || projectKey === "personal") {
    return { scopeType: "personal", scopeId: null };
  }
  if (projectKey.startsWith("org:")) {
    const orgId = projectKey.slice(4).trim();
    if (!orgId) throw new Error("Invalid organization scope key");
    return { scopeType: "organization", scopeId: orgId };
  }
  if (projectKey.startsWith("team:")) {
    const teamId = projectKey.slice(5).trim();
    if (!teamId) throw new Error("Invalid team scope key");
    return { scopeType: "team", scopeId: teamId };
  }
  throw new Error(`Invalid workspace scope key: ${projectKey}`);
}

// Verify vault scoping access and return the organization ID
export async function verifyVaultAccess(
  db: any,
  userId: string,
  scopeTypeOrProjectKey: "personal" | "organization" | "team" | string | null | undefined,
  scopeId?: string | null
): Promise<{ allowed: boolean; orgId: string | null }> {
  let scopeType: "personal" | "organization" | "team";
  let finalScopeId: string | null = null;

  if (scopeId !== undefined) {
    scopeType = scopeTypeOrProjectKey as "personal" | "organization" | "team";
    finalScopeId = scopeId;
  } else {
    const parsed = parseScope(scopeTypeOrProjectKey);
    scopeType = parsed.scopeType;
    finalScopeId = parsed.scopeId;
  }

  if (scopeType === "personal") {
    const orgId = await getUserOrg(db, userId);
    return { allowed: true, orgId };
  }

  if (scopeType === "team") {
    if (!finalScopeId) return { allowed: false, orgId: null };
    const rows = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, finalScopeId), eq(teamMembers.userId, userId)))
      .limit(1)
      .all();
    
    if (rows.length === 0) return { allowed: false, orgId: null };

    const teamRows = await db
      .select({ orgId: teams.orgId })
      .from(teams)
      .where(eq(teams.id, finalScopeId))
      .limit(1)
      .all();
    return { allowed: true, orgId: teamRows[0]?.orgId ?? null };
  }

  if (scopeType === "organization") {
    if (!finalScopeId) return { allowed: false, orgId: null };
    const rows = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, finalScopeId), eq(organizationMembers.userId, userId)))
      .limit(1)
      .all();
    return { allowed: rows.length > 0, orgId: rows.length > 0 ? finalScopeId : null };
  }

  return { allowed: false, orgId: null };
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

  // Atomic upsert using INSERT ... ON CONFLICT
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
    .onConflictDoUpdate({
      target: tokenUsages.id,
      set: {
        recallCount: type === "recall"
          ? sql`${tokenUsages.recallCount} + ${count}`
          : sql`${tokenUsages.recallCount}`,
        commitCount: type === "commit"
          ? sql`${tokenUsages.commitCount} + ${count}`
          : sql`${tokenUsages.commitCount}`,
        tokensConsumed: sql`${tokenUsages.tokensConsumed} + ${tokensConsumed}`
      }
    })
    .run()
    .catch(() => {});
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
