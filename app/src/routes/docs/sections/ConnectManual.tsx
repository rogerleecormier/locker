import type { SectionProps } from "../types";
import { SectionTitle, Lead, SubHeading } from "../ui";

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

interface ClientCardProps {
  icon: string;
  title: string;
  description: string;
  snippet: string;
  snippetLabel: string;
  handleCopy: (text: string) => void;
}

function ClientCard({ icon, title, description, snippet, snippetLabel, handleCopy }: ClientCardProps) {
  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
      <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 8px 0", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{icon}</span>
        {title}
      </h4>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: "0 0 12px 0" }}>
        {description}
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
          {snippetLabel}
        </span>
        <button
          onClick={() => handleCopy(snippet)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
            fontSize: 11,
            fontWeight: 600,
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <CopyIcon size={11} /> Copy
        </button>
      </div>
      <pre style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)", margin: 0, overflowX: "auto" }}>
        {snippet}
      </pre>
    </div>
  );
}

export default function ConnectManual({ origin, handleCopy }: SectionProps) {
  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        locker: {
          url: `${origin}/api/mcp`,
          headers: {
            Authorization: "Bearer YOUR_API_TOKEN",
          },
        },
      },
    },
    null,
    2
  );

  const vscodeConfig = JSON.stringify(
    {
      servers: {
        locker: {
          url: `${origin}/api/mcp`,
          headers: {
            Authorization: "Bearer YOUR_API_TOKEN",
          },
        },
      },
    },
    null,
    2
  );

  const cliSnippet = `LOCKER_TOKEN=your-token npx locker-sync sync --format claude`;

  return (
    <div>
      <SectionTitle>Connecting Clients — Manual Configuration</SectionTitle>
      <Lead>
        For clients that don't support OAuth (Cursor, VS Code extensions, CLI tools), configure the MCP
        connection manually using your API token in the HTTP header.
      </Lead>

      <SubHeading>Client Setup</SubHeading>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 28 }}>

        {/* Claude Desktop */}
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 8px 0", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🖥️</span>
            Claude Desktop
          </h4>
          <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: "0 0 10px 0" }}>
            Edit the config file at{" "}
            <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>~/Library/Application Support/Claude/claude_desktop_config.json</code>{" "}
            (macOS) or{" "}
            <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>%APPDATA%\Claude\claude_desktop_config.json</code>{" "}
            (Windows):
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              claude_desktop_config.json
            </span>
            <button
              onClick={() => handleCopy(claudeDesktopConfig)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer" }}
            >
              <CopyIcon size={11} /> Copy Config
            </button>
          </div>
          <pre style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)", margin: 0, overflowX: "auto" }}>
            {claudeDesktopConfig}
          </pre>
        </div>

        {/* Cursor */}
        <ClientCard
          icon="🖱️"
          title="Cursor"
          description="Go to Cursor Settings → MCP → Add Server. Fill in the fields below."
          snippet={`Name:   Locker\nURL:    ${origin}/api/mcp\nHeader: Authorization: Bearer YOUR_API_TOKEN`}
          snippetLabel="MCP server fields"
          handleCopy={handleCopy}
        />

        {/* VS Code */}
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 8px 0", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>📝</span>
            VS Code (GitHub Copilot / Cline)
          </h4>
          <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: "0 0 10px 0" }}>
            Add to <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>.vscode/mcp.json</code> in your workspace root:
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              .vscode/mcp.json
            </span>
            <button
              onClick={() => handleCopy(vscodeConfig)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer" }}
            >
              <CopyIcon size={11} /> Copy Config
            </button>
          </div>
          <pre style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)", margin: 0, overflowX: "auto" }}>
            {vscodeConfig}
          </pre>
        </div>

        {/* Windsurf */}
        <ClientCard
          icon="🏄"
          title="Windsurf"
          description="Go to Settings → MCP Servers → Add. Enter the URL and auth header below."
          snippet={`URL:         ${origin}/api/mcp\nAuth Header: Authorization: Bearer YOUR_API_TOKEN`}
          snippetLabel="Windsurf MCP fields"
          handleCopy={handleCopy}
        />

        {/* locker-sync CLI */}
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 8px 0", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>⌨️</span>
            locker-sync CLI
          </h4>
          <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: "0 0 10px 0" }}>
            Pass the token via the <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>--token</code> flag or the{" "}
            <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>LOCKER_TOKEN</code> environment variable:
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, flexWrap: "wrap", gap: 6 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
              bash
            </span>
            <button
              onClick={() => handleCopy(cliSnippet)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer" }}
            >
              <CopyIcon size={11} /> Copy
            </button>
          </div>
          <pre style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)", margin: 0, overflowX: "auto" }}>
            {cliSnippet}
          </pre>
        </div>
      </div>

      <div
        style={{
          background: "rgba(168,85,247,0.05)",
          border: "1px solid rgba(168,85,247,0.15)",
          borderRadius: 12,
          padding: 16,
          fontSize: 13,
          color: "var(--text-muted)",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>Tip — API Token types</strong>
        Use a <strong>Human Token</strong> for interactive clients where you drive the session. Use an <strong>Agent Token</strong> with ABAC policies for autonomous workflows or CI/CD pipelines. Generate tokens from the Admin page under API Tokens.
      </div>
    </div>
  );
}
