import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { runMemoryHealthCheck } from "~/server/memoryHealth";
import type { MemoryHealthReport, MemoryHealthCluster, StaleMemoryRecord, MemoryAnomaly } from "~/server/memoryHealth";
import { PaywallGate } from "~/components/PaywallGate";
import type { PlanId } from "~/lib/plans";

// ── Icons ──────────────────────────────────────────────────────────────────────

function IconShield() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconMerge() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="18" cy="18" r="3" /><circle cx="6" cy="6" r="3" /><path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconWarning() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const ACTION_COLORS: Record<MemoryHealthCluster["suggestedAction"], { bg: string; border: string; text: string; chip: string }> = {
  merge: {
    bg: "rgba(99,102,241,0.06)",
    border: "rgba(99,102,241,0.25)",
    text: "#6366f1",
    chip: "rgba(99,102,241,0.15)",
  },
  review: {
    bg: "rgba(245,158,11,0.06)",
    border: "rgba(245,158,11,0.25)",
    text: "#d97706",
    chip: "rgba(245,158,11,0.15)",
  },
  delete: {
    bg: "rgba(239,68,68,0.06)",
    border: "rgba(239,68,68,0.25)",
    text: "#ef4444",
    chip: "rgba(239,68,68,0.15)",
  },
};

const ANOMALY_LABELS: Record<MemoryAnomaly["anomalyType"], string> = {
  oversized: "Oversized",
  empty_tags: "No Tags",
  duplicate_fact: "Duplicate",
  contradictory: "Contradictory",
  malformed: "Malformed",
};

const ANOMALY_COLORS: Record<MemoryAnomaly["anomalyType"], string> = {
  oversized: "#6366f1",
  empty_tags: "#94a3b8",
  duplicate_fact: "#f59e0b",
  contradictory: "#ef4444",
  malformed: "#ec4899",
};

function ClusterCard({ cluster }: { cluster: MemoryHealthCluster }) {
  const [expanded, setExpanded] = useState(false);
  const colors = ACTION_COLORS[cluster.suggestedAction];

  return (
    <div
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        borderRadius: 12,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <div style={{ color: colors.text, flexShrink: 0 }}>
            <IconMerge />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", letterSpacing: "-0.01em" }}>
            {cluster.clusterLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              padding: "2px 8px",
              borderRadius: 20,
              background: colors.chip,
              color: colors.text,
            }}
          >
            {cluster.suggestedAction}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--text-muted)",
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              padding: "2px 7px",
              borderRadius: 20,
            }}
          >
            {cluster.memoryIds.length} memories
          </span>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, margin: 0 }}>
        {cluster.reason}
      </p>

      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>
            Memory IDs
          </span>
          {cluster.memoryIds.map((id) => (
            <code
              key={id}
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "2px 8px",
                fontFamily: "monospace",
              }}
            >
              {id}
            </code>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        style={{
          alignSelf: "flex-start",
          fontSize: 11,
          color: colors.text,
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          fontWeight: 600,
        }}
      >
        {expanded ? "Hide IDs ▲" : "Show IDs ▼"}
      </button>
    </div>
  );
}

function StaleCard({ record }: { record: StaleMemoryRecord }) {
  return (
    <div
      style={{
        background: "rgba(245,158,11,0.05)",
        border: "1px solid rgba(245,158,11,0.2)",
        borderRadius: 12,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#d97706" }}>
          <IconClock />
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#d97706" }}>
            {record.staleDays}d old
          </span>
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "var(--text-muted)",
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            padding: "2px 6px",
            borderRadius: 20,
          }}
        >
          {record.category}
        </span>
      </div>
      <p
        style={{
          fontSize: 12,
          color: "var(--text)",
          lineHeight: 1.5,
          margin: 0,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {record.fact}
      </p>
      <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{record.memoryId}</span>
    </div>
  );
}

function AnomalyCard({ anomaly }: { anomaly: MemoryAnomaly }) {
  const color = ANOMALY_COLORS[anomaly.anomalyType];
  const label = ANOMALY_LABELS[anomaly.anomalyType];

  return (
    <div
      style={{
        background: `rgba(0,0,0,0.03)`,
        border: `1px solid var(--border)`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 10,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ color }}>
          <IconWarning />
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            color,
          }}
        >
          {label}
        </span>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
        {anomaly.detail}
      </p>
      {anomaly.fact && (
        <p
          style={{
            fontSize: 11,
            color: "var(--text)",
            margin: 0,
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            fontStyle: "italic",
          }}
        >
          "{anomaly.fact}"
        </p>
      )}
    </div>
  );
}

function SectionHeader({ title, count, icon }: { title: string; count: number; icon: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <div style={{ color: "var(--text-muted)" }}>{icon}</div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0, letterSpacing: "-0.01em" }}>
        {title}
      </h3>
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--text-muted)",
          background: "var(--surface2)",
          border: "1px solid var(--border)",
          padding: "1px 8px",
          borderRadius: 20,
        }}
      >
        {count}
      </span>
    </div>
  );
}

// ── Main Panel ─────────────────────────────────────────────────────────────────

type Props = {
  projectKey: string;
  userPlan: PlanId;
};

