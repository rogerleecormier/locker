import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSystemMetrics, type SystemMetrics, type DailyActivity, type PlanDistribution, type CategoryBreakdown } from "~/routes/admin";

// ── Colour palette ────────────────────────────────────────────────────────────
const PLAN_COLORS: Record<string, string> = {
  free:          "#6b7280",
  business:      "#a855f7",
  business_comp: "#22c55e",
  enterprise:    "#f59e0b",
};
const PLAN_LABELS: Record<string, string> = {
  free:          "Free",
  business:      "Business",
  business_comp: "Business (Comp)",
  enterprise:    "Enterprise",
};
const CAT_COLORS: Record<string, string> = {
  rules:      "#a855f7",
  projects:   "#3b82f6",
  references: "#f59e0b",
  configs:    "#22c55e",
};
const STATUS_COLORS: Record<string, string> = {
  processed: "#22c55e",
  failed:    "#ef4444",
  pending:   "#f59e0b",
  unknown:   "#6b7280",
};

// ── Sparkline bar chart (no deps) ─────────────────────────────────────────────
function SparkBars({ data, color = "var(--accent)", height = 36 }: { data: number[]; color?: string; height?: number }) {
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height }}>
      {data.map((v, i) => (
        <div
          key={i}
          title={String(v)}
          style={{
            flex: 1,
            height: `${Math.max(2, (v / max) * height)}px`,
            background: color,
            borderRadius: "2px 2px 0 0",
            opacity: 0.85,
            transition: "height 0.3s ease",
          }}
        />
      ))}
    </div>
  );
}

// ── Donut chart ────────────────────────────────────────────────────────────────
function DonutChart({ segments, size = 80 }: { segments: Array<{ value: number; color: string; label: string }>; size?: number }) {
  const total = segments.reduce((s, c) => s + c.value, 0) || 1;
  let offset = 0;
  const r = 30;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 80 80">
      {segments.map((seg, i) => {
        const frac = seg.value / total;
        const dash = frac * circ;
        const gap = circ - dash;
        const el = (
          <circle
            key={i}
            cx="40" cy="40" r={r}
            fill="none"
            stroke={seg.color}
            strokeWidth="14"
            strokeDasharray={`${dash} ${gap}`}
            strokeDashoffset={-offset * circ}
            style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }}
          >
            <title>{`${seg.label}: ${seg.value}`}</title>
          </circle>
        );
        offset += frac;
        return el;
      })}
      <circle cx="40" cy="40" r="23" fill="var(--surface)" />
    </svg>
  );
}

// ── Metric card ────────────────────────────────────────────────────────────────
function MetricCard({
  label,
  value,
  sub,
  trend,
  trendUp,
  chart,
  onClick,
  accent = "var(--accent)",
}: {
  label: string;
  value: string | number;
  sub?: string;
  trend?: string;
  trendUp?: boolean;
  chart?: React.ReactNode;
  onClick?: () => void;
  accent?: string;
}) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        background: "var(--surface2)",
        border: `1px solid ${hov && onClick ? accent : "var(--border)"}`,
        borderRadius: 12,
        padding: "18px 20px",
        cursor: onClick ? "pointer" : "default",
        transition: "border-color 0.15s, box-shadow 0.15s",
        boxShadow: hov && onClick ? `0 4px 16px ${accent}22` : "none",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label} {onClick && <span style={{ opacity: 0.5, fontSize: 10 }}>↗</span>}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", lineHeight: 1 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          {sub && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{sub}</div>}
          {trend && (
            <div style={{ fontSize: 11, fontWeight: 600, color: trendUp ? "#22c55e" : "#f87171", marginTop: 2 }}>
              {trendUp ? "▲" : "▼"} {trend}
            </div>
          )}
        </div>
        {chart && <div style={{ flexShrink: 0 }}>{chart}</div>}
      </div>
    </div>
  );
}

