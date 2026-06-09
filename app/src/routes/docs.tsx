import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, lazy, Suspense } from "react";
import { useSession } from "~/lib/authClient";
import { DOC_GROUPS, DEFAULT_SECTION } from "./docs/nav.config";
import type { DocSection } from "./docs/nav.config";
import type { SectionProps } from "./docs/types";

// ── Lazy-loaded section components ──────────────────────────────────────────
// Each section lives in its own file for fast code-splitting and easy editing.
const SectionOverview          = lazy(() => import("./docs/sections/Overview"));
const SectionConnectionAuth    = lazy(() => import("./docs/sections/ConnectionAuth"));
const SectionSecurityPrivacy   = lazy(() => import("./docs/sections/SecurityPrivacy"));
const SectionManagingMemories  = lazy(() => import("./docs/sections/ManagingMemories"));
const SectionImportMemories    = lazy(() => import("./docs/sections/ImportMemories"));
const SectionTeamCollaboration = lazy(() => import("./docs/sections/TeamCollaboration"));
const SectionStackCreator      = lazy(() => import("./docs/sections/StackCreator"));
const SectionTemplates         = lazy(() => import("./docs/sections/Templates"));
const SectionExportRules       = lazy(() => import("./docs/sections/ExportRules"));
const SectionAgentActivity     = lazy(() => import("./docs/sections/AgentActivity"));
const SectionConflicts         = lazy(() => import("./docs/sections/Conflicts"));
const SectionWebhooks          = lazy(() => import("./docs/sections/Webhooks"));
const SectionWebhooksGitHub    = lazy(() => import("./docs/sections/WebhooksGitHub"));
const SectionWebhooksLinear    = lazy(() => import("./docs/sections/WebhooksLinear"));
const SectionWebhooksSlackJit  = lazy(() => import("./docs/sections/WebhooksSlackJit"));
const SectionMcpAbout          = lazy(() => import("./docs/sections/McpAbout"));
const SectionMcpRetrieval      = lazy(() => import("./docs/sections/McpRetrieval"));
const SectionMcpMutation       = lazy(() => import("./docs/sections/McpMutation"));
const SectionMcpSync           = lazy(() => import("./docs/sections/McpSync"));
const SectionMcpCredentials    = lazy(() => import("./docs/sections/McpCredentials"));
const SectionMcpErrors         = lazy(() => import("./docs/sections/McpErrors"));
const SectionConnectOAuth      = lazy(() => import("./docs/sections/ConnectOAuth"));
const SectionConnectManual     = lazy(() => import("./docs/sections/ConnectManual"));
const SectionTester            = lazy(() => import("./docs/sections/Tester"));
const SectionDlpQuarantine     = lazy(() => import("./docs/sections/DlpQuarantine"));
const SectionCicdGatekeeper    = lazy(() => import("./docs/sections/CicdGatekeeper"));

// ── Section component map ───────────────────────────────────────────────────
// Add a new section by: (1) adding it to nav.config.ts, (2) creating the file,
// (3) adding one line here. No other files to touch.

const SECTION_MAP: Record<string, React.ComponentType<SectionProps>> = {
  "overview":           SectionOverview,
  "connection-auth":    SectionConnectionAuth,
  "security-privacy":   SectionSecurityPrivacy,
  "managing-memories":  SectionManagingMemories,
  "import-memories":    SectionImportMemories,
  "team-collaboration": SectionTeamCollaboration,
  "stack-creator":      SectionStackCreator,
  "templates":          SectionTemplates,
  "export-rules":       SectionExportRules,
  "agent-activity":     SectionAgentActivity,
  "conflicts":          SectionConflicts,
  "webhooks":           SectionWebhooks,
  "webhooks-github":    SectionWebhooksGitHub,
  "webhooks-linear":    SectionWebhooksLinear,
  "webhooks-slack-jit": SectionWebhooksSlackJit,
  "mcp-about":          SectionMcpAbout,
  "mcp-tools-retrieval":   SectionMcpRetrieval,
  "mcp-tools-mutation":    SectionMcpMutation,
  "mcp-tools-sync":        SectionMcpSync,
  "mcp-tools-credentials": SectionMcpCredentials,
  "mcp-errors-security":   SectionMcpErrors,
  "connect-oauth":      SectionConnectOAuth,
  "connect-manual":     SectionConnectManual,
  "tester":             SectionTester,
  "dlp-quarantine":     SectionDlpQuarantine,
  "cicd-gatekeeper":    SectionCicdGatekeeper,
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function SectionFallback() {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
      Loading…
    </div>
  );
}

export const Route = createFileRoute("/docs")({
  component: DocsPage,
});