function HealthCheckContent({ projectKey, userPlan }: Props) {
  const [report, setReport] = useState<MemoryHealthReport | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      runMemoryHealthCheck({
        data: {
          projectKey: projectKey === "personal" ? undefined : projectKey,
        },
      }),
    onSuccess: (data) => setReport(data),
  });

  const scoreColor = (() => {
    if (!report) return "var(--text-muted)";
    const issues = report.clusters.length + report.staleRecords.length + report.anomalies.length;
    if (issues === 0) return "#22c55e";
    if (issues <= 5) return "#f59e0b";
    return "#ef4444";
  })();

  const healthLabel = (() => {
    if (!report) return null;
    const issues = report.clusters.length + report.staleRecords.length + report.anomalies.length;
    if (issues === 0) return "Excellent";
    if (issues <= 3) return "Good";
    if (issues <= 8) return "Fair";
    return "Needs Attention";
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Header Card */}
      <div
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: "24px",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: "rgba(168,85,247,0.1)",
                border: "1px solid rgba(168,85,247,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent)",
              }}
            >
              <IconShield />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0, letterSpacing: "-0.02em" }}>
                Memory Health
              </h2>
              <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
                AI-powered vault analysis using Llama 3.3
              </p>
            </div>
          </div>

          {report && (
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: scoreColor, letterSpacing: "-0.03em", lineHeight: 1 }}>
                  {healthLabel}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {report.totalMemoriesAnalyzed} memories analyzed
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {new Date(report.analysisTimestamp).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            background: mutation.isPending ? "var(--surface2)" : "var(--accent)",
            border: mutation.isPending ? "1px solid var(--border)" : "none",
            color: mutation.isPending ? "var(--text-muted)" : "#fff",
            fontWeight: 700,
            fontSize: 13,
            borderRadius: 10,
            cursor: mutation.isPending ? "not-allowed" : "pointer",
            transition: "background 0.15s, color 0.15s",
            whiteSpace: "nowrap",
          }}
        >
          {mutation.isPending ? (
            <>
              <IconSpinner />
              Analyzing…
            </>
          ) : (
            <>
              <IconShield />
              Run Health Check
            </>
          )}
        </button>
      </div>

      {/* Error state */}
      {mutation.isError && (
        <div
          style={{
            background: "rgba(239,68,68,0.07)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 12,
            padding: "14px 16px",
            color: "#ef4444",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {String((mutation.error as any)?.message ?? "Health check failed. Please try again.")}
        </div>
      )}

      {/* Summary banner */}
      {report && (
        <div
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "14px 18px",
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
          }}
        >
          <div style={{ color: "#22c55e", marginTop: 1, flexShrink: 0 }}>
            <IconCheck />
          </div>
          <p style={{ fontSize: 13, color: "var(--text)", margin: 0, lineHeight: 1.6 }}>
            {report.summary}
          </p>
        </div>
      )}

      {/* Stats row */}
      {report && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[
            { label: "Duplicate Clusters", value: report.clusters.length, color: "#6366f1" },
            { label: "Stale Records", value: report.staleRecords.length, color: "#f59e0b" },
            { label: "Anomalies", value: report.anomalies.length, color: "#ef4444" },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: value === 0 ? "#22c55e" : color,
                  letterSpacing: "-0.03em",
                  lineHeight: 1,
                }}
              >
                {value}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Clusters section */}
      {report && report.clusters.length > 0 && (
        <div>
          <SectionHeader title="Duplicate Clusters" count={report.clusters.length} icon={<IconMerge />} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {report.clusters.map((cluster, i) => (
              <ClusterCard key={`${cluster.clusterLabel}-${i}`} cluster={cluster} />
            ))}
          </div>
        </div>
      )}

      {/* Stale records section */}
      {report && report.staleRecords.length > 0 && (
        <div>
          <SectionHeader title="Stale Records" count={report.staleRecords.length} icon={<IconClock />} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {report.staleRecords.map((rec) => (
              <StaleCard key={rec.memoryId} record={rec} />
            ))}
          </div>
        </div>
      )}

      {/* Anomalies section */}
      {report && report.anomalies.length > 0 && (
        <div>
          <SectionHeader title="Anomalies" count={report.anomalies.length} icon={<IconWarning />} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {report.anomalies.map((anomaly) => (
              <AnomalyCard key={anomaly.memoryId + anomaly.anomalyType} anomaly={anomaly} />
            ))}
          </div>
        </div>
      )}

      {/* Empty states */}
      {report && report.clusters.length === 0 && report.staleRecords.length === 0 && report.anomalies.length === 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "60px 24px",
            gap: 16,
            textAlign: "center",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "rgba(34,197,94,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#22c55e",
            }}
          >
            <IconCheck />
          </div>
          <div>
            <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: "0 0 4px" }}>
              Your vault is in excellent health
            </p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, maxWidth: 380 }}>
              No near-duplicate clusters, stale records, or anomalies detected across {report.totalMemoriesAnalyzed} memories.
            </p>
          </div>
        </div>
      )}

      {/* Pre-run placeholder */}
      {!report && !mutation.isPending && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "60px 24px",
            gap: 12,
            textAlign: "center",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "rgba(168,85,247,0.08)",
              border: "1px solid rgba(168,85,247,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent)",
            }}
          >
            <IconShield />
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>
            Click "Run Health Check" to analyze your vault
          </p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, maxWidth: 360 }}>
            Workers AI will scan your memories for duplicates, stale records, and data anomalies, then return a structured JSON report.
          </p>
        </div>
      )}
    </div>
  );
}

export function MemoryHealthPanel({ projectKey, userPlan }: Props) {
  return (
    <PaywallGate feature="usageAnalytics" currentPlan={userPlan} requiredPlan="business">
      <HealthCheckContent projectKey={projectKey} userPlan={userPlan} />
    </PaywallGate>
  );
}
