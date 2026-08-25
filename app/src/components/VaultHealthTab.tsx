import { useState } from "react";
import type { MemoryConflict } from "~/db/schema";
import type { MemoryHealthReport } from "~/server/memoryHealth";
import type { PlanId } from "~/lib/plans";
import { PaywallGate } from "~/components/PaywallGate";

type Props = {
  projectKey: string;
  userPlan: PlanId;
  vaultConflicts: MemoryConflict[];
  isConflictsLoading: boolean;
  isHealthLoading: boolean;
  healthReport: MemoryHealthReport | null;
  quarantinedMemories: any[];
  onRunHealthCheck: () => void;
  onRefreshConflicts: () => void;
  comparisonCluster: any;
  showComparisonModal: boolean;
  merging: boolean;
  onShowComparison: (cluster: any) => void;
  onCloseComparison: () => void;
  onMerge: (memoryIds: string[], conflictId: string) => void;
  onResolve: (conflictId: string) => void;
  onSnooze: (conflictId: string, days: number) => void;
  onTouchMemory: (memoryId: string, conflictId?: string) => void;
  onUnquarantine: (memoryId: string) => void;
  onDeleteMemory: (memoryId: string) => void;
  onArchiveMemory: (memoryId: string) => void;
  onBulkResolveStale: (
    action: "looksGood" | "archive" | "snooze",
    items: Array<{ memoryId: string; conflictId: string }>,
    snoozeDays?: number
  ) => Promise<{ succeeded: string[]; failed: Array<{ memoryId: string; error: string }> }>;
};

function ageDays(ms: number): string {
  const d = Math.floor((Date.now() - ms) / (1000 * 60 * 60 * 24));
  if (d === 0) return "today";
  if (d === 1) return "1 day ago";
  return `${d}d ago`;
}

function HealthScore({ conflicts, quarantinedCount }: { conflicts: MemoryConflict[]; quarantinedCount: number }) {
  const dupes = conflicts.filter((c) => c.conflictType === "duplicate").length;
  const stale = conflicts.filter((c) => c.conflictType === "stale").length;
  const issues = dupes * 2 + stale + quarantinedCount * 3;
  const score = Math.max(0, Math.min(100, 100 - issues));
  const color = score >= 80 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";
  const label = score >= 80 ? "Healthy" : score >= 50 ? "Needs Attention" : "Critical";

  return (
    <div className="flex items-center gap-4 p-4 bg-surface border border-border rounded-xl">
      <div className="relative flex items-center justify-center" style={{ width: 64, height: 64 }}>
        <svg width="64" height="64" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="28" fill="none" stroke="var(--border)" strokeWidth="6" />
          <circle
            cx="32" cy="32" r="28"
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeDasharray={`${(score / 100) * 175.9} 175.9`}
            strokeLinecap="round"
            transform="rotate(-90 32 32)"
          />
        </svg>
        <span className="absolute text-base font-bold" style={{ color }}>{score}</span>
      </div>
      <div>
        <p className="text-sm font-bold text-text">{label}</p>
        <p className="text-xs text-text-muted mt-0.5">
          {dupes > 0 && `${dupes} duplicate${dupes !== 1 ? "s" : ""}`}
          {dupes > 0 && stale > 0 && " · "}
          {stale > 0 && `${stale} stale`}
          {(dupes > 0 || stale > 0) && quarantinedCount > 0 && " · "}
          {quarantinedCount > 0 && `${quarantinedCount} quarantined`}
          {dupes === 0 && stale === 0 && quarantinedCount === 0 && "No open issues"}
        </p>
      </div>
    </div>
  );
}

function SnoozePicker({ onSnooze, onClose }: { onSnooze: (days: number) => void; onClose: () => void }) {
  return (
    <div className="absolute right-0 top-8 z-20 bg-surface border border-border rounded-lg shadow-lg p-2 flex flex-col gap-1 min-w-[130px]">
      {[7, 14, 30].map((d) => (
        <button
          key={d}
          onClick={() => { onSnooze(d); onClose(); }}
          className="text-xs px-3 py-1.5 rounded hover:bg-surface2 text-text text-left transition-colors"
        >
          Snooze {d} days
        </button>
      ))}
      <button onClick={onClose} className="text-xs px-3 py-1.5 rounded hover:bg-surface2 text-text-muted text-left transition-colors">
        Cancel
      </button>
    </div>
  );
}