// ── Drill-down modal ───────────────────────────────────────────────────────────
function DrillModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, width: "100%", maxWidth: 680, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 40px rgba(0,0,0,0.4)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{title}</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: "20px 24px", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Legend row ─────────────────────────────────────────────────────────────────
function LegendRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
      <div style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 36, textAlign: "right" }}>{pct}%</div>
      <div style={{ width: 80, height: 6, background: "var(--border)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

// ── Activity chart with labels ─────────────────────────────────────────────────
function ActivityChart({ data }: { data: DailyActivity[] }) {
  const maxVal = Math.max(...data.flatMap((d) => [d.recalls, d.commits]), 1);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 1, height: "100%" }}>
            <div title={`Recalls: ${d.recalls}`} style={{ flex: 1, height: `${Math.max(2, (d.recalls / maxVal) * 80)}px`, background: "#a855f7", borderRadius: "2px 2px 0 0", opacity: 0.8 }} />
            <div title={`Commits: ${d.commits}`} style={{ flex: 1, height: `${Math.max(2, (d.commits / maxVal) * 80)}px`, background: "#22c55e", borderRadius: "2px 2px 0 0", opacity: 0.8 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, fontSize: 9, color: "var(--text-muted)", textAlign: "center", overflow: "hidden" }}>
            {d.date.slice(5)}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
          <div style={{ width: 10, height: 10, background: "#a855f7", borderRadius: 2 }} /> Recalls
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
          <div style={{ width: 10, height: 10, background: "#22c55e", borderRadius: 2 }} /> Commits
        </div>
      </div>
    </div>
  );
}

