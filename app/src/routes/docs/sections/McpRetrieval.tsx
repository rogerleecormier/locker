import type { SectionProps } from "../types";

interface Param {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface ToolDef {
  name: string;
  badge: string;
  badgeColor: string;
  description: string;
  params: Param[];
  returns: string;
  note?: string;
}

const tools: ToolDef[] = [
  {
    name: "recall_context",
    badge: "Hybrid GraphRAG",
    badgeColor: "#a855f7",
    description:
      "Hybrid GraphRAG retrieval — combines semantic vector search (bge-m3), FTS5 keyword search, and recency decay via Reciprocal Rank Fusion. Decrypts top candidates and reranks with Llama-3.3-70B. Returns the most relevant memories for the given query.",
    params: [
      { name: "query", type: "string", required: true, description: "Natural-language search query" },
      { name: "limit", type: "number", required: false, description: "Max memories to return (default: 5, max: 20)" },
      { name: "category", type: "string", required: false, description: "Filter by category: rules, projects, references, stack" },
      { name: "tags", type: "string[]", required: false, description: "Filter to memories matching all specified tags" },
      { name: "optimize", type: "boolean", required: false, description: "If true, synthesizes results into a compact system-prompt list via Llama-3-8B" },
      { name: "scope", type: "string", required: false, description: "Restrict to a specific team workspace key" },
    ],
    returns: "Array of decrypted memory objects with similarity scores. If optimize: true, returns a synthesized string.",
    note: "Most frequently called tool in typical AI workflows. Use optimize: true at session start to efficiently prime the model's context window.",
  },
  {
    name: "search_memories",
    badge: "FTS5 Keyword",
    badgeColor: "#3b82f6",
    description:
      "Keyword-based search across memory bodies and tags. Uses FTS5 full-text index. Faster than recall_context but no semantic understanding.",
    params: [
      { name: "query", type: "string", required: true, description: "Keyword search query" },
      { name: "limit", type: "number", required: false, description: "Max results (default: 10)" },
      { name: "category", type: "string", required: false, description: "Filter by category" },
    ],
    returns: "Array of matching memory objects (decrypted).",
    note: "Use when you know the exact term to find, or when speed is more important than recall quality.",
  },
  {
    name: "get_memory_summary",
    badge: "Overview",
    badgeColor: "#10b981",
    description:
      "Returns a high-level summary of all memories in the vault — counts by category, tag cloud, recent activity, and stale memory count. Useful for agents to orient themselves at session start.",
    params: [],
    returns: "Summary object with category counts, total memory count, stale count (not accessed in 30+ days), and recent additions.",
    note: "Call this at the start of a new agent session to understand the current state of the vault before querying.",
  },
];

function ParamTable({ params }: { params: Param[] }) {
  if (params.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 4px 0", fontStyle: "italic" }}>
        No parameters required.
      </p>
    );
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {["Parameter", "Type", "Required", "Description"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: "var(--text-muted)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {params.map((p, i) => (
            <tr key={p.name} style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)" }}>
              <td style={{ padding: "7px 10px", verticalAlign: "top" }}>
                <code style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>{p.name}</code>
              </td>
              <td style={{ padding: "7px 10px", verticalAlign: "top" }}>
                <code style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.type}</code>
              </td>
              <td style={{ padding: "7px 10px", verticalAlign: "top" }}>
                <span style={{ fontSize: 11, color: p.required ? "#10b981" : "var(--text-muted)", fontWeight: p.required ? 700 : 400 }}>
                  {p.required ? "Yes" : "No"}
                </span>
              </td>
              <td style={{ padding: "7px 10px", color: "var(--text-muted)", fontSize: 12, verticalAlign: "top", lineHeight: 1.5 }}>
                {p.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function McpRetrieval(_props: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        MCP Tools — Retrieval
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
        Three tools for reading and querying memories from the vault. These are the most frequently called tools in typical AI workflows.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {tools.map((tool) => (
          <div key={tool.name} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <code style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{tool.name}</code>
              <span style={{ fontSize: 11, fontWeight: 700, color: tool.badgeColor, background: `${tool.badgeColor}18`, border: `1px solid ${tool.badgeColor}40`, borderRadius: 20, padding: "2px 9px" }}>
                {tool.badge}
              </span>
            </div>

            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 16px 0", lineHeight: 1.6 }}>
              {tool.description}
            </p>

            <h5 style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 8px 0" }}>
              Parameters
            </h5>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 14, overflow: "hidden" }}>
              <ParamTable params={tool.params} />
            </div>

            <h5 style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 6px 0" }}>
              Returns
            </h5>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
              {tool.returns}
            </p>

            {tool.note && (
              <div style={{ background: "rgba(168,85,247,0.06)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 8, padding: "10px 14px" }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: "var(--accent)" }}>Tip: </strong>{tool.note}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
