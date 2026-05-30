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

    // Personal plan is what the user directly subscribed to, independent of
    // any org membership. Used to show the correct upgrade options in My Billing.
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

    // Orgs where the user is owner or admin — these can be billed
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
      planId,        // effective plan (highest of personal + orgs)
      personalPlanId, // what the user personally subscribes to
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

// ── shared primitives ──────────────────────────────────────────────────────

export function UsageBar({ label, current, max }: { label: string; current: number; max: number }) {
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
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)" }} /> Recalls
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--text-muted)" }}>
          <div style={{ width: 8, height: 8, borderRadius: 2, background: "#34d399" }} /> Commits
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

  if (isLoading) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>;

  return (
    <>
      <section style={card}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h2 style={sectionTitle}>Current Usage</h2>
            <p style={sectionDesc}>Your personal resource consumption this billing period.</p>
          </div>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Resets monthly</span>
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
        <section style={card}>
          <h2 style={{ ...sectionTitle, marginBottom: 16 }}>
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
    </>
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

  if (isLoading) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>;

  // personalPlanId = what the user directly subscribes to
  // planId = effective plan (may be elevated by org membership)
  const personalPlan: PlanId = billing?.personalPlanId ?? "free";
  const effectivePlan: PlanId = billing?.planId ?? "free";
  const elevatedByOrg = effectivePlan !== personalPlan;

  return (
    <>
      {successMsg && <div style={alertSuccess}>{successMsg}</div>}
      {cancelMsg && <div style={alertWarn}>{cancelMsg}</div>}
      {stripeError && <div style={alertError}>{stripeError}</div>}

      {/* If org is covering this user, show a clear explainer instead of upgrade prompts */}
      {elevatedByOrg ? (
        <section style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <h2 style={{ ...sectionTitle, margin: 0 }}>My Billing</h2>
            <PlanBadge plan={effectivePlan} />
          </div>
          <div style={{ padding: "14px 16px", background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 8, fontSize: 13, lineHeight: 1.6, color: "var(--text-muted)" }}>
            <div style={{ fontWeight: 600, color: "var(--success)", marginBottom: 6 }}>
              ✓ Your {effectivePlan} features come from your organization
            </div>
            You currently have full <strong style={{ color: "var(--text)" }}>{effectivePlan}</strong> access through your org seat.
            Your personal subscription is <strong style={{ color: "var(--text)" }}>{personalPlan}</strong> — if you lose your org seat
            (leave, get removed, or the org downgrades), you would immediately fall back to your personal plan's limits and features.
          </div>
          {billing?.hasBillingCustomer && (
            <div style={{ marginTop: 12 }}>
              <button onClick={handlePortal} disabled={portalLoading} style={{ ...btnOutline, fontSize: 12 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                {portalLoading ? "Opening…" : "Manage Personal Subscription"}
              </button>
            </div>
          )}
        </section>
      ) : (
        <>
          <section style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                  <h2 style={{ ...sectionTitle, margin: 0 }}>My Plan</h2>
                  <PlanBadge plan={personalPlan} />
                </div>
                <p style={sectionDesc}>Your personal subscription tier.</p>
              </div>
              {billing?.hasBillingCustomer && (
                <button onClick={handlePortal} disabled={portalLoading} style={btnOutline}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                  {portalLoading ? "Opening…" : "Manage Subscription"}
                </button>
              )}
            </div>

            {personalPlan === "free" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                  You're on the free plan. Upgrade to unlock more memories, recalls, and advanced analytics.
                </p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={handleUpgrade} disabled={upgradingId !== null} style={btnPrimary}>
                    {upgradingId === "personal" ? "Redirecting to Checkout…" : "Upgrade to Business"}
                  </button>
                  <a href="mailto:enterprise@locker.rcormier.dev" style={btnEnterprise}>Contact Sales for Enterprise</a>
                </div>
              </div>
            )}

            {personalPlan === "business" && (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <a href="mailto:enterprise@locker.rcormier.dev" style={btnEnterprise}>Upgrade to Enterprise</a>
                {billing?.hasBillingCustomer && (
                  <button onClick={handlePortal} disabled={portalLoading} style={{ ...btnOutline, fontSize: 12 }}>
                    {portalLoading ? "Opening…" : "Downgrade / Cancel"}
                  </button>
                )}
              </div>
            )}

            {personalPlan === "enterprise" && (
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
                You're on the Enterprise plan. Contact{" "}
                <a href="mailto:enterprise@locker.rcormier.dev" style={{ color: "var(--accent)" }}>enterprise@locker.rcormier.dev</a>
                {" "}to make changes to your contract.
              </p>
            )}
          </section>

          <section style={{ marginBottom: 24 }}>
            <h2 style={{ ...sectionTitle, marginBottom: 16 }}>Available Plans</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {PLAN_ORDER.map((planId) => (
                <PlanCard
                  key={planId}
                  plan={PLANS[planId]}
                  isCurrentPlan={planId === personalPlan}
                  onSelect={planId === "business" && personalPlan === "free" ? handleUpgrade : undefined}
                />
              ))}
            </div>
          </section>

          <div style={enterpriseCta}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>Need Enterprise?</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Unlimited memories, SAML SSO, custom contracts, dedicated support.</div>
            </div>
            <a href="mailto:enterprise@locker.rcormier.dev" style={btnEnterprise}>Contact Sales</a>
          </div>
        </>
      )}
    </>
  );
}

// ── exported section: Org Billing (org admin view) ─────────────────────────
// Security note: upgrade/downgrade actions call createCheckoutSession /
// createPortalSession which both call verifyOrgAdmin server-side before
// creating any Stripe session. UI gating here is UX only.

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

  if (isLoading) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>;

  if (!billing?.managedOrgs?.length) {
    return (
      <section style={card}>
        <h2 style={sectionTitle}>Organization Billing</h2>
        <p style={{ ...sectionDesc, margin: 0 }}>
          You are not an owner or admin of any organization. Join or create an organization to manage its billing.
        </p>
      </section>
    );
  }

  return (
    <>
      {stripeError && <div style={{ ...alertError, marginBottom: 16 }}>{stripeError}</div>}

      <section style={card}>
        <h2 style={{ ...sectionTitle, marginBottom: 4 }}>Organization Billing</h2>
        <p style={{ ...sectionDesc, marginBottom: 20 }}>
          Seat-based billing for organizations you manage. Only owners and admins can make billing changes.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {billing.managedOrgs.map((org) => {
            const orgPlan = resolvePlan(org.plan);
            const isUpgrading = upgradingId === org.id;
            const isPortaling = portalLoadingId === org.id;
            const canManage = org.role === "owner" || org.role === "admin";

            return (
              <div key={org.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px", background: "var(--surface2)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{org.name}</span>
                      <PlanBadge plan={orgPlan} />
                      <span style={{
                        fontSize: 10, fontWeight: 600, textTransform: "uppercase",
                        padding: "1px 6px", borderRadius: 10,
                        background: org.role === "owner" ? "rgba(239,68,68,0.1)" : "rgba(168,85,247,0.1)",
                        color: org.role === "owner" ? "var(--error)" : "var(--accent)",
                      }}>
                        {org.role}
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0 }}>ID: {org.id}</p>
                  </div>

                  {canManage && (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {orgPlan === "free" && (
                        <>
                          <button onClick={() => handleOrgUpgrade(org.id)} disabled={isUpgrading || upgradingId !== null} style={btnPrimary}>
                            {isUpgrading ? "Redirecting…" : "Upgrade to Business"}
                          </button>
                          <a href="mailto:enterprise@locker.rcormier.dev" style={btnEnterprise}>Enterprise</a>
                        </>
                      )}
                      {orgPlan === "business" && (
                        <>
                          <a href="mailto:enterprise@locker.rcormier.dev" style={btnEnterprise}>Upgrade to Enterprise</a>
                          <button onClick={() => handleOrgPortal(org.id)} disabled={isPortaling} style={{ ...btnOutline, fontSize: 12 }}>
                            {isPortaling ? "Opening…" : "Manage / Downgrade"}
                          </button>
                        </>
                      )}
                      {orgPlan === "enterprise" && (
                        <a href="mailto:enterprise@locker.rcormier.dev" style={btnOutline}>
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

      {/* Available plans for context */}
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ ...sectionTitle, marginBottom: 16 }}>Available Organization Plans</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {PLAN_ORDER.map((planId) => (
            <PlanCard key={planId} plan={PLANS[planId]} isCurrentPlan={false} />
          ))}
        </div>
      </section>

      <div style={enterpriseCta}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 3 }}>Need Enterprise for your org?</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Unlimited seats, SAML SSO, custom contracts, SLA support.</div>
        </div>
        <a href="mailto:enterprise@locker.rcormier.dev" style={btnEnterprise}>Contact Sales</a>
      </div>
    </>
  );
}

// ── legacy combined section (used by standalone /billing route) ────────────

export function PersonalBillingSection() {
  return (
    <>
      <MyBillingSection />
      <div style={{ marginTop: 32 }}>
        <h2 style={{ ...sectionTitle, marginBottom: 20 }}>Organization Billing</h2>
        <OrgBillingSection />
      </div>
    </>
  );
}

function BillingPage() {
  return (
    <div>
      <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)", padding: "20px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Plan & Billing</h1>
          </div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>Manage your plan, track usage, and view available features.</p>
        </div>
      </div>
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
        <PersonalBillingSection />
      </div>
    </div>
  );
}

// ── shared styles ──────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: 12, padding: "20px 22px", marginBottom: 24,
};
const sectionTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: "var(--text)", margin: "0 0 6px 0" };
const sectionDesc: React.CSSProperties = { fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0" };
const btnPrimary: React.CSSProperties = {
  padding: "8px 16px", background: "var(--accent)", color: "#fff",
  fontWeight: 600, fontSize: 13, borderRadius: 7, border: "none", cursor: "pointer",
};
const btnOutline: React.CSSProperties = {
  padding: "8px 16px", background: "transparent", border: "1px solid var(--border)",
  color: "var(--text)", fontWeight: 600, fontSize: 13, borderRadius: 7, cursor: "pointer",
  display: "flex", alignItems: "center", gap: 6, textDecoration: "none",
};
const btnEnterprise: React.CSSProperties = {
  padding: "8px 16px", background: "transparent", border: "1px solid rgba(245,158,11,0.4)",
  color: "#f59e0b", fontWeight: 600, fontSize: 13, borderRadius: 7, cursor: "pointer",
  textDecoration: "none", display: "inline-block",
};
const enterpriseCta: React.CSSProperties = {
  padding: "16px 20px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)",
  borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
};
const alertSuccess: React.CSSProperties = {
  padding: "12px 16px", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)",
  color: "#10b981", borderRadius: 8, fontSize: 13, marginBottom: 20, fontWeight: 500,
};
const alertWarn: React.CSSProperties = {
  padding: "12px 16px", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
  color: "#f59e0b", borderRadius: 8, fontSize: 13, marginBottom: 20, fontWeight: 500,
};
const alertError: React.CSSProperties = {
  padding: "12px 16px", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)",
  color: "var(--error)", borderRadius: 8, fontSize: 13, marginBottom: 20, fontWeight: 500,
};