function StaleActions({
  conflictId,
  memoryId,
  onTouchMemory,
  onArchive,
  onSnooze,
}: {
  conflictId: string;
  memoryId: string;
  onTouchMemory: (memoryId: string, conflictId: string) => void;
  onArchive: (memoryId: string) => void;
  onSnooze: (days: number) => void;
}) {
  const [showSnooze, setShowSnooze] = useState(false);
  return (
    <div className="flex gap-2 flex-shrink-0 relative items-start">
      <button
        onClick={() => onTouchMemory(memoryId, conflictId)}
        title="Memory is still relevant — reset its stale timer"
        className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/15 cursor-pointer transition-colors whitespace-nowrap"
      >
        Looks Good
      </button>
      <button
        onClick={() => onArchive(memoryId)}
        title="Archive this memory"
        className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-600 hover:bg-amber-500/15 cursor-pointer transition-colors whitespace-nowrap"
      >
        Archive
      </button>
      <div className="relative">
        <button
          onClick={() => setShowSnooze((s) => !s)}
          title="Remind me later"
          className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-border bg-surface2 text-text-muted hover:text-text hover:bg-surface cursor-pointer transition-colors whitespace-nowrap"
        >
          Snooze
        </button>
        {showSnooze && (
          <SnoozePicker onSnooze={onSnooze} onClose={() => setShowSnooze(false)} />
        )}
      </div>
    </div>
  );
}

function ConflictActions({
  conflict,
  onResolve,
  onSnooze,
  extraActions,
}: {
  conflict: MemoryConflict;
  onResolve: () => void;
  onSnooze: (days: number) => void;
  extraActions?: React.ReactNode;
}) {
  const [showSnooze, setShowSnooze] = useState(false);

  return (
    <div className="flex gap-2 flex-shrink-0 relative items-start">
      {extraActions}
      <button
        onClick={onResolve}
        className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/15 cursor-pointer transition-colors whitespace-nowrap"
      >
        Resolve
      </button>
      <div className="relative">
        <button
          onClick={() => setShowSnooze((s) => !s)}
          className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-border bg-surface2 text-text-muted hover:text-text hover:bg-surface cursor-pointer transition-colors whitespace-nowrap"
        >
          Snooze
        </button>
        {showSnooze && (
          <SnoozePicker onSnooze={onSnooze} onClose={() => setShowSnooze(false)} />
        )}
      </div>
    </div>
  );
}

