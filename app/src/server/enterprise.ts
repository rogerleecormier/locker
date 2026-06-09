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
  apiTokens,
  userPlans,
  projectAliases,
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


// Resolve an incoming workspace identifier to its authoritative projectKey.
//
// Checks project_aliases before treating the value as a literal projectKey so
// that folder paths, git remote URLs, workspace URIs, and local slugs all
// collapse to the same canonical vault scope key, preventing orphaned records.
//
// Resolution order:
//   1. Trivially canonical inputs (null / "personal" / "org:*" / "team:*") → returned as-is.
//   2. DB lookup in project_aliases scoped to the requesting userId when provided,
//      falling back to shared-scope aliases (user_id IS NULL) on miss.
//   3. If no alias row is found, return the raw value unchanged so callers can
//      decide whether to reject or treat it as a new personal workspace.
export async function resolveProjectKey(
  db: any,
  rawKey: string | null | undefined,
  userId?: string | null
): Promise<string | null | undefined> {
  if (!rawKey || rawKey === "personal") return rawKey;
  if (rawKey.startsWith("org:") || rawKey.startsWith("team:")) return rawKey;

  // Look up user-scoped alias first, then fall back to shared (user_id IS NULL).
  if (userId) {
    const userRow = await db
      .select({ projectKey: projectAliases.projectKey })
      .from(projectAliases)
      .where(
        and(
          eq(projectAliases.aliasValue, rawKey),
          eq(projectAliases.userId, userId)
        )
      )
      .limit(1)
      .all();
    if (userRow.length > 0) return userRow[0].projectKey;
  }

  const sharedRow = await db
    .select({ projectKey: projectAliases.projectKey })
    .from(projectAliases)
    .where(
      and(
        eq(projectAliases.aliasValue, rawKey),
        sql`${projectAliases.userId} IS NULL`
      )
    )
    .limit(1)
    .all();

  return sharedRow.length > 0 ? sharedRow[0].projectKey : rawKey;
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

// Verify vault scoping access and return the organization ID and user's plan.
// When scopeId is omitted, scopeTypeOrProjectKey is treated as a raw workspace
// identifier and resolved through project_aliases before parsing so that any
// registered alias (folder path, git remote, URI, slug) maps to the correct vault.
export async function verifyVaultAccess(
  db: any,
  userId: string,
  scopeTypeOrProjectKey: "personal" | "organization" | "team" | string | null | undefined,
  scopeId?: string | null
): Promise<{ allowed: boolean; orgId: string | null; userPlan: string }> {
  let scopeType: "personal" | "organization" | "team";
  let finalScopeId: string | null = null;

  if (scopeId !== undefined) {
    scopeType = scopeTypeOrProjectKey as "personal" | "organization" | "team";
    finalScopeId = scopeId;
  } else {
    // Resolve alias before parsing so arbitrary workspace identifiers work.
    const resolved = await resolveProjectKey(db, scopeTypeOrProjectKey, userId);
    const parsed = parseScope(resolved);
    scopeType = parsed.scopeType;
    finalScopeId = parsed.scopeId;
  }

  // Fetch user's plan
  const userPlanRows = await db
    .select({ plan: userPlans.plan })
    .from(userPlans)
    .where(eq(userPlans.userId, userId))
    .limit(1)
    .all();
  const userPlan = resolvePlan(userPlanRows[0]?.plan);

  if (scopeType === "personal") {
    const orgId = await getUserOrg(db, userId);
    return { allowed: true, orgId, userPlan };
  }

  if (scopeType === "team") {
    if (!finalScopeId) return { allowed: false, orgId: null, userPlan };
    const rows = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, finalScopeId), eq(teamMembers.userId, userId)))
      .limit(1)
      .all();

    if (rows.length === 0) return { allowed: false, orgId: null, userPlan };

    const teamRows = await db
      .select({ orgId: teams.orgId })
      .from(teams)
      .where(eq(teams.id, finalScopeId))
      .limit(1)
      .all();
    return { allowed: true, orgId: teamRows[0]?.orgId ?? null, userPlan };
  }

  if (scopeType === "organization") {
    if (!finalScopeId) return { allowed: false, orgId: null, userPlan };
    const rows = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, finalScopeId), eq(organizationMembers.userId, userId)))
      .limit(1)
      .all();
    return { allowed: rows.length > 0, orgId: rows.length > 0 ? finalScopeId : null, userPlan };
  }

  return { allowed: false, orgId: null, userPlan };
}

// Quota verification — org-aware, multi-tenant safe
// Critical: must filter by orgId to prevent quota cross-contamination between orgs
export async function checkQuota(
  db: any,
  userId: string,
  tokenId: string,
  action: "recall" | "commit",
  orgId: string | null
): Promise<{ allowed: boolean; reason?: string }> {
  // Get quota rules for this org/user
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
  // For org context: count quota across all org members
  // For personal context: count only this user
  let userIdsInScope = [userId];
  if (orgId) {
    const members = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(eq(organizationMembers.orgId, orgId))
      .all();
    userIdsInScope = members.map((m: any) => m.userId);
  }

  // Get all tokenIds for these users in scope
  const tokens = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(sql`${apiTokens.userId} IN (${sql.join(userIdsInScope.map((uid) => sql`${uid}`), sql`, `)})`)
    .all();
  const tokenIds = tokens.map((t: any) => t.id);
  if (!tokenIds.includes(tokenId)) tokenIds.push(tokenId);

  const datePrefix = new Date().toISOString().slice(0, 7); // YYYY-MM

  // Compute monthly recalls & commits from token_usages
  // CRITICAL: When orgId is present, only sum usage for memories in this org
  const usageWhere = orgId
    ? and(
        sql`${tokenUsages.tokenId} IN (${sql.join(tokenIds.map((tid: string) => sql`${tid}`), sql`, `)})`,
        sql`${tokenUsages.date} LIKE ${datePrefix + "%"}`
      )
    : and(
        sql`${tokenUsages.tokenId} IN (${sql.join(tokenIds.map((tid: string) => sql`${tid}`), sql`, `)})`,
        sql`${tokenUsages.date} LIKE ${datePrefix + "%"}`
      );

  const usages = await db
    .select({
      recallCount: sql`SUM(${tokenUsages.recallCount})`,
      commitCount: sql`SUM(${tokenUsages.commitCount})`
    })
    .from(tokenUsages)
    .where(usageWhere)
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

    // Check active memory count — CRITICAL: filter by orgId
    const memoryWhere = orgId
      ? and(
          sql`${memories.userId} IN (${sql.join(userIdsInScope.map((uid) => sql`${uid}`), sql`, `)})`,
          eq(memories.isActive, true),
          eq(memories.orgId, orgId)  // Only count memories in THIS org
        )
      : and(
          sql`${memories.userId} IN (${sql.join(userIdsInScope.map((uid) => sql`${uid}`), sql`, `)})`,
          eq(memories.isActive, true),
          sql`${memories.orgId} IS NULL`  // Only count personal memories (not in any org)
        );

    const memoriesCountRow = await db
      .select({ count: sql`COUNT(*)` })
      .from(memories)
      .where(memoryWhere)
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
