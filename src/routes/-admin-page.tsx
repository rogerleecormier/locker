import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminLayout, type AdminSection } from "~/components/AdminLayout";
import { SiteAdminSection, OrgAdminSection, StatBox, AdminCard } from "~/components/AdminSections";
import {
  getAdminStatus,
  getDbStats,
  getVectorizeDebug,
  listAllOrgsAndQuotas,
  listAllUsersAndDetails,
  clearDatabase,
  clearVectorizeIndex,
  createUserAdmin,
  updateUserAdmin,
  deleteUserAdmin,
  updateUserPlanAdmin,
  setUserPasswordAdmin,
  resetUserPasswordAdmin,
  assignUserToOrgAdmin,
  removeUserFromOrgAdmin,
  updateOrgQuota,
  deleteOrganization,
  getSystemSettings,
  updateSystemSetting,
  type UserDetails,
  type OrgWithQuota,
  type SystemSettingsData,
} from "~/routes/admin";
import {
  nukeEverything,
  scanDatabaseDuplicates,
  bulkDeleteMemories,
  migrateToV2,
  type MigrateV2Result,
  rebuildVectorizeIndex,
  getOrgAuditLogs,
  exportAuditLogsCsv,
  getSiteAuditLogs,
  exportSiteAuditLogsCsv,
  getAgentActivityLogs,
  type AgentActivityEntry,
  type DuplicateGroup,
} from "~/server/memoryFunctions";
import { MyUsageSection, MyBillingSection, OrgBillingSection, useBillingData } from "~/routes/billing";
import { ProfileSection, ApiTokensSection, McpEndpointSection, TwoFactorSection, PasscodeSection, SessionsSection, WebhookSecretsSection } from "~/routes/_settings-components";
import {
  getUserOrgsAndTeams,
  createOrganizationSelfServe,
  addOrgMemberByEmail,
  updateOrgMemberRole,
  removeOrgMember,
  createTeam,
  deleteTeam,
  addTeamMemberByEmail,
  updateTeamMemberRole,
  removeTeamMember,
  MemberRow,
  InviteForm,
  CreateOrgModal,
} from "~/routes/organization";

const modalOverlay: React.CSSProperties = {
  position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
  background: "rgba(15, 17, 23, 0.75)", backdropFilter: "blur(4px)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000, padding: "20px",
};
const modalBox: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)",
  borderRadius: "12px", width: "100%", maxWidth: "450px",
  boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)", padding: "24px",
};
// ── Audit action metadata ───────────────────────────────────────────────────────
const ACTION_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  recall_context:           { label: "Recall Context",          icon: "🔍", color: "#60a5fa", bg: "rgba(96,165,250,0.1)" },
  search_memories:          { label: "Search Memories",         icon: "🔎", color: "#818cf8", bg: "rgba(129,140,248,0.1)" },
  get_memory_summary:       { label: "Memory Summary",          icon: "📊", color: "#818cf8", bg: "rgba(129,140,248,0.1)" },
  commit_memory:            { label: "Commit Memory",           icon: "✍️",  color: "#34d399", bg: "rgba(52,211,153,0.1)" },
  update_memory:            { label: "Update Memory",           icon: "📝", color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  delete_memory:            { label: "Delete Memory",           icon: "🗑️", color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  import_memories:          { label: "Import Memories",         icon: "📥", color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  revert_version:           { label: "Revert Version",          icon: "↩️", color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  approve_recommendation:   { label: "Approve Recommendation",  icon: "✅", color: "#34d399", bg: "rgba(52,211,153,0.1)" },
  reject_recommendation:    { label: "Reject Recommendation",   icon: "❌", color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  sync_agent_configs: { label: "Sync Agent Configs", icon: "📤", color: "#c084fc", bg: "rgba(192,132,252,0.1)" },
  create_template:          { label: "Create Template",         icon: "🧩", color: "#34d399", bg: "rgba(52,211,153,0.1)" },
  update_template:          { label: "Update Template",         icon: "🔧", color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  delete_template:          { label: "Delete Template",         icon: "🗑️", color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  list_accessible_scopes:   { label: "List Scopes",             icon: "📎", color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
};

function getActionMeta(action: string) {
  return ACTION_META[action] ?? { label: action, icon: "⚙️", color: "var(--text-muted)", bg: "var(--surface2)" };
}

function MetadataDisplay({ metaStr }: { metaStr: string | null }) {
  if (!metaStr) return null;
  let meta: Record<string, unknown>;
  try { meta = JSON.parse(metaStr); } catch { return null; }
  if (!meta || Object.keys(meta).length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: 6 }}>
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

function AuditLogRow({ log, showOrg = false }: { log: any; showOrg?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const meta = getActionMeta(log.action);
  return (
    <div style={{
      background: "var(--surface2)", border: "1px solid var(--border)",
      borderRadius: 10, overflow: "hidden",
      transition: "border-color 0.15s ease",
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
          <span style={{ fontSize: 12 }}>{meta.icon}</span>
          {meta.label}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* User + token + tool */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>
              {log.userName ?? "Unknown User"}
            </span>
            {log.userEmail && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{log.userEmail}</span>
            )}
            {log.tokenName && (
              <span style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 8,
                background: "rgba(168,85,247,0.1)", color: "var(--accent)",
                border: "1px solid rgba(168,85,247,0.2)", fontWeight: 600,
              }}>
                🔑 {log.tokenName}
              </span>
            )}
            {log.toolName && (
              <span style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 8,
                background: "var(--surface)", color: "var(--text-muted)",
                border: "1px solid var(--border)", fontWeight: 600,
              }}>
                ◎ {log.toolName}
              </span>
            )}
            {showOrg && log.orgName && (
              <span style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 8,
                background: "rgba(16,185,129,0.08)", color: "#34d399",
                border: "1px solid rgba(16,185,129,0.2)", fontWeight: 600,
              }}>
                🏢 {log.orgName}
              </span>
            )}
          </div>

          {/* Query string (recall/search events) */}
          {log.query && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>
              Query: <span style={{ color: "var(--text)", fontStyle: "italic" }}>{log.query}</span>
            </div>
          )}

          {/* Memory snippet (plaintext from version history) */}
          {log.memorySnippet && (
            <div style={{
              fontSize: 11, color: "var(--text-muted)", fontStyle: "italic",
              marginBottom: 4, borderLeft: "2px solid var(--border)", paddingLeft: 8,
            }}>
              {log.memorySnippet}
            </div>
          )}

          {/* Parsed metadata chips */}
          <MetadataDisplay metaStr={log.metadata} />
        </div>

        {/* Timestamp + expand hint */}
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {new Date(log.timestamp).toLocaleString()}
          </div>
          {log.ipAddress && (
            <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>IP: {log.ipAddress}</div>
          )}
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{expanded ? "▲" : "▼"}</div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          borderTop: "1px solid var(--border)", padding: "10px 14px",
          background: "var(--surface)", fontSize: 11, display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <span><span style={{ color: "var(--text-muted)" }}>User ID:</span> <code style={{ fontSize: 10 }}>{log.userId}</code></span>
            {log.tokenId && <span><span style={{ color: "var(--text-muted)" }}>Token ID:</span> <code style={{ fontSize: 10 }}>{log.tokenId}</code></span>}
            {log.memoryId && <span><span style={{ color: "var(--text-muted)" }}>Memory ID:</span> <code style={{ fontSize: 10 }}>{log.memoryId}</code></span>}
            {log.orgId && <span><span style={{ color: "var(--text-muted)" }}>Org ID:</span> <code style={{ fontSize: 10 }}>{log.orgId}</code></span>}
          </div>
          {log.userAgent && (
            <div style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>UA: {log.userAgent}</div>
          )}
          {log.metadata && (
            <pre style={{
              margin: 0, fontSize: 10, background: "var(--surface2)",
              border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px",
              overflowX: "auto", color: "var(--text-muted)",
            }}>{(() => { try { return JSON.stringify(JSON.parse(log.metadata), null, 2); } catch { return log.metadata; } })()}</pre>
          )}
        </div>
      )}
    </div>
  );
}

const ALL_ACTIONS = [
  "recall_context", "search_memories", "get_memory_summary",
  "commit_memory", "update_memory", "delete_memory",
  "import_memories", "revert_version",
  "approve_recommendation", "reject_recommendation",
  "sync_agent_configs",
  "create_template", "update_template", "delete_template",
  "list_accessible_scopes",
];

