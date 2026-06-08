import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAdminAuditLogs, type AuditLogEntry } from "~/routes/admin";
import { exportSiteAuditLogsCsv } from "~/server/memoryFunctions";
import { SiteAdminSection } from "~/components/AdminSections";

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_ACTIONS = [
  "recall_context", "search_memories", "get_memory_summary",
  "commit_memory", "update_memory", "delete_memory",
  "import_memories", "revert_version",
  "approve_recommendation", "reject_recommendation",
  "sync_agent_configs",
  "create_template", "update_template", "delete_template",
  "list_accessible_scopes",
  "jit_access_requested", "jit_access_approved", "jit_access_denied",
];

const ACTION_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  recall_context:          { label: "Recall Context",         icon: "🔍", color: "#60a5fa", bg: "rgba(96,165,250,0.1)"  },
  search_memories:         { label: "Search Memories",        icon: "🔎", color: "#818cf8", bg: "rgba(129,140,248,0.1)" },
  get_memory_summary:      { label: "Memory Summary",         icon: "📊", color: "#818cf8", bg: "rgba(129,140,248,0.1)" },
  commit_memory:           { label: "Commit Memory",          icon: "✍️",  color: "#34d399", bg: "rgba(52,211,153,0.1)"  },
  update_memory:           { label: "Update Memory",          icon: "📝", color: "#fbbf24", bg: "rgba(251,191,36,0.1)"  },
  delete_memory:           { label: "Delete Memory",          icon: "🗑️", color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  import_memories:         { label: "Import Memories",        icon: "📥", color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  revert_version:          { label: "Revert Version",         icon: "↩️", color: "#fbbf24", bg: "rgba(251,191,36,0.1)"  },
  approve_recommendation:  { label: "Approve Recommendation", icon: "✅", color: "#34d399", bg: "rgba(52,211,153,0.1)"  },
  reject_recommendation:   { label: "Reject Recommendation",  icon: "❌", color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  sync_agent_configs:      { label: "Sync Agent Configs",     icon: "📤", color: "#c084fc", bg: "rgba(192,132,252,0.1)" },
  create_template:         { label: "Create Template",        icon: "🧩", color: "#34d399", bg: "rgba(52,211,153,0.1)"  },
  update_template:         { label: "Update Template",        icon: "🔧", color: "#fbbf24", bg: "rgba(251,191,36,0.1)"  },
  delete_template:         { label: "Delete Template",        icon: "🗑️", color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  list_accessible_scopes:  { label: "List Scopes",            icon: "📎", color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
  jit_access_requested:    { label: "JIT Requested",          icon: "🔓", color: "#f59e0b", bg: "rgba(245,158,11,0.1)"  },
  jit_access_approved:     { label: "JIT Approved",           icon: "✅", color: "#34d399", bg: "rgba(52,211,153,0.1)"  },
  jit_access_denied:       { label: "JIT Denied",             icon: "🚫", color: "#f87171", bg: "rgba(248,113,113,0.1)" },
};

function getActionMeta(action: string) {
  return ACTION_META[action] ?? { label: action, icon: "⚙️", color: "var(--text-muted)", bg: "var(--surface2)" };
}

type ViewMode = "cards" | "table" | "stats" | "timeline";

// ── Shared styles ─────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  padding: "6px 10px", fontSize: 12,
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "var(--radius)", color: "var(--text)",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px", fontSize: 12,
  borderBottom: "1px solid var(--border)", verticalAlign: "top",
};

const thStyle: React.CSSProperties = {
  padding: "8px 10px", fontSize: 10, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.06em",
  color: "var(--text-muted)", borderBottom: "1px solid var(--border)",
  textAlign: "left", background: "var(--surface2)", whiteSpace: "nowrap",
};

// ── Action badge ──────────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const meta = getActionMeta(action);
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: meta.bg, color: meta.color,
      padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700,
      border: `1px solid ${meta.color}33`, whiteSpace: "nowrap",
    }}>
      {meta.icon} {meta.label}
    </span>
  );
}

// ── Metadata chips ────────────────────────────────────────────────────────────

