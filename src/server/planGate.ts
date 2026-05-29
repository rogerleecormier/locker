import { eq, and, sql } from "drizzle-orm";
import {
  organizationMembers,
  orgQuotas,
  apiTokens,
  memories,
  tokenUsages,
  teams,
  teamMembers,
} from "~/db/schema";
import {
  PLANS,
  resolvePlan,
  planHasFeature,
  planAtLeast,
  type PlanId,
  type PlanFeatures,
} from "~/lib/plans";

export class PlanGateError extends Error {
  constructor(
    public feature: keyof PlanFeatures,
    public requiredPlan: PlanId,
    public currentPlan: PlanId
  ) {
    super(
      `Feature '${feature}' requires the ${requiredPlan} plan or higher. Current plan: ${currentPlan}.`
    );
    this.name = "PlanGateError";
  }
}

export class PlanLimitError extends Error {
  constructor(
    public limitType: string,
    public current: number,
    public max: number,
    public plan: PlanId
  ) {
    super(`${limitType} limit reached (${current}/${max}) on the ${plan} plan.`);
    this.name = "PlanLimitError";
  }
}

export async function getUserEffectivePlan(
  db: any,
  userId: string
): Promise<{ planId: PlanId; orgId: string | null }> {
  const orgRows = await db
    .select({
      orgId: organizationMembers.orgId,
      plan: orgQuotas.plan,
    })
    .from(organizationMembers)
    .leftJoin(orgQuotas, eq(orgQuotas.orgId, organizationMembers.orgId))
    .where(eq(organizationMembers.userId, userId))
    .all();

  if (orgRows.length === 0) {
    return { planId: "free", orgId: null };
  }

  let best: PlanId = "free";
  let bestOrgId: string | null = null;
  for (const row of orgRows) {
    const plan = resolvePlan(row.plan);
    if (planAtLeast(plan, best)) {
      best = plan;
      bestOrgId = row.orgId;
    }
  }

  return { planId: best, orgId: bestOrgId };
}

export async function requireFeature(
  db: any,
  userId: string,
  feature: keyof PlanFeatures
): Promise<{ planId: PlanId; orgId: string | null }> {
  const { planId, orgId } = await getUserEffectivePlan(db, userId);

  if (!planHasFeature(planId, feature)) {
    const requiredPlan: PlanId =
      planHasFeature("business", feature)
        ? "business"
        : "enterprise";
    throw new PlanGateError(feature, requiredPlan, planId);
  }

  return { planId, orgId };
}

export async function checkMemoryLimit(
  db: any,
  userId: string
): Promise<void> {
  const { planId } = await getUserEffectivePlan(db, userId);
  const limits = PLANS[planId].limits;
  if (limits.maxMemories === Infinity) return;

  const countRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        eq(memories.isActive, true),
        sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
      )
    )
    .all();

  const current = Number(countRows[0]?.count ?? 0);
  if (current >= limits.maxMemories) {
    throw new PlanLimitError("Personal memories", current, limits.maxMemories, planId);
  }
}

export async function checkApiTokenLimit(
  db: any,
  userId: string
): Promise<void> {
  const { planId } = await getUserEffectivePlan(db, userId);
  const limits = PLANS[planId].limits;
  if (limits.maxApiTokens === Infinity) return;

  const countRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .all();

  const current = Number(countRows[0]?.count ?? 0);
  if (current >= limits.maxApiTokens) {
    throw new PlanLimitError("API tokens", current, limits.maxApiTokens, planId);
  }
}

export async function checkOrgMemberLimit(
  db: any,
  orgId: string
): Promise<void> {
  const quotaRows = await db
    .select({ plan: orgQuotas.plan })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, orgId))
    .limit(1)
    .all();

  const planId = resolvePlan(quotaRows[0]?.plan);
  const limits = PLANS[planId].limits;
  if (limits.maxOrgMembers === Infinity) return;

  const countRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(organizationMembers)
    .where(eq(organizationMembers.orgId, orgId))
    .all();

  const current = Number(countRows[0]?.count ?? 0);
  if (current >= limits.maxOrgMembers) {
    throw new PlanLimitError("Organization members", current, limits.maxOrgMembers, planId);
  }
}

export async function checkTeamLimit(
  db: any,
  orgId: string
): Promise<void> {
  const quotaRows = await db
    .select({ plan: orgQuotas.plan })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, orgId))
    .limit(1)
    .all();

  const planId = resolvePlan(quotaRows[0]?.plan);
  const limits = PLANS[planId].limits;
  if (limits.maxTeams === Infinity) return;

  const countRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(teams)
    .where(eq(teams.orgId, orgId))
    .all();

  const current = Number(countRows[0]?.count ?? 0);
  if (current >= limits.maxTeams) {
    throw new PlanLimitError("Teams", current, limits.maxTeams, planId);
  }
}

export async function checkTeamMemberLimit(
  db: any,
  teamId: string
): Promise<void> {
  const teamRows = await db
    .select({ orgId: teams.orgId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)
    .all();
  if (!teamRows.length) return;

  const quotaRows = await db
    .select({ plan: orgQuotas.plan })
    .from(orgQuotas)
    .where(eq(orgQuotas.orgId, teamRows[0].orgId))
    .limit(1)
    .all();

  const planId = resolvePlan(quotaRows[0]?.plan);
  const limits = PLANS[planId].limits;
  if (limits.maxTeamMembers === Infinity) return;

  const countRows = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))
    .all();

  const current = Number(countRows[0]?.count ?? 0);
  if (current >= limits.maxTeamMembers) {
    throw new PlanLimitError("Team members", current, limits.maxTeamMembers, planId);
  }
}

export type UsageStats = {
  tokenId: string;
  tokenName: string;
  totalRecalls: number;
  totalCommits: number;
  dailyBreakdown: Array<{
    date: string;
    recalls: number;
    commits: number;
  }>;
};

export async function getUserUsageStats(
  db: any,
  userId: string
): Promise<UsageStats[]> {
  const tokenRows = await db
    .select({ id: apiTokens.id, name: apiTokens.name })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .all();

  if (tokenRows.length === 0) return [];

  const tokenIds = tokenRows.map((t: any) => t.id);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().slice(0, 10);

  const usageRows = await db
    .select()
    .from(tokenUsages)
    .where(
      and(
        sql`${tokenUsages.tokenId} IN (${sql.join(
          tokenIds.map((id: string) => sql`${id}`),
          sql`, `
        )})`,
        sql`${tokenUsages.date} >= ${dateStr}`
      )
    )
    .all();

  const byToken = new Map<string, any[]>();
  for (const row of usageRows) {
    const existing = byToken.get(row.tokenId) ?? [];
    existing.push(row);
    byToken.set(row.tokenId, existing);
  }

  return tokenRows.map((token: any) => {
    const rows = byToken.get(token.id) ?? [];
    const totalRecalls = rows.reduce((acc: number, r: any) => acc + (r.recallCount ?? 0), 0);
    const totalCommits = rows.reduce((acc: number, r: any) => acc + (r.commitCount ?? 0), 0);
    const dailyBreakdown = rows
      .map((r: any) => ({ date: r.date, recalls: r.recallCount ?? 0, commits: r.commitCount ?? 0 }))
      .sort((a: any, b: any) => a.date.localeCompare(b.date));
    return { tokenId: token.id, tokenName: token.name, totalRecalls, totalCommits, dailyBreakdown };
  });
}