function AuditLogsSection() {
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [exporting, setExporting] = useState(false);

  const { data: logsData, isLoading, error } = useQuery({
    queryKey: ["audit-logs", limit, offset, actionFilter, userFilter],
    queryFn: () => getOrgAuditLogs({ data: { limit, offset, action: actionFilter || undefined, userId: userFilter || undefined } }),
  });

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const result = await exportAuditLogsCsv({ data: { action: actionFilter || undefined, userId: userFilter || undefined } });
      const blob = new Blob([result.csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `org-audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <OrgAdminSection title="Audit Logs" description="All actions taken within your organization" icon="📋">
      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
          style={{ padding: "6px 10px", fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)" }}
        >
          <option value="">All actions</option>
          {ALL_ACTIONS.map((a) => (
            <option key={a} value={a}>{getActionMeta(a).icon} {getActionMeta(a).label}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filter by User ID"
          value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); setOffset(0); }}
          style={{ padding: "6px 10px", fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", width: 200 }}
        />

        <button
          onClick={handleExportCsv}
          disabled={exporting}
          style={{ padding: "6px 12px", fontSize: 12, background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius)", cursor: exporting ? "default" : "pointer", fontWeight: 600, marginLeft: "auto" }}
        >
          {exporting ? "Exporting…" : "⬇️ Export CSV"}
        </button>
      </div>

      {isLoading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", padding: "20px 0" }}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⏳</span>
          Loading audit logs…
        </div>
      )}

      {error && (
        <div style={{ color: "var(--error)", fontSize: 13, padding: "12px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 8 }}>
          Failed to load audit logs. You must be an org admin to view this.
        </div>
      )}

      {!isLoading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {!logsData?.logs || logsData.logs.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No audit logs matching filters.</p>
          ) : (
            logsData.logs.map((log: any) => <AuditLogRow key={log.id} log={log} />)
          )}
        </div>
      )}

      {logsData && logsData.total > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
          <span>Showing {offset + 1}–{Math.min(offset + limit, logsData.total)} of {logsData.total} logs</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
              style={{ padding: "4px 10px", background: offset === 0 ? "var(--surface2)" : "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, cursor: offset === 0 ? "default" : "pointer", fontSize: 11 }}>
              ← Previous
            </button>
            <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= logsData.total}
              style={{ padding: "4px 10px", background: offset + limit >= logsData.total ? "var(--surface2)" : "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, cursor: offset + limit >= logsData.total ? "default" : "pointer", fontSize: 11 }}>
              Next →
            </button>
          </div>
        </div>
      )}
    </OrgAdminSection>
  );
}

function SiteAuditLogsSection() {
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [actionFilter, setActionFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [exporting, setExporting] = useState(false);

  const { data: logsData, isLoading, error } = useQuery({
    queryKey: ["site-audit-logs", limit, offset, actionFilter, userFilter, orgFilter],
    queryFn: () => getSiteAuditLogs({ data: {
      limit, offset,
      action: actionFilter || undefined,
      userId: userFilter || undefined,
      orgId: orgFilter || undefined,
    }}),
  });

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
      a.download = `site-audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <SiteAdminSection title="All Organization Logs" description="Site-wide audit log across all organizations — site admin access only" icon="🔒">
      {/* Security notice */}
      <div style={{
        marginBottom: 16, padding: "10px 14px", borderRadius: 8,
        background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)",
        fontSize: 12, color: "#f87171", display: "flex", alignItems: "center", gap: 8,
      }}>
        <span>🔒</span>
        <span><strong>Site Admin Only.</strong> This view is protected server-side by <code>requireAdmin()</code> — user ID must match <code>ADMIN_USER_ID</code> env var. The UI guard is a secondary layer only.</span>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setOffset(0); }}
          style={{ padding: "6px 10px", fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)" }}
        >
          <option value="">All actions</option>
          {ALL_ACTIONS.map((a) => (
            <option key={a} value={a}>{getActionMeta(a).icon} {getActionMeta(a).label}</option>
          ))}
        </select>

        <input
          type="text"
          placeholder="Filter by User ID"
          value={userFilter}
          onChange={(e) => { setUserFilter(e.target.value); setOffset(0); }}
          style={{ padding: "6px 10px", fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", width: 180 }}
        />

        <input
          type="text"
          placeholder="Filter by Org ID"
          value={orgFilter}
          onChange={(e) => { setOrgFilter(e.target.value); setOffset(0); }}
          style={{ padding: "6px 10px", fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", width: 180 }}
        />

        <button
          onClick={handleExportCsv}
          disabled={exporting}
          style={{ padding: "6px 12px", fontSize: 12, background: "var(--accent)", color: "#fff", border: "none", borderRadius: "var(--radius)", cursor: exporting ? "default" : "pointer", fontWeight: 600, marginLeft: "auto" }}
        >
          {exporting ? "Exporting…" : "⬇️ Export CSV"}
        </button>
      </div>

      {isLoading && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--text-muted)", padding: "20px 0" }}>
          <span>⏳</span> Loading all org logs…
        </div>
      )}

      {error && (
        <div style={{ color: "var(--error)", fontSize: 13, padding: "12px 14px", background: "rgba(239,68,68,0.08)", borderRadius: 8 }}>
          🔒 Access denied. Only the configured site admin can view this page.
        </div>
      )}

      {!isLoading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {!logsData?.logs || logsData.logs.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>No audit logs matching filters.</p>
          ) : (
            logsData.logs.map((log: any) => <AuditLogRow key={log.id} log={log} showOrg={true} />)
          )}
        </div>
      )}

      {logsData && logsData.total > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
          <span>Showing {offset + 1}–{Math.min(offset + limit, logsData.total)} of {logsData.total} total logs</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}
              style={{ padding: "4px 10px", background: offset === 0 ? "var(--surface2)" : "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, cursor: offset === 0 ? "default" : "pointer", fontSize: 11 }}>
              ← Previous
            </button>
            <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= logsData.total}
              style={{ padding: "4px 10px", background: offset + limit >= logsData.total ? "var(--surface2)" : "var(--surface)", border: "1px solid var(--border)", borderRadius: 4, cursor: offset + limit >= logsData.total ? "default" : "pointer", fontSize: 11 }}>
              Next →
            </button>
          </div>
        </div>
      )}
    </SiteAdminSection>
  );
}


// ── Agent Activity Section (all authenticated users, own events only) ─────────

const ACTION_COLORS_INLINE: Record<string, string> = {
  recall_context: "var(--accent)",
  commit_memory: "#22c55e",
  update_memory: "#f59e0b",
  delete_memory: "#ef4444",
  search_memories: "#818cf8",
  get_memory_summary: "#64748b",
  recall_context_abac_denied: "#ef4444",
  jit_access_requested: "#f59e0b",
  jit_access_approved: "#22c55e",
  jit_access_denied: "#ef4444",
};

const ACTION_LABELS_INLINE: Record<string, string> = {
  recall_context: "Recalled Context",
  commit_memory: "Committed Memory",
  update_memory: "Updated Memory",
  delete_memory: "Deleted Memory",
  search_memories: "Searched Memories",
  get_memory_summary: "Fetched Summary",
  export_memories: "Exported Memories",
  recall_context_abac_denied: "Recall Denied (ABAC)",
  jit_access_requested: "JIT Access Requested",
  jit_access_approved: "JIT Approved",
  jit_access_denied: "JIT Denied",
  update_memory_queued: "Update Queued",
  delete_memory_queued: "Delete Queued",
};

