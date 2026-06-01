import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { InfoTooltip } from "~/components/InfoTooltip";
import {
  getMemories,
  addMemory,
  deleteMemory,
  bulkDeleteMemories,
  updateMemory,
  getMemoryTimeline,
  revertMemoryVersion,
  getUserWorkspaces,
  moveMemories,
  getMemoryUsageStats,
  getArchivedMemories,
  archiveMemory,
  restoreMemory,
  permanentlyDeleteArchivedMemory,
} from "~/server/memoryFunctions";
import type { Memory } from "~/db/schema";

export const Route = createFileRoute("/memories")({
  component: Dashboard,
});


const CATEGORY_LABELS: Record<string, string> = {
  rules: "Rules",
  projects: "Projects",
  references: "References",
};

const CATEGORY_COLORS: Record<string, string> = {
  rules: "#818cf8",
  projects: "#34d399",
  references: "#fbbf24",
};

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] ?? "#7b80a0";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        color,
        background: `${color}18`,
        border: `1px solid ${color}40`,
        textTransform: "uppercase",
      }}
    >
      {CATEGORY_LABELS[category] ?? category}
    </span>
  );
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 7px",
        borderRadius: 4,
        fontSize: 11,
        background: "var(--tag-bg)",
        border: "1px solid var(--tag-border)",
        color: "var(--text-muted)",
        marginRight: 4,
        marginBottom: 2,
      }}
    >
      {tag}
    </span>
  );
}

