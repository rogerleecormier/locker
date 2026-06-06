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
                    <li style={{ marginBottom: 6 }}><strong>Semantic Vectors:</strong> Vectorizes facts via <code>@cf/baai/bge-m3</code> embeddings to power similarity-based context queries.</li>
                    <li style={{ marginBottom: 6 }}><strong>GraphRAG Extraction:</strong> Runs Workers AI ephemerally on write to extract entity nodes and semantic relationship edges.</li>
                    <li style={{ marginBottom: 6 }}><strong>Llama Reranking:</strong> Reranks top candidates via a Llama-3.3-70B cross-encoder in the browser session path.</li>
                    <li style={{ marginBottom: 6 }}><strong>Prompt Synthesis:</strong> Compresses facts into a single dense prompt via Llama-3-8B when <code>optimize: true</code> is passed.</li>
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
                  <li><strong>Quarantine & Review Lifecycle:</strong> DLP runs during <code>commit_memory</code> and <code>update_memory</code>. If sensitive data is found, the memory is quarantined. AI agents and MCP requests receive a secure <code>[REDACTED]</code> placeholder in transit. Owners and admins can explicitly review, verify, and unmask/release the memory from quarantine in the Memories Dashboard.</li>
                </ul>
              </div>

              {/* Card 8: Auth & Session Hardening */}
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>⚡</span>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", margin: 0 }}>Auth Hardening & Request Isolation</h3>
                </div>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  The authentication layer is designed to eliminate race conditions and minimize database exposure under load:
                </p>
                <ul style={{ paddingLeft: 18, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.7, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                  <li><strong>One-Time OAuth Bootstrap:</strong> OAuth client provisioning runs at most once per worker isolate lifetime rather than on every request, eliminating D1 write storms and race conditions under concurrent load.</li>
                  <li><strong>Isolate-Scoped Auth Cache:</strong> Authenticated session configurations are cached at the worker isolate level with a 5-minute TTL, reducing redundant D1 reads without holding stale credentials beyond the cache window.</li>
                  <li><strong>Read-Only Request Path:</strong> The per-request authentication path performs no writes to the database, ensuring that high-traffic periods cannot cause connection exhaustion or lock contention on auth tables.</li>
                </ul>
              </div>

              {/* Card 9: Zod Server-Function Validation */}
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
              Migrating your personal context, rules, and inferred preferences from existing platforms is a simple two-step process in Locker. Use our custom extraction prompts for major LLMs and batch ingest them using our AI parsing tool.
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Migration Workflow</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
              {[
                { step: "1", text: "Open the Import tab in the top navigation bar." },
                { step: "2", text: "Select your source platform (ChatGPT, Claude, Perplexity, Gemini, Grok, or Microsoft Copilot)." },
                { step: "3", text: "Locker displays a custom prompt tailored to extract that chatbot's internal memory store. Click Copy Prompt." },
                { step: "4", text: "Paste the prompt into your chat session with that LLM. The AI will output all its saved memories and inferred preferences in a structured JSON/markdown code block." },
                { step: "5", text: "Paste the output code block into the Locker import panel and select a project workspace scope." },
                { step: "6", text: "Click Parse with AI. Locker will automatically deduplicate, categorize (rules, projects, or references), and tag the raw dump." },
                { step: "7", text: "Verify the parsed facts on screen and click Batch Import Memories to encrypt and save them." }
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

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Supported Platforms</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🤖 ChatGPT & Claude</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Extracts both explicit saved memory slots, custom system instructions, and implicit behavioral inferences.</p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>🔍 Perplexity & Gemini</h4>
                <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Pulls details from Perplexity personalization slots and Gemini "Saved Info" panels verbatim.</p>
              </div>
            </div>
          </div>
        );
      case "team-collaboration":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Team Collaboration</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Establish shared coding standards and stack specifications for your entire development team. Group members, assign roles, and connect shared workspace keys to eliminate drift across local developer environments.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)", margin: "0 0 8px 0" }}>🏢 Organizations</h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Billing hubs that manage member seat allocations, subscription quotas, and general workspace keys. Enforces strict administrative boundaries.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--accent)", margin: "0 0 8px 0" }}>👥 Teams</h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Granular sub-groups (e.g. <code>frontend-team</code>, <code>devops-team</code>). Restrict memory blocks or project scopes to specific teams so developers only receive relevant context.
                </p>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>User Roles & Governance</h3>
            <div style={{ 
              border: "1px solid var(--border)", 
              borderRadius: 12, 
              overflow: "hidden", 
              background: "var(--surface2)", 
              marginBottom: 32,
              width: "100%",
              overflowX: "auto"
            }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, textAlign: "left", minWidth: 500 }}>
                <thead>
                  <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Role</th>
                    <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700 }}>Permissions & Access Boundaries</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontWeight: "bold", color: "var(--accent)" }}>Owner</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.5 }}>Full billing control, seat upgrades, organization deletion, role modification, and member pruning.</td>
                  </tr>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "14px 16px", fontWeight: "bold", color: "var(--accent)" }}>Admin</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.5 }}>Create teams, issue email invitations, delete/update shared organization memories, and edit general team lists.</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "14px 16px", fontWeight: "bold", color: "var(--text)" }}>Member</td>
                    <td style={{ padding: "14px 16px", color: "var(--text-muted)", lineHeight: 1.5 }}>Read-only access or read-write access to specific scoped memory cards based on team memberships.</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{ background: "rgba(168, 85, 247, 0.04)", border: "1px solid rgba(168, 85, 247, 0.15)", borderRadius: 12, padding: 18 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                📩 Inviting Members
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                Owners and Admins can invite new developers from the <strong>Organization</strong> view by typing their email. Locker generates a cryptographically signed magic link valid for 48 hours and sends an invitation email using Cloudflare's built-in Email Worker bindings.
              </p>
            </div>
          </div>
        );
      case "managing-memories":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Managing Memories</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Locker provides a flexible interface for managing your long-term memory vault. Memories can be created, updated, and purged either through the browser-based dashboard or directly by connected AI developer tools using Model Context Protocol (MCP).
            </p>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Managing Memories in the UI</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginBottom: 32 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                <strong style={{ display: "block", color: "var(--text)", marginBottom: 4 }}>🧠 Creating Memories</strong>
                <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Click the <strong>New Memory</strong> button at the top right of the dashboard. Select a Category (Rules, Projects, or References), write the Fact text, add custom tags, and optionally associate it with a specific <strong>Project Workspace</strong> key to isolate instructions.
                </span>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                <strong style={{ display: "block", color: "var(--text)", marginBottom: 4 }}>✏️ Editing & Deleting</strong>
                <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  Click the edit (pencil) icon on any memory card to modify its fields, or the delete icon to remove it. Locker automatically updates the underlying SQL database and recalculates the semantic embeddings on Cloudflare Vectorize.
                </span>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                <strong style={{ display: "block", color: "var(--text)", marginBottom: 4 }}>🚦 Vault Actions Pending Approval</strong>
                <span style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  All agent-initiated destructive operations are held in an approval queue. This covers three cases: agent <code>update_memory</code> calls (blue cards showing the proposed new fact vs. the current fact), agent <code>delete_memory</code> calls (red cards), and newly proposed facts that contradict existing memories (amber cards). You must log in and click <strong>Approve</strong> to apply the action, or <strong>Deny</strong> to discard it. No change reaches the vault until you explicitly approve.
                </span>
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Programmatic Management via MCP</h3>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
              Locker exposes secure endpoints for AI models to retrieve and mutate memories in real time. Connected developer agents utilize these JSON-RPC commands behind the scenes:
            </p>
            <ul style={{ paddingLeft: 20, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8, marginBottom: 24, display: "flex", flexDirection: "column", gap: 6 }}>
              <li><strong>Reading Context:</strong> Models call <button onClick={() => setActiveSection("mcp-tools-retrieval")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>recall_context</button> for hybrid RRF matches, and <button onClick={() => setActiveSection("mcp-tools-retrieval")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>search_memories</button> for exact tag/keyword scans.</li>
              <li><strong>Mutating Store:</strong> Models use <button onClick={() => setActiveSection("mcp-tools-mutation")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>commit_memory</button> to suggest facts, <button onClick={() => setActiveSection("mcp-tools-mutation")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>update_memory</button> to refine facts, and <button onClick={() => setActiveSection("mcp-tools-mutation")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>delete_memory</button> to remove stale data.</li>
              <li><strong>Credential Vault:</strong> Models use <button onClick={() => setActiveSection("mcp-tools-credentials")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>store_credential</button>, <button onClick={() => setActiveSection("mcp-tools-credentials")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>retrieve_credential</button>, and <button onClick={() => setActiveSection("mcp-tools-credentials")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>delete_credential</button> to manage encrypted secrets. Requires <code>allowCredentials: true</code> on agent tokens.</li>
            </ul>
            <div style={{
              background: "rgba(168, 85, 247, 0.04)",
              border: "1px solid rgba(168, 85, 247, 0.15)",
              borderRadius: 12,
              padding: "16px",
              fontSize: 13,
              color: "var(--text-muted)",
              lineHeight: 1.6,
            }}>
              <strong>💡 Developer Tip:</strong> For more detailed input schemas, required parameters, and configuration guides for all management tools, head over to the full <button onClick={() => setActiveSection("mcp-tools-retrieval")} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", fontWeight: "bold", textDecoration: "underline", padding: 0, font: "inherit" }}>MCP Tools Reference List</button>.
            </div>
          </div>
        );
      case "stack-creator":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Tech Stack Creator</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              The <strong>Tech Stack Creator</strong> is an interactive step-by-step wizard that allows you to define your workspace's technology profile across 12 architectural categories. Locker utilizes this profile to automatically compile optimized coding rules and agentic instructions.
            </p>

            <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 16, padding: 22, marginBottom: 28 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                🛠️ 12 Technology Categories
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                Locker segments your stack into modular categories. In the UI, these are displayed as easy-to-use option tags:
              </p>
              
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[
                  { key: "Language", val: "TypeScript, Go, Python, Rust" },
                  { key: "Runtime", val: "Node.js, Bun, Native Runtimes" },
                  { key: "Frontend", val: "React, Next.js, Vue, Svelte" },
                  { key: "Backend", val: "Express, Hono, Django, FastAPI" },
                  { key: "Database", val: "Cloudflare D1, PG, SQLite, MySQL" },
                  { key: "ORM Client", val: "Drizzle, Prisma, sqlx, pg" },
                  { key: "Deploy Platform", val: "Workers, Vercel, Fly.io, AWS" },
                  { key: "Styling", val: "Tailwind, Vanilla CSS, Styled-Components" },
                  { key: "Lint & Format", val: "ESLint, Prettier, Biome, Ruff" },
                  { key: "Test Runner", val: "Vitest, Jest, Playwright" },
                  { key: "State Manage", val: "Zustand, Redux, Jotai" },
                  { key: "Build Tool", val: "Vite, Webpack, Esbuild" }
                ].map((c) => (
                  <div key={c.key} style={{
                    fontSize: 11,
                    padding: "6px 12px",
                    borderRadius: 20,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    color: "var(--text)",
                    display: "flex",
                    gap: 6,
                    alignItems: "center"
                  }}>
                    <strong style={{ color: "var(--accent)" }}>{c.key}:</strong>
                    <span style={{ color: "var(--text-muted)" }}>{c.val}</span>
                  </div>
                ))}
              </div>
            </div>

            <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 16 }}>Workflow Steps</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { step: "1", text: "Navigate to the Vault page and click the New Memory button." },
                { step: "2", text: "Select Tech Stack Creator to launch the step-by-step wizard." },
                { step: "3", text: "Provide your selections for each of the 12 tech stack categories." },
                { step: "4", text: "Input any custom negative constraints (e.g., 'no Tailwind inline utilities' or 'do not write raw SQL queries outside repos')." },
                { step: "5", text: "Click Review Recommended Blueprint to compile rules tailored to your choices. Adjust individual guidelines before saving." },
                { step: "6", text: "Click Store Memory to save these rules globally or to a specific project scope. The constraints are instantly synced without exposing database structures to local clients." }
              ].map((s) => (
                <div key={s.step} style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, flexShrink: 0,
                    border: "1px solid rgba(168,85,247,0.2)"
                  }}>{s.step}</div>
                  <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        );
      case "templates":
        return (
          <div>
            <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>Blueprint Templates</h2>
            <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 20 }}>
              Blueprint Templates enable teams and individual developers to save, edit, and share standard configuration profiles. Instead of selecting the same 12 categories repeatedly, you can load templates directly to populate your rules baseline instantly.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginBottom: 28 }}>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  💾 Creating Templates
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  Go to the <strong>Templates</strong> view and click <strong>New Template</strong>. Set up the stack selections, custom constraints, and rule lists. Save to add the template to your database.
                </p>
              </div>
              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                  ⚡ Instant Loading
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                  In the Stack Creator wizard, click <strong>Load Custom Stack Blueprints</strong> to choose a template. The selections, constraints, and recommendations load instantly.
                </p>
              </div>
            </div>

            <div style={{ background: "rgba(168, 85, 247, 0.04)", border: "1px solid rgba(168, 85, 247, 0.15)", borderRadius: 12, padding: 18 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                🚀 Bypassing LLM Regeneration
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                If a template already has verified instruction sets, Locker displays a <strong>"Use Loaded Template Rules"</strong> button. Clicking this skips LLM regeneration completely and sends you directly to the review step, reducing token overhead and conserving processing time.
              </p>
            </div>
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

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
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
                  <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 6px 0", fontWeight: 700 }}>🔗 Pre-commit Hook (.git/hooks/pre-commit)</p>
                  <pre style={{ background: "transparent", border: "none", padding: 0, margin: 0, fontFamily: "monospace", fontSize: 11, color: "var(--text-muted)", overflowX: "auto" }}>{`#!/bin/sh
npx locker-sync sync --format cursor --project my-project`}</pre>
                </div>
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
                <h4 style={{ margin: "0 0 8px 0", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>⚡ Method C: MCP Tool (Agent-Initiated)</h4>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 0 10px 0", lineHeight: 1.6 }}>
                  AI developer agents connected via MCP can call Locker's native sync tool to build and write rules files directly inside your active workspace without manual downloads.
                </p>
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
  "name": "sync_workspace_agent_configs",
  "arguments": {
    "formatType": "claude", // or cursor, copilot, gemini, agents, antigravity
    "projectKey": "locker"
  }
}`}</pre>
              </div>
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
                  The <strong>locker-sync</strong> CLI is the recommended developer workflow. It wraps this MCP tool in a zero-install command that resolves your API token, calls <code>sync_workspace_agent_configs</code>, and writes the rules file to disk — all in one step. Perfect for pre-commit hooks.
                </p>
                <pre style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: 10, margin: 0, fontFamily: "monospace", fontSize: 11, color: "var(--text)", overflowX: "auto" }}>{`# Sync .cursorrules (recommended for developers)
npx locker-sync sync --format cursor --project my-project

# All formats: cursor | claude | copilot | gemini | agents | antigravity
npx locker-sync sync --format claude --dry-run`}</pre>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {ALL_TOOLS.filter((t) =>
                ["sync_workspace_agent_configs"].includes(t.name)
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
          <optgroup label="Features & Workflows">
            <option value="managing-memories">Managing Memories</option>
            <option value="import-memories">Importing & Migrating</option>
            <option value="team-collaboration">Team Collaboration</option>
            <option value="stack-creator">Tech Stack Creator</option>
            <option value="templates">Blueprint Templates</option>
            <option value="export-rules">Exporting Agent Rules</option>
          </optgroup>
          <optgroup label="MCP Reference">
            <option value="mcp-about">About MCP</option>
            <option value="mcp-tools-retrieval">Context Retrieval</option>
            <option value="mcp-tools-mutation">Memory Mutation</option>
            <option value="mcp-tools-sync">Workspace Sync</option>
            <option value="mcp-tools-credentials">Credential Vault</option>
            <option value="mcp-errors-security">Errors & Security</option>
          </optgroup>
          <optgroup label="Client Integrations">
            <option value="connect-oauth">OAuth / Account-Based</option>
            <option value="connect-manual">Manual / Token-Based</option>
          </optgroup>
          <optgroup label="Diagnostics">
            <option value="tester">Connection Tester</option>
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
              <div className="sidebar-section-title">Features & Workflows</div>
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
              <div className="sidebar-section-title">Client Integrations</div>
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