// ── Main System Overview component ────────────────────────────────────────────
export function SystemOverviewSection() {
  const [drill, setDrill] = useState<string | null>(null);
  const metricsQuery = useQuery({
    queryKey: ["admin-system-metrics"],
    queryFn: () => getSystemMetrics(),
    refetchInterval: 30_000,
  });

  const m = metricsQuery.data;

  if (metricsQuery.isPending) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 300, color: "var(--text-muted)" }}>
        <div>Loading system metrics…</div>
      </div>
    );
  }
  if (metricsQuery.isError || !m) {
    return <div style={{ color: "var(--error)", padding: 20 }}>Failed to load system metrics. {String(metricsQuery.error)}</div>;
  }

  const recallSpark = m.activity.last7dActivity.map((d) => d.recalls);
  const commitSpark = m.activity.last7dActivity.map((d) => d.commits);
  const memSpark    = m.activity.last7dActivity.map((d) => d.recalls + d.commits);
  const userTotal   = m.users.total;
  const planSegs    = m.users.byPlan.map((p) => ({ value: p.count, color: PLAN_COLORS[p.plan] ?? "#6b7280", label: PLAN_LABELS[p.plan] ?? p.plan }));
  const catSegs     = m.memories.byCategory.map((c) => ({ value: c.count, color: CAT_COLORS[c.category] ?? "#6b7280", label: c.category }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
      {/* ── Header ── */}
      <div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "var(--text)" }}>System Overview</h2>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
          Live health metrics · Click any card for drill-down
        </p>
      </div>

      {/* ── Top KPI row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <MetricCard
          label="Total Users"
          value={userTotal.toLocaleString()}
          sub={`+${m.users.newLast7d} this week`}
          trend={`${m.users.newLast30d} last 30d`}
          trendUp={m.users.newLast7d > 0}
          chart={<DonutChart segments={planSegs} size={64} />}
          onClick={() => setDrill("users")}
          accent="#a855f7"
        />
        <MetricCard
          label="Total Memories"
          value={m.memories.total.toLocaleString()}
          sub={`+${m.memories.addedLast7d} this week`}
          trend={`+${m.memories.addedLast30d} last 30d`}
          trendUp={m.memories.addedLast7d > 0}
          chart={<DonutChart segments={catSegs} size={64} />}
          onClick={() => setDrill("memories")}
          accent="#3b82f6"
        />
        <MetricCard
          label="Recalls (7d)"
          value={recallSpark.reduce((a, b) => a + b, 0).toLocaleString()}
          sub={`${m.activity.totalRecalls.toLocaleString()} total (30d)`}
          chart={<SparkBars data={recallSpark} color="#a855f7" height={40} />}
          onClick={() => setDrill("activity")}
          accent="#a855f7"
        />
        <MetricCard
          label="Commits (7d)"
          value={commitSpark.reduce((a, b) => a + b, 0).toLocaleString()}
          sub={`${m.activity.totalCommits.toLocaleString()} total (30d)`}
          chart={<SparkBars data={commitSpark} color="#22c55e" height={40} />}
          onClick={() => setDrill("activity")}
          accent="#22c55e"
        />
      </div>

      {/* ── Second row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <MetricCard
          label="Organizations"
          value={m.orgs.total.toLocaleString()}
          sub={`${m.orgs.totalMembers} total members`}
          onClick={() => setDrill("orgs")}
          accent="#f59e0b"
        />
        <MetricCard
          label="Webhook Events"
          value={m.webhooks.total.toLocaleString()}
          sub={`${m.webhooks.last7d} last 7 days`}
          trendUp={m.webhooks.last7d > 0}
          chart={<SparkBars data={[m.webhooks.last7d, m.webhooks.total - m.webhooks.last7d].filter(Boolean)} color="#06b6d4" height={40} />}
          onClick={() => setDrill("webhooks")}
          accent="#06b6d4"
        />
        <MetricCard
          label="Plan Upgrades (30d)"
          value={m.planEvents.last30d.reduce((a, e) => a + e.count, 0)}
          sub="Upgrade / downgrade events"
          onClick={() => setDrill("plan-events")}
          accent="#f59e0b"
        />
        <MetricCard
          label="Paid Users"
          value={(m.users.byPlan.filter(p => p.plan === "business" || p.plan === "enterprise").reduce((a, p) => a + p.count, 0)).toLocaleString()}
          sub={`${(m.users.byPlan.find(p => p.plan === "business_comp")?.count ?? 0)} comp'd`}
          onClick={() => setDrill("users")}
          accent="#22c55e"
        />
      </div>

      {/* ── Activity chart ── */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>MCP Activity — Last 7 Days</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Recall + commit operations per day</div>
          </div>
          <button
            onClick={() => setDrill("activity")}
            style={{ fontSize: 12, padding: "5px 12px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}
          >
            Full breakdown ↗
          </button>
        </div>
        <ActivityChart data={m.activity.last7dActivity} />
      </div>

      {/* ── Plan distribution ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>User Plan Distribution</div>
          {m.users.byPlan.map((p) => (
            <LegendRow key={p.plan} label={PLAN_LABELS[p.plan] ?? p.plan} value={p.count} total={userTotal} color={PLAN_COLORS[p.plan] ?? "#6b7280"} />
          ))}
          {m.users.byPlan.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No plan data yet.</div>}
        </div>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Memory Category Breakdown</div>
          {m.memories.byCategory.map((c) => (
            <LegendRow key={c.category} label={c.category} value={c.count} total={m.memories.total} color={CAT_COLORS[c.category] ?? "#6b7280"} />
          ))}
          {m.memories.byCategory.length === 0 && <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No memories yet.</div>}
        </div>
      </div>

      {/* ── Top actions ── */}
      {m.activity.topActions.length > 0 && (
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Top MCP Actions (30d)</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {m.activity.topActions.map((a) => (
              <div key={a.action} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace", marginBottom: 4 }}>{a.action}</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)" }}>{a.count.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent signups ── */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Recent Signups</div>
          <button onClick={() => setDrill("users")} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--accent)", cursor: "pointer" }}>
            View all ↗
          </button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              {["Name", "Email", "Plan", "Joined"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 10px", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.users.recentSignups.map((u) => (
              <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                <td style={{ padding: "8px 10px", color: "var(--text)", fontWeight: 500 }}>{u.name}</td>
                <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontFamily: "monospace", fontSize: 12 }}>{u.email}</td>
                <td style={{ padding: "8px 10px" }}>
                  <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: `${PLAN_COLORS[u.plan] ?? "#6b7280"}20`, border: `1px solid ${PLAN_COLORS[u.plan] ?? "#6b7280"}50`, color: PLAN_COLORS[u.plan] ?? "#6b7280", fontWeight: 600 }}>
                    {PLAN_LABELS[u.plan] ?? u.plan}
                  </span>
                </td>
                <td style={{ padding: "8px 10px", color: "var(--text-muted)", fontSize: 12 }}>{new Date(u.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Drill-down modals ─────────────────────────────────────────────── */}

      {drill === "users" && (
        <DrillModal title="User Details" onClose={() => setDrill(null)}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)" }}>{m.users.total}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Total Users</div>
              </div>
              <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 800, color: "#22c55e" }}>+{m.users.newLast30d}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>New Last 30 Days</div>
              </div>
            </div>
            <div style={{ marginBottom: 12, fontWeight: 600, fontSize: 13, color: "var(--text)" }}>By Plan</div>
            {m.users.byPlan.map((p) => (
              <LegendRow key={p.plan} label={PLAN_LABELS[p.plan] ?? p.plan} value={p.count} total={m.users.total} color={PLAN_COLORS[p.plan] ?? "#6b7280"} />
            ))}
          </div>
          <div style={{ marginTop: 20, fontWeight: 600, fontSize: 13, color: "var(--text)", marginBottom: 10 }}>Recent Signups</div>
          {m.users.recentSignups.map((u) => (
            <div key={u.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, background: "var(--surface2)", marginBottom: 6 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{u.name}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{u.email}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: `${PLAN_COLORS[u.plan] ?? "#6b7280"}20`, color: PLAN_COLORS[u.plan] ?? "#6b7280", fontWeight: 600 }}>
                  {PLAN_LABELS[u.plan] ?? u.plan}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(u.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
          ))}
        </DrillModal>
      )}

      {drill === "memories" && (
        <DrillModal title="Memory Details" onClose={() => setDrill(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Total", value: m.memories.total, color: "var(--text)" },
              { label: "+7 days", value: m.memories.addedLast7d, color: "#22c55e" },
              { label: "+30 days", value: m.memories.addedLast30d, color: "#a855f7" },
            ].map((s) => (
              <div key={s.label} style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", marginBottom: 12 }}>By Category</div>
          {m.memories.byCategory.map((c) => (
            <LegendRow key={c.category} label={c.category} value={c.count} total={m.memories.total} color={CAT_COLORS[c.category] ?? "#6b7280"} />
          ))}
          {m.memories.byCategory.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No memories yet.</div>}
        </DrillModal>
      )}

      {drill === "activity" && (
        <DrillModal title="MCP Activity (30 days)" onClose={() => setDrill(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#a855f7" }}>{m.activity.totalRecalls.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Recalls</div>
            </div>
            <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#22c55e" }}>{m.activity.totalCommits.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Commits</div>
            </div>
          </div>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", marginBottom: 12 }}>Daily (Last 7 Days)</div>
          <ActivityChart data={m.activity.last7dActivity} />
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", marginBottom: 12, marginTop: 20 }}>Top Actions</div>
          {m.activity.topActions.map((a) => (
            <div key={a.action} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px", borderRadius: 6, background: "var(--surface2)", marginBottom: 6 }}>
              <code style={{ fontSize: 12, color: "var(--accent)" }}>{a.action}</code>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{a.count.toLocaleString()}</span>
            </div>
          ))}
        </DrillModal>
      )}

      {drill === "orgs" && (
        <DrillModal title="Organization Details" onClose={() => setDrill(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{m.orgs.total}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Organizations</div>
            </div>
            <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#f59e0b" }}>{m.orgs.totalMembers}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Total Members</div>
            </div>
          </div>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", marginBottom: 12 }}>By Plan</div>
          {m.orgs.byPlan.map((p) => (
            <LegendRow key={p.plan} label={PLAN_LABELS[p.plan] ?? p.plan} value={p.count} total={m.orgs.total} color={PLAN_COLORS[p.plan] ?? "#6b7280"} />
          ))}
        </DrillModal>
      )}

      {drill === "webhooks" && (
        <DrillModal title="Webhook Events" onClose={() => setDrill(null)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--text)" }}>{m.webhooks.total}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Total Events</div>
            </div>
            <div style={{ background: "var(--surface2)", borderRadius: 8, padding: "12px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#06b6d4" }}>{m.webhooks.last7d}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Last 7 Days</div>
            </div>
          </div>
          <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", marginBottom: 12 }}>By Status</div>
          {m.webhooks.byStatus.map((s) => (
            <LegendRow key={s.status} label={s.status} value={s.count} total={m.webhooks.total} color={STATUS_COLORS[s.status] ?? "#6b7280"} />
          ))}
          {m.webhooks.byStatus.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No webhook events yet.</div>}
        </DrillModal>
      )}

      {drill === "plan-events" && (
        <DrillModal title="Plan Changes (Last 30 Days)" onClose={() => setDrill(null)}>
          {m.planEvents.last30d.length === 0 && (
            <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No plan changes in the last 30 days.</div>
          )}
          {m.planEvents.last30d.map((e, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderRadius: 8, background: "var(--surface2)", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: `${PLAN_COLORS[e.fromPlan] ?? "#6b7280"}20`, color: PLAN_COLORS[e.fromPlan] ?? "#6b7280", fontWeight: 600 }}>
                  {PLAN_LABELS[e.fromPlan] ?? e.fromPlan}
                </span>
                <span style={{ color: "var(--text-muted)" }}>→</span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 20, background: `${PLAN_COLORS[e.toPlan] ?? "#6b7280"}20`, color: PLAN_COLORS[e.toPlan] ?? "#6b7280", fontWeight: 600 }}>
                  {PLAN_LABELS[e.toPlan] ?? e.toPlan}
                </span>
              </div>
              <span style={{ fontSize: 18, fontWeight: 800, color: "var(--text)" }}>{e.count}</span>
            </div>
          ))}
        </DrillModal>
      )}
    </div>
  );
}
