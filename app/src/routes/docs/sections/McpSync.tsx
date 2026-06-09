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
}

const tools: ToolDef[] = [
  {
    name: "export_rules",
    badge: "Compile",
    badgeColor: "#a855f7",
    description:
      "Compiles all rules-category memories and the active stack blueprint into a formatted instruction file for a specific AI client. Returns the file content as a string.",
    params: [
      { name: "format", type: "string", required: true, description: "Output format: cursor, claude, copilot, gemini, agents, antigravity" },
      { name: "scope", type: "string", required: false, description: "Workspace key to scope the export to" },
    ],
    returns: "String containing the compiled file content ready to write to disk.",
  },
  {
    name: "list_stack_blueprints",
    badge: "List",
    badgeColor: "#3b82f6",
    description:
      "Returns all saved stack blueprints for the current user/team scope.",
    params: [
      { name: "scope", type: "string", required: false, description: "Filter by workspace key" },
    ],
    returns: "Array of blueprint objects with id, name, categories, updatedAt.",
  },
  {
    name: "get_stack_blueprint",
    badge: "Read",
    badgeColor: "#10b981",
    description:
      "Returns the full detail of a specific stack blueprint by ID.",
    params: [
      { name: "id", type: "string", required: true, description: "Blueprint ID" },
    ],
    returns: "Blueprint object with all 12 category selections and constraints.",
  },
  {
    name: "list_templates",
    badge: "List",
    badgeColor: "#f59e0b",
    description:
      "Returns all saved blueprint templates available to the current user.",
    params: [],
    returns: "Array of template objects with id, name, description, createdAt.",
  },
];

const formats = [
  { key: "claude", file: "CLAUDE.md", desc: "Claude Code / Claude Desktop" },
  { key: "cursor", file: ".cursorrules", desc: "Cursor IDE" },
  { key: "copilot", file: ".github/copilot-instructions.md", desc: "GitHub Copilot" },
  { key: "gemini", file: "GEMINI.md", desc: "Gemini CLI" },
  { key: "agents", file: "AGENTS.md", desc: "OpenAI Codex / Agents" },
  { key: "antigravity", file: ".agents/rules/rules.md", desc: "Antigravity / generic" },
];

function ParamTable({ params }: { params: Param[] }) {
  if (params.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0", fontStyle: "italic", padding: "10px 12px" }}>
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

export default function McpSync(_props: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        MCP Tools — Sync & Export
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
        Four tools for reading your stack blueprints, templates, and compiled AI agent rule files directly from MCP. These enable
        agents to self-configure or pass instructions to sub-agents.
      </p>

      {/* export_rules format reference */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 28 }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 12px 0" }}>
          export_rules — Supported Formats
        </h4>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8 }}>
          {formats.map((f) => (
            <div key={f.key} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
              <code style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, display: "block", marginBottom: 4 }}>{f.key}</code>
              <code style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>{f.file}</code>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{f.desc}</span>
            </div>
          ))}
        </div>
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

            <h5 style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 6px 0" }}>
              Returns
            </h5>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
              {tool.returns}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
