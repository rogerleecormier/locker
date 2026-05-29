import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { PLANS, PLAN_ORDER, type PlanId } from "~/lib/plans";
import { PlanCard, PlanBadge } from "~/components/PaywallGate";
import { getUserEffectivePlan, getUserUsageStats } from "~/server/planGate";
import { requireSession } from "~/server/session";
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
} from "~/db/schema";
import { eq, sql, and } from "drizzle-orm";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

export const getBillingInfo = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { memories, apiTokens, organizations, organizationMembers, orgQuotas, tokenUsages, teams, teamMembers, userPlans } });

    const { planId, orgId } = await getUserEffectivePlan(db, user.id, env.ADMIN_USER_ID);

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

    let monthlyRecalls = 0;
    let monthlyCommits = 0;
    if (tokenIds.length > 0) {
      const usageRows = await db
        .select({
          recalls: sql<number>`SUM(${tokenUsages.recallCount})`,
          commits: sql<number>`SUM(${tokenUsages.commitCount})`,
        })
        .from(tokenUsages)
        .where(
          and(
            sql`${tokenUsages.tokenId} IN (${sql.join(tokenIds.map((id) => sql`${id}`), sql`, `)})`,
            sql`${tokenUsages.date} LIKE ${monthPrefix + "%"}`
          )
        )
        .all();
      monthlyRecalls = Number(usageRows[0]?.recalls ?? 0);
      monthlyCommits = Number(usageRows[0]?.commits ?? 0);
    }

    const usageStats = planId !== "free" ? await getUserUsageStats(db, user.id) : [];

    return {
      planId,
      orgId,
      userId: user.id,
      usage: {
        memories: Number(memoriesCount[0]?.count ?? 0),
        apiTokens: Number(tokensCount[0]?.count ?? 0),
        monthlyRecalls,
        monthlyCommits,
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
  dailyBreakdown: Array<{ date: string; recalls: number; commits: number }>;
}) {
  if (dailyBreakdown.length === 0) return null;
  const maxVal = Math.max(...dailyBreakdown.map((d) => d.recalls + d.commits), 1);
  const last14 = dailyBreakdown.slice(-14);

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>{tokenName}</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 60 }}>
        {last14.map((d) => {
          const total = d.recalls + d.commits;
          const height = Math.max(2, (total / maxVal) * 56);
          const recallH = (d.recalls / Math.max(total, 1)) * height;
          const commitH = (d.commits / Math.max(total, 1)) * height;
          return (
            <div key={d.date} title={`${d.date}\nRecalls: ${d.recalls}\nCommits: ${d.commits}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 1 }}>
              <div style={{ height: recallH, background: "var(--accent)", borderRadius: "2px 2px 0 0", minHeight: d.recalls > 0 ? 2 : 0 }} />
              <div style={{ height: commitH, background: "#34d399", borderRadius: d.recalls > 0 ? 0 : "2px 2px 0 0", minHeight: d.commits > 0 ? 2 : 0 }} />
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

  const currentPlan: PlanId = billing?.planId ?? "free";
  const planObj = PLANS[currentPlan];
  const limits = planObj.limits;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <header style={{ marginBottom: 32 }}>
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
      </header>

      {isLoading ? (
        <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>Loading…</div>
      ) : (
        <>
          <section style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 22px", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Current Usage</h2>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Resets monthly for recall/commit counts</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <UsageBar label="Personal Memories" current={billing?.usage.memories ?? 0} max={limits.maxMemories} />
              <UsageBar label="API Tokens" current={billing?.usage.apiTokens ?? 0} max={limits.maxApiTokens} />
              <UsageBar label="Monthly Recalls (MCP)" current={billing?.usage.monthlyRecalls ?? 0} max={limits.maxMonthlyRecalls} />
              <UsageBar label="Monthly Commits (MCP)" current={billing?.usage.monthlyCommits ?? 0} max={limits.maxMonthlyCommits} />
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

          <section style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Available Plans</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {PLAN_ORDER.map((planId) => (
                <PlanCard
                  key={planId}
                  plan={PLANS[planId]}
                  isCurrentPlan={planId === currentPlan}
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
