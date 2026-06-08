import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { PLANS, PLAN_ORDER, SELF_SERVE_PLAN_ORDER, resolvePlan, isBusinessOrAbove, type PlanId } from "~/lib/plans";
import { PlanCard, PlanBadge } from "~/components/PaywallGate";
import { getUserEffectivePlan, getUserUsageStats } from "~/server/planGate";
import { requireSession } from "~/server/session";
import { createCheckoutSession, createPortalSession } from "~/server/billing";
import type { CloudflareEnv } from "~/types/cloudflare";
import {
  memories,
  apiTokens,
  organizations,
  organizationMembers,
  orgQuotas,
  tokenUsages,
  userPlans,
  oauthAccessTokensV2,
  systemSettings,
} from "~/db/schema";
import { eq, sql, and } from "drizzle-orm";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Select } from "~/components/ui/input";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

export const getBillingInfo = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { memories, apiTokens, organizations, organizationMembers, orgQuotas, tokenUsages, userPlans, oauthAccessTokensV2, systemSettings } });

    const { planId, orgId } = await getUserEffectivePlan(db, user.id);

    const personalPlanRow = await db
      .select({ plan: userPlans.plan })
      .from(userPlans)
      .where(eq(userPlans.userId, user.id))
      .limit(1)
      .all();
    const personalPlanId = personalPlanRow[0] ? resolvePlan(personalPlanRow[0].plan) : "free" as const;

    const memoriesCount = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(memories)
      .where(
        and(
          eq(memories.userId, user.id),
          eq(memories.isActive, true),
          sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
        )
      )
      .all();

    const tokensCount = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(apiTokens)
      .where(eq(apiTokens.userId, user.id))
      .all();

    const monthPrefix = new Date().toISOString().slice(0, 7);
    const tokenIds = (await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(eq(apiTokens.userId, user.id))
      .all()
    ).map((r) => r.id);

    const oauthTokenIds = (await db
      .select({ id: oauthAccessTokensV2.id })
      .from(oauthAccessTokensV2)
      .where(eq(oauthAccessTokensV2.userId, user.id))
      .all()
    ).map((r: any) => r.id);

    const allTokenIds = [...tokenIds, ...oauthTokenIds, user.id];

    let monthlyRecalls = 0;
    let monthlyCommits = 0;
    let monthlyTokens = 0;
    if (allTokenIds.length > 0) {
      const usageRows = await db
        .select({
          recalls: sql<number>`SUM(${tokenUsages.recallCount})`,
          commits: sql<number>`SUM(${tokenUsages.commitCount})`,
          tokens: sql<number>`SUM(${tokenUsages.tokensConsumed})`,
        })
        .from(tokenUsages)
        .where(
          and(
            sql`${tokenUsages.tokenId} IN (${sql.join(allTokenIds.map((id) => sql`${id}`), sql`, `)})`,
            sql`${tokenUsages.date} LIKE ${monthPrefix + "%"}`
          )
        )
        .all();
      monthlyRecalls = Number(usageRows[0]?.recalls ?? 0);
      monthlyCommits = Number(usageRows[0]?.commits ?? 0);
      monthlyTokens = Number(usageRows[0]?.tokens ?? 0);
    }

    const usageStats = planId !== "free" ? await getUserUsageStats(db, user.id) : [];

    const userPlanRow = await db
      .select({ billingCustomerId: userPlans.billingCustomerId })
      .from(userPlans)
      .where(eq(userPlans.userId, user.id))
      .limit(1)
      .all();
    const hasBillingCustomer = !!userPlanRow[0]?.billingCustomerId;

    const managedOrgsRaw = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        plan: organizations.plan,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
      .where(
        and(
          eq(organizationMembers.userId, user.id),
          sql`${organizationMembers.role} IN ('owner', 'admin')`
        )
      )
      .all();

    const managedOrgs = await Promise.all(
      managedOrgsRaw.map(async (org) => {
        const activeMembers = await db
          .select({ count: sql<number>`COUNT(DISTINCT ${organizationMembers.userId})` })
          .from(organizationMembers)
          .where(eq(organizationMembers.orgId, org.id))
          .all();
        const activeSeatCount = Number(activeMembers[0]?.count ?? 0);
        const billedSeats = (PLANS[resolvePlan(org.plan)].limits as any).seatsPerOrg ?? 10;
        return {
          ...org,
          activeSeatCount,
          billedSeats,
        };
      })
    );

    // ── Sitewide plan settings ───────────────────────────────────────────────
    const siteSettingRows = await db.select().from(systemSettings).all();
    const settingsMap = new Map(siteSettingRows.map((r) => [r.key, r.value]));
    const enableBusinessPlans = settingsMap.get("enable_business_plans") !== "false";
    const enableEnterprisePlans = settingsMap.get("enable_enterprise_plans") !== "false";

    return {
      planId,
      personalPlanId,
      orgId,
      userId: user.id,
      hasBillingCustomer,
      managedOrgs,
      enableBusinessPlans,
      enableEnterprisePlans,
      usage: {
        memories: Number(memoriesCount[0]?.count ?? 0),
        apiTokens: Number(tokensCount[0]?.count ?? 0),
        monthlyRecalls,
        monthlyCommits,
        monthlyTokens,
      },
      usageStats,
    };
  }
);

