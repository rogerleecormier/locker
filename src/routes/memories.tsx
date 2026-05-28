import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { getMemories, addMemory, deleteMemory, bulkDeleteMemories, updateMemory } from "~/server/memoryFunctions";
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
}: {
  memory: Memory;
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
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
          background: "rgba(99,102,241,0.04)",
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
        background: selected ? "rgba(99,102,241,0.05)" : undefined,
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
        <CategoryBadge category={memory.category} />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {new Date(memory.timestamp).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
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
              b.style.borderColor = "rgba(99,102,241,0.4)";
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
          {confirming ? (
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
          )}
        </div>
      </div>
    </div>
  );
}

function NewMemoryModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const queryClient = useQueryClient();
  const [fact, setFact] = useState("");
  const [category, setCategory] = useState<"rules" | "projects" | "references">("references");
  const [tags, setTags] = useState("");

  const mutation = useMutation({
    mutationFn: () => addMemory({ data: { fact, category, tags } }),
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
            <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Fact</label>
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
              <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Category</label>
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
              <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Tags</label>
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
}: {
  memories: Memory[];
  filter: string;
  categoryFilter: string;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirming, setBulkConfirming] = useState(false);

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
    return memories.filter((m) => {
      const matchesCat = !categoryFilter || m.category === categoryFilter;
      const matchesText =
        !q ||
        m.fact.toLowerCase().includes(q) ||
        m.tags.toLowerCase().includes(q);
      return matchesCat && matchesText;
    });
  }, [memories, filter, categoryFilter]);

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
        />
      ))}
    </div>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showNewMemory, setShowNewMemory] = useState(false);

  const { data: memories = [], isLoading, isError } = useQuery({
    queryKey: ["memories"],
    queryFn: () => getMemories(),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["memories"] });
  }

  const totalByCategory = useMemo(() => {
    const counts: Record<string, number> = { rules: 0, projects: 0, references: 0 };
    for (const m of memories) counts[m.category] = (counts[m.category] ?? 0) + 1;
    return counts;
  }, [memories]);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 20px" }}>
      <header style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M3 9h18M9 21V9" />
          </svg>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Locker</h1>
          <span
            style={{
              fontSize: 11,
              background: "var(--accent-dim)",
              color: "var(--accent)",
              border: "1px solid rgba(99,102,241,0.3)",
              borderRadius: 20,
              padding: "2px 8px",
              fontWeight: 600,
            }}
          >
            Memory Manager
          </span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            <Link
              to="/admin"
              style={{
                padding: "6px 12px",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontSize: 12,
                borderRadius: "var(--radius)",
                textDecoration: "none",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.borderColor = "var(--text-muted)";
                (e.target as HTMLElement).style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.borderColor = "var(--border)";
                (e.target as HTMLElement).style.color = "var(--text-muted)";
              }}
            >
              Admin
            </Link>
            <button
              onClick={() => setShowNewMemory(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "7px 16px",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 13,
                borderRadius: "var(--radius)",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              New Memory
            </button>
          </div>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Long-term technical context. Semantic retrieval via{" "}
          <code style={{ color: "var(--accent)", fontSize: 12 }}>/api/mcp</code> MCP endpoint.
        </p>
      </header>

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
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: "14px 18px",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>

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
        {(filter || categoryFilter) && (
          <button
            onClick={() => { setFilter(""); setCategoryFilter(""); }}
            style={{
              padding: "8px 12px",
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              fontSize: 12,
            }}
          >
            Clear
          </button>
        )}
      </div>

      {isLoading && (
        <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--text-muted)" }}>
          Loading memories…
        </div>
      )}
      {isError && (
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
      {!isLoading && !isError && memories.length > 0 && (
        <MemoryTable memories={memories} filter={filter} categoryFilter={categoryFilter} />
      )}

      {showNewMemory && (
        <NewMemoryModal
          onClose={() => setShowNewMemory(false)}
          onSaved={invalidate}
        />
      )}
    </div>
  );
}
