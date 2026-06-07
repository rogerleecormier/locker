import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PLANS, SELF_SERVE_PLAN_ORDER } from "~/lib/plans";
import { PlanCard } from "~/components/PaywallGate";
import { LockerPadlock } from "~/components/LockerLogo";
import { FadeIn, Counter } from "~/components/landing/LandingAnimations";
import { Section, SectionLabel, FeatureCard, Step } from "~/components/landing/LandingPrimitives";
import { HeroStackCreatorMockup, MemoryTemplatesMockup, ReviewQueueMockup, McpCallMockup, TokenMockup, EncryptionMockup } from "~/components/landing/LandingMockups";
import { PlatformScroller } from "~/components/landing/PlatformScroller";
import { PlaygroundCard } from "~/components/landing/PlaygroundCard";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

// ── Main landing page ─────────────────────────────────────────────────────────
function LandingPage() {
  const navigate = useNavigate();
  const [heroVisible, setHeroVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setHeroVisible(true), 60); return () => clearTimeout(t); }, []);

  return (
    <div style={{ overflowX: "hidden" }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes shimmer { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
        @keyframes spin-slow { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
      `}</style>

      {/* ── HERO ── */}
      <div style={{ position: "relative", padding: "100px 24px 80px", textAlign: "center", overflow: "hidden" }}>
        {/* radial glow */}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-60%)", width: 700, height: 700, borderRadius: "50%", background: "radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative", maxWidth: 720, margin: "0 auto" }}>
          {/* lock icon animated */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, background: "var(--accent-dim)", border: "1px solid rgba(168,85,247,0.35)", display: "flex", alignItems: "center", justifyContent: "center", animation: "float 4s ease-in-out infinite", opacity: heroVisible ? 1 : 0, transition: "opacity 0.6s ease" }}>
              <LockerPadlock size={28} />
            </div>
          </div>

          <div style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? "none" : "translateY(24px)", transition: "opacity 0.7s ease 0.1s, transform 0.7s ease 0.1s" }}>
            <h1 style={{ fontSize: "clamp(36px, 6vw, 60px)", fontWeight: 800, letterSpacing: "-0.04em", color: "var(--text)", lineHeight: 1.1, marginBottom: 20 }}>
              The Context & Rule Engine for{" "}
              <span style={{ color: "var(--accent)" }}>AI-Native Engineering</span>
            </h1>
            <p style={{ fontSize: 18, color: "var(--text-muted)", lineHeight: 1.7, maxWidth: 640, margin: "0 auto 36px", fontWeight: 400 }}>
              Standardize developer tribal knowledge, enforce architectural standards, and sync agent config files across your team. Run <code style={{ fontFamily: "monospace", fontSize: 15, color: "var(--accent)" }}>npx locker-sync sync</code> before opening your IDE — or wire it into your pre-commit hook.
            </p>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link to="/memories" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 28px", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 14, borderRadius: 10, textDecoration: "none", transition: "background 0.15s, transform 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>
                Launch Console
              </Link>
              <Link to="/docs" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", background: "transparent", color: "var(--text-muted)", fontWeight: 600, fontSize: 14, borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", transition: "border-color 0.15s, color 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
              >
                Connect AI Agent →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── STATS ── */}
      <div style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0 }}>
          {[
            { value: 20, suffix: "+", label: "Compatible AI Clients" },
            { value: 256, suffix: "-bit", label: "AES-GCM Encryption" },
            { value: 100, suffix: "%", label: "Edge-Native Architecture" },
          ].map(({ value, suffix, label }, i) => (
            <div key={label} style={{ textAlign: "center", padding: "16px 24px", borderRight: i < 2 ? "1px solid var(--border)" : "none" }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: "var(--accent)", letterSpacing: "-0.03em", lineHeight: 1 }}>
                <Counter to={value} suffix={suffix} />
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── PLAYGROUND ── */}
      <div style={{ borderBottom: "1px solid var(--border)" }}>
        <PlaygroundCard />
      </div>

      {/* ── STACK WIZARD SECTION ── */}
      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <FadeIn>
              <SectionLabel>Stack Creator</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                Bootstrap agent behavior from your codebase stack
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                Define your project's programming language, framework, database, and ORM. Locker generates optimized `.cursorrules`, `CLAUDE.md`, `copilot-instructions.md`, `GEMINI.md`, `.agents/rules/rules.md` (Antigravity Workspace), and `AGENTS.md` configurations dynamically to prevent context drift and token overhead.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {["Tailored coding constraints generated dynamically", "Compatible with Cursor, Claude, Copilot, Gemini, and Antigravity", "Optimized instructions reduce context-window waste", "Sync to disk with npx locker-sync sync or direct UI download"].map((item) => (
                  <li key={item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)", textAlign: "left" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    {item}
                  </li>
                ))}
              </ul>
            </FadeIn>
          </div>
          <FadeIn delay={150}>
            <div style={{ animation: "float 6s ease-in-out infinite" }}>
              <HeroStackCreatorMockup />
            </div>
          </FadeIn>
        </div>
      </Section>

      {/* ── MCP ENDPOINT ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <Section>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
            <FadeIn delay={150}>
              <McpCallMockup />
            </FadeIn>
            <div>
              <FadeIn>
                <SectionLabel>MCP Protocol</SectionLabel>
                <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                  Expose Locker context via universal MCP endpoints
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                  Connect your vault to IDE code assistants using a single `/api/mcp` endpoint compliant with the Model Context Protocol. AI assistants retrieve semantic memories on demand.
                </p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {["recall_context — semantic (bge-m3) + keyword (tags/category) + recency ranks fused via RRF, then Llama-3.3-70B cross-encoder reranking; optional optimize mode synthesizes results into a dense system-prompt string", "commit_memory — adds new facts directly; update_memory and delete_memory queue agent requests for human approval in the Vault Actions panel before any change is applied", "store_credential / retrieve_credential — encrypted secret vault", "JSON-RPC 2.0 streamable HTTP transport"].map((item) => (
                    <li key={item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)", textAlign: "left" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </FadeIn>
            </div>
          </div>
        </Section>
      </div>

      {/* ── ENCRYPTION ── */}
      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <FadeIn>
              <SectionLabel>Zero-Plaintext Storage</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                Encrypted at rest, every single fact
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                Every memory is encrypted with AES-256-GCM under a unique per-vault Data Encryption Key (DEK). The DEK itself is wrapped by a server-side Key Encryption Key stored in environment variables — the database alone is never sufficient to decrypt anything.
              </p>
              <div style={{ display: "flex", gap: 16 }}>
                {[["Envelope Encryption", "DEK per vault"], ["AES-256-GCM", "Industry standard"], ["Edge-only unwrap", "DEK never at rest"]].map(([title, sub]) => (
                  <div key={title} style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>{title}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</div>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
          <FadeIn delay={150}>
            <EncryptionMockup />
          </FadeIn>
        </div>
      </Section>

      {/* ── MEMORY TEMPLATES SECTION ── */}
      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <FadeIn>
              <SectionLabel>Memory Templates</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                Standardize guidelines, security policies, and runbooks
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                Accelerate workspace onboarding. Locker provides pre-made memory templates covering core coding standards, CI/CD deployment setups, Docker security rules, and SOC2 compliance targets.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {["One-click template ingestion to your locker", "Boilerplates for TypeScript, Rust, and Go standards", "Deployment checks and CI workflow guides", "Enforce SOC2 and GDPR compliance criteria"].map((item) => (
                  <li key={item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)", textAlign: "left" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    {item}
                  </li>
                ))}
              </ul>
            </FadeIn>
          </div>
          <FadeIn delay={150}>
            <div style={{ animation: "float 6s ease-in-out infinite" }}>
              <MemoryTemplatesMockup />
            </div>
          </FadeIn>
        </div>
      </Section>

      {/* ── GOVERNANCE & REVIEWS SECTION ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <Section>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
            <FadeIn delay={150}>
              <ReviewQueueMockup />
            </FadeIn>
            <div>
              <FadeIn>
                <SectionLabel>Governance & Reviews</SectionLabel>
                <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                  Authoritative Org Vaults & Peer Review Queue
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                  Ensure team-wide context remains reliable. Agent update and delete requests are queued for human approval — no destructive action executes until you click Approve in the Vault Actions panel.
                </p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {["Agent update and delete requests queued for human approval", "Color-coded review cards: red for deletions, blue for edits, amber for conflicts", "Authoritative rules override personal context", "Enforce security standards team-wide"].map((item) => (
                    <li key={item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)", textAlign: "left" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      {item}
                    </li>
                  ))}
                </ul>
              </FadeIn>
            </div>
          </div>
        </Section>
      </div>

      {/* ── API TOKENS ── */}
      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <FadeIn>
              <SectionLabel>API Security</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                Fine-grained access control & ABAC for agents
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                Generate scoped Bearer tokens with per-tool permission bitmasks. Create Agent Tokens with ABAC policies that restrict which memory categories an autonomous agent can read or write — so a debugging bot can never reach your financial projections.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  "Programmatic tokens hashed with PBKDF2 at 100k iterations",
                  "Tokens shown only once at creation for security",
                  "Human tokens: Granular tool-level permission bitmasks",
                  "Agent tokens: ABAC category filters, tag lists, and credential scope",
                  "Async approval queue: Agent mutations held for human review",
                  "JIT access requests: Redacted confidential tags unlocked dynamically",
                  "Instant, one-click token revocation"
                ].map((item) => (
                  <li key={item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)", textAlign: "left" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    {item}
                  </li>
                ))}
              </ul>
            </FadeIn>
          </div>
          <FadeIn delay={150}>
            <TokenMockup />
          </FadeIn>
        </div>
      </Section>

      {/* ── HOW IT WORKS ── */}
      <Section>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <FadeIn>
            <SectionLabel>How It Works</SectionLabel>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2 }}>
              From stack wizard to active AI context in minutes
            </h2>
          </FadeIn>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <Step num="1" title="Build or Import Context" desc="Run the Tech Stack Wizard to output target constraints, or ingest pre-built memory templates and chatbot exports. Alternatively, register GitHub or Linear webhooks to auto-commit on PR merge or ticket completion." delay={0} />
            <Step num="2" title="Extract, Tag & Graph-Enrich" desc="DLP scans and encrypts facts under a per-vault DEK. Workers AI simultaneously extracts entity nodes and edges, building a GraphRAG knowledge graph. Webhook events are AI-summarised and encrypted before any D1 write." delay={100} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <Step num="3" title="Bind Universal MCP Endpoint" desc="Expose your Locker context to Cursor, Claude Desktop, Copilot, or CLI clients using your secure bearer token." delay={200} />
            <Step num="4" title="Execute with Precise Context" desc="IDE agents access updated codebase context and organizational rules automatically on every prompt cycle — including webhook-sourced summaries tagged #webhook for instant recall." delay={300} />
          </div>
        </div>
      </Section>

      {/* ── FEATURE CARDS ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <Section>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <FadeIn>
              <SectionLabel>Core Features</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2 }}>
                Built for AI-Native Engineering Orgs
              </h2>
            </FadeIn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {[
              { icon: <LockerPadlock size={20} />, title: "Envelope encryption", desc: "AES-256-GCM with per-vault DEKs wrapped by a KEK. Database + env var must both be compromised to decrypt anything.", delay: 0 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>, title: "GraphRAG hybrid retrieval", desc: "Semantic (bge-m3), keyword, and recency ranks fused via RRF with GraphRAG entity expansion. Includes Llama-3.3-70B cross-encoder reranking and optional system-prompt synthesis.", delay: 60 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>, title: "Tech Stack Wizard & CLI Sync", desc: "Generate .cursorrules, CLAUDE.md, and AGENTS.md from your stack wizard. Push rules to disk with npx locker-sync sync — or wire it into your pre-commit hook for automatic sync.", delay: 120 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>, title: "Memory Templates", desc: "Deploy pre-built coding guidelines, DevOps runbooks, and SOC2 compliance controls directly to developer agents.", delay: 180 },
              { icon: <LockerPadlock size={20} />, title: "Review & Approval Queue", desc: "Agent mutations are held in the approval queue. The Vault Actions panel displays color-coded cards to easily review, approve, or deny actions.", delay: 240 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>, title: "Authoritative Org Vault", desc: "Lock critical standards inside organization scopes. Authoritative rules always take precedence in agent contexts.", delay: 300 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, title: "Per-Token Scopes", desc: "Configure bitmask permissions to toggle read-only recall_context and write-access commit_memory capabilities.", delay: 360 },
              { icon: <LockerPadlock size={20} />, title: "Cloudflare Edge Native", desc: "Zero-servers to manage. Runs entirely on Cloudflare Workers, Cloudflare D1, and Cloudflare Vectorize.", delay: 420 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>, title: "Non-Destructive DLP", desc: "High-entropy secrets and PII are quarantined at write time. Agents receive redacted placeholders; authorized humans can unmask facts in the dashboard.", delay: 480 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>, title: "Webhook Auto-Commit", desc: "GitHub PR Merged and Linear Ticket Done events automatically pipe diff/description through Workers AI and commit an encrypted technical summary to your vault — no manual commit_memory calls needed.", delay: 540 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M3 12h.01M7.05 7.05l.007.007M12 3v.01M16.95 7.05l.007.007M21 12h.01M16.95 16.95l.007.007M12 21v-.01M7.05 16.95l-.007.007"/></svg>, title: "Agent Activity Dashboard", desc: "Timeline view of every memory operation performed by your AI tools. See which client (Cursor, Claude Desktop, Windsurf…) recalled which memories, their semantic similarity scores, and the exact facts injected into the model's context window — making AI hallucinations instantly debuggable.", delay: 600 },
            ].map((f) => (
              <FeatureCard key={f.title} icon={f.icon} title={f.title} desc={f.desc} delay={f.delay} />
            ))}
          </div>
        </Section>
      </div>

      {/* ── PLATFORMS ── */}
      <Section style={{ textAlign: "center" }}>
        <FadeIn>
          <SectionLabel>Supported Clients</SectionLabel>
          <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 8 }}>
            Integrates with your active AI toolchain
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 36, maxWidth: 640, margin: "0 auto 36px" }}>
            Works with any MCP-compatible client via standard HTTP transport or mcp-remote bridge. Connect your vault to Anthropic, OpenAI, Google, and VS Code ecosystem tools — no proprietary integration required.
          </p>
        </FadeIn>
        <PlatformScroller />
        <FadeIn delay={400}>
          <div style={{ marginTop: 32 }}>
            <Link to="/docs" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, fontWeight: 500, borderRadius: 8, textDecoration: "none", transition: "border-color 0.15s, color 0.15s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
            >
              View docs →
            </Link>
          </div>
        </FadeIn>
      </Section>

      {/* ── TEAM USE CASES ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <Section>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <FadeIn>
              <SectionLabel>Use Cases</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2 }}>
                Designed for engineering, DevOps, and project governance
              </h2>
            </FadeIn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20 }}>
            {[
              {
                title: "Software Engineers",
                desc: "Compile tailored agent rules like .cursorrules dynamically. Keep coding context, standards, APIs, and project rules aligned with AI assistants during coding sessions.",
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
              },
              {
                title: "DevOps & Infrastructure",
                desc: "Maintain and deploy memory templates for CI/CD pipelines, Docker container security, and package handling guidelines. Eliminate manual agent config setups on developer machines.",
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
              },
              {
                title: "Security & Compliance",
                desc: "Standardize SOC2 controls and GDPR rulesets inside authoritative locker scopes. Enforce decryption, auditing, and secret retrieval constraints production-wide.",
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              },
              {
                title: "Technical Project Managers (TPM)",
                desc: "Review and approve developer rule updates using the Recommendation Review Queue. Sync product roadmap context and backlog definitions with team-wide agent configurations.",
                icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              },
            ].map(({ title, desc, icon }) => (
              <FadeIn key={title}>
                <div style={{ background: "linear-gradient(135deg, rgba(168,85,247,0.03) 0%, rgba(139,92,246,0.01) 100%)", border: "1px solid rgba(168,85,247,0.12)", borderRadius: 12, padding: "24px 20px" }}>
                  <div style={{ marginBottom: 12 }}>{icon}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>{title}</div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{desc}</div>
                </div>
              </FadeIn>
            ))}
          </div>
        </Section>
      </div>

      {/* ── PLAN TIERS ── */}
      <Section style={{ textAlign: "center" }}>
        <FadeIn>
          <SectionLabel>Pricing</SectionLabel>
          <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 8 }}>
            Plans for every team size
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 48, maxWidth: 500, margin: "0 auto 48px" }}>
            Start free with personal context. Upgrade for shared vaults, recommendation queue reviews, and custom templates.
          </p>
        </FadeIn>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginBottom: 40, textAlign: "left" }}>
          {SELF_SERVE_PLAN_ORDER.map((planId) => (
            <FadeIn key={planId}>
              <PlanCard
                plan={PLANS[planId]}
                isCurrentPlan={false}
                isLoggedIn={false}
                onSelect={() => planId === "free" ? navigate({ to: "/signup" }) : null}
              />
            </FadeIn>
          ))}
        </div>
        <FadeIn>
          <Link to="/pricing" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, fontWeight: 500, borderRadius: 8, textDecoration: "none", transition: "border-color 0.15s, color 0.15s" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
          >
            View full pricing & FAQ →
          </Link>
        </FadeIn>
      </Section>

      {/* ── CTA ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
          <FadeIn>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--accent-dim)", border: "1px solid rgba(168,85,247,0.35)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
              <LockerPadlock size={24} />
            </div>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", marginBottom: 14 }}>
              Deploy Secure Context Storage
            </h2>
            <p style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 32 }}>
              Establish your personal vault free. Add team organizations when you're ready to share authoritative codebase standards and speed up engineering pipelines.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link to="/memories" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 28px", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 14, borderRadius: 10, textDecoration: "none", transition: "background 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent)"; }}
              >
                Launch Console
              </Link>
              <Link to="/pricing" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", background: "transparent", color: "var(--text-muted)", fontWeight: 600, fontSize: 14, borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", transition: "border-color 0.15s, color 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
              >
                View pricing →
              </Link>
            </div>
          </FadeIn>
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", padding: "40px 24px", textAlign: "center" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", fontSize: 12, color: "var(--text-muted)" }}>
          <div style={{ marginBottom: 16 }}>
            <Link to="/docs" style={{ color: "var(--accent)", textDecoration: "none", marginRight: 24, fontSize: 13 }}>
              API Docs
            </Link>
            <a href="https://modelcontextprotocol.io" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none", marginRight: 24 }}>
              MCP Spec
            </a>
          </div>
          <p style={{ margin: "8px 0 0 0" }}>
            End-to-end encrypted context for AI. Built on Cloudflare Workers.
          </p>
        </div>
      </footer>
    </div>
  );
}