// ── Docs page ────────────────────────────────────────────────────────────────
function DocsPage() {
  const [activeSection, setActiveSection] = useState<string>(DEFAULT_SECTION);
  const [copied, setCopied] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ status: "success" | "error"; message: string } | null>(null);
  const { data: session } = useSession();

  const origin = typeof window === "undefined" ? "https://locker.rcormier.dev" : window.location.origin;

  const handleCopy = useCallback(async (text?: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const handleTestConnection = useCallback(async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const response = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      });
      if (response.ok) {
        const data = (await response.json()) as any;
        const toolCount = data.result?.tools?.length || 0;
        setTestResult({
          status: "success",
          message: `✓ Connected successfully! Found ${toolCount} MCP tool${toolCount !== 1 ? "s" : ""} available in your vault.`,
        });
      } else {
        setTestResult({ status: "error", message: `Connection failed (HTTP status ${response.status}). Ensure the endpoint is reachable.` });
      }
    } catch (err: any) {
      setTestResult({ status: "error", message: `Connection error: ${err?.message || "Unable to reach the endpoint. Check your server status."}` });
    } finally {
      setTestLoading(false);
    }
  }, []);

  const sectionProps: SectionProps = {
    setActiveSection,
    handleCopy,
    origin,
    session,
    testLoading,
    testResult,
    handleTestConnection,
  };

  const ActiveSection = SECTION_MAP[activeSection];

  return (
    <div className="docs-container" style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 52px)" }}>
      <style>{`
        .docs-content ul, .docs-content ol {
          display: block !important;
          list-style-position: outside !important;
          padding-left: 20px !important;
          margin-top: 12px !important;
          margin-bottom: 16px !important;
        }
        .docs-content ul { list-style-type: disc !important; }
        .docs-content ol { list-style-type: decimal !important; }
        .docs-content li {
          display: list-item !important;
          color: var(--text-muted);
          font-size: 13px;
          line-height: 1.7 !important;
          margin-bottom: 8px !important;
        }
        .docs-layout {
          display: flex;
          flex: 1;
          background: var(--bg);
        }
        .docs-sidebar {
          width: 280px;
          border-right: 1px solid var(--border);
          background: var(--surface);
          position: sticky;
          top: 52px;
          height: calc(100vh - 52px);
          overflow-y: auto;
          padding: 20px 14px;
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .docs-mobile-nav {
          display: none;
          padding: 16px;
          border-bottom: 1px solid var(--border);
          background: var(--surface2);
        }
        .docs-mobile-select {
          width: 100%;
          padding: 10px 12px;
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          color: var(--text);
          font-weight: 600;
          outline: none;
        }
        .docs-content-wrapper {
          flex: 1;
          overflow-y: auto;
          height: calc(100vh - 52px);
          padding: 36px 48px;
        }
        .docs-content { max-width: 800px; margin: 0 auto; }
        .sidebar-section-title {
          font-size: 11px;
          font-weight: 800;
          color: var(--text);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          margin: 22px 0 8px 8px;
          padding-bottom: 5px;
          border-bottom: 1px solid var(--border);
          opacity: 0.85;
        }
        .sidebar-button {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 7px 10px;
          background: transparent;
          border: none;
          color: var(--text-muted);
          text-align: left;
          font-size: 13px;
          font-weight: 500;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s ease;
        }
        .sidebar-button:hover { background: var(--accent-dim); color: var(--text); }
        .sidebar-button.active {
          background: var(--accent-dim);
          border: 1px solid rgba(168,85,247,0.25);
          color: var(--accent-hover);
          font-weight: 600;
        }
        @keyframes spin-slow { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @media (max-width: 840px) {
          .docs-layout { flex-direction: column; }
          .docs-sidebar { display: none; }
          .docs-mobile-nav { display: block; }
          .docs-content-wrapper { padding: 24px 16px; height: auto; overflow-y: visible; }
        }
      `}</style>

      {/* ── Mobile nav dropdown ── */}
      <div className="docs-mobile-nav">
        <select
          className="docs-mobile-select"
          value={activeSection}
          onChange={(e) => setActiveSection(e.target.value)}
          aria-label="Documentation Navigation"
        >
          {DOC_GROUPS.map((group) => (
            <optgroup key={group.title} label={group.title}>
              {group.sections.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="docs-layout">
        {/* ── Sidebar ── */}
        <aside className="docs-sidebar">
          <div>
            {DOC_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="sidebar-section-title">{group.title}</div>
                {group.sections.map((s: DocSection) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveSection(s.id)}
                    className={`sidebar-button ${activeSection === s.id ? "active" : ""}`}
                  >
                    <span>{s.icon}</span> {s.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        {/* ── Content panel ── */}
        <main className="docs-content-wrapper">
          <article className="docs-content">
            <Suspense fallback={<SectionFallback />}>
              {ActiveSection ? (
                <ActiveSection {...sectionProps} />
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: 14 }}>Section not found.</div>
              )}
            </Suspense>
          </article>
        </main>
      </div>
    </div>
  );
}
