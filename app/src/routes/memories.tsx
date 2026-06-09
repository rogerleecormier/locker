import { createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CloudflareEnv } from "~/types/cloudflare";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { InfoTooltip } from "~/components/InfoTooltip";
import { getMemoryStaleness } from "~/lib/utils";
import { LockerPadlock } from "~/components/LockerLogo";
import {
  getMemories,
  bulkDeleteMemories,
  updateMemory,
  getUserWorkspaces,
  moveMemories,
  getMemoryUsageStats,
  archiveMemory,
  deleteMemory,
  listPersonalMemoryRecommendations,
  reviewMemoryRecommendation,
  getConflicts,
  unmaskMemory,
  semanticSearchMemories,
  getQuarantinedMemories,
  getMemoryTimeline,
  revertMemoryVersion,
  getUserPlan,
} from "~/server/memoryFunctions";
import type { Memory } from "~/db/schema";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { MemoryCard } from "~/components/MemoryCard";
import { ConfigBuilder } from "~/components/ConfigBuilder";
import { NewMemoryModal } from "~/components/NewMemoryModal";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Label, Input, Textarea, Select } from "~/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "~/components/ui/dialog";
import { ExportMemoryModal } from "~/components/ExportMemoryModal";
import { HistoryModal } from "~/components/HistoryModal";
import { downloadFile, exportToJson, exportToMarkdown } from "~/lib/memoryExport";
import { useToast } from "~/components/ui/toast";
import { QuarantineDashboard } from "~/components/QuarantineDashboard";
import { PaywallGate } from "~/components/PaywallGate";
import { KnowledgeGraph } from "~/components/KnowledgeGraph";
import { ContributionsChart } from "~/components/ContributionsChart";
import { MemoryHealthPanel } from "~/components/MemoryHealthPanel";
import type { PlanId } from "~/lib/plans";

export const Route = createFileRoute("/memories")({
  component: Dashboard,
});

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

export const getMemoryGraphFn = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => raw as { projectKey?: string })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const { requireSession } = await import("~/server/session");
    const user = await requireSession(env);
    const { getMemoryGraph } = await import("~/server/memory/graph");
    return getMemoryGraph(env.DB, user.id, data.projectKey);
  });

export const getGraphMemoriesByIdsFn = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => raw as { memoryIds: string[] })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const { requireSession } = await import("~/server/session");
    const user = await requireSession(env);
    const { getMemoriesByIds } = await import("~/server/memory/graph");
    return getMemoriesByIds(env.DB, user.id, data.memoryIds, env.ENCRYPTION_KEY);
  });

// Memories older than this threshold are considered stale
const STALE_MEMORY_DAYS = 90;
const STALE_MEMORY_MS = STALE_MEMORY_DAYS * 24 * 60 * 60 * 1000;

// localStorage key and TTL for banner dismissal
const STALE_BANNER_DISMISS_KEY = "locker-stale-banner-dismissed-at";
const STALE_BANNER_DISMISS_TTL_DAYS = 7;
const STALE_BANNER_DISMISS_TTL_MS = STALE_BANNER_DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;

function useStaleMemoryBanner(staleCount: number) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    const ts = localStorage.getItem(STALE_BANNER_DISMISS_KEY);
    if (!ts) return false;
    return Date.now() - Number(ts) < STALE_BANNER_DISMISS_TTL_MS;
  });

  function dismiss() {
    setDismissed(true);
    localStorage.setItem(STALE_BANNER_DISMISS_KEY, String(Date.now()));
  }

  const visible = !dismissed && staleCount > 0;
  return { visible, dismiss };
}

