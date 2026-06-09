import type { SectionProps } from "../types";

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export default function ConnectionAuth({ origin, handleCopy }: SectionProps) {
  const steps = [
    { step: "1", text: "Navigate to the Admin page from the top navigation bar." },
    { step: "2", text: "Under the personal settings sidebar, click API Tokens." },
    { step: "3", text: "Click the Generate Token button and select a token type: Human Token (for interactive clients like Claude Desktop) or Agent Token (for autonomous agents and CI/CD pipelines)." },
  ];

  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Connection & Authentication</h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
        To connect an external AI model or development assistant to Locker, you must supply the Model Context Protocol (MCP) endpoint address and a cryptographically signed API token.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>🔌 MCP Endpoint Address</span>
            <button onClick={() => handleCopy(`${origin}/api/mcp`)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer" }}>
              <CopyIcon size={11} /> Copy Address
            </button>
          </div>
          <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflowX: "auto", whiteSpace: "nowrap" }}>
            {origin}/api/mcp
          </code>
        </div>

        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>🔑 HTTP Authentication Header</span>
            <button onClick={() => handleCopy("Authorization: Bearer <your-api-token>")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer" }}>
              <CopyIcon size={11} /> Copy Header
            </button>
          </div>
          <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflowX: "auto", whiteSpace: "nowrap" }}>
            Authorization: Bearer &lt;your-api-token&gt;
          </code>
        </div>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Obtaining an API Token</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
        {steps.map((s) => (
          <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, border: "1px solid rgba(168,85,247,0.2)" }}>{s.step}</div>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginBottom: 24 }}>
        <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 12, padding: 18 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>👤 Human Tokens</h4>
          <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            <li style={{ marginBottom: 6 }}><strong>Use Case:</strong> Interactive clients where a human drives the session (e.g., Claude Desktop, IDE extensions).</li>
            <li style={{ marginBottom: 6 }}><strong>Permissions:</strong> Controlled by a simple per-tool bitmask (e.g. <code>recall_context</code>, <code>commit_memory</code>).</li>
            <li><strong>Safety:</strong> Destructive calls (delete/update) bypass queues but require manual TOTP 2FA or a secure passcode.</li>
          </ul>
        </div>

        <div style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 12, padding: 18 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>🤖 Agent Tokens (ABAC Policies)</h4>
          <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            <li style={{ marginBottom: 6 }}><strong>Use Case:</strong> Autonomous workflows, background daemons, or CI/CD pipelines.</li>
            <li style={{ marginBottom: 6 }}><strong>Agent Context:</strong> Requires declaring an audited purpose label aligning operations to a specific role.</li>
            <li style={{ marginBottom: 6 }}><strong>Category Filters:</strong> Strict limits on access to specific categories (<code>rules</code>, <code>projects</code>, <code>references</code>, <code>stack</code>).</li>
            <li style={{ marginBottom: 6 }}><strong>Tag Bounds:</strong> Define <code>allowedTags</code> and <code>deniedTags</code> rules for precise tag-level boundaries.</li>
            <li style={{ marginBottom: 6 }}><strong>JIT Gate:</strong> Memories tagged <code>#confidential</code> trigger an approval queue and are redacted by default.</li>
            <li><strong>Credentials:</strong> Access to stored vault credentials must be explicitly allowed per-token.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
