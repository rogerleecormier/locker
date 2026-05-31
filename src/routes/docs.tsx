import { createFileRoute } from "@tanstack/react-router";
import { ALL_TOOLS } from "./_api.mcp";

export const Route = createFileRoute("/docs" as any)({
  component: DocsPage,
});

function DocsPage() {
  return (
    <div>
      <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)", padding: "20px 24px" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>API Documentation</h1>
          </div>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
            MCP (Model Context Protocol) endpoint for Locker memory vault integration.
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Connection Instructions */}
          <section>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: "var(--accent)" }}>Connection</h2>
            <div style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              padding: 16,
            }}>
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>Endpoint</p>
                <code style={{
                  display: "block",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: 12,
                  marginTop: 4,
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: "var(--text)",
                  overflow: "auto",
                }}>{typeof window === "undefined" ? "" : `${window.location.origin}/api/mcp`}</code>
              </div>
              <div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>Authentication</p>
                <code style={{
                  display: "block",
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  padding: 12,
                  marginTop: 4,
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: "var(--text)",
                  overflow: "auto",
                }}>Authorization: Bearer &lt;your-api-token&gt;</code>
              </div>
            </div>
          </section>

          {/* Tools */}
          <section>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: "var(--accent)" }}>Tools</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {ALL_TOOLS.map((tool) => (
                <div key={tool.name} style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  padding: 16,
                }}>
                  <h3 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 600, color: "var(--text)", fontFamily: "monospace" }}>
                    {tool.name}
                  </h3>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 12px 0" }}>
                    {tool.description}
                  </p>
                  <div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 6px 0", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Input Schema
                    </p>
                    <pre style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 4,
                      padding: 12,
                      margin: 0,
                      fontFamily: "monospace",
                      fontSize: 11,
                      color: "var(--text)",
                      overflow: "auto",
                      maxHeight: 300,
                    }}>
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Info */}
          <section style={{ paddingBottom: 24 }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
              All memory content is encrypted end-to-end. The MCP protocol supports streaming responses and real-time updates.
              For more information, visit the <a href="https://modelcontextprotocol.io" style={{ color: "var(--accent)", textDecoration: "none" }} target="_blank" rel="noreferrer">Model Context Protocol specification</a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