function StaleMemoryBanner({
  staleCount,
  onFilter,
  onDismiss,
}: {
  staleCount: number;
  onFilter: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border border-amber-500/25 rounded-xl animate-in fade-in slide-in-from-top-2 duration-200 select-none">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <button
        type="button"
        onClick={onFilter}
        className="flex-1 text-left text-xs font-semibold text-amber-600 hover:text-amber-500 transition-colors"
      >
        You have{" "}
        <span className="font-bold underline underline-offset-2 decoration-amber-500/50">
          {staleCount} {staleCount === 1 ? "memory" : "memories"}
        </span>{" "}
        older than {STALE_MEMORY_DAYS} days — consider reviewing them.
      </button>
      <button
        type="button"
        title="Dismiss for 7 days"
        onClick={onDismiss}
        className="shrink-0 h-6 w-6 flex items-center justify-center text-amber-500/60 hover:text-amber-500 rounded-md hover:bg-amber-500/10 transition-colors text-sm leading-none"
      >
        ✕
      </button>
    </div>
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  rules: "indigo",
  projects: "emerald",
  references: "amber",
  stack: "purple",
};


// ── MEMORY DETAILS DRAWER PANEL ────────────────────────────────────────────
function MemoryDetailPanel({
  memory,
  onClose,
  workspaces = [],
  currentProjectKey = "personal",
}: {
  memory: Memory;
  onClose: () => void;
  workspaces?: any[];
  currentProjectKey?: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editFact, setEditFact] = useState(memory.fact);
  const [editCategory, setEditCategory] = useState(memory.category);
  const [editTags, setEditTags] = useState(memory.tags);
  const [targetWorkspace, setTargetWorkspace] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setEditFact(memory.fact);
    setEditCategory(memory.category);
    setEditTags(memory.tags);
    setTargetWorkspace("");
    setConfirmDelete(false);
  }, [memory]);

  const hasChanges =
    editFact !== memory.fact ||
    editCategory !== memory.category ||
    editTags !== memory.tags;

  const updateMutation = useMutation({
    mutationFn: () =>
      updateMemory({
        data: {
          id: memory.id,
          fact: editFact,
          category: editCategory,
          tags: editTags,
        },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.map((m) => (m.id === updated.id ? updated : m)) : []
      );
      toast.success("Changes saved successfully!");
    },
    onError: (err: any) => {
      toast.error("Failed to save changes: " + String(err.message || err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemory({ data: { id: memory.id } }),
    onSuccess: () => {
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.filter((m) => m.id !== memory.id) : []
      );
      onClose();
    },
    onError: (err: any) => {
      toast.error("Failed to delete memory: " + String(err.message || err));
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveMemory({ data: { id: memory.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["memories-archived"] });
      onClose();
    },
    onError: (err: any) => {
      toast.error("Failed to archive memory: " + String(err.message || err));
    },
  });

  const moveMutation = useMutation({
    mutationFn: () =>
      moveMemories({
        data: { ids: [memory.id], targetProjectKey: targetWorkspace },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setTargetWorkspace("");
      onClose();
      toast.success("Memory moved successfully!");
    },
    onError: (err: any) => {
      toast.error("Failed to move memory: " + String(err.message || err));
    },
  });

  const { data: versions = [], isLoading: isTimelineLoading } = useQuery({
    queryKey: ["memory-timeline", memory.id],
    queryFn: () => getMemoryTimeline({ data: { memoryId: memory.id } }),
  });

  const revertMutation = useMutation({
    mutationFn: (versionId: string) => revertMemoryVersion({ data: { versionId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["memory-timeline", memory.id] });
      toast.success("Reverted memory version successfully!");
    },
    onError: (err: any) => {
      toast.error("Revert failed: " + String(err.message || err));
    },
  });

  const unmaskMutation = useMutation({
    mutationFn: () => unmaskMemory({ data: { id: memory.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      onClose();
      toast.success("Memory released from quarantine!");
    },
    onError: (err: any) => {
      toast.error("Failed to unmask memory: " + String(err.message || err));
    },
  });

  const tagsList = useMemo(() => {
    return editTags ? editTags.split(",").map((t) => t.trim()).filter(Boolean) : [];
  }, [editTags]);

  return (
    <div className="flex flex-col gap-5 h-full">
      <div className="flex justify-between items-center border-b border-border pb-3">
        <h3 className="text-sm font-bold text-text uppercase tracking-wider select-none">
          Memory Details
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 text-text-muted">
          ✕
        </Button>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto no-scrollbar flex-1 pr-1 pb-4">
        {/* Quarantine Banner */}
        {memory.isQuarantined && (
          <div className="flex flex-col gap-2 p-3 bg-red-500/10 border border-red-500/25 rounded-xl text-xs text-text leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold text-red-500">
              <span>⚠️</span> Quarantined Fact
            </div>
            <p className="text-text-muted">
              This memory contains sensitive data and is quarantined. AI agents cannot see it (receives a redacted placeholder) until you explicitly review and unmask it.
            </p>
            <Button
              onClick={() => unmaskMutation.mutate()}
              disabled={unmaskMutation.isPending}
              size="sm"
              className="mt-1 w-full bg-red-600 hover:bg-red-700 text-white font-bold h-8 text-xs"
            >
              {unmaskMutation.isPending ? "Unmasking..." : "🔓 Unmask & Release"}
            </Button>
          </div>
        )}

        {/* Content */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="detail-fact">Fact Content</Label>
          <Textarea
            id="detail-fact"
            value={editFact}
            onChange={(e) => setEditFact(e.target.value)}
            rows={5}
            className="text-xs md:text-sm font-medium leading-relaxed resize-none"
          />
        </div>

        {/* Info selects */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detail-category">Category</Label>
            <Select
              id="detail-category"
              value={editCategory}
              onChange={(e: any) => setEditCategory(e.target.value)}
              className="text-xs h-8"
            >
              <option value="rules">Rules</option>
              <option value="projects">Projects</option>
              <option value="references">References</option>
              <option value="configs">Configs</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detail-tags">Tags</Label>
            <Input
              id="detail-tags"
              type="text"
              value={editTags || ""}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="comma separated"
              className="text-xs h-8"
            />
          </div>
        </div>

        {/* Tag chips */}
        {tagsList.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {tagsList.map((tag) => (
              <span
                key={tag}
                className="inline-block px-2 py-0.5 rounded-sm text-[10px] bg-tag-bg border border-tag-border text-accent select-none font-semibold uppercase"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Authority / Lock info */}
        <div className="flex flex-col gap-2 p-3 bg-surface2 border border-border rounded-lg">
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Memory Authority</span>
          {memory.authorityType === "authoritative" && memory.isLocked ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/25">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-500 shrink-0">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              <span className="text-[11px] font-bold text-amber-500">Authoritative · Locked</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0 ml-0.5">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted">Authority:</span>
                {memory.authorityType === "authoritative" ? (
                  <span className="inline-flex items-center gap-1 bg-amber-500/15 border border-amber-500/30 text-amber-500 text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    Authoritative
                  </span>
                ) : (
                  <span className="text-[10px] text-text-muted font-medium">Contributed</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-text-muted">Locked:</span>
                {memory.isLocked ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-text-muted">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    Yes
                  </span>
                ) : (
                  <span className="text-[10px] text-text-muted font-medium">No</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Last recalled */}
        <div className="flex flex-col gap-2 p-3 bg-surface2 border border-border rounded-lg">
          <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Last Recalled</span>
          <span className="text-[11px] text-text font-medium">
            {memory.lastAccessedAt
              ? new Date(memory.lastAccessedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : "Never"}
          </span>
        </div>

        {/* Change Actions */}
        {hasChanges && (
          <div className="flex gap-2 py-2 mt-1">
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || !editFact.trim()}
              size="sm"
              className="flex-1 text-xs font-bold"
            >
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Button
              onClick={() => {
                setEditFact(memory.fact);
                setEditCategory(memory.category);
                setEditTags(memory.tags);
              }}
              variant="outline"
              size="sm"
              className="text-xs"
            >
              Discard
            </Button>
          </div>
        )}

        <hr className="border-border/60 my-2" />

        {/* Mover */}
        {workspaces.filter((w) => w.key !== currentProjectKey).length > 0 && (
          <div className="flex flex-col gap-1.5">
            <Label>Move to Workspace</Label>
            <div className="flex gap-2">
              <Select
                value={targetWorkspace}
                onChange={(e) => setTargetWorkspace(e.target.value)}
                className="text-xs h-8"
              >
                <option value="">Select workspace...</option>
                {workspaces
                  .filter((w) => w.key !== currentProjectKey)
                  .map((w) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
                    </option>
                  ))}
              </Select>
              <Button
                onClick={() => moveMutation.mutate()}
                disabled={moveMutation.isPending || !targetWorkspace}
                variant="outline"
                size="sm"
                className="h-8 text-xs font-semibold hover:border-accent hover:text-accent"
              >
                Move
              </Button>
            </div>
          </div>
        )}

        {/* Version History list */}
        <div className="flex flex-col gap-2 mt-2">
          <Label>Modification Logs</Label>
          <div className="flex flex-col gap-3 p-3 bg-surface2 border border-border rounded-lg max-h-[220px] overflow-y-auto no-scrollbar">
            {isTimelineLoading && <p className="text-[10px] text-text-muted text-center py-2">Loading timeline...</p>}
            {!isTimelineLoading && versions.length <= 1 && (
              <p className="text-[10px] text-text-muted text-center py-2">No past revisions recorded.</p>
            )}
            {!isTimelineLoading && versions.slice(1).map((v: any) => (
              <div key={v.id} className="border-b border-border/40 pb-2 last:border-0 last:pb-0 text-[11px] leading-relaxed">
                <div className="flex justify-between items-center gap-2 mb-1">
                  <span className="text-[9px] text-accent font-bold uppercase bg-tag-bg border border-tag-border px-1.5 rounded-sm">
                    {v.changeReason || "edited"}
                  </span>
                  <span className="text-[9px] text-text-muted font-medium">
                    {new Date(v.timestamp).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-text-muted break-words italic mb-2 select-text">
                  "{v.fact}"
                </p>
                <Button
                  onClick={() => revertMutation.mutate(v.id)}
                  disabled={revertMutation.isPending}
                  variant="outline"
                  size="sm"
                  className="h-5 text-[9px] px-2 border-accent/20 text-accent-hover hover:bg-accent-dim hover:border-accent/40 font-bold"
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </div>

        <hr className="border-border/60 my-2" />

        {/* Destructive Actions */}
        <div className="flex flex-col gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 mt-2">
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider block">
              Memory Management
            </span>

            {/* Archive */}
            <div className="flex flex-col gap-1.5 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-amber-600">Archive</span>
                <span className="text-[9px] text-amber-600/70 font-mono">recoverable</span>
              </div>
              <p className="text-[10px] text-text-muted leading-relaxed">
                Suspend from active use. Can be restored anytime from archived memories.
              </p>
              <Button
                onClick={() => archiveMutation.mutate()}
                disabled={archiveMutation.isPending}
                variant="outline"
                size="sm"
                className="w-full text-xs border-amber-500/30 text-amber-600 hover:bg-amber-500/10 hover:border-amber-500/40 font-semibold mt-1"
              >
                {archiveMutation.isPending ? "Archiving..." : "📦 Archive Memory"}
              </Button>
            </div>

            {/* Delete */}
            <div className="flex flex-col gap-1.5 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-red-600">Delete</span>
                <span className="text-[9px] text-red-600/70 font-mono">permanent</span>
              </div>
              <p className="text-[10px] text-text-muted leading-relaxed">
                Permanently remove from database. This cannot be undone.
              </p>
              {confirmDelete ? (
                <div className="flex gap-1.5 items-center bg-surface border border-red-500/30 rounded-md p-1.5 mt-1">
                  <span className="text-[10px] text-red-600 font-semibold flex-1">Confirm?</span>
                  <Button
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                    variant="destructive"
                    size="sm"
                    className="h-6 text-[10px] px-2.5 font-bold"
                  >
                    Yes, Delete
                  </Button>
                  <Button
                    onClick={() => setConfirmDelete(false)}
                    variant="outline"
                    size="sm"
                    className="h-6 text-[10px] px-2 border-red-500/20"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  onClick={() => setConfirmDelete(true)}
                  variant="destructive"
                  size="sm"
                  className="w-full text-xs font-semibold mt-1"
                >
                  🗑️ Permanently Delete
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SKELETON LOADERS ───────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 flex flex-col gap-3 animate-pulse">
      <div className="flex items-center justify-between gap-2">
        <div className="h-3 w-16 rounded-full bg-surface2" />
        <div className="h-3 w-8 rounded-full bg-surface2" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-2.5 w-full rounded-full bg-surface2" />
        <div className="h-2.5 w-4/5 rounded-full bg-surface2" />
        <div className="h-2.5 w-2/3 rounded-full bg-surface2" />
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <div className="h-4 w-10 rounded-sm bg-surface2" />
        <div className="h-4 w-14 rounded-sm bg-surface2" />
      </div>
    </div>
  );
}

function SkeletonListRow({ idx }: { idx: number }) {
  const widths = ["w-2/3", "w-3/4", "w-1/2", "w-4/5", "w-3/5"];
  return (
    <div className={`flex items-center gap-3 px-3 h-11 animate-pulse ${idx > 0 ? "border-t border-border" : ""}`}>
      <div className="h-3.5 w-3.5 shrink-0 rounded-sm bg-surface2" />
      <div className="w-2 h-2 rounded-full shrink-0 bg-surface2" />
      <div className={`flex-1 h-2.5 rounded-full bg-surface2 ${widths[idx % widths.length]}`} />
      <div className="hidden sm:flex items-center gap-1 shrink-0">
        <div className="h-4 w-10 rounded-sm bg-surface2" />
        <div className="h-4 w-12 rounded-sm bg-surface2" />
      </div>
      <div className="h-2.5 w-20 rounded-full bg-surface2 hidden md:block" />
    </div>
  );
}

function SkeletonTableRow({ idx }: { idx: number }) {
  const widths = ["w-3/4", "w-1/2", "w-2/3", "w-4/5", "w-3/5"];
  return (
    <tr className={`animate-pulse ${idx > 0 ? "border-t border-border" : ""}`}>
      <td className="px-3 py-2.5"><div className="h-3.5 w-3.5 rounded-sm bg-surface2" /></td>
      <td className="px-3 py-2.5"><div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-surface2" /><div className="h-2.5 w-16 rounded-full bg-surface2" /></div></td>
      <td className="px-3 py-2.5"><div className={`h-2.5 rounded-full bg-surface2 ${widths[idx % widths.length]}`} /></td>
      <td className="px-3 py-2.5 hidden sm:table-cell"><div className="flex gap-1"><div className="h-4 w-10 rounded-sm bg-surface2" /><div className="h-4 w-14 rounded-sm bg-surface2" /></div></td>
      <td className="px-3 py-2.5 hidden md:table-cell"><div className="h-2.5 w-20 rounded-full bg-surface2" /></td>
      <td className="px-3 py-2.5"><div className="h-6 w-6 rounded-md bg-surface2" /></td>
    </tr>
  );
}

function MemorySkeletonLoader({ viewMode }: { viewMode: ViewMode }) {
  const count = 8;
  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }
  if (viewMode === "list") {
    return (
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {Array.from({ length: count }).map((_, i) => <SkeletonListRow key={i} idx={i} />)}
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-surface2 border-b border-border animate-pulse">
              <th className="w-8 px-3 py-2"><div className="h-3.5 w-3.5 rounded-sm bg-surface2" /></th>
              {["Category", "Fact", "Tags", "Created"].map((h) => (
                <th key={h} className="px-3 py-2 text-left"><div className="h-2.5 w-16 rounded-full bg-border" /></th>
              ))}
              <th className="w-8 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: count }).map((_, i) => <SkeletonTableRow key={i} idx={i} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── CATEGORY FILTER BAR ────────────────────────────────────────────────────
const FILTER_BAR_CATEGORIES = [
  { label: "All", value: "", dot: "" },
  { label: "Rules", value: "rules", dot: "bg-indigo-400" },
  { label: "Projects", value: "projects", dot: "bg-emerald-400" },
  { label: "References", value: "references", dot: "bg-amber-400" },
  { label: "Configs", value: "configs", dot: "bg-purple-400" },
];

function CategoryFilterBar({
  value,
  onChange,
  counts,
}: {
  value: string;
  onChange: (cat: string) => void;
  counts: Record<string, number>;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap select-none" role="group" aria-label="Filter by category">
      {FILTER_BAR_CATEGORIES.map((cat) => {
        const isActive = value === cat.value;
        const count = cat.value === "" ? Object.values(counts).reduce((s, n) => s + n, 0) : (counts[cat.value] ?? 0);
        return (
          <button
            key={cat.value}
            type="button"
            onClick={() => onChange(isActive && cat.value !== "" ? "" : cat.value)}
            aria-pressed={isActive}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border transition-all duration-150 ${
              isActive
                ? "bg-accent text-white border-accent shadow-sm"
                : "bg-surface border-border text-text-muted hover:border-accent/40 hover:text-text"
            }`}
          >
            {cat.dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cat.dot}`} />}
            {cat.label}
            <span className={`text-[10px] font-bold tabular-nums ${isActive ? "text-white/80" : "text-text-muted"}`}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── MEMORIES TABLE ─────────────────────────────────────────────────────────
type ViewMode = "grid" | "list" | "table";

const VIEW_ICONS = {
  grid: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  ),
  list: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  ),
  table: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="9" x2="9" y2="21" />
    </svg>
  ),
};

const CATEGORY_DOT_COLORS: Record<string, string> = {
  rules: "bg-indigo-400",
  projects: "bg-emerald-400",
  references: "bg-amber-400",
  configs: "bg-purple-400",
};

function MemoryTable({
  memories,
  filter,
  categoryFilter,
  onCategoryChange,
  sortBy,
  dateStart,
  dateEnd,
  onShowHistory,
  onExportZip,
  workspaces = [],
  currentProjectKey = "personal",
  isSemanticResults = false,
  viewMode,
  onViewModeChange,
}: {
  memories: Memory[];
  filter: string;
  categoryFilter: string;
  onCategoryChange?: (cat: string) => void;
  sortBy: 'newest' | 'oldest' | 'alphabetical' | 'stale';
  dateStart: string;
  dateEnd: string;
  onShowHistory: (id: string) => void;
  onExportZip: () => void;
  workspaces?: any[];
  currentProjectKey?: string;
  isSemanticResults?: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkTargetWorkspace, setBulkTargetWorkspace] = useState("");
  const [exportMemory, setExportMemory] = useState<Memory | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);
  const [tableSortCol, setTableSortCol] = useState<"category" | "fact" | "created">("created");
  const [tableSortDir, setTableSortDir] = useState<"asc" | "desc">("desc");
  const [keyboardDeleteConfirm, setKeyboardDeleteConfirm] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const [activeSelectedId, setActiveSelectedId] = useState<string | null>(null);

  const PAGE_SIZE = 20;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  function handleExport(itemsToExport: Memory[], format: "json" | "md") {
    if (format === "json") {
      const jsonContent = exportToJson(itemsToExport);
      downloadFile(jsonContent, `locker_memories_${new Date().toISOString().split("T")[0]}.json`, "application/json");
    } else {
      const mdContent = exportToMarkdown(itemsToExport);
      downloadFile(mdContent, `locker_memories_${new Date().toISOString().split("T")[0]}.md`, "text/markdown");
    }
  }

  const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    const startDate = dateStart ? new Date(dateStart).getTime() : null;
    const endDate = dateEnd ? new Date(dateEnd).getTime() : null;

    let results = memories.filter((m) => {
      const matchesCat = !categoryFilter || m.category === categoryFilter;
      const matchesText =
        !q ||
        m.fact.toLowerCase().includes(q) ||
        (m.tags?.toLowerCase().includes(q) ?? false);
      const mTime = new Date(m.timestamp).getTime();
      const matchesDate =
        (!startDate || mTime >= startDate) &&
        (!endDate || mTime <= endDate + 86400000);
      const matchesStale =
        sortBy !== "stale" ||
        !m.lastAccessedAt ||
        Date.now() - m.lastAccessedAt > STALE_THRESHOLD_MS;
      return matchesCat && matchesText && matchesDate && matchesStale;
    });

    if (sortBy === 'newest') {
      results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } else if (sortBy === 'oldest') {
      results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } else if (sortBy === 'alphabetical') {
      results.sort((a, b) => a.fact.localeCompare(b.fact));
    } else if (sortBy === 'stale') {
      results.sort((a, b) => (a.lastAccessedAt ?? 0) - (b.lastAccessedAt ?? 0));
    }

    return results;
  }, [memories, filter, categoryFilter, sortBy, dateStart, dateEnd]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter, categoryFilter, sortBy, dateStart, dateEnd]);

  const visibleMemories = useMemo(() => {
    return filtered.slice(0, visibleCount);
  }, [filtered, visibleCount]);

  const activeMemory = useMemo(() => {
    return filtered.find((m) => m.id === activeSelectedId) || null;
  }, [filtered, activeSelectedId]);

  const keyboardDeleteMutation = useMutation({
    mutationFn: (id: string) => deleteMemory({ data: { id } }),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.filter((m) => m.id !== id) : []
      );
      setFocusedId(null);
      setKeyboardDeleteConfirm(false);
      toast.success("Memory deleted.");
    },
    onError: (err: any) => {
      toast.error("Failed to delete: " + String(err.message || err));
      setKeyboardDeleteConfirm(false);
    },
  });

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Drawer open: Escape closes it, everything else is suppressed so the
      // user can interact with drawer fields without unintended navigation.
      if (activeSelectedId) {
        if (e.key === "Escape") {
          setActiveSelectedId(null);
          setFocusedId(null);
          setKeyboardDeleteConfirm(false);
        }
        return;
      }

      // No drawer — navigate the list with arrow keys
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const currentIdx = focusedId ? filtered.findIndex((m) => m.id === focusedId) : -1;
        let nextIdx: number;
        if (e.key === "ArrowDown") {
          nextIdx = currentIdx < filtered.length - 1 ? currentIdx + 1 : 0;
        } else {
          nextIdx = currentIdx > 0 ? currentIdx - 1 : filtered.length - 1;
        }
        const next = filtered[nextIdx];
        if (next) {
          setFocusedId(next.id);
          setKeyboardDeleteConfirm(false);
          if (nextIdx >= visibleCount - 1) setVisibleCount((v) => Math.min(v + PAGE_SIZE, filtered.length));
        }
        return;
      }

      // Enter opens the drawer for the focused row
      if (e.key === "Enter" && focusedId) {
        e.preventDefault();
        setActiveSelectedId(focusedId);
        setKeyboardDeleteConfirm(false);
        return;
      }

      // Delete: first press arms confirmation, second press fires
      if (e.key === "Delete" && focusedId) {
        e.preventDefault();
        if (keyboardDeleteConfirm) {
          keyboardDeleteMutation.mutate(focusedId);
        } else {
          setKeyboardDeleteConfirm(true);
        }
        return;
      }

      if (e.key === "Escape" && keyboardDeleteConfirm) {
        setKeyboardDeleteConfirm(false);
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [filtered, activeSelectedId, focusedId, visibleCount, keyboardDeleteConfirm, keyboardDeleteMutation]);

  const hasMore = visibleCount < filtered.length;

  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      if (node && hasMore) {
        observerRef.current = new IntersectionObserver(
          (entries) => {
            if (entries[0].isIntersecting) {
              setVisibleCount((prev) => prev + PAGE_SIZE);
            }
          },
          { threshold: 0.1, rootMargin: "150px" }
        );
        observerRef.current.observe(node);
      }
    },
    [hasMore]
  );

  const filteredIds = useMemo(() => new Set(filtered.map((m) => m.id)), [filtered]);
  const allSelected = filtered.length > 0 && filtered.every((m) => selected.has(m.id));
  const someSelected = filtered.some((m) => selected.has(m.id));
  const selectedInView = filtered.filter((m) => selected.has(m.id));

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => bulkDeleteMemories({ data: { ids } }),
    onMutate: (ids) => {
      const idSet = new Set(ids);
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.filter((m) => !idSet.has(m.id)) : []
      );
      setSelected(new Set());
      setBulkConfirming(false);
      setActiveSelectedId(null);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  const bulkMoveMutation = useMutation({
    mutationFn: (ids: string[]) => moveMemories({ data: { ids, targetProjectKey: bulkTargetWorkspace } }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setSelected(new Set());
      setBulkMoving(false);
      setBulkTargetWorkspace("");
      setActiveSelectedId(null);
      toast.success(`Successfully moved ${res.moved} memories.`);
    },
    onError: (err: Error) => {
      toast.error("Failed to move memories: " + err.message);
    },
  });

  function toggleSelectAll() {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  if (filtered.length === 0) {
    return (
      <div className="text-center py-16 px-4 text-text-muted bg-surface border border-border rounded-xl">
        {memories.length === 0 ? "No memories stored yet." : "No memories match your filters."}
      </div>
    );
  }

  const percentLoaded = Math.min(100, Math.floor((visibleMemories.length / filtered.length) * 100));

  return (
    <div className="flex flex-col gap-6">
      {/* Controls toolbar */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-xs select-none">
        <div className="p-3 border-b border-border flex items-center gap-3 bg-surface2 flex-wrap text-xs md:text-sm">
          <input
            type="checkbox"
            checked={allSelected}
            ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
            onChange={toggleSelectAll}
            className="cursor-pointer h-4 w-4 rounded-sm border-border text-accent focus:ring-accent accent-accent"
          />
          {someSelected ? (
            <>
              <span className="text-text-muted font-medium">
                {selectedInView.length} selected
              </span>
              {bulkConfirming ? (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-error font-semibold text-xs">
                    Delete {selectedInView.length} entries?
                  </span>
                  <Button
                    onClick={() => bulkDeleteMutation.mutate(selectedInView.map((m) => m.id))}
                    disabled={bulkDeleteMutation.isPending}
                    variant="destructive"
                    size="sm"
                    className="h-7 text-xs font-bold px-3"
                  >
                    {bulkDeleteMutation.isPending ? "Deleting…" : "Yes, delete"}
                  </Button>
                  <Button
                    onClick={() => setBulkConfirming(false)}
                    disabled={bulkDeleteMutation.isPending}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2.5"
                  >
                    Cancel
                  </Button>
                </div>
              ) : bulkMoving ? (
                <div className="flex items-center gap-2 ml-auto">
                  <span className="text-text-muted text-xs">Move to:</span>
                  <Select
                    value={bulkTargetWorkspace}
                    onChange={(e) => setBulkTargetWorkspace(e.target.value)}
                    className="h-7 text-xs py-0 px-2 max-w-[150px]"
                  >
                    <option value="">Select locker...</option>
                    {workspaces
                      .filter((w) => w.key !== currentProjectKey)
                      .map((w) => (
                        <option key={w.key} value={w.key}>
                          {w.label}
                        </option>
                      ))}
                  </Select>
                  <Button
                    onClick={() => bulkMoveMutation.mutate(selectedInView.map((m) => m.id))}
                    disabled={bulkMoveMutation.isPending || !bulkTargetWorkspace}
                    size="sm"
                    className="h-7 text-xs font-bold"
                  >
                    {bulkMoveMutation.isPending ? "Moving…" : "Move"}
                  </Button>
                  <Button
                    onClick={() => { setBulkMoving(false); setBulkTargetWorkspace(""); }}
                    disabled={bulkMoveMutation.isPending}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs px-2"
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                  <Button variant="outline" size="sm" className="h-7 text-xs font-semibold" onClick={() => handleExport(selectedInView, "json")}>
                    Export JSON
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs font-semibold" onClick={() => handleExport(selectedInView, "md")}>
                    Export MD
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs font-semibold" onClick={onExportZip}>
                    Export Zip
                  </Button>
                  {workspaces.filter((w) => w.key !== currentProjectKey).length > 0 && (
                    <Button variant="outline" size="sm" className="h-7 text-xs font-semibold" onClick={() => setBulkMoving(true)}>
                      Move Selected
                    </Button>
                  )}
                  <Button variant="destructive" size="sm" className="h-7 text-xs font-bold" onClick={() => setBulkConfirming(true)}>
                    Delete Selected
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <span className="text-text-muted font-medium">
                {filtered.length} active memories
              </span>
              <div className="ml-auto flex items-center gap-1.5 flex-wrap">
                {/* View mode toggle */}
                <div className="flex items-center border border-border rounded-lg overflow-hidden bg-surface2 mr-1">
                  {(["grid", "list", "table"] as ViewMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      title={`${mode.charAt(0).toUpperCase() + mode.slice(1)} view`}
                      onClick={() => onViewModeChange(mode)}
                      className={`h-7 w-7 flex items-center justify-center transition-colors ${
                        viewMode === mode
                          ? "bg-accent text-white"
                          : "text-text-muted hover:text-text hover:bg-surface"
                      }`}
                    >
                      {VIEW_ICONS[mode]}
                    </button>
                  ))}
                </div>
                {filtered.length > 0 && (
                  <>
                    <Button variant="outline" size="sm" className="h-7 text-xs font-semibold" onClick={() => handleExport(filtered, "json")}>
                      Export JSON
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs font-semibold" onClick={() => handleExport(filtered, "md")}>
                      Export MD
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 text-xs font-semibold" onClick={onExportZip}>
                      Export Zip
                    </Button>
                    <Button
                      onClick={() => {
                        setSelected(new Set(filtered.map((m) => m.id)));
                        setBulkConfirming(true);
                      }}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs font-semibold border-error/20 text-error hover:bg-error/5 hover:border-error/30"
                    >
                      Delete All
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
        <div className="py-2 px-4 flex justify-between items-center text-xs">
          <span className="text-text-muted font-semibold">
            Showing {visibleMemories.length} of {filtered.length} entries
          </span>
          <div className="w-20 h-1 bg-surface2 rounded-full overflow-hidden">
            <div className="h-full bg-accent transition-all duration-200" style={{ width: `${percentLoaded}%` }} />
          </div>
        </div>
      </div>

      {/* Keyboard delete confirmation prompt */}
      {keyboardDeleteConfirm && focusedId && (() => {
        const focusedMemory = filtered.find((m) => m.id === focusedId);
        return focusedMemory ? (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs animate-in fade-in duration-150">
            <span className="text-red-500 font-semibold flex-1 min-w-0 truncate">
              Press <kbd className="font-mono bg-red-500/15 border border-red-500/25 px-1.5 py-0.5 rounded text-[10px]">Delete</kbd> again to permanently delete, or{" "}
              <kbd className="font-mono bg-surface border border-border px-1.5 py-0.5 rounded text-[10px]">Esc</kbd> to cancel.
            </span>
            <Button
              onClick={() => keyboardDeleteMutation.mutate(focusedMemory.id)}
              disabled={keyboardDeleteMutation.isPending}
              variant="destructive"
              size="sm"
              className="h-7 text-xs font-bold shrink-0"
            >
              {keyboardDeleteMutation.isPending ? "Deleting..." : "Confirm Delete"}
            </Button>
            <Button
              onClick={() => setKeyboardDeleteConfirm(false)}
              variant="outline"
              size="sm"
              className="h-7 text-xs shrink-0"
            >
              Cancel
            </Button>
          </div>
        ) : null;
      })()}

      {/* Category filter bar */}
      {!isSemanticResults && onCategoryChange && (
        <CategoryFilterBar
          value={categoryFilter}
          onChange={onCategoryChange}
          counts={{
            rules: memories.filter((m) => m.category === "rules").length,
            projects: memories.filter((m) => m.category === "projects").length,
            references: memories.filter((m) => m.category === "references").length,
            configs: memories.filter((m) => m.category === "configs").length,
          }}
        />
      )}

      {/* ── GRID VIEW ── */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {visibleMemories.map((m) => (
            <MemoryCard
              key={m.id}
              memory={m}
              selected={selected.has(m.id)}
              onToggleSelect={toggleOne}
              onExport={(mem) => { setExportMemory(mem); setShowExportModal(true); }}
              workspaces={workspaces}
              currentProjectKey={currentProjectKey}
              isSelected={activeSelectedId === m.id}
              isFocused={focusedId === m.id && activeSelectedId !== m.id}
              onSelect={() => { setFocusedId(m.id); setActiveSelectedId(m.id); }}
            />
          ))}
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {viewMode === "list" && (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          {visibleMemories.map((m, idx) => {
            const tags = m.tags ? m.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
            const isActive = activeSelectedId === m.id;
            const isFocusedRow = focusedId === m.id && !isActive;
            return (
              <div
                key={m.id}
                onClick={() => { setFocusedId(m.id); setActiveSelectedId(m.id); }}
                className={`flex items-center gap-3 px-3 h-11 cursor-pointer select-none transition-colors ${
                  idx < visibleMemories.length - 1 ? "border-b border-border" : ""
                } ${isActive ? "bg-accent/8 border-l-2 border-l-accent" : isFocusedRow ? "bg-accent/4 border-l-2 border-l-accent/40" : "hover:bg-surface2"}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(m.id)}
                  onChange={(e) => { e.stopPropagation(); toggleOne(m.id); }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-3.5 w-3.5 shrink-0 rounded-sm border-border text-accent accent-accent cursor-pointer"
                />
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${CATEGORY_DOT_COLORS[m.category] ?? "bg-text-muted"}`}
                  title={m.category}
                />
                <span className="flex-1 text-xs font-medium text-text truncate min-w-0">
                  {m.fact}
                </span>
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                  {tags.slice(0, 3).map((tag) => (
                    <span
                      key={tag}
                      className="px-1.5 py-0.5 rounded-sm text-[10px] bg-tag-bg border border-tag-border text-text-muted font-medium"
                    >
                      {tag}
                    </span>
                  ))}
                  {tags.length > 3 && (
                    <span className="text-[10px] text-text-muted">+{tags.length - 3}</span>
                  )}
                </div>
                <span className="text-[10px] text-text-muted shrink-0 hidden md:block">
                  {new Date(m.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
                <button
                  type="button"
                  title="Open details"
                  onClick={(e) => { e.stopPropagation(); setFocusedId(m.id); setActiveSelectedId(m.id); }}
                  className="shrink-0 h-6 w-6 flex items-center justify-center text-text-muted hover:text-text rounded-md hover:bg-surface transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── TABLE VIEW ── */}
      {viewMode === "table" && (() => {
        function toggleTableSort(col: "category" | "fact" | "created") {
          if (tableSortCol === col) {
            setTableSortDir((d) => d === "asc" ? "desc" : "asc");
          } else {
            setTableSortCol(col);
            setTableSortDir("asc");
          }
        }

        const sorted = [...visibleMemories].sort((a, b) => {
          let cmp = 0;
          if (tableSortCol === "category") cmp = a.category.localeCompare(b.category);
          else if (tableSortCol === "fact") cmp = a.fact.localeCompare(b.fact);
          else cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          return tableSortDir === "asc" ? cmp : -cmp;
        });

        const SortIcon = ({ col }: { col: "category" | "fact" | "created" }) => (
          <svg
            width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
            className={`inline ml-1 transition-opacity ${tableSortCol === col ? "opacity-100" : "opacity-30"}`}
          >
            {tableSortCol === col && tableSortDir === "desc"
              ? <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></>
              : <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="5 12 12 5 19 12" /></>
            }
          </svg>
        );

        return (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-surface2 border-b border-border">
                    <th className="w-8 px-3 py-2 text-left">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                        onChange={toggleSelectAll}
                        className="h-3.5 w-3.5 rounded-sm border-border text-accent accent-accent cursor-pointer"
                      />
                    </th>
                    <th
                      className="px-3 py-2 text-left font-bold text-text-muted uppercase tracking-wider text-[10px] cursor-pointer hover:text-text select-none whitespace-nowrap"
                      onClick={() => toggleTableSort("category")}
                    >
                      Category<SortIcon col="category" />
                    </th>
                    <th
                      className="px-3 py-2 text-left font-bold text-text-muted uppercase tracking-wider text-[10px] cursor-pointer hover:text-text select-none"
                      onClick={() => toggleTableSort("fact")}
                    >
                      Fact<SortIcon col="fact" />
                    </th>
                    <th className="px-3 py-2 text-left font-bold text-text-muted uppercase tracking-wider text-[10px] select-none hidden sm:table-cell">
                      Tags
                    </th>
                    <th
                      className="px-3 py-2 text-left font-bold text-text-muted uppercase tracking-wider text-[10px] cursor-pointer hover:text-text select-none whitespace-nowrap hidden md:table-cell"
                      onClick={() => toggleTableSort("created")}
                    >
                      Created<SortIcon col="created" />
                    </th>
                    <th className="w-8 px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((m, idx) => {
                    const tags = m.tags ? m.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
                    const isActive = activeSelectedId === m.id;
                    const isFocusedRow = focusedId === m.id && !isActive;
                    return (
                      <tr
                        key={m.id}
                        onClick={() => { setFocusedId(m.id); setActiveSelectedId(m.id); }}
                        className={`cursor-pointer transition-colors ${idx < sorted.length - 1 ? "border-b border-border" : ""} ${
                          isActive ? "bg-accent/8" : isFocusedRow ? "bg-accent/4" : "hover:bg-surface2"
                        }`}
                      >
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected.has(m.id)}
                            onChange={() => toggleOne(m.id)}
                            className="h-3.5 w-3.5 rounded-sm border-border text-accent accent-accent cursor-pointer"
                          />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className={`w-2 h-2 rounded-full shrink-0 ${CATEGORY_DOT_COLORS[m.category] ?? "bg-text-muted"}`} />
                            <span className="font-semibold text-text capitalize">{m.category}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 max-w-xs">
                          <span className="text-text font-medium line-clamp-1 block">{m.fact}</span>
                        </td>
                        <td className="px-3 py-2 hidden sm:table-cell">
                          <div className="flex items-center gap-1 flex-wrap">
                            {tags.slice(0, 3).map((tag) => (
                              <span key={tag} className="px-1.5 py-0.5 rounded-sm text-[10px] bg-tag-bg border border-tag-border text-text-muted font-medium whitespace-nowrap">
                                {tag}
                              </span>
                            ))}
                            {tags.length > 3 && <span className="text-[10px] text-text-muted">+{tags.length - 3}</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-text-muted whitespace-nowrap hidden md:table-cell">
                          {new Date(m.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </td>
                        <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            title="Open details"
                            onClick={() => { setFocusedId(m.id); setActiveSelectedId(m.id); }}
                            className="h-6 w-6 flex items-center justify-center text-text-muted hover:text-text rounded-md hover:bg-surface transition-colors"
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Sentinel loading more */}
      {hasMore && (
        <div ref={sentinelRef} className="p-5 flex justify-center items-center border border-border rounded-xl bg-surface2">
          <Button
            onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
            variant="outline"
            className="flex items-center gap-2 select-none"
          >
            <span className="w-3.5 h-3.5 border-2 border-text-muted border-t-transparent rounded-full animate-spin" />
            Loading more memories...
          </Button>
        </div>
      )}

      {!hasMore && filtered.length > 0 && (
        <div className="py-6 px-4 text-center border border-border rounded-xl text-text-muted bg-surface2 flex flex-col items-center gap-1.5 select-none">
          <LockerPadlock size={14} />
          <span className="text-[11px] font-semibold">Vault list fully loaded ({filtered.length} entries)</span>
        </div>
      )}

      {/* Side details drawer overlay */}
      {activeMemory && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-xs flex justify-end animate-in fade-in duration-200"
          onClick={() => setActiveSelectedId(null)}
        >
          <div
            className="w-full max-w-[480px] h-screen bg-surface border-l border-border shadow-2xl p-6 flex flex-col justify-between animate-in slide-in-from-right duration-350 cubic-bezier(0.16, 1, 0.3, 1)"
            onClick={(e) => e.stopPropagation()}
          >
            <MemoryDetailPanel
              memory={activeMemory}
              onClose={() => setActiveSelectedId(null)}
              workspaces={workspaces}
              currentProjectKey={currentProjectKey}
            />
          </div>
        </div>
      )}

      {showExportModal && exportMemory && (
        <ExportMemoryModal
          memory={exportMemory}
          allMemories={memories}
          onClose={() => { setShowExportModal(false); setExportMemory(null); }}
        />
      )}
    </div>
  );
}

// ── CONFLICTS TAB COMPONENTS ─────────────────────────────────────────────────

type DiffToken =
  | { kind: "same"; text: string }
  | { kind: "add"; text: string }
  | { kind: "remove"; text: string };

function diffWords(original: string, proposed: string): DiffToken[] {
  const oldWords = original.split(/(\s+)/);
  const newWords = proposed.split(/(\s+)/);
  const m = oldWords.length;
  const n = newWords.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (oldWords[i] === newWords[j]) {
        dp[i][j] = 1 + dp[i + 1][j + 1];
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }
  const tokens: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldWords[i] === newWords[j]) {
      tokens.push({ kind: "same", text: oldWords[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      tokens.push({ kind: "remove", text: oldWords[i] });
      i++;
    } else {
      tokens.push({ kind: "add", text: newWords[j] });
      j++;
    }
  }
  while (i < m) { tokens.push({ kind: "remove", text: oldWords[i++] }); }
  while (j < n) { tokens.push({ kind: "add", text: newWords[j++] }); }
  return tokens;
}

function InlineDiff({ original, proposed }: { original: string; proposed: string }) {
  const tokens = diffWords(original, proposed);
  return (
    <p className="text-sm leading-relaxed font-mono whitespace-pre-wrap break-words">
      {tokens.map((tok, idx) => {
        if (tok.kind === "same") return <span key={idx}>{tok.text}</span>;
        if (tok.kind === "remove") return (
          <span key={idx} style={{ background: "rgba(239,68,68,0.18)", color: "var(--error, #ef4444)", textDecoration: "line-through", borderRadius: 3, padding: "0 1px" }}>{tok.text}</span>
        );
        return (
          <span key={idx} style={{ background: "rgba(34,197,94,0.18)", color: "var(--success, #22c55e)", borderRadius: 3, padding: "0 1px" }}>{tok.text}</span>
        );
      })}
    </p>
  );
}

function ConflictDiffPanel({
  originalFact, proposedFact, originalCategory, proposedCategory, originalTags, proposedTags, type,
}: {
  originalFact: string; proposedFact?: string | null; originalCategory: string;
  proposedCategory?: string | null; originalTags: string; proposedTags?: string | null;
  type: "update" | "delete";
}) {
  const panelBase: React.CSSProperties = {
    flex: 1, minWidth: 0, border: "1px solid var(--border)", borderRadius: "var(--radius, 8px)",
    padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10,
  };

  if (type === "delete") {
    return (
      <div className="flex gap-3 flex-col sm:flex-row">
        <div style={{ ...panelBase, background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.3)" }}>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--error, #ef4444)", display: "inline-block" }} />
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--error, #ef4444)" }}>Current (will be deleted)</span>
          </div>
          <p className="text-sm leading-relaxed font-mono whitespace-pre-wrap break-words text-text">{originalFact}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Badge variant="secondary" className="text-xs">{originalCategory}</Badge>
            {originalTags && originalTags.split(",").map((t) => t.trim()).filter(Boolean).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
          </div>
        </div>
        <div className="hidden sm:flex items-center justify-center text-text-muted text-lg font-light">→</div>
        <div style={{ ...panelBase, background: "rgba(239,68,68,0.04)", borderColor: "rgba(239,68,68,0.2)", opacity: 0.65 }}>
          <div className="flex items-center gap-2 mb-1">
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--text-muted)", display: "inline-block" }} />
            <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">After deletion</span>
          </div>
          <p className="text-sm text-text-muted italic">Memory will be permanently removed.</p>
        </div>
      </div>
    );
  }

  const catChanged = proposedCategory && proposedCategory !== originalCategory;
  const tagsChanged = proposedTags !== undefined && proposedTags !== null && proposedTags !== originalTags;

  return (
    <div className="flex gap-3 flex-col sm:flex-row">
      <div style={{ ...panelBase, background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.25)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--error, #ef4444)", display: "inline-block" }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--error, #ef4444)" }}>Original</span>
        </div>
        <p className="text-sm leading-relaxed font-mono whitespace-pre-wrap break-words text-text">{originalFact}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant="secondary" className="text-xs">{originalCategory}</Badge>
          {originalTags && originalTags.split(",").map((t) => t.trim()).filter(Boolean).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
          ))}
        </div>
      </div>
      <div className="hidden sm:flex items-center justify-center text-text-muted text-lg font-light">→</div>
      <div style={{ ...panelBase, background: "rgba(34,197,94,0.05)", borderColor: "rgba(34,197,94,0.25)" }}>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--success, #22c55e)", display: "inline-block" }} />
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--success, #22c55e)" }}>Proposed</span>
        </div>
        <InlineDiff original={originalFact} proposed={proposedFact ?? ""} />
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <Badge variant="secondary" className={`text-xs ${catChanged ? "ring-1 ring-amber-400" : ""}`}>
            {proposedCategory ?? originalCategory}
            {catChanged && <span className="ml-1 opacity-60 text-[10px]">(changed)</span>}
          </Badge>
          {(proposedTags ?? originalTags) && (proposedTags ?? originalTags).split(",").map((t) => t.trim()).filter(Boolean).map((tag) => (
            <Badge key={tag} variant="secondary" className={`text-xs ${tagsChanged ? "ring-1 ring-amber-400/60" : ""}`}>{tag}</Badge>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConflictCard({ rec, onResolved }: { rec: any; onResolved: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [reviewNotes, setReviewNotes] = useState("");
  const [expanded, setExpanded] = useState(true);

  const reviewMutation = useMutation({
    mutationFn: (action: "approve" | "reject") =>
      reviewMemoryRecommendation({ data: { id: rec.id, action, reviewNotes: reviewNotes || undefined } }),
    onSuccess: (_, action) => {
      queryClient.invalidateQueries({ queryKey: ["conflicts"] });
      toast.success(action === "approve" ? "Change approved and applied." : "Change rejected.");
      onResolved();
    },
    onError: (err: any) => {
      toast.error("Failed: " + String(err.message ?? err));
    },
  });

  const isDelete = rec.recommendationType === "delete";
  const typeLabel = isDelete ? "Deletion Request" : "Update Request";
  const typeColor = isDelete ? "var(--error, #ef4444)" : "var(--warning, #f59e0b)";

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius, 8px)", overflow: "hidden", background: "var(--surface)" }}>
      <div
        className="flex items-start justify-between gap-3 px-4 py-3 cursor-pointer select-none"
        style={{ borderBottom: expanded ? "1px solid var(--border)" : "none", background: "var(--surface2, var(--surface))" }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-start gap-3 min-w-0">
          <span style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: "50%",
            background: isDelete ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)",
            color: typeColor, flexShrink: 0, marginTop: 2,
          }}>
            {isDelete ? (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            ) : (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            )}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-text">{typeLabel}</span>
              {rec.agentContext && <Badge variant="secondary" className="text-[11px] font-normal">{rec.agentContext}</Badge>}
              <Badge variant="secondary" className="text-[11px] font-normal">{rec.category}</Badge>
            </div>
            <div className="text-xs text-text-muted mt-0.5 truncate max-w-md">
              {new Date(rec.createdAt).toLocaleString()}
              {rec.targetMemoryId && <span className="ml-2 opacity-50 font-mono">#{rec.targetMemoryId.slice(0, 8)}</span>}
            </div>
          </div>
        </div>
        <span className="text-text-muted text-xs mt-1 flex-shrink-0">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="p-4 flex flex-col gap-4">
          <ConflictDiffPanel
            originalFact={rec.fact}
            proposedFact={isDelete ? null : rec.proposedFact}
            originalCategory={rec.category}
            proposedCategory={isDelete ? null : rec.proposedCategory}
            originalTags={rec.tags}
            proposedTags={isDelete ? null : rec.proposedTags}
            type={isDelete ? "delete" : "update"}
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-muted">Review notes (optional)</label>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Add a note about this decision..."
              rows={2}
              maxLength={1000}
              style={{
                background: "var(--surface2, var(--surface))", border: "1px solid var(--border)",
                borderRadius: "var(--radius, 6px)", padding: "8px 10px", fontSize: 13,
                color: "var(--text)", resize: "vertical", outline: "none", width: "100%", fontFamily: "inherit",
              }}
            />
          </div>
          <div className="flex items-center gap-2 justify-end">
            <Button
              variant="outline" size="sm"
              onClick={() => reviewMutation.mutate("reject")}
              disabled={reviewMutation.isPending}
              style={{ borderColor: "rgba(239,68,68,0.4)", color: "var(--error, #ef4444)" }}
            >
              {reviewMutation.isPending ? "..." : "Reject"}
            </Button>
            <Button
              size="sm"
              onClick={() => reviewMutation.mutate("approve")}
              disabled={reviewMutation.isPending}
              style={{ background: "var(--success, #22c55e)", color: "#fff", borderColor: "transparent" }}
            >
              {reviewMutation.isPending ? "..." : isDelete ? "Approve deletion" : "Approve update"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN DASHBOARD ──────────────────────────────────────────────────────────
type DashboardTab = "memories" | "knowledge-graph" | "contributions" | "conflicts" | "health";

function Dashboard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [projectKey, setProjectKey] = useState("personal");
  const [showNewMemoryModal, setShowNewMemoryModal] = useState(false);
  const [showAgentConfigBuilder, setShowAgentConfigBuilder] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DashboardTab>("memories");
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);
  const [selectedContributionDate, setSelectedContributionDate] = useState<Date | null>(null);

  useEffect(() => {
    if (activeTab === "contributions") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      setSelectedContributionDate(new Date(today));
    }
  }, [activeTab]);

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("locker-view-mode");
      if (saved === "grid" || saved === "list" || saved === "table") return saved;
    }
    return "grid";
  });

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("locker-view-mode", mode);
    }
  }

  // Filter conditions
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'alphabetical' | 'stale'>('newest');
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Semantic search state
  const [semanticMode, setSemanticMode] = useState(false);
  const [allWorkspacesSearch, setAllWorkspacesSearch] = useState(false);
  const [debouncedSemanticQuery, setDebouncedSemanticQuery] = useState("");
  const semanticDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!semanticMode || !searchQuery.trim()) {
      setDebouncedSemanticQuery("");
      return;
    }
    if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
    semanticDebounceRef.current = setTimeout(() => {
      setDebouncedSemanticQuery(searchQuery.trim());
    }, 400);
    return () => {
      if (semanticDebounceRef.current) clearTimeout(semanticDebounceRef.current);
    };
  }, [searchQuery, semanticMode]);

  const {
    data: semanticResults,
    isFetching: isSemanticFetching,
  } = useQuery({
    queryKey: ["semantic-search", debouncedSemanticQuery, projectKey, allWorkspacesSearch],
    queryFn: () =>
      semanticSearchMemories({
        data: {
          query: debouncedSemanticQuery,
          projectKey: projectKey === "personal" ? undefined : projectKey,
          topK: 20,
          allWorkspaces: allWorkspacesSearch,
        },
      }),
    enabled: semanticMode && debouncedSemanticQuery.length > 0,
    staleTime: 30_000,
  });

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingSteps, setOnboardingSteps] = useState<Record<string, boolean>>({
    connect: false,
    "first-memory": false,
    import: false,
  });

  useEffect(() => {
    const ob = localStorage.getItem("onboarding-steps");
    const dismissed = localStorage.getItem("onboarding-dismissed");
    if (ob) setOnboardingSteps(JSON.parse(ob));
    if (!dismissed) setShowOnboarding(true);
  }, []);

  const { data: memories = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["memories", projectKey],
    queryFn: () => getMemories({ data: { projectKey: projectKey === "personal" ? undefined : projectKey } }),
  });

  // Route guard: redirect to onboarding when vault is empty and setup not complete
  useEffect(() => {
    if (isLoading || projectKey !== "personal") return;
    const onboardingDone = typeof window !== "undefined" && localStorage.getItem("locker_onboarding_complete") === "true";
    if (!onboardingDone && memories.length === 0) {
      router.navigate({ to: "/onboarding" });
    }
  }, [isLoading, memories.length, projectKey, router]);

  const [showQuarantinePanel, setShowQuarantinePanel] = useState(false);
  const { data: quarantinedMemories = [] } = useQuery({
    queryKey: ["quarantined-memories", projectKey],
    queryFn: () => getQuarantinedMemories({ data: { projectKey: projectKey === "personal" ? undefined : projectKey } }),
    staleTime: 30_000,
  });
  const quarantineCount = quarantinedMemories.length;

  const { data: workspacesList = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
  });
  const workspaces = Array.isArray(workspacesList) ? workspacesList : [];

  const { data: planData } = useQuery({
    queryKey: ["user-plan"],
    queryFn: () => getUserPlan(),
  });
  const userPlan = (planData?.planId ?? "free") as PlanId;

  const { data: usageStats } = useQuery({
    queryKey: ["usage-stats"],
    queryFn: () => getMemoryUsageStats(),
    enabled: projectKey === "personal",
  });

  const { data: memoryGraph = null, isLoading: isGraphLoading } = useQuery({
    queryKey: ["memory-graph", projectKey],
    queryFn: () =>
      getMemoryGraphFn({ data: { projectKey: projectKey === "personal" ? undefined : projectKey } }),
    enabled: activeTab === "knowledge-graph",
    staleTime: 60_000,
  });

  const { data: personalRecommendations = [], refetch: refetchRecs } = useQuery({
    queryKey: ["personal-recommendations"],
    queryFn: () => listPersonalMemoryRecommendations(),
    enabled: projectKey === "personal",
  });

  const { data: conflicts = [] } = useQuery({
    queryKey: ["conflicts"],
    queryFn: () => getConflicts(),
    refetchInterval: 30_000,
  });
  const pendingConflicts = (conflicts as any[]).filter((r: any) => r.status === "pending");

  const reviewRecMut = useMutation({
    mutationFn: (data: { id: string; action: "approve" | "reject"; reviewNotes?: string }) =>
      reviewMemoryRecommendation({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal-recommendations"] });
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      refetchRecs();
      refetch();
    },
  });

  const totalByCategory = useMemo(() => {
    const counts: Record<string, number> = { configs: 0, rules: 0, projects: 0, references: 0 };
    for (const m of memories) {
      if (counts[m.category] !== undefined) {
        counts[m.category]++;
      }
    }
    return counts;
  }, [memories]);

  const staleCount = useMemo(
    () => memories.filter((m) => Date.now() - new Date(m.timestamp).getTime() > STALE_MEMORY_MS).length,
    [memories]
  );

  const contributionData = useMemo(() => {
    const dateMap = new Map<string, number>();
    for (const m of memories) {
      const date = new Date(m.timestamp);
      const dateStr = date.toDateString();
      dateMap.set(dateStr, (dateMap.get(dateStr) ?? 0) + 1);
    }
    return Array.from(dateMap.entries()).map(([dateStr, count]) => ({
      date: new Date(dateStr),
      count,
    })).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [memories]);

  const selectedDayMemories = useMemo(() => {
    if (!selectedContributionDate) return [];
    const selectedStr = selectedContributionDate.toDateString();
    return memories.filter((m) => {
      const memDate = new Date(m.timestamp);
      memDate.setHours(0, 0, 0, 0);
      return memDate.toDateString() === selectedStr;
    });
  }, [memories, selectedContributionDate]);

  const [staleFilterActive, setStaleFilterActive] = useState(false);
  const { visible: staleBannerVisible, dismiss: dismissStaleBanner } = useStaleMemoryBanner(staleCount);

  function activateStaleFilter() {
    setStaleFilterActive(true);
    setCategoryFilter("");
    setSearchQuery("");
    setSortBy("oldest");
  }

  function deactivateStaleFilter() {
    setStaleFilterActive(false);
    setSortBy("newest");
  }

  async function triggerExport() {
    try {
      const res = await fetch("/api/export", { method: "POST" });
      if (!res.ok) {
        toast.error("Export failed: " + res.statusText);
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `locker_export.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Error triggering export: " + String(err));
    }
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["memories"] });
    refetch();
  }

  function dismissOnboarding() {
    setShowOnboarding(false);
    localStorage.setItem("onboarding-dismissed", "true");
  }

  function updateOnboardingStep(step: string, completed: boolean) {
    const updated = { ...onboardingSteps, [step]: completed };
    setOnboardingSteps(updated);
    localStorage.setItem("onboarding-steps", JSON.stringify(updated));
  }

  return (
    <div className="flex flex-col min-h-screen bg-bg text-text pb-12">
      {/* Page Header */}
      <PageHeader
        title="Memories"
        description="Establish long-term technical context, rules manifestos, and stack preferences for developer agents."
        icon={
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 9h18M9 21V9" />
          </svg>
        }
        count={memories.length}
        countLabel="entries"
        actions={
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setShowNewMemoryModal(true)}
              className="flex items-center gap-1.5 h-9 font-bold"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Memory
            </Button>
          </div>
        }
      >
        <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-bold text-text-muted select-none uppercase tracking-wider text-[10px]">Workspace</span>
            <Select
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value)}
              className="text-xs h-8.5 bg-surface border border-border text-text cursor-pointer focus:ring-1 focus:ring-accent min-w-[180px]"
            >
              {workspaces.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Usage bar */}
          {usageStats && usageStats.limit && usageStats.used / usageStats.limit > 0.6 && (
            <div className="flex flex-col gap-1 min-w-[200px] select-none">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[10px] uppercase font-bold text-text-muted">Memory Allocation</span>
                <span className={`text-xs font-bold ${usageStats.used >= usageStats.limit ? "text-error" : "text-accent"}`}>
                  {usageStats.used} / {usageStats.limit}
                </span>
              </div>
              <div className="w-full h-1.5 bg-surface border border-border rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${usageStats.used >= usageStats.limit ? "bg-error" : "bg-accent"}`}
                  style={{ width: `${Math.min(100, (usageStats.used / usageStats.limit) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </PageHeader>

      <PageContainer>
        {/* Tab navigation */}
        <div className="flex items-center border-b border-border mb-6 -mt-2">
          <button
            type="button"
            onClick={() => setActiveTab("memories")}
            className={`px-4 py-3 text-sm font-semibold transition-colors relative select-none ${
              activeTab === "memories" ? "text-accent" : "text-text-muted hover:text-text"
            }`}
          >
            Memories
            {activeTab === "memories" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("contributions")}
            className={`px-4 py-3 text-sm font-semibold transition-colors relative select-none ${
              activeTab === "contributions" ? "text-accent" : "text-text-muted hover:text-text"
            }`}
          >
            Activity
            {activeTab === "contributions" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
          <PaywallGate feature="knowledgeGraph" currentPlan={userPlan} requiredPlan="business" compact>
            <button
              type="button"
              onClick={() => setActiveTab("knowledge-graph")}
              className={`px-4 py-3 text-sm font-semibold transition-colors relative select-none ${
                activeTab === "knowledge-graph" ? "text-accent" : "text-text-muted hover:text-text"
              }`}
            >
              Knowledge Graph
              {activeTab === "knowledge-graph" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
              )}
            </button>
          </PaywallGate>
          <button
            type="button"
            onClick={() => setActiveTab("conflicts")}
            className={`px-4 py-3 text-sm font-semibold transition-colors relative select-none flex items-center gap-1.5 ${
              activeTab === "conflicts" ? "text-accent" : "text-text-muted hover:text-text"
            }`}
          >
            Conflicts
            {pendingConflicts.length > 0 && (
              <span style={{ background: "var(--error, #ef4444)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 999, padding: "1px 6px", lineHeight: "16px" }}>
                {pendingConflicts.length}
              </span>
            )}
            {activeTab === "conflicts" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
            )}
          </button>
          <PaywallGate feature="usageAnalytics" currentPlan={userPlan} requiredPlan="business" compact>
            <button
              type="button"
              onClick={() => setActiveTab("health")}
              className={`px-4 py-3 text-sm font-semibold transition-colors relative select-none flex items-center gap-1.5 ${
                activeTab === "health" ? "text-accent" : "text-text-muted hover:text-text"
              }`}
            >
              Memory Health
              {activeTab === "health" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />
              )}
            </button>
          </PaywallGate>
        </div>

        {activeTab === "health" ? (
          <MemoryHealthPanel projectKey={projectKey} userPlan={userPlan} />
        ) : activeTab === "conflicts" ? (
          <div className="flex flex-col gap-3">
            {pendingConflicts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
                <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(34,197,94,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--success, #22c55e)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p className="text-text font-medium text-sm">All clear</p>
                <p className="text-text-muted text-xs max-w-xs">No pending agent changes require your review. Any future update or deletion requests from AI agents will appear here.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs text-text-muted">{pendingConflicts.length} pending {pendingConflicts.length === 1 ? "request" : "requests"}</span>
                </div>
                {pendingConflicts.map((rec: any) => (
                  <ConflictCard
                    key={rec.id}
                    rec={rec}
                    onResolved={() => queryClient.invalidateQueries({ queryKey: ["conflicts"] })}
                  />
                ))}
              </>
            )}
          </div>
        ) : activeTab === "knowledge-graph" ? (
          <KnowledgeGraph
            graph={memoryGraph}
            isLoading={isGraphLoading}
            onNodeClick={setSelectedGraphNodeId}
            selectedNodeId={selectedGraphNodeId}
            fetchMemoriesByIds={(ids) => getGraphMemoriesByIdsFn({ data: { memoryIds: ids } })}
          />
        ) : activeTab === "contributions" ? (
          <div className="flex flex-col gap-6">
            <div className="bg-surface border border-border rounded-xl p-6">
              <div className="mb-6">
                <h3 className="text-lg font-bold text-text mb-1">Activity</h3>
                <p className="text-xs text-text-muted">View your memory creation activity over time</p>
              </div>
              {contributionData.length > 0 ? (
                <ContributionsChart
                  data={contributionData}
                  squareSize={14}
                  gap={2}
                  onDateClick={setSelectedContributionDate}
                  selectedDate={selectedContributionDate}
                />
              ) : (
                <div className="text-center py-12 text-text-muted">
                  <p className="text-sm">No memories created yet</p>
                </div>
              )}
            </div>

            {selectedContributionDate && (
              <div className="bg-surface border border-border rounded-xl p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-text mb-1">
                      Memories from {selectedContributionDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    </h3>
                    <p className="text-xs text-text-muted">{selectedDayMemories.length} {selectedDayMemories.length === 1 ? "memory" : "memories"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedContributionDate(null)}
                    className="text-text-muted hover:text-text text-lg font-bold"
                  >
                    ✕
                  </button>
                </div>
                {selectedDayMemories.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {selectedDayMemories.map((m) => (
                      <MemoryCard
                        key={m.id}
                        memory={m}
                        selected={false}
                        onToggleSelect={() => {}}
                        onExport={() => {}}
                        workspaces={workspaces}
                        currentProjectKey={projectKey}
                        isSelected={false}
                        isFocused={false}
                        onSelect={() => {}}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-text-muted">
                    <p className="text-sm">No memories created on this day</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
        <>
        {/* Pending Agent Action + Conflict Review Banner */}
        {projectKey === "personal" && personalRecommendations.length > 0 && (
          <div className="mb-6 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/20 rounded-2xl p-5 md:p-6 shadow-sm flex flex-col gap-4 animate-in fade-in slide-in-from-top-4 duration-200">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-amber-500/10 text-amber-500 text-lg">
                  ⚠️
                </span>
                <div>
                  <h3 className="text-sm font-bold text-text">Vault Actions Pending Approval</h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    Agent requests and detected conflicts require your approval before any change is applied.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-3.5 mt-1">
              {personalRecommendations.map((r: any) => {
                const isDelete = r.recommendationType === "delete";
                const isUpdate = r.recommendationType === "update";
                const isArchive = r.recommendationType === "archive";
                const agentLabel = r.agentContext ? `Agent "${r.agentContext}"` : "An agent";

                return (
                  <div
                    key={r.id}
                    className={`flex flex-col gap-3 p-4 bg-surface/50 backdrop-blur-xs border rounded-xl transition-all ${
                      isDelete
                        ? "border-red-500/20 hover:border-red-500/35"
                        : isUpdate
                        ? "border-blue-500/20 hover:border-blue-500/35"
                        : "hover:border-amber-500/30 border-border"
                    }`}
                  >
                    {/* Header row */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        {isDelete && (
                          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-red-500/15 text-red-400 border border-red-500/25">
                            Delete Request
                          </span>
                        )}
                        {isUpdate && (
                          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-blue-500/15 text-blue-400 border border-blue-500/25">
                            Update Request
                          </span>
                        )}
                        {isArchive && (
                          <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/25">
                            Conflict Detected
                          </span>
                        )}
                        {(isDelete || isUpdate) && r.agentContext && (
                          <span className="text-[10px] text-text-muted truncate">from {agentLabel}</span>
                        )}
                      </div>
                    </div>

                    {/* Body */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 flex flex-col gap-2">
                        {isArchive && (
                          <>
                            <p className="text-xs text-text font-medium leading-relaxed">
                              Proposing to archive: <span className="text-red-400 italic">"{r.fact}"</span>
                            </p>
                            {r.reviewNotes && (
                              <p className="text-[10px] text-text-muted flex items-center gap-1">
                                <span className="font-bold text-amber-500/80">Reason:</span> {r.reviewNotes}
                              </p>
                            )}
                          </>
                        )}
                        {isDelete && (
                          <p className="text-xs text-text font-medium leading-relaxed">
                            Requesting to <span className="text-red-400 font-bold">permanently delete</span>:{" "}
                            <span className="text-text-muted italic">"{r.fact}"</span>
                          </p>
                        )}
                        {isUpdate && (
                          <div className="flex flex-col gap-1.5">
                            <p className="text-[10px] uppercase font-bold text-text-muted tracking-wide">Current</p>
                            <p className="text-xs text-text-muted italic leading-relaxed">"{r.fact}"</p>
                            <p className="text-[10px] uppercase font-bold text-blue-400/80 tracking-wide mt-0.5">Proposed</p>
                            <p className="text-xs text-text font-medium leading-relaxed">"{r.proposedFact}"</p>
                            {r.proposedCategory && r.proposedCategory !== r.category && (
                              <p className="text-[10px] text-text-muted">
                                Category: <span className="text-text">{r.category}</span> → <span className="text-blue-400">{r.proposedCategory}</span>
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 self-end sm:self-auto shrink-0 select-none">
                        <Button
                          onClick={() => reviewRecMut.mutate({ id: r.id, action: "reject" })}
                          disabled={reviewRecMut.isPending}
                          variant="outline"
                          className="h-8 text-[11px] px-3 font-semibold bg-surface hover:bg-surface-hover text-text-muted hover:text-text border-border"
                        >
                          {isArchive ? "Keep Active" : "Deny"}
                        </Button>
                        <Button
                          onClick={() => reviewRecMut.mutate({ id: r.id, action: "approve" })}
                          disabled={reviewRecMut.isPending}
                          className={`h-8 text-[11px] px-3 font-bold border ${
                            isDelete
                              ? "bg-red-500/15 border-red-500/30 hover:bg-red-500/25 text-red-400"
                              : isUpdate
                              ? "bg-blue-500/15 border-blue-500/30 hover:bg-blue-500/25 text-blue-400"
                              : "bg-amber-500/15 border-amber-500/30 hover:bg-amber-500/25 text-amber-400"
                          }`}
                        >
                          {isDelete ? "Approve Delete" : isUpdate ? "Approve Update" : "Approve Archive"}
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* DLP Quarantine Queue */}
        {quarantineCount > 0 && (
          <div className="mb-6 bg-gradient-to-br from-red-500/10 via-red-500/5 to-transparent border border-red-500/20 rounded-2xl shadow-sm overflow-hidden animate-in fade-in slide-in-from-top-4 duration-200">
            <button
              onClick={() => setShowQuarantinePanel((v) => !v)}
              className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-red-500/5 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/10 text-red-500 text-lg select-none">
                  🔒
                </span>
                <div>
                  <h3 className="text-sm font-bold text-text">
                    DLP Quarantine Queue
                    <span className="ml-2 text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-500/25 px-1.5 py-0.5 rounded-full">
                      {quarantineCount}
                    </span>
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    {quarantineCount} {quarantineCount === 1 ? "memory" : "memories"} flagged by the DLP engine — AI agents see{" "}
                    <code className="font-mono bg-surface-muted px-1 rounded text-[10px]">[REDACTED]</code> until you review them.
                  </p>
                </div>
              </div>
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                className={`shrink-0 text-text-muted transition-transform duration-200 ${showQuarantinePanel ? "rotate-180" : ""}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showQuarantinePanel && (
              <div className="px-5 pb-5">
                <QuarantineDashboard projectKey={projectKey === "personal" ? undefined : projectKey} />
              </div>
            )}
          </div>
        )}

        {/* Onboarding block */}
        {memories.length === 0 && showOnboarding && (
          <div className="bg-gradient-to-br from-accent/8 to-accent/4 border border-accent/25 rounded-2xl p-5 md:p-6 relative flex items-start justify-between gap-4 animate-in fade-in zoom-in duration-200">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-3.5 select-none">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
                  <path d="M10 16.5l-3-3 1.41-1.41L10 13.68l5.59-5.59L17 9.5l-7 7z" />
                </svg>
                <h3 className="text-sm font-bold text-text">Welcome to Locker! Let's get set up</h3>
              </div>
              <div className="flex flex-col gap-3">
                {[
                  { id: "connect", label: "Connect an AI client", desc: "Configure Claude CLI, Cursor, or Web Connectors", href: "/docs" },
                  { id: "first-memory", label: "Commit your first memory", desc: "Create a project note or stack archetype rule" },
                  { id: "import", label: "Import from ChatGPT", desc: "Bulk import semantic logs using json exports", href: "/import" },
                ].map((step) => (
                  <label key={step.id} className="flex items-start gap-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={onboardingSteps[step.id] || false}
                      onChange={(e) => updateOnboardingStep(step.id, e.target.checked)}
                      className="mt-1 accent-accent h-4.5 w-4.5 rounded-sm border-border cursor-pointer"
                    />
                    <div className="flex flex-col">
                      <span className={`text-xs font-semibold ${
                        onboardingSteps[step.id] ? "text-text-muted line-through" : "text-text group-hover:text-accent-hover transition-colors"
                      }`}>
                        {step.href ? <a href={step.href} className="hover:underline">{step.label}</a> : step.label}
                      </span>
                      <span className="text-[10px] text-text-muted mt-0.5">{step.desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={dismissOnboarding} className="h-6 w-6 p-0 text-text-muted hover:text-text leading-none select-none">
              ✕
            </Button>
          </div>
        )}

        {/* Stats selector cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Total", value: memories.length, color: "text", category: "" },
              { label: "Configs", value: totalByCategory.configs, color: "purple-400", category: "configs" },
              { label: "Rules", value: totalByCategory.rules, color: "indigo-400", category: "rules" },
              { label: "Projects", value: totalByCategory.projects, color: "emerald-400", category: "projects" },
              { label: "References", value: totalByCategory.references, color: "amber-400", category: "references" },
            ].map((cat) => {
              const isActive = categoryFilter === cat.category;
              return (
                <button
                  key={cat.label}
                  onClick={() => setCategoryFilter(isActive ? "" : cat.category)}
                  className={`relative flex flex-col items-center justify-center p-4 rounded-xl border transition-all duration-200 cursor-pointer select-none bg-linear-to-br from-accent/3 to-accent/0 ${
                    isActive
                      ? "border-accent bg-accent/8 shadow-md shadow-accent/5 ring-1 ring-accent/10"
                      : "border-border hover:border-accent/30 hover:shadow-xs hover:shadow-accent/3 hover:-translate-y-0.5"
                  }`}
                >
                  <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider block mb-1.5 select-none">
                    {cat.label}
                  </span>
                  <span className={`text-2xl font-bold leading-none text-${cat.color}`}>
                    {cat.value}
                  </span>
                </button>
              );
            })}
          </div>

        {/* Search bar & filter controls */}
        <div className="flex flex-col gap-4 bg-surface border border-border p-4 rounded-xl shadow-xs">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              {isSemanticFetching ? (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin pointer-events-none" />
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--color-text-muted)"
                  strokeWidth="2.5"
                  className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              )}
              <Input
                type="search"
                aria-label="Search memories"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  semanticMode
                    ? "Semantic search: describe what you're looking for..."
                    : "Search semantic facts by text, guidelines content, or tags..."
                }
                className="pl-9 h-9.5 text-xs md:text-sm bg-surface2 border border-border rounded-lg"
              />
            </div>

            {/* Semantic toggle */}
            <button
              type="button"
              onClick={() => {
                setSemanticMode((prev) => !prev);
                setDebouncedSemanticQuery("");
              }}
              title={semanticMode ? "Disable semantic search" : "Enable semantic search"}
              className={`h-9.5 px-3 flex items-center gap-1.5 font-bold text-xs rounded-lg border transition-all select-none whitespace-nowrap ${
                semanticMode
                  ? "border-accent bg-accent/10 text-accent hover:bg-accent/15"
                  : "border-border bg-surface2 text-text-muted hover:border-accent/40 hover:text-text"
              }`}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Semantic
            </button>

            {/* Search All Org/Team Workspaces toggle (Business tier+) */}
            <PaywallGate
              feature="crossWorkspaceSearch"
              currentPlan={userPlan}
              requiredPlan="business"
              compact
            >
              <button
                type="button"
                onClick={() => setAllWorkspacesSearch((prev) => !prev)}
                disabled={!semanticMode}
                title={semanticMode ? "Search across all organization workspaces" : "Enable semantic search first"}
                className={`h-9.5 px-3 flex items-center gap-1.5 font-bold text-xs rounded-lg border transition-all select-none whitespace-nowrap ${
                  allWorkspacesSearch && semanticMode
                    ? "border-accent bg-accent/10 text-accent hover:bg-accent/15"
                    : semanticMode
                    ? "border-border bg-surface2 text-text-muted hover:border-accent/40 hover:text-text"
                    : "border-border bg-surface2 text-text-muted opacity-50 cursor-not-allowed"
                }`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                  <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                </svg>
                All Org Workspaces
              </button>
            </PaywallGate>

            <Button
              variant="outline"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`h-9.5 px-3 flex gap-2 font-semibold text-xs border border-border hover:border-accent/40 ${
                showAdvancedFilters ? "border-accent/40 bg-accent-dim text-accent-hover" : ""
              }`}
            >
              <span>⚙️</span> Filters
            </Button>
          </div>

          {/* Semantic search status line */}
          {semanticMode && debouncedSemanticQuery && !isSemanticFetching && (
            <div className="flex items-center gap-2 text-[11px] text-text-muted animate-in fade-in duration-150">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--color-accent)" className="shrink-0">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>
                Semantic results for: <span className="text-text font-semibold">"{debouncedSemanticQuery}"</span>
                {" "}—{" "}
                <span className="text-accent font-semibold">
                  {semanticResults?.length ?? 0} result{(semanticResults?.length ?? 0) !== 1 ? "s" : ""}
                </span>
              </span>
            </div>
          )}

          {/* Advanced filters — hidden in semantic mode */}
          {showAdvancedFilters && !semanticMode && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-border/40 animate-in slide-in-from-top duration-200">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="filter-sort">Sort By</Label>
                <Select id="filter-sort" value={sortBy} onChange={(e: any) => setSortBy(e.target.value)} className="h-8.5 text-xs">
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="alphabetical">Alphabetical</option>
                  <option value="stale">Stale (30+ days)</option>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="filter-start">Created From</Label>
                <Input
                  id="filter-start"
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="h-8.5 text-xs"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="filter-end">Created To</Label>
                <Input
                  id="filter-end"
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="h-8.5 text-xs"
                />
              </div>
            </div>
          )}
        </div>

        {/* Stale memories alert banner */}
        {staleBannerVisible && !isLoading && (
          <StaleMemoryBanner
            staleCount={staleCount}
            onFilter={activateStaleFilter}
            onDismiss={dismissStaleBanner}
          />
        )}

        {/* Active stale filter indicator */}
        {staleFilterActive && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/8 border border-amber-500/20 rounded-lg text-xs">
            <span className="text-amber-600 font-semibold flex-1">
              Showing memories older than {STALE_MEMORY_DAYS} days
            </span>
            <button
              type="button"
              onClick={deactivateStaleFilter}
              className="text-amber-500/70 hover:text-amber-500 font-semibold transition-colors"
            >
              Clear filter ✕
            </button>
          </div>
        )}

        {/* Memories Content Table */}
        {isLoading ? (
          <MemorySkeletonLoader viewMode={viewMode} />
        ) : isError ? (
          <div className="text-center py-16 px-4 text-error bg-error/5 border border-error/20 rounded-xl select-none">
            Error loading memories. Check your server status.
          </div>
        ) : semanticMode && debouncedSemanticQuery ? (
          isSemanticFetching ? (
            <MemorySkeletonLoader viewMode={viewMode} />
          ) : semanticResults && semanticResults.length > 0 ? (
            <MemoryTable
              memories={semanticResults}
              filter=""
              categoryFilter=""
              sortBy="newest"
              dateStart=""
              dateEnd=""
              onShowHistory={(id) => setShowHistoryModal(id)}
              onExportZip={triggerExport}
              workspaces={workspaces}
              currentProjectKey={projectKey}
              isSemanticResults
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              onCategoryChange={setCategoryFilter}
            />
          ) : (
            <div className="text-center py-16 px-4 text-text-muted bg-surface border border-border rounded-xl select-none">
              No semantic matches found. Try different keywords.
            </div>
          )
        ) : (
          <MemoryTable
            memories={
              staleFilterActive
                ? memories.filter((m) => Date.now() - new Date(m.timestamp).getTime() > STALE_MEMORY_MS)
                : memories
            }
            filter={searchQuery}
            categoryFilter={categoryFilter}
            onCategoryChange={setCategoryFilter}
            sortBy={sortBy}
            dateStart={staleFilterActive ? "" : dateStart}
            dateEnd={staleFilterActive ? "" : dateEnd}
            onShowHistory={(id) => setShowHistoryModal(id)}
            onExportZip={triggerExport}
            workspaces={workspaces}
            currentProjectKey={projectKey}
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
          />
        )}
        </>
        )}
      </PageContainer>

      <ConfigBuilder
        isOpen={showAgentConfigBuilder}
        onClose={() => setShowAgentConfigBuilder(false)}
      />

      <NewMemoryModal
        isOpen={showNewMemoryModal}
        onClose={() => setShowNewMemoryModal(false)}
        onSaved={invalidate}
        projectKey={projectKey}
        onOpenAgentConfigBuilder={() => setShowAgentConfigBuilder(true)}
      />

      {/* History modal */}
      {showHistoryModal && (
        <HistoryModal
          memoryId={showHistoryModal}
          onClose={() => setShowHistoryModal(null)}
          onReverted={() => {
            setShowHistoryModal(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}
