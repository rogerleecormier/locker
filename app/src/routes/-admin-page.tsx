import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useToast } from "~/components/ui/toast";
import { planHasFeature, type PlanId } from "~/lib/plans";
import { AdminLayout, type AdminSection } from "~/components/AdminLayout";
import { SiteAdminSection, OrgAdminSection, StatBox, AdminCard } from "~/components/AdminSections";
import { SystemOverviewSection } from "~/components/AdminSystemOverview";
import { UserManagementSection } from "~/components/AdminUserManagement";
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
  getPersonalWebhookEvents,
  getOrgWebhookEvents,
  getSiteWebhookEvents,
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
  type AgentActivityResult,
  type DuplicateGroup,
} from "~/server/memoryFunctions";
import { MyUsageSection, MyBillingSection, OrgBillingSection, useBillingData } from "~/routes/billing";
import { ProfileSection, ApiTokensSection, McpEndpointSection, TwoFactorSection, PasscodeSection, SessionsSection, WebhookSecretsSection } from "~/routes/-_settings-components";
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

// ── Shared view mode tabs ────────────────────────────────────────────────────

type ActivityView = "timeline" | "table";

function ViewTabs({ view, onChange }: { view: ActivityView; onChange: (v: ActivityView) => void }) {
  return (
    <div className="flex items-center gap-1 bg-surface2 border border-border rounded-lg p-0.5 self-start">
      {(["timeline", "table"] as ActivityView[]).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
            view === v
              ? "bg-accent text-white shadow-sm"
              : "text-text-muted hover:text-text"
          }`}
        >
          {v === "timeline" ? "⬡ Timeline" : "≡ Table"}
        </button>
      ))}
    </div>
  );
}

// ── Shared stat strip ─────────────────────────────────────────────────────────

function ActivityStatStrip({ stats }: { stats: { totalRecalls: number; totalCommits: number; totalUpdates: number; totalDeletes: number; abacDenials: number; avgSemanticScore: number | null; topTools: Array<{ tool: string; count: number }> } }) {
  const total = stats.totalRecalls + stats.totalCommits + stats.totalUpdates + stats.totalDeletes;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {[
        { label: "Recalls", value: stats.totalRecalls, color: "text-blue-400" },
        { label: "Commits", value: stats.totalCommits, color: "text-emerald-400" },
        { label: "Updates", value: stats.totalUpdates, color: "text-amber-400" },
        { label: "Deletes", value: stats.totalDeletes, color: "text-red-400" },
        { label: "ABAC Denials", value: stats.abacDenials, color: "text-red-400" },
        { label: "Avg Score", value: stats.avgSemanticScore !== null ? stats.avgSemanticScore.toFixed(3) : "—", color: "text-text" },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-surface2 border border-border rounded-lg px-3 py-2.5 flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-text-muted select-none">{label}</span>
          <span className={`text-lg font-bold tabular-nums ${color}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── Tool distribution bar ─────────────────────────────────────────────────────

const TOOL_DOT_COLORS: Record<string, string> = {
  "Cursor": "bg-blue-400",
  "Claude Code": "bg-violet-400",
  "Claude Desktop": "bg-violet-300",
  "GitHub Copilot": "bg-emerald-400",
  "VS Code": "bg-sky-400",
  "JetBrains": "bg-orange-400",
  "Windsurf": "bg-teal-400",
  "Zed": "bg-pink-400",
  "Cline": "bg-cyan-400",
  "Continue": "bg-lime-400",
};
function toolDotClass(tool: string) { return TOOL_DOT_COLORS[tool] ?? "bg-slate-400"; }

function ToolDistributionBar({ tools }: { tools: Array<{ tool: string; count: number }> }) {
  const total = tools.reduce((s, t) => s + t.count, 0);
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 rounded-full overflow-hidden gap-px">
        {tools.map(({ tool, count }) => (
          <div key={tool} className={toolDotClass(tool)} style={{ width: `${(count / total) * 100}%` }} title={`${tool}: ${count}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {tools.map(({ tool, count }) => (
          <div key={tool} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${toolDotClass(tool)}`} />
            <span className="text-[11px] text-text-muted">{tool}</span>
            <span className="text-[11px] font-semibold text-text tabular-nums">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Score bar ─────────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-text-muted text-xs">—</span>;
  const pct = Math.min(100, score * 100);
  const color = pct >= 75 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : pct >= 25 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-12 h-1.5 rounded-full bg-surface2 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-text-muted tabular-nums">{score.toFixed(3)}</span>
    </div>
  );
}

// ── Activity event row (timeline card) ────────────────────────────────────────

const ACTIVITY_ACTION_COLORS: Record<string, string> = {
  recall_context: "border-blue-500/40 bg-blue-500/10 text-blue-400",
  recall_context_abac_denied: "border-red-500/40 bg-red-500/10 text-red-400",
  commit_memory: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  update_memory: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  delete_memory: "border-red-500/40 bg-red-500/10 text-red-400",
  search_memories: "border-indigo-500/40 bg-indigo-500/10 text-indigo-400",
  get_memory_summary: "border-cyan-500/40 bg-cyan-500/10 text-cyan-400",
  export_memories: "border-purple-500/40 bg-purple-500/10 text-purple-400",
  list_accessible_scopes: "border-teal-500/40 bg-teal-500/10 text-teal-400",
  jit_access_requested: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  jit_access_approved: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  jit_access_denied: "border-red-500/40 bg-red-500/10 text-red-400",
  store_credential: "border-orange-500/40 bg-orange-500/10 text-orange-400",
  retrieve_credential: "border-orange-500/40 bg-orange-500/10 text-orange-400",
};

function formatRelTs(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ActivityTimelineRow({ entry, showUser = false }: { entry: AgentActivityEntry & { userName?: string | null; userEmail?: string | null; orgName?: string | null }; showUser?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const actionCls = ACTIVITY_ACTION_COLORS[entry.action] ?? "border-border bg-surface2 text-text-muted";

  return (
    <div
      className={`relative border border-border rounded-lg bg-surface transition-shadow cursor-pointer hover:border-accent/30 hover:shadow-sm ${expanded ? "border-accent/30 shadow-sm" : ""}`}
      onClick={() => setExpanded((p) => !p)}
    >
      <div className={`absolute -left-[22px] top-4 w-3 h-3 rounded-full border-2 border-surface ${toolDotClass(entry.toolName ?? "")}`} />

      <div className="px-4 py-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Action badge */}
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider select-none ${actionCls}`}>
              {getActionMeta(entry.action).icon} {entry.actionLabel}
            </span>
            {/* Tool pill */}
            {entry.toolName && (
              <div className="flex items-center gap-1.5 bg-surface2 border border-border rounded-full px-2.5 py-0.5">
                <div className={`w-1.5 h-1.5 rounded-full ${toolDotClass(entry.toolName)}`} />
                <span className="text-[11px] font-medium text-text select-none">{entry.toolName}</span>
              </div>
            )}
            {/* Token */}
            {entry.tokenName && (
              <span className="text-[11px] text-text-muted">
                via <span className="font-medium text-accent">{entry.tokenName}</span>
              </span>
            )}
            {/* User (for multi-user views) */}
            {showUser && (entry as any).userName && (
              <span className="text-[11px] text-text-muted">
                — <span className="font-medium text-text">{(entry as any).userName}</span>
                {(entry as any).userEmail && <span className="ml-1">{(entry as any).userEmail}</span>}
              </span>
            )}
            {showUser && (entry as any).orgName && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                🏢 {(entry as any).orgName}
              </span>
            )}
            {entry.isAbacDenied && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 text-red-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider select-none">
                ⊘ ABAC
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {entry.matchCount !== null && (
              <span className="text-[11px] text-text-muted tabular-nums">{entry.matchCount} match{entry.matchCount !== 1 ? "es" : ""}</span>
            )}
            <span className="text-[11px] text-text-muted tabular-nums">{formatRelTs(entry.timestamp)}</span>
            <svg className={`w-3.5 h-3.5 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        {entry.query && (
          <p className="mt-1.5 text-xs text-text-muted line-clamp-1">
            <span className="font-mono text-accent/70">query:</span>{" "}
            <span className="text-text">{entry.query}</span>
          </p>
        )}

        {(entry.semanticScore !== null || entry.rrfScore !== null) && (
          <div className="mt-1.5 flex items-center gap-4">
            {entry.semanticScore !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted uppercase tracking-wide">Vector</span>
                <ScoreBar score={entry.semanticScore} />
              </div>
            )}
            {entry.rrfScore !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted uppercase tracking-wide">RRF</span>
                <ScoreBar score={entry.rrfScore} />
              </div>
            )}
          </div>
        )}
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-4 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
          {/* Query filters */}
          <section>
            <h4 className="text-[11px] uppercase tracking-widest text-text-muted font-semibold mb-2 select-none">Query Filters Applied</h4>
            <div className="flex flex-wrap gap-2">
              {entry.query && <FilterTag label="query" value={entry.query} />}
              {entry.topK !== null && <FilterTag label="topK" value={String(entry.topK)} />}
              {entry.filterCategory && <FilterTag label="category" value={entry.filterCategory} />}
              {entry.filterTag && <FilterTag label="tag" value={entry.filterTag} />}
              {entry.filterProjectKey && <FilterTag label="projectKey" value={entry.filterProjectKey} />}
              {entry.optimize !== null && <FilterTag label="optimize" value={String(entry.optimize)} />}
              {!entry.query && !entry.filterCategory && !entry.filterTag && (
                <span className="text-xs text-text-muted italic">No explicit filters recorded</span>
              )}
            </div>
          </section>

          {/* Confidence metrics */}
          {(entry.semanticScore !== null || entry.rrfScore !== null || entry.matchCount !== null) && (
            <section>
              <h4 className="text-[11px] uppercase tracking-widest text-text-muted font-semibold mb-2 select-none">Confidence &amp; Matching Metrics</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {entry.matchCount !== null && <MetricCell label="Results" value={String(entry.matchCount)} />}
                {entry.topK !== null && <MetricCell label="topK" value={String(entry.topK)} />}
                {entry.semanticScore !== null && <MetricCell label="Vector score" value={entry.semanticScore.toFixed(4)} bar={<ScoreBar score={entry.semanticScore} />} />}
                {entry.rrfScore !== null && <MetricCell label="RRF score" value={entry.rrfScore.toFixed(4)} bar={<ScoreBar score={entry.rrfScore} />} />}
              </div>
            </section>
          )}

          {/* Injected facts */}
          {entry.injectedFacts.length > 0 && (
            <section>
              <h4 className="text-[11px] uppercase tracking-widest text-text-muted font-semibold mb-2 select-none">
                Facts Injected into Context ({entry.injectedFacts.length})
              </h4>
              <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                {entry.injectedFacts.map((f, i) => (
                  <div key={f.id || i} className="flex items-start gap-2">
                    <span className="text-[10px] font-mono text-text-muted mt-0.5 tabular-nums w-5 text-right flex-shrink-0">{i + 1}.</span>
                    <div className="flex-1 bg-surface2 border border-border rounded-md px-2.5 py-1.5">
                      <div className="flex items-center gap-2 mb-1">
                        {f.category && <span className="text-[9px] font-bold uppercase tracking-wide text-accent bg-accent-dim rounded px-1.5 py-0.5">{f.category}</span>}
                        {f.tags && <span className="text-[9px] text-text-muted">{f.tags}</span>}
                        {f.score !== null && (
                          <span className={`text-[9px] font-bold ml-auto ${f.score >= 0.8 ? "text-emerald-400" : f.score >= 0.6 ? "text-amber-400" : "text-red-400"}`}>
                            {Math.round(f.score * 100)}%
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-text leading-relaxed font-mono whitespace-pre-wrap break-words">
                        {f.fact || <span className="text-text-muted italic">encrypted</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Memory reference */}
          {entry.memoryId && (
            <section>
              <h4 className="text-[11px] uppercase tracking-widest text-text-muted font-semibold mb-2 select-none">Affected Memory</h4>
              <div className="flex flex-col gap-0.5">
                {entry.memoryFact ? (
                  <p className="text-xs text-text leading-relaxed">{entry.memoryFact}</p>
                ) : (
                  <span className="text-xs text-text-muted italic">Memory no longer available</span>
                )}
                <span className="text-[10px] font-mono text-text-muted">{entry.memoryId}</span>
              </div>
            </section>
          )}

          {/* Provenance */}
          <section>
            <h4 className="text-[11px] uppercase tracking-widest text-text-muted font-semibold mb-2 select-none">Request Provenance</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {entry.toolName && <ProvenanceKV label="Tool" value={entry.toolName} />}
              {entry.tokenName && <ProvenanceKV label="Token" value={entry.tokenName} />}
              {entry.tokenId && <ProvenanceKV label="Token ID" value={entry.tokenId} mono truncate />}
              {entry.ipAddress && <ProvenanceKV label="IP" value={entry.ipAddress} mono />}
              {entry.userAgent && <ProvenanceKV label="User-Agent" value={entry.userAgent} mono truncate />}
              <ProvenanceKV label="Timestamp" value={new Date(entry.timestamp).toISOString()} mono />
            </div>
          </section>

          {/* Raw metadata */}
          {entry.rawMetadata && Object.keys(entry.rawMetadata).length > 0 && (
            <details className="group">
              <summary className="text-[11px] uppercase tracking-widest text-text-muted font-semibold cursor-pointer select-none hover:text-text transition-colors">
                Raw Metadata <span className="group-open:hidden">▸</span><span className="hidden group-open:inline">▾</span>
              </summary>
              <pre className="mt-2 text-[11px] font-mono text-text-muted bg-surface2 border border-border rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(entry.rawMetadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function FilterTag({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-md border border-border bg-surface2 px-2 py-1">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className="text-[11px] font-mono font-medium text-text truncate max-w-[180px]" title={value}>{value}</span>
    </div>
  );
}

function MetricCell({ label, value, bar }: { label: string; value: string; bar?: React.ReactNode }) {
  return (
    <div className="bg-surface2 border border-border rounded-md px-2.5 py-2 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wide text-text-muted select-none">{label}</span>
      {bar ?? <span className="text-sm font-mono font-semibold text-text">{value}</span>}
    </div>
  );
}

function ProvenanceKV({ label, value, mono, truncate }: { label: string; value: string; mono?: boolean; truncate?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      <span className={`text-xs text-text ${mono ? "font-mono" : ""} ${truncate ? "truncate" : ""}`} title={value}>{value}</span>
    </div>
  );
}

// ── Table view row ────────────────────────────────────────────────────────────

function ActivityTableRow({ entry, showUser = false }: { entry: AgentActivityEntry & { userName?: string | null; userEmail?: string | null; orgName?: string | null }; showUser?: boolean }) {
  const actionCls = ACTIVITY_ACTION_COLORS[entry.action] ?? "border-border bg-surface2 text-text-muted";
  return (
    <tr className="border-b border-border hover:bg-surface2/50 transition-colors">
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${actionCls}`}>
          {getActionMeta(entry.action).icon} {entry.actionLabel}
        </span>
      </td>
      {showUser && (
        <td className="px-3 py-2.5">
          <div className="text-xs font-medium text-text">{(entry as any).userName ?? "—"}</div>
          {(entry as any).userEmail && <div className="text-[10px] text-text-muted">{(entry as any).userEmail}</div>}
          {(entry as any).orgName && <div className="text-[10px] text-emerald-400">{(entry as any).orgName}</div>}
        </td>
      )}
      <td className="px-3 py-2.5">
        {entry.toolName ? (
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${toolDotClass(entry.toolName)}`} />
            <span className="text-xs text-text">{entry.toolName}</span>
          </div>
        ) : <span className="text-text-muted text-xs">—</span>}
      </td>
      <td className="px-3 py-2.5 max-w-[200px]">
        {entry.query ? (
          <span className="text-xs text-text truncate block" title={entry.query}>{entry.query}</span>
        ) : <span className="text-text-muted text-xs">—</span>}
      </td>
      <td className="px-3 py-2.5">
        <ScoreBar score={entry.semanticScore} />
      </td>
      <td className="px-3 py-2.5 text-center">
        <span className="text-xs text-text-muted tabular-nums">{entry.matchCount ?? "—"}</span>
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">
        <span className="text-xs text-text-muted tabular-nums">{formatRelTs(entry.timestamp)}</span>
      </td>
    </tr>
  );
}

// ── Common activity filter bar ────────────────────────────────────────────────

const QUICK_ACTION_FILTERS = [
  { value: "", label: "All" },
  { value: "recall_context", label: "Recall" },
  { value: "commit_memory", label: "Commit" },
  { value: "update_memory", label: "Update" },
  { value: "delete_memory", label: "Delete" },
  { value: "search_memories", label: "Search" },
  { value: "jit_access_requested", label: "JIT" },
];

function ActivityFilterBar({
  search, onSearchChange,
  actionFilter, onActionChange,
  startDate, onStartDateChange,
  endDate, onEndDateChange,
  extra,
}: {
  search: string; onSearchChange: (v: string) => void;
  actionFilter: string; onActionChange: (v: string) => void;
  startDate: string; onStartDateChange: (v: string) => void;
  endDate: string; onEndDateChange: (v: string) => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <input
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Search queries, facts, tools…"
        className="h-8 px-3 text-sm bg-surface border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 w-52"
      />
      <select
        value={actionFilter}
        onChange={(e) => onActionChange(e.target.value)}
        className="h-8 px-2 text-sm bg-surface border border-border rounded-md text-text focus:outline-none focus:border-accent/50"
      >
        <option value="">All actions</option>
        {ALL_ACTIONS.map((a) => <option key={a} value={a}>{getActionMeta(a).icon} {getActionMeta(a).label}</option>)}
      </select>
      <input type="date" value={startDate} onChange={(e) => onStartDateChange(e.target.value)}
        className="h-8 px-2 text-sm bg-surface border border-border rounded-md text-text focus:outline-none focus:border-accent/50 w-36" />
      <input type="date" value={endDate} onChange={(e) => onEndDateChange(e.target.value)}
        className="h-8 px-2 text-sm bg-surface border border-border rounded-md text-text focus:outline-none focus:border-accent/50 w-36" />
      {/* Quick-filter pills */}
      <div className="flex gap-1 flex-wrap">
        {QUICK_ACTION_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onActionChange(value)}
            className={`px-2.5 py-1 text-[11px] rounded-full border transition-colors ${
              actionFilter === value
                ? "bg-accent-dim border-accent text-accent font-semibold"
                : "border-border text-text-muted hover:text-text bg-surface"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {extra}
    </div>
  );
}

// ── Pagination bar ─────────────────────────────────────────────────────────────

function PaginationBar({ page, total, pageSize, isFetching, onPage }: { page: number; total: number; pageSize: number; isFetching: boolean; onPage: (p: number) => void }) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-border pt-3 mt-2">
      <span className="text-xs text-text-muted tabular-nums">
        {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
        {isFetching && <span className="ml-2 text-accent animate-pulse">↻</span>}
      </span>
      <div className="flex gap-2">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1}
          className="px-3 py-1 text-xs border border-border rounded-md text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed bg-surface">
          ← Prev
        </button>
        <button onClick={() => onPage(page + 1)} disabled={page >= totalPages}
          className="px-3 py-1 text-xs border border-border rounded-md text-text-muted hover:text-text disabled:opacity-40 disabled:cursor-not-allowed bg-surface">
          Next →
        </button>
      </div>
    </div>
  );
}

// ── Unified Activity Section ──────────────────────────────────────────────────
// Single component handling personal / org / site scopes with identical layout.

function computeStatsFromLogs(logs: AgentActivityEntry[]): AgentActivityResult["stats"] {
  const toolCounts: Record<string, number> = {};
  const factCounts: Record<string, number> = {};
  let totalRecalls = 0, totalCommits = 0, totalUpdates = 0, totalDeletes = 0, abacDenials = 0;
  let scoreSum = 0, scoreCount = 0;

  for (const e of logs) {
    if (e.action === "recall_context") totalRecalls++;
    else if (e.action === "commit_memory") totalCommits++;
    else if (e.action === "update_memory") totalUpdates++;
    else if (e.action === "delete_memory") totalDeletes++;
    if (e.isAbacDenied) abacDenials++;
    if (e.semanticScore !== null) { scoreSum += e.semanticScore; scoreCount++; }
    if (e.toolName) toolCounts[e.toolName] = (toolCounts[e.toolName] ?? 0) + 1;
    for (const f of e.injectedFacts ?? []) {
      if (f.fact) factCounts[f.fact] = (factCounts[f.fact] ?? 0) + 1;
    }
  }

  const topTools = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tool, count]) => ({ tool, count }));

  const topInjectedFacts = Object.entries(factCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([fact, frequency]) => ({ fact, frequency }));

  return {
    totalRecalls, totalCommits, totalUpdates, totalDeletes, abacDenials,
    avgSemanticScore: scoreCount > 0 ? scoreSum / scoreCount : null,
    topTools,
    topActions: [],
    topInjectedFacts,
  };
}

function UnifiedActivitySection({ scope, orgId }: { scope: "personal" | "org" | "site"; orgId?: string }) {
  const [view, setView] = useState<ActivityView>("timeline");
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [exporting, setExporting] = useState(false);
  const [activityType, setActivityType] = useState<"memory" | "webhooks">("memory");
  const [webhookSourceFilter, setWebhookSourceFilter] = useState<"" | "github" | "linear">("");
  const PAGE_SIZE = 50;
  const offset = (page - 1) * PAGE_SIZE;

  const showUser = scope === "org" || scope === "site";
  const showOrgFilter = scope === "site";

  // Webhook queries — each scope has its own server fn
  const personalWebhooksQuery = useQuery({
    queryKey: ["personal-webhook-events"],
    queryFn: () => getPersonalWebhookEvents({ data: { limit: 50 } }),
    enabled: scope === "personal" && activityType === "webhooks",
  });

  const orgWebhooksQuery = useQuery({
    queryKey: ["org-webhook-events", orgId],
    queryFn: () => getOrgWebhookEvents({ data: { orgId: orgId!, limit: 50 } }),
    enabled: scope === "org" && activityType === "webhooks" && !!orgId,
  });

  const siteWebhooksQuery = useQuery({
    queryKey: ["site-webhook-events", webhookSourceFilter, orgFilter],
    queryFn: () => getSiteWebhookEvents({ data: {
      limit: 50,
      orgId: orgFilter || undefined,
      source: webhookSourceFilter || undefined,
    }}),
    enabled: scope === "site" && activityType === "webhooks",
  });

  const webhookEvents: Array<{ id: string; source: string; eventType: string; rawTitle: string | null; processedAt: number; memoryId: string | null; externalId: string; userName: string | null }> =
    scope === "personal" ? (personalWebhooksQuery.data?.events ?? [])
    : scope === "org" ? (orgWebhooksQuery.data?.events ?? [])
    : (siteWebhooksQuery.data?.events ?? []);

  const webhooksLoading =
    scope === "personal" ? personalWebhooksQuery.isLoading
    : scope === "org" ? orgWebhooksQuery.isLoading
    : siteWebhooksQuery.isLoading;

  // Personal scope: getAgentActivityLogs (returns AgentActivityResult with stats)
  const personalQuery = useQuery({
    queryKey: ["agent-activity", PAGE_SIZE, page, actionFilter, search, startDate, endDate],
    queryFn: (): Promise<AgentActivityResult> =>
      getAgentActivityLogs({ data: {
        pageSize: PAGE_SIZE, page,
        action: actionFilter || undefined,
        search: search || undefined,
        startDate: startDate ? new Date(startDate).getTime() : undefined,
        endDate: endDate ? new Date(endDate + "T23:59:59").getTime() : undefined,
      }}) as Promise<AgentActivityResult>,
    enabled: scope === "personal",
    staleTime: 15_000,
    refetchInterval: scope === "personal" ? 30_000 : false,
  });

  // Org scope
  const orgQuery = useQuery({
    queryKey: ["audit-logs", PAGE_SIZE, offset, actionFilter, search, startDate, endDate],
    queryFn: () => getOrgAuditLogs({ data: {
      limit: PAGE_SIZE, offset,
      action: actionFilter || undefined,
      search: search || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }}),
    enabled: scope === "org",
  });

  // Site scope
  const siteQuery = useQuery({
    queryKey: ["site-audit-logs", PAGE_SIZE, offset, actionFilter, search, startDate, endDate, userFilter, orgFilter],
    queryFn: () => getSiteAuditLogs({ data: {
      limit: PAGE_SIZE, offset,
      action: actionFilter || undefined,
      search: search || undefined,
      userId: userFilter || undefined,
      orgId: orgFilter || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }}),
    enabled: scope === "site",
  });

  // Unified data extraction
  let entries: AgentActivityEntry[] = [];
  let total = 0;
  let stats: AgentActivityResult["stats"] | undefined;
  let isLoading = false, isError = false, isFetching = false;

  if (scope === "personal") {
    entries = personalQuery.data?.entries ?? [];
    total = personalQuery.data?.total ?? 0;
    stats = personalQuery.data?.stats;
    isLoading = personalQuery.isLoading;
    isError = personalQuery.isError;
    isFetching = personalQuery.isFetching;
  } else if (scope === "org") {
    entries = (orgQuery.data?.logs ?? []) as unknown as AgentActivityEntry[];
    total = orgQuery.data?.total ?? 0;
    stats = entries.length > 0 ? computeStatsFromLogs(entries) : undefined;
    isLoading = orgQuery.isLoading;
    isError = orgQuery.isError;
    isFetching = orgQuery.isFetching;
  } else {
    entries = (siteQuery.data?.logs ?? []) as unknown as AgentActivityEntry[];
    total = siteQuery.data?.total ?? 0;
    stats = entries.length > 0 ? computeStatsFromLogs(entries) : undefined;
    isLoading = siteQuery.isLoading;
    isError = siteQuery.isError;
    isFetching = siteQuery.isFetching;
  }

  const resetPage = () => setPage(1);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      if (scope === "org") {
        const result = await exportAuditLogsCsv({ data: { action: actionFilter || undefined } });
        const blob = new Blob([result.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `org-activity-${new Date().toISOString().split("T")[0]}.csv`; a.click();
        URL.revokeObjectURL(url);
      } else if (scope === "site") {
        const result = await exportSiteAuditLogsCsv({ data: { action: actionFilter || undefined, userId: userFilter || undefined, orgId: orgFilter || undefined } });
        const blob = new Blob([result.csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `site-activity-${new Date().toISOString().split("T")[0]}.csv`; a.click();
        URL.revokeObjectURL(url);
      } else {
        // Personal: build CSV from current data client-side
        const headers = ["Timestamp","Action","Tool","Token","Query","Vector Score","RRF Score","Matches","IP","User-Agent"];
        const rows = entries.map((e) => [
          new Date(e.timestamp).toISOString(), e.actionLabel, e.toolName ?? "", e.tokenName ?? "",
          e.query ?? "", e.semanticScore?.toFixed(4) ?? "", e.rrfScore?.toFixed(4) ?? "",
          String(e.matchCount ?? ""), e.ipAddress ?? "", e.userAgent ?? "",
        ]);
        const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `my-activity-${new Date().toISOString().split("T")[0]}.csv`; a.click();
        URL.revokeObjectURL(url);
      }
    } finally { setExporting(false); }
  };

  const tableHeaders = showUser
    ? ["Action", "User", "Tool", "Query", "Score", "Matches", "Time"]
    : ["Action", "Tool", "Query", "Score", "Matches", "Time"];
  const colSpan = tableHeaders.length;

  const errorMsg = scope === "personal"
    ? "Failed to load activity."
    : scope === "org"
    ? "Failed to load activity. You must be an org admin."
    : "🔒 Access denied. Only the configured site admin can view this.";

  const emptyMsg = scope === "personal" && total === 0
    ? "No activity yet — connect an AI tool and make a recall."
    : "No activity matching filters.";

  return (
    <div className="flex flex-col gap-5">
      {/* Activity type toggle */}
      <div className="flex items-center gap-1 p-1 bg-surface2 border border-border rounded-lg self-start">
        {(["memory", "webhooks"] as const).map((t) => (
          <button key={t} onClick={() => { setActivityType(t); setPage(1); }}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${activityType === t ? "bg-accent text-white" : "text-text-muted hover:text-text"}`}>
            {t === "memory" ? "Memory Operations" : "🔗 Webhooks"}
          </button>
        ))}
      </div>

      {activityType === "webhooks" && (
        <div className="flex flex-col gap-4">
          {/* Scope description */}
          <p className="text-sm text-text-muted leading-relaxed m-0">
            {scope === "personal" && "GitHub and Linear webhook events processed using your personal API token."}
            {scope === "org" && "GitHub and Linear webhook events processed for your organization."}
            {scope === "site" && "All webhook events across every organization — site admin access only."}
          </p>

          {/* Source + org filters for site scope */}
          {scope === "site" && (
            <div className="flex gap-2 flex-wrap">
              <select value={webhookSourceFilter} onChange={(e) => setWebhookSourceFilter(e.target.value as "" | "github" | "linear")}
                className="h-8 px-3 text-xs bg-surface border border-border rounded-md text-text focus:outline-none focus:border-accent/50">
                <option value="">All sources</option>
                <option value="github">🐙 GitHub</option>
                <option value="linear">⚡ Linear</option>
              </select>
              <input value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} placeholder="Org ID"
                className="h-8 px-3 text-xs bg-surface border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 w-48" />
            </div>
          )}

          {webhooksLoading && <p className="text-text-muted text-sm py-4">Loading webhook events…</p>}

          {!webhooksLoading && webhookEvents.length === 0 && (
            <p className="text-text-muted text-sm py-4">No webhook events found.</p>
          )}

          {!webhooksLoading && webhookEvents.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left">
                <thead className="bg-surface2 border-b border-border">
                  <tr>
                    {["Source", "Event Type", "Ticket / PR Title", "Processed At", "Memory"].map((h) => (
                      <th key={h} className="px-3 py-2 text-[10px] uppercase tracking-wide text-text-muted font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {webhookEvents.map((ev) => (
                    <tr key={ev.id} className="border-b border-border/50 hover:bg-surface2/40 transition-colors">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-[11px] font-semibold">{ev.source === "github" ? "🐙 GitHub" : "⚡ Linear"}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-[11px] text-text">{ev.eventType === "pr.merged" ? "PR Merged" : "Ticket Done"}</span>
                      </td>
                      <td className="px-3 py-2.5 max-w-xs">
                        <span className="text-[11px] text-text-muted truncate block" title={ev.rawTitle ?? undefined}>{ev.rawTitle ?? "—"}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="text-[10px] text-text-muted">{new Date(ev.processedAt).toLocaleString()}</span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {ev.memoryId
                          ? <a href={`/memories?id=${ev.memoryId}`} className="text-[10px] font-mono text-accent hover:underline" title={ev.memoryId}>{ev.memoryId.slice(0, 8)}…</a>
                          : <span className="text-[10px] text-text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activityType === "memory" && (<>

      {/* Scope description */}
      <p className="text-sm text-text-muted leading-relaxed m-0">
        {scope === "personal" && "Every memory operation your AI tools have performed — which tool called, what it asked for, what filters it used, and exactly which facts were injected into context."}
        {scope === "org" && "All memory operations performed by members of your organization."}
        {scope === "site" && "All memory operations across every organization — site admin access only."}
      </p>

      {/* Security notice (site only) */}
      {scope === "site" && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/5 border border-red-500/20 text-red-400 text-xs">
          <span>🔒</span>
          <span><strong>Site Admin Only.</strong> Protected server-side by <code>requireAdmin()</code> — must match <code>ADMIN_USER_ID</code>.</span>
        </div>
      )}

      {/* Stats strip */}
      {stats && <ActivityStatStrip stats={stats} />}

      {/* Tool distribution */}
      {stats && stats.topTools.length > 0 && (
        <div className="bg-surface2 border border-border rounded-lg px-5 py-4">
          <h3 className="text-[11px] uppercase tracking-widest text-text-muted font-semibold mb-3 select-none">Tool Distribution</h3>
          <ToolDistributionBar tools={stats.topTools} />
        </div>
      )}

      {/* Most-injected facts */}
      {stats && stats.topInjectedFacts.length > 0 && (
        <div className="bg-surface2 border border-border rounded-lg px-5 py-4">
          <h3 className="text-[11px] uppercase tracking-widest text-text-muted font-semibold mb-3 select-none">Most-Injected Facts</h3>
          <div className="flex flex-col gap-2">
            {stats.topInjectedFacts.map(({ fact, frequency }, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="h-1 rounded-full bg-accent/60" style={{ width: `${Math.max(8, (frequency / (stats!.topInjectedFacts[0]?.frequency ?? 1)) * 100)}%`, maxWidth: 100 }} />
                    <span className="text-[10px] font-mono text-text-muted tabular-nums">{frequency}×</span>
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed line-clamp-2">{fact}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* View toggle + export */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ViewTabs view={view} onChange={setView} />
        <button onClick={handleExportCsv} disabled={exporting}
          className="h-8 px-3 text-xs font-semibold bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50">
          {exporting ? "Exporting…" : "⬇ Export CSV"}
        </button>
      </div>

      {/* Filter bar */}
      <ActivityFilterBar
        search={search} onSearchChange={(v) => { setSearch(v); resetPage(); }}
        actionFilter={actionFilter} onActionChange={(v) => { setActionFilter(v); resetPage(); }}
        startDate={startDate} onStartDateChange={(v) => { setStartDate(v); resetPage(); }}
        endDate={endDate} onEndDateChange={(v) => { setEndDate(v); resetPage(); }}
        extra={showOrgFilter ? (
          <div className="flex gap-2">
            <input value={userFilter} onChange={(e) => { setUserFilter(e.target.value); resetPage(); }} placeholder="User ID"
              className="h-8 px-3 text-xs bg-surface border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 w-36" />
            <input value={orgFilter} onChange={(e) => { setOrgFilter(e.target.value); resetPage(); }} placeholder="Org ID"
              className="h-8 px-3 text-xs bg-surface border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 w-36" />
          </div>
        ) : undefined}
      />

      {isLoading && <p className="text-text-muted text-sm py-4">Loading activity…</p>}
      {isError && <p className="text-error text-sm">{errorMsg}</p>}

      {!isLoading && !isError && (
        view === "timeline" ? (
          <div className="relative">
            <div className="absolute left-3 top-0 bottom-0 w-px bg-border pointer-events-none" />
            <div className="pl-7 flex flex-col gap-2.5">
              {entries.length === 0
                ? <p className="text-text-muted text-sm">{emptyMsg}</p>
                : entries.map((entry) => <ActivityTimelineRow key={entry.id} entry={entry} showUser={showUser} />)
              }
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left">
              <thead className="bg-surface2 border-b border-border">
                <tr>
                  {tableHeaders.map((h) => (
                    <th key={h} className="px-3 py-2 text-[10px] uppercase tracking-wide text-text-muted font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.length === 0
                  ? <tr><td colSpan={colSpan} className="px-3 py-8 text-center text-text-muted text-sm">{emptyMsg}</td></tr>
                  : entries.map((entry) => <ActivityTableRow key={entry.id} entry={entry} showUser={showUser} />)
                }
              </tbody>
            </table>
          </div>
        )
      )}

      <PaginationBar page={page} total={total} pageSize={PAGE_SIZE} isFetching={isFetching} onPage={setPage} />

      {scope === "personal" && !isLoading && entries.length > 0 && (
        <p className="text-center text-[10px] text-text-muted">Auto-refreshes every 30s</p>
      )}

      </>)}
    </div>
  );
}


function AdminPage() {
  const toast = useToast();
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
  // User can see org/team sections if they either:
  // 1. Have managed organizations, OR
  // 2. Are on a plan that supports organizations (business or above)
  const userPlan = (billingData?.personalPlanId ?? "free") as PlanId;
  const canAccessOrgs = (billingData?.managedOrgs?.length ?? 0) > 0 || planHasFeature(userPlan, "organizations");
  const isOrgAdmin = canAccessOrgs;
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
      toast.success("Successfully resolved duplicates!");
    },
  });
  const migrateMutation = useMutation({
    mutationFn: () => migrateToV2({}),
    onSuccess: (data) => setMigrateResult(data),
    onError: (err) => toast.error("Migration failed: " + String(err)),
  });

  const createUserMut = useMutation({
    mutationFn: (data: { name: string; email: string; password?: string; plan?: string }) => createUserAdmin({ data }),
    onSuccess: () => {
      usersQuery.refetch();
      setIsCreateModalOpen(false);
      setCreateName(""); setCreateEmail(""); setCreatePassword(""); setCreatePlan("free");
    },
    onError: (err) => toast.error("Failed to create user: " + String(err)),
  });
  const updateUserMut = useMutation({
    mutationFn: (data: { userId: string; name: string; email: string; emailVerified: boolean }) => updateUserAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); setIsEditModalOpen(false); },
    onError: (err) => toast.error("Failed to update user: " + String(err)),
  });
  const deleteUserMut = useMutation({
    mutationFn: (userId: string) => deleteUserAdmin({ data: { userId } }),
    onSuccess: () => usersQuery.refetch(),
    onError: (err) => toast.error("Failed to delete user: " + String(err)),
  });
  const updateUserPlanMut = useMutation({
    mutationFn: (data: { userId: string; plan: string }) => updateUserPlanAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); setIsPlanModalOpen(false); },
    onError: (err) => toast.error("Failed to update user plan: " + String(err)),
  });
  const setUserPasswordMut = useMutation({
    mutationFn: (data: { userId: string; password: string }) => setUserPasswordAdmin({ data }),
    onSuccess: () => { setIsPasswordModalOpen(false); setPasswordValue(""); toast.success("Password set successfully!"); },
    onError: (err) => toast.error("Failed to set password: " + String(err)),
  });
  const resetUserPasswordMut = useMutation({
    mutationFn: (userId: string) => resetUserPasswordAdmin({ data: { userId } }),
    onSuccess: (res) => { setGeneratedPassword(res.password || ""); setIsResetSuccessModalOpen(true); },
    onError: (err) => toast.error("Failed to reset password: " + String(err)),
  });
  const assignUserToOrgMut = useMutation({
    mutationFn: (data: { userId: string; orgId: string; role: "owner" | "admin" | "member" }) => assignUserToOrgAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); orgsQuery.refetch(); },
    onError: (err) => toast.error("Failed to assign user to organization: " + String(err)),
  });
  const removeUserFromOrgMut = useMutation({
    mutationFn: (data: { userId: string; orgId: string }) => removeUserFromOrgAdmin({ data }),
    onSuccess: () => { usersQuery.refetch(); orgsQuery.refetch(); },
    onError: (err) => toast.error("Failed to remove user from organization: " + String(err)),
  });
  const updateQuotaMut = useMutation({
    mutationFn: (data: { orgId: string; monthlyMemories: number; monthlyRecalls: number; monthlyCommits: number }) => updateOrgQuota({ data }),
    onSuccess: () => { setEditingOrgQuotaId(null); orgsQuery.refetch(); },
    onError: (err) => toast.error("Failed to update quota: " + String(err)),
  });
  const deleteOrgMut = useMutation({
    mutationFn: (id: string) => deleteOrganization({ data: { id } }),
    onSuccess: () => orgsQuery.refetch(),
    onError: (err) => toast.error("Failed to delete org: " + String(err)),
  });

  const filteredUsers = (usersQuery.data || []).filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  // Org/team mutations (self-serve operations for org admins)
  const refetchOrgTeams = () => orgTeamQuery.refetch();
  const mutOpts = { onSuccess: refetchOrgTeams, onError: (err: Error) => toast.error(err.message) };

  const createOrgMut = useMutation({
    mutationFn: (name: string) => createOrganizationSelfServe({ data: { name } }),
    onSuccess: (res) => { setShowCreateOrg(false); setNewOrgName(""); setSelectedOrgKey(`org:${res.orgId}`); refetchOrgTeams(); },
    onError: (err: Error) => toast.error(err.message),
  });
  const addOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; email: string; role: "admin" | "member" }) => addOrgMemberByEmail({ data }),
    onSuccess: () => { setOrgInviteEmail(""); refetchOrgTeams(); },
    onError: (err: Error) => toast.error(err.message),
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
    onError: (err: Error) => toast.error(err.message),
  });
  const deleteTeamMut = useMutation({
    mutationFn: (teamId: string) => deleteTeam({ data: { teamId } }),
    onSuccess: () => { setSelectedTeamKey(""); refetchOrgTeams(); },
    onError: (err: Error) => toast.error(err.message),
  });
  const addTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; email: string; role: string }) => addTeamMemberByEmail({ data }),
    onSuccess: () => { setTeamInviteEmail(""); refetchOrgTeams(); },
    onError: (err: Error) => toast.error(err.message),
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

      {activeSection === "personal-activity" && <UnifiedActivitySection scope="personal" />}

      {activeSection === "personal-webhooks" && <WebhookSecretsSection scopeType="personal" />}

      {/* ── SYSTEM OVERVIEW ─────────────────────────────────────────────── */}
      {activeSection === "system" && (
        <>
          <SystemOverviewSection />

          {/* ── Legacy DB / vector tools (collapsible) ── */}
          <details style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 700, color: "var(--text-muted)", padding: "8px 0", userSelect: "none" }}>
              ⚙️ Database & Vector Tools
            </summary>
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 16 }}>

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

            </div>
          </details>
        </>
      )}

      {/* ── USER MANAGEMENT ─────────────────────────────────────────────────── */}
      {activeSection === "user-management" && <UserManagementSection />}

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
      {activeSection === "org-audit-logs" && (
        <OrgAdminSection title="Org Activity" description="All actions taken within your organization" icon="📋">
          <UnifiedActivitySection scope="org" orgId={activeOrg?.id} />
        </OrgAdminSection>
      )}

      {/* ── ORG WEBHOOKS ──────────────────────────────────────────────────────── */}
      {activeSection === "org-webhooks" && (
        <OrgAdminSection title="Org Webhooks" description="Configure GitHub and Linear webhook signing secrets" icon="🔗">
          <WebhookSecretsSection scopeType="org" />
        </OrgAdminSection>
      )}

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
                  <option value="business_comp">Business (Comp)</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button onClick={() => setIsCreateModalOpen(false)} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}>Cancel</button>
              <button onClick={() => { if (!createName || !createEmail) { toast.warning("Name and email are required."); return; } createUserMut.mutate({ name: createName, email: createEmail, password: createPassword || undefined, plan: createPlan }); }}
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
              <button onClick={() => { if (!editName || !editEmail) { toast.warning("Name and email are required."); return; } updateUserMut.mutate({ userId: selectedUser.id, name: editName, email: editEmail, emailVerified: editEmailVerified }); }}
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
                <option value="business_comp">Business (Comp)</option>
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
              <button onClick={() => { if (passwordValue.length < 8) { toast.warning("Password must be at least 8 characters."); return; } setUserPasswordMut.mutate({ userId: selectedUser.id, password: passwordValue }); }}
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
              <button onClick={() => { navigator.clipboard.writeText(generatedPassword); toast.success("Copied to clipboard!"); }}
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
      {activeSection === "site-audit-logs" && (
        <SiteAdminSection title="Site Activity" description="All organization activity — site admin access only" icon="🔒">
          <UnifiedActivitySection scope="site" />
        </SiteAdminSection>
      )}

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