function StaleSection({
  staleConflicts,
  onTouchMemory,
  onArchiveMemory,
  onSnooze,
  onBulkResolveStale,
}: {
  staleConflicts: MemoryConflict[];
  onTouchMemory: (memoryId: string, conflictId: string) => void;
  onArchiveMemory: (memoryId: string) => void;
  onSnooze: (conflictId: string, days: number) => void;
  onBulkResolveStale: Props["onBulkResolveStale"];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkSnooze, setShowBulkSnooze] = useState(false);

  const allIds = staleConflicts.map((c) => c.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function getSelected(): Array<{ conflictId: string; memoryId: string }> {
    return staleConflicts
      .filter((c) => selected.has(c.id))
      .map((c) => ({ conflictId: c.id, memoryId: (JSON.parse(c.memoryIds) as string[])[0] }));
  }

  const [bulkPending, setBulkPending] = useState(false);

  function bulkLooksGood() {
    const items = getSelected();
    setSelected(new Set());
    setBulkPending(true);
    onBulkResolveStale("looksGood", items).finally(() => setBulkPending(false));
  }

  function bulkArchive() {
    const items = getSelected();
    setSelected(new Set());
    setBulkPending(true);
    onBulkResolveStale("archive", items).finally(() => setBulkPending(false));
  }

  function bulkSnooze(days: number) {
    const items = getSelected();
    setSelected(new Set());
    setShowBulkSnooze(false);
    setBulkPending(true);
    onBulkResolveStale("snooze", items, days).finally(() => setBulkPending(false));
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
          <span style={{ display: "inline-flex", width: 22, height: 22, borderRadius: 6, background: "rgba(245,158,11,0.12)", alignItems: "center", justifyContent: "center", color: "#f59e0b", fontSize: 11, fontWeight: "bold", flexShrink: 0 }}>⏱</span>
          Stale
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">{staleConflicts.length}</span>
        </h3>
      </div>
      <p className="text-xs text-text-muted mb-3 ml-8">Never recalled or not accessed in 30+ days.</p>

      {staleConflicts.length === 0 ? (
        <div className="py-8 text-center text-text-muted text-sm bg-surface border border-border rounded-lg">
          No stale memories
        </div>
      ) : (
        <>
          {/* Select-all + bulk toolbar */}
          <div className="flex items-center gap-3 mb-2 px-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                onChange={toggleAll}
                className="w-4 h-4 rounded border-border accent-amber-500 cursor-pointer"
              />
              <span className="text-xs text-text-muted font-medium">
                {someSelected ? `${selected.size} selected` : "Select all"}
              </span>
            </label>
            {someSelected && (
              <div className="flex items-center gap-2 ml-auto">
                <button
                  onClick={bulkLooksGood}
                  disabled={bulkPending}
                  className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-emerald-500/30 bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/15 cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bulkPending ? "Working…" : "Looks Good"}
                </button>
                <button
                  onClick={bulkArchive}
                  disabled={bulkPending}
                  className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-amber-500/30 bg-amber-500/5 text-amber-600 hover:bg-amber-500/15 cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Archive
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowBulkSnooze((s) => !s)}
                    disabled={bulkPending}
                    className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-border bg-surface2 text-text-muted hover:text-text hover:bg-surface cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Snooze
                  </button>
                  {showBulkSnooze && (
                    <SnoozePicker onSnooze={bulkSnooze} onClose={() => setShowBulkSnooze(false)} />
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {staleConflicts.map((conflict) => {
              const memoryId = (JSON.parse(conflict.memoryIds) as string[])[0];
              const isChecked = selected.has(conflict.id);
              return (
                <div
                  key={conflict.id}
                  className={`p-4 bg-surface border rounded-lg transition-colors flex items-start gap-3 ${isChecked ? "border-amber-500/40 bg-amber-500/3" : "border-border hover:border-amber-500/30"}`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggle(conflict.id)}
                    className="mt-0.5 w-4 h-4 rounded border-border accent-amber-500 cursor-pointer shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text line-clamp-3 mb-1">{conflict.label}</p>
                    <div className="flex gap-2 items-center flex-wrap">
                      <span className="text-[10px] text-amber-600 font-semibold">{conflict.reason}</span>
                      <span className="text-[9px] text-text-muted font-mono">detected {ageDays(conflict.detectedAt)}</span>
                    </div>
                  </div>
                  <StaleActions
                    conflictId={conflict.id}
                    memoryId={memoryId}
                    onTouchMemory={onTouchMemory}
                    onArchive={onArchiveMemory}
                    onSnooze={(days) => onSnooze(conflict.id, days)}
                  />
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function VaultHealthTab({
  projectKey,
  userPlan,
  vaultConflicts,
  isConflictsLoading,
  isHealthLoading,
  healthReport,
  quarantinedMemories,
  onRunHealthCheck,
  onRefreshConflicts,
  comparisonCluster,
  showComparisonModal,
  merging,
  onShowComparison,
  onCloseComparison,
  onMerge,
  onResolve,
  onSnooze,
  onTouchMemory,
  onUnquarantine,
  onDeleteMemory,
  onArchiveMemory,
  onBulkResolveStale,
}: Props) {
  const duplicates = vaultConflicts.filter((c) => c.conflictType === "duplicate");
  const staleConflicts = vaultConflicts.filter((c) => c.conflictType === "stale");
  const quarantinedConflicts = vaultConflicts.filter((c) => c.conflictType === "quarantined");

  return (
    <div className="flex flex-col gap-6">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <HealthScore conflicts={vaultConflicts} quarantinedCount={quarantinedMemories.length} />
        <PaywallGate feature="usageAnalytics" currentPlan={userPlan} requiredPlan="business" compact>
          <button
            onClick={onRunHealthCheck}
            disabled={isHealthLoading}
            className="h-9 px-4 text-xs font-bold uppercase tracking-wider rounded-lg border border-accent/30 bg-accent/5 text-accent hover:bg-accent/15 disabled:opacity-50 transition-colors whitespace-nowrap flex items-center gap-2 self-center"
          >
            {isHealthLoading ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                Analyzing…
              </>
            ) : (
              "Run Health Check"
            )}
          </button>
        </PaywallGate>
      </div>

      {healthReport && (
        <div className="px-4 py-3 bg-surface border border-border rounded-lg text-xs text-text-muted flex items-start gap-2">
          <span className="text-accent shrink-0 mt-0.5">✓</span>
          <span>
            Last scan: {new Date(healthReport.analysisTimestamp).toLocaleString()} — {healthReport.totalMemoriesAnalyzed} memories analyzed.{" "}
            {healthReport.summary}
          </span>
        </div>
      )}

      {isConflictsLoading ? (
        <div className="py-16 text-center text-text-muted text-sm">Loading conflicts…</div>
      ) : (
        <>
          {/* DUPLICATES */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
                <span style={{ display: "inline-flex", width: 22, height: 22, borderRadius: 6, background: "rgba(99,102,241,0.12)", alignItems: "center", justifyContent: "center", color: "#6366f1", fontSize: 11, fontWeight: "bold", flexShrink: 0 }}>~</span>
                Duplicates
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 border border-indigo-500/20">{duplicates.length}</span>
              </h3>
            </div>
            <p className="text-xs text-text-muted mb-3 ml-8">Near-identical memories that may be merged. Detected by AI health scan.</p>
            {duplicates.length === 0 ? (
              <div className="py-8 text-center text-text-muted text-sm bg-surface border border-border rounded-lg">
                No duplicate clusters — run a health check to detect new ones
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {duplicates.map((conflict) => {
                  const memIds: string[] = JSON.parse(conflict.memoryIds);
                  const details: Array<{ id: string; fact: string; category: string }> = conflict.memoryDetails
                    ? JSON.parse(conflict.memoryDetails)
                    : memIds.map((id) => ({ id, fact: "", category: "" }));
                  return (
                    <div key={conflict.id} className="p-4 bg-surface border border-border rounded-lg hover:border-indigo-500/30 transition-colors">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-sm font-semibold text-text">{conflict.label}</h4>
                            <span className="text-[9px] text-text-muted font-mono">{ageDays(conflict.detectedAt)}</span>
                            {conflict.lastSeenAt !== conflict.detectedAt && (
                              <span className="text-[9px] text-indigo-500">re-confirmed {ageDays(conflict.lastSeenAt)}</span>
                            )}
                          </div>
                          <p className="text-xs text-text-muted">{conflict.reason}</p>
                        </div>
                        <ConflictActions
                          conflict={conflict}
                          onResolve={() => onResolve(conflict.id)}
                          onSnooze={(days) => onSnooze(conflict.id, days)}
                          extraActions={
                            <>
                              <button
                                onClick={() => onShowComparison({ ...conflict, clusterLabel: conflict.label, memoryIds: memIds, memoryDetails: details })}
                                className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-indigo-500/30 bg-indigo-500/5 text-indigo-600 hover:bg-indigo-500/15 cursor-pointer transition-colors whitespace-nowrap"
                              >
                                Compare
                              </button>
                              <button
                                onClick={() => onMerge(memIds, conflict.id)}
                                disabled={merging}
                                className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-indigo-500/30 bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer transition-colors whitespace-nowrap disabled:opacity-50"
                              >
                                {merging ? "Merging…" : "Merge"}
                              </button>
                            </>
                          }
                        />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(details.length, 2)}, 1fr)`, gap: 10 }}>
                        {details.map((d, idx) => (
                          <div key={d.id} className="p-3 bg-indigo-500/5 border border-indigo-500/15 rounded-lg flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-600">Memory {idx + 1}</span>
                              <code className="text-[8px] bg-surface2 px-1.5 py-0.5 rounded text-text-muted font-mono">{d.id.slice(0, 6)}…</code>
                            </div>
                            <p className="text-xs text-text leading-relaxed">{d.fact}</p>
                            {d.category && <span className="text-[9px] bg-surface2 border border-border px-2 py-0.5 rounded self-start text-text-muted">{d.category}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* STALE */}
          <StaleSection
            staleConflicts={staleConflicts}
            onTouchMemory={onTouchMemory}
            onArchiveMemory={onArchiveMemory}
            onSnooze={onSnooze}
            onBulkResolveStale={onBulkResolveStale}
          />

          {/* QUARANTINED — from DB conflicts + live quarantined list */}
          <section>
            <div className="mb-3">
              <h3 className="text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
                <span style={{ display: "inline-flex", width: 22, height: 22, borderRadius: 6, background: "rgba(239,68,68,0.12)", alignItems: "center", justifyContent: "center", color: "#ef4444", fontSize: 11, fontWeight: "bold", flexShrink: 0 }}>!</span>
                Quarantined
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-error/10 text-error border border-error/20">{quarantinedMemories.length}</span>
              </h3>
              <p className="text-xs text-text-muted mt-1 ml-8">Hidden from memory retrieval until reviewed. Restore or permanently delete.</p>
            </div>
            {quarantinedMemories.length === 0 ? (
              <div className="py-8 text-center text-text-muted text-sm bg-surface border border-border rounded-lg">
                No quarantined memories
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {quarantinedMemories.map((memory: any) => (
                  <div key={memory.id} className="p-4 bg-surface border border-border rounded-lg hover:border-error/30 transition-colors flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text line-clamp-3 mb-2">{memory.fact}</p>
                      <div className="flex gap-2 items-center flex-wrap">
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-surface2 text-text-muted">{memory.category}</span>
                        <span className="text-[10px] text-text-muted font-mono">{memory.id.slice(0, 8)}…</span>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => onUnquarantine(memory.id)}
                        className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-accent/30 bg-accent/5 text-accent hover:bg-accent/15 cursor-pointer transition-colors whitespace-nowrap"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => onDeleteMemory(memory.id)}
                        className="h-7 px-3 text-[10px] font-bold uppercase tracking-wider rounded-md border border-error/30 bg-error/5 text-error hover:bg-error/15 cursor-pointer transition-colors whitespace-nowrap"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* COMPARISON MODAL */}
      {showComparisonModal && comparisonCluster && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface border border-border rounded-xl shadow-lg max-w-4xl w-full max-h-[80vh] overflow-auto flex flex-col">
            <div className="sticky top-0 bg-surface border-b border-border p-6 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-text">{comparisonCluster.clusterLabel ?? comparisonCluster.label}</h3>
                <p className="text-sm text-text-muted mt-1">{comparisonCluster.reason}</p>
              </div>
              <button onClick={onCloseComparison} className="text-text-muted hover:text-text text-2xl leading-none">✕</button>
            </div>
            <div className="p-6 flex-1">
              <div className="grid grid-cols-2 gap-4 mb-6">
                {(comparisonCluster.memoryDetails ?? []).map((detail: any, idx: number) => (
                  <div key={detail.id} className="p-4 bg-indigo-500/6 border border-indigo-500/15 rounded-lg flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-600">Memory {idx + 1}</span>
                      <code className="text-[8px] bg-surface2 px-2 py-1 rounded text-text-muted font-mono">{detail.id.slice(0, 6)}…</code>
                    </div>
                    <p className="text-sm text-text leading-relaxed font-medium">{detail.fact}</p>
                    {detail.category && (
                      <span className="text-[9px] bg-surface2 px-2 py-1 rounded text-text-muted">{detail.category}</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="p-4 bg-success/5 border border-success/20 rounded-lg mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-success text-sm">✓</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-success">AI Consolidation</span>
                </div>
                <p className="text-xs text-text-muted">
                  Llama 3.3 will intelligently merge these memories into one comprehensive memory, preserving all unique information while eliminating redundancy.
                </p>
              </div>
              <div className="flex gap-3">
                <button onClick={onCloseComparison} className="flex-1 h-9 px-4 text-xs font-bold uppercase tracking-wider rounded-md border border-border bg-surface2 text-text hover:bg-surface transition-colors">
                  Cancel
                </button>
                <button
                  onClick={() => onMerge(comparisonCluster.memoryIds, comparisonCluster.id)}
                  disabled={merging}
                  className="flex-1 h-9 px-4 text-xs font-bold uppercase tracking-wider rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {merging ? "Merging…" : "Confirm Merge"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
