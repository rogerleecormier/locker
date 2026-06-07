import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { InfoTooltip } from "~/components/InfoTooltip";
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
  unmaskMemory,
  semanticSearchMemories,
} from "~/server/memoryFunctions";
import type { Memory } from "~/db/schema";
import { PageContainer } from "~/components/PageContainer";
import { PageHeader } from "~/components/PageHeader";
import { MemoryCard } from "~/components/MemoryCard";
import { AgentConfigBuilder } from "~/components/AgentConfigBuilder";
import { NewMemoryModal } from "~/components/NewMemoryModal";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Label, Input, Textarea, Select } from "~/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "~/components/ui/dialog";
import { ExportMemoryModal } from "~/components/ExportMemoryModal";
import { HistoryModal } from "~/components/HistoryModal";
import { downloadFile, exportToJson, exportToMarkdown } from "~/lib/memoryExport";
import { useToast } from "~/components/ui/toast";

export const Route = createFileRoute("/memories")({
  component: Dashboard,
});

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

// ── MEMORIES TABLE ─────────────────────────────────────────────────────────
function MemoryTable({
  memories,
  filter,
  categoryFilter,
  sortBy,
  dateStart,
  dateEnd,
  onShowHistory,
  onExportZip,
  workspaces = [],
  currentProjectKey = "personal",
  isSemanticResults = false,
}: {
  memories: Memory[];
  filter: string;
  categoryFilter: string;
  sortBy: 'newest' | 'oldest' | 'alphabetical';
  dateStart: string;
  dateEnd: string;
  onShowHistory: (id: string) => void;
  onExportZip: () => void;
  workspaces?: any[];
  currentProjectKey?: string;
  isSemanticResults?: boolean;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkTargetWorkspace, setBulkTargetWorkspace] = useState("");
  const [exportMemory, setExportMemory] = useState<Memory | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

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
      return matchesCat && matchesText && matchesDate;
    });

    if (sortBy === 'newest') {
      results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } else if (sortBy === 'oldest') {
      results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } else if (sortBy === 'alphabetical') {
      results.sort((a, b) => a.fact.localeCompare(b.fact));
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
              {filtered.length > 0 && (
                <div className="ml-auto flex items-center gap-1.5 flex-wrap">
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
                </div>
              )}
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

      {/* Grid container responsive */}
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
            onSelect={() => setActiveSelectedId(m.id)}
          />
        ))}
      </div>

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

// ── MAIN DASHBOARD ──────────────────────────────────────────────────────────
function Dashboard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [projectKey, setProjectKey] = useState("personal");
  const [showNewMemoryModal, setShowNewMemoryModal] = useState(false);
  const [showAgentConfigBuilder, setShowAgentConfigBuilder] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState<string | null>(null);

  // Filter conditions
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'alphabetical'>('newest');
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Semantic search state
  const [semanticMode, setSemanticMode] = useState(false);
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
    queryKey: ["semantic-search", debouncedSemanticQuery, projectKey],
    queryFn: () =>
      semanticSearchMemories({
        data: {
          query: debouncedSemanticQuery,
          projectKey: projectKey === "personal" ? undefined : projectKey,
          topK: 20,
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

  const { data: workspacesList = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
  });
  const workspaces = Array.isArray(workspacesList) ? workspacesList : [];

  const { data: usageStats } = useQuery({
    queryKey: ["usage-stats"],
    queryFn: () => getMemoryUsageStats(),
    enabled: projectKey === "personal",
  });

  const { data: personalRecommendations = [], refetch: refetchRecs } = useQuery({
    queryKey: ["personal-recommendations"],
    queryFn: () => listPersonalMemoryRecommendations(),
    enabled: projectKey === "personal",
  });

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

        {/* Stats selector cards — hidden in semantic mode */}
        {!semanticMode && (
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
        )}

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

        {/* Memories Content Table */}
        {isLoading ? (
          <div className="text-center py-20">
            <span className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin inline-block mb-3" />
            <p className="text-text-muted text-xs font-semibold">Decrypting memories...</p>
          </div>
        ) : isError ? (
          <div className="text-center py-16 px-4 text-error bg-error/5 border border-error/20 rounded-xl select-none">
            Error loading memories. Check your server status.
          </div>
        ) : semanticMode && debouncedSemanticQuery ? (
          isSemanticFetching ? (
            <div className="text-center py-20">
              <span className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin inline-block mb-3" />
              <p className="text-text-muted text-xs font-semibold">Running semantic search...</p>
            </div>
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
            />
          ) : (
            <div className="text-center py-16 px-4 text-text-muted bg-surface border border-border rounded-xl select-none">
              No semantic matches found. Try different keywords.
            </div>
          )
        ) : (
          <MemoryTable
            memories={memories}
            filter={searchQuery}
            categoryFilter={categoryFilter}
            sortBy={sortBy}
            dateStart={dateStart}
            dateEnd={dateEnd}
            onShowHistory={(id) => setShowHistoryModal(id)}
            onExportZip={triggerExport}
            workspaces={workspaces}
            currentProjectKey={projectKey}
          />
        )}
      </PageContainer>

      <AgentConfigBuilder
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
