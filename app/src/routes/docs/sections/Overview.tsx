import type { SectionProps } from "../types";


export default function Overview({ setActiveSection }: SectionProps) {
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
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>GraphRAG Hybrid Retrieval</h3>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              <li style={{ marginBottom: 6 }}><strong>RRF Fusion:</strong> Merges semantic (bge-m3), keyword overlap, and recency decay (half-life ≈ 139 days) via Reciprocal Rank Fusion (k=60).</li>
              <li style={{ marginBottom: 6 }}><strong>Graph Expansion:</strong> Workers AI extracts entities and edges at write time, retrieving related items automatically.</li>
              <li style={{ marginBottom: 6 }}><strong>Llama Reranking:</strong> Decrypts top 20 candidates and reranks via Llama-3.3-70B for maximum relevance.</li>
              <li><strong>Prompt Synthesis:</strong> Set <code>optimize: true</code> to synthesize matched context into a compact system-prompt list.</li>
            </ul>
          </div>
        </div>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 18 }}>🔒</span>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", margin: 0 }}>End-to-End Encrypted</h3>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
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
        {[
          {
            icon: "🧠",
            title: "Memory Ingestion & GraphRAG Enrichment",
            body: "Create, update, and manage long-term facts through the visual dashboard or via connected LLMs using MCP. Every new fact is automatically enriched by Workers AI: named entity nodes and directed relationship edges are extracted into memory_graph_nodes / memory_graph_edges, building a knowledge graph that powers multi-hop recall.",
            links: [
              { label: "Manage Memories Guide →", id: "managing-memories" },
              { label: "Import & Ingestion Guide →", id: "import-memories" },
            ],
          },
          {
            icon: "🛠️",
            title: "Tech Stack Blueprinting",
            body: "Build custom constraints across 12 technology stack categories (Languages, Frameworks, DBs, ORMs, styling strategy) using the Stack Creator wizard. Save standard profiles as reusable templates to skip regenerations and maintain consistency.",
            links: [
              { label: "Tech Stack Creator Guide →", id: "stack-creator" },
              { label: "Blueprint Templates Guide →", id: "templates" },
            ],
          },
          {
            icon: "💾",
            title: "Multi-Agent Rule Compilation",
            body: "Translate stored technical guidelines into formatted instructions for specific AI developer agents. Download CLAUDE.md, .cursorrules, copilot-instructions.md, GEMINI.md, AGENTS.md, and .agents/rules/rules.md from the UI. Synchronize files automatically inside local project directories via MCP or the locker-sync CLI.",
            links: [{ label: "Rules Exporting & Sync Guide →", id: "export-rules" }],
          },
          {
            icon: "👥",
            title: "Team Governance & Security",
            body: "Leverage Organization settings to govern billing seats, isolate sub-teams, and restrict scoped memories to specific project workspace keys. Locker enforces ephemeral V8 Workers sandboxing, entropy-based DLP quarantine checks, PBKDF2-hardened token hashing, and Attribute-Based Access Control (ABAC) for autonomous agent tokens.",
            links: [
              { label: "Team Collaboration Guide →", id: "team-collaboration" },
              { label: "Security Architecture & Pillars →", id: "security-privacy" },
            ],
          },
          {
            icon: "◎",
            title: "Agent Activity Dashboard",
            body: "Visualize every memory operation your AI tools perform. The timeline maps each recall_context event to the exact client (Cursor, Claude Desktop, Windsurf…), the semantic similarity scores of returned memories, and the facts injected into the model's context — so you can debug AI hallucinations caused by stale or missing context in seconds.",
            links: [{ label: "Agent Activity Dashboard Guide →", id: "agent-activity" }],
          },
          {
            icon: "⏰",
            title: "Stale Memory Review",
            body: "Memories that have not been accessed for an extended period surface a staleness indicator and appear in a dedicated banner on the Memories dashboard. Use the Stale sort filter to review, refresh, or archive aging context before it misleads your agents.",
            links: [{ label: "Managing Memories Guide →", id: "managing-memories" }],
          },
          {
            icon: "⚡",
            title: "Memory Conflict Resolution",
            body: 'When agents detect contradicting facts (e.g. "Use Node 18" vs. "Use Node 20"), a navigation badge alerts you to the Conflicts Hub where you can review side-by-side diffs, choose the authoritative version, and close the recommendation with a single click.',
            links: [{ label: "Conflict Resolution Hub →", id: "conflicts" }],
          },
        ].map((item) => (
          <div key={item.title} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
            <h4 style={{ margin: "0 0 6px 0", fontSize: 14, fontWeight: 700, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
              <span>{item.icon}</span> {item.title}
            </h4>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px 0", lineHeight: 1.6 }}>{item.body}</p>
            <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
              {item.links.map((link, i) => (
                <span key={link.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {i > 0 && <span style={{ color: "var(--border)" }}>|</span>}
                  <button onClick={() => setActiveSection(link.id)} style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontWeight: 600 }}>
                    {link.label}
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16, marginTop: 16 }}>
        <div style={{ background: "rgba(168, 85, 247, 0.04)", border: "1px solid rgba(168, 85, 247, 0.15)", borderRadius: 12, padding: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            🛡️ Core Security Model
          </h3>
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              <li style={{ marginBottom: 6 }}><strong>Envelope Cryptography:</strong> AES-256-GCM with wrapped per-vault DEKs. Plaintext never reaches storage.</li>
              <li style={{ marginBottom: 6 }}><strong>GraphRAG Privacy:</strong> Entity extraction runs ephemerally before encryption; D1 stores only ciphertext and graph structure.</li>
              <li style={{ marginBottom: 6 }}><strong>DLP Quarantine:</strong> High-entropy secrets and credential formats are flagged at write time, returning <code>[REDACTED]</code> to agents.</li>
              <li style={{ marginBottom: 6 }}><strong>AI Sanitization:</strong> Every write passes through <code>sanitizeMemoryAsync</code> (Workers AI) to detect adversarial prompt-injection content before storage.</li>
              <li style={{ marginBottom: 6 }}><strong>Least-Privilege ABAC:</strong> Agent policies restrict operations by category (rules, projects, references, stack) and tag filters.</li>
              <li style={{ marginBottom: 6 }}><strong>JIT Approvals:</strong> Memories tagged <code>#confidential</code> trigger an approval gate, releasing temporary access only on human sign-off.</li>
              <li><strong>Token Hardening:</strong> API and JIT tokens are hashed with PBKDF2-HMAC-SHA256 at 100,000 iterations.</li>
            </ul>
          </div>
        </div>
        <div style={{ background: "rgba(59, 130, 246, 0.04)", border: "1px solid rgba(59, 130, 246, 0.15)", borderRadius: 12, padding: 18 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            🤖 AI & LLM Integration
          </h3>
          <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              <li style={{ marginBottom: 6 }}><strong>Semantic Vectors:</strong> Vectorizes facts via <code>@cf/baai/bge-m3</code> embeddings to power similarity-based context queries.</li>
              <li style={{ marginBottom: 6 }}><strong>GraphRAG Extraction:</strong> Runs Workers AI ephemerally on write to extract entity nodes and semantic relationship edges.</li>
              <li style={{ marginBottom: 6 }}><strong>Llama Reranking:</strong> Reranks top candidates via a Llama-3.3-70B cross-encoder in the retrieval path.</li>
              <li style={{ marginBottom: 6 }}><strong>Prompt Synthesis:</strong> Compresses facts into a single dense prompt via Llama-3-8B when <code>optimize: true</code> is passed.</li>
              <li style={{ marginBottom: 6 }}><strong>Text Chunking:</strong> Long facts are automatically split into overlapping semantic chunks before vectorization, enabling sub-fact retrieval precision.</li>
              <li><strong>AI Import Ingestion:</strong> Automatically tags, deduplicates, and structures external chatbot console imports via LLM.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
