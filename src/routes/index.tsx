import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { getMemories, addMemory, batchImportMemories, parseMemoriesWithAI, deleteMemory, bulkDeleteMemories, updateMemory } from "~/server/memoryFunctions";
import type { Memory } from "~/db/schema";

export const Route = createFileRoute("/")({
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

function IngestPanel({ onSuccess }: { onSuccess: () => void }) {
  const [pasteText, setPasteText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Array<{ fact: string; category?: string; tags?: string }> | null>(null);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);

  const batchMutation = useMutation({
    mutationFn: (items: Array<{ fact: string; category?: string; tags?: string }>) =>
      batchImportMemories({ data: items }),
    onSuccess: (result) => {
      setPasteText("");
      setPreview(null);
      setParseError(null);
      setImportResult(result);
      onSuccess();
      setTimeout(() => setImportResult(null), 8000);
    },
  });

  async function handleProcess() {
    setParseError(null);
    setPreview(null);
    setImportResult(null);
    if (!pasteText.trim()) return;
    setParsing(true);
    try {
      const items = await parseMemoriesWithAI({ data: { text: pasteText } });
      if (items.length === 0) {
        setParseError("No memories could be extracted. Try adding more content.");
      } else {
        setPreview(items);
      }
    } catch (e) {
      setParseError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  function handleImport() {
    if (!preview) return;
    batchMutation.mutate(preview);
  }

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
        <span style={{ fontWeight: 600 }}>Bulk Ingest</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: "auto" }}>
          Paste raw chatbot output — AI will extract the memories
        </span>
      </div>

      <div style={{ padding: 18 }}>
        <textarea
          value={pasteText}
          onChange={(e) => { setPasteText(e.target.value); setParseError(null); setPreview(null); setImportResult(null); }}
          placeholder={"Paste anything — chatbot memory exports, free-form text, structured or unstructured output. AI will extract the discrete facts."}
          rows={8}
          style={{ width: "100%", padding: "10px 12px", resize: "vertical", fontFamily: "monospace", fontSize: 12, lineHeight: 1.6 }}
        />

        {parseError && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius)", color: "var(--error)", fontSize: 12 }}>
            {parseError}
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 8, padding: "10px 12px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: "var(--radius)", fontSize: 12, color: "var(--text-muted)" }}>
            <strong style={{ color: "var(--accent)" }}>Preview:</strong> {preview.length} memor{preview.length !== 1 ? "ies" : "y"} extracted.{" "}
            {preview.slice(0, 2).map((p, i) => (
              <span key={i} style={{ color: "var(--text)" }}>
                &ldquo;{p.fact.slice(0, 60)}{p.fact.length > 60 ? "…" : ""}&rdquo;
                {i < Math.min(1, preview.length - 1) ? ", " : ""}
              </span>
            ))}
            {preview.length > 2 && <span> and {preview.length - 2} more.</span>}
          </div>
        )}

        {batchMutation.isError && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "var(--radius)", color: "var(--error)", fontSize: 12 }}>
            Import failed: {(batchMutation.error as Error).message}
          </div>
        )}

        {importResult && (
          <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: "var(--radius)", color: "var(--success)", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>
              Imported {importResult.imported} memor{importResult.imported !== 1 ? "ies" : "y"}.
              {importResult.skipped > 0 && (
                <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                  {importResult.skipped} duplicate{importResult.skipped !== 1 ? "s" : ""} skipped.
                </span>
              )}
            </span>
            <button onClick={() => setImportResult(null)} style={{ background: "none", color: "var(--success)", padding: "0 2px", lineHeight: 1, fontSize: 14, opacity: 0.7 }}>×</button>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={handleProcess}
            disabled={!pasteText.trim() || parsing || batchMutation.isPending}
            style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }}
          >
            {parsing ? "Extracting…" : "Extract Memories"}
          </button>
          {preview && (
            <button
              onClick={handleImport}
              disabled={batchMutation.isPending}
              style={{ padding: "8px 16px", background: "var(--accent)", color: "#fff", fontWeight: 600 }}
            >
              {batchMutation.isPending ? `Importing…` : `Import ${preview.length} Memor${preview.length !== 1 ? "ies" : "y"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
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
              <button
                onClick={() => setBulkConfirming(true)}
                style={{
                  marginLeft: "auto",
                  padding: "4px 12px",
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
            )}
          </>
        ) : (
          <>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {filtered.length} memor{filtered.length !== 1 ? "ies" : "y"}
            </span>
            {filtered.length > 0 && (
              <button
                onClick={() => {
                  setSelected(new Set(filtered.map((m) => m.id)));
                  setBulkConfirming(true);
                }}
                style={{
                  marginLeft: "auto",
                  padding: "4px 10px",
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

type Chatbot = {
  id: string;
  label: string;
  color: string;
  url: string;
  deeplinkUrl?: (prompt: string) => string;
  prompt: string;
};

const CHATBOTS: Chatbot[] = [
  {
    id: "chatgpt",
    label: "ChatGPT",
    color: "#10a37f",
    url: "https://chatgpt.com/",
    prompt: `Export everything stored in your Memory about me. I want two sections:

**Section 1 — Saved Memories (explicit entries)**
List every discrete entry from your saved memory store — the entries visible in Settings > Personalization > Manage Memories. Output each one verbatim, exactly as stored, one per line. Do not paraphrase, merge, or omit any entry.

**Section 2 — Chat History Inferences (implicit layer)**
List any additional facts, preferences, or context you have inferred about me from past conversations that are NOT in your saved memory entries — things you know about me but haven't saved as a discrete memory. One fact per line.

Format each line as:
[YYYY-MM-DD] - Entry content here.
Use [unknown] if no date is available.

Output ONLY the two sections. No intro, no sign-off, no commentary. After both sections, state how many saved memory entries were listed and whether the list is complete.`,
  },
  {
    id: "claude",
    label: "Claude",
    color: "#d4956a",
    url: "https://claude.ai/new",
    prompt: `Export all of my stored memories and any context you've learned about me from past conversations. Preserve my words verbatim where possible, especially for instructions and preferences.

## Categories (output in this order):

1. **Instructions**: Rules I've explicitly asked you to follow going forward — tone, format, style, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

2. **Identity**: Name, age, location, education, family, relationships, languages, and personal interests.

3. **Career**: Current and past roles, companies, and general skill areas.

4. **Projects**: Projects I meaningfully built or committed to. Ideally ONE entry per project. Include what it does, current status, and any key decisions. Use the project name or a short descriptor as the first words of the entry.

5. **Preferences**: Opinions, tastes, and working-style preferences that apply broadly.

## Format:

Use section headers for each category. Within each category, list one entry per line, sorted by oldest date first. Format each line as:

[YYYY-MM-DD] - Entry content here.

If no date is known, use [unknown] instead.

## Output:
- Wrap the entire export in a single code block for easy copying.
- After the code block, state whether this is the complete set or if more remain.`,
  },
  {
    id: "perplexity",
    label: "Perplexity",
    color: "#20b2aa",
    url: "https://www.perplexity.ai/",
    deeplinkUrl: (p: string) => `https://www.perplexity.ai/search?q=${encodeURIComponent(p)}`,
    prompt: `Tell me everything you know about me: preferences, personal details, interests, recurring context, etc.

List every discrete memory entry. One entry per line. Do not paraphrase, summarize, group, or omit anything.

Format each line as:
[YYYY-MM-DD] - Entry content here.
Use [unknown] if no date is available.

End with a count of how many entries were listed and confirm whether the list is complete.`,
  },
  {
    id: "gemini",
    label: "Gemini",
    color: "#4285f4",
    url: "https://gemini.google.com/app",
    prompt: `You are helping me import context from one AI assistant to another. Your job is to go through our past conversations and sum up what you know about me.

In the output, please avoid using any first-person pronouns (I, my, me, mine) and any second-person pronouns (you, your, yours). Instead, refer to the individual you have learned about as "the user" or use neutral phrasing.

Preserve the user's words verbatim where possible, especially for instructions and preferences.

Categories (output in this order):
1. Demographics Information: Preferred names, profession, education, and general residence.
2. Interests & Preferences: Sustained, active engagements (not just owning an object or a one-time purchase).
3. Relationships: Confirmed, sustained relationships.
4. Dated Events, Projects & Plans: A log of significant, recent activities.
5. Instructions: Rules I've explicitly asked you to follow going forward, "always do X", "never do Y", and corrections to your behavior. Only include rules from stored memories, not from conversations.

Format:
Divide the content into the labeled section using the categories above. Try to include verbatim quotes from my prompts that justify each entry. Structure each entry using this format:
* The user's name is <name>.
    * Evidence: User said "call me <name>". Date: [YYYY-MM-DD].

Output:
- Output ONLY the requested information. Do not include any conversational filler, intro text, or sign-offs.

Finally, complete the sentence "Imported from: <name>", where name is ChatGPT, Claude, Grok, etc. This must be the absolute final text in your response.`,
  },
  {
    id: "grok",
    label: "Grok",
    color: "#e7e7e7",
    url: "https://x.com/i/grok",
    prompt: `Export everything stored in your persistent memory about me. List every discrete memory entry exactly as stored — the entries visible in Settings > Data Controls. One entry per line, verbatim. Do not paraphrase, summarize, merge, or omit any entry.

Format each line as:
[YYYY-MM-DD] - Entry content here.
Use [unknown] if no date is available.

Output ONLY the memory entries. No intro, no sign-off, no commentary. End with a count of entries listed and confirm whether this is the complete set.`,
  },
];

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function PromptPanel() {
  const [selectedBot, setSelectedBot] = useState<string>("chatgpt");
  const [copied, setCopied] = useState(false);

  const bot = CHATBOTS.find((b) => b.id === selectedBot) ?? CHATBOTS[0];

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(bot.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [bot.prompt]);

  const handleOpen = useCallback(async () => {
    if (bot.deeplinkUrl) {
      window.open(bot.deeplinkUrl(bot.prompt), "_blank", "noopener,noreferrer");
    } else {
      await navigator.clipboard.writeText(bot.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      window.open(bot.url, "_blank", "noopener,noreferrer");
    }
  }, [bot]);

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        <span style={{ fontWeight: 600 }}>Extract Memories</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: "auto" }}>
          Copy a prompt to pull your memories out of each chatbot
        </span>
      </div>

      <div style={{ padding: 18 }}>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Chatbot
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CHATBOTS.map((b) => (
              <button
                key={b.id}
                onClick={() => { setSelectedBot(b.id); setCopied(false); }}
                style={{
                  padding: "6px 14px",
                  background: selectedBot === b.id ? `${b.color}22` : "var(--surface2)",
                  border: `1px solid ${selectedBot === b.id ? b.color : "var(--border)"}`,
                  color: selectedBot === b.id ? b.color : "var(--text-muted)",
                  fontWeight: selectedBot === b.id ? 600 : 400,
                  fontSize: 12,
                  borderRadius: 20,
                  transition: "all 0.15s",
                }}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            background: "var(--surface2)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: "12px 14px",
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.7,
            color: "var(--text)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            marginBottom: 12,
          }}
        >
          {bot.prompt}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 1 }}>
            {bot.deeplinkUrl
              ? `Opens ${bot.label} with the prompt pre-filled`
              : `Copies prompt then opens ${bot.label} — just paste and send`}
          </span>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={handleCopy}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 14px",
                background: copied ? "rgba(34,197,94,0.15)" : "var(--surface2)",
                border: copied ? "1px solid rgba(34,197,94,0.4)" : "1px solid var(--border)",
                color: copied ? "var(--success)" : "var(--text-muted)",
                fontWeight: 500,
                fontSize: 13,
                transition: "all 0.2s",
              }}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? "Copied!" : "Copy"}
            </button>
            <button
              onClick={handleOpen}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                background: `${bot.color}22`,
                border: `1px solid ${bot.color}66`,
                color: bot.color,
                fontWeight: 600,
                fontSize: 13,
                transition: "all 0.2s",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              Open {bot.label}
            </button>
          </div>
        </div>
      </div>
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
          <button
            onClick={() => setShowNewMemory(true)}
            style={{
              marginLeft: "auto",
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

      <div style={{ marginBottom: 20 }}>
        <IngestPanel onSuccess={invalidate} />
      </div>

      <div style={{ marginBottom: 20 }}>
        <PromptPanel />
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
