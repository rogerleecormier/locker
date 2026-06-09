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
  securityNote?: string;
  agentNote?: string;
}

const tools: ToolDef[] = [
  {
    name: "store_credential",
    badge: "Write",
    badgeColor: "#10b981",
    description:
      "Store a named API key, secret, or token in the encrypted credentials vault. Credentials are stored with AES-256-GCM using a credential-specific KEK.",
    params: [
      { name: "name", type: "string", required: true, description: "Unique credential identifier (e.g., OPENAI_API_KEY)" },
      { name: "value", type: "string", required: true, description: "The secret value to encrypt and store" },
      { name: "description", type: "string", required: false, description: "Human-readable description" },
      { name: "tags", type: "string[]", required: false, description: "Tags for organization" },
    ],
    securityNote: "DLP quarantine runs on the value before storage to confirm it looks like a credential (not plaintext). The value is never logged.",
  },
  {
    name: "retrieve_credential",
    badge: "Read",
    badgeColor: "#3b82f6",
    description:
      "Decrypt and return a named credential value. Requires allowCredentials: true on the calling token.",
    params: [
      { name: "name", type: "string", required: true, description: "Credential name to retrieve" },
    ],
    returns: "{ name, value, description } — the decrypted credential value.",
    agentNote: "If the agent token was created without allowCredentials: true, this call returns a 403 error.",
  },
  {
    name: "list_credentials",
    badge: "List",
    badgeColor: "#a855f7",
    description:
      "List all stored credential names (never values). Requires allowCredentials: true.",
    params: [],
    returns: "Array of { name, description, tags, createdAt, updatedAt } objects. Values are never returned in list responses.",
  },
  {
    name: "delete_credential",
    badge: "Delete",
    badgeColor: "#ef4444",
    description:
      "Permanently delete a stored credential. This is irreversible — the encrypted value is purged from storage.",
    params: [
      { name: "name", type: "string", required: true, description: "Credential name to delete" },
    ],
    agentNote: "Queued for agent tokens the same as delete_memory.",
  },
];

function ParamTable({ params }: { params: Param[] }) {
  if (params.length === 0) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, fontStyle: "italic", padding: "10px 12px" }}>
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

export default function McpCredentials(_props: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        MCP Tools — Credentials Vault
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
        Four tools for storing, retrieving, listing, and deleting named credentials. Credentials are AES-256-GCM encrypted with a
        dedicated credential KEK separate from memory encryption keys. Access requires the <code>allowCredentials: true</code> flag
        on the agent token.
      </p>

      {/* Security callout */}
      <div style={{ background: "rgba(168,85,247,0.05)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 10, padding: "14px 18px", marginBottom: 28 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>🔐</span>
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 6px 0" }}>Isolated Credential Encryption</h4>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
              Credentials use a <strong>dedicated KEK</strong> that is separate from the memory encryption key. A vault compromise
              does not expose credentials, and a credential key compromise does not expose memories. Never store raw secrets in
              memory <code>body</code> fields — use <code>store_credential</code> instead.
            </p>
          </div>
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
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: tool.returns || tool.securityNote || tool.agentNote ? 14 : 0, overflow: "hidden" }}>
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

            {tool.securityNote && (
              <div style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 8, padding: "10px 14px" }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: "#10b981" }}>Security: </strong>{tool.securityNote}
                </p>
              </div>
            )}

            {tool.agentNote && (
              <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 8, padding: "10px 14px" }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: "#f59e0b" }}>Agent restriction: </strong>{tool.agentNote}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
