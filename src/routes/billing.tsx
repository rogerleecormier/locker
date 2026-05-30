import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { PLANS, PLAN_ORDER, resolvePlan, type PlanId } from "~/lib/plans";
import { PlanCard, PlanBadge, AdminUpgradeButton } from "~/components/PaywallGate";
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
  teams,
  teamMembers,
  userPlans,
  oauthAccessTokensV2,
} from "~/db/schema";
import { eq, sql, and } from "drizzle-orm";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

export const getBillingInfo = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { memories, apiTokens, organizations, organizationMembers, orgQuotas, tokenUsages, teams, teamMembers, userPlans, oauthAccessTokensV2 } });

    const { planId, orgId } = await getUserEffectivePlan(db, user.id);

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

    const managedOrgs = await db
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

    return {
      planId,
      orgId,
      userId: user.id,
      hasBillingCustomer,
      managedOrgs,
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

function UsageBar({ label, current, max }: { label: string; current: number; max: number }) {
  const pct = max === Infinity ? 0 : Math.min(100, (current / max) * 100);
  const isNearLimit = pct >= 80;
  const isAtLimit = pct >= 100;
  const color = isAtLimit ? "var(--error)" : isNearLimit ? "#f59e0b" : "var(--accent)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
        <span style={{ color: isAtLimit ? "var(--error)" : "var(--text)", fontWeight: 600 }}>
          {current.toLocaleString()}
          {max !== Infinity && ` / ${max.toLocaleString()}`}
          {max === Infinity && " / ∞"}
        </span>
      </div>
      {max !== Infinity && (
        <div style={{ height: 5, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
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
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{tokenName}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>Tokens: {totalTokens.toLocaleString()}</span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "60px" }}>
        {last14.map((d) => {
          const total = d.recalls + d.commits;
          const height = Math.max(2, (total / Math.max(...last14.map((x) => x.recalls + x.commits), 1)) * 56);
          const recallH = (d.recalls / Math.max(total, 1)) * height;
          const commitH = (d.commits / Math.max(total, 1)) * height;
          return (
            <div key={d.date} title={`${d.date}\nRecalls: ${d.recalls}\nCommits: ${d.commits}\nTokens: ${d.tokens}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: "1px" }}>
              <div style={{ height: `${recallH}px`, background: "var(--accent)", borderRadius: "2px 2px 0 0", minHeight: d.recalls > 0 ? "2px" : "0px" }} />
              <div style={{ height: `${commitH}px`, background: "#34d399", borderRadius: d.recalls > 0 ? 0 : "2px 2px 0 0", minHeight: d.commits > 0 ? "2px" : "0px" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-muted)" }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)" }} />
          Recalls
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-muted)" }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "#34d399" }} />
          Commits
        </div>
      </div>
    </div>
  );
}

function BillingPage() {
  const { data: billing, isLoading } = useQuery({
    queryKey: ["billing"],
    queryFn: () => getBillingInfo(),
  });

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

  async function handleUpgrade(orgId?: string) {
    const id = orgId || "personal";
    setUpgradingId(id);
    setStripeError(null);
    try {
      const res = await createCheckoutSession({ data: { orgId } });
      if (res?.url) {
        window.location.href = res.url;
      } else {
        throw new Error("Failed to generate checkout session url.");
      }
    } catch (err: any) {
      setStripeError(err?.message || "An error occurred initiating checkout.");
      setUpgradingId(null);
    }
  }

  async function handlePortal(orgId?: string) {
    setPortalLoading(true);
    setStripeError(null);
    try {
      const res = await createPortalSession({ data: { orgId } });
      if (res?.url) {
        window.location.href = res.url;
      } else {
        throw new Error("Failed to generate portal session url.");
      }
    } catch (err: any) {
      setStripeError(err?.message || "An error occurred opening the billing portal.");
      setPortalLoading(false);
    }
  }

  const currentPlan: PlanId = billing?.planId ?? "free";
  const planObj = PLANS[currentPlan];
  const limits = planObj.limits;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <header style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" />
            </svg>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Plan & Billing</h1>
            {billing && <PlanBadge plan={currentPlan} />}
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
            Manage your plan, track usage, and view available features.
          </p>
        </div>
        {billing?.hasBillingCustomer && (
          <button
            onClick={() => handlePortal()}
            disabled={portalLoading}
            style={{
              padding: "8px 16px",
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontWeight: 600,
              fontSize: 13,
              borderRadius: 8,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            {portalLoading ? "Opening Stripe..." : "Manage Subscription"}
          </button>
        )}
      </header>

      {successMsg && (
        <div style={{ padding: "12px 16px", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", borderRadius: 8, fontSize: 13, marginBottom: 20, fontWeight: 500 }}>
          {successMsg}
        </div>
      )}

      {cancelMsg && (
        <div style={{ padding: "12px 16px", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b", borderRadius: 8, fontSize: 13, marginBottom: 20, fontWeight: 500 }}>
          {cancelMsg}
        </div>
      )}

      {stripeError && (
        <div style={{ padding: "12px 16px", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", borderRadius: 8, fontSize: 13, marginBottom: 20, fontWeight: 500 }}>
          {stripeError}
        </div>
      )}

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>Loading…</div>
      ) : (
        <>
          <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Current Usage</h2>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Resets monthly for recall/commit/token counts</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <UsageBar label="Personal Memories" current={billing?.usage.memories ?? 0} max={limits.maxMemories} />
              <UsageBar label="API Tokens" current={billing?.usage.apiTokens ?? 0} max={limits.maxApiTokens} />
              <UsageBar label="Monthly Recalls (MCP)" current={billing?.usage.monthlyRecalls ?? 0} max={limits.maxMonthlyRecalls} />
              <UsageBar label="Monthly Commits (MCP)" current={billing?.usage.monthlyCommits ?? 0} max={limits.maxMonthlyCommits} />
              <UsageBar label="Monthly Embedding Tokens" current={billing?.usage.monthlyTokens ?? 0} max={limits.maxMonthlyTokens} />
            </div>
          </section>

          {currentPlan !== "free" && billing?.usageStats && billing.usageStats.length > 0 && (
            <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px", marginBottom: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>
                Token Usage Analytics{" "}
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>(Last 30 days)</span>
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {billing.usageStats.map((s) => (
                  <TokenUsageChart key={s.tokenId} tokenName={s.tokenName} dailyBreakdown={s.dailyBreakdown} />
                ))}
              </div>
            </section>
          )}

          {billing?.managedOrgs && billing.managedOrgs.length > 0 && (
            <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px", marginBottom: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Organization Billing (Seat-based)</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {billing.managedOrgs.map((org) => (
                  <div key={org.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                        {org.name}
                        <PlanBadge plan={resolvePlan(org.plan)} />
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Role: {org.role}</div>
                    </div>
                    <div>
                      {org.plan === "free" ? (
                        billing?.isAdmin ? (
                          <AdminUpgradeButton
                            label="Upgrade to Business ($12/seat)"
                            style={{
                              padding: "8px 16px",
                              fontSize: 12,
                              borderRadius: 6,
                              width: "auto",
                            }}
                          />
                        ) : (
                          <button
                            onClick={() => handleUpgrade(org.id)}
                            disabled={upgradingId !== null}
                            style={{
                              padding: "8px 16px",
                              background: "var(--accent)",
                              border: "none",
                              color: "#fff",
                              fontWeight: 600,
                              fontSize: 12,
                              borderRadius: 6,
                              cursor: "pointer",
                              transition: "opacity 0.2s",
                            }}
                          >
                            {upgradingId === org.id ? "Redirecting..." : "Upgrade to Business ($12/seat)"}
                          </button>
                        )
                      ) : (
                        billing.hasBillingCustomer && (
                          <button
                            onClick={() => handlePortal(org.id)}
                            disabled={portalLoading}
                            style={{
                              padding: "8px 16px",
                              background: "transparent",
                              border: "1px solid var(--border)",
                              color: "var(--text)",
                              fontWeight: 600,
                              fontSize: 12,
                              borderRadius: 6,
                              cursor: "pointer",
                            }}
                          >
                            Manage Billing
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Available Plans</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {PLAN_ORDER.map((planId) => (
                <PlanCard
                  key={planId}
                  plan={PLANS[planId]}
                  isCurrentPlan={planId === currentPlan}
                  onSelect={planId === "business" ? () => handleUpgrade() : undefined}
                  isAdmin={billing?.isAdmin}
                />
              ))}
            </div>
          </section>

          <div style={{
            padding: "16px 20px",
            background: "rgba(245,158,11,0.06)",
            border: "1px solid rgba(245,158,11,0.2)",
            borderRadius: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>Need Enterprise?</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Unlimited memories, SAML SSO, custom contracts, dedicated support.
              </div>
            </div>
            <a
              href="mailto:enterprise@locker.rcormier.dev"
              style={{
                padding: "8px 18px",
                background: "transparent",
                border: "1px solid rgba(245,158,11,0.4)",
                color: "#f59e0b",
                fontWeight: 600,
                fontSize: 13,
                borderRadius: 8,
                textDecoration: "none",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              Contact Sales
            </a>
          </div>
        </>
      )}
    </div>
  );
}
