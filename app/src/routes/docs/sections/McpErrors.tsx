import type { SectionProps } from "../types";

interface ErrorCode {
  code: number;
  name: string;
  description: string;
  severity: "info" | "warn" | "error";
}

const errorCodes: ErrorCode[] = [
  { code: -32700, name: "Parse error", description: "Malformed JSON in request body", severity: "error" },
  { code: -32600, name: "Invalid request", description: "Missing jsonrpc or method field", severity: "error" },
  { code: -32601, name: "Method not found", description: "Unknown method name", severity: "error" },
  { code: -32602, name: "Invalid params", description: "Missing required parameter or wrong type", severity: "error" },
  { code: -32000, name: "Unauthorized", description: "Missing or invalid Bearer token", severity: "error" },
  { code: -32001, name: "Forbidden", description: "Token lacks permission for this tool", severity: "warn" },
  { code: -32002, name: "DLP Quarantine", description: "Content flagged as high-entropy secret or PII", severity: "warn" },
  { code: -32003, name: "JIT Required", description: "Memory is #confidential — approval required", severity: "warn" },
  { code: -32004, name: "Queued", description: "Agent mutation queued for human review", severity: "info" },
  { code: -32005, name: "Rate limited", description: "Too many requests; retry after specified delay", severity: "warn" },
  { code: -32006, name: "Scope denied", description: "Memory is outside the token's workspace scope", severity: "warn" },
];

const handlingGuides = [
  {
    code: "-32002",
    name: "DLP Quarantine",
    color: "#ef4444",
    bg: "rgba(239,68,68,0.06)",
    border: "rgba(239,68,68,0.2)",
    icon: "🚫",
    steps: [
      "The agent's commit attempt was rejected.",
      "The content appears to contain a secret or PII.",
      "Remove the credential from the memory body.",
      "Use store_credential instead to safely encrypt the value.",
      "Retry commit_memory with the credential reference removed from the body.",
    ],
  },
  {
    code: "-32003",
    name: "JIT Required",
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.06)",
    border: "rgba(245,158,11,0.2)",
    icon: "⏳",
    steps: [
      "The requested memory is tagged #confidential.",
      "Inform the human user that approval is required.",
      "The human will receive a Slack notification to approve the JIT request.",
      "Wait for the approval notification before retrying.",
      "Once approved, retry the original tool call — the memory will be temporarily accessible.",
    ],
  },
  {
    code: "-32004",
    name: "Queued",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.06)",
    border: "rgba(59,130,246,0.2)",
    icon: "📋",
    steps: [
      "The operation was accepted and queued successfully.",
      "The memory is not yet live — it is pending human approval.",
      "Human approval is required in the Conflicts Hub.",
      "Do NOT retry — duplicate queue entries will be created.",
      "Inform the user that the change has been submitted for review.",
    ],
  },
];

function severityColor(s: ErrorCode["severity"]) {
  if (s === "error") return "#ef4444";
  if (s === "warn") return "#f59e0b";
  return "#3b82f6";
}

export default function McpErrors(_props: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        MCP Errors & Security Events
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
        Locker uses standard JSON-RPC 2.0 error codes with structured error data. Security events (DLP quarantine, ABAC denial,
        JIT redaction) return specific error codes that agents should handle gracefully.
      </p>

      {/* Error code table */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 14, marginTop: 0 }}>Error Code Reference</h3>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", marginBottom: 32 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                {["Code", "Name", "Description"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "10px 16px", color: "var(--text-muted)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {errorCodes.map((err, i) => (
                <tr key={err.code} style={{ borderBottom: i < errorCodes.length - 1 ? "1px solid var(--border)" : "none", background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)" }}>
                  <td style={{ padding: "10px 16px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                    <code style={{ fontSize: 12, color: severityColor(err.severity), fontWeight: 700 }}>{err.code}</code>
                  </td>
                  <td style={{ padding: "10px 16px", verticalAlign: "top", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{err.name}</span>
                  </td>
                  <td style={{ padding: "10px 16px", verticalAlign: "top", color: "var(--text-muted)", lineHeight: 1.5 }}>
                    {err.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Handling guides */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 14 }}>Agent Handling Guides</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {handlingGuides.map((guide) => (
          <div key={guide.code} style={{ background: guide.bg, border: `1px solid ${guide.border}`, borderRadius: 12, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 18 }}>{guide.icon}</span>
              <div>
                <code style={{ fontSize: 12, color: guide.color, fontWeight: 700 }}>{guide.code}</code>
                <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginLeft: 8 }}>{guide.name}</span>
              </div>
            </div>
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
              {guide.steps.map((step, i) => (
                <li key={i} style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>

      {/* Generic error shape */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginTop: 28 }}>
        <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 12px 0" }}>JSON-RPC 2.0 Error Envelope</h4>
        <pre style={{ margin: 0, padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflowX: "auto", lineHeight: 1.6 }}>
{`{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32002,
    "message": "DLP Quarantine: high-entropy content detected",
    "data": {
      "field": "body",
      "hint": "Use store_credential for secrets"
    }
  }
}`}
        </pre>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "12px 0 0 0", lineHeight: 1.5 }}>
          All error responses include a <code>data</code> field with structured context to help agents and developers diagnose the issue
          programmatically. The <code>message</code> field is human-readable and may change between versions — always key on <code>code</code>.
        </p>
      </div>
    </div>
  );
}