export const Route = createFileRoute("/billing")({
  component: BillingPage,
});

// ── shared primitives ──────────────────────────────────────────────────────

export function UsageBar({ label, current, max }: { label: string; current: number; max: number }) {
  const pct = max === Infinity ? 0 : Math.min(100, (current / max) * 100);
  const isNearLimit = pct >= 80;
  const isAtLimit = pct >= 100;
  const colorClass = isAtLimit ? "bg-error" : isNearLimit ? "bg-amber-500" : "bg-accent";
  const textClass = isAtLimit ? "text-error font-semibold" : "text-text font-semibold";
  return (
    <div className="flex flex-col gap-1.5 select-none">
      <div className="flex justify-between text-xs md:text-sm">
        <span className="text-text-muted">{label}</span>
        <span className={textClass}>
          {current.toLocaleString()}
          {max !== Infinity && ` / ${max.toLocaleString()}`}
          {max === Infinity && " / ∞"}
        </span>
      </div>
      {max !== Infinity && (
        <div className="h-1.5 bg-surface2 border border-border/40 rounded-full overflow-hidden">
          <div className={`h-full ${colorClass} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function TokenUsageChart({ tokenName, dailyBreakdown }: {
  tokenName: string;
  dailyBreakdown: Array<{ date: string; recalls: number; commits: number; tokens: number }>;
}) {
  if (dailyBreakdown.length === 0) return null;
  const last14 = dailyBreakdown.slice(-14);
  const totalTokens = dailyBreakdown.reduce((sum, d) => sum + d.tokens, 0);
  return (
    <div className="bg-surface2 border border-border rounded-xl p-4 flex flex-col gap-3 shadow-3xs select-none">
      <div className="text-xs font-bold text-text flex justify-between items-center uppercase tracking-wider">
        <span>{tokenName}</span>
        <span className="text-[10px] text-text-muted normal-case font-medium">Tokens: {totalTokens.toLocaleString()}</span>
      </div>
      <div className="flex items-end gap-1 h-[60px]">
        {last14.map((d) => {
          const total = d.recalls + d.commits;
          const height = Math.max(2, (total / Math.max(...last14.map((x) => x.recalls + x.commits), 1)) * 56);
          const recallH = (d.recalls / Math.max(total, 1)) * height;
          const commitH = (d.commits / Math.max(total, 1)) * height;
          return (
            <div key={d.date} title={`${d.date}\nRecalls: ${d.recalls}\nCommits: ${d.commits}\nTokens: ${d.tokens}`}
              className="flex-1 flex flex-col justify-end gap-0.5">
              <div className="bg-accent rounded-t-xs min-h-[2px] transition-all duration-300" style={{ height: d.recalls > 0 ? `${recallH}px` : "0px" }} />
              <div className="bg-emerald-400 rounded-t-xs min-h-[2px] transition-all duration-300" style={{ height: d.commits > 0 ? `${commitH}px` : "0px", borderRadius: d.recalls > 0 ? "0px" : "2px 2px 0 0" }} />
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-1">
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted font-bold uppercase tracking-wider">
          <div className="w-2.5 h-2.5 rounded-sm bg-accent" /> Recalls
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted font-bold uppercase tracking-wider">
          <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400" /> Commits
        </div>
      </div>
    </div>
  );
}

// ── hook: shared billing data ──────────────────────────────────────────────

export function useBillingData() {
  return useQuery({ queryKey: ["billing"], queryFn: () => getBillingInfo() });
}

// ── exported section: My Usage ─────────────────────────────────────────────

export function MyUsageSection() {
  const { data: billing, isLoading } = useBillingData();
  const currentPlan: PlanId = billing?.planId ?? "free";
  const limits = PLANS[currentPlan].limits;

  if (isLoading) return <p className="text-text-muted text-xs animate-pulse font-medium">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <section className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
        <div className="flex items-center justify-between gap-4 select-none">
          <div>
            <h2 className="text-base font-bold text-text">Current Usage</h2>
            <p className="text-xs text-text-muted mt-0.5 leading-relaxed">Your personal resource consumption this billing period.</p>
          </div>
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Resets monthly</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UsageBar label="Personal Memories" current={billing?.usage.memories ?? 0} max={limits.maxMemories} />
          <UsageBar label="API Tokens" current={billing?.usage.apiTokens ?? 0} max={limits.maxApiTokens} />
          <UsageBar label="Monthly Recalls (MCP)" current={billing?.usage.monthlyRecalls ?? 0} max={limits.maxMonthlyRecalls} />
          <UsageBar label="Monthly Commits (MCP)" current={billing?.usage.monthlyCommits ?? 0} max={limits.maxMonthlyCommits} />
          <UsageBar label="Monthly Embedding Tokens" current={billing?.usage.monthlyTokens ?? 0} max={limits.maxMonthlyTokens} />
        </div>
      </section>

      {currentPlan !== "free" && billing?.usageStats && (
        <section className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
          <h2 className="text-base font-bold text-text select-none">
            Token Usage Analytics{" "}
            <span className="text-xs font-normal text-text-muted normal-case tracking-normal">(Last 30 days)</span>
          </h2>
          {billing.usageStats.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {billing.usageStats.map((s) => (
                <TokenUsageChart key={s.tokenId} tokenName={s.tokenName} dailyBreakdown={s.dailyBreakdown} />
              ))}
            </div>
          ) : (
            <div className="py-10 text-center bg-accent/5 border border-accent/15 rounded-xl select-none">
              <div className="text-text-muted text-xs font-semibold">No usage recorded yet</div>
              <div className="text-text-muted text-[11px] mt-1">Make your first MCP call to see token usage data here.</div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ── exported section: My Billing (personal plan management) ────────────────

export function MyBillingSection() {
  const { data: billing, isLoading } = useBillingData();
  const [upgradingId, setUpgradingId] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [stripeError, setStripeError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      setSuccessMsg("Success! Your subscription is active/updated.");
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (params.get("cancelled") === "true") {
      setCancelMsg("Subscription checkout cancelled.");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  async function handleUpgrade() {
    setUpgradingId("personal");
    setStripeError(null);
    try {
      const res = await createCheckoutSession({ data: { orgId: undefined } });
      if (res?.url) window.location.href = res.url;
      else throw new Error("No checkout URL returned.");
    } catch (err: any) {
      setStripeError(err?.message || "An error occurred initiating checkout.");
      setUpgradingId(null);
    }
  }

  async function handlePortal() {
    setPortalLoading(true);
    setStripeError(null);
    try {
      const res = await createPortalSession({ data: { orgId: undefined } });
      if (res?.url) window.location.href = res.url;
      else throw new Error("No portal URL returned.");
    } catch (err: any) {
      setStripeError(err?.message || "An error occurred opening the billing portal.");
      setPortalLoading(false);
    }
  }

  if (isLoading) return <p className="text-text-muted text-xs animate-pulse font-medium">Loading…</p>;

  const personalPlan: PlanId = billing?.personalPlanId ?? "free";
  const effectivePlan: PlanId = billing?.planId ?? "free";
  const elevatedByOrg = effectivePlan !== personalPlan;

  return (
    <div className="flex flex-col gap-6">
      {successMsg && (
        <div className="p-3 bg-success/10 border border-success/30 rounded-xl text-success text-xs font-semibold select-none flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
          {successMsg}
        </div>
      )}
      {cancelMsg && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400 text-xs font-semibold select-none flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {cancelMsg}
        </div>
      )}
      {stripeError && (
        <div className="p-3 bg-error/10 border border-error/30 rounded-xl text-error text-xs font-semibold select-none flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {stripeError}
        </div>
      )}

      {elevatedByOrg ? (
        <section className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
          <div className="flex items-center gap-2.5 select-none">
            <h2 className="text-base font-bold text-text">My Billing</h2>
            <PlanBadge plan={effectivePlan} />
          </div>
          <div className="p-4 bg-success/5 border border-success/15 rounded-xl text-xs md:text-sm leading-relaxed text-text-muted select-none">
            <div className="font-bold text-success mb-1 flex items-center gap-1.5">
              ✓ Your {effectivePlan} features come from your organization
            </div>
            You currently have full <strong className="text-text font-bold">{effectivePlan}</strong> access through your org seat.
            Your personal subscription is <strong className="text-text font-bold">{personalPlan}</strong> — if you lose your org seat
            (leave, get removed, or the org downgrades), you would immediately fall back to your personal plan's limits and features.
          </div>
          {billing?.hasBillingCustomer && (
            <div>
              <Button onClick={handlePortal} disabled={portalLoading} className="font-semibold text-xs h-8 select-none gap-1.5" variant="outline">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                {portalLoading ? "Opening…" : "Manage Personal Subscription"}
              </Button>
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
            <div className="flex items-center justify-between gap-4 flex-wrap select-none">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-text">My Plan</h2>
                <PlanBadge plan={personalPlan} />
              </div>
              {billing?.hasBillingCustomer && (
                <Button onClick={handlePortal} disabled={portalLoading} variant="outline" className="h-8 text-xs font-semibold gap-1.5 select-none">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  {portalLoading ? "Opening…" : "Manage Subscription"}
                </Button>
              )}
            </div>
            <p className="text-xs text-text-muted -mt-2 leading-relaxed">Your personal subscription tier.</p>

            {personalPlan === "free" && (
              <div className="flex flex-col gap-3">
                <p className="text-xs md:text-sm text-text-muted leading-relaxed">
                  You're on the free plan. Upgrade to unlock more memories, recalls, and advanced analytics.
                </p>
                <div className="flex gap-2.5 flex-wrap mt-1 items-center">
                  <div className="relative group">
                    <Button
                      onClick={billing?.enableBusinessPlans ? handleUpgrade : undefined}
                      disabled={!billing?.enableBusinessPlans || upgradingId !== null}
                      className="font-bold text-xs select-none h-9 px-4"
                    >
                      {upgradingId === "personal" ? "Redirecting to Checkout…" : "Upgrade to Business"}
                    </Button>
                    {!billing?.enableBusinessPlans && (
                      <div className="absolute bottom-full left-0 mb-2 w-56 bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-text-muted shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                        Business plan upgrades are disabled. Enable them in{" "}
                        <span className="text-accent font-semibold">Site Admin → Site Configuration</span>.
                      </div>
                    )}
                  </div>
                  {billing?.enableEnterprisePlans && (
                    <a href="mailto:enterprise@locker.rcormier.dev" className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-amber-500/30 text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/5 text-xs font-bold transition-all text-center select-none">
                      Contact Sales for Enterprise
                    </a>
                  )}
                </div>
              </div>
            )}

            {(personalPlan === "business" || personalPlan === "business_comp") && (
              <div className="flex gap-2.5 flex-wrap items-center mt-1">
                <div className="relative group">
                  <a
                    href={billing?.enableEnterprisePlans ? "mailto:enterprise@locker.rcormier.dev" : undefined}
                    onClick={!billing?.enableEnterprisePlans ? (e) => e.preventDefault() : undefined}
                    className={`inline-flex items-center justify-center h-9 px-4 rounded-lg border text-xs font-bold transition-all text-center select-none ${
                      billing?.enableEnterprisePlans
                        ? "border-amber-500/30 text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/5"
                        : "border-border text-text-muted opacity-50 cursor-not-allowed"
                    }`}
                  >
                    Upgrade to Enterprise
                  </a>
                  {!billing?.enableEnterprisePlans && (
                    <div className="absolute bottom-full left-0 mb-2 w-56 bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-text-muted shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                      Enterprise upgrades are disabled. Enable in{" "}
                      <span className="text-accent font-semibold">Site Admin → Site Configuration</span>.
                    </div>
                  )}
                </div>
                {billing?.hasBillingCustomer && (
                  <Button onClick={handlePortal} disabled={portalLoading} variant="ghost" className="h-9 text-xs text-error hover:text-error hover:bg-error/5 hover:border-error/25 px-3">
                    {portalLoading ? "Opening…" : "Downgrade / Cancel"}
                  </Button>
                )}
              </div>
            )}

            {personalPlan === "enterprise" && (
              <p className="text-xs md:text-sm text-text-muted leading-relaxed">
                You're on the Enterprise plan. Contact{" "}
                <a href="mailto:enterprise@locker.rcormier.dev" className="text-accent hover:underline font-semibold">enterprise@locker.rcormier.dev</a>
                {" "}to make changes to your contract.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-base font-bold text-text select-none">Available Plans</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {SELF_SERVE_PLAN_ORDER.map((planId) => (
                <PlanCard
                  key={planId}
                  plan={PLANS[planId]}
                  isCurrentPlan={planId === personalPlan || (planId === "business" && personalPlan === "business_comp")}
                  onSelect={planId === "business" && personalPlan === "free" ? handleUpgrade : undefined}
                  upgradesEnabled={planId === "enterprise" ? !!billing?.enableEnterprisePlans : !!billing?.enableBusinessPlans}
                />
              ))}
            </div>
          </section>

          <div className="p-5 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 select-none">
            <div>
              <div className="text-xs md:text-sm font-bold text-text mb-0.5">Need Enterprise?</div>
              <div className="text-[11px] text-text-muted leading-relaxed">Unlimited memories, SAML SSO, custom contracts, dedicated support.</div>
            </div>
            <div className="relative group flex-shrink-0">
              <a
                href={billing?.enableEnterprisePlans ? "mailto:enterprise@locker.rcormier.dev" : undefined}
                onClick={!billing?.enableEnterprisePlans ? (e) => e.preventDefault() : undefined}
                className={`inline-flex items-center justify-center h-9 px-5 rounded-lg border text-xs font-bold transition-all text-center select-none ${
                  billing?.enableEnterprisePlans
                    ? "border-amber-500/30 text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/5"
                    : "border-border text-text-muted opacity-50 cursor-not-allowed"
                }`}
              >
                Contact Sales
              </a>
              {!billing?.enableEnterprisePlans && (
                <div className="absolute bottom-full right-0 mb-2 w-56 bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-text-muted shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                  Enterprise upgrades are disabled. Enable in{" "}
                  <span className="text-accent font-semibold">Site Admin → Site Configuration</span>.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── exported section: Org Billing (org admin view) ─────────────────────────

export function OrgBillingSection() {
  const { data: billing, isLoading } = useBillingData();
  const [upgradingId, setUpgradingId] = useState<string | null>(null);
  const [portalLoadingId, setPortalLoadingId] = useState<string | null>(null);
  const [stripeError, setStripeError] = useState<string | null>(null);

  async function handleOrgUpgrade(orgId: string) {
    setUpgradingId(orgId);
    setStripeError(null);
    try {
      const res = await createCheckoutSession({ data: { orgId } });
      if (res?.url) window.location.href = res.url;
      else throw new Error("No checkout URL returned.");
    } catch (err: any) {
      setStripeError(err?.message || "An error occurred initiating checkout.");
      setUpgradingId(null);
    }
  }

  async function handleOrgPortal(orgId: string) {
    setPortalLoadingId(orgId);
    setStripeError(null);
    try {
      const res = await createPortalSession({ data: { orgId } });
      if (res?.url) window.location.href = res.url;
      else throw new Error("No portal URL returned.");
    } catch (err: any) {
      setStripeError(err?.message || "An error occurred opening the billing portal.");
      setPortalLoadingId(null);
    }
  }

  if (isLoading) return <p className="text-text-muted text-xs animate-pulse font-medium">Loading…</p>;

  if (!billing?.managedOrgs?.length) {
    return (
      <section className="bg-surface border border-border rounded-2xl p-5 shadow-xs">
        <h2 className="text-base font-bold text-text mb-1 select-none">Organization Billing</h2>
        <p className="text-xs text-text-muted leading-relaxed">
          You are not an owner or admin of any organization. Join or create an organization to manage its billing.
        </p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {stripeError && (
        <div className="p-3 bg-error/10 border border-error/30 rounded-xl text-error text-xs font-semibold select-none flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          {stripeError}
        </div>
      )}

      <section className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold text-text select-none">Organization Billing</h2>
          <p className="text-xs text-text-muted mt-0.5 leading-relaxed">
            Seat-based billing for organizations you manage. Only owners and admins can make billing changes.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          {billing.managedOrgs.map((org: any) => {
            const orgPlan = resolvePlan(org.plan);
            const isUpgrading = upgradingId === org.id;
            const isPortaling = portalLoadingId === org.id;
            const canManage = org.role === "owner" || org.role === "admin";
            const activeSeatCount = org.activeSeatCount || 0;
            const billedSeats = org.billedSeats || 10;
            const seatsAvailable = billedSeats - activeSeatCount;

            return (
              <div key={org.id} className="border border-border rounded-xl p-4 bg-surface2 shadow-3xs">
                <div className="flex items-start justify-between gap-4 flex-wrap md:flex-nowrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap select-none">
                      <span className="font-semibold text-sm md:text-base text-text">{org.name}</span>
                      <PlanBadge plan={orgPlan} />
                      <Badge variant={org.role === "owner" ? "error" : "accent"} className="h-5 text-[9px] px-2 font-bold tracking-normal normal-case">
                        {org.role}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-text-muted mt-1 select-all font-medium">ID: {org.id}</p>
                    <div className="text-xs text-text mt-3 p-3 bg-accent/5 border border-accent/15 rounded-xl max-w-sm select-none">
                      <div className="font-bold text-[11px] uppercase tracking-wider mb-1">Seat Usage</div>
                      <div className="text-text-muted text-[11px] font-medium">
                        {activeSeatCount} active / {billedSeats} billed
                        {seatsAvailable > 0 && (
                          <span className="text-success font-semibold"> • {seatsAvailable} available</span>
                        )}
                        {seatsAvailable <= 0 && (
                          <span className="text-error font-semibold"> • No seats available</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {canManage && (
                    <div className="flex gap-2 flex-wrap justify-end self-start md:self-auto select-none mt-2 md:mt-0">
                      {orgPlan === "free" && (
                        <>
                          <div className="relative group">
                            <Button
                              onClick={billing?.enableBusinessPlans ? () => handleOrgUpgrade(org.id) : undefined}
                              disabled={!billing?.enableBusinessPlans || isUpgrading || upgradingId !== null}
                              className="h-9 px-4 font-bold text-xs"
                            >
                              {isUpgrading ? "Redirecting…" : "Upgrade to Business"}
                            </Button>
                            {!billing?.enableBusinessPlans && (
                              <div className="absolute bottom-full left-0 mb-2 w-56 bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-text-muted shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                Business plan upgrades are disabled. Enable them in{" "}
                                <span className="text-accent font-semibold">Site Admin → Site Configuration</span>.
                              </div>
                            )}
                          </div>
                          {billing?.enableEnterprisePlans && (
                            <a href="mailto:enterprise@locker.rcormier.dev" className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-amber-500/30 text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/5 text-xs font-bold transition-all text-center">
                              Enterprise
                            </a>
                          )}
                        </>
                      )}
                      {(orgPlan === "business" || orgPlan === "business_comp") && (
                        <>
                          <div className="relative group">
                            <a
                              href={billing?.enableEnterprisePlans ? "mailto:enterprise@locker.rcormier.dev" : undefined}
                              onClick={!billing?.enableEnterprisePlans ? (e) => e.preventDefault() : undefined}
                              className={`inline-flex items-center justify-center h-9 px-4 rounded-lg border text-xs font-bold transition-all text-center ${
                                billing?.enableEnterprisePlans
                                  ? "border-amber-500/30 text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/5"
                                  : "border-border text-text-muted opacity-50 cursor-not-allowed"
                              }`}
                            >
                              Upgrade to Enterprise
                            </a>
                            {!billing?.enableEnterprisePlans && (
                              <div className="absolute bottom-full left-0 mb-2 w-56 bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-text-muted shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                Enterprise upgrades are disabled. Enable in{" "}
                                <span className="text-accent font-semibold">Site Admin → Site Configuration</span>.
                              </div>
                            )}
                          </div>
                          <Button onClick={() => handleOrgPortal(org.id)} disabled={isPortaling} variant="outline" className="h-9 px-4 font-semibold text-xs">
                            {isPortaling ? "Opening…" : "Manage / Downgrade"}
                          </Button>
                        </>
                      )}
                      {orgPlan === "enterprise" && (
                        <a href="mailto:enterprise@locker.rcormier.dev" className="inline-flex items-center justify-center h-9 px-4 rounded-lg border border-border text-text hover:border-text-muted hover:bg-surface2 text-xs font-semibold transition-all text-center">
                          Contact Sales to Change Plan
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-base font-bold text-text select-none">Available Organization Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {SELF_SERVE_PLAN_ORDER.map((planId) => (
            <PlanCard
              key={planId}
              plan={PLANS[planId]}
              isCurrentPlan={false}
              upgradesEnabled={planId === "enterprise" ? !!billing?.enableEnterprisePlans : !!billing?.enableBusinessPlans}
            />
          ))}
        </div>
      </section>

      <div className="p-5 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 select-none">
        <div>
          <div className="text-xs md:text-sm font-bold text-text mb-0.5">Need Enterprise for your org?</div>
          <div className="text-[11px] text-text-muted leading-relaxed">Unlimited seats, SAML SSO, custom contracts, SLA support.</div>
        </div>
        <div className="relative group flex-shrink-0">
          <a
            href={billing?.enableEnterprisePlans ? "mailto:enterprise@locker.rcormier.dev" : undefined}
            onClick={!billing?.enableEnterprisePlans ? (e) => e.preventDefault() : undefined}
            className={`inline-flex items-center justify-center h-9 px-5 rounded-lg border text-xs font-bold transition-all text-center ${
              billing?.enableEnterprisePlans
                ? "border-amber-500/30 text-amber-400 hover:border-amber-500/50 hover:bg-amber-500/5"
                : "border-border text-text-muted opacity-50 cursor-not-allowed"
            }`}
          >
            Contact Sales
          </a>
          {!billing?.enableEnterprisePlans && (
            <div className="absolute bottom-full right-0 mb-2 w-56 bg-surface2 border border-border rounded-lg px-3 py-2 text-xs text-text-muted shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              Enterprise upgrades are disabled. Enable in{" "}
              <span className="text-accent font-semibold">Site Admin → Site Configuration</span>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── legacy combined section (used by standalone /billing route) ────────────

export function PersonalBillingSection() {
  return (
    <div className="flex flex-col gap-6">
      <MyBillingSection />
      <div className="flex flex-col gap-4 mt-4">
        <h2 className="text-lg font-bold text-text select-none">Organization Details</h2>
        <OrgBillingSection />
      </div>
    </div>
  );
}

function BillingPage() {
  return (
    <div className="flex-1 min-h-screen bg-background">
      <PageHeader
        title="Plan & Billing"
        icon={
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
          </svg>
        }
        description="Manage your plan, track usage, and view available features."
      />
      <PageContainer>
        <PersonalBillingSection />
      </PageContainer>
    </div>
  );
}