function ActivityRow({ entry }: { entry: AgentActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  const color = ACTION_COLORS_INLINE[entry.action] ?? "var(--text-muted)";
  const label = ACTION_LABELS_INLINE[entry.action] ?? entry.action;

  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
      <div onClick={() => setExpanded((p) => !p)} style={{ padding: "12px 14px", cursor: "pointer", display: "flex", gap: 12, alignItems: "flex-start" }}>
        {/* Action badge */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 5, background: `${color}22`, color, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, border: `1px solid ${color}55`, whiteSpace: "nowrap" }}>
          {label}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Tool + token row */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: entry.query ? 4 : 0 }}>
            {entry.toolName && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)", fontWeight: 600 }}>
                ◎ {entry.toolName}
              </span>
            )}
            {entry.tokenId && entry.tokenId !== "session" && (
              <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(168,85,247,0.1)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.2)", fontWeight: 600 }}>
                🔑 {entry.tokenId.slice(0, 8)}…
              </span>
            )}
            {entry.matchCount !== null && (
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{entry.matchCount} result{entry.matchCount !== 1 ? "s" : ""}</span>
            )}
          </div>

          {/* Query */}
          {entry.query && (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Query: <span style={{ color: "var(--text)", fontStyle: "italic" }}>{entry.query}</span>
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{new Date(entry.timestamp).toLocaleString()}</div>
          {entry.ipAddress && <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>IP: {entry.ipAddress}</div>}
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{expanded ? "▲" : "▼"}</div>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px", background: "var(--surface)", fontSize: 11, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {entry.tokenId && <span><span style={{ color: "var(--text-muted)" }}>Token:</span> <code style={{ fontSize: 10 }}>{entry.tokenId}</code></span>}
            {entry.memoryId && <span><span style={{ color: "var(--text-muted)" }}>Memory:</span> <code style={{ fontSize: 10 }}>{entry.memoryId}</code></span>}
            {entry.projectKey && <span><span style={{ color: "var(--text-muted)" }}>Scope:</span> <code style={{ fontSize: 10 }}>{entry.projectKey}</code></span>}
          </div>
          {entry.userAgent && <div style={{ color: "var(--text-muted)", wordBreak: "break-all" }}>UA: {entry.userAgent}</div>}
          {entry.injectedFacts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Injected facts ({entry.injectedFacts.length})
              </div>
              {entry.injectedFacts.map((f, i) => (
                <div key={f.id || i} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", background: "var(--accent-dim)", borderRadius: 4, color: "var(--accent)", textTransform: "uppercase" }}>{f.category}</span>
                    <span style={{ fontSize: 9, color: "var(--text-muted)" }}>{f.tags}</span>
                    {f.score !== null && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: f.score >= 0.8 ? "#22c55e" : f.score >= 0.6 ? "#f59e0b" : "#ef4444" }}>
                        {Math.round(f.score * 100)}% match
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text)", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{f.fact || <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>encrypted</span>}</div>
                </div>
              ))}
            </div>
          )}
          {entry.rawMetadata && Object.keys(entry.rawMetadata).length > 0 && (
            <pre style={{ margin: 0, fontSize: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 10px", overflowX: "auto", color: "var(--text-muted)" }}>
              {JSON.stringify(entry.rawMetadata, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

const ACTIVITY_FILTER_ACTIONS = [
  { value: "", label: "All" },
  { value: "recall_context", label: "Recall" },
  { value: "commit_memory", label: "Commit" },
  { value: "update_memory", label: "Update" },
  { value: "delete_memory", label: "Delete" },
  { value: "search_memories", label: "Search" },
  { value: "jit_access_requested", label: "JIT" },
];

function AgentActivitySection() {
  const [actionFilter, setActionFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data: rawEntries = [] as AgentActivityEntry[], isLoading, isError } = useQuery({
    queryKey: ["agent-activity-admin", actionFilter],
    queryFn: (): Promise<AgentActivityEntry[]> => getAgentActivityLogs({ data: { limit: 200, action: actionFilter || undefined } }) as Promise<AgentActivityEntry[]>,
    staleTime: 15000,
    refetchInterval: 30000,
  });

  const entries = rawEntries.filter((e) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      e.query?.toLowerCase().includes(q) ||
      e.toolName?.toLowerCase().includes(q) ||
      e.action.toLowerCase().includes(q) ||
      e.injectedFacts.some((f) => f.fact.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
        Every memory operation your AI tools have performed — which tool called, what it asked for, and what was injected into its context window.
      </p>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search queries, facts, tools…"
            style={{ width: "100%", paddingLeft: 10, paddingRight: 10, paddingTop: 6, paddingBottom: 6, fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", outline: "none", boxSizing: "border-box" }}
          />
        </div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {ACTIVITY_FILTER_ACTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setActionFilter(value)}
              style={{ padding: "4px 10px", fontSize: 11, fontWeight: actionFilter === value ? 700 : 500, background: actionFilter === value ? "var(--accent-dim)" : "var(--surface)", border: `1px solid ${actionFilter === value ? "var(--accent)" : "var(--border)"}`, color: actionFilter === value ? "var(--accent)" : "var(--text-muted)", borderRadius: 20, cursor: "pointer" }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading activity…</p>}
      {isError && <p style={{ color: "var(--error)", fontSize: 13 }}>Failed to load activity.</p>}

      {!isLoading && !isError && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {entries.length === 0 ? (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
              {rawEntries.length === 0 ? "No activity yet. Connect an AI tool and make a recall." : "No events match your filters."}
            </p>
          ) : (
            entries.map((entry) => <ActivityRow key={entry.id} entry={entry} />)
          )}
        </div>
      )}

      {!isLoading && entries.length > 0 && (
        <p style={{ textAlign: "center", fontSize: 10, color: "var(--text-muted)", margin: 0 }}>
          Auto-refreshes every 30 s — {entries.length} event{entries.length !== 1 ? "s" : ""} shown
        </p>
      )}
    </div>
  );
}

function AdminPage() {
  const [activeSection, setActiveSection] = useState<AdminSection>("personal-account");

  // ── state ──────────────────────────────────────────────────────────────────
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearVectorize, setConfirmClearVectorize] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [scanResults, setScanResults] = useState<DuplicateGroup[] | null>(null);
  const [retainSelections, setRetainSelections] = useState<Record<number, string>>({});
  const [migrateResult, setMigrateResult] = useState<MigrateV2Result | null>(null);
  const [rebuildResult, setRebuildResult] = useState<{ processed: number; failed: number } | null>(null);

  // users modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isOrgsModalOpen, setIsOrgsModalOpen] = useState(false);
  const [isResetSuccessModalOpen, setIsResetSuccessModalOpen] = useState(false);

  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPlan, setCreatePlan] = useState("free");

  const [selectedUser, setSelectedUser] = useState<UserDetails | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editEmailVerified, setEditEmailVerified] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState("free");
  const [passwordValue, setPasswordValue] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [assignOrgId, setAssignOrgId] = useState("");
  const [assignRole, setAssignRole] = useState<"owner" | "admin" | "member">("member");
  const [userSearch, setUserSearch] = useState("");

  // orgs
  const [editingOrgQuotaId, setEditingOrgQuotaId] = useState<string | null>(null);
  const [editMemories, setEditMemories] = useState(100);
  const [editRecalls, setEditRecalls] = useState(1000);
  const [editCommits, setEditCommits] = useState(500);

  // ── queries ────────────────────────────────────────────────────────────────
  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: () => getDbStats(),
    refetchInterval: 5000,
  });
  const debugQuery = useQuery({
    queryKey: ["admin-debug"],
    queryFn: () => getVectorizeDebug(),
    refetchInterval: 10000,
  });
  const orgsQuery = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: () => listAllOrgsAndQuotas(),
    enabled: activeSection === "orgs" || activeSection === "users",
  });

  // Full org+team data for the org/team management sections
  const orgTeamQuery = useQuery({
    queryKey: ["admin-orgs-teams"],
    queryFn: () => getUserOrgsAndTeams(),
    enabled: activeSection === "orgs" || activeSection === "teams",
  });

  // Org/team UI state
  const [selectedOrgKey, setSelectedOrgKey] = useState<string>("");
  const [selectedTeamKey, setSelectedTeamKey] = useState<string>("");
  const [orgInviteEmail, setOrgInviteEmail] = useState("");
  const [orgInviteRole, setOrgInviteRole] = useState<"admin" | "member">("member");
  const [teamInviteEmail, setTeamInviteEmail] = useState("");
  const [teamInviteRole, setTeamInviteRole] = useState("member");
  const [newTeamName, setNewTeamName] = useState("");
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listAllUsersAndDetails(),
    enabled: activeSection === "users",
  });
  const { data: adminStatus } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });
  // Billing data used for role gating (isOrgAdmin) — loaded eagerly since it
  // determines which sidebar sections are visible.
  const { data: billingData } = useBillingData();
  const isOrgAdmin = (billingData?.managedOrgs?.length ?? 0) > 0;
  const isSiteAdmin = adminStatus?.isAdmin ?? false;

  // ── mutations ──────────────────────────────────────────────────────────────
  const clearDbMutation = useMutation({
    mutationFn: clearDatabase,
    onSuccess: () => { setConfirmClear(false); statsQuery.refetch(); debugQuery.refetch(); },
  });
  const clearVectorizeMutation = useMutation({
    mutationFn: clearVectorizeIndex,
    onSuccess: () => { setConfirmClearVectorize(false); statsQuery.refetch(); debugQuery.refetch(); },
  });
  const clearAllMutation = useMutation({
    mutationFn: nukeEverything,
    onSuccess: () => { setConfirmClearAll(false); statsQuery.refetch(); debugQuery.refetch(); },
  });
  const rebuildMutation = useMutation({
    mutationFn: () => rebuildVectorizeIndex({}),
    onSuccess: (data) => { setRebuildResult(data); statsQuery.refetch(); debugQuery.refetch(); },
  });
  const scanMutation = useMutation({
    mutationFn: scanDatabaseDuplicates,
    onSuccess: (data) => {
      setScanResults(data.groups);
      const defaults: Record<number, string> = {};
      data.groups.forEach((g, idx) => { defaults[idx] = g.primary.id; });
      setRetainSelections(defaults);
    },
  });
  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!scanResults) return;
      const idsToDelete: string[] = [];
      scanResults.forEach((group, idx) => {
        const retainedId = retainSelections[idx] || group.primary.id;
        [group.primary, ...group.duplicates].forEach((item) => {
          if (item.id !== retainedId) idsToDelete.push(item.id);
        });
      });
      if (idsToDelete.length > 0) await bulkDeleteMemories({ data: { ids: idsToDelete } });
    },
    onSuccess: () => {
      setScanResults(null);
      setRetainSelections({});
      statsQuery.refetch();
      debugQuery.refetch();
      alert("Successfully resolved duplicates!");
    },
  });
  const migrateMutation = useMutation({
    mutationFn: () => migrateToV2({}),
    onSuccess: (data) => setMigrateResult(data),
    onError: (err) => alert("Migration failed: " + String(err)),
  });

  const createUserMut = useMutation({
    mutationFn: (data: { name: string; email: string; password?: string; plan?: string }) => createUserAdmin({ data }),
    onSuccess: () => {
      usersQuery.refetch();
      setIsCreateModalOpen(false);
      setCreateName(""); setCreateEmail(""); setCreatePassword(""); setCreatePlan("free");
    },
    onError: (err) => alert("Failed to create user: " + String(err)),
  });
  const updateUserMut = useMutation({
    mutationFn: (data: { userId: string; name: string; email: string; emailVerified: boolean }) => updateUserAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); setIsEditModalOpen(false); },
    onError: (err) => alert("Failed to update user: " + String(err)),
  });
  const deleteUserMut = useMutation({
    mutationFn: (userId: string) => deleteUserAdmin({ data: { userId } }),
    onSuccess: () => usersQuery.refetch(),
    onError: (err) => alert("Failed to delete user: " + String(err)),
  });
  const updateUserPlanMut = useMutation({
    mutationFn: (data: { userId: string; plan: string }) => updateUserPlanAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); setIsPlanModalOpen(false); },
    onError: (err) => alert("Failed to update user plan: " + String(err)),
  });
  const setUserPasswordMut = useMutation({
    mutationFn: (data: { userId: string; password: string }) => setUserPasswordAdmin({ data }),
    onSuccess: () => { setIsPasswordModalOpen(false); setPasswordValue(""); alert("Password set successfully!"); },
    onError: (err) => alert("Failed to set password: " + String(err)),
  });
  const resetUserPasswordMut = useMutation({
    mutationFn: (userId: string) => resetUserPasswordAdmin({ data: { userId } }),
    onSuccess: (res) => { setGeneratedPassword(res.password || ""); setIsResetSuccessModalOpen(true); },
    onError: (err) => alert("Failed to reset password: " + String(err)),
  });
  const assignUserToOrgMut = useMutation({
    mutationFn: (data: { userId: string; orgId: string; role: "owner" | "admin" | "member" }) => assignUserToOrgAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); orgsQuery.refetch(); },
    onError: (err) => alert("Failed to assign user to organization: " + String(err)),
  });
  const removeUserFromOrgMut = useMutation({
    mutationFn: (data: { userId: string; orgId: string }) => removeUserFromOrgAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); orgsQuery.refetch(); },
    onError: (err) => alert("Failed to remove user from organization: " + String(err)),
  });
  const updateQuotaMut = useMutation({
    mutationFn: (data: { orgId: string; monthlyMemories: number; monthlyRecalls: number; monthlyCommits: number }) => updateOrgQuota({ data }),
    onSuccess: () => { setEditingOrgQuotaId(null); orgsQuery.refetch(); },
    onError: (err) => alert("Failed to update quota: " + String(err)),
  });
  const deleteOrgMut = useMutation({
    mutationFn: (id: string) => deleteOrganization({ data: { id } }),
    onSuccess: () => orgsQuery.refetch(),
    onError: (err) => alert("Failed to delete org: " + String(err)),
  });

  const filteredUsers = (usersQuery.data || []).filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  // Org/team mutations (self-serve operations for org admins)
  const refetchOrgTeams = () => orgTeamQuery.refetch();
  const mutOpts = { onSuccess: refetchOrgTeams, onError: (err: Error) => alert(err.message) };

  const createOrgMut = useMutation({
    mutationFn: (name: string) => createOrganizationSelfServe({ data: { name } }),
    onSuccess: (res) => { setShowCreateOrg(false); setNewOrgName(""); setSelectedOrgKey(`org:${res.orgId}`); refetchOrgTeams(); },
    onError: (err: Error) => alert(err.message),
  });
  const addOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; email: string; role: "admin" | "member" }) => addOrgMemberByEmail({ data }),
    onSuccess: () => { setOrgInviteEmail(""); refetchOrgTeams(); },
    onError: (err: Error) => alert(err.message),
  });
  const updateOrgRoleMut = useMutation({
    mutationFn: (data: { orgId: string; userId: string; role: "owner" | "admin" | "member" }) => updateOrgMemberRole({ data }),
    ...mutOpts,
  });
  const removeOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; userId: string }) => removeOrgMember({ data }),
    ...mutOpts,
  });
  const createTeamMut = useMutation({
    mutationFn: (data: { orgId: string; name: string }) => createTeam({ data }),
    onSuccess: () => { setNewTeamName(""); refetchOrgTeams(); },
    onError: (err: Error) => alert(err.message),
  });
  const deleteTeamMut = useMutation({
    mutationFn: (teamId: string) => deleteTeam({ data: { teamId } }),
    onSuccess: () => { setSelectedTeamKey(""); refetchOrgTeams(); },
    onError: (err: Error) => alert(err.message),
  });
  const addTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; email: string; role: string }) => addTeamMemberByEmail({ data }),
    onSuccess: () => { setTeamInviteEmail(""); refetchOrgTeams(); },
    onError: (err: Error) => alert(err.message),
  });
  const updateTeamRoleMut = useMutation({
    mutationFn: (data: { teamId: string; userId: string; role: string }) => updateTeamMemberRole({ data }),
    ...mutOpts,
  });
  const removeTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; userId: string }) => removeTeamMember({ data }),
    ...mutOpts,
  });

  // Derived org/team data
  const allOrgs = orgTeamQuery.data?.organizations ?? [];
  const allTeams = orgTeamQuery.data?.teams ?? [];
  const activeOrg = allOrgs.find((o) => o.id === selectedOrgKey) ?? allOrgs[0];
  const activeTeam = allTeams.find((t) => t.id === selectedTeamKey);
  const orgQuotaData = orgsQuery.data?.find((o) => o.id === activeOrg?.id);

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <AdminLayout
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      isOrgAdmin={isOrgAdmin}
      isSiteAdmin={isSiteAdmin}
    >

      {/* ── PERSONAL ACCOUNT ────────────────────────────────────────────── */}
      {activeSection === "personal-account" && <ProfileSection />}

      {/* ── SECURITY ────────────────────────────────────────────────────── */}
      {activeSection === "personal-security" && (
        <div className="flex flex-col gap-6">
          <TwoFactorSection />
          <PasscodeSection />
        </div>
      )}

      {/* ── SESSIONS ────────────────────────────────────────────────────── */}
      {activeSection === "personal-sessions" && <SessionsSection />}

      {/* ── API TOKENS ──────────────────────────────────────────────────── */}
      {activeSection === "personal-tokens" && <ApiTokensSection />}

      {/* ── MCP ENDPOINT ────────────────────────────────────────────────── */}
      {activeSection === "personal-mcp" && <McpEndpointSection />}

      {/* ── MY USAGE ────────────────────────────────────────────────────── */}
      {activeSection === "personal-usage" && <MyUsageSection />}

      {/* ── MY BILLING ──────────────────────────────────────────────────── */}
      {activeSection === "personal-billing" && <MyBillingSection />}

      {activeSection === "personal-activity" && <AgentActivitySection />}

      {activeSection === "personal-webhooks" && <WebhookSecretsSection />}

      {/* ── SYSTEM OVERVIEW ─────────────────────────────────────────────── */}
      {activeSection === "system" && (
        <>
          <SiteAdminSection title="Database Stats" description="Real-time storage metrics" icon="📊">
            {statsQuery.isPending && <p>Loading...</p>}
            {statsQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load stats: {String(statsQuery.error)}</p>}
            {statsQuery.data && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                <StatBox label="D1 Memories" value={statsQuery.data.memoryCount} />
                <StatBox label="Vectorize Vectors" value={statsQuery.data.vectorCount} />
              </div>
            )}
          </SiteAdminSection>

          <SiteAdminSection title="Vector Index Health" description="Orphaned vector detection" icon="🔍">
            {debugQuery.data?.vectors?.length ? (
              <AdminCard status="error">
                <p style={{ color: "var(--error)", marginBottom: "10px" }}>
                  Found {debugQuery.data.vectors.length} D1 records with no matching vector (first 100 checked):
                </p>
                <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px", fontFamily: "monospace", fontSize: "11px", maxHeight: "200px", overflowY: "auto" }}>
                  {debugQuery.data.vectors.map((v) => (
                    <div key={v.id} style={{ color: "var(--text-muted)", padding: "3px 0" }}>
                      {v.id.slice(0, 8)}... (missing from Vectorize)
                    </div>
                  ))}
                </div>
              </AdminCard>
            ) : (
              <AdminCard status="success">
                <p style={{ margin: 0, fontWeight: 600, color: "var(--success)" }}>✓ No orphaned vectors detected</p>
              </AdminCard>
            )}
          </SiteAdminSection>

          <SiteAdminSection title="Database Deduplication Scanner" description="Find and resolve semantic duplicate memories" icon="🔎">
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "15px" }}>
              Scan all stored memories for semantic duplicates. Locker will identify identical facts with different phrasings and let you choose which to retain.
            </p>
            {!scanResults ? (
              <button
                onClick={() => scanMutation.mutate({})}
                disabled={scanMutation.isPending}
                style={{ padding: "10px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer" }}
              >
                {scanMutation.isPending ? "Scanning & Analyzing Database..." : "Scan for Duplicates"}
              </button>
            ) : (
              <div>
                <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                  <button onClick={() => scanMutation.mutate({})} disabled={scanMutation.isPending || resolveMutation.isPending}
                    style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: "var(--radius)", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                    {scanMutation.isPending ? "Scanning..." : "Rescan"}
                  </button>
                  <button onClick={() => setScanResults(null)} disabled={scanMutation.isPending || resolveMutation.isPending}
                    style={{ padding: "8px 16px", background: "transparent", border: "1px solid transparent", color: "var(--text-muted)", borderRadius: "var(--radius)", fontSize: "13px", cursor: "pointer" }}>
                    Clear Results
                  </button>
                </div>
                {scanResults.length === 0 ? (
                  <AdminCard status="success">
                    <p style={{ margin: 0 }}>🎉 No duplicate memories found in your database!</p>
                  </AdminCard>
                ) : (
                  <div>
                    <p style={{ marginBottom: "15px", fontSize: "13px", color: "var(--text-muted)" }}>
                      Found {scanResults.length} duplicate group{scanResults.length !== 1 ? "s" : ""}. Choose which memory to retain (non-selected will be deleted):
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      {scanResults.map((group, groupIdx) => {
                        const allItems = [group.primary, ...group.duplicates];
                        const selectedId = retainSelections[groupIdx] || group.primary.id;
                        return (
                          <div key={groupIdx} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "15px" }}>
                            <div style={{ fontSize: "12px", fontWeight: "bold", color: "var(--accent)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              Group {groupIdx + 1}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                              {allItems.map((item) => (
                                <label key={item.id} style={{
                                  display: "flex", alignItems: "start", gap: "10px", padding: "10px",
                                  background: selectedId === item.id ? "rgba(168,85,247,0.06)" : "var(--surface)",
                                  border: `1px solid ${selectedId === item.id ? "var(--accent)" : "var(--border)"}`,
                                  borderRadius: "var(--radius)", cursor: "pointer", transition: "all 0.15s ease",
                                }}>
                                  <input type="radio" name={`group-${groupIdx}`} checked={selectedId === item.id}
                                    onChange={() => setRetainSelections((prev) => ({ ...prev, [groupIdx]: item.id }))}
                                    style={{ marginTop: "3px", accentColor: "var(--accent)" }} />
                                  <div style={{ flex: 1, fontSize: "13px", lineHeight: "1.5" }}>
                                    <p style={{ margin: 0, color: "var(--text)" }}>{item.fact}</p>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                                      <span style={{ fontSize: "10px", background: "var(--surface2)", color: "var(--text-muted)", padding: "2px 6px", borderRadius: "4px", textTransform: "uppercase" }}>
                                        {item.category}
                                      </span>
                                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                                        Added {new Date(item.timestamp).toLocaleDateString()}
                                      </span>
                                    </div>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: "20px" }}>
                      <button onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}
                        style={{ padding: "10px 24px", background: "var(--error)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer", boxShadow: "0 4px 12px rgba(239,68,68,0.2)" }}>
                        {resolveMutation.isPending ? "Resolving Duplicates..." : "Resolve & Delete Duplicates"}
                      </button>
                      {resolveMutation.isError && <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>Failed to resolve duplicates. Please try again.</p>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </SiteAdminSection>

          <SiteAdminSection title="Vector Index Management" description="Rebuild Vectorize from D1" icon="⚡">
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "15px" }}>
              Rebuild the Vectorize index by generating embeddings for all database memories. Use this if the Vectorize index was migrated or is out of sync with D1.
            </p>
            {rebuildResult && (
              <AdminCard status="success">
                <p style={{ margin: 0 }}>Done — processed {rebuildResult.processed} memories{rebuildResult.failed > 0 ? `, ${rebuildResult.failed} failed` : ""}.</p>
              </AdminCard>
            )}
            <button onClick={() => { setRebuildResult(null); rebuildMutation.mutate(); }} disabled={rebuildMutation.isPending}
              style={{ padding: "9px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer", marginTop: rebuildResult ? "12px" : 0 }}>
              {rebuildMutation.isPending ? "Rebuilding Index…" : "Rebuild Vector Index"}
            </button>
            {rebuildMutation.isError && <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>Index rebuild failed. Check logs.</p>}
          </SiteAdminSection>

          <SiteAdminSection title="Security Architecture Migration" description="Migrate all data to v2 envelope encryption and PBKDF2 token hashing" icon="🔒">
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px" }}>
              Migrates all vault data to the v2 security architecture in one pass:
            </p>
            <ul style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "15px", paddingLeft: "18px", lineHeight: "1.8" }}>
              <li><strong>Memories</strong> — re-encrypts any data still under the legacy HKDF-derived key to the per-vault DEK.</li>
              <li><strong>TOTP secrets</strong> — re-encrypts under the per-user DEK.</li>
              <li><strong>Credentials</strong> — re-encrypts under the per-vault DEK.</li>
              <li><strong>API tokens</strong> — invalidates any tokens still hashed with SHA-256 (no plaintext available to re-hash). Affected users must regenerate their tokens.</li>
            </ul>
            <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "8px", padding: "10px 14px", marginBottom: "15px", fontSize: "12px", color: "#f59e0b" }}>
              ⚠️ Run this once after deploying the v2 update to production. Safe to re-run — already-migrated records are skipped. Legacy API tokens will be deleted and cannot be recovered.
            </div>
            {migrateResult && (
              <AdminCard status={migrateResult.memories.failed > 0 || migrateResult.totp.failed > 0 || migrateResult.credentials.failed > 0 ? "warning" : "success"}>
                <p style={{ margin: "0 0 6px 0", fontWeight: 600 }}>Migration complete</p>
                <ul style={{ margin: 0, paddingLeft: "16px", fontSize: "12px", lineHeight: "1.8" }}>
                  <li>Memories: {migrateResult.memories.migrated} migrated, {migrateResult.memories.skipped} already up to date{migrateResult.memories.failed > 0 ? `, ${migrateResult.memories.failed} failed` : ""}</li>
                  <li>TOTP secrets: {migrateResult.totp.migrated} migrated, {migrateResult.totp.skipped} already up to date{migrateResult.totp.failed > 0 ? `, ${migrateResult.totp.failed} failed` : ""}</li>
                  <li>Credentials: {migrateResult.credentials.migrated} migrated, {migrateResult.credentials.skipped} already up to date{migrateResult.credentials.failed > 0 ? `, ${migrateResult.credentials.failed} failed` : ""}</li>
                  <li>Legacy API tokens invalidated: {migrateResult.tokens.invalidated}</li>
                </ul>
              </AdminCard>
            )}
            <button
              onClick={() => { setMigrateResult(null); migrateMutation.mutate(); }}
              disabled={migrateMutation.isPending}
              style={{ padding: "9px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer", marginTop: migrateResult ? "12px" : 0 }}
            >
              {migrateMutation.isPending ? "Migrating…" : "Run v2 Security Migration"}
            </button>
            {migrateMutation.isError && <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>Migration failed. Check server logs for details.</p>}
          </SiteAdminSection>

          <SiteAdminSection title="Destructive Operations" description="Irreversible data deletion" icon="⚠️">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px" }}>
              <div>
                <button onClick={() => setConfirmClearVectorize(true)} disabled={clearVectorizeMutation.isPending}
                  style={{ width: "100%", padding: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer" }}>
                  Clear Vectorize Only
                </button>
                {confirmClearVectorize && (
                  <AdminCard status="warning">
                    <p style={{ fontSize: "12px", marginBottom: "8px" }}>This will delete all vectors from Vectorize but keep D1 data.</p>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button onClick={() => clearVectorizeMutation.mutate({})} style={{ flex: 1, padding: "6px", background: "var(--error)", color: "white" }}>Confirm</button>
                      <button onClick={() => setConfirmClearVectorize(false)} style={{ flex: 1, padding: "6px", background: "var(--surface2)", border: "1px solid var(--border)" }}>Cancel</button>
                    </div>
                  </AdminCard>
                )}
              </div>
              <div>
                <button onClick={() => setConfirmClear(true)} disabled={clearDbMutation.isPending}
                  style={{ width: "100%", padding: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer" }}>
                  Clear Database Only
                </button>
                {confirmClear && (
                  <AdminCard status="warning">
                    <p style={{ fontSize: "12px", marginBottom: "8px" }}>This will delete all memories from D1 and Vectorize.</p>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button onClick={() => clearDbMutation.mutate({})} style={{ flex: 1, padding: "6px", background: "var(--error)", color: "white" }}>Confirm</button>
                      <button onClick={() => setConfirmClear(false)} style={{ flex: 1, padding: "6px", background: "var(--surface2)", border: "1px solid var(--border)" }}>Cancel</button>
                    </div>
                  </AdminCard>
                )}
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <button onClick={() => setConfirmClearAll(true)} disabled={clearAllMutation.isPending}
                  style={{ width: "100%", padding: "10px", background: "rgba(239,68,68,0.15)", border: "2px solid rgba(239,68,68,0.5)", color: "var(--error)", borderRadius: "var(--radius)", fontWeight: "bold", fontSize: "14px", cursor: "pointer" }}>
                  🔥 NUKE: Clear Everything
                </button>
                {confirmClearAll && (
                  <AdminCard status="error">
                    <p style={{ fontSize: "13px", marginBottom: "8px", fontWeight: "bold" }}>This will delete ALL memories from both D1 and Vectorize. This cannot be undone!</p>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button onClick={() => clearAllMutation.mutate({})} style={{ flex: 1, padding: "8px", background: "var(--error)", color: "white", fontWeight: "bold" }}>NUKE IT</button>
                      <button onClick={() => setConfirmClearAll(false)} style={{ flex: 1, padding: "8px", background: "var(--surface2)", border: "1px solid var(--border)" }}>Cancel</button>
                    </div>
                  </AdminCard>
                )}
              </div>
            </div>
            <div style={{ marginTop: "16px", padding: "10px 14px", background: "rgba(168,85,247,0.08)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                <strong>Status:</strong>{" "}
                {clearDbMutation.isPending || clearVectorizeMutation.isPending || clearAllMutation.isPending ? "Operating..." : "Ready"}
              </p>
            </div>
          </SiteAdminSection>
        </>
      )}

      {/* ── SITE CONFIGURATION ──────────────────────────────────────────────── */}
      {activeSection === "site-config" && <SiteConfigSection />}

      {/* ── BILLING MANAGEMENT ──────────────────────────────────────────────── */}
      {activeSection === "billing-manage" && (
        <SiteAdminSection title="Billing Management" description="Manage subscription metrics and revenue" icon="💳">
          <AdminCard>
            <p style={{ color: "var(--text-muted)", margin: 0 }}>Billing dashboard coming soon...</p>
          </AdminCard>
        </SiteAdminSection>
      )}

      {/* ── ORGANIZATIONS ───────────────────────────────────────────────────── */}
      {activeSection === "orgs" && (
        <OrgAdminSection title="Organizations" description="Create organizations and manage members" icon="🏢">
          {/* Header: org picker + create */}
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 20 }}>
            {allOrgs.length > 0 && (
              <select value={activeOrg?.id ?? ""} onChange={(e) => setSelectedOrgKey(e.target.value)}
                style={{ flex: 1, padding: "8px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontWeight: 600 }}>
                {allOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
            <button onClick={() => setShowCreateOrg(true)}
              style={{ padding: "8px 16px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
              + Create Org
            </button>
          </div>

          {orgTeamQuery.isPending && <p style={{ color: "var(--text-muted)" }}>Loading...</p>}
          {orgTeamQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load organizations.</p>}

          {allOrgs.length === 0 && !orgTeamQuery.isPending && (
            <div style={{ textAlign: "center", padding: "40px", border: "1px dashed var(--border)", borderRadius: "var(--radius)", color: "var(--text-muted)" }}>
              No organizations yet. Create one to get started.
            </div>
          )}

          {activeOrg && (() => {
            const isEditing = editingOrgQuotaId === activeOrg.id;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Org header + delete */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "16px 18px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <h3 style={{ margin: 0, fontSize: 16, fontWeight: "bold" }}>{activeOrg.name}</h3>
                      <span style={{ fontSize: 10, background: activeOrg.plan === "enterprise" ? "rgba(16,185,129,0.15)" : activeOrg.plan === "business" ? "rgba(168,85,247,0.15)" : "var(--surface2)", color: activeOrg.plan === "enterprise" ? "#10b981" : activeOrg.plan === "business" ? "var(--accent)" : "var(--text-muted)", padding: "2px 8px", borderRadius: 20, fontWeight: "bold", textTransform: "uppercase" }}>
                        {activeOrg.plan}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      ID: <code style={{ color: "var(--accent)" }}>{activeOrg.id}</code> · {activeOrg.members.length} member(s) · {activeOrg.teams.length} team(s)
                    </div>
                  </div>
                  <button onClick={() => { if (confirm(`Delete ${activeOrg.name}? This removes all members, teams and quotas.`)) deleteOrgMut.mutate(activeOrg.id); }}
                    style={{ padding: "4px 10px", background: "transparent", color: "var(--error)", border: "1px solid transparent", borderRadius: "var(--radius)", cursor: "pointer", fontSize: 12 }}
                    onMouseEnter={(e) => { (e.target as HTMLElement).style.background = "rgba(239,68,68,0.1)"; (e.target as HTMLElement).style.borderColor = "rgba(239,68,68,0.2)"; }}
                    onMouseLeave={(e) => { (e.target as HTMLElement).style.background = "transparent"; (e.target as HTMLElement).style.borderColor = "transparent"; }}>
                    Delete
                  </button>
                </div>

                {/* Members + invite */}
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "18px", display: "flex", flexDirection: "column", gap: 12 }}>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: "bold" }}>Members</h4>
                  <InviteForm label="Add Member by Email" email={orgInviteEmail} setEmail={setOrgInviteEmail} role={orgInviteRole} setRole={(v) => setOrgInviteRole(v as "admin" | "member")} roles={["member", "admin"]}
                    onSubmit={() => addOrgMemberMut.mutate({ orgId: activeOrg.id, email: orgInviteEmail, role: orgInviteRole })} loading={addOrgMemberMut.isPending} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {activeOrg.members.map((m: any) => (
                      <MemberRow key={m.userId} member={m} roles={["member", "admin", "owner"]}
                        onUpdateRole={(uid, role) => updateOrgRoleMut.mutate({ orgId: activeOrg.id, userId: uid, role: role as any })}
                        onRemove={(uid) => removeOrgMemberMut.mutate({ orgId: activeOrg.id, userId: uid })}
                        isUpdating={updateOrgRoleMut.isPending} isRemoving={removeOrgMemberMut.isPending} currentUserRole={activeOrg.role} />
                    ))}
                  </div>
                </div>

                {/* Quotas */}
                <div style={{ background: "var(--surface2)", borderRadius: 10, padding: "14px 16px", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Monthly Quotas</span>
                    {!isEditing ? (
                      <button onClick={() => { setEditingOrgQuotaId(activeOrg.id); setEditMemories(orgQuotaData?.monthlyMemories ?? 100); setEditRecalls(orgQuotaData?.monthlyRecalls ?? 1000); setEditCommits(orgQuotaData?.monthlyCommits ?? 500); }}
                        style={{ padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 11, cursor: "pointer", color: "var(--text-muted)" }}>
                        Edit Quotas
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: 5 }}>
                        <button onClick={() => updateQuotaMut.mutate({ orgId: activeOrg.id, monthlyMemories: editMemories, monthlyRecalls: editRecalls, monthlyCommits: editCommits })} disabled={updateQuotaMut.isPending}
                          style={{ padding: "4px 8px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontSize: 11, cursor: "pointer", fontWeight: "bold" }}>
                          {updateQuotaMut.isPending ? "Saving..." : "Save"}
                        </button>
                        <button onClick={() => setEditingOrgQuotaId(null)} style={{ padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 11, cursor: "pointer", color: "var(--text-muted)" }}>Cancel</button>
                      </div>
                    )}
                  </div>
                  {!isEditing ? (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      {[["Memories", orgQuotaData?.monthlyMemories], ["Recalls", orgQuotaData?.monthlyRecalls], ["Commits", orgQuotaData?.monthlyCommits]].map(([label, val]: any) => (
                        <div key={label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label} Max</span>
                          <span style={{ fontSize: 14, fontWeight: "bold" }}>{val}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                      {([["Memories Max", editMemories, setEditMemories], ["Recalls Max", editRecalls, setEditRecalls], ["Commits Max", editCommits, setEditCommits]] as [string, number, (v: number) => void][]).map(([label, val, setter]) => (
                        <div key={label}>
                          <span style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{label}</span>
                          <input type="number" value={val} onChange={(e) => setter(Number(e.target.value))} style={{ width: "100%", padding: "5px 8px", fontSize: 12, borderRadius: 4 }} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {showCreateOrg && (
            <CreateOrgModal onClose={() => setShowCreateOrg(false)} onSubmit={(name) => createOrgMut.mutate(name)}
              loading={createOrgMut.isPending} nameValue={newOrgName} onNameChange={setNewOrgName} />
          )}
        </OrgAdminSection>
      )}

      {/* ── ORG BILLING ─────────────────────────────────────────────────────── */}
      {activeSection === "org-billing" && <OrgBillingSection />}

      {/* ── AUDIT LOGS ───────────────────────────────────────────────────────── */}
      {activeSection === "org-audit-logs" && <AuditLogsSection />}

      {/* ── USERS ───────────────────────────────────────────────────────────── */}
      {activeSection === "users" && (
        <OrgAdminSection title="Users Directory" description="Manage all users and their plans" icon="👥">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <input
              type="text"
              placeholder="Search users by name or email..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              style={{ flex: 1, padding: "10px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)", marginRight: "12px" }}
            />
            <button
              onClick={() => { setCreateName(""); setCreateEmail(""); setCreatePassword(""); setCreatePlan("free"); setIsCreateModalOpen(true); }}
              style={{ padding: "8px 16px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", fontSize: "13px", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              Create User
            </button>
          </div>

          {usersQuery.isPending && <p>Loading users...</p>}
          {usersQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load users: {String(usersQuery.error)}</p>}
          {usersQuery.data && (
            <div style={{ width: "100%", overflowX: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    {["User", "Pricing Plan", "Organizations", "Memories", "Joined", "Actions"].map((h, i) => (
                      <th key={h} style={{ padding: "12px 16px", color: "var(--text-muted)", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: i === 3 ? "center" : i === 5 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)", fontStyle: "italic" }}>
                        No users found matching search criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ fontWeight: "bold", fontSize: "14px" }}>{user.name}</div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{user.email}</div>
                          {user.id === adminStatus?.userId && (
                            <span style={{ fontSize: "9px", background: "rgba(168,85,247,0.15)", color: "var(--accent)", padding: "1px 6px", borderRadius: "10px", fontWeight: "bold", display: "inline-block", marginTop: "4px" }}>ADMIN</span>
                          )}
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span style={{
                            fontSize: "10px",
                            background: user.plan === "enterprise" ? "rgba(16,185,129,0.15)" : user.plan === "business" ? "rgba(168,85,247,0.15)" : "var(--surface2)",
                            color: user.plan === "enterprise" ? "#10b981" : user.plan === "business" ? "var(--accent)" : "var(--text-muted)",
                            padding: "2px 8px", borderRadius: "20px", fontWeight: "bold", textTransform: "uppercase",
                          }}>
                            {user.plan}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          {user.organizations.length === 0 ? (
                            <span style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" }}>None</span>
                          ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              {user.organizations.map((org) => (
                                <div key={org.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ fontSize: "11px", fontWeight: 600 }}>{org.name}</span>
                                  <span style={{
                                    fontSize: "9px",
                                    background: org.role === "owner" ? "rgba(239,68,68,0.1)" : org.role === "admin" ? "rgba(168,85,247,0.1)" : "var(--surface2)",
                                    color: org.role === "owner" ? "var(--error)" : org.role === "admin" ? "var(--accent)" : "var(--text-muted)",
                                    padding: "1px 4px", borderRadius: "4px", fontWeight: 600, textTransform: "uppercase",
                                  }}>
                                    {org.role}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: 600, color: "var(--accent)" }}>{user.memoryCount}</td>
                        <td style={{ padding: "14px 16px", fontSize: "12px", color: "var(--text-muted)" }}>{new Date(user.createdAt).toLocaleDateString()}</td>
                        <td style={{ padding: "14px 16px", textAlign: "right" }}>
                          <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <button onClick={() => { setSelectedUser(user); setEditName(user.name); setEditEmail(user.email); setEditEmailVerified(user.emailVerified); setIsEditModalOpen(true); }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Edit</button>
                            <button onClick={() => { setSelectedUser(user); setSelectedPlan(user.plan); setIsPlanModalOpen(true); }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Plan</button>
                            <button onClick={() => { setSelectedUser(user); setIsOrgsModalOpen(true); setAssignOrgId(""); setAssignRole("member"); }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Orgs</button>
                            <button onClick={() => { setSelectedUser(user); setPasswordValue(""); setIsPasswordModalOpen(true); }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600, cursor: "pointer" }}>Password</button>
                            <button onClick={() => { if (confirm(`Reset password for ${user.name}? A new random password will be generated.`)) resetUserPasswordMut.mutate(user.id); }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", cursor: "pointer" }}>Reset</button>
                            {user.id !== adminStatus?.userId && (
                              <button onClick={() => { if (confirm(`DELETE user ${user.name}? This will delete all their data permanently.`)) deleteUserMut.mutate(user.id); }}
                                style={{ padding: "4px 8px", background: "rgba(239,68,68,0.1)", color: "var(--error)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: "bold", cursor: "pointer" }}>Delete</button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </OrgAdminSection>
      )}

      {/* ── TEAMS ───────────────────────────────────────────────────────────── */}
      {activeSection === "teams" && (
        <OrgAdminSection title="Teams" description="Create teams within organizations and manage members" icon="👤">
          {orgTeamQuery.isPending && <p style={{ color: "var(--text-muted)" }}>Loading...</p>}
          {orgTeamQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load teams.</p>}

          {/* Create team — pick org first */}
          {allOrgs.length > 0 && (
            <AdminCard>
              <h4 style={{ margin: "0 0 12px 0", fontSize: 14, fontWeight: "bold" }}>Create New Team</h4>
              <div style={{ display: "flex", gap: 8 }}>
                <select value={selectedOrgKey || allOrgs[0]?.id} onChange={(e) => setSelectedOrgKey(e.target.value)}
                  style={{ padding: "7px 10px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }}>
                  {allOrgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
                <input type="text" placeholder="Team name" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)}
                  style={{ flex: 1, padding: "7px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: 13 }} />
                <button onClick={() => { const orgId = selectedOrgKey || allOrgs[0]?.id; if (orgId && newTeamName.trim()) createTeamMut.mutate({ orgId, name: newTeamName }); }}
                  disabled={createTeamMut.isPending || !newTeamName.trim()}
                  style={{ padding: "7px 16px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
                  {createTeamMut.isPending ? "Creating..." : "+ Create Team"}
                </button>
              </div>
            </AdminCard>
          )}

          {/* Team list — pick team to manage */}
          {allTeams.length === 0 && !orgTeamQuery.isPending && (
            <div style={{ textAlign: "center", padding: "40px", border: "1px dashed var(--border)", borderRadius: "var(--radius)", color: "var(--text-muted)" }}>
              No teams yet. Create one above.
            </div>
          )}

          {allTeams.length > 0 && (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                <select value={activeTeam?.id ?? allTeams[0]?.id} onChange={(e) => setSelectedTeamKey(e.target.value)}
                  style={{ flex: 1, padding: "8px 12px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontWeight: 600 }}>
                  {allTeams.map((t) => <option key={t.id} value={t.id}>{t.orgName} › {t.name}</option>)}
                </select>
              </div>

              {(() => {
                const team = activeTeam ?? allTeams[0];
                if (!team) return null;
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12 }}>
                      <div>
                        <div style={{ fontWeight: "bold", fontSize: 15 }}>{team.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{team.orgName} · {team.members.length} members · Role: <strong>{team.role}</strong></div>
                      </div>
                      {team.role !== "member" && (
                        <button onClick={() => { if (confirm(`Delete team "${team.name}"?`)) deleteTeamMut.mutate(team.id); }} disabled={deleteTeamMut.isPending}
                          style={{ padding: "5px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", fontSize: 12, cursor: "pointer", borderRadius: "var(--radius)" }}>
                          Delete Team
                        </button>
                      )}
                    </div>

                    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: "bold" }}>Members</h4>
                      {team.role !== "member" && (
                        <InviteForm label="Add Member by Email" email={teamInviteEmail} setEmail={setTeamInviteEmail} role={teamInviteRole} setRole={setTeamInviteRole} roles={["member", "admin"]}
                          onSubmit={() => addTeamMemberMut.mutate({ teamId: team.id, email: teamInviteEmail, role: teamInviteRole })} loading={addTeamMemberMut.isPending} />
                      )}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {team.members.map((m: any) => (
                          <MemberRow key={m.userId} member={m} roles={["member", "admin"]}
                            onUpdateRole={(uid, role) => updateTeamRoleMut.mutate({ teamId: team.id, userId: uid, role })}
                            onRemove={(uid) => removeTeamMemberMut.mutate({ teamId: team.id, userId: uid })}
                            isUpdating={updateTeamRoleMut.isPending} isRemoving={removeTeamMemberMut.isPending} currentUserRole={team.role} />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </OrgAdminSection>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════════ */}

      {/* Create User */}
      {isCreateModalOpen && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "bold" }}>Create New User</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {[
                { label: "Full Name", type: "text", value: createName, setter: setCreateName, placeholder: "e.g. John Doe" },
                { label: "Email Address", type: "email", value: createEmail, setter: setCreateEmail, placeholder: "e.g. john@example.com" },
                { label: "Initial Password (Optional)", type: "password", value: createPassword, setter: setCreatePassword, placeholder: "Leave blank for passwordless OAuth" },
              ].map(({ label, type, value, setter, placeholder }) => (
                <div key={label}>
                  <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>{label}</label>
                  <input type={type} value={value} onChange={(e) => setter(e.target.value)} placeholder={placeholder} style={{ width: "100%", padding: "8px 12px" }} />
                </div>
              ))}
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Personal Pricing Plan</label>
                <select value={createPlan} onChange={(e) => setCreatePlan(e.target.value)} style={{ width: "100%", padding: "8px 12px" }}>
                  <option value="free">Free (Personal)</option>
                  <option value="business">Business</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setIsCreateModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button onClick={() => { if (!createName || !createEmail) { alert("Name and email are required."); return; } createUserMut.mutate({ name: createName, email: createEmail, password: createPassword || undefined, plan: createPlan }); }}
                disabled={createUserMut.isPending} style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>
                {createUserMut.isPending ? "Creating..." : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User */}
      {isEditModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={modalBox}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "bold" }}>Edit User</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Full Name</label>
                <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} style={{ width: "100%", padding: "8px 12px" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Email Address</label>
                <input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} style={{ width: "100%", padding: "8px 12px" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                <input type="checkbox" id="edit-email-verified" checked={editEmailVerified} onChange={(e) => setEditEmailVerified(e.target.checked)} style={{ width: "auto" }} />
                <label htmlFor="edit-email-verified" style={{ fontSize: "13px", fontWeight: 500 }}>Email Verified</label>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setIsEditModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button onClick={() => { if (!editName || !editEmail) { alert("Name and email are required."); return; } updateUserMut.mutate({ userId: selectedUser.id, name: editName, email: editEmail, emailVerified: editEmailVerified }); }}
                disabled={updateUserMut.isPending} style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>
                {updateUserMut.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Plan */}
      {isPlanModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={{ ...modalBox, maxWidth: "400px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Change Plan</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>Assign pricing plan for <strong>{selectedUser.name}</strong>.</p>
            <div>
              <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Plan</label>
              <select value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value)} style={{ width: "100%", padding: "8px 12px" }}>
                <option value="free">Free (Personal)</option>
                <option value="business">Business</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setIsPlanModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button onClick={() => updateUserPlanMut.mutate({ userId: selectedUser.id, plan: selectedPlan })} disabled={updateUserPlanMut.isPending}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>
                {updateUserPlanMut.isPending ? "Updating..." : "Update Plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Password */}
      {isPasswordModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={{ ...modalBox, maxWidth: "400px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Set Password</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>Set a manual password for <strong>{selectedUser.name}</strong>.</p>
            <div>
              <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>New Password</label>
              <input type="password" value={passwordValue} onChange={(e) => setPasswordValue(e.target.value)} placeholder="At least 8 characters" style={{ width: "100%", padding: "8px 12px" }} />
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setIsPasswordModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button onClick={() => { if (passwordValue.length < 8) { alert("Password must be at least 8 characters."); return; } setUserPasswordMut.mutate({ userId: selectedUser.id, password: passwordValue }); }}
                disabled={setUserPasswordMut.isPending} style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>
                {setUserPasswordMut.isPending ? "Setting..." : "Set Password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Success */}
      {isResetSuccessModalOpen && (
        <div style={{ ...modalOverlay, zIndex: 1010 }}>
          <div style={modalBox}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: "bold", color: "var(--success)" }}>Password Reset Success</h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>A new temporary password has been generated:</p>
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", padding: "12px 16px", borderRadius: "8px", fontFamily: "monospace", fontSize: "18px", textAlign: "center", color: "var(--text)", letterSpacing: "0.08em", fontWeight: "bold", marginBottom: "20px" }}>
              {generatedPassword}
            </div>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button onClick={() => { navigator.clipboard.writeText(generatedPassword); alert("Copied to clipboard!"); }}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", fontWeight: 600 }}>Copy Password</button>
              <button onClick={() => { setIsResetSuccessModalOpen(false); setGeneratedPassword(""); }}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}>Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Organizations */}
      {isOrgsModalOpen && selectedUser && (
        <div style={modalOverlay}>
          <div style={{ ...modalBox, maxWidth: "500px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Manage Organizations</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>Organization memberships for <strong>{selectedUser.name}</strong>.</p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "200px", overflowY: "auto", marginBottom: "20px", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px", background: "var(--surface2)" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase" }}>Current Memberships</span>
              {selectedUser.organizations.length === 0 ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>Not a member of any organization.</span>
              ) : (
                selectedUser.organizations.map((org) => (
                  <div key={org.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px" }}>
                    <div>
                      <div style={{ fontWeight: "bold", fontSize: "13px" }}>{org.name}</div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>ID: {org.id}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <select value={org.role} onChange={(e) => {
                        assignUserToOrgMut.mutate({ userId: selectedUser.id, orgId: org.id, role: e.target.value as "owner" | "admin" | "member" });
                        setSelectedUser({ ...selectedUser, organizations: selectedUser.organizations.map(o => o.id === org.id ? { ...o, role: e.target.value } : o) });
                      }} style={{ padding: "3px 6px", fontSize: "11px", borderRadius: "4px" }}>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button onClick={() => { if (confirm(`Remove ${selectedUser.name} from ${org.name}?`)) { removeUserFromOrgMut.mutate({ userId: selectedUser.id, orgId: org.id }); setSelectedUser({ ...selectedUser, organizations: selectedUser.organizations.filter(o => o.id !== org.id) }); } }}
                        style={{ padding: "4px 8px", background: "transparent", color: "var(--error)", fontSize: "11px", fontWeight: "bold", cursor: "pointer" }}>Remove</button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
              <span style={{ display: "block", fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>Add to Organization</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <select value={assignOrgId} onChange={(e) => setAssignOrgId(e.target.value)} style={{ flex: 1, padding: "8px 12px" }}>
                  <option value="">Select organization...</option>
                  {(orgsQuery.data || []).filter((org) => !selectedUser.organizations.some((o) => o.id === org.id)).map((org) => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
                <select value={assignRole} onChange={(e) => setAssignRole(e.target.value as "owner" | "admin" | "member")} style={{ padding: "8px 12px" }}>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
                <button onClick={() => { if (!assignOrgId) return; assignUserToOrgMut.mutate({ userId: selectedUser.id, orgId: assignOrgId, role: assignRole }); const matchedName = (orgsQuery.data || []).find(o => o.id === assignOrgId)?.name || "New Organization"; setSelectedUser({ ...selectedUser, organizations: [...selectedUser.organizations, { id: assignOrgId, name: matchedName, role: assignRole }] }); setAssignOrgId(""); }}
                  disabled={!assignOrgId || assignUserToOrgMut.isPending}
                  style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold", cursor: "pointer" }}>Add</button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "24px" }}>
              <button onClick={() => setIsOrgsModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SITE AUDIT LOGS (site admin only) ──────────────────────────────── */}
      {activeSection === "site-audit-logs" && <SiteAuditLogsSection />}

    </AdminLayout>
  );
}



// ── Site Configuration Section ────────────────────────────────────────────────
function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      style={{
        position: "relative",
        width: 44,
        height: 24,
        borderRadius: 12,
        background: checked ? "var(--accent)" : "rgba(148,163,184,0.25)",
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        padding: 0,
        transition: "background 0.2s ease",
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 23 : 3,
          width: 18,
          height: 18,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
          transition: "left 0.2s ease",
          display: "block",
        }}
      />
    </button>
  );
}

function SiteConfigSection() {
  const { data: settings, isLoading, refetch } = useQuery<SystemSettingsData>({
    queryKey: ["site-settings"],
    queryFn: () => getSystemSettings(),
  });

  const saveMutation = useMutation({
    mutationFn: async (update: { key: string; value: string }) => {
      await updateSystemSetting({ data: update });
    },
    onSuccess: () => { refetch(); },
  });

  const [lastSaved, setLastSaved] = useState<string | null>(null);

  async function toggle(settingKey: string, current: boolean) {
    await saveMutation.mutateAsync({ key: settingKey, value: (!current).toString() });
    setLastSaved(settingKey);
    setTimeout(() => setLastSaved(null), 2000);
  }

  const settingRows: Array<{
    dataKey: keyof SystemSettingsData;
    settingKey: string;
    label: string;
    desc: string;
    icon: string;
  }> = [
    {
      dataKey: "enableSignups",
      settingKey: "enable_signups",
      label: "User Signups",
      desc: "Allow new users to create accounts. Disable during development to prevent unintended registrations. The demo account remains accessible regardless.",
      icon: "👤",
    },
    {
      dataKey: "enableBusinessPlans",
      settingKey: "enable_business_plans",
      label: "Business Plan Upgrades",
      desc: "Allow users to access Business plan features and org-level functionality. When disabled, all Business-tier accounts are effectively downgraded to Free.",
      icon: "🏢",
    },
    {
      dataKey: "enableEnterprisePlans",
      settingKey: "enable_enterprise_plans",
      label: "Enterprise Plan Upgrades",
      desc: "Allow users to access Enterprise plan features. When disabled, Enterprise accounts fall back to Business (or Free if Business is also disabled).",
      icon: "🏗️",
    },
  ];

  return (
    <SiteAdminSection title="Site Configuration" description="Control global access, feature flags, and plan availability" icon="🔧">
      {isLoading ? (
        <AdminCard>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>Loading site settings…</p>
        </AdminCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{
            padding: "12px 16px",
            background: "rgba(168,85,247,0.06)",
            border: "1px solid rgba(168,85,247,0.2)",
            borderRadius: 10,
            fontSize: 12,
            color: "var(--text-muted)",
            lineHeight: 1.6,
          }}>
            <strong style={{ color: "var(--accent)" }}>Development Mode Controls</strong> — Changes take effect immediately sitewide without a restart.
          </div>
          {settingRows.map((row) => {
            const value = settings?.[row.dataKey] ?? false;
            const justSaved = lastSaved === row.settingKey;

            return (
              <AdminCard key={row.dataKey}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: value ? "rgba(168,85,247,0.12)" : "rgba(148,163,184,0.08)",
                    border: `1px solid ${value ? "rgba(168,85,247,0.25)" : "var(--border)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, flexShrink: 0, transition: "background 0.2s, border-color 0.2s",
                  }}>
                    {row.icon}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{row.label}</span>
                        <span style={{
                          padding: "1px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
                          background: value ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)",
                          border: `1px solid ${value ? "rgba(52,211,153,0.25)" : "rgba(239,68,68,0.2)"}`,
                          color: value ? "#34d399" : "#f87171",
                        }}>
                          {value ? "ENABLED" : "DISABLED"}
                        </span>
                      </div>
                      <ToggleSwitch
                        checked={value}
                        onChange={() => toggle(row.settingKey, value)}
                        disabled={saveMutation.isPending}
                      />
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>{row.desc}</p>
                    {justSaved && (
                      <p style={{ fontSize: 11, color: "#34d399", margin: "6px 0 0", display: "flex", alignItems: "center", gap: 4 }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        Saved successfully
                      </p>
                    )}
                  </div>
                </div>
              </AdminCard>
            );
          })}
        </div>
      )}
    </SiteAdminSection>
  );
}

export function AdminGuard() {

  const { data: adminStatus, isLoading } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });

  if (isLoading) return <p style={{ padding: 32, color: "var(--text-muted)" }}>Loading…</p>;

  return <AdminPage />;
}

