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
  returns?: string;
  agentBehavior?: string;
}

const tools: ToolDef[] = [
  {
    name: "commit_memory",
    badge: "Create",
    badgeColor: "#10b981",
    description:
      "Create a new memory in the vault. The body is encrypted (AES-256-GCM), vectorized (bge-m3), and entity-extracted (GraphRAG) at write time. DLP quarantine and AI adversarial sanitization run before storage.",
    params: [
      { name: "body", type: "string", required: true, description: "The fact or context to store" },
      { name: "category", type: "string", required: true, description: "One of: rules, projects, references, stack" },
      { name: "tags", type: "string[]", required: false, description: "Metadata tags. Use #confidential to enable JIT gating" },
      { name: "scope", type: "string", required: false, description: "Team workspace key to scope the memory to" },
      { name: "name", type: "string", required: false, description: "Optional short title for the memory" },
    ],
    agentBehavior: "For agent tokens, creates a queued recommendation — not applied directly. Human approval via Conflicts Hub required.",
  },
  {
    name: "update_memory",
    badge: "Update",
    badgeColor: "#3b82f6",
    description:
      "Update the body, tags, or category of an existing memory. Creates a new version in memory_versions. Re-encrypts, re-vectorizes, and re-extracts entities.",
    params: [
      { name: "id", type: "string", required: true, description: "Memory ID to update" },
      { name: "body", type: "string", required: false, description: "New body text" },
      { name: "category", type: "string", required: false, description: "New category" },
      { name: "tags", type: "string[]", required: false, description: "New tag array (replaces existing)" },
      { name: "confirm", type: "boolean", required: false, description: "Ignored for agent tokens; always queued" },
    ],
    agentBehavior: "Always queued for agent tokens. Creates amber/red conflict card in Conflicts Hub.",
  },
  {
    name: "delete_memory",
    badge: "Delete",
    badgeColor: "#ef4444",
    description:
      "Soft-delete a memory. Deleted memories are excluded from retrieval but retained in memory_versions for audit. Hard deletion is not available via MCP.",
    params: [
      { name: "id", type: "string", required: true, description: "Memory ID to delete" },
      { name: "confirm", type: "boolean", required: false, description: "Ignored for agent tokens; always queued" },
    ],
    agentBehavior: "Always queued for agent tokens.",
  },
  {
    name: "list_accessible_scopes",
    badge: "Read",
    badgeColor: "#a855f7",
    description:
      "Returns a list of workspace keys and team scopes the current token has access to. Useful for agents to discover available project scopes before scoped queries.",
    params: [],
    returns: "Array of scope objects with key, teamName, memoryCount.",
  },
];

function ParamTable({ params }: { params: Param[] }) {
  if (params.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 4px 0", fontStyle: "italic", padding: "10px 12px" }}>
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

export default function McpMutation(_props: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        MCP Tools — Mutation
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
        Four tools for creating, updating, deleting memories, and listing accessible scopes. Mutation tools are subject to DLP
        quarantine, AI sanitization, and (for agent tokens) the human approval queue.
      </p>

      <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 10, padding: "12px 16px", marginBottom: 28, display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>⚠️</span>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text)" }}>Agent token behavior:</strong> All write operations from agent tokens are queued
          as recommendations and do not take effect until a human approves them in the Conflicts Hub. Never retry a queued call —
          duplicate queue entries will be created.
        </p>
      </div>

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

            {tool.returns && (
              <>
                <h5 style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 6px 0" }}>
                  Returns
                </h5>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.5 }}>
                  {tool.returns}
                </p>
              </>
            )}

            {tool.agentBehavior && (
              <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 8, padding: "10px 14px" }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: "#f59e0b" }}>Agent behavior: </strong>{tool.agentBehavior}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
