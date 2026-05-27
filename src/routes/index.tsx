import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import { getMemories, batchImportMemories } from "~/server/memoryFunctions";
import type { Memory } from "~/db/schema";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

type RawImportItem = {
  fact?: string;
  category?: string;
  tags?: string;
  [key: string]: unknown;
};

function parsePaste(raw: string): Array<{ fact: string; category?: string; tags?: string }> {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Input is empty.");

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("JSON must be an array.");
    return (parsed as RawImportItem[]).map((item, i) => {
      if (!item.fact || typeof item.fact !== "string") {
        throw new Error(`Item at index ${i} is missing a "fact" string field.`);
      }
      return {
        fact: item.fact.trim(),
        category: typeof item.category === "string" ? item.category : undefined,
        tags: typeof item.tags === "string" ? item.tags : undefined,
      };
    });
  } catch (jsonErr) {
    if ((jsonErr as Error).message.includes("missing a") || (jsonErr as Error).message.includes("must be an array")) {
      throw jsonErr;
    }
    const lines = trimmed
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) throw new Error("No non-empty lines found.");
    return lines.map((line) => ({ fact: line }));
  }
}

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

function MemoryRow({ memory }: { memory: Memory }) {
  const tags = memory.tags
    ? memory.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  return (
    <div
      style={{
        padding: "14px 18px",
        borderBottom: "1px solid var(--border)",
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: "8px 16px",
        alignItems: "start",
      }}
    >
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
      </div>
    </div>
  );
}

