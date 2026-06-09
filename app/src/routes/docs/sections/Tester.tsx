import type { SectionProps } from "../types";
import { SectionTitle, Lead, SubHeading, CodeBlock } from "../ui";

function SpinnerIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  );
}

const CHECKS = [
  { icon: "🔌", label: "MCP endpoint reachability" },
  { icon: "🔑", label: "Session authentication is valid" },
  { icon: "🛠️", label: "Tool registry is loading correctly" },
  { icon: "📋", label: "Response format is valid JSON-RPC 2.0" },
];

export default function Tester({ origin, testLoading, testResult, handleTestConnection }: SectionProps) {
  const curlSnippet = `curl -X POST ${origin}/api/mcp \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`;

  return (
    <div>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      <SectionTitle>Connection Tester</SectionTitle>
      <Lead>
        Test your MCP connection directly from this page. The tester sends a{" "}
        <code style={{ fontFamily: "monospace", fontSize: 13, color: "var(--accent)" }}>tools/list</code>{" "}
        JSON-RPC request to your Locker endpoint using your current session credentials and reports the result.
      </Lead>

      {/* Test panel */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 24 }}>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: "0 0 16px 0" }}>
          Clicking "Test Connection" sends a{" "}
          <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>POST /api/mcp</code>{" "}
          request with body{" "}
          <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>
            {`{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}`}
          </code>{" "}
          using same-origin credentials (your active browser session). No API token is required for this test.
        </p>

        <button
          onClick={handleTestConnection}
          disabled={testLoading}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            background: testLoading ? "var(--accent-dim)" : "var(--accent)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 700,
            cursor: testLoading ? "not-allowed" : "pointer",
            opacity: testLoading ? 0.8 : 1,
            transition: "background 0.15s, opacity 0.15s",
            marginBottom: testResult ? 16 : 0,
          }}
          onMouseEnter={(e) => {
            if (!testLoading) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent-hover)";
          }}
          onMouseLeave={(e) => {
            if (!testLoading) (e.currentTarget as HTMLButtonElement).style.background = "var(--accent)";
          }}
        >
          {testLoading ? <SpinnerIcon /> : <span style={{ fontSize: 16 }}>⚡</span>}
          {testLoading ? "Testing…" : "Test Connection"}
        </button>

        {testResult && (
          <div
            style={{
              borderRadius: 10,
              padding: "14px 16px",
              fontSize: 13,
              lineHeight: 1.6,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              ...(testResult.status === "success"
                ? {
                    background: "rgba(16,185,129,0.07)",
                    border: "1px solid rgba(16,185,129,0.25)",
                    color: "rgba(16,185,129,0.9)",
                  }
                : {
                    background: "rgba(239,68,68,0.07)",
                    border: "1px solid rgba(239,68,68,0.25)",
                    color: "rgba(239,68,68,0.9)",
                  }),
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0, lineHeight: 1 }}>
              {testResult.status === "success" ? "✅" : "❌"}
            </span>
            <div>
              <strong style={{ display: "block", marginBottom: 2, color: "inherit" }}>
                {testResult.status === "success" ? "Connection successful" : "Connection failed"}
              </strong>
              <span style={{ opacity: 0.85 }}>{testResult.message}</span>
            </div>
          </div>
        )}
      </div>

      {/* What this tests */}
      <SubHeading>What this tests</SubHeading>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {CHECKS.map(({ icon, label }) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            <span style={{ fontSize: 15, flexShrink: 0 }}>{icon}</span>
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Note */}
      <div
        style={{
          background: "rgba(168,85,247,0.05)",
          border: "1px solid rgba(168,85,247,0.15)",
          borderRadius: 12,
          padding: 16,
          fontSize: 13,
          color: "var(--text-muted)",
          lineHeight: 1.7,
          marginBottom: 24,
        }}
      >
        <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>Note</strong>
        This test uses your current browser session. For testing with a specific API token, use curl or
        your MCP client directly.
      </div>

      {/* curl example */}
      <SubHeading>Test with a specific API token (curl)</SubHeading>
      <CodeBlock label="bash">{curlSnippet}</CodeBlock>
    </div>
  );
}
