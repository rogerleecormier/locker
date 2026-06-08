import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { ALL_TOOLS } from "./-_api.mcp";
import { useSession } from "~/lib/authClient";

export const Route = createFileRoute("/docs")({
  component: DocsPage,
});

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}


function DocsPage() {
  const [activeSection, setActiveSection] = useState<string>("overview");
  const [copied, setCopied] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{status: 'success' | 'error'; message: string} | null>(null);
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
      const response = await fetch('/api/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'same-origin',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        const toolCount = data.result?.tools?.length || 0;
        setTestResult({
          status: 'success',
          message: `✓ Connected successfully! Found ${toolCount} MCP tool${toolCount !== 1 ? 's' : ''} available in your vault.`
        });
      } else {
        setTestResult({
          status: 'error',
          message: `Connection failed (HTTP status ${response.status}). Ensure the endpoint is reachable.`
        });
      }
    } catch (err: any) {
      setTestResult({
        status: 'error',
        message: `Connection error: ${err?.message || 'Unable to reach the endpoint. Check your server status.'}`
      });
    } finally {
      setTestLoading(false);
    }
  }, []);
  const renderContent = () => {
    switch (activeSection) {
      case "connect-oauth":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>OAuth / Account-Based Setup</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              The easiest way to connect Locker. Sign in once with your account and Locker becomes available
              across all supported clients automatically — no API tokens or config files needed.
            </p>

            <div style={{ background: "rgba(184,92,56,0.06)", border: "1px solid rgba(184,92,56,0.25)", borderRadius: 12, padding: 20, marginBottom: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 18 }}>🔑</span>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Claude (Web) — claude.ai Connectors</h3>
              </div>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
                Requires a Claude Pro, Team, or Enterprise plan. Once connected here, Locker is automatically
                available in <strong>Claude Code CLI</strong>, <strong>Claude Code VS Code extension</strong>,
                <strong>Claude Code JetBrains plugin</strong>, and the <strong>Antigravity IDE extension</strong> — they all
                share your claude.ai account session.
              </p>
              <ol style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6, margin: "0 0 16px 0", fontSize: 13, color: "var(--text-muted)" }}>
                <li>Open <strong>claude.ai</strong> → click your profile avatar → <strong>Settings → Connectors → Add connector</strong>.</li>
                <li>Enter a name (e.g. <code>Locker</code>) and paste the MCP endpoint URL below.</li>
                <li>Claude will redirect you to Locker to sign in and approve access — no API token needed.</li>
                <li>Once authorized, Locker tools appear in your claude.ai chats and automatically in all Claude Code surfaces.</li>
              </ol>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>MCP Endpoint URL</span>
              </div>
              <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 13, color: "var(--accent)", userSelect: "all" }}>
                {origin}/api/mcp
              </div>
            </div>

            <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 12, padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <span>ℹ️</span> Claude Code CLI &amp; Extensions
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                Once you connect Locker via Claude (Web), it is automatically inherited by Claude Code CLI and all
                Claude Code IDE extensions. You can verify by running <code>claude mcp list</code> in your terminal —
                <code>claude.ai Locker</code> will appear in the list. No separate CLI command is needed.
              </p>
            </div>
          </div>
        );
      case "connect-manual":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Manual / Token-Based Setup</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
              For clients that don't support OAuth, you connect Locker using a Bearer token and your MCP endpoint URL.
              You supply those two values; the client's own documentation explains exactly where to enter them.
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 28 }}>
              Config file locations, JSON key names, and GUI steps change over time as clients update — always refer
              to your client's MCP documentation for the current setup process.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>🔌 Your MCP Endpoint</span>
                </div>
                <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 13, color: "var(--accent)", userSelect: "all" }}>
                  {origin}/api/mcp
                </code>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>🔑 Auth Header</span>
                </div>
                <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 13, color: "var(--text)", userSelect: "all" }}>
                  Authorization: Bearer &lt;your-api-token&gt;
                </code>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "10px 0 0 0", lineHeight: 1.5 }}>
                  Generate a token at <strong>Admin → API Tokens</strong>. Copy it when shown — it is only displayed once.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Clients &amp; Connection Patterns</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 6px 0" }}>Native HTTP Transport</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 10px 0" }}>
                  These clients connect directly to Locker's HTTP endpoint. You provide the URL and an
                  <code>Authorization: Bearer</code> header — no wrapper process needed.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {["Antigravity 2.0 CLI", "Antigravity 2.0 IDE", "OpenAI Codex CLI", "OpenAI Codex App", "OpenAI Codex Extension", "Gemini CLI", "Kilo Code", "Windsurf", "Zed", "Amp", "Kiro", "Gemini Code Assist"].map((c) => (
                    <span key={c} style={{ fontSize: 11, padding: "3px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, color: "var(--text-muted)" }}>{c}</span>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  Refer to your client's MCP documentation for the exact config file location, JSON key name, or GUI field to enter the URL and header.
                </p>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 6px 0" }}>stdio Bridge via <code>mcp-remote</code></h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 10px 0" }}>
                  These clients use a local stdio transport and don't support remote HTTP natively. You wrap
                  Locker's endpoint with <code>npx mcp-remote</code>, which bridges the connection. The command
                  is the same for all; only the config file location differs per client.
                </p>
                <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", marginBottom: 10 }}>
                  npx -y mcp-remote {origin}/api/mcp --header "Authorization: Bearer &lt;your-token&gt;"
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {["Claude Desktop", "Claude Code CLI (manual)", "Cursor", "Cline", "Continue", "GitHub Copilot", "VS Code"].map((c) => (
                    <span key={c} style={{ fontSize: 11, padding: "3px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, color: "var(--text-muted)" }}>{c}</span>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  Refer to your client's MCP documentation for where to place the command (config file path, JSON structure, or GUI entry).
                </p>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 6px 0" }}>Custom Action / Instruction Prompt</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 10px 0" }}>
                  These platforms don't support MCP natively. Instead, you inject Locker context by giving the
                  AI a system instruction describing how to call the endpoint, or by configuring a custom API action.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {["ChatGPT Custom GPT", "Gemini Gems", "Grok Agents", "Perplexity Collections"].map((c) => (
                    <span key={c} style={{ fontSize: 11, padding: "3px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, color: "var(--text-muted)" }}>{c}</span>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                  Refer to each platform's documentation for how to configure custom actions or system instructions that call external APIs.
                </p>
              </div>
            </div>

            <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 12, padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
                <span>💡</span> Claude Desktop vs Claude Code
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                <strong>Claude Desktop</strong> uses its own <code>claude_desktop_config.json</code> and must be configured manually here —
                it does not share config with Claude Code or Claude (Web).
                <strong> Claude Code CLI</strong> can also be configured manually with <code>claude mcp add --transport http</code>,
                but if you're already connected via Claude (Web) OAuth, it's already there — check with <code>claude mcp list</code> first.
              </p>
            </div>
          </div>
        );
      case "overview":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>System Overview</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Locker is a secure, long-term personal and team memory vault built for artificial intelligence workflows. 
              It provides a standardized, encrypted location for AI clients to store and retrieve technical context, 
              coding rules, team preferences, and project specifications.
            </p>
            
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 18 }}>⚡</span>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                    GraphRAG Hybrid Retrieval
                  </h3>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li style={{ marginBottom: 6 }}><strong>RRF Fusion:</strong> Merges semantic (bge-m3), keyword overlap, and recency decay (half-life ≈ 139 days) via Reciprocal Rank Fusion (k=60).</li>
                    <li style={{ marginBottom: 6 }}><strong>Graph Expansion:</strong> Workers AI extracts entities (services, files) and edges at write time, retrieving related items automatically.</li>
                    <li style={{ marginBottom: 6 }}><strong>Llama Reranking:</strong> Decrypts top 20 candidates and reranks them via Llama-3.3-70B for maximum relevance.</li>
                    <li><strong>Prompt Synthesis:</strong> Sets <code>optimize: true</code> to synthesize matched context into a compact system-prompt list.</li>
                  </ul>
                </div>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <span style={{ fontSize: 18 }}>🔒</span>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>
                    End-to-End Encrypted
                  </h3>
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li style={{ marginBottom: 6 }}><strong>Envelope Scheme:</strong> AES-256-GCM under a unique per-vault Data Encryption Key (DEK).</li>
                    <li style={{ marginBottom: 6 }}><strong>Key Wrapping:</strong> DEKs wrapped by server-side Key Encryption Keys (KEK) stored in env vars.</li>
                    <li><strong>Isolation:</strong> Database compromise alone is completely insufficient to decrypt storage.</li>
                  </ul>
                </div>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Key Features & Workflows</h3>
            
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🧠</span> Memory Ingestion & GraphRAG Enrichment
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  Create, update, and manage long-term facts either through the visual browser-based dashboard or directly via connected LLMs using programmatic MCP interfaces. Every new fact is automatically enriched by Workers AI: named entity nodes (services, libraries, APIs, databases) and directed relationship edges are extracted and stored in <code>memory_graph_nodes</code> / <code>memory_graph_edges</code>, building a knowledge graph that powers multi-hop recall.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("managing-memories")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Manage Memories Guide →
                  </button>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <button onClick={() => setActiveSection("import-memories")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Import & Ingestion Guide →
                  </button>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>🛠️</span> Tech Stack Blueprinting
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  Build custom constraints for 12 technology stack categories (Languages, Frameworks, DBs, ORMs, styling strategy) using the Stack Creator wizard. Save standard profiles as reusable templates to skip regenerations and maintain consistency.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("stack-creator")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Tech Stack Creator Guide →
                  </button>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <button onClick={() => setActiveSection("templates")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Blueprint Templates Guide →
                  </button>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>💾</span> Multi-Agent Rule Compilation
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  Translate stored technical guidelines into formatted instructions for specific AI developer agents. Downloads are supported in the UI for CLAUDE.md, .cursorrules, copilot-instructions.md, GEMINI.md, AGENTS.md, and .agents/rules/rules.md. Synchronize files automatically inside local project directories via MCP.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("export-rules")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Rules Exporting & Sync Guide →
                  </button>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>👥</span> Team Governance & Security
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  Leverage Organization settings to govern billing seats, isolate sub-teams, and restrict scoped memories to specific project workspace keys. Locker enforces a strict security protocol, ephemeral V8 Workers sandboxing, entropy-based DLP quarantine checks, PBKDF2-hardened token hashing, and Attribute-Based Access Control (ABAC) for autonomous agent tokens.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("team-collaboration")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Team Collaboration Guide →
                  </button>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <button onClick={() => setActiveSection("security-privacy")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Security Architecture & Pillars →
                  </button>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>◎</span> Agent Activity Dashboard
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  Visualize every memory operation your AI tools perform. The timeline maps each <code>recall_context</code> event to the exact client (Cursor, Claude Desktop, Windsurf…), the semantic similarity scores of returned memories, and the facts injected into the model's context — so you can debug AI hallucinations caused by stale or missing context in seconds.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("agent-activity")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Agent Activity Dashboard Guide →
                  </button>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>⏰</span> Stale Memory Review
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  Memories that have not been accessed for an extended period surface a staleness indicator and are surfaced in a dedicated banner on the Memories dashboard. Use the <strong>Stale</strong> sort filter to review, refresh, or archive aging context before it misleads your agents.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("managing-memories")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Managing Memories Guide →
                  </button>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                  <span>⚡</span> Memory Conflict Resolution
                </h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>
                  When agents detect contradicting facts (e.g. "Use Node 18" vs. "Use Node 20"), a navigation badge alerts you to the Conflicts Hub where you can review side-by-side diffs, choose the authoritative version, and close the recommendation with a single click.
                </p>
                <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
                  <button onClick={() => setActiveSection("conflicts")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    Conflict Resolution Hub →
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginTop: 16 }}>
              <div style={{ background: "rgba(168, 85, 247, 0.04)", border: "1px solid rgba(168, 85, 247, 0.15)", borderRadius: 12, padding: 18 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🛡️ Core Security Model
                </h3>
                <div style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li style={{ marginBottom: 6 }}><strong>Envelope Cryptography:</strong> Data encrypted via AES-256-GCM with wrapped per-vault DEKs. Plaintext never reaches storage.</li>
                    <li style={{ marginBottom: 6 }}><strong>GraphRAG Privacy:</strong> Entity extraction runs ephemerally before encryption; D1 stores only ciphertext and graph structure.</li>
                    <li style={{ marginBottom: 6 }}><strong>DLP Quarantine:</strong> High-entropy secrets and credential formats are flagged at write time, returning <code>[REDACTED]</code> to agents.</li>
                    <li style={{ marginBottom: 6 }}><strong>AI Sanitization:</strong> Every write passes through <code>sanitizeMemoryAsync</code> (Workers AI) to detect and neutralize adversarial prompt-injection content before storage.</li>
                    <li style={{ marginBottom: 6 }}><strong>Least-Privilege ABAC:</strong> Agent policies restrict operations by category (rules, projects, references, stack) and tag filters.</li>
                    <li style={{ marginBottom: 6 }}><strong>JIT Approvals:</strong> Memories tagged <code>#confidential</code> trigger an approval gate, releasing temporary access only on human sign-off.</li>
                    <li><strong>Token Hardening:</strong> API and JIT tokens are hashed with PBKDF2-HMAC-SHA256 at 100,000 iterations.</li>
                  </ul>
                </div>
              </div>
              <div style={{ background: "rgba(59, 130, 246, 0.04)", border: "1px solid rgba(59, 130, 246, 0.15)", borderRadius: 12, padding: 18 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🤖 AI &amp; LLM Integration
                </h3>
                <div style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li style={{ marginBottom: 6 }}><strong>Semantic Vectors:</strong> Vectorizes facts via <code>@cf/baai/bge-m3</code> embeddings to power similarity-based context queries with vector persistence.</li>
                    <li style={{ marginBottom: 6 }}><strong>GraphRAG Extraction:</strong> Runs Workers AI ephemerally on write to extract entity nodes and semantic relationship edges.</li>
                    <li style={{ marginBottom: 6 }}><strong>Llama Reranking:</strong> Reranks top candidates via a Llama-3.3-70B cross-encoder in the browser session path.</li>
                    <li style={{ marginBottom: 6 }}><strong>Prompt Synthesis:</strong> Compresses facts into a single dense prompt via Llama-3-8B when <code>optimize: true</code> is passed.</li>
                    <li style={{ marginBottom: 6 }}><strong>Text Chunking:</strong> Long facts are automatically split into overlapping semantic chunks before vectorization, enabling sub-fact retrieval precision.</li>
                    <li><strong>AI Import Ingestion:</strong> Automatically tags, deduplicates, and structures external chatbot console imports via LLM.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        );
      case "connection-auth":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Connection & Authentication</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              To connect an external AI model or development assistant to Locker, you must supply the Model Context Protocol (MCP) endpoint address and a cryptographically signed API token.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    🔌 MCP Endpoint Address
                  </span>
                  <button
                    onClick={() => handleCopy(`${origin}/api/mcp`)}
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
                      transition: "all 0.15s ease",
                    }}
                  >
                    <CopyIcon size={11} /> Copy Address
                  </button>
                </div>
                <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflowX: "auto", whiteSpace: "nowrap" }}>
                  {origin}/api/mcp
                </code>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                    🔑 HTTP Authentication Header
                  </span>
                  <button
                    onClick={() => handleCopy("Authorization: Bearer <your-api-token>")}
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
                      transition: "all 0.15s ease",
                    }}
                  >
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
              {[
                { step: "1", text: "Navigate to the Admin page from the top navigation bar." },
                { step: "2", text: "Under the personal settings sidebar, click API Tokens." },
                { step: "3", text: "Click the Generate Token button and select a token type: Human Token (for interactive clients like Claude Desktop) or Agent Token (for autonomous agents and CI/CD pipelines)." }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16, marginTop: 16, marginBottom: 24 }}>
              <div style={{ background: "rgba(168, 85, 247, 0.04)", border: "1px solid rgba(168, 85, 247, 0.15)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, marginTop: 0 }}>
                  👤 Human Tokens
                </h4>
                <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li style={{ marginBottom: 6 }}><strong>Use Case:</strong> Interactive clients where a human drives the session (e.g., Claude Desktop, IDE extensions).</li>
                    <li style={{ marginBottom: 6 }}><strong>Permissions:</strong> Controlled by a simple per-tool bitmask (e.g. <code>recall_context</code>, <code>commit_memory</code>).</li>
                    <li><strong>Safety:</strong> Destructive calls (delete/update) bypass queues but require manual TOTP 2FA or a secure passcode.</li>
                  </ul>
                </div>
              </div>

              <div style={{ background: "rgba(59, 130, 246, 0.04)", border: "1px solid rgba(59, 130, 246, 0.15)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8, marginTop: 0 }}>
                  🤖 Agent Tokens (ABAC Policies)
                </h4>
                <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    <li style={{ marginBottom: 6 }}><strong>Use Case:</strong> Autonomous workflows, background daemons, or CI/CD pipelines.</li>
                    <li style={{ marginBottom: 6 }}><strong>Agent Context:</strong> Requires declaring an audited purpose label aligning operations to a specific role.</li>
                    <li style={{ marginBottom: 6 }}><strong>Category Filters:</strong> Strict limits on access to specific categories (<code>rules</code>, <code>projects</code>, <code>references</code>, <code>stack</code>).</li>
                    <li style={{ marginBottom: 6 }}><strong>Tag Bounds:</strong> Define <code>allowedTags</code> and <code>deniedTags</code> rules for precise tag-level boundaries.</li>
                    <li style={{ marginBottom: 6 }}><strong>JIT Gate:</strong> Memories tagged <code>#confidential</code> trigger an approval queue and are redacted by default.</li>
                    <li><strong>Credentials:</strong> Access to stored vault credentials must be explicitly and individually allowed.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        );
      case "security-privacy":
        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 11, background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", color: "#10b981", borderRadius: 20, padding: "2px 10px", fontWeight: 600 }}>
                🛡️ Zero-Trust Security Architecture
              </span>
              </div>
            
            <h2 style={{ fontSize: 28, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Security & Privacy Guide</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 15, lineHeight: 1.6, marginBottom: 28 }}>
              Locker operates on a zero-compromise security model designed to safeguard sensitive tech stack architecture, corporate code guidelines, and personal context. Our edge-native infrastructure isolates, encrypts, and audits every layer of data interaction.
            </p>

            <div style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              marginBottom: 32
            }}>
              {/* Card 1: Zero-Knowledge Envelope Encryption */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🔑</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>AES-256-GCM Envelope Encryption</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  All memory contents, tech stack profiles, and templates are encrypted using a two-layer envelope scheme prior to database insertion:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Per-User Data Encryption Keys (DEK):</strong> Each vault receives a unique randomly generated 256-bit AES-GCM key. All memory data is encrypted exclusively under this DEK — the master server key never directly touches user data.</li>
                  <li><strong>Key Encryption Key (KEK) Wrapping:</strong> Each DEK is itself encrypted (wrapped) using the server-side KEK via AES-256-GCM and stored in D1. Compromising the database alone or the environment key alone is insufficient to decrypt any data — both are required.</li>
                  <li><strong>Memory-Only Key Scope:</strong> Unwrapped DEKs reside strictly in ephemeral edge worker memory during request processing and are never logged, persisted, or sent to clients.</li>
                  <li><strong>Encrypted Backups:</strong> Database logs, D1 transaction snapshots, and storage backups consist exclusively of ciphertext — wrapped DEKs and encrypted payloads.</li>
                </ul>
              </div>

              {/* Card 2: SQLite Relational Boundaries & Triggers */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🛡️</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Relational Boundaries & SQLite Triggers</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Isolation is enforced deep inside the SQLite engine to guarantee absolute separation of user and organizational domains:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>SQLite Condition Triggers:</strong> Active database-level triggers strictly govern data insertion and updates, preventing scope mismatch.</li>
                  <li><strong>Multi-Tenant Isolation:</strong> Structured <code>scopeType</code> (<code>personal</code>, <code>organization</code>, <code>team</code>) acts as a cryptographic boundary.</li>
                  <li><strong>Foreign Key Protection:</strong> Destructive operations or queries attempting to leak records across scopes are immediately blocked at the database engine layer.</li>
                  <li><strong>Agent ABAC:</strong> Agent tokens carry an <code>AgentPolicy</code> declaring which memory categories (<code>rules</code>, <code>projects</code>, <code>references</code>, <code>stack</code>), an explicit <code>allowedTags</code>/<code>deniedTags</code> tag-level allowlist/denylist, and whether the credential vault is accessible. Category and tag filters are applied at both the SQL query layer and the Vectorize metadata layer — encrypted data for off-limits categories is never decrypted. Memories tagged <code>#confidential</code> are never returned directly to agents; they trigger a JIT access request that requires human approval before the unredacted fact is released.</li>
                </ul>
              </div>

              {/* Card 3: Web Crypto TOTP 2FA */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>📲</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Web Crypto TOTP Two-Factor Auth</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Secure destructive or administrative operations via programmatic multi-factor authorization:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>RFC 6238 Standard:</strong> Code generation and validation is performed using high-speed Web Crypto HMAC-SHA1 at the edge.</li>
                  <li><strong>MFA for MCP:</strong> Destructive client tools (delete or update memory) require a valid 6-digit TOTP code when 2FA is active.</li>
                  <li><strong>Setup & Backup:</strong> Setup via settings wizard with generated secret keys, QR validation verification, and download-capable recovery keys.</li>
                </ul>
              </div>

              {/* Card 4: MCP Passcode Safeguards */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🔑</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>MCP Deletion & Write Passcode</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  A static passcode protection layer for human token write/delete operations. Agent tokens follow the async approval queue instead — this passcode path applies to human tokens only:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Fallback Protection (Human Tokens):</strong> When 2FA is inactive, write or delete actions executed by a human token via MCP are blocked unless the correct passcode is supplied.</li>
                  <li><strong>PBKDF2 Hashing:</strong> Passcodes and API tokens are stored using PBKDF2-HMAC-SHA256 at 100,000 iterations (Cloudflare Workers max) with a random per-token salt — resistant to GPU-accelerated brute-force even if the database is leaked.</li>
                  <li><strong>Explicit Confirmation:</strong> Human token destructive calls require <code>confirm: true</code> alongside a valid passcode or TOTP code. For agent tokens, <code>confirm: true</code> has no effect on <code>update_memory</code> or <code>delete_memory</code> — those are always queued.</li>
                </ul>
              </div>

              {/* Card 5: Moderated Conflict Resolution */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>📝</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Human Approval Queue for Agent Actions</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Blocks autonomous agents from making any destructive change without explicit human sign-off:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Agent Approval Gate:</strong> When an agent token calls <code>update_memory</code> or <code>delete_memory</code>, the request is written to the <code>memory_recommendations</code> queue — the tool returns <code>{"{ queued: true }"}</code> and the vault is left unchanged.</li>
                  <li><strong>Vault Actions UI:</strong> The Memories page surfaces pending agent requests with color-coded cards — red for deletion requests, blue for update requests, amber for detected contradictions. Each card shows the current fact and the proposed change side-by-side.</li>
                  <li><strong>No Silent Mutations:</strong> Agents cannot bypass the queue by passing <code>confirm: true</code>; that parameter is ignored for agent tokens on destructive operations.</li>
                  <li><strong>Contradiction Detection:</strong> New facts that contradict existing memories are also queued as amber archive recommendations rather than silently overwriting context.</li>
                </ul>
              </div>

              {/* Card 6: V8 Sandboxing & Session Audits */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>⚙️</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>V8 Ephemeral Sandboxing & Auditing</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Advanced tracking and runtime isolation shield the application and trace its execution:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>V8 Ephemeral Sandbox:</strong> Runtime execution is sandboxed in Cloudflare Worker processes, shutting down attack surfaces.</li>
                  <li><strong>Enterprise Audit Trails:</strong> Every MCP call or administrative modification logs the timestamp, IP address, user-agent, and target scope.</li>
                  <li><strong>Session Management:</strong> Users can inspect and revoke active sessions directly from the Sessions settings panel.</li>
                </ul>
              </div>

              {/* Card 7: Entropy-Based DLP */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🔍</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Entropy-Based Data Loss Prevention</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Secrets and PII are detected and quarantined at write time — preserving the raw fact under envelope encryption while flag-quarantining the record — using a multi-layer scanning engine:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Shannon Entropy Gating:</strong> Candidate values in key-value assignments, JSON fields, and Authorization headers are scored for entropy. Only high-entropy strings (≥ 4.0 bits/char) in secret-looking contexts are flagged, eliminating false positives on legitimate code IDs and slugs.</li>
                  <li><strong>Structural Pattern Detection:</strong> Unmistakable credential formats — AWS access keys, Stripe keys, GitHub PATs, Slack tokens, PEM private keys, and database URIs — are caught unconditionally regardless of entropy score.</li>
                  <li><strong>PII Scanning:</strong> Email addresses, phone numbers, credit card numbers, and SSNs are detected via dedicated regex patterns and flagged for quarantine.</li>
                  <li><strong>Quarantine & Review Lifecycle:</strong> DLP runs during <code>commit_memory</code> and <code>update_memory</code>. If sensitive data is found, the memory is quarantined. AI agents and MCP requests receive a secure <code>[REDACTED]</code> placeholder in transit. Owners and admins can explicitly review, verify, and unmask/release the memory from the <strong>DLP Quarantine Dashboard</strong> (Admin → Quarantine).</li>
                </ul>
              </div>

              {/* Card 8: AI Sanitization */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🤖</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>AI Adversarial Content Sanitization</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  A secondary AI-powered defense layer that runs alongside DLP to neutralize prompt-injection and adversarial payloads before they reach the vault:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Workers AI Screening:</strong> <code>sanitizeMemoryAsync</code> calls a Workers AI classification model on every <code>commit_memory</code> and <code>update_memory</code> request to score the content for adversarial patterns, jailbreak attempts, and instruction overrides.</li>
                  <li><strong>Pre-Encryption Interception:</strong> Screening runs on plaintext before encryption, ensuring no adversarial payload ever reaches ciphertext storage or graph extraction.</li>
                  <li><strong>Graceful Fallback:</strong> If the AI screening service is unavailable, writes succeed with a warning flag rather than blocking — preventing availability issues from halting legitimate memory operations.</li>
                  <li><strong>Layered with DLP:</strong> AI sanitization runs in addition to (not instead of) entropy-based DLP checks, providing independent defense-in-depth coverage.</li>
                </ul>
              </div>

              {/* Card 9: Blind Index & FTS5 */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>⚡</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Blind Index Hashes & FTS5 Database Filtering</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Locker's retrieval pipeline is optimized to minimize the number of encrypted records that must be decrypted per query, improving performance without sacrificing confidentiality:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Blind Index Hashes:</strong> Tag and category values are stored as HMAC hashes alongside ciphertext, enabling D1 to filter candidate records by tag/category at the database level — without decrypting — before the result set is returned to the worker.</li>
                  <li><strong>FTS5 Full-Text Keyword Pre-filter:</strong> SQLite FTS5 virtual tables provide fast keyword matching on encrypted token hashes, narrowing the candidate pool from thousands of records to a small shortlist before vector scoring and decryption.</li>
                  <li><strong>Combined Pipeline:</strong> FTS5 keyword pre-filter → blind index tag filter → Vectorize semantic ranking → decryption of top-N candidates → Llama reranking. Only the final top candidates are ever decrypted, dramatically reducing DEK unwrap overhead.</li>
                </ul>
              </div>

              {/* Card 10: Auth & Session Hardening */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🔑</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Auth Hardening, Request Isolation & Token Prefix Lookups</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  The authentication layer is designed to eliminate race conditions and minimize database exposure under load:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>One-Time OAuth Bootstrap:</strong> OAuth client provisioning runs at most once per worker isolate lifetime rather than on every request, eliminating D1 write storms and race conditions under concurrent load.</li>
                  <li><strong>Isolate-Scoped Auth Cache:</strong> Authenticated session configurations are cached at the worker isolate level with a 5-minute TTL, reducing redundant D1 reads without holding stale credentials beyond the cache window.</li>
                  <li><strong>Indexed Token Prefix Lookups:</strong> API tokens are stored with an indexed prefix shard. Authentication performs a fast index scan on the prefix column rather than a full-table HMAC comparison, keeping auth latency sub-millisecond even at scale.</li>
                  <li><strong>Read-Only Request Path:</strong> The per-request authentication path performs no writes to the database, ensuring that high-traffic periods cannot cause connection exhaustion or lock contention on auth tables.</li>
                  <li><strong>TOTP Entropy Hardening:</strong> TOTP secrets and backup codes are generated using <code>crypto.getRandomValues</code> (CSPRNG) rather than <code>Math.random()</code>, ensuring full cryptographic entropy for all 2FA seed material.</li>
                </ul>
              </div>

              {/* Card 11: Zod Server-Function Validation */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>🧩</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Strict Server-Function Input Validation</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  Every server function that handles memory ingestion or retrieval enforces a rigid Zod schema before any database or vector-index transaction executes — blocking prompt-injection payloads at the earliest possible boundary:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>String length caps:</strong> <code>fact</code> and <code>query</code> fields are capped at 10,000 characters; names and tags at 64–500 characters. Payloads exceeding these bounds are rejected before touching D1 or Vectorize.</li>
                  <li><strong>UUID enforcement:</strong> All ID fields (<code>id</code>, <code>memoryId</code>, <code>versionId</code>, etc.) must be valid UUIDs. Non-UUID strings — including injected SQL fragments or hallucinated identifiers — are dropped at parse time.</li>
                  <li><strong>Enum allow-lists:</strong> <code>category</code>, <code>action</code>, <code>tokenType</code>, <code>scopeType</code>, and similar fields are validated against a fixed <code>z.enum()</code> set; values outside the allow-list are rejected rather than passed through.</li>
                  <li><strong>Array size limits:</strong> Batch operations (<code>batchImportMemories</code>, <code>bulkDeleteMemories</code>, <code>moveMemories</code>) cap input arrays at 200–500 items to prevent runaway agent loops from exhausting quota.</li>
                  <li><strong>Hard-fail parsing:</strong> Zod <code>.parse()</code> throws a <code>ZodError</code> on any schema violation; the server function returns an error immediately without executing any side effects on D1 or Vectorize.</li>
                </ul>
              </div>
            </div>

            <div style={{
              background: "rgba(168, 85, 247, 0.05)",
              border: "1px solid rgba(168, 85, 247, 0.15)",
              borderRadius: "12px",
              padding: "16px",
              fontSize: "13px",
              color: "var(--text-muted)",
              lineHeight: "1.6",
              display: "flex",
              alignItems: "center",
              gap: "12px",
            }}>
              <span style={{ fontSize: 20 }}>💡</span>
              <span>
                <strong>Need to configure your security?</strong> Head over to the <strong>Admin → Security</strong> tab in the navigation bar to enable Time-Based 2FA, set a deletion passcode, or audit active login sessions.
              </span>
            </div>
          </div>
        );
      case "import-memories":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Importing & Migrating</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Locker makes it easy to migrate your personal context, coding rules, and learned preferences from existing LLM platforms. Use custom extraction prompts designed for each major AI assistant, paste the output into Locker, and the AI-powered ingestion pipeline automatically deduplicates, categorizes, tags, and encrypts everything in seconds.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Import Workflow</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Open Import Tab", text: "Click Import in the top navigation bar" },
                { step: "2", title: "Select Source Platform", text: "Choose your source: ChatGPT, Claude, Perplexity, Gemini, Grok, or Microsoft Copilot" },
                { step: "3", title: "Copy Custom Prompt", text: "Locker displays a tailored extraction prompt optimized for that platform's memory structure. Click Copy Prompt to copy to clipboard" },
                { step: "4", title: "Extract from Source", text: "Open the source AI platform in another tab. Paste the prompt into a chat session and let the AI generate its complete memory dump (saved memory slots, custom instructions, learned preferences)" },
                { step: "5", title: "Paste into Locker", text: "Copy the AI's output (usually a JSON or markdown code block). Return to Locker and paste it into the Import textarea. Select a destination scope (Personal, Team, Organization) or project workspace key" },
                { step: "6", title: "Parse with AI", text: "Click Parse with AI. Locker's ingestion engine runs Llama 3.3 to automatically deduplicate, categorize (Rules/Projects/References), assign tags, and extract entities for the knowledge graph" },
                { step: "7", title: "Review & Adjust", text: "Preview the parsed facts on screen. Adjust categories, tags, or scopes as needed. Remove items that are incorrect or irrelevant" },
                { step: "8", title: "Batch Import", text: "Click Batch Import Memories. Locker encrypts everything with your vault DEK, stores in D1, generates vector embeddings on Vectorize, and inserts into the knowledge graph" }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Supported Platforms</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🤖 ChatGPT</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Extracts explicit Memory entries (Settings → Personalization → Memory), custom instructions, and behavioral preferences inferred from conversation history.</p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🧠 Claude</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Exports custom instructions, project context from previous conversations, and inferred preferences about your workflow and coding style.</p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🔍 Perplexity</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Pulls Personalization settings, saved knowledge snippets, and research preferences from your Perplexity account verbatim.</p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>✨ Gemini</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Exports from "Saved Info" panels, saved prompts, and conversation history summaries that Gemini remembers about you.</p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>⚡ Grok</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Extracts custom context, personality settings, and conversation memory from your Grok account on xAI.</p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🪟 Microsoft Copilot</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Pulls from Copilot's settings, saved conversations, and learned preferences about your work and interests.</p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Import Features</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🤖 AI-Powered Parsing
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Llama 3.3-70B automatically categorizes facts (Rules, Projects, References), removes duplicates within the batch, and assigns appropriate tags without manual work.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔄 Cross-Reference Deduplication
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Locker compares incoming memories against existing vault memories using vector similarity. Duplicates are automatically merged; related facts are linked via the knowledge graph.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  ✏️ Pre-Import Review
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Before committing, preview all parsed facts. Adjust categories, tags, and scopes to match your vault structure. Remove irrelevant or incorrect items.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔒 Full Encryption
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  All imported memories are encrypted with AES-256-GCM using your vault's DEK before storage. Plaintext is never persisted.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  📊 Batch Operations
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Import hundreds or thousands of facts in one operation. Locker handles bulk encryption, indexing, and graph extraction efficiently in the background.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔗 Entity Extraction
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Workers AI automatically extracts named entities (services, libraries, APIs, databases) and creates relationship edges in the knowledge graph for multi-hop retrieval.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Best Practices</h3>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, gap: 8, display: "flex", flexDirection: "column" }}>
              <li><strong>Start with one platform:</strong> Begin by importing from your primary AI assistant (ChatGPT or Claude). Test the workflow and review results before importing from others.</li>
              <li><strong>Review parsed results carefully:</strong> Before clicking Batch Import, scan the categorizations and tags. Adjust outliers to match your vault conventions.</li>
              <li><strong>Set appropriate scope:</strong> Choose Personal or Team scope based on whether the facts are personal learnings or shared team guidelines.</li>
              <li><strong>Assign project workspace keys:</strong> If importing project-specific context, assign it to a corresponding workspace key to keep memories organized by project.</li>
              <li><strong>Remove duplicates post-import:</strong> Even with deduplication, manually review imported memories for unexpected duplicates or contradictions. Archive or delete as needed.</li>
              <li><strong>Gradually migrate not bulk migrate:</strong> Rather than importing all memories at once, import in waves by category or time period. This lets you refine processes and catch issues early.</li>
            </ul>
          </div>
        );
      case "team-collaboration":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Team Collaboration</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Establish shared coding standards, stack specifications, and technical guidelines for your entire development team. Locker's team and organization structure lets you group members, assign roles, and scope memories to specific teams — eliminating drift and ensuring every developer has access only to the context they need.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Organizations vs. Teams</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
                  🏢 Organizations
                </h4>
                <ul style={{ paddingLeft: 16, color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.7, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Top-level scope:</strong> Organizations are the root billing and administrative hub for your entire company or workspace.</li>
                  <li><strong>Billing management:</strong> Control seat allocations, manage subscriptions, and enforce organization-wide quotas.</li>
                  <li><strong>Shared workspace keys:</strong> Create organization-level project workspace keys that multiple teams inherit and share.</li>
                  <li><strong>Global memories:</strong> Store organization-wide architectural decisions, security standards, and compliance guidelines visible to all members.</li>
                  <li><strong>One per login:</strong> Each Locker account has one primary organization; teams nest within it.</li>
                </ul>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
                  👥 Teams
                </h4>
                <ul style={{ paddingLeft: 16, color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.7, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>Granular sub-groups:</strong> Create specialized teams (e.g., <code>frontend-team</code>, <code>backend-team</code>, <code>devops-team</code>, <code>data-team</code>).</li>
                  <li><strong>Scoped memories:</strong> Restrict technical guidelines and project context to specific teams so developers only see relevant instructions.</li>
                  <li><strong>Team-level workspace keys:</strong> Assign team-specific project keys (e.g., <code>my-org:frontend:next-js-app</code>) to isolate rule sets by team.</li>
                  <li><strong>Flexible membership:</strong> A developer can belong to multiple teams (frontend and shared-backend infrastructure) and access memories from all of them.</li>
                  <li><strong>Multiple teams:</strong> Create as many teams as needed; there is no limit.</li>
                </ul>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>User Roles & Permissions</h3>
            <div style={{
              border: "1px solid var(--border)",
              borderRadius: 12,
              overflow: "hidden",
              background: "var(--surface2)",
              marginBottom: 28,
              width: "100%",
              overflowX: "auto"
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left", minWidth: 550 }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Role</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Scope</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Permissions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontWeight: "bold", color: "var(--accent)" }}>Owner</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)" }}>Organization</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.6 }}>Full billing control (seat upgrades, plan changes), organization deletion, admin role assignment, member removal, and vault deletion. Complete read-write access to all organization and team memories.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontWeight: "bold", color: "var(--accent)" }}>Admin</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)" }}>Organization or Team</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.6 }}>Create and manage teams, send email invitations to developers, create/edit/delete organization or team memories, manage team memberships. Cannot modify billing or delete organization.</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "14px 16px", fontWeight: "bold", color: "var(--text)" }}>Member</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)" }}>Team(s)</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.6 }}>Read-only or read-write access to memories scoped to their team(s). Access organization-wide shared memories (read-only by default). Cannot manage members or create teams.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Setting Up Your Organization & Teams</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Create Organization", text: "When you first sign up, Locker creates your primary organization. Customize the name and settings from Admin → Organization Settings" },
                { step: "2", title: "Create Teams", text: "Go to Admin → Teams and click Create Team. Enter a name (e.g., 'Backend Team', 'Frontend Team'). Teams automatically inherit your organization's workspace keys" },
                { step: "3", title: "Invite Members", text: "Click Invite Members in the Organization or Team view. Enter developer email addresses. Locker sends a 48-hour magic link; they click to accept and join" },
                { step: "4", title: "Assign Team Membership", text: "Once members join, assign them to specific teams. An admin can manage team membership from the Teams view" },
                { step: "5", title: "Set Memory Scopes", text: "When creating memories, choose Organization (visible to all), Team (visible only to that team), or Personal scope" },
                { step: "6", title: "Assign Workspace Keys", text: "For team-specific projects, create team-scoped workspace keys. When exporting rules, specify the key to generate team-specific .cursorrules, CLAUDE.md, etc." }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Inviting Members</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Navigate to Organization or Team", text: "Go to Admin → Organization (or Teams → Select Team)" },
                { step: "2", title: "Click Invite Members", text: "Look for an Invite Members, Add Member, or + Invite button" },
                { step: "3", title: "Enter Email Address", text: "Type the email address of the developer you want to invite (e.g., alice@company.com)" },
                { step: "4", title: "Select Role (Optional)", text: "Choose Member role (default). Admins can select Admin if granting management permissions" },
                { step: "5", title: "Send Invitation", text: "Click Send Invitation or Invite. Locker generates a cryptographically signed magic link valid for 48 hours" },
                { step: "6", title: "Share Link or Wait for Email", text: "The recipient receives an email from Locker with the invitation link. They click the link and follow signup/login, then automatically join your organization/team" },
                { step: "7", title: "Verify Membership", text: "Return to the Members view. Once the invitee accepts, they appear in the member list with their assigned role" }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Memory Scoping & Access Control</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🌐 Organization Scope
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Memories visible to all organization members. Use for company-wide architectural decisions, security standards, and compliance guidelines that every developer needs to know.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  👥 Team Scope
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Memories visible only to members of a specific team. Perfect for team-specific coding standards, technology choices, and deployment workflows that don't apply org-wide.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔒 Personal Scope
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Memories visible only to you. Use for private notes, experiments, or sensitive information that should not be shared with the team.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Best Practices</h3>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, gap: 8, display: "flex", flexDirection: "column" }}>
              <li><strong>Name teams by function:</strong> Use clear, functional names like "Frontend", "Backend", "DevOps", "Data Engineering" so developers instantly know which team to join and what memories are relevant.</li>
              <li><strong>Scope memories carefully:</strong> Organization scope for broad standards; team scope for specialized practices. Avoid over-sharing; team members should only see what they need.</li>
              <li><strong>Assign team-specific workspace keys:</strong> For team-scoped rules, create workspace keys like <code>my-org:frontend:next-app</code> to keep rule sets isolated and prevent accidental mixing.</li>
              <li><strong>Use templates across teams:</strong> Create organization-scoped templates for standard stacks all teams use, and team-scoped templates for team-specific variants.</li>
              <li><strong>Manage admin access carefully:</strong> Only grant Admin role to developers who will actively manage team membership and create shared memories. Most developers should be Members.</li>
              <li><strong>Review org memories quarterly:</strong> Periodically audit organization-wide memories to remove outdated standards and keep shared context fresh and accurate.</li>
            </ul>
          </div>
        );
      case "managing-memories":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Managing Memories</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Locker provides flexible, powerful interfaces for managing your long-term memory vault. You can create, update, search, archive, and delete memories through the browser dashboard, the mobile-friendly vault view, or programmatically via AI agents using Model Context Protocol (MCP). Full encryption, audit trails, and approval workflows protect your memories at every step.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Managing Memories via the Dashboard</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Create a Memory", text: "Click New Memory at the top right. Select a Category (Rules, Projects, or References), enter your fact, add custom tags (e.g., #authentication, #database, #frontend), optionally set a project workspace scope, and click Save" },
                { step: "2", title: "View & Search", text: "Browse all memories in the main vault view. Use the search bar to find by keyword, or filter by category, tags, or scope. The search uses hybrid GraphRAG, combining keyword matching, semantic similarity (bge-m3), FTS5 keyword pre-filtering, and graph relationships" },
                { step: "3", title: "Switch View Modes", text: "Use the view-mode toggle (top right of the Memories page) to switch between Grid, List, and Table views. Grid is ideal for at-a-glance browsing; List shows more metadata per row; Table enables sorting by any column" },
                { step: "4", title: "Edit a Memory", text: "Click the pencil (edit) icon on any memory card. Modify the fact text, tags, scope, or category. Locker automatically updates the database, recalculates semantic embeddings on Vectorize, and re-runs graph extraction" },
                { step: "5", title: "Delete a Memory", text: "Click the trash icon on a memory card. For user tokens, you may need to provide a passcode or 2FA code. For agent tokens, the deletion is queued for your approval" },
                { step: "6", title: "Archive Old Memories", text: "Use the archive feature to hide old but still-relevant memories from active searches while retaining them for reference. Archived memories are excluded from recall_context by default" },
                { step: "7", title: "Review Stale Memories", text: "The Stale filter (Sort menu) surfaces memories that haven't been accessed recently. A banner also appears at the top of the Memories page when stale entries exceed a threshold — click Review to batch-audit and refresh or archive them" },
                { step: "8", title: "View Metadata & History", text: "Click on a memory to view its full metadata: creation date, last modified, last accessed, staleness score, encryption status, graph relationships, and semantic vector score" }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Memory Categories &amp; Tagging</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  📋 Rules
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  Coding standards, best practices, and architectural guidelines. Examples: "Use TypeScript strict mode", "Always validate user input server-side", "Restrict API responses to 5MB max".
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  📁 Projects
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  Project-specific context, architecture decisions, and workflow notes. Examples: "Frontend is built on Next.js 14 with App Router", "Database uses PostgreSQL with Drizzle ORM", "Deployment via GitHub Actions to Vercel".
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔗 References
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  External documentation links, API references, and tool guides. Examples: "Drizzle ORM docs: https://orm.drizzle.team", "Our internal wiki: https://wiki.company.com", "Design system Figma link".
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  📂 Configs
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  Agent configuration payloads and template content. Used by the sync tools and ConfigBuilder to generate agent-specific rule files (CLAUDE.md, .cursorrules, AGENTS.md, etc.).
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Stale Memory Management</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              Memories that haven't been read by any agent for an extended period are automatically marked as stale. Reviewing and refreshing stale context prevents agents from operating on outdated facts:
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  ⏰ Staleness Banner
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  When stale memories exceed a threshold, a banner appears at the top of the Memories dashboard. Click <strong>Review Stale Memories</strong> to jump directly to the filtered view.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔄 Stale Sort Filter
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  The Sort dropdown includes a <strong>Stale</strong> option that re-orders memories by last-access time (oldest first), surfacing the most likely candidates for review or archiving.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  ✔️ Staleness Indicator
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Each memory card shows a staleness badge when the last-accessed timestamp is beyond the configured threshold. Update the fact or archive it to clear the indicator.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Vault Actions & Agent Approval Queue</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              When connected AI agents attempt to create, update, or delete memories, those actions are held in an approval queue. You review and approve/deny changes before they reach the vault:
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔵 Update Requests (Blue Cards)
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Agent wants to refine an existing memory. Shows the current fact and the proposed new version side-by-side. Review the change, then click Approve or Deny.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔴 Delete Requests (Red Cards)
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Agent proposes removing a memory (usually outdated facts). Review context and click Approve to delete, or Deny to keep the memory.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🟡 Contradiction Alerts (Amber Cards)
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  New fact contradicts an existing memory (e.g., "Use Node.js 18" vs. "Use Node.js 20"). Decide which is correct, then approve or deny the proposed change.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Programmatic Management via MCP</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              Connected AI developer agents can manage memories programmatically via MCP tools. Every operation is logged, encrypted, and subject to your security and approval policies:
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔍 Reading Context
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  Agents call <button onClick={() => setActiveSection("mcp-tools-retrieval")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>recall_context</button> to search by semantic similarity, or <button onClick={() => setActiveSection("mcp-tools-retrieval")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>search_memories</button> for keyword/tag-based lookups.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  ✍️ Mutating Store
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  Agents use <button onClick={() => setActiveSection("mcp-tools-mutation")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>commit_memory</button> to add new facts, <button onClick={() => setActiveSection("mcp-tools-mutation")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>update_memory</button> to refine existing ones, or <button onClick={() => setActiveSection("mcp-tools-mutation")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>delete_memory</button> to remove stale data.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔐 Credential Vault
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  Agents use <button onClick={() => setActiveSection("mcp-tools-credentials")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>store_credential</button>, <button onClick={() => setActiveSection("mcp-tools-credentials")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>retrieve_credential</button>, and <button onClick={() => setActiveSection("mcp-tools-credentials")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>delete_credential</button> to manage secrets (requires <code>allowCredentials: true</code> on agent token).
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Best Practices</h3>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, gap: 8, display: "flex", flexDirection: "column" }}>
              <li><strong>Use consistent tags:</strong> Develop a tagging convention (e.g., #auth, #database, #frontend) and apply it uniformly. This makes search and filtering more reliable for both you and agents.</li>
              <li><strong>Set appropriate scope:</strong> Use Personal for experiments, Team for shared guidelines, and Organization for company-wide standards. Avoid over-sharing sensitive information.</li>
              <li><strong>Review agent requests regularly:</strong> Check the Vault Actions queue daily or weekly. Approving or denying requests promptly keeps your vault clean and agents learning from feedback.</li>
              <li><strong>Archive vs. delete:</strong> Archive outdated but historically useful memories instead of deleting them. This preserves context if you need to reference how practices evolved.</li>
              <li><strong>Periodically audit & refresh:</strong> Quarterly, review your vault for outdated facts, duplicate entries, and missing context. Keep your memory vault clean and current.</li>
              <li><strong>Use project workspace keys:</strong> Isolate memories by project to avoid cross-project contamination and ensure agents see only relevant context per project.</li>
            </ul>

            <div style={{
              background: "rgba(168, 85, 247, 0.04)",
              border: "1px solid rgba(168, 85, 247, 0.15)",
              borderRadius: 12,
              padding: "16px",
              marginTop: "28px",
              fontSize: 13,
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}>
              <strong>💡 Developer Tip:</strong> For complete input schemas, required parameters, response formats, and error handling for all MCP tools, see the <button onClick={() => setActiveSection("mcp-tools-retrieval")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: "bold", textDecoration: "underline", padding: 0, font: "inherit" }}>MCP Tools Reference</button> section.
            </div>
          </div>
        );
      case "stack-creator":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Tech Stack Creator</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              The <strong>Tech Stack Creator</strong> is an interactive step-by-step wizard that helps you define your workspace's complete technology profile across 12 architectural categories. Locker uses your selections and constraints to automatically generate optimized coding standards, best practices, and AI agent instructions tailored to your exact tech choices.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>The 12 Technology Categories</h3>
            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 28 }}>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                Locker segments your architecture into 12 independent categories, each representing a critical decision point in your technology choices:
              </p>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {[
                  { key: "Language", val: "TypeScript, Go, Python, Rust, C#, Java" },
                  { key: "Runtime", val: "Node.js, Bun, Deno, .NET, JVM, CPython" },
                  { key: "Frontend", val: "React, Vue, Svelte, Next.js, Nuxt, Astro" },
                  { key: "Backend", val: "Express, Hono, FastAPI, Django, Spring, Laravel" },
                  { key: "Database", val: "PostgreSQL, MySQL, D1, SQLite, MongoDB, DynamoDB" },
                  { key: "ORM/Query", val: "Drizzle, Prisma, sqlx, TypeORM, Hibernate, Sequelize" },
                  { key: "Deploy", val: "Cloudflare Workers, Vercel, AWS, Fly.io, Railway, Render" },
                  { key: "Styling", val: "Tailwind CSS, Vanilla CSS, styled-components, Sass, PostCSS" },
                  { key: "Lint & Format", val: "ESLint, Prettier, Biome, Ruff, Clippy, rustfmt" },
                  { key: "Test Runner", val: "Vitest, Jest, Playwright, Pytest, RSpec, xUnit" },
                  { key: "State Manage", val: "Zustand, Redux, Jotai, Pinia, Recoil, NgRx" },
                  { key: "Build Tool", val: "Vite, Webpack, esbuild, Turbopack, Parcel, Rollup" }
                ].map((c) => (
                  <div key={c.key} style={{
                    fontSize: 12,
                    padding: "8px 14px",
                    borderRadius: 8,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    flex: "1 1 calc(50% - 5px)"
                  }}>
                    <strong style={{ color: "var(--accent)", fontSize: 11 }}>{c.key}</strong>
                    <span style={{ color: "var(--text-muted)", fontSize: 11, lineHeight: 1.4 }}>{c.val}</span>
                  </div>
                ))}
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>How It Works</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Launch the Wizard", text: "Open your Vault, click New Memory, and select Tech Stack Creator" },
                { step: "2", title: "Select Technologies", text: "Step through each of the 12 categories and choose the technologies your team uses. Multiple selections per category are allowed" },
                { step: "3", title: "Add Custom Constraints", text: "Define negative rules and team-specific guidelines (e.g., 'no inline Tailwind utilities', 'always use TypeScript strict mode', 'require unit tests for utilities')" },
                { step: "4", title: "Review & Customize", text: "Locker generates a ruleset tailored to your selections. Review each guideline and adjust wording or emphasis to match your team's preferences" },
                { step: "5", title: "Set Scope", text: "Choose whether to save globally (all projects), to a specific project workspace key, or to a team scope. This determines who sees the rules" },
                { step: "6", title: "Export or Save", text: "Download the rules as .cursorrules, CLAUDE.md, copilot-instructions.md, or save to your vault for future reference and agent access" }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Key Features</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🤖 AI-Powered Rule Generation
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Workers AI (Llama 3.3-70B) generates best practices tailored to your exact technology choices. The ruleset balances pragmatism with best practices for your specific stack.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🎯 Custom Constraints
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Add negative rules or team-specific requirements. Locker incorporates these into the generated guidelines to ensure output matches your actual practices and preferences.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  ✏️ Edit & Refine
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Review each generated guideline before saving. Adjust wording, remove irrelevant items, or add specifics that the AI missed to perfectly fit your team's culture.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  📁 Multi-Format Export
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Export generated rules as CLAUDE.md, .cursorrules, copilot-instructions.md, GEMINI.md, or AGENTS.md. One ruleset, multiple agent formats.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  💾 Persist as Memory
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Save the ruleset as a project-scoped memory in your vault. AI agents can recall it via MCP, and you can re-export anytime without regenerating.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔄 Save as Template
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Save your selections and verified ruleset as a reusable template. Load it instantly in future projects to bypass rule regeneration entirely.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Best Practices</h3>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, gap: 8, display: "flex", flexDirection: "column" }}>
              <li><strong>Be thorough with constraints:</strong> The more specific your negative rules, the better Locker can tailor the generated guidelines. Don't assume; explicitly state what your team avoids.</li>
              <li><strong>Refine before saving:</strong> Take time to review and edit the generated ruleset. Personalize wording to match your team's voice and remove rules that don't apply to your actual workflow.</li>
              <li><strong>Save as a template:</strong> Once you have a refined ruleset, save it as a template. Future projects can load it and skip regeneration, saving tokens and time.</li>
              <li><strong>Use with team scope:</strong> When creating team-specific rulesets, assign them to a team workspace key and set the scope to your team. Ensure everyone on the team loads the same baseline.</li>
              <li><strong>Update regularly:</strong> As your stack evolves (upgrade frameworks, adopt new tools), run the wizard again with updated selections. Keep your team's rules current.</li>
            </ul>
          </div>
        );
      case "templates":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Templates</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Templates are reusable technology stack and rules configurations that save time and maintain consistency across your projects. Instead of selecting the same 12 tech categories and constraints repeatedly, load a template to populate your baseline instantly and skip regeneration of verified rule sets.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Creating Templates</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Navigate to Templates", text: "Go to your Vault and click the Templates tab (or Templates section in navigation)" },
                { step: "2", title: "Click New Template", text: "Click the New Template button or + Add Template" },
                { step: "3", title: "Configure Stack Selections", text: "Select your preferred technology stack across all 12 categories (Language, Runtime, Frontend, Backend, Database, ORM, Deploy Platform, Styling, Lint & Format, Test Runner, State Management, Build Tool)" },
                { step: "4", title: "Add Custom Constraints", text: "Define negative rules or guidelines specific to your team (e.g., 'No Tailwind inline utilities', 'Do not write raw SQL outside repos', 'Always use TypeScript strict mode')" },
                { step: "5", title: "Set Template Metadata", text: "Give your template a clear name (e.g., 'Next.js + Prisma Stack', 'Python FastAPI Backend') and optional description for your team" },
                { step: "6", title: "Save Template", text: "Click Save Template to persist it to your database. The template is now available for loading in future projects" }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Loading & Using Templates</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Open Stack Creator", text: "From the Vault page, click New Memory and select Tech Stack Creator to launch the wizard" },
                { step: "2", title: "Load Custom Stack Blueprints", text: "In the wizard, click the Load Custom Stack Blueprints button (usually appears after step 1)" },
                { step: "3", title: "Select Your Template", text: "A modal appears listing all your saved templates. Click on the template you want to load" },
                { step: "4", title: "Auto-Populate Selections", text: "The wizard automatically populates all 12 tech categories, custom constraints, and any existing rule recommendations from the template" },
                { step: "5", title: "Review & Customize (Optional)", text: "You can adjust individual selections or constraints before proceeding. Changes to this session do not modify the original template" },
                { step: "6", title: "Proceed to Rules Review", text: "Click Next to continue through the wizard. If the template has pre-verified rules, you can use them directly without re-running LLM generation" }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Template Features</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  💾 Persistent Storage
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Templates are stored in your vault database alongside your memories. They persist across sessions and are accessible by you and your team members (depending on template scope).
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  ⚡ Instant Loading
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Clicking Load Template populates all 12 stack categories, constraints, and previously-generated rules in milliseconds — no network latency or processing time.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🚀 Skip LLM Regeneration
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  If a template has pre-verified rule sets, a "Use Loaded Template Rules" button appears, bypassing LLM generation entirely and jumping directly to review — saving tokens and time.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  👥 Team & Org Scope
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Create templates at Personal, Organization, or Team scope. Organization-scoped templates are shared with all team members automatically, ensuring consistency.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  ✏️ Edit & Version
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Update templates as your tech stack evolves or team practices change. Locker tracks template modifications; loading a template always gives you the latest version.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  🔄 Immutable Session Scope
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Loading a template does not modify the original. Any changes you make during the Stack Creator session only affect the current project — the template remains unchanged.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Best Practices</h3>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, gap: 8, display: "flex", flexDirection: "column" }}>
              <li><strong>Name templates clearly:</strong> Use descriptive names like "Next.js + Tailwind + Vercel" or "FastAPI + PostgreSQL Backend" so team members instantly recognize what the template contains.</li>
              <li><strong>Document constraints in descriptions:</strong> If your template has unusual negative rules or specialized requirements, note them in the template description for team awareness.</li>
              <li><strong>Keep templates up-to-date:</strong> When major versions of your stack components change or team practices evolve, update the template to reflect the current state.</li>
              <li><strong>Scope templates appropriately:</strong> Personal templates are for experimenting; Organization or Team scope templates should be for standardized, vetted stacks your team actually uses.</li>
              <li><strong>Leverage pre-verified rules:</strong> Once a template's generated rule set has been reviewed and approved by your team, save those rules to the template to enable instant use without LLM regeneration.</li>
            </ul>
          </div>
        );
      case "export-rules":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Exporting Agent Rules</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Locker translates your memory rules and tech stack blueprints into optimized configuration files formatted for specific AI developer agents.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Supported Formats & Targets</h3>
            <div style={{ 
              border: "1px solid var(--border)", 
              borderRadius: 12, 
              overflow: "hidden", 
              background: "var(--surface2)", 
              marginBottom: 32,
              width: "100%",
              overflowX: "auto"
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left", minWidth: 550 }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Format File</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Agent / IDE Client</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Target Path</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { file: "CLAUDE.md", client: "Claude Code (CLI / Extension)", path: "./CLAUDE.md" },
                    { file: ".cursorrules", client: "Cursor Editor (JSON formatted)", path: "./.cursorrules" },
                    { file: "copilot-instructions.md", client: "GitHub Copilot Chat", path: "./.github/copilot-instructions.md" },
                    { file: "GEMINI.md", client: "Gemini Code Assist / Global Rules", path: "~/.gemini/GEMINI.md" },
                    { file: "AGENTS.md", client: "OpenAI Codex & General Agents", path: "./AGENTS.md" },
                    { file: ".agents/rules/rules.md", client: "Google Antigravity Workspaces", path: "./.agents/rules/rules.md" }
                  ].map((f, idx, arr) => (
                    <tr key={f.file} style={{ borderBottom: idx < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <td style={{ padding: "12px 16px", fontFamily: "monospace", color: "var(--accent)", fontWeight: 600 }}>{f.file}</td>
                      <td style={{ padding: "12px 16px", color: "var(--text-muted)" }}>{f.client}</td>
                      <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 12, color: "var(--text-muted)" }}>{f.path}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>📥 Method A: Direct UI Downloads</h4>
                <ol style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li>Open the <strong>Vault</strong> page, click the <strong>Export Config File</strong> button on any stack card.</li>
                  <li>Select your target format dropdown option (e.g. <code>.cursorrules</code>).</li>
                  <li>Click <strong>Download Rules</strong> to trigger browser file delivery.</li>
                </ol>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>🚀 Method B: npx locker-sync CLI</h4>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  A standalone zero-install CLI tool that authenticates with the Locker API and writes the compiled rules file directly to your workspace. Ideal for pre-commit hooks and CI workflows.
                </p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>Commands</span>
                  <button
                    onClick={() => handleCopy(`# Sync .cursorrules to your project root
npx locker-sync sync --format cursor --project locker

# Preview without writing (dry-run)
npx locker-sync sync --format claude --dry-run

# Using environment variable for CI
LOCKER_API_TOKEN=lkr_... npx locker-sync sync`)}
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
                      transition: "all 0.15s ease",
                    }}
                  >
                    <CopyIcon size={11} /> Copy
                  </button>
                </div>
                <pre style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 10,
                  margin: "0 0 10px 0",
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "var(--text)",
                  overflowX: "auto"
                }}>{`# Sync .cursorrules to your project root
npx locker-sync sync --format cursor --project locker

# Preview without writing (dry-run)
npx locker-sync sync --format claude --dry-run

# Using environment variable for CI
LOCKER_API_TOKEN=lkr_... npx locker-sync sync`}</pre>
                <div style={{ background: "rgba(168,85,247,0.05)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 8, padding: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", margin: 0, fontWeight: 700 }}>🔗 Pre-commit Hook (.git/hooks/pre-commit)</p>
                    <button
                      onClick={() => handleCopy(`#!/bin/sh
npx locker-sync sync --format cursor --project my-project`)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "3px 8px",
                        background: "transparent",
                        border: "1px solid rgba(168,85,247,0.3)",
                        color: "var(--text-muted)",
                        fontSize: 10,
                        fontWeight: 600,
                        borderRadius: 4,
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <CopyIcon size={10} /> Copy
                    </button>
                  </div>
                  <pre style={{ background: "transparent", border: "none", padding: 0, margin: 0, fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", overflowX: "auto" }}>{`#!/bin/sh
npx locker-sync sync --format cursor --project my-project`}</pre>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>⚡ Method C: MCP Tool (Agent-Initiated)</h4>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  AI developer agents connected via MCP can call Locker's native sync tool to build and write rules files directly inside your active workspace without manual downloads.
                </p>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>JSON Arguments</span>
                  <button
                    onClick={() => handleCopy(`{
  "name": "sync_agent_configs",
  "arguments": {
    "projectKey": "locker"
  }
}`)}
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
                      transition: "all 0.15s ease",
                    }}
                  >
                    <CopyIcon size={11} /> Copy
                  </button>
                </div>
                <pre style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 10,
                  margin: 0,
                  fontFamily: "monospace",
                  fontSize: 11,
                  color: "var(--text)",
                  overflowX: "auto"
                }}>{`{
  "name": "sync_agent_configs",
  "arguments": {
    "projectKey": "locker"
  }
}`}</pre>
              </div>
            </div>
          </div>
        );
      case "webhooks":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Webhook Overview</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
              Locker connects to your existing engineering workflow in two directions. Inbound webhooks automatically
              capture knowledge as it happens — no manual <code>commit_memory</code> calls required. Outbound
              notifications push approval requests to your team so sensitive context can be reviewed and released in seconds.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 18 }}>🐙</span>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>GitHub</h3>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "rgba(110,64,201,0.1)", color: "#6e40c9", border: "1px solid rgba(110,64,201,0.25)", fontWeight: 600 }}>Inbound</span>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>
                  When a pull request is merged, Locker reads the diff, generates a technical summary with Workers AI, and commits it to your vault as a <code>#webhook #github</code> memory.
                </p>
                <button onClick={() => setActiveSection("webhooks-github")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontSize: 13, fontWeight: 600 }}>
                  GitHub Setup Guide →
                </button>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 18 }}>◆</span>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>Linear</h3>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "rgba(94,106,210,0.1)", color: "#5E6AD2", border: "1px solid rgba(94,106,210,0.25)", fontWeight: 600 }}>Inbound</span>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>
                  When a ticket moves to a done state, Locker captures the ticket description, summarises it, and commits it to your vault as a <code>#webhook #linear</code> memory.
                </p>
                <button onClick={() => setActiveSection("webhooks-linear")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontSize: 13, fontWeight: 600 }}>
                  Linear Setup Guide →
                </button>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 18 }}>💬</span>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>Slack</h3>
                  <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: "rgba(74,21,75,0.12)", color: "#b362b5", border: "1px solid rgba(74,21,75,0.25)", fontWeight: 600 }}>Outbound</span>
                </div>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>
                  When an agent requests access to a <code>#confidential</code> memory, Locker posts a Slack message with a one-click Approve button. The approval link is HMAC-signed and expires in 30 minutes.
                </p>
                <button onClick={() => setActiveSection("webhooks-slack-jit")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontSize: 13, fontWeight: 600 }}>
                  Slack JIT Setup Guide →
                </button>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>How inbound webhooks work</h3>
            <ol style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, marginBottom: 32 }}>
              <li><strong>Signature verification</strong> — HMAC-SHA256 signature validated against your stored secret before any processing begins.</li>
              <li><strong>Event filtering</strong> — Only merged PRs and tickets in a terminal done state are processed; everything else returns <code>{`{ok: true, skipped: true}`}</code>.</li>
              <li><strong>Idempotency</strong> — Each event is keyed by <code>(source, external_id)</code>. Replayed webhooks return <code>{`{ok: true, duplicate: true}`}</code> without re-committing.</li>
              <li><strong>Content fetch</strong> — The diff URL or ticket description is fetched ephemerally and never written to disk in plain text.</li>
              <li><strong>AI summarisation</strong> — Workers AI (<code>llama-3.1-8b-instruct-fp8</code>) generates a 3–5 sentence technical summary focused on what changed and why.</li>
              <li><strong>Vault encryption</strong> — The summary is encrypted with AES-256-GCM under the vault DEK for the resolved project key before any D1 write.</li>
              <li><strong>Memory commit</strong> — A <code>projects</code>-category memory is inserted and immediately searchable via <code>recall_context</code>.</li>
              <li><strong>Audit trail</strong> — A row is inserted in <code>webhook_events</code> capturing the encrypted summary, raw title, and commit reference.</li>
            </ol>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Response shapes (inbound webhooks)</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              {[
                { label: "Success", color: "#22c55e", body: `{ "ok": true, "memoryId": "uuid" }` },
                { label: "Skipped (irrelevant event)", color: "var(--text-muted)", body: `{ "ok": true, "skipped": true }` },
                { label: "Duplicate (replay)", color: "var(--text-muted)", body: `{ "ok": true, "duplicate": true }` },
                { label: "Auth failure", color: "#ef4444", body: `{ "error": "Unauthorized: ..." }` },
              ].map((r) => (
                <div key={r.label} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: r.color, margin: "0 0 8px 0", textTransform: "uppercase", letterSpacing: "0.05em" }}>{r.label}</p>
                  <pre style={{ background: "var(--surface)", borderRadius: 6, padding: 8, fontFamily: "monospace", fontSize: 11, color: "var(--text)", margin: 0, overflowX: "auto" }}>{r.body}</pre>
                </div>
              ))}
            </div>
          </div>
        );

      case "webhooks-github":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>GitHub Webhooks</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              When a pull request is merged, Locker ephemerally reads the diff, runs it through Workers AI to produce a
              concise technical summary, and commits the encrypted result to your vault tagged <code>#webhook #github</code>.
              No manual <code>commit_memory</code> calls needed.
            </p>

            <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface2)", marginBottom: 32 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Event</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Endpoint</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Trigger condition</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "12px 16px", color: "var(--text-muted)" }}>Pull Request</td>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>POST /api/webhooks/github</td>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>action = "closed" and pull_request.merged = true</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Step 1 — Store the signing secret in Locker</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              Go to <strong>Settings → Integrations</strong>. Under the GitHub row for the scope you want (Personal or your org), click <strong>Configure</strong>, paste a random signing secret (generate one with <code>openssl rand -hex 32</code>), and click <strong>Save</strong>. The secret is stored encrypted in your vault.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Step 2 — Register the webhook in GitHub</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Navigate to Repository Settings", text: "Go to your GitHub repository → Settings (top right) → Webhooks in the left sidebar." },
                { step: "2", title: "Add a new webhook", text: "Click Add webhook." },
                { step: "3", title: "Set the Payload URL", text: `Enter your Locker endpoint: ${origin}/api/webhooks/github` },
                { step: "4", title: "Set Content Type", text: "Select application/json from the Content type dropdown." },
                { step: "5", title: "Paste the signing secret", text: "Enter the same secret you saved in Locker in the previous step." },
                { step: "6", title: "Select events", text: 'Choose "Let me select individual events" then check only Pull requests. Uncheck everything else.' },
                { step: "7", title: "Enable and save", text: "Check the Active checkbox and click Add webhook." },
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, border: "1px solid rgba(168,85,247,0.2)" }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Step 3 — Generate a Locker API token</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Go to Settings → API Tokens", text: "Click Generate Token." },
                { step: "2", title: "Choose Agent Token", text: "Agent tokens are designed for autonomous webhook processing and have explicit ABAC policies." },
                { step: "3", title: "Enable commit_memory", text: "This permission lets the token write memories to your vault." },
                { step: "4", title: "Set scope (optional)", text: "Choose Personal, Organization, or Team to restrict which vault receives webhook memories." },
                { step: "5", title: "Copy the token", text: "The token is shown as lkr_… — copy it immediately. It is displayed only once." },
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, border: "1px solid rgba(168,85,247,0.2)" }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Step 4 — Add the Authorization header</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
              GitHub sends this header with every webhook request. Configure it in the webhook settings under <strong>Headers</strong>:
            </p>
            <pre style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)", marginBottom: 28, overflowX: "auto" }}>{`Authorization: Bearer lkr_your_token_here`}</pre>

            <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: "var(--text)" }}>Tip:</strong> The signing secret and the API token serve different purposes. The <strong>signing secret</strong> proves the request came from GitHub (HMAC-SHA256). The <strong>API token</strong> tells Locker which vault to write to. Both are required.
              </p>
            </div>
          </div>
        );

      case "webhooks-linear":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Linear Webhooks</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              When an issue moves to a done state, Locker reads the ticket description, generates a concise summary with
              Workers AI, and commits the encrypted result to your vault tagged <code>#webhook #linear</code>.
            </p>

            <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface2)", marginBottom: 32 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left" }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Event</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Endpoint</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Trigger condition</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: "12px 16px", color: "var(--text-muted)" }}>Issue Update</td>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>POST /api/webhooks/linear</td>
                    <td style={{ padding: "12px 16px", fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)" }}>state.name matches done / completed / finished / closed / merged</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Step 1 — Store the signing secret in Locker</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              Go to <strong>Settings → Integrations</strong>. Under the Linear row for the scope you want, click <strong>Configure</strong>, paste your signing secret, and click <strong>Save</strong>.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Step 2 — Register the webhook in Linear</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Navigate to Workspace Settings", text: "Go to your Linear workspace → Settings (bottom left) → API." },
                { step: "2", title: "Open Webhooks", text: "In the left menu under API, click Webhooks." },
                { step: "3", title: "Create a new webhook", text: "Click Create webhook." },
                { step: "4", title: "Set the URL", text: `Enter: ${origin}/api/webhooks/linear` },
                { step: "5", title: "Paste the signing secret", text: "Enter the same secret you saved in Locker." },
                { step: "6", title: "Select events", text: "Check only Issues. Uncheck everything else." },
                { step: "7", title: "Save and verify", text: "Click Create webhook. Optionally send a test event to confirm Locker responds correctly." },
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, border: "1px solid rgba(168,85,247,0.2)" }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Step 3 — Generate a Locker API token</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
              Same as GitHub: go to <strong>Settings → API Tokens</strong>, generate an Agent Token with <code>commit_memory</code> permission, set the desired scope, and copy it.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Step 4 — Add the Authorization header</h3>
            <pre style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)", marginBottom: 28, overflowX: "auto" }}>{`Authorization: Bearer lkr_your_token_here`}</pre>

            <div style={{ background: "rgba(94,106,210,0.04)", border: "1px solid rgba(94,106,210,0.2)", borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: "var(--text)" }}>Note:</strong> Linear sends both the signing secret (in the <code>linear-signature</code> header) and the Authorization token. Both must be correct for Locker to process the event.
              </p>
            </div>
          </div>
        );

      case "webhooks-slack-jit":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Slack</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
              When an automated agent requests access to a <code>#confidential</code> memory, Locker intercepts the
              query and posts a Slack message to your configured channel. The message includes an <strong>Approve (15 min)</strong> button — clicking it mints a short-lived JIT token without ever opening the Locker dashboard.
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 24 }}>
              This is an <strong>outbound</strong> integration — Locker posts to Slack, not the other way around. There is no inbound endpoint to register. The webhook URL is stored encrypted per-user or per-org in your credential vault.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 32 }}>
              {[
                { icon: "🔒", label: "Intercept", text: "Agent queries a #confidential memory — Locker blocks it and creates a JIT request record." },
                { icon: "📨", label: "Notify", text: "Locker posts a Block Kit message to your Slack channel with agent name, tool, and blocked memory count." },
                { icon: "✅", label: "Approve", text: "You click Approve. Locker mints a 15-minute lkr_jit_ token and records it against the request." },
                { icon: "🔓", label: "Unlock", text: "The agent retries its original query using the JIT token as its Bearer credential and receives the unredacted memory." },
              ].map((c) => (
                <div key={c.label} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                  <div style={{ fontSize: 20, marginBottom: 8 }}>{c.icon}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{c.label}</div>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>{c.text}</p>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Setup</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Create an Incoming Webhook in Slack", text: 'In your Slack workspace go to Apps, search "Incoming Webhooks", and click Add to Slack. Choose the channel for JIT alerts (e.g. #locker-alerts) and click Allow.' },
                { step: "2", title: "Copy the webhook URL", text: "Slack shows a URL beginning with https://hooks.slack.com/services/…. Copy it." },
                { step: "3", title: "Save it in Locker", text: "Go to Settings → Integrations. Find the Slack — JIT Alerts row, choose the scope (Personal or your org), click Configure, paste the URL, and click Save. The URL is encrypted in your vault immediately." },
                { step: "4", title: "Test it", text: "Have an agent token call recall_context or search_memories against a memory tagged #confidential. Locker intercepts the query and posts to your Slack channel within seconds." },
                { step: "5", title: "Approve from Slack", text: 'Click "Approve (15 min)" in the Slack message. The agent can then retry its original query with the returned JIT token to receive the unredacted memory. The token expires automatically after 15 minutes.' },
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, border: "1px solid rgba(168,85,247,0.2)" }}>{s.step}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Security properties</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
              {[
                { label: "HMAC-signed approve URL", text: "The Approve button URL is signed with HMAC-SHA256 using your BETTER_AUTH_SECRET. Altering the request ID or expiry breaks the signature." },
                { label: "30-minute link expiry", text: "The approval link is valid for 30 minutes. After that it returns 403 and the agent must re-trigger the query to generate a new request." },
                { label: "15-minute JIT token", text: "Approval mints a lkr_jit_ token valid for exactly 15 minutes and scoped to only the specific blocked memory IDs in that request." },
                { label: "Audit trail", text: "Every approval via the Slack link is recorded in audit_logs with source: slack_link, the request ID, and timestamp." },
                { label: "Per-scope URL", text: "Personal and org scopes store their own webhook URL independently. An org-level URL is used when the JIT request originates from an org-scoped agent token." },
              ].map((item) => (
                <div key={item.label} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14, display: "flex", gap: 12 }}>
                  <span style={{ color: "#22c55e", fontSize: 16, flexShrink: 0, marginTop: 1 }}>✓</span>
                  <div>
                    <strong style={{ color: "var(--text)", fontSize: 13 }}>{item.label}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "2px 0 0 0", lineHeight: 1.5 }}>{item.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: "rgba(74,21,75,0.06)", border: "1px solid rgba(74,21,75,0.2)", borderRadius: 12, padding: 16 }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
                <strong style={{ color: "var(--text)" }}>No Slack app required.</strong> Locker uses a simple Incoming Webhook — not a full Slack app installation. You only need to create the webhook under Apps in your workspace. No OAuth flow, bot user, or admin approval needed.
              </p>
            </div>
          </div>
        );

      case "mcp-about":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Model Context Protocol (MCP)</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              The Model Context Protocol (MCP) is an open-source standard created by Anthropic that allows clients (such as local AI developer tools or editors) to query secure context servers. It decouples LLM logic from specialized APIs and databases, providing a unified, secure interface for context injection.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>The 3 Pillars of MCP</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              MCP defines three core structural primitives to bridge LLMs with external systems:
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                  💬 Prompts
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                  Standardized prompt templates that servers expose to clients. Prompts can contain variable fields and system instructions, helping users write consistent queries.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 6 }}>
                  💾 Resources
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                  Read-only context data sources exposed to models as raw textual content (such as log files, documentation pages, or database read operations).
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--accent)", display: "flex", alignItems: "center", gap: 6 }}>
                  ⚙️ Tools (Locker Core)
                </h4>
                <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0, lineHeight: 1.5 }}>
                  Executable functions with explicit JSON schemas that allow models to modify server state. Locker relies heavily on Tools to search, store, update, and sync memories.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Transport Architectures</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              MCP supports multiple transport strategies depending on whether the server runs locally or remotely:
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>📡 Stdio Transport</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Ideal for local command-line utilities and utilities running on the same machine. Communication is performed through standard input/output streams (<code>stdin</code>/<code>stdout</code>).
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>⚡ Streamable HTTP Transport</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  The current MCP standard for remote servers. Uses a single HTTP endpoint that accepts JSON-RPC POST requests and may stream responses. Locker implements this transport as a serverless Cloudflare Worker at <code>/api/mcp</code>.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Official Resources & Links</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              Explore the official documentation and repositories to learn more about developing or extending Model Context Protocol applications:
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 16 }}>
              {[
                { title: "Official Website", url: "https://modelcontextprotocol.io", icon: "🌐", desc: "The home of MCP. Includes setup guides, quickstarts, and client integrations." },
                { title: "Protocol Spec", url: "https://modelcontextprotocol.io/specification/", icon: "📜", desc: "The official JSON-RPC 2.0 schema and architectural specifications." },
                { title: "GitHub Org", url: "https://github.com/modelcontextprotocol", icon: "🐙", desc: "Official SDK repositories (TypeScript, Python, Go) and MCP servers." },
                { title: "Anthropic Intro", url: "https://www.anthropic.com/news/model-context-protocol", icon: "📰", desc: "Anthropic's official announcement and vision for standardizing AI context." }
              ].map((l) => (
                <a
                  key={l.title}
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: 16,
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    textDecoration: "none",
                    transition: "all 0.2s ease",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)", display: "flex", alignItems: "center", gap: 6 }}>
                    <span>{l.icon}</span> {l.title}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>
                    {l.desc}
                  </span>
                </a>
              ))}
            </div>
          </div>
        );
      case "mcp-tools-retrieval":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Context Retrieval Tools</h2>
            <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              <p style={{ margin: "0 0 12px 0" }}>Context Retrieval tools allow connected AI assistants to discover workspaces, search memories, and query long-term context.</p>
              <p style={{ margin: "0 0 8px 0", fontWeight: 600, color: "var(--text)" }}>The <code>recall_context</code> tool runs an advanced hybrid retrieval pipeline:</p>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li style={{ marginBottom: 6 }}><strong>RRF Fusion:</strong> Merges semantic embeddings (bge-m3), keyword overlap, and recency decay (half-life ≈ 139 days) via Reciprocal Rank Fusion (k=60).</li>
                <li style={{ marginBottom: 6 }}><strong>GraphRAG Expansion:</strong> Hydrates adjacent entity nodes automatically using the Workers AI knowledge graph.</li>
                <li style={{ marginBottom: 6 }}><strong>Cross-Encoder Reranking:</strong> Decrypts top 20 candidates and reranks them via Llama-3.3-70B for maximum relevance.</li>
                <li style={{ marginBottom: 6 }}><strong>Authority Pinning:</strong> Pins authoritative organization-level memories directly to the top.</li>
                <li><strong>LLM Synthesis:</strong> Set <code>optimize: true</code> to summarize the results into a single dense system prompt via Llama-3-8B.</li>
              </ul>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ALL_TOOLS.filter((t) =>
                ["list_accessible_scopes", "recall_context", "search_memories", "get_memory_summary"].includes(t.name)
              ).map((tool) => (
                <details key={tool.name} style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden"
                }}>
                  <summary style={{
                    padding: "14px 18px",
                    fontWeight: 700,
                    fontSize: 14,
                    color: "var(--accent)",
                    fontFamily: "monospace",
                    cursor: "pointer",
                    listStyleType: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    userSelect: "none"
                  }}>
                    <span>⚙️ {tool.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 4 }}>
                      Click to Expand
                    </span>
                  </summary>
                  <div style={{
                    padding: "16px 18px",
                    borderTop: "1px solid var(--border)",
                    background: "var(--surface)"
                  }}>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>
                      {tool.description}
                    </p>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--accent)", margin: "0 0 6px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Input Schema
                      </p>
                      <pre style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 12,
                        margin: 0,
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: "var(--text)",
                        overflow: "auto",
                        maxHeight: 240,
                        lineHeight: 1.5,
                      }}>
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      case "mcp-tools-mutation":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Memory Mutation Tools</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 12 }}>
              Memory Mutation tools let connected clients add, update, and delete facts.
            </p>
            <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 10, padding: "16px", marginBottom: 20, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 8px 0", fontWeight: 700, color: "var(--text)" }}>Mutation Behavior by Token Type:</p>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li style={{ marginBottom: 6 }}><strong>Human Tokens:</strong> All tool calls (<code>commit_memory</code>, <code>update_memory</code>, <code>delete_memory</code>) execute immediately after passcode or TOTP 2FA verification (if configured).</li>
                <li><strong>Agent Tokens:</strong> Destructive calls (<code>update_memory</code>, <code>delete_memory</code>) are never executed immediately. They are routed to the <code>memory_recommendations</code> queue (returning <code>{"{ queued: true, recommendationId }"}</code>) and require human approval in the dashboard. <code>commit_memory</code> checks for conflicts and may also queue recommendations.</li>
              </ul>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ALL_TOOLS.filter((t) =>
                ["commit_memory", "update_memory", "delete_memory"].includes(t.name)
              ).map((tool) => (
                <details key={tool.name} style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden"
                }}>
                  <summary style={{
                    padding: "14px 18px",
                    fontWeight: 700,
                    fontSize: 14,
                    color: "var(--accent)",
                    fontFamily: "monospace",
                    cursor: "pointer",
                    listStyleType: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    userSelect: "none"
                  }}>
                    <span>⚙️ {tool.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 4 }}>
                      Click to Expand
                    </span>
                  </summary>
                  <div style={{
                    padding: "16px 18px",
                    borderTop: "1px solid var(--border)",
                    background: "var(--surface)"
                  }}>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>
                      {tool.description}
                    </p>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--accent)", margin: "0 0 6px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Input Schema
                      </p>
                      <pre style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 12,
                        margin: 0,
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: "var(--text)",
                        overflow: "auto",
                        maxHeight: 240,
                        lineHeight: 1.5,
                      }}>
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      case "mcp-tools-sync":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Workspace Sync Tools</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              Workspace Sync tools translate stack profile definitions and baseline coding rules stored in Locker into optimized instructions formatted for local developer agents.
            </p>

            {/* CLI callout */}
            <div style={{
              background: "rgba(168, 85, 247, 0.05)",
              border: "1px solid rgba(168, 85, 247, 0.2)",
              borderRadius: 12,
              padding: 16,
              marginBottom: 24,
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
            }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>🚀</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 6px 0" }}>
                  Prefer the CLI? Use <code style={{ color: "var(--accent)" }}>npx locker-sync sync</code>
                </p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  The <strong>locker-sync</strong> CLI is the recommended developer workflow. It wraps this MCP tool in a zero-install command that resolves your API token, calls <code>sync_agent_configs</code>, and writes all rules files to disk — all in one step. Perfect for pre-commit hooks.
                </p>
                <pre style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: 10, margin: 0, fontFamily: "monospace", fontSize: 11, color: "var(--text)", overflowX: "auto" }}>{`# Sync .cursorrules (recommended for developers)
npx locker-sync sync --format cursor --project my-project

# All formats: cursor | claude | copilot | gemini | agents | antigravity
npx locker-sync sync --format claude --dry-run`}</pre>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ALL_TOOLS.filter((t) =>
                ["sync_agent_configs"].includes(t.name)
              ).map((tool) => (
                <details key={tool.name} style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  overflow: "hidden"
                }}>
                  <summary style={{
                    padding: "14px 18px",
                    fontWeight: 700,
                    fontSize: 14,
                    color: "var(--accent)",
                    fontFamily: "monospace",
                    cursor: "pointer",
                    listStyleType: "none",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    userSelect: "none"
                  }}>
                    <span>⚙️ {tool.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 4 }}>
                      Click to Expand
                    </span>
                  </summary>
                  <div style={{
                    padding: "16px 18px",
                    borderTop: "1px solid var(--border)",
                    background: "var(--surface)"
                  }}>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>
                      {tool.description}
                    </p>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--accent)", margin: "0 0 6px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>
                        Input Schema
                      </p>
                      <pre style={{
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        padding: 12,
                        margin: 0,
                        fontFamily: "monospace",
                        fontSize: 11,
                        color: "var(--text)",
                        overflow: "auto",
                        maxHeight: 240,
                        lineHeight: 1.5,
                      }}>
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      case "mcp-tools-credentials":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Credential Vault Tools</h2>
            <div style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              <p style={{ margin: "0 0 10px 0" }}>Credential Vault tools allow connected agents to manage secrets securely:</p>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li style={{ marginBottom: 6 }}><strong>Encryption:</strong> Credentials are encrypted at rest via AES-256-GCM under the per-vault DEK. Secrets are never exposed in plaintext memory logs.</li>
                <li><strong>Access Control:</strong> Agent tokens deny credential vault access by default. You must explicitly configure <code>allowCredentials: true</code> in the token's policy.</li>
              </ul>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
              {ALL_TOOLS.filter((t) =>
                ["store_credential", "list_credentials", "retrieve_credential", "delete_credential"].includes(t.name)
              ).map((tool) => (
                <details key={tool.name} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                  <summary style={{ padding: "14px 18px", fontWeight: 700, fontSize: 14, color: "var(--accent)", fontFamily: "monospace", cursor: "pointer", listStyleType: "none", display: "flex", justifyContent: "space-between", alignItems: "center", userSelect: "none" }}>
                    <span>⚙️ {tool.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 4 }}>Click to Expand</span>
                  </summary>
                  <div style={{ padding: "16px 18px", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>{tool.description}</p>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--accent)", margin: "0 0 6px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Input Schema</p>
                      <pre style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: 0, fontFamily: "monospace", fontSize: 11, color: "var(--text)", overflow: "auto", maxHeight: 240, lineHeight: 1.5 }}>
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>JIT Access for Confidential Memories</h3>
            <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
              <p style={{ margin: "0 0 10px 0" }}>Memories tagged <code>#confidential</code> trigger an on-demand approval workflow:</p>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li style={{ marginBottom: 6 }}><strong>Redaction:</strong> Agents receive a <code>jitRequestId</code> and <code>[APPROVAL PENDING]</code> placeholder instead of the fact.</li>
                <li style={{ marginBottom: 6 }}><strong>Human Gate:</strong> The token owner must call <code>approve_jit_access</code> to approve or deny the request.</li>
                <li><strong>Short-lived Token:</strong> On approval, the agent receives a temporary Bearer token valid for 15 minutes to fetch the unredacted memory.</li>
              </ul>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ALL_TOOLS.filter((t) => t.name === "approve_jit_access").map((tool) => (
                <details key={tool.name} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                  <summary style={{ padding: "14px 18px", fontWeight: 700, fontSize: 14, color: "var(--accent)", fontFamily: "monospace", cursor: "pointer", listStyleType: "none", display: "flex", justifyContent: "space-between", alignItems: "center", userSelect: "none" }}>
                    <span>⚙️ {tool.name}</span>
                    <span style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", border: "1px solid var(--border)", padding: "2px 8px", borderRadius: 4 }}>Click to Expand</span>
                  </summary>
                  <div style={{ padding: "16px 18px", borderTop: "1px solid var(--border)", background: "var(--surface)" }}>
                    <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 14px 0", lineHeight: 1.6 }}>{tool.description}</p>
                    <div>
                      <p style={{ fontSize: 10, color: "var(--accent)", margin: "0 0 6px 0", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Input Schema</p>
                      <pre style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, margin: 0, fontFamily: "monospace", fontSize: 11, color: "var(--text)", overflow: "auto", maxHeight: 240, lineHeight: 1.5 }}>
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      case "mcp-errors-security":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Error Codes & Security</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Learn about Locker's custom error response codes, programmatic MFA retries, and endpoint rate-limiting mechanisms.
            </p>

            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>JSON-RPC Error Codes</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              Locker uses standard JSON-RPC 2.0 error codes alongside custom application-level error codes to denote security blocks, quota limits, and scoping boundaries.
            </p>

            <div style={{ 
              border: "1px solid var(--border)", 
              borderRadius: 12, 
              overflow: "hidden", 
              background: "var(--surface2)", 
              marginBottom: 36,
              width: "100%",
              overflowX: "auto"
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left", minWidth: 600 }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700, width: 90 }}>Code</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700, width: 180 }}>Error Name</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Trigger Condition</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Recommended Client Handling</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "var(--error)", fontWeight: 600 }}>-32001</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Unauthorized</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Missing, expired, or invalid API token; or lacks necessary permissions for the tool scope.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Prompt user to configure a valid API key with appropriate scopes (e.g. <code>recall_context</code>).</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "var(--error)", fontWeight: 600 }}>-32003</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Forbidden</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Access to requested scope key is blocked; memory is locked (requires admin); modifying another user's shared fact; or an agent token's ABAC policy does not permit access to the requested memory category or credential vault.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Ensure the correct <code>projectKey</code> is provided, request owner/admin authorization, or verify the agent token's <code>allowedCategories</code>, <code>allowedTags</code>/<code>deniedTags</code>, and <code>allowCredentials</code> policy. For <code>#confidential</code> memories, use <code>approve_jit_access</code> to grant temporary access.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "var(--error)", fontWeight: 600 }}>-32004</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Quota Exceeded</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Locker subscription limits (storage capacity, recall rates, or operation quota) exceeded.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Notify user to upgrade their organization plan tier or clean up stale memory items.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "var(--error)", fontWeight: 600 }}>-32005</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Plan Restricted</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Using features (e.g. <code>crossWorkspaceSearch</code>) that require a higher plan tier (Business+).</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Inform user that the requested feature is locked under a higher plan tier.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "#f59e0b", fontWeight: 600 }}>-32024</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>MFA Required</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>User has TOTP 2FA enabled, but <code>totpCode</code> was missing or invalid.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Prompt human-in-the-loop for 6-digit TOTP code and retry the call with <code>totpCode</code>.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "#f59e0b", fontWeight: 600 }}>-32025</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Passcode Required</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>User has Deletion Passcode enabled (2FA inactive), but <code>passcode</code> was missing or invalid.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Prompt human-in-the-loop for deletion passcode and retry the call with <code>passcode</code>.</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "14px 16px", fontFamily: "monospace", color: "var(--error)", fontWeight: 600 }}>-32602</td>
                    <td style={{ padding: "14px 16px", color: "var(--text)", fontWeight: 600 }}>Invalid Params</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Missing required field; <code>confirm</code> was not set to true; character limit exceeded (<code>fact</code>/<code>query</code> max 10,000 chars); non-UUID passed as an ID field; or a value outside the allowed enum set (e.g. an unlisted <code>category</code>). Validation is enforced at the server function boundary before any D1 or Vectorize transaction executes.</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.4 }}>Verify input formats, ensure <code>confirm: true</code> is passed on mutations, use valid UUID strings for IDs, and use only supported enum values for <code>category</code> and <code>action</code> fields.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Interactive Verification Flow (MFA / Passcode — Human Tokens)</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
              This HITL flow applies to <strong>human tokens</strong> only. Agent tokens calling <code>update_memory</code> or <code>delete_memory</code> are routed to the async approval queue instead — they never reach this MFA/passcode check.
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              To prevent prompt injection attacks from performing unauthorized write or delete actions via human tokens, Locker requires explicit user validation. If a human-token client attempts to mutate or delete a memory, it should implement the following retry pattern:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 }}>
              {[
                { step: "1", title: "Initial Invocation", desc: "The human-token client makes a standard mutation call (e.g. delete_memory) with the memory id and confirm: true." },
                { step: "2", title: "Security Intercept", desc: "The Locker server identifies that the user has configured MFA (returns -32024) or a passcode (returns -32025)." },
                { step: "3", title: "Human Challenge", desc: "The AI agent intercepts the specific error code, displays a message, and asks the user to enter their current TOTP code or passcode." },
                { step: "4", title: "Verify & Complete", desc: "The client sends a new tool call containing the user's input (in the totpCode or passcode property). Locker processes and executes the action." }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div>
                    <strong style={{ display: "block", color: "var(--text)", fontSize: 13, marginBottom: 3 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.4 }}>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginBottom: 36 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }}>
                  Agent Implementation Example (JavaScript / Node)
                </span>
              </div>
              <pre style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                padding: "16px",
                fontFamily: "monospace",
                fontSize: 12,
                maxHeight: 380,
                overflow: "auto",
                lineHeight: 1.6,
                color: "var(--text)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                margin: 0,
              }}>{`async function performDestructiveAction(toolName, arguments) {
  // 1. Initial attempt with confirmation flag
  let result = await callMcpTool(toolName, { ...arguments, confirm: true });

  if (result.error) {
    const { code, message } = result.error;

    // 2. Intercept MFA check
    if (code === -32024) {
      const totpCode = await promptUserForInput(
        "Locker 2FA verification code required. Please check your authenticator app:"
      );
      // Retry request with totpCode
      return await callMcpTool(toolName, { ...arguments, confirm: true, totpCode });
    }

    // 3. Intercept Passcode check
    if (code === -32025) {
      const passcode = await promptUserForInput(
        "Locker deletion passcode required. Please enter your passcode:"
      );
      // Retry request with passcode
      return await callMcpTool(toolName, { ...arguments, confirm: true, passcode });
    }

    throw new Error(\`Failed to execute action: \` + message);
  }

  return result;
}`}</pre>
            </div>

            <div style={{ background: "rgba(168, 85, 247, 0.04)", border: "1px solid rgba(168, 85, 247, 0.15)", borderRadius: 12, padding: 18 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                ⚡ Rate Limits & Quota Control
              </h3>
              <div style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  <li style={{ marginBottom: 6 }}><strong>Rate Limiting:</strong> Maximum of <strong>60 requests per minute</strong> per token/session. Exceeding this triggers a <code>429 Too Many Requests</code> response.</li>
                  <li><strong>Storage Limits:</strong> Memory and vector capacities are checked at write time, returning error code <code>-32004</code> if exceeded.</li>
                </ul>
              </div>
            </div>
          </div>
        );
      case "tester":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Connection Tester</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Use this utility to test if the Locker MCP server endpoint is operational. This diagnostic calls the <code>tools/list</code> JSON-RPC method to verify connection.
            </p>

            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <button
                  onClick={handleTestConnection}
                  disabled={testLoading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 20px",
                    background: "var(--accent)",
                    color: "#fff",
                    fontWeight: 700,
                    fontSize: 13,
                    transition: "all 0.2s",
                    cursor: testLoading ? "not-allowed" : "pointer",
                    border: "none",
                    borderRadius: "var(--radius)",
                    boxShadow: "0 4px 6px -1px rgba(168, 85, 247, 0.2)"
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: testLoading ? "spin-slow 2s linear infinite" : "none" }}>
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  {testLoading ? "Testing connection..." : "Run Diagnostic Check"}
                </button>
              </div>

              {testResult && (
                <div style={{
                  padding: "14px 16px",
                  background: testResult.status === 'success' ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                  border: testResult.status === 'success' ? "1px solid rgba(34,197,94,0.25)" : "1px solid rgba(239,68,68,0.25)",
                  borderRadius: 12,
                  color: testResult.status === 'success' ? "#22c55e" : "var(--error)",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}>
                  {testResult.message}
                </div>
              )}
            </div>
          </div>
        );
      case "agent-activity":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Agent Activity Dashboard</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              The Agent Activity Dashboard gives developers full observability into every memory operation performed by your AI tools.
              Navigate to <strong>Admin → Agent Activity</strong> (under the Personal section) to access it.
              It answers the question: "Which tool recalled which memories, with what confidence, and what context was injected into the model?"
            </p>

            <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 12, padding: 20, marginBottom: 28 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
                <span>◎</span> Why This Matters
              </h3>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
                AI hallucinations often stem from <strong>outdated or missing context</strong> — facts that were never committed, expired, or recalled
                incorrectly. The Activity Dashboard maps every <code>recall_context</code> event to the exact memories returned,
                their semantic similarity scores, and the raw user-agent of the calling tool, so you can pinpoint stale context
                in seconds rather than guessing.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 28 }}>
              {[
                { icon: "◈", title: "Tool identification", desc: "Each event is tagged with the AI client that made the call — Cursor, Claude Desktop, Claude Code, Windsurf, Cline, GitHub Copilot, Continue, Zed, or any other MCP-compatible tool detected from the User-Agent header." },
                { icon: "⚡", title: "Semantic similarity scores", desc: "Every recalled memory includes a 0–100% similarity score computed from the bge-m3 embedding distance. Low scores on returned facts highlight potential false-positive recalls." },
                { icon: "📋", title: "Injected facts inspector", desc: "Expand any recall event to see the exact facts — decrypted content, category, tags, and score — that were injected into the model's context window." },
                { icon: "🔍", title: "Query tracing", desc: "The original query string sent by the agent is stored with every recall event, letting you correlate what the model asked for with what it actually received." },
              ].map(({ icon, title, desc }) => (
                <div key={title} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 18, marginBottom: 8 }}>{icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{desc}</div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Event Timeline</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 16 }}>
              The timeline displays all memory operations in reverse-chronological order (most recent first), auto-refreshing every 30 seconds.
              Each event card shows:
            </p>
            <ul style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.8, paddingLeft: 20, marginBottom: 24 }}>
              <li><strong>Action type</strong> — recall_context, commit_memory, update_memory, delete_memory, search_memories, JIT events, and more.</li>
              <li><strong>Tool badge</strong> — the AI client identified from the HTTP User-Agent string.</li>
              <li><strong>Query preview</strong> — the search string the agent sent (always visible without expanding).</li>
              <li><strong>Result count</strong> — how many memories were returned from the vault.</li>
              <li><strong>Timestamp</strong> — date and time to the second.</li>
            </ul>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
              Clicking any card expands a detail panel with: token ID, IP address, memory ID, project scope,
              the raw User-Agent string, the injected facts list, and a collapsible raw metadata block for
              advanced debugging.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Filtering & Search</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
              {[
                ["Text search", "Full-text filter across query strings, tool names, action names, and injected fact content. Case-insensitive."],
                ["Action filter", "Quick-filter buttons for: All, Recall, Commit, Update, Delete, Search, and JIT events."],
                ["Tool filter", "Dropdown to narrow events to a specific AI client — e.g. see only what Cursor recalled today."],
              ].map(([label, desc]) => (
                <div key={label as string} style={{ display: "flex", gap: 10, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "var(--text)", flexShrink: 0, minWidth: 110 }}>{label as string}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{desc as string}</span>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Stats Bar</h3>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
              The top of the page displays four key metrics computed from the filtered event list:
              <strong> Total Events</strong>, <strong>Recalls</strong>, <strong>Avg Results / Recall</strong>, and <strong>Top Tool</strong>.
              These update live as you apply filters, giving an at-a-glance summary of agent behavior patterns.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Similarity Score Colors</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
              {[
                { color: "#22c55e", label: "≥ 80%", desc: "High confidence match" },
                { color: "#f59e0b", label: "60–79%", desc: "Moderate match" },
                { color: "#ef4444", label: "< 60%", desc: "Low confidence — possible false positive" },
              ].map(({ color, label, desc }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, background: `${color}11`, border: `1px solid ${color}44`, borderRadius: 8, padding: "8px 14px" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: 12, color }}>{label}</span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{desc}</span>
                </div>
              ))}
            </div>

            <div style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, padding: 16 }}>
              <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                <span>💡</span> Debugging Tip
              </h4>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
                If your agent is generating incorrect or outdated code suggestions, open Activity, find the most recent <code>recall_context</code> event
                for that tool, and inspect the injected facts. If the returned facts are stale (old timestamps, wrong category, low score),
                update those memories in the <strong>Memories</strong> tab — the next recall will surface the corrected context.
              </p>
            </div>
          </div>
        );
      case "conflicts":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Conflict Resolution Hub</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              When AI agents propose updates that contradict existing memories — or when the same fact exists with different values across scopes — Locker surfaces these conflicts in the dedicated <strong>Conflicts Hub</strong>. Resolve disagreements with a single click before they cause agents to operate on inconsistent context.
            </p>

            <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 12, padding: 20, marginBottom: 28 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: "0 0 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
                <span>⚡</span> Why Conflicts Happen
              </h3>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
                Conflicts arise when an agent calls <code>commit_memory</code> with a fact that is semantically similar but factually different from an existing memory (e.g., both refer to a Node.js version but disagree on the value), or when <code>update_memory</code> proposes a change that Locker's contradiction detector scores above the conflict threshold. Rather than silently overwriting, Locker queues the conflict as an <strong>amber recommendation card</strong> and increments a navigation badge to alert you.
              </p>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Resolving a Conflict</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Open the Conflicts Hub", desc: "Navigate to Memories → Conflicts (or click the badge on the sidebar when conflicts are pending)." },
                { step: "2", title: "Review the Side-by-Side Diff", desc: "Each conflict card displays the current fact on the left and the proposed replacement on the right, color-coded for additions and removals." },
                { step: "3", title: "Choose the Authoritative Version", desc: "Click Keep Current to dismiss the agent's proposal and leave the memory unchanged, or click Accept Proposal to apply the agent's update and archive the old version." },
                { step: "4", title: "Edit Before Accepting (Optional)", desc: "Click the Edit icon to open the memory editor inline and manually merge the two versions before saving." },
                { step: "5", title: "Conflict Closed", desc: "The recommendation is marked resolved, the badge clears, and the vault is updated. The activity log records your decision with timestamp and actor." },
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div>
                    <strong style={{ display: "block", color: "var(--text)", fontSize: 13, marginBottom: 3 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.4 }}>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Conflict Card Types</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "#f59e0b", marginBottom: 8 }}>🟡 Amber — Contradiction</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>A new fact semantically contradicts an existing memory. The agent's proposed version is queued; the vault is unchanged until you decide.</p>
              </div>
              <div style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.25)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6", marginBottom: 8 }}>🔵 Blue — Update Proposal</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>An agent wants to refine an existing memory without a contradiction. Both facts are shown side-by-side so you can compare before approving.</p>
              </div>
              <div style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, color: "#ef4444", marginBottom: 8 }}>🔴 Red — Delete Request</h4>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>An agent is requesting deletion of a memory it believes is outdated. Approve to remove permanently or deny to keep it.</p>
              </div>
            </div>

            <div style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, padding: 16 }}>
              <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                <span>💡</span> Security Note
              </h4>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
                Agent tokens can never bypass the conflict queue by passing <code>confirm: true</code>. All destructive or contradicting proposals from agent tokens are queued regardless. Only human-token calls with valid passcode/TOTP can apply mutations directly.
              </p>
            </div>
          </div>
        );
      case "dlp-quarantine":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>DLP Quarantine Dashboard</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              The DLP Quarantine Dashboard (Admin &rarr; Quarantine) shows every memory flagged by the entropy-based Data Loss Prevention engine. Quarantined memories are stored encrypted but excluded from agent recall — they return <code>[REDACTED]</code> until an admin reviews and either releases or permanently deletes them.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Why Memories Get Quarantined</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 28 }}>
              {[
                { icon: "🔑", title: "High-Entropy Secrets", desc: "Values scoring ≥ 4.0 bits/char in secret-looking key-value contexts: API keys, tokens, passwords, and base64-encoded blobs." },
                { icon: "🏦", title: "Structural Credential Patterns", desc: "Unmistakable formats detected unconditionally regardless of entropy: AWS keys (AKIA…), GitHub PATs (ghp_…), Stripe keys (sk_live_…), PEM blocks, and database URIs." },
                { icon: "👤", title: "PII Detection", desc: "Email addresses, phone numbers, credit card numbers (Luhn-validated), and Social Security Numbers detected by dedicated regex scanners." },
                { icon: "🤖", title: "AI Adversarial Content", desc: "Content flagged by sanitizeMemoryAsync as containing prompt-injection instructions, jailbreak attempts, or instruction-override payloads." },
              ].map(({ icon, title, desc }) => (
                <div key={title} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                  <div style={{ fontSize: 18, marginBottom: 8 }}>{icon}</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{desc}</div>
                </div>
              ))}
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Quarantine Review Workflow</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
              {[
                { step: "1", title: "Open Quarantine Dashboard", desc: "Navigate to Admin → Quarantine. All quarantined memories are listed with the flagged reason, detection type (entropy/structural/PII/AI), and timestamp." },
                { step: "2", title: "Inspect the Flagged Content", desc: "Click Unmask to decrypt and view the raw fact content (admin-only). This does not release the memory — it only reveals it for review purposes." },
                { step: "3", title: "Release or Delete", desc: "If the memory is safe (false positive), click Release to un-quarantine and make it available to agents again. If it's a genuine secret, click Permanently Delete." },
                { step: "4", title: "Audit Trail", desc: "Every quarantine decision (release, delete, view) is logged with admin identity, timestamp, and the original flagged reason." },
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <div>
                    <strong style={{ display: "block", color: "var(--text)", fontSize: 13, marginBottom: 3 }}>{s.title}</strong>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.4 }}>{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 12, padding: 16 }}>
              <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
                <span>⚠️</span> Agent Behavior During Quarantine
              </h4>
              <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
                While a memory is quarantined, any <code>recall_context</code> or <code>search_memories</code> call returns a <code>[REDACTED — pending DLP review]</code> placeholder with the memory ID. The agent is aware a fact exists but cannot read it, allowing workflows to continue without exposing sensitive data. The memory's vector embeddings are temporarily excluded from Vectorize queries.
              </p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

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
        .docs-content ul {
          list-style-type: disc !important;
        }
        .docs-content ol {
          list-style-type: decimal !important;
        }
        .docs-content li {
          display: list-item !important;
          margin-bottom: 8px !important;
          line-height: 1.6 !important;
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
        .docs-content {
          max-width: 800px;
          margin: 0 auto;
        }
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
        .sidebar-button:hover {
          background: var(--accent-dim);
          color: var(--text);
        }
        .sidebar-button.active {
          background: var(--accent-dim);
          border: 1px solid rgba(168,85,247,0.25);
          color: var(--accent-hover);
          font-weight: 600;
        }
        .sidebar-search {
          width: 100%;
          padding: 8px 10px 8px 28px;
          font-size: 12px;
          background: var(--surface2);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text);
        }
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (max-width: 840px) {
          .docs-layout {
            flex-direction: column;
          }
          .docs-sidebar {
            display: none;
          }
          .docs-mobile-nav {
            display: block;
          }
          .docs-content-wrapper {
            padding: 24px 16px;
            height: auto;
            overflow-y: visible;
          }
        }
      `}</style>

      {/* Mobile nav dropdown */}
      <div className="docs-mobile-nav">
        <select
          className="docs-mobile-select"
          value={activeSection}
          onChange={(e) => setActiveSection(e.target.value)}
          aria-label="Documentation Navigation"
        >
          <optgroup label="Getting Started">
            <option value="overview">Overview</option>
            <option value="connection-auth">Connection & Auth</option>
            <option value="security-privacy">Security & Privacy</option>
          </optgroup>
          <optgroup label="Features">
            <option value="managing-memories">Managing Memories</option>
            <option value="import-memories">Importing &amp; Migrating</option>
            <option value="team-collaboration">Team Collaboration</option>
            <option value="stack-creator">Tech Stack Creator</option>
            <option value="templates">Blueprint Templates</option>
            <option value="export-rules">Exporting Agent Rules</option>
            <option value="agent-activity">Agent Activity</option>
            <option value="conflicts">Conflict Resolution</option>
          </optgroup>
          <optgroup label="Webhook Integrations">
            <option value="webhooks">Webhook Overview</option>
            <option value="webhooks-github">GitHub</option>
            <option value="webhooks-linear">Linear</option>
            <option value="webhooks-slack-jit">Slack</option>
          </optgroup>
          <optgroup label="MCP Reference">
            <option value="mcp-about">About MCP</option>
            <option value="mcp-tools-retrieval">Context Retrieval</option>
            <option value="mcp-tools-mutation">Memory Mutation</option>
            <option value="mcp-tools-sync">Workspace Sync</option>
            <option value="mcp-tools-credentials">Credential Vault</option>
            <option value="mcp-errors-security">Errors & Security</option>
          </optgroup>
          <optgroup label="Connecting Clients">
            <option value="connect-oauth">OAuth / Account-Based</option>
            <option value="connect-manual">Manual / Token-Based</option>
          </optgroup>
          <optgroup label="Diagnostics">
            <option value="tester">Connection Tester</option>
            <option value="dlp-quarantine">DLP Quarantine Dashboard</option>
          </optgroup>
        </select>
      </div>

      <div className="docs-layout">
        {/* Sidebar on desktop */}
        <aside className="docs-sidebar">
          <div>
            <div>
              <div className="sidebar-section-title">Getting Started</div>
              <button onClick={() => setActiveSection("overview")} className={`sidebar-button ${activeSection === "overview" ? "active" : ""}`}>
                <span>📖</span> Overview
              </button>
              <button onClick={() => setActiveSection("connection-auth")} className={`sidebar-button ${activeSection === "connection-auth" ? "active" : ""}`}>
                <span>🔑</span> Connection & Auth
              </button>
              <button onClick={() => setActiveSection("security-privacy")} className={`sidebar-button ${activeSection === "security-privacy" ? "active" : ""}`}>
                <span>🔒</span> Security & Privacy
              </button>
            </div>

            <div>
              <div className="sidebar-section-title">Features</div>
              <button onClick={() => setActiveSection("managing-memories")} className={`sidebar-button ${activeSection === "managing-memories" ? "active" : ""}`}>
                <span>🧠</span> Managing Memories
              </button>
              <button onClick={() => setActiveSection("import-memories")} className={`sidebar-button ${activeSection === "import-memories" ? "active" : ""}`}>
                <span>📥</span> Importing & Migrating
              </button>
              <button onClick={() => setActiveSection("team-collaboration")} className={`sidebar-button ${activeSection === "team-collaboration" ? "active" : ""}`}>
                <span>👥</span> Team Collaboration
              </button>
              <button onClick={() => setActiveSection("stack-creator")} className={`sidebar-button ${activeSection === "stack-creator" ? "active" : ""}`}>
                <span>🛠️</span> Tech Stack Creator
              </button>
              <button onClick={() => setActiveSection("templates")} className={`sidebar-button ${activeSection === "templates" ? "active" : ""}`}>
                <span>📋</span> Blueprint Templates
              </button>
              <button onClick={() => setActiveSection("export-rules")} className={`sidebar-button ${activeSection === "export-rules" ? "active" : ""}`}>
                <span>💾</span> Exporting Agent Rules
              </button>
              <button onClick={() => setActiveSection("agent-activity")} className={`sidebar-button ${activeSection === "agent-activity" ? "active" : ""}`}>
                <span>◎</span> Agent Activity
              </button>
              <button onClick={() => setActiveSection("conflicts")} className={`sidebar-button ${activeSection === "conflicts" ? "active" : ""}`}>
                <span>⚡</span> Conflict Resolution
              </button>
            </div>

            <div>
              <div className="sidebar-section-title">Webhook Integrations</div>
              <button onClick={() => setActiveSection("webhooks")} className={`sidebar-button ${activeSection === "webhooks" ? "active" : ""}`}>
                <span>🔗</span> Webhook Overview
              </button>
              <button onClick={() => setActiveSection("webhooks-github")} className={`sidebar-button ${activeSection === "webhooks-github" ? "active" : ""}`}>
                <span>🐙</span> GitHub
              </button>
              <button onClick={() => setActiveSection("webhooks-linear")} className={`sidebar-button ${activeSection === "webhooks-linear" ? "active" : ""}`}>
                <span>◆</span> Linear
              </button>
              <button onClick={() => setActiveSection("webhooks-slack-jit")} className={`sidebar-button ${activeSection === "webhooks-slack-jit" ? "active" : ""}`}>
                <span>💬</span> Slack
              </button>
            </div>

            <div>
              <div className="sidebar-section-title">MCP Reference</div>
              <button onClick={() => setActiveSection("mcp-about")} className={`sidebar-button ${activeSection === "mcp-about" ? "active" : ""}`}>
                <span>💡</span> About MCP
              </button>
              <button onClick={() => setActiveSection("mcp-tools-retrieval")} className={`sidebar-button ${activeSection === "mcp-tools-retrieval" ? "active" : ""}`}>
                <span>🔍</span> Context Retrieval
              </button>
              <button onClick={() => setActiveSection("mcp-tools-mutation")} className={`sidebar-button ${activeSection === "mcp-tools-mutation" ? "active" : ""}`}>
                <span>✍️</span> Memory Mutation
              </button>
              <button onClick={() => setActiveSection("mcp-tools-sync")} className={`sidebar-button ${activeSection === "mcp-tools-sync" ? "active" : ""}`}>
                <span>🔄</span> Agent Syncing
              </button>
              <button onClick={() => setActiveSection("mcp-tools-credentials")} className={`sidebar-button ${activeSection === "mcp-tools-credentials" ? "active" : ""}`}>
                <span>🔐</span> Credential Vault
              </button>
              <button onClick={() => setActiveSection("mcp-errors-security")} className={`sidebar-button ${activeSection === "mcp-errors-security" ? "active" : ""}`}>
                <span>⚠️</span> Errors & Security
              </button>
            </div>

            <div>
              <div className="sidebar-section-title">Connecting Clients</div>
              <button onClick={() => setActiveSection("connect-oauth")} className={`sidebar-button ${activeSection === "connect-oauth" ? "active" : ""}`}>
                <span>🔐</span> OAuth / Account-Based
              </button>
              <button onClick={() => setActiveSection("connect-manual")} className={`sidebar-button ${activeSection === "connect-manual" ? "active" : ""}`}>
                <span>🔧</span> Manual / Token-Based
              </button>
            </div>

            <div>
              <div className="sidebar-section-title">Diagnostics</div>
              <button onClick={() => setActiveSection("tester")} className={`sidebar-button ${activeSection === "tester" ? "active" : ""}`}>
                <span>🔌</span> Connection Tester
              </button>
              <button onClick={() => setActiveSection("dlp-quarantine")} className={`sidebar-button ${activeSection === "dlp-quarantine" ? "active" : ""}`}>
                <span>🔍</span> DLP Quarantine
              </button>
            </div>
          </div>
        </aside>

        {/* Content panel */}
        <main className="docs-content-wrapper">
          <article className="docs-content">
            {renderContent()}
          </article>
        </main>
      </div>
    </div>
  );
}