function IngestPanel({ onSuccess }: { onSuccess: () => void }) {
  const [pasteText, setPasteText] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Array<{ fact: string; category?: string; tags?: string }> | null>(null);

  const batchMutation = useMutation({
    mutationFn: (items: Array<{ fact: string; category?: string; tags?: string }>) =>
      batchImportMemories({ data: items }),
    onSuccess: () => {
      setPasteText("");
      setPreview(null);
      setParseError(null);
      onSuccess();
    },
  });

  function handleProcess() {
    setParseError(null);
    setPreview(null);
    try {
      const items = parsePaste(pasteText);
      setPreview(items);
    } catch (e) {
      setParseError((e as Error).message);
    }
  }

  function handleImport() {
    if (!preview) return;
    batchMutation.mutate(preview);
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
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
        <span style={{ fontWeight: 600 }}>Bulk Ingest</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: "auto" }}>
          Paste JSON array or plain lines
        </span>
      </div>

      <div style={{ padding: 18 }}>
        <textarea
          value={pasteText}
          onChange={(e) => {
            setPasteText(e.target.value);
            setParseError(null);
            setPreview(null);
          }}
          placeholder={`Paste JSON:\n[{"fact": "...", "category": "rules", "tags": "ci,testing"}]\n\nOr plain text lines:\nEach line becomes one memory entry\nAnother fact here`}
          rows={8}
          style={{
            width: "100%",
            padding: "10px 12px",
            resize: "vertical",
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        />

        {parseError && (
          <div
            style={{
              marginTop: 8,
              padding: "8px 12px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "var(--radius)",
              color: "var(--error)",
              fontSize: 12,
            }}
          >
            {parseError}
          </div>
        )}

        {preview && !parseError && (
          <div
            style={{
              marginTop: 8,
              padding: "10px 12px",
              background: "rgba(99,102,241,0.08)",
              border: "1px solid rgba(99,102,241,0.25)",
              borderRadius: "var(--radius)",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            <strong style={{ color: "var(--accent)" }}>Preview:</strong> {preview.length} item
            {preview.length !== 1 ? "s" : ""} parsed.{" "}
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
          <div
            style={{
              marginTop: 8,
              padding: "8px 12px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "var(--radius)",
              color: "var(--error)",
              fontSize: 12,
            }}
          >
            Import failed: {(batchMutation.error as Error).message}
          </div>
        )}

        {batchMutation.isSuccess && (
          <div
            style={{
              marginTop: 8,
              padding: "8px 12px",
              background: "rgba(34,197,94,0.1)",
              border: "1px solid rgba(34,197,94,0.3)",
              borderRadius: "var(--radius)",
              color: "var(--success)",
              fontSize: 12,
            }}
          >
            Import complete.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={handleProcess}
            disabled={!pasteText.trim() || batchMutation.isPending}
            style={{
              padding: "8px 16px",
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
            }}
          >
            Process Paste
          </button>
          {preview && (
            <button
              onClick={handleImport}
              disabled={batchMutation.isPending}
              style={{
                padding: "8px 16px",
                background: "var(--accent)",
                color: "#fff",
                fontWeight: 600,
              }}
            >
              {batchMutation.isPending
                ? `Importing ${preview.length}…`
                : `Import ${preview.length} Item${preview.length !== 1 ? "s" : ""}`}
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
      {filtered.map((m) => (
        <MemoryRow key={m.id} memory={m} />
      ))}
    </div>
  );
}

type Chatbot = {
  id: string;
  label: string;
  color: string;
  preamble: string;
};

const CHATBOTS: Chatbot[] = [
  {
    id: "perplexity",
    label: "Perplexity",
    color: "#20b2aa",
    preamble:
      "You are an AI assistant. I'm providing my personal memory context below — treat it as established facts about me and my work when answering questions.",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    color: "#10a37f",
    preamble:
      "I'm sharing my personal memory context with you. Please use these facts to personalize your responses throughout our conversation.",
  },
  {
    id: "claude",
    label: "Claude",
    color: "#d4956a",
    preamble:
      "The following is my personal memory context — background facts about my work, projects, and preferences. Reference them as needed when answering.",
  },
  {
    id: "gemini",
    label: "Gemini",
    color: "#4285f4",
    preamble:
      "Here is my personal memory context. Use these facts as background knowledge about me throughout our conversation.",
  },
  {
    id: "grok",
    label: "Grok",
    color: "#e7e7e7",
    preamble:
      "Below is my personal memory context. I want you to treat these as established facts about me and use them to inform your responses.",
  },
];

function buildPrompt(preamble: string, memories: Memory[], categoryFilter: string): string {
  const filtered = categoryFilter ? memories.filter((m) => m.category === categoryFilter) : memories;
  if (filtered.length === 0) return "";

  const grouped: Record<string, Memory[]> = {};
  for (const m of filtered) {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m);
  }

  const sections = Object.entries(grouped)
    .map(([cat, items]) => {
      const header = cat.charAt(0).toUpperCase() + cat.slice(1);
      const lines = items.map((m) => {
        const tags = m.tags ? ` [${m.tags}]` : "";
        return `- ${m.fact}${tags}`;
      });
      return `## ${header}\n${lines.join("\n")}`;
    })
    .join("\n\n");

  return `${preamble}\n\n---\n\n${sections}\n\n---`;
}

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

function PromptPanel({ memories }: { memories: Memory[] }) {
  const [selectedBot, setSelectedBot] = useState<string>("chatgpt");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const bot = CHATBOTS.find((b) => b.id === selectedBot) ?? CHATBOTS[0];

  const prompt = useMemo(
    () => buildPrompt(bot.preamble, memories, categoryFilter),
    [bot.preamble, memories, categoryFilter]
  );

  const handleCopy = useCallback(async () => {
    if (!prompt) return;
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [prompt]);

  const memoryCount = categoryFilter
    ? memories.filter((m) => m.category === categoryFilter).length
    : memories.length;

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
        <span style={{ fontWeight: 600 }}>Prompt Builder</span>
        <span style={{ color: "var(--text-muted)", fontSize: 12, marginLeft: "auto" }}>
          Copy your memories as a chatbot prompt
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
                onClick={() => setSelectedBot(b.id)}
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

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            Include
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { value: "", label: "All memories" },
              { value: "rules", label: "Rules only" },
              { value: "projects", label: "Projects only" },
              { value: "references", label: "References only" },
            ].map(({ value, label }) => (
              <button
                key={value}
                onClick={() => setCategoryFilter(value)}
                style={{
                  padding: "6px 14px",
                  background: categoryFilter === value ? "var(--accent-dim)" : "var(--surface2)",
                  border: `1px solid ${categoryFilter === value ? "rgba(99,102,241,0.4)" : "var(--border)"}`,
                  color: categoryFilter === value ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: categoryFilter === value ? 600 : 400,
                  fontSize: 12,
                  borderRadius: 20,
                  transition: "all 0.15s",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {prompt ? (
          <>
            <div
              style={{
                position: "relative",
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
              }}
            >
              <pre
                style={{
                  margin: 0,
                  padding: "12px 14px",
                  fontFamily: "monospace",
                  fontSize: 11,
                  lineHeight: 1.7,
                  color: "var(--text-muted)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: 180,
                  overflowY: "auto",
                }}
              >
                {prompt}
              </pre>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {memoryCount} memor{memoryCount !== 1 ? "ies" : "y"} · {prompt.length.toLocaleString()} chars
              </span>
              <button
                onClick={handleCopy}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  background: copied ? "rgba(34,197,94,0.15)" : "var(--accent)",
                  border: copied ? "1px solid rgba(34,197,94,0.4)" : "none",
                  color: copied ? "var(--success)" : "#fff",
                  fontWeight: 600,
                  fontSize: 13,
                  transition: "all 0.2s",
                }}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? "Copied!" : "Copy Prompt"}
              </button>
            </div>
          </>
        ) : (
          <div
            style={{
              padding: "20px",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: 13,
              background: "var(--surface2)",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
            }}
          >
            No memories to include.
          </div>
        )}
      </div>
    </div>
  );
}

function Dashboard() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

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

      {!isLoading && !isError && (
        <div style={{ marginBottom: 20 }}>
          <PromptPanel memories={memories} />
        </div>
      )}

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
    </div>
  );
}
