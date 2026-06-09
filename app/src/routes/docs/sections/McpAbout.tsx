import type { SectionProps } from "../types";

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

const exampleRequest = `{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "recall_context",
    "arguments": {
      "query": "what database should I use?",
      "limit": 5,
      "optimize": true
    }
  }
}`;

const toolGroups = [
  {
    label: "Retrieval",
    color: "rgba(168,85,247,0.08)",
    border: "rgba(168,85,247,0.2)",
    accent: "#a855f7",
    tools: ["recall_context", "search_memories", "get_memory_summary"],
    description: "Read and query memories from the vault.",
  },
  {
    label: "Mutation",
    color: "rgba(59,130,246,0.08)",
    border: "rgba(59,130,246,0.2)",
    accent: "#3b82f6",
    tools: ["commit_memory", "update_memory", "delete_memory", "list_accessible_scopes"],
    description: "Create, update, delete memories, and list scopes.",
  },
  {
    label: "Sync & Export",
    color: "rgba(16,185,129,0.08)",
    border: "rgba(16,185,129,0.2)",
    accent: "#10b981",
    tools: ["export_rules", "list_stack_blueprints", "get_stack_blueprint", "list_templates"],
    description: "Read stack blueprints, templates, and compiled rule files.",
  },
  {
    label: "Credentials",
    color: "rgba(245,158,11,0.08)",
    border: "rgba(245,158,11,0.2)",
    accent: "#f59e0b",
    tools: ["store_credential", "retrieve_credential", "list_credentials", "delete_credential"],
    description: "Manage encrypted API keys and secrets.",
  },
];

export default function McpAbout({ origin, handleCopy }: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        MCP — Model Context Protocol
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
        Locker exposes 15 tools via a JSON-RPC 2.0 streamable HTTP transport at <code>/api/mcp</code>. Any MCP-compatible
        AI client can connect using your API token to read and write memories.
      </p>

      {/* Protocol & Transport */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 14, marginTop: 0 }}>Protocol</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 10px 0" }}>JSON-RPC 2.0 over HTTP POST</h4>
          <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>
            <li>No WebSocket required</li>
            <li>Streamable HTTP transport (MCP <code>2024-11-05</code> spec)</li>
            <li>Tool calls via standard <code>tools/call</code> method</li>
            <li>Tool discovery via <code>tools/list</code></li>
          </ul>
        </div>

        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 10px 0" }}>Transport Details</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <tbody>
              {[
                ["Endpoint", `POST ${origin}/api/mcp`],
                ["Auth", "Authorization: Bearer <token>"],
                ["Content-Type", "application/json"],
                ["Response", "JSON-RPC 2.0 envelope"],
                ["Version", "2024-11-05"],
              ].map(([key, val]) => (
                <tr key={key}>
                  <td style={{ color: "var(--text-muted)", paddingBottom: 6, paddingRight: 12, whiteSpace: "nowrap", fontWeight: 600 }}>{key}</td>
                  <td style={{ color: "var(--text)", paddingBottom: 6, fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 15 Tools */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>15 Tools by Function</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginBottom: 28 }}>
        {toolGroups.map((group) => (
          <div key={group.label} style={{ background: group.color, border: `1px solid ${group.border}`, borderRadius: 12, padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: 0 }}>{group.label}</h4>
              <span style={{ fontSize: 11, color: group.accent, fontWeight: 700, background: `${group.border}`, padding: "2px 8px", borderRadius: 20, border: `1px solid ${group.border}` }}>
                {group.tools.length} tools
              </span>
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0" }}>{group.description}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {group.tools.map((tool) => (
                <code key={tool} style={{ fontSize: 11, color: group.accent, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "3px 8px", display: "block" }}>
                  {tool}
                </code>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Example Request */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>Example JSON-RPC Request</h3>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
            tools/call — recall_context
          </span>
          <button
            onClick={() => handleCopy(exampleRequest)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer" }}
          >
            <CopyIcon size={11} /> Copy
          </button>
        </div>
        <pre style={{ margin: 0, padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflowX: "auto", lineHeight: 1.6 }}>
          {exampleRequest}
        </pre>
      </div>

      {/* Versioning */}
      <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 12, padding: 18 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 8px 0" }}>Versioning</h4>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
          The MCP endpoint version is pinned to <code>2024-11-05</code>. Changes are backwards-compatible within the same major version.
          The protocol version is surfaced in the <code>initialize</code> handshake and the <code>X-MCP-Version</code> response header.
        </p>
      </div>
    </div>
  );
}