function MemoryRow({
  memory,
  selected,
  onToggleSelect,
  onShowHistory,
  workspaces = [],
  currentProjectKey = "personal",
}: {
  memory: Memory;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onShowHistory: (id: string) => void;
  workspaces?: any[];
  currentProjectKey?: string;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const [targetWorkspace, setTargetWorkspace] = useState("");
  const [editFact, setEditFact] = useState(memory.fact);
  const [editCategory, setEditCategory] = useState(memory.category);
  const [editTags, setEditTags] = useState(memory.tags);

  const deleteMutation = useMutation({
    mutationFn: () => deleteMemory({ data: { id: memory.id } }),
    onMutate: () => {
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.filter((m) => m.id !== memory.id) : []
      );
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => updateMemory({ data: { id: memory.id, fact: editFact, category: editCategory, tags: editTags } }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? old.map((m) => m.id === updated.id ? updated : m) : []
      );
      setEditing(false);
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
    },
  });

  const moveMutation = useMutation({
    mutationFn: () => moveMemories({ data: { ids: [memory.id], targetProjectKey: targetWorkspace } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setMoving(false);
      setTargetWorkspace("");
    },
    onError: (err: Error) => {
      alert("Failed to move memory: " + err.message);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveMemory({ data: { id: memory.id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      queryClient.invalidateQueries({ queryKey: ["memories-archived"] });
    },
    onError: (err: Error) => {
      alert("Failed to archive memory: " + err.message);
    },
  });

  function cancelEdit() {
    setEditFact(memory.fact);
    setEditCategory(memory.category);
    setEditTags(memory.tags);
    setEditing(false);
  }

  const tags = memory.tags
    ? memory.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  if (editing) {
    return (
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "8px 16px",
          background: "rgba(168,85,247,0.04)",
        }}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(memory.id)}
          style={{ marginTop: 3, cursor: "pointer", accentColor: "var(--accent)" }}
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea
            value={editFact}
            onChange={(e) => setEditFact(e.target.value)}
            rows={3}
            autoFocus
            style={{ width: "100%", padding: "8px 10px", fontSize: 13, lineHeight: 1.5, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={editCategory}
              onChange={(e) => setEditCategory(e.target.value as "rules" | "projects" | "references")}
              style={{ padding: "5px 8px", fontSize: 12 }}
            >
              <option value="rules">Rules</option>
              <option value="projects">Projects</option>
              <option value="references">References</option>
            </select>
            <input
              type="text"
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="tags (comma-separated)"
              style={{ flex: 1, padding: "5px 8px", fontSize: 12, minWidth: 120 }}
            />
            <button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending || !editFact.trim()}
              style={{
                padding: "5px 14px",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 12,
                borderRadius: "var(--radius)",
              }}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </button>
            <button
              onClick={cancelEdit}
              disabled={updateMutation.isPending}
              style={{
                padding: "5px 10px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontSize: 12,
                borderRadius: "var(--radius)",
              }}
            >
              Cancel
            </button>
          </div>
          {updateMutation.isError && (
            <span style={{ fontSize: 11, color: "var(--error)" }}>Save failed. Try again.</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        padding: "14px 18px",
        borderBottom: "1px solid var(--border)",
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: "8px 16px",
        alignItems: "start",
        background: selected ? "rgba(168,85,247,0.05)" : undefined,
      }}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(memory.id)}
        style={{ marginTop: 3, cursor: "pointer", accentColor: "var(--accent)" }}
      />
      <div style={{ minWidth: 0 }}>
        <p style={{ marginBottom: tags.length ? 6 : 0, lineHeight: 1.5, wordBreak: "break-word" }}>
          {memory.fact}
        </p>
        {tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {tags.map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, minWidth: 110 }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <CategoryBadge category={memory.category} />
          {(() => {
            const STALE_MS = 90 * 24 * 60 * 60 * 1000;
            const lastAccessed = memory.lastAccessedAt ? Date.now() - memory.lastAccessedAt : Date.now() - memory.timestamp;
            const isStale = lastAccessed > STALE_MS;
            return isStale ? (
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 8px",
                background: "rgba(245, 158, 11, 0.15)",
                color: "rgb(245, 158, 11)",
                borderRadius: 3,
                whiteSpace: "nowrap"
              }}>
                Stale
              </span>
            ) : null;
          })()}
        </div>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {new Date(memory.timestamp).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {moving ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <select
                value={targetWorkspace}
                onChange={(e) => setTargetWorkspace(e.target.value)}
                style={{ padding: "3.5px 6px", fontSize: 11, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)" }}
              >
                <option value="">Move to...</option>
                {workspaces
                  .filter((w) => w.key !== currentProjectKey)
                  .map((w) => (
                    <option key={w.key} value={w.key}>
                      {w.label}
                    </option>
                  ))}
              </select>
              <button
                onClick={() => moveMutation.mutate()}
                disabled={moveMutation.isPending || !targetWorkspace}
                style={{
                  padding: "3.5px 10px",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: "var(--radius)",
                }}
              >
                {moveMutation.isPending ? "Moving…" : "Move"}
              </button>
              <button
                onClick={() => { setMoving(false); setTargetWorkspace(""); }}
                disabled={moveMutation.isPending}
                style={{
                  padding: "3.5px 8px",
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  fontSize: 11,
                  borderRadius: "var(--radius)",
                }}
              >
                Cancel
              </button>
            </div>
          ) : confirming ? (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>Delete?</span>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                style={{
                  padding: "3px 10px",
                  background: "rgba(239,68,68,0.15)",
                  border: "1px solid rgba(239,68,68,0.4)",
                  color: "var(--error)",
                  fontSize: 11,
                  fontWeight: 600,
                  borderRadius: "var(--radius)",
                }}
              >
                {deleteMutation.isPending ? "…" : "Yes"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={deleteMutation.isPending}
                style={{
                  padding: "3px 8px",
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  fontSize: 11,
                  borderRadius: "var(--radius)",
                }}
              >
                No
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={() => setEditing(true)}
                style={{
                  padding: "3px 8px",
                  background: "transparent",
                  border: "1px solid transparent",
                  color: "var(--text-muted)",
                  fontSize: 11,
                  borderRadius: "var(--radius)",
                  opacity: 0.5,
                  transition: "opacity 0.15s, border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.opacity = "1";
                  b.style.borderColor = "rgba(168,85,247,0.4)";
                  b.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.opacity = "0.5";
                  b.style.borderColor = "transparent";
                  b.style.color = "var(--text-muted)";
                }}
              >
                Edit
              </button>
              <button
                onClick={() => onShowHistory(memory.id)}
                style={{
                  padding: "3px 8px",
                  background: "transparent",
                  border: "1px solid transparent",
                  color: "var(--text-muted)",
                  fontSize: 11,
                  borderRadius: "var(--radius)",
                  opacity: 0.5,
                  transition: "opacity 0.15s, border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.opacity = "1";
                  b.style.borderColor = "rgba(168,85,247,0.4)";
                  b.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.opacity = "0.5";
                  b.style.borderColor = "transparent";
                  b.style.color = "var(--text-muted)";
                }}
              >
                History
              </button>
              {workspaces.filter((w) => w.key !== currentProjectKey).length > 0 && (
                <button
                  onClick={() => setMoving(true)}
                  style={{
                    padding: "3px 8px",
                    background: "transparent",
                    border: "1px solid transparent",
                    color: "var(--text-muted)",
                    fontSize: 11,
                    borderRadius: "var(--radius)",
                    opacity: 0.5,
                    transition: "opacity 0.15s, border-color 0.15s, color 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.opacity = "1";
                    b.style.borderColor = "rgba(168,85,247,0.4)";
                    b.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.opacity = "0.5";
                    b.style.borderColor = "transparent";
                    b.style.color = "var(--text-muted)";
                  }}
                >
                  Move
                </button>
              )}
              <button
                onClick={() => archiveMutation.mutate()}
                disabled={archiveMutation.isPending}
                style={{
                  padding: "3px 8px",
                  background: "transparent",
                  border: "1px solid transparent",
                  color: "var(--text-muted)",
                  fontSize: 11,
                  borderRadius: "var(--radius)",
                  opacity: 0.5,
                  transition: "opacity 0.15s, border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.opacity = "1";
                  b.style.borderColor = "rgba(168,85,247,0.4)";
                  b.style.color = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.opacity = "0.5";
                  b.style.borderColor = "transparent";
                  b.style.color = "var(--text-muted)";
                }}
              >
                {archiveMutation.isPending ? "…" : "Archive"}
              </button>
              <button
                onClick={() => setConfirming(true)}
                style={{
                  padding: "3px 8px",
                  background: "transparent",
                  border: "1px solid transparent",
                  color: "var(--text-muted)",
                  fontSize: 11,
                  borderRadius: "var(--radius)",
                  opacity: 0.5,
                  transition: "opacity 0.15s, border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.opacity = "1";
                  b.style.borderColor = "rgba(239,68,68,0.4)";
                  b.style.color = "var(--error)";
                }}
                onMouseLeave={(e) => {
                  const b = e.currentTarget as HTMLButtonElement;
                  b.style.opacity = "0.5";
                  b.style.borderColor = "transparent";
                  b.style.color = "var(--text-muted)";
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NewMemoryModal({
  onClose,
  onSaved,
  projectKey,
}: {
  onClose: () => void;
  onSaved: () => void;
  projectKey?: string;
}) {
  const queryClient = useQueryClient();
  const [fact, setFact] = useState("");
  const [category, setCategory] = useState<"rules" | "projects" | "references">("references");
  const [tags, setTags] = useState("");

  const mutation = useMutation({
    mutationFn: () => addMemory({ data: { fact, category, tags, projectKey } }),
    onSuccess: (newMemory) => {
      queryClient.setQueryData<Memory[]>(["memories"], (old) =>
        old ? [newMemory, ...old] : [newMemory]
      );
      onSaved();
      onClose();
    },
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: "var(--radius)", width: "100%", maxWidth: 520,
          boxShadow: "0 24px 48px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 600 }}>New Memory</span>
          <button onClick={onClose} style={{ background: "none", color: "var(--text-muted)", fontSize: 18, padding: "0 4px" }}>✕</button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
              Fact
              <InfoTooltip text="A discrete piece of information your AI assistant should remember — a preference, rule, project detail, or reference." size={12} />
            </label>
            <textarea
              autoFocus
              value={fact}
              onChange={(e) => setFact(e.target.value)}
              rows={4}
              placeholder="Enter the memory fact…"
              style={{ width: "100%", padding: "10px 12px", fontSize: 13, lineHeight: 1.5, resize: "vertical" }}
            />
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Category
                <InfoTooltip text="Rules: coding conventions and preferences. Projects: context about specific projects. References: links, contacts, or factual lookups." size={12} />
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as "rules" | "projects" | "references")}
                style={{ width: "100%", padding: "8px 10px", fontSize: 13 }}
              >
                <option value="references">References</option>
                <option value="rules">Rules</option>
                <option value="projects">Projects</option>
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                Tags
                <InfoTooltip text="Comma-separated keywords used to group and filter memories. Tags help you find related entries quickly." size={12} />
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="comma-separated"
                style={{ width: "100%", padding: "8px 10px", fontSize: 13 }}
              />
            </div>
          </div>
          {mutation.isError && (
            <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius)", color: "var(--error)", fontSize: 12 }}>
              {(mutation.error as Error).message}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13 }}>
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={!fact.trim() || mutation.isPending}
              style={{ padding: "8px 20px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13 }}
            >
              {mutation.isPending ? "Saving…" : "Save Memory"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function downloadFile(content: string, filename: string, contentType: string) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportToJson(memoriesToExport: Memory[]) {
  const data = memoriesToExport.map(({ id, fact, category, tags, timestamp }) => ({
    id,
    fact,
    category,
    tags,
    timestamp,
  }));
  return JSON.stringify(data, null, 2);
}

function exportToMarkdown(memoriesToExport: Memory[]) {
  const categories = {
    rules: memoriesToExport.filter((m) => m.category === "rules"),
    projects: memoriesToExport.filter((m) => m.category === "projects"),
    references: memoriesToExport.filter((m) => m.category === "references"),
  };

  let md = `# Locker Memories Export - ${new Date().toLocaleDateString()}\n\n`;

  for (const [cat, items] of Object.entries(categories)) {
    if (items.length === 0) continue;
    md += `## ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n`;
    for (const item of items) {
      const tags = item.tags
        ? ` [tags: ${item.tags}]`
        : "";
      md += `- ${item.fact}${tags}\n`;
    }
    md += `\n`;
  }
  return md;
}

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
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkMoving, setBulkMoving] = useState(false);
  const [bulkTargetWorkspace, setBulkTargetWorkspace] = useState("");

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
        (!endDate || mTime <= endDate + 86400000); // +1 day to include end date fully
      return matchesCat && matchesText && matchesDate;
    });

    // Apply sorting
    if (sortBy === 'newest') {
      results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } else if (sortBy === 'oldest') {
      results.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } else if (sortBy === 'alphabetical') {
      results.sort((a, b) => a.fact.localeCompare(b.fact));
    }

    return results;
  }, [memories, filter, categoryFilter, sortBy, dateStart, dateEnd]);

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
      alert(`Successfully moved ${res.moved} memories.`);
    },
    onError: (err: Error) => {
      alert("Failed to move memories: " + err.message);
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
      <div
        style={{
          textAlign: "center",
          padding: "48px 24px",
          color: "var(--text-muted)",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        {memories.length === 0 ? "No memories stored yet." : "No memories match your filters."}
      </div>
    );
  }

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}
    >
      {/* Table header with select-all and bulk actions */}
      <div
        style={{
          padding: "10px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--surface2)",
        }}
      >
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
          onChange={toggleSelectAll}
          style={{ cursor: "pointer", accentColor: "var(--accent)" }}
        />
        {someSelected ? (
          <>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {selectedInView.length} selected
            </span>
            {bulkConfirming ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                <span style={{ fontSize: 12, color: "var(--error)" }}>
                  Delete {selectedInView.length} memor{selectedInView.length !== 1 ? "ies" : "y"}?
                </span>
                <button
                  onClick={() => bulkDeleteMutation.mutate(selectedInView.map((m) => m.id))}
                  disabled={bulkDeleteMutation.isPending}
                  style={{
                    padding: "4px 12px",
                    background: "rgba(239,68,68,0.15)",
                    border: "1px solid rgba(239,68,68,0.4)",
                    color: "var(--error)",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: "var(--radius)",
                  }}
                >
                  {bulkDeleteMutation.isPending ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  onClick={() => setBulkConfirming(false)}
                  disabled={bulkDeleteMutation.isPending}
                  style={{
                    padding: "4px 10px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    fontSize: 12,
                    borderRadius: "var(--radius)",
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : bulkMoving ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Move {selectedInView.length} to:
                </span>
                <select
                  value={bulkTargetWorkspace}
                  onChange={(e) => setBulkTargetWorkspace(e.target.value)}
                  style={{ padding: "4px 8px", fontSize: 12, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", color: "var(--text)" }}
                >
                  <option value="">Select workspace...</option>
                  {workspaces
                    .filter((w) => w.key !== currentProjectKey)
                    .map((w) => (
                      <option key={w.key} value={w.key}>
                        {w.label}
                      </option>
                    ))}
                </select>
                <button
                  onClick={() => bulkMoveMutation.mutate(selectedInView.map((m) => m.id))}
                  disabled={bulkMoveMutation.isPending || !bulkTargetWorkspace}
                  style={{
                    padding: "4px 12px",
                    background: "var(--accent)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: "var(--radius)",
                  }}
                >
                  {bulkMoveMutation.isPending ? "Moving…" : "Move"}
                </button>
                <button
                  onClick={() => { setBulkMoving(false); setBulkTargetWorkspace(""); }}
                  disabled={bulkMoveMutation.isPending}
                  style={{
                    padding: "4px 10px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    fontSize: 12,
                    borderRadius: "var(--radius)",
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => handleExport(selectedInView, "json")}
                  style={{
                    padding: "4.5px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--accent)";
                    b.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--border)";
                    b.style.color = "var(--text)";
                  }}
                >
                  Export JSON
                </button>
                <button
                  onClick={() => handleExport(selectedInView, "md")}
                  style={{
                    padding: "4.5px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--accent)";
                    b.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--border)";
                    b.style.color = "var(--text)";
                  }}
                >
                  Export Markdown
                </button>
                <button
                  onClick={onExportZip}
                  style={{
                    padding: "4.5px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--accent)";
                    b.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--border)";
                    b.style.color = "var(--text)";
                  }}
                >
                  Export Zip
                </button>
                {workspaces.filter((w) => w.key !== currentProjectKey).length > 0 && (
                  <button
                    onClick={() => setBulkMoving(true)}
                    style={{
                      padding: "4.5px 12px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontWeight: 600,
                      borderRadius: "var(--radius)",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--accent)";
                      b.style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      const b = e.currentTarget as HTMLButtonElement;
                      b.style.borderColor = "var(--border)";
                      b.style.color = "var(--text)";
                    }}
                  >
                    Move selected
                  </button>
                )}
                <button
                  onClick={() => setBulkConfirming(true)}
                  style={{
                    padding: "4.5px 12px",
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "var(--error)",
                    fontSize: 12,
                    fontWeight: 600,
                    borderRadius: "var(--radius)",
                  }}
                >
                  Delete selected
                </button>
              </div>
            )}
          </>
        ) : (
          <>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {filtered.length} memor{filtered.length !== 1 ? "ies" : "y"}
            </span>
            {filtered.length > 0 && (
              <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  onClick={() => handleExport(filtered, "json")}
                  style={{
                    padding: "4.5px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--accent)";
                    b.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--border)";
                    b.style.color = "var(--text)";
                  }}
                >
                  Export JSON
                </button>
                <button
                  onClick={() => handleExport(filtered, "md")}
                  style={{
                    padding: "4.5px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--accent)";
                    b.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--border)";
                    b.style.color = "var(--text)";
                  }}
                >
                  Export Markdown
                </button>
                <button
                  onClick={onExportZip}
                  style={{
                    padding: "4.5px 12px",
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 11,
                    fontWeight: 600,
                    borderRadius: "var(--radius)",
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--accent)";
                    b.style.color = "var(--accent)";
                  }}
                  onMouseLeave={(e) => {
                    const b = e.currentTarget as HTMLButtonElement;
                    b.style.borderColor = "var(--border)";
                    b.style.color = "var(--text)";
                  }}
                >
                  Export Zip
                </button>
                <button
                  onClick={() => {
                    setSelected(new Set(filtered.map((m) => m.id)));
                    setBulkConfirming(true);
                  }}
                  style={{
                    padding: "4.5px 12.5px",
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.25)",
                    color: "var(--error)",
                    fontSize: 11,
                    borderRadius: "var(--radius)",
                    opacity: 0.6,
                  }}
                >
                  Delete All
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {filtered.map((m) => (
        <MemoryRow
          key={m.id}
          memory={m}
          selected={selected.has(m.id)}
          onToggleSelect={toggleOne}
          onShowHistory={onShowHistory}
          workspaces={workspaces}
          currentProjectKey={currentProjectKey}
        />
      ))}
    </div>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'alphabetical'>('newest');
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [showNewMemory, setShowNewMemory] = useState(false);
  const [activeTimelineId, setActiveTimelineId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("onboarding-dismissed") !== "true";
    }
    return true;
  });
  const [onboardingSteps, setOnboardingSteps] = useState<Record<string, boolean>>(() => {
    if (typeof window !== "undefined") {
      try {
        return JSON.parse(localStorage.getItem("onboarding-steps") || "{}");
      } catch {
        return {};
      }
    }
    return {};
  });

  const [projectKey, setProjectKey] = useState<string>("personal");
  const [memoryTab, setMemoryTab] = useState<"active" | "archived">("active");

  const { data: workspaces = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getUserWorkspaces(),
  });

  const { data: memories = [], isLoading, isError } = useQuery({
    queryKey: ["memories", projectKey],
    queryFn: () => getMemories({ data: { projectKey: projectKey === "personal" ? undefined : projectKey } }),
    enabled: memoryTab === "active",
  });

  const { data: archivedData } = useQuery({
    queryKey: ["memories-archived", projectKey],
    queryFn: () => getArchivedMemories({ data: { projectKey: projectKey === "personal" ? undefined : projectKey } }),
    enabled: memoryTab === "archived",
  });

  const { data: usageStats } = useQuery({
    queryKey: ["memory-usage"],
    queryFn: () => getMemoryUsageStats(),
    enabled: projectKey === "personal",
  });

  async function triggerExport() {
    try {
      const res = await fetch("/api/export", { method: "POST" });
      if (!res.ok) {
        alert("Export failed: " + res.statusText);
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
      alert("Error triggering export: " + String(err));
    }
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["memories"] });
  }

  const totalByCategory = useMemo(() => {
    const counts: Record<string, number> = { rules: 0, projects: 0, references: 0 };
    for (const m of memories) counts[m.category] = (counts[m.category] ?? 0) + 1;
    return counts;
  }, [memories]);

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
    <div>
      {/* Page header bar */}
      <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)", padding: "20px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <path d="M3 9h18M9 21V9" />
              </svg>
              <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Memory Locker</h1>
              <InfoTooltip text="Your personal memory store. Facts saved here are retrieved automatically by your AI assistant during sessions via the MCP endpoint." />
              <span style={{ fontSize: 11, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
                {memories.length} entries
              </span>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
              Long-term technical context. Semantic retrieval via{" "}
              <code style={{ color: "var(--accent)", fontSize: 12 }}>/api/mcp</code> MCP endpoint.
            </p>
            {usageStats && usageStats.limit && usageStats.used / usageStats.limit > 0.8 && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>Memory usage</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: usageStats.used >= usageStats.limit ? "var(--error)" : "var(--accent)" }}>
                    {usageStats.used} / {usageStats.limit}
                  </span>
                </div>
                <div style={{ width: "100%", maxWidth: 300, height: 6, background: "var(--surface)", borderRadius: 3, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(100, (usageStats.used / usageStats.limit) * 100)}%`,
                      background: usageStats.used >= usageStats.limit ? "var(--error)" : "var(--accent)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
            <InfoTooltip text="Switch between your personal vault and any org/team vaults you belong to. Each vault is retrieved separately during AI sessions." />
            <select
              value={projectKey}
              onChange={(e) => setProjectKey(e.target.value)}
              style={{ padding: "6px 12px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 12, borderRadius: "var(--radius)", cursor: "pointer" }}
            >
              {workspaces.map((w) => (
                <option key={w.key} value={w.key}>{w.label}</option>
              ))}
            </select>
            <button
              onClick={() => setShowNewMemory(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, borderRadius: "var(--radius)" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Memory
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>

      {memories.length === 0 && showOnboarding && (
        <div style={{
          background: "linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(139,92,246,0.04) 100%)",
          border: "1px solid rgba(168,85,247,0.25)",
          borderRadius: 12,
          padding: "20px 22px",
          marginBottom: 24,
          display: "flex",
          alignItems: "flex-start",
          gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
                <path d="M10 16.5l-3-3 1.41-1.41L10 13.68l5.59-5.59L17 9.5l-7 7z"/>
              </svg>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", margin: 0 }}>Get started with Locker</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { id: "connect", label: "Connect an AI client", desc: "Link Claude Desktop, VS Code, or Claude Web", href: "/connect" },
                { id: "first-memory", label: "Add your first memory", desc: "Create a rule, project note, or reference" },
                { id: "import", label: "Import from ChatGPT", desc: "Bulk import existing conversation history", href: "/import" },
              ].map(item => (
                <label key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={onboardingSteps[item.id] || false}
                    onChange={(e) => updateOnboardingStep(item.id, e.target.checked)}
                    style={{ marginTop: 4, accentColor: "var(--accent)", cursor: "pointer", flex: 0 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: onboardingSteps[item.id] ? "var(--text-muted)" : "var(--text)", textDecoration: onboardingSteps[item.id] ? "line-through" : "none" }}>
                      {item.href ? <a href={item.href} style={{ color: "inherit", textDecoration: "none" }}>{item.label}</a> : item.label}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{item.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <button
            onClick={dismissOnboarding}
            style={{
              flex: 0,
              background: "none",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 0,
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
        {[
          { label: "Total", value: memories.length, color: "var(--text)" },
          { label: "Rules", value: totalByCategory.rules, color: CATEGORY_COLORS.rules },
          { label: "Projects", value: totalByCategory.projects, color: CATEGORY_COLORS.projects },
          { label: "References", value: totalByCategory.references, color: CATEGORY_COLORS.references },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            style={{
              background: "linear-gradient(135deg, rgba(168,85,247,0.03) 0%, rgba(139,92,246,0.01) 100%)",
              border: "1px solid rgba(168,85,247,0.12)",
              borderRadius: 12,
              padding: "16px 18px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6, fontWeight: 600 }}>
              {label}
            </div>
            <div style={{ fontSize: 32, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Memory tabs */}
      <div style={{ marginBottom: 20, display: "flex", gap: 2, borderBottom: "1px solid var(--border)", alignItems: "flex-end" }}>
        <InfoTooltip text="Active memories are injected into AI sessions. Archived memories are retained but not retrieved unless restored." />
        <button
          onClick={() => setMemoryTab("active")}
          style={{
            padding: "8px 16px",
            background: memoryTab === "active" ? "var(--surface)" : "transparent",
            border: "none",
            borderTop: memoryTab === "active" ? "3px solid var(--accent)" : "3px solid transparent",
            borderLeft: memoryTab === "active" ? "1px solid var(--border)" : "1px solid transparent",
            borderRight: memoryTab === "active" ? "1px solid var(--border)" : "1px solid transparent",
            borderBottom: memoryTab === "active" ? "1px solid var(--surface)" : "none",
            color: memoryTab === "active" ? "var(--text)" : "var(--text-muted)",
            fontSize: 13,
            fontWeight: memoryTab === "active" ? 600 : 400,
            cursor: "pointer",
            marginBottom: -1,
            borderRadius: "4px 4px 0 0",
          }}
        >
          Active {memories.length > 0 && <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>({memories.length})</span>}
        </button>
        <button
          onClick={() => setMemoryTab("archived")}
          style={{
            padding: "8px 16px",
            background: memoryTab === "archived" ? "var(--surface)" : "transparent",
            border: "none",
            borderTop: memoryTab === "archived" ? "3px solid var(--accent)" : "3px solid transparent",
            borderLeft: memoryTab === "archived" ? "1px solid var(--border)" : "1px solid transparent",
            borderRight: memoryTab === "archived" ? "1px solid var(--border)" : "1px solid transparent",
            borderBottom: memoryTab === "archived" ? "1px solid var(--surface)" : "none",
            color: memoryTab === "archived" ? "var(--text)" : "var(--text-muted)",
            fontSize: 13,
            fontWeight: memoryTab === "archived" ? 600 : 400,
            cursor: "pointer",
            marginBottom: -1,
            borderRadius: "4px 4px 0 0",
          }}
        >
          Archived {archivedData?.total ? <span style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>({archivedData.total})</span> : null}
        </button>
      </div>

      {memoryTab === "active" && (
        <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-muted)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by keyword or tag…"
              style={{ width: "100%", padding: "8px 12px 8px 32px" }}
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ padding: "8px 12px", minWidth: 140 }}
          >
            <option value="">All categories</option>
            <option value="rules">Rules</option>
            <option value="projects">Projects</option>
            <option value="references">References</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'alphabetical')}
            style={{ padding: "8px 12px", minWidth: 120 }}
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="alphabetical">Alphabetical</option>
          </select>

          <input
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            title="Filter from date"
            style={{ padding: "8px 12px", minWidth: 120 }}
          />
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            title="Filter to date"
            style={{ padding: "8px 12px", minWidth: 120 }}
          />

          {(filter || categoryFilter || sortBy !== 'newest' || dateStart || dateEnd) && (
            <button
              onClick={() => { setFilter(""); setCategoryFilter(""); setSortBy('newest'); setDateStart(""); setDateEnd(""); }}
              style={{
                padding: "8px 12px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontSize: 12,
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {memoryTab === "archived" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {archivedData?.archived && archivedData.archived.length > 0 ? (
            archivedData.archived.map((memory: any) => {
              const restoreMut = useMutation({
                mutationFn: () => restoreMemory({ data: { id: memory.id } }),
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: ["memories-archived"] });
                  queryClient.invalidateQueries({ queryKey: ["memories"] });
                },
              });

              const deleteMut = useMutation({
                mutationFn: () => permanentlyDeleteArchivedMemory({ data: { id: memory.id } }),
                onSuccess: () => {
                  queryClient.invalidateQueries({ queryKey: ["memories-archived"] });
                },
              });

              return (
                <div
                  key={memory.id}
                  style={{
                    padding: "14px 18px",
                    borderBottom: "1px solid var(--border)",
                    background: "rgba(168,85,247,0.02)",
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: "16px",
                    alignItems: "start",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ marginBottom: 6, lineHeight: 1.5, wordBreak: "break-word", color: "var(--text-muted)" }}>
                      {memory.fact}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 8px",
                        background: `${CATEGORY_COLORS[memory.category]}18`,
                        color: CATEGORY_COLORS[memory.category],
                        borderRadius: 3,
                      }}>
                        {CATEGORY_LABELS[memory.category]}
                      </span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        {new Date(memory.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => restoreMut.mutate()}
                      disabled={restoreMut.isPending}
                      style={{
                        padding: "4px 10px",
                        background: "rgba(76,175,80,0.15)",
                        border: "1px solid rgba(76,175,80,0.4)",
                        color: "rgb(76,175,80)",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: "var(--radius)",
                        cursor: restoreMut.isPending ? "default" : "pointer",
                      }}
                    >
                      {restoreMut.isPending ? "Restoring…" : "Restore"}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("Permanently delete this archived memory?")) {
                          deleteMut.mutate();
                        }
                      }}
                      disabled={deleteMut.isPending}
                      style={{
                        padding: "4px 10px",
                        background: "rgba(239,68,68,0.15)",
                        border: "1px solid rgba(239,68,68,0.4)",
                        color: "var(--error)",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: "var(--radius)",
                        cursor: deleteMut.isPending ? "default" : "pointer",
                      }}
                    >
                      {deleteMut.isPending ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "48px 24px" }}>
              No archived memories
            </p>
          )}
        </div>
      )}

      {memoryTab === "active" && isLoading && (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--text-muted)" }}>
          Loading memories…
        </div>
      )}
      {memoryTab === "active" && isError && (
        <div
          style={{
            textAlign: "center",
            padding: "24px",
            color: "var(--error)",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: "var(--radius)",
          }}
        >
          Failed to load memories.
        </div>
      )}
      {!isLoading && !isError && memories.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "56px 24px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
          }}
        >
          <svg
            width="56"
            height="56"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--border)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ marginBottom: 16, display: "block", margin: "0 auto 16px" }}
          >
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 9h18M9 21V9" />
            <line x1="12" y1="13" x2="12" y2="17" />
            <line x1="10" y1="15" x2="14" y2="15" />
          </svg>
          <p style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
            No memories yet
          </p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", maxWidth: 320, margin: "0 auto" }}>
            Paste some memories using the Bulk Ingest panel above to get started. They'll appear here and become searchable via the MCP endpoint.
          </p>
        </div>
      )}
      {memoryTab === "active" && !isLoading && !isError && memories.length > 0 && (
        <MemoryTable
          memories={memories}
          filter={filter}
          categoryFilter={categoryFilter}
          sortBy={sortBy}
          dateStart={dateStart}
          dateEnd={dateEnd}
          onShowHistory={setActiveTimelineId}
          onExportZip={triggerExport}
          workspaces={workspaces}
          currentProjectKey={projectKey}
        />
      )}

      {showNewMemory && (
        <NewMemoryModal
          onClose={() => setShowNewMemory(false)}
          onSaved={invalidate}
          projectKey={projectKey === "personal" ? undefined : projectKey}
        />
      )}

      {activeTimelineId && (
        <HistoryModal
          memoryId={activeTimelineId}
          onClose={() => setActiveTimelineId(null)}
          onReverted={() => {
            setActiveTimelineId(null);
            invalidate();
          }}
        />
      )}
      </div>
    </div>
  );
}

function HistoryModal({
  memoryId,
  onClose,
  onReverted,
}: {
  memoryId: string;
  onClose: () => void;
  onReverted: () => void;
}) {
  const { data: versions = [], isLoading, isError } = useQuery({
    queryKey: ["memory-timeline", memoryId],
    queryFn: () => getMemoryTimeline({ data: { memoryId } }),
  });

  const queryClient = useQueryClient();

  const revertMutation = useMutation({
    mutationFn: (versionId: string) => revertMemoryVersion({ data: { versionId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      onReverted();
    },
    onError: (err) => {
      alert("Revert failed: " + String(err));
    },
  });

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0, 0, 0, 0.4)",
      backdropFilter: "blur(4px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    }}>
      <div style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        width: "90%",
        maxWidth: 600,
        maxHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
      }}>
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Version History</h3>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{
          padding: 20,
          overflowY: "auto",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}>
          {isLoading && <div style={{ color: "var(--text-muted)", textAlign: "center" }}>Loading history…</div>}
          {isError && <div style={{ color: "var(--error)", textAlign: "center" }}>Failed to load timeline.</div>}
          {!isLoading && !isError && versions.length === 0 && (
            <div style={{ color: "var(--text-muted)", textAlign: "center" }}>No history found for this memory.</div>
          )}

          {!isLoading && !isError && versions.map((v: any, index: number) => {
            const isLatest = index === 0;
            return (
              <div
                key={v.id}
                style={{
                  borderLeft: "2px solid var(--accent)",
                  paddingLeft: 16,
                  position: "relative",
                  marginBottom: index === versions.length - 1 ? 0 : 8,
                }}
              >
                <div style={{
                  position: "absolute",
                  left: -5,
                  top: 4,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--accent)",
                }} />
                
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      color: "var(--accent)",
                      background: "var(--tag-bg)",
                      border: "1px solid var(--tag-border)",
                      padding: "2px 6px",
                      borderRadius: 4,
                    }}>
                      {v.changeReason || "changed"}
                    </span>
                    {isLatest && (
                      <span style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontStyle: "italic",
                      }}>
                        (Current)
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {new Date(v.timestamp).toLocaleString()}
                  </span>
                </div>

                <p style={{ margin: "0 0 8px 0", fontSize: 13, lineHeight: 1.5, wordBreak: "break-word" }}>
                  {v.fact}
                </p>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface2)", padding: "2px 6px", borderRadius: 4 }}>
                      {v.category}
                    </span>
                    {(v.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean).map((tag: string) => (
                      <span key={tag} style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--tag-bg)", border: "1px solid var(--tag-border)", padding: "1px 5px", borderRadius: 4 }}>
                        {tag}
                      </span>
                    ))}
                  </div>

                  {!isLatest && (
                    <button
                      onClick={() => revertMutation.mutate(v.id)}
                      disabled={revertMutation.isPending}
                      style={{
                        padding: "3.5px 8px",
                        background: "var(--accent)",
                        color: "#fff",
                        border: "none",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 4,
                        cursor: "pointer",
                      }}
                    >
                      {revertMutation.isPending ? "Reverting…" : "Revert"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