function MetadataChips({ metaStr }: { metaStr: string | null }) {
  if (!metaStr) return null;
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(metaStr); } catch { return null; }
  if (!meta || Object.keys(meta).length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
      {Object.entries(meta).map(([k, v]) => (
        <span key={k} style={{
          fontSize: 10, padding: "2px 7px", borderRadius: 12,
          background: "var(--surface)", border: "1px solid var(--border)",
          color: "var(--text-muted)", fontFamily: "monospace",
        }}>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{k}</span>: {String(v ?? "").slice(0, 60)}
        </span>
      ))}
    </div>
  );
}

// ── CARDS VIEW ────────────────────────────────────────────────────────────────

function CardRow({ log, showOrg }: { log: AuditLogEntry; showOrg?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getActionMeta(log.action);
  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border)",
      borderRadius: 10, overflow: "hidden",
    }}>
      <div
        onClick={() => setExpanded((p) => !p)}
        style={{ padding: "12px 14px", cursor: "pointer", display: "flex", gap: 12, alignItems: "flex-start" }}
      >
        {/* Action badge */}
        <div style={{
          flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
          background: meta.bg, color: meta.color,
          padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
          border: `1px solid ${meta.color}33`, whiteSpace: "nowrap",
        }}>
          <span>{meta.icon}</span> {meta.label}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{log.userName ?? "Unknown"}</span>
            {log.userEmail && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{log.userEmail}</span>}
            {log.tokenName && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(168,85,247,0.1)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.2)", fontWeight: 600 }}>
                🔑 {log.tokenName}
              </span>
            )}
            {log.toolName && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)", fontWeight: 600 }}>
                ◎ {log.toolName}
              </span>
            )}
            {showOrg && log.orgName && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(16,185,129,0.08)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)", fontWeight: 600 }}>
                🏢 {log.orgName}
              </span>
            )}
          </div>
          {log.memorySnippet && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 4, borderLeft: "2px solid var(--border)", paddingLeft: 8 }}>
              {log.memorySnippet}
            </div>
          )}
          <MetadataChips metaStr={log.metadata} />
        </div>

        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(log.timestamp).toLocaleString()}</div>
          {log.ipAddress && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>IP: {log.ipAddress}</div>}
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{expanded ? "▲" : "▼"}</div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px", background: "var(--surface)", fontSize: 11, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <span><span style={{ color: "var(--text-muted)" }}>User ID:</span> <code style={{ fontSize: 10 }}>{log.userId}</code></span>
            {log.tokenId && <span><span style={{ color: "var(--text-muted)" }}>Token ID:</span> <code style={{ fontSize: 10 }}>{log.tokenId}</code></span>}
            {log.memoryId && <span><span style={{ color: "var(--text-muted)" }}>Memory ID:</span> <code style={{ fontSize: 10 }}>{log.memoryId}</code></span>}
            {log.orgId && <span><span style={{ color: "var(--text-muted)" }}>Org ID:</span> <code style={{ fontSize: 10 }}>{log.orgId}</code></span>}
          </div>
          {log.userAgent && <div style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>UA: {log.userAgent}</div>}
          {log.metadata && (
            <pre style={{ margin: 0, fontSize: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", overflowX: "auto", color: "var(--text-muted)" }}>
              {(() => { try { return JSON.stringify(JSON.parse(log.metadata), null, 2); } catch { return log.metadata; } })()}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function CardsView({ logs }: { logs: AuditLogEntry[] }) {
  if (logs.length === 0) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No audit logs matching filters.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {logs.map((log) => <CardRow key={log.id} log={log} showOrg />)}
    </div>
  );
}

// ── TABLE VIEW ────────────────────────────────────────────────────────────────

function TableRow({ log }: { log: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr onClick={() => setExpanded((p) => !p)} style={{ cursor: "pointer", background: expanded ? "rgba(168,85,247,0.04)" : "transparent" }}>
        <td style={tdStyle}><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(log.timestamp).toLocaleString()}</span></td>
        <td style={tdStyle}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>{log.userName ?? "—"}</div>
          {log.userEmail && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{log.userEmail}</div>}
        </td>
        <td style={tdStyle}><ActionBadge action={log.action} /></td>
        <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 10, color: "var(--text-muted)" }}>
          {log.memoryId ? log.memoryId.slice(0, 8) + "…" : "—"}
        </td>
        <td style={{ ...tdStyle, fontSize: 11, color: "var(--text-muted)" }}>{log.ipAddress ?? "—"}</td>
        <td style={tdStyle}>
          {log.toolName
            ? <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)", fontWeight: 600 }}>◎ {log.toolName}</span>
            : <span style={{ color: "var(--text-muted)", fontSize: 11 }}>—</span>}
        </td>
        {log.orgName
          ? <td style={{ ...tdStyle, fontSize: 11, color: "#34d399" }}>{log.orgName}</td>
          : <td style={{ ...tdStyle, fontSize: 11, color: "var(--text-muted)" }}>—</td>}
        <td style={{ ...tdStyle, fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>{expanded ? "▲" : "▼"}</td>
      </tr>
      {expanded && (
        <tr style={{ background: "var(--surface)" }}>
          <td colSpan={8} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <span><span style={{ color: "var(--text-muted)" }}>User ID:</span> <code style={{ fontSize: 10 }}>{log.userId}</code></span>
                {log.tokenId && <span><span style={{ color: "var(--text-muted)" }}>Token:</span> <code style={{ fontSize: 10 }}>{log.tokenId.slice(0, 12)}…</code></span>}
                {log.memoryId && <span><span style={{ color: "var(--text-muted)" }}>Memory:</span> <code style={{ fontSize: 10 }}>{log.memoryId}</code></span>}
              </div>
              {log.memorySnippet && (
                <div style={{ fontStyle: "italic", color: "var(--text-muted)", borderLeft: "2px solid var(--border)", paddingLeft: 8 }}>{log.memorySnippet}</div>
              )}
              {log.userAgent && <div style={{ color: "var(--text-muted)", wordBreak: "break-all", fontSize: 10 }}>UA: {log.userAgent}</div>}
              {log.metadata && (
                <pre style={{ margin: 0, fontSize: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", overflowX: "auto", color: "var(--text-muted)" }}>
                  {(() => { try { return JSON.stringify(JSON.parse(log.metadata), null, 2); } catch { return log.metadata; } })()}
                </pre>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TableView({ logs }: { logs: AuditLogEntry[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Timestamp</th>
            <th style={thStyle}>User</th>
            <th style={thStyle}>Action</th>
            <th style={thStyle}>Memory ID</th>
            <th style={thStyle}>IP</th>
            <th style={thStyle}>Tool</th>
            <th style={thStyle}>Org</th>
            <th style={{ ...thStyle, textAlign: "center", width: 30 }}></th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr><td colSpan={8} style={{ ...tdStyle, textAlign: "center", color: "var(--text-muted)" }}>No audit logs matching filters.</td></tr>
          ) : (
            logs.map((log) => <TableRow key={log.id} log={log} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── STATS VIEW ────────────────────────────────────────────────────────────────

function BarRow({ label, icon, count, max, color }: { label: string; icon: string; count: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 13, width: 20, textAlign: "center", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 11, color: "var(--text-muted)", width: 160, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, background: "var(--surface)", borderRadius: 4, height: 14, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s ease" }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", width: 36, textAlign: "right", flexShrink: 0 }}>{count}</span>
    </div>
  );
}

function StatsView({ logs }: { logs: AuditLogEntry[] }) {
  const stats = useMemo(() => {
    const actionCounts = new Map<string, number>();
    const userCounts = new Map<string, { name: string; email: string | null; count: number }>();
    const toolCounts = new Map<string, number>();
    const orgCounts = new Map<string, { name: string; count: number }>();
    const dayCounts = new Map<string, number>();

    for (const log of logs) {
      actionCounts.set(log.action, (actionCounts.get(log.action) ?? 0) + 1);
      if (log.userId) {
        const existing = userCounts.get(log.userId);
        if (existing) existing.count++;
        else userCounts.set(log.userId, { name: log.userName ?? log.userId.slice(0, 8), email: log.userEmail, count: 1 });
      }
      if (log.toolName) toolCounts.set(log.toolName, (toolCounts.get(log.toolName) ?? 0) + 1);
      if (log.orgId && log.orgName) {
        const existing = orgCounts.get(log.orgId);
        if (existing) existing.count++;
        else orgCounts.set(log.orgId, { name: log.orgName, count: 1 });
      }
      const day = new Date(log.timestamp).toLocaleDateString("en-CA"); // YYYY-MM-DD
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }

    const sortedActions = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]);
    const sortedUsers = [...userCounts.values()].sort((a, b) => b.count - a.count).slice(0, 10);
    const sortedTools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
    const sortedOrgs = [...orgCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8);

    // Last 14 days activity for mini-chart
    const today = new Date();
    const days14: { label: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("en-CA");
      days14.push({ label: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }), count: dayCounts.get(key) ?? 0 });
    }

    return { sortedActions, sortedUsers, sortedTools, sortedOrgs, days14, total: logs.length };
  }, [logs]);

  if (logs.length === 0) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No data to analyze — adjust filters or increase page size.</p>;

  const maxAction = stats.sortedActions[0]?.[1] ?? 1;
  const maxUser = stats.sortedUsers[0]?.count ?? 1;
  const maxTool = stats.sortedTools[0]?.[1] ?? 1;
  const maxOrg = stats.sortedOrgs[0]?.count ?? 1;
  const maxDay = Math.max(...stats.days14.map((d) => d.count), 1);

  const statCard = (children: React.ReactNode, title: string) => (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 18px" }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {[
          { label: "Events loaded", value: stats.total },
          { label: "Unique users", value: new Set(stats.sortedUsers.map((u) => u.name)).size },
          { label: "Unique actions", value: stats.sortedActions.length },
          { label: "Unique tools", value: stats.sortedTools.length },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: "var(--accent)" }}>{value}</div>
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Activity over last 14 days */}
      {statCard(
        <div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 60 }}>
            {stats.days14.map(({ label, count }) => {
              const h = maxDay > 0 ? Math.max(2, Math.round((count / maxDay) * 56)) : 2;
              return (
                <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <div
                    title={`${label}: ${count} event${count !== 1 ? "s" : ""}`}
                    style={{ width: "100%", height: h, background: count > 0 ? "var(--accent)" : "var(--border)", borderRadius: "2px 2px 0 0", transition: "height 0.3s ease", opacity: count > 0 ? 1 : 0.4 }}
                  />
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{stats.days14[0]?.label}</span>
            <span style={{ fontSize: 9, color: "var(--text-muted)" }}>Today</span>
          </div>
        </div>,
        "Activity — last 14 days"
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Actions breakdown */}
        {statCard(
          <div>
            {stats.sortedActions.map(([action, count]) => {
              const meta = getActionMeta(action);
              return <BarRow key={action} label={meta.label} icon={meta.icon} count={count} max={maxAction} color={meta.color} />;
            })}
          </div>,
          "By action type"
        )}

        {/* Top users */}
        {statCard(
          <div>
            {stats.sortedUsers.map((u) => (
              <div key={u.name} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 600, width: 130, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={u.email ?? u.name}>{u.name}</span>
                <div style={{ flex: 1, background: "var(--surface)", borderRadius: 4, height: 14, overflow: "hidden" }}>
                  <div style={{ width: `${Math.max(4, Math.round((u.count / maxUser) * 100))}%`, height: "100%", background: "#60a5fa", borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", width: 36, textAlign: "right", flexShrink: 0 }}>{u.count}</span>
              </div>
            ))}
          </div>,
          "Top users"
        )}

        {/* Tools */}
        {statCard(
          <div>
            {stats.sortedTools.length === 0
              ? <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>No tool data in this window.</p>
              : stats.sortedTools.map(([tool, count]) => (
                  <BarRow key={tool} label={tool} icon="◎" count={count} max={maxTool} color="#c084fc" />
                ))}
          </div>,
          "By tool / agent"
        )}

        {/* Orgs */}
        {statCard(
          <div>
            {stats.sortedOrgs.length === 0
              ? <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>No org data in this window.</p>
              : stats.sortedOrgs.map((o) => (
                  <BarRow key={o.name} label={o.name} icon="🏢" count={o.count} max={maxOrg} color="#34d399" />
                ))}
          </div>,
          "By organization"
        )}
      </div>
    </div>
  );
}

// ── TIMELINE VIEW ─────────────────────────────────────────────────────────────

function TimelineView({ logs }: { logs: AuditLogEntry[] }) {
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());

  const grouped = useMemo(() => {
    const map = new Map<string, AuditLogEntry[]>();
    for (const log of logs) {
      const day = new Date(log.timestamp).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(log);
    }
    return [...map.entries()];
  }, [logs]);

  if (logs.length === 0) return <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No audit logs matching filters.</p>;

  const toggleDay = (day: string) =>
    setOpenDays((prev) => { const next = new Set(prev); next.has(day) ? next.delete(day) : next.add(day); return next; });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {grouped.map(([day, dayLogs]) => {
        const open = openDays.has(day);
        // Count by action for density bar
        const actionCounts = new Map<string, number>();
        for (const l of dayLogs) actionCounts.set(l.action, (actionCounts.get(l.action) ?? 0) + 1);
        const topActions = [...actionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

        return (
          <div key={day} style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            {/* Day header */}
            <div
              onClick={() => toggleDay(day)}
              style={{ padding: "12px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, background: "var(--surface2)" }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", flex: 1 }}>{day}</span>

              {/* Mini action density pills */}
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {topActions.map(([action, count]) => {
                  const meta = getActionMeta(action);
                  return (
                    <span key={action} style={{ fontSize: 10, padding: "1px 7px", borderRadius: 12, background: meta.bg, color: meta.color, border: `1px solid ${meta.color}33`, fontWeight: 700 }}>
                      {meta.icon} {count}
                    </span>
                  );
                })}
              </div>

              <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, flexShrink: 0 }}>
                {dayLogs.length} event{dayLogs.length !== 1 ? "s" : ""}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{open ? "▲" : "▼"}</span>
            </div>

            {/* Events for this day */}
            {open && (
              <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                {dayLogs.map((log) => {
                  const meta = getActionMeta(log.action);
                  const time = new Date(log.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                  return (
                    <div key={log.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 8px", borderRadius: 6, background: "var(--surface2)" }}>
                      {/* Timeline dot + time */}
                      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", width: 58 }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace" }}>{time}</span>
                      </div>

                      <div style={{ width: 1, background: "var(--border)", alignSelf: "stretch", flexShrink: 0, marginTop: 3 }} />

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <span style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 4, color: meta.color, fontWeight: 700 }}>
                            {meta.icon} {meta.label}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 600 }}>{log.userName ?? "—"}</span>
                          {log.toolName && (
                            <span style={{ fontSize: 10, padding: "0 5px", borderRadius: 8, background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                              ◎ {log.toolName}
                            </span>
                          )}
                          {log.orgName && (
                            <span style={{ fontSize: 10, color: "#34d399" }}>🏢 {log.orgName}</span>
                          )}
                        </div>
                        {log.memorySnippet && (
                          <div style={{ fontSize: 10, color: "var(--text-muted)", fontStyle: "italic", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {log.memorySnippet}
                          </div>
                        )}
                      </div>

                      {log.ipAddress && (
                        <span style={{ fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>{log.ipAddress}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const PAGE_SIZES = [50, 100, 200, 500];

export function AdminAuditLog() {
  const [view, setView] = useState<ViewMode>("cards");
  const [limit, setLimit] = useState(100);
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [exporting, setExporting] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-audit-logs", limit, offset, actionFilter, userFilter, orgFilter, startDate, endDate],
    queryFn: () => getAdminAuditLogs({
      data: {
        limit,
        offset,
        action: actionFilter || undefined,
        userId: userFilter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      },
    }),
  });

  const allLogs = (data?.logs ?? []).filter((log) => !orgFilter || log.orgId === orgFilter || log.orgName?.toLowerCase().includes(orgFilter.toLowerCase()));
  const total = data?.total ?? 0;
  const hasFilters = !!(actionFilter || userFilter || orgFilter || startDate || endDate);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const result = await exportSiteAuditLogsCsv({ data: {
        action: actionFilter || undefined,
        userId: userFilter || undefined,
        orgId: orgFilter || undefined,
      }});
      const blob = new Blob([result.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const viewTabs: { id: ViewMode; label: string; icon: string; tip: string }[] = [
    { id: "cards",    label: "Cards",    icon: "◧", tip: "Rich expandable cards with metadata chips" },
    { id: "table",    label: "Table",    icon: "⊞", tip: "Dense table, click rows to expand" },
    { id: "stats",    label: "Stats",    icon: "📊", tip: "Aggregate analytics over loaded window" },
    { id: "timeline", label: "Timeline", icon: "⏱", tip: "Events grouped by day with density overview" },
  ];

  return (
    <SiteAdminSection title="Audit Log" description="All memory operations site-wide — site admin access only" icon="📋">
      {/* Security notice */}
      <div style={{
        marginBottom: 14, padding: "9px 14px", borderRadius: 8,
        background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)",
        fontSize: 11, color: "#f87171", display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>🔒</span>
        <span><strong>Site Admin Only.</strong> Protected server-side by <code>requireAdmin()</code> — user ID must match <code>ADMIN_USER_ID</code> env var.</span>
      </div>

      {/* View tabs + page size + export */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 2, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
          {viewTabs.map(({ id, label, icon, tip }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              title={tip}
              style={{
                padding: "5px 12px", fontSize: 12, fontWeight: view === id ? 700 : 500,
                background: view === id ? "var(--accent)" : "transparent",
                color: view === id ? "#fff" : "var(--text-muted)",
                border: "none", borderRadius: 6, cursor: "pointer", display: "flex", alignItems: "center", gap: 5,
              }}
            >
              <span style={{ fontSize: 13 }}>{icon}</span> {label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <select
            value={limit}
            onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }}
            style={{ ...inputStyle, fontSize: 11 }}
            title="Rows per page"
          >
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s} rows</option>)}
          </select>

          <button
            onClick={handleExportCsv}
            disabled={exporting}
            style={{ padding: "6px 12px", fontSize: 12, background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius)", cursor: exporting ? "default" : "pointer", fontWeight: 600, opacity: exporting ? 0.7 : 1 }}
          >
            {exporting ? "Exporting…" : "⬇️ Export CSV"}
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
          style={inputStyle}
        >
          <option value="">All actions</option>
          {ALL_ACTIONS.map((a) => {
            const m = getActionMeta(a);
            return <option key={a} value={a}>{m.icon} {m.label}</option>;
          })}
        </select>

        <input
          type="text"
          placeholder="User ID"
          value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); setOffset(0); }}
          style={{ ...inputStyle, width: 150 }}
        />

        <input
          type="text"
          placeholder="Org name / ID"
          value={orgFilter}
          onChange={(e) => { setOrgFilter(e.target.value); setOffset(0); }}
          style={{ ...inputStyle, width: 150 }}
        />

        <input
          type="date"
          value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setOffset(0); }}
          style={{ ...inputStyle, colorScheme: "dark" }}
          title="Start date"
        />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>–</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setOffset(0); }}
          style={{ ...inputStyle, colorScheme: "dark" }}
          title="End date"
        />

        {hasFilters && (
          <button
            onClick={() => { setActionFilter(""); setUserFilter(""); setOrgFilter(""); setStartDate(""); setEndDate(""); setOffset(0); }}
            style={{ ...inputStyle, cursor: "pointer", color: "var(--text-muted)", background: "transparent", border: "1px solid transparent" }}
          >
            ✕ Clear
          </button>
        )}

        {view === "stats" && total > limit && (
          <span style={{ fontSize: 11, color: "#f59e0b", marginLeft: 4 }}>
            ⚠️ Stats cover {limit} loaded rows of {total} total — increase page size for fuller coverage
          </span>
        )}
      </div>

      {isLoading && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading audit logs…</p>}

      {isError && (
        <div style={{ color: "var(--error)", fontSize: 13, padding: "12px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 8 }}>
          🔒 Access denied. Only the configured site admin can view this.
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {view === "cards"    && <CardsView    logs={allLogs} />}
          {view === "table"    && <TableView    logs={allLogs} />}
          {view === "stats"    && <StatsView    logs={allLogs} />}
          {view === "timeline" && <TimelineView logs={allLogs} />}
        </>
      )}

      {/* Pagination — hidden in stats view */}
      {!isLoading && !isError && view !== "stats" && total > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
          <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total} entries</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              style={{ padding: "4px 10px", background: offset === 0 ? "var(--surface2)" : "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, cursor: offset === 0 ? "default" : "pointer", fontSize: 11, color: "var(--text-muted)" }}
            >
              ← Previous
            </button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              style={{ padding: "4px 10px", background: offset + limit >= total ? "var(--surface2)" : "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, cursor: offset + limit >= total ? "default" : "pointer", fontSize: 11, color: "var(--text-muted)" }}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </SiteAdminSection>
  );
}
