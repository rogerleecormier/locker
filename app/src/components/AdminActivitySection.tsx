import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getPersonalWebhookEvents,
  getOrgWebhookEvents,
  getSiteWebhookEvents,
} from "~/routes/admin";
import {
  getOrgAuditLogs,
  exportAuditLogsCsv,
  getSiteAuditLogs,
  exportSiteAuditLogsCsv,
  getAgentActivityLogs,
  type AgentActivityEntry,
  type AgentActivityResult,
} from "~/server/memoryFunctions";

// ── Action metadata ───────────────────────────────────────────────────────────

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
  sync_agent_configs:       { label: "Sync Agent Configs",      icon: "📤", color: "#c084fc", bg: "rgba(192,132,252,0.1)" },
  create_template:          { label: "Create Template",         icon: "🧩", color: "#34d399", bg: "rgba(52,211,153,0.1)" },
  update_template:          { label: "Update Template",         icon: "🔧", color: "#fbbf24", bg: "rgba(251,191,36,0.1)" },
  delete_template:          { label: "Delete Template",         icon: "🗑️", color: "#f87171", bg: "rgba(248,113,113,0.1)" },
  list_accessible_scopes:   { label: "List Scopes",             icon: "📎", color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
};

export function getActionMeta(action: string) {
  return ACTION_META[action] ?? { label: action, icon: "⚙️", color: "var(--text-muted)", bg: "var(--surface2)" };
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

// ── Shared primitives ─────────────────────────────────────────────────────────

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

type ActivityView = "timeline" | "table";

export function ViewTabs({ view, onChange }: { view: ActivityView; onChange: (v: ActivityView) => void }) {
  return (
    <div className="flex items-center gap-1 bg-surface2 border border-border rounded-lg p-0.5 self-start">
      {(["timeline", "table"] as ActivityView[]).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
            view === v ? "bg-accent text-white shadow-sm" : "text-text-muted hover:text-text"
          }`}
        >
          {v === "timeline" ? "⬡ Timeline" : "≡ Table"}
        </button>
      ))}
    </div>
  );
}

export function ActivityStatStrip({ stats }: {
  stats: {
    totalRecalls: number; totalCommits: number; totalUpdates: number;
    totalDeletes: number; abacDenials: number; avgSemanticScore: number | null;
    topTools: Array<{ tool: string; count: number }>;
  };
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {[
        { label: "Recalls",      value: stats.totalRecalls,       color: "text-blue-400" },
        { label: "Commits",      value: stats.totalCommits,       color: "text-emerald-400" },
        { label: "Updates",      value: stats.totalUpdates,       color: "text-amber-400" },
        { label: "Deletes",      value: stats.totalDeletes,       color: "text-red-400" },
        { label: "ABAC Denials", value: stats.abacDenials,        color: "text-red-400" },
        { label: "Avg Score",    value: stats.avgSemanticScore !== null ? stats.avgSemanticScore.toFixed(3) : "—", color: "text-text" },
      ].map(({ label, value, color }) => (
        <div key={label} className="bg-surface2 border border-border rounded-lg px-3 py-2.5 flex flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-text-muted select-none">{label}</span>
          <span className={`text-lg font-bold tabular-nums ${color}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

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
export function toolDotClass(tool: string) { return TOOL_DOT_COLORS[tool] ?? "bg-slate-400"; }

export function ToolDistributionBar({ tools }: { tools: Array<{ tool: string; count: number }> }) {
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

export function ScoreBar({ score }: { score: number | null }) {
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

const ACTIVITY_ACTION_COLORS: Record<string, string> = {
  recall_context:              "border-blue-500/40 bg-blue-500/10 text-blue-400",
  recall_context_abac_denied:  "border-red-500/40 bg-red-500/10 text-red-400",
  commit_memory:               "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  update_memory:               "border-amber-500/40 bg-amber-500/10 text-amber-400",
  delete_memory:               "border-red-500/40 bg-red-500/10 text-red-400",
  search_memories:             "border-indigo-500/40 bg-indigo-500/10 text-indigo-400",
  get_memory_summary:          "border-cyan-500/40 bg-cyan-500/10 text-cyan-400",
  export_memories:             "border-purple-500/40 bg-purple-500/10 text-purple-400",
  list_accessible_scopes:      "border-teal-500/40 bg-teal-500/10 text-teal-400",
  jit_access_requested:        "border-amber-500/40 bg-amber-500/10 text-amber-400",
  jit_access_approved:         "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  jit_access_denied:           "border-red-500/40 bg-red-500/10 text-red-400",
  store_credential:            "border-orange-500/40 bg-orange-500/10 text-orange-400",
  retrieve_credential:         "border-orange-500/40 bg-orange-500/10 text-orange-400",
};

function formatRelTs(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
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

// ── Timeline row ──────────────────────────────────────────────────────────────

type ActivityEntryWithMeta = AgentActivityEntry & {
  userName?: string | null;
  userEmail?: string | null;
  orgName?: string | null;
};

export function ActivityTimelineRow({ entry, showUser = false }: { entry: ActivityEntryWithMeta; showUser?: boolean }) {
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
            <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider select-none ${actionCls}`}>
              {getActionMeta(entry.action).icon} {entry.actionLabel}
            </span>
            {entry.toolName && (
              <div className="flex items-center gap-1.5 bg-surface2 border border-border rounded-full px-2.5 py-0.5">
                <div className={`w-1.5 h-1.5 rounded-full ${toolDotClass(entry.toolName)}`} />
                <span className="text-[11px] font-medium text-text select-none">{entry.toolName}</span>
              </div>
            )}
            {entry.tokenName && (
              <span className="text-[11px] text-text-muted">
                via <span className="font-medium text-accent">{entry.tokenName}</span>
              </span>
            )}
            {showUser && entry.userName && (
              <span className="text-[11px] text-text-muted">
                — <span className="font-medium text-text">{entry.userName}</span>
                {entry.userEmail && <span className="ml-1">{entry.userEmail}</span>}
              </span>
            )}
            {showUser && entry.orgName && (
              <span className="text-[11px] px-1.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                🏢 {entry.orgName}
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

// ── Table row ─────────────────────────────────────────────────────────────────

export function ActivityTableRow({ entry, showUser = false }: { entry: ActivityEntryWithMeta; showUser?: boolean }) {
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
          <div className="text-xs font-medium text-text">{entry.userName ?? "—"}</div>
          {entry.userEmail && <div className="text-[10px] text-text-muted">{entry.userEmail}</div>}
          {entry.orgName && <div className="text-[10px] text-emerald-400">{entry.orgName}</div>}
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

// ── Filter bar ────────────────────────────────────────────────────────────────

const QUICK_ACTION_FILTERS = [
  { value: "", label: "All" },
  { value: "recall_context", label: "Recall" },
  { value: "commit_memory", label: "Commit" },
  { value: "update_memory", label: "Update" },
  { value: "delete_memory", label: "Delete" },
  { value: "search_memories", label: "Search" },
  { value: "jit_access_requested", label: "JIT" },
];

export function ActivityFilterBar({
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

// ── Pagination bar ────────────────────────────────────────────────────────────

export function PaginationBar({ page, total, pageSize, isFetching, onPage }: {
  page: number; total: number; pageSize: number; isFetching: boolean; onPage: (p: number) => void;
}) {
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

// ── Stats computation ─────────────────────────────────────────────────────────

export function computeStatsFromLogs(logs: AgentActivityEntry[]): AgentActivityResult["stats"] {
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
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([tool, count]) => ({ tool, count }));

  const topInjectedFacts = Object.entries(factCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([fact, frequency]) => ({ fact, frequency }));

  return {
    totalRecalls, totalCommits, totalUpdates, totalDeletes, abacDenials,
    avgSemanticScore: scoreCount > 0 ? scoreSum / scoreCount : null,
    topTools, topActions: [], topInjectedFacts,
  };
}

// ── Unified Activity Section ──────────────────────────────────────────────────

export function UnifiedActivitySection({ scope, orgId }: { scope: "personal" | "org" | "site"; orgId?: string }) {
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
    refetchInterval: 30_000,
  });

  const webhookEvents: Array<{
    id: string; source: string; eventType: string; rawTitle: string | null;
    processedAt: number; memoryId: string | null; externalId: string; userName: string | null;
  }> =
    scope === "personal" ? (personalWebhooksQuery.data?.events ?? [])
    : scope === "org" ? (orgWebhooksQuery.data?.events ?? [])
    : (siteWebhooksQuery.data?.events ?? []);

  const webhooksLoading =
    scope === "personal" ? personalWebhooksQuery.isLoading
    : scope === "org" ? orgWebhooksQuery.isLoading
    : siteWebhooksQuery.isLoading;

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
    refetchInterval: 30_000,
  });

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
    refetchInterval: 30_000,
  });

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
    refetchInterval: 30_000,
  });

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
        downloadCsv(result.csv, `org-activity-${today()}.csv`);
      } else if (scope === "site") {
        const result = await exportSiteAuditLogsCsv({ data: { action: actionFilter || undefined, userId: userFilter || undefined, orgId: orgFilter || undefined } });
        downloadCsv(result.csv, `site-activity-${today()}.csv`);
      } else {
        const headers = ["Timestamp","Action","Tool","Token","Query","Vector Score","RRF Score","Matches","IP","User-Agent"];
        const rows = entries.map((e) => [
          new Date(e.timestamp).toISOString(), e.actionLabel, e.toolName ?? "", e.tokenName ?? "",
          e.query ?? "", e.semanticScore?.toFixed(4) ?? "", e.rrfScore?.toFixed(4) ?? "",
          String(e.matchCount ?? ""), e.ipAddress ?? "", e.userAgent ?? "",
        ]);
        const csv = [headers, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
        downloadCsv(csv, `my-activity-${today()}.csv`);
      }
    } finally { setExporting(false); }
  };

  const tableHeaders = showUser
    ? ["Action", "User", "Tool", "Query", "Score", "Matches", "Time"]
    : ["Action", "Tool", "Query", "Score", "Matches", "Time"];

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
        <WebhooksPanel
          scope={scope}
          webhookEvents={webhookEvents}
          webhooksLoading={webhooksLoading}
          webhookSourceFilter={webhookSourceFilter}
          setWebhookSourceFilter={setWebhookSourceFilter}
          orgFilter={orgFilter}
          setOrgFilter={setOrgFilter}
        />
      )}

      {activityType === "memory" && (
        <MemoryActivityPanel
          scope={scope}
          stats={stats}
          entries={entries}
          total={total}
          isLoading={isLoading}
          isError={isError}
          isFetching={isFetching}
          view={view}
          setView={setView}
          page={page}
          onPage={setPage}
          pageSize={PAGE_SIZE}
          tableHeaders={tableHeaders}
          showUser={showUser}
          showOrgFilter={showOrgFilter}
          search={search}
          onSearchChange={(v) => { setSearch(v); resetPage(); }}
          actionFilter={actionFilter}
          onActionChange={(v) => { setActionFilter(v); resetPage(); }}
          startDate={startDate}
          onStartDateChange={(v) => { setStartDate(v); resetPage(); }}
          endDate={endDate}
          onEndDateChange={(v) => { setEndDate(v); resetPage(); }}
          userFilter={userFilter}
          onUserFilterChange={(v) => { setUserFilter(v); resetPage(); }}
          orgFilter={orgFilter}
          onOrgFilterChange={(v) => { setOrgFilter(v); resetPage(); }}
          exporting={exporting}
          onExportCsv={handleExportCsv}
          errorMsg={errorMsg}
          emptyMsg={emptyMsg}
        />
      )}
    </div>
  );
}

// ── Webhooks sub-panel ────────────────────────────────────────────────────────

function WebhooksPanel({
  scope, webhookEvents, webhooksLoading,
  webhookSourceFilter, setWebhookSourceFilter, orgFilter, setOrgFilter,
}: {
  scope: "personal" | "org" | "site";
  webhookEvents: Array<{ id: string; source: string; eventType: string; rawTitle: string | null; processedAt: number; memoryId: string | null; externalId: string; userName: string | null }>;
  webhooksLoading: boolean;
  webhookSourceFilter: "" | "github" | "linear";
  setWebhookSourceFilter: (v: "" | "github" | "linear") => void;
  orgFilter: string;
  setOrgFilter: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted leading-relaxed m-0">
        {scope === "personal" && "GitHub and Linear webhook events processed using your personal API token."}
        {scope === "org" && "GitHub and Linear webhook events processed for your organization."}
        {scope === "site" && "All webhook events across every organization — site admin access only."}
      </p>

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
  );
}

// ── Memory activity sub-panel ─────────────────────────────────────────────────

function MemoryActivityPanel({
  scope, stats, entries, total, isLoading, isError, isFetching,
  view, setView, page, onPage, pageSize, tableHeaders, showUser, showOrgFilter,
  search, onSearchChange, actionFilter, onActionChange,
  startDate, onStartDateChange, endDate, onEndDateChange,
  userFilter, onUserFilterChange, orgFilter, onOrgFilterChange,
  exporting, onExportCsv, errorMsg, emptyMsg,
}: {
  scope: "personal" | "org" | "site";
  stats: AgentActivityResult["stats"] | undefined;
  entries: AgentActivityEntry[];
  total: number;
  isLoading: boolean; isError: boolean; isFetching: boolean;
  view: ActivityView; setView: (v: ActivityView) => void;
  page: number; onPage: (p: number) => void; pageSize: number;
  tableHeaders: string[]; showUser: boolean; showOrgFilter: boolean;
  search: string; onSearchChange: (v: string) => void;
  actionFilter: string; onActionChange: (v: string) => void;
  startDate: string; onStartDateChange: (v: string) => void;
  endDate: string; onEndDateChange: (v: string) => void;
  userFilter: string; onUserFilterChange: (v: string) => void;
  orgFilter: string; onOrgFilterChange: (v: string) => void;
  exporting: boolean; onExportCsv: () => void;
  errorMsg: string; emptyMsg: string;
}) {
  return (
    <>
      <p className="text-sm text-text-muted leading-relaxed m-0">
        {scope === "personal" && "Every memory operation your AI tools have performed — which tool called, what it asked for, what filters it used, and exactly which facts were injected into context."}
        {scope === "org" && "All memory operations performed by members of your organization."}
        {scope === "site" && "All memory operations across every organization — site admin access only."}
      </p>

      {scope === "site" && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/5 border border-red-500/20 text-red-400 text-xs">
          <span>🔒</span>
          <span><strong>Site Admin Only.</strong> Protected server-side by <code>requireAdmin()</code> — must match <code>ADMIN_USER_ID</code>.</span>
        </div>
      )}

      {stats && <ActivityStatStrip stats={stats} />}

      {stats && stats.topTools.length > 0 && (
        <div className="bg-surface2 border border-border rounded-lg px-5 py-4">
          <h3 className="text-[11px] uppercase tracking-widest text-text-muted font-semibold mb-3 select-none">Tool Distribution</h3>
          <ToolDistributionBar tools={stats.topTools} />
        </div>
      )}

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

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ViewTabs view={view} onChange={setView} />
        <button onClick={onExportCsv} disabled={exporting}
          className="h-8 px-3 text-xs font-semibold bg-accent text-white rounded-md hover:opacity-90 disabled:opacity-50">
          {exporting ? "Exporting…" : "⬇ Export CSV"}
        </button>
      </div>

      <ActivityFilterBar
        search={search} onSearchChange={onSearchChange}
        actionFilter={actionFilter} onActionChange={onActionChange}
        startDate={startDate} onStartDateChange={onStartDateChange}
        endDate={endDate} onEndDateChange={onEndDateChange}
        extra={showOrgFilter ? (
          <div className="flex gap-2">
            <input value={userFilter} onChange={(e) => onUserFilterChange(e.target.value)} placeholder="User ID"
              className="h-8 px-3 text-xs bg-surface border border-border rounded-md text-text placeholder:text-text-muted focus:outline-none focus:border-accent/50 w-36" />
            <input value={orgFilter} onChange={(e) => onOrgFilterChange(e.target.value)} placeholder="Org ID"
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
                  ? <tr><td colSpan={tableHeaders.length} className="px-3 py-8 text-center text-text-muted text-sm">{emptyMsg}</td></tr>
                  : entries.map((entry) => <ActivityTableRow key={entry.id} entry={entry} showUser={showUser} />)
                }
              </tbody>
            </table>
          </div>
        )
      )}

      <PaginationBar page={page} total={total} pageSize={pageSize} isFetching={isFetching} onPage={onPage} />

      {scope === "personal" && !isLoading && entries.length > 0 && (
        <p className="text-center text-[10px] text-text-muted">Auto-refreshes every 30s</p>
      )}
    </>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().split("T")[0];
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
