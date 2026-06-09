import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PLANS, SELF_SERVE_PLAN_ORDER } from "~/lib/plans";
import { PlanCard } from "~/components/PaywallGate";
import { LockerPadlock } from "~/components/LockerLogo";
import { FadeIn, Counter } from "~/components/landing/LandingAnimations";
import { Section, SectionLabel, Step } from "~/components/landing/LandingPrimitives";
import { HeroStackCreatorMockup, MemoryTemplatesMockup, ReviewQueueMockup, McpCallMockup, TokenMockup, EncryptionMockup } from "~/components/landing/LandingMockups";
import { PlatformScroller } from "~/components/landing/PlatformScroller";
import { PlaygroundCard } from "~/components/landing/PlaygroundCard";
import { FeatureFilter } from "~/components/landing/FeatureFilter";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

// ── Shared SVG icons ──────────────────────────────────────────────────────────
function IconCode() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>;
}
function IconDevOps() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h3m3 0h-3m0 0v-3m0 3v3"/></svg>;
}
function IconCompliance() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>;
}
function IconCalendar() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
}

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--text-muted)", textAlign: "left" }}>
      <svg style={{ flexShrink: 0, marginTop: 2 }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
      {children}
    </li>
  );
}

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
      <div className="relative text-center overflow-hidden px-6 pt-12 pb-16 md:pt-[100px] md:pb-20">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[60%] w-[320px] h-[320px] md:w-[700px] md:h-[700px] rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)" }} />

        <div style={{ position: "relative", maxWidth: 720, margin: "0 auto" }}>
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
              Standardize developer tribal knowledge, enforce architectural standards, and sync agent config files across your team. Run{" "}
              <code style={{ fontFamily: "monospace", fontSize: 15, color: "var(--accent)" }}>npx locker-sync sync</code>{" "}
              before opening your IDE — or wire it into your pre-commit hook.
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
                Read the Docs →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── STATS ── */}
      <div style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div className="grid grid-cols-2 md:grid-cols-4 mx-auto w-full px-6 py-8" style={{ maxWidth: "900px" }}>
          {[
            { value: 15, suffix: "", label: "MCP Tools Exposed" },
            { value: 256, suffix: "-bit", label: "AES-GCM Encryption" },
            { value: 25, suffix: "+", label: "Compatible AI Clients" },
            { value: 100, suffix: "%", label: "Edge-Native, Zero Servers" },
          ].map(({ value, suffix, label }, i) => (
            <div
              key={label}
              className={`text-center px-4 py-4 border-[var(--border)] ${i < 3 ? "border-b-0 border-r md:border-r" : ""} ${i < 2 ? "border-b md:border-b-0" : ""}`}
            >
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center">
          <div className="min-w-0">
            <FadeIn>
              <SectionLabel>Stack Creator</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                Bootstrap agent behavior from your codebase stack
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                Define your project's language, framework, database, and ORM. Locker generates optimized{" "}
                <code style={{ fontFamily: "monospace", fontSize: 13, color: "var(--accent)" }}>.cursorrules</code>,{" "}
                <code style={{ fontFamily: "monospace", fontSize: 13, color: "var(--accent)" }}>CLAUDE.md</code>,{" "}
                <code style={{ fontFamily: "monospace", fontSize: 13, color: "var(--accent)" }}>AGENTS.md</code>, and four other agent config formats dynamically — preventing context drift and token overhead.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                <CheckItem>Tailored coding constraints generated dynamically from 12 stack categories</CheckItem>
                <CheckItem>Outputs: Cursor, Claude Code, Copilot, Gemini CLI, Antigravity, OpenAI Codex</CheckItem>
                <CheckItem>Optimized instructions reduce context-window waste and hallucinations</CheckItem>
                <CheckItem>Sync to disk via <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>npx locker-sync sync</code> or wire into your pre-commit hook</CheckItem>
                <CheckItem>Save reusable stack profiles as team templates for one-click onboarding</CheckItem>
              </ul>
            </FadeIn>
          </div>
          <div className="min-w-0 overflow-hidden">
            <FadeIn delay={150}>
              <div style={{ animation: "float 6s ease-in-out infinite" }}>
                <HeroStackCreatorMockup />
              </div>
            </FadeIn>
          </div>
        </div>
      </Section>

      {/* ── MCP ENDPOINT ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <Section>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center">
            <div className="min-w-0 overflow-hidden">
              <FadeIn delay={150}>
                <McpCallMockup />
              </FadeIn>
            </div>
            <div className="min-w-0">
              <FadeIn>
                <SectionLabel>MCP Protocol</SectionLabel>
                <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                  15 MCP tools over a single universal endpoint
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                  Connect any MCP-compatible client to your vault via one{" "}
                  <code style={{ fontFamily: "monospace", fontSize: 13, color: "var(--accent)" }}>/api/mcp</code>{" "}
                  endpoint. JSON-RPC 2.0 streamable HTTP transport. Sign in with OAuth once, or supply a Bearer token for headless agents.
                </p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  <CheckItem><strong style={{ color: "var(--text)" }}>recall_context</strong> — hybrid bge-m3 + FTS5 + RRF fusion, Llama-3.3-70B cross-encoder reranking, GraphRAG entity expansion</CheckItem>
                  <CheckItem><strong style={{ color: "var(--text)" }}>commit_memory / update_memory / delete_memory</strong> — agent mutations queue for human approval; destructive ops never execute silently</CheckItem>
                  <CheckItem><strong style={{ color: "var(--text)" }}>store_credential / retrieve_credential</strong> — encrypted secret vault, returned as <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>[REDACTED]</code> unless explicitly authorized</CheckItem>
                  <CheckItem><strong style={{ color: "var(--text)" }}>sync_agent_configs</strong> — compile and write all agent config formats to disk in one call</CheckItem>
                  <CheckItem><strong style={{ color: "var(--text)" }}>list_accessible_scopes</strong> — discover personal, org, and team vaults the token can reach</CheckItem>
                </ul>
              </FadeIn>
            </div>
          </div>
        </Section>
      </div>

      {/* ── ENCRYPTION ── */}
      <Section>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center">
          <div className="min-w-0">
            <FadeIn>
              <SectionLabel>Zero-Plaintext Storage</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                Encrypted at rest — every fact, every vault
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                Every memory is encrypted with AES-256-GCM under a unique per-vault Data Encryption Key (DEK). The DEK is wrapped by a server-side Key Encryption Key in environment variables — the database alone can never decrypt anything. Unwrapped DEKs exist only in ephemeral V8 worker memory for the duration of a single request.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  ["Envelope Encryption", "DEK per vault, KEK in env"],
                  ["AES-256-GCM", "Authenticated encryption"],
                  ["Blind Index Tags", "Search without decrypting"],
                ].map(([title, sub]) => (
                  <div key={title} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)", marginBottom: 4 }}>{title}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{sub}</div>
                  </div>
                ))}
              </div>
            </FadeIn>
          </div>
          <div className="min-w-0 overflow-hidden">
            <FadeIn delay={150}>
              <EncryptionMockup />
            </FadeIn>
          </div>
        </div>
      </Section>

      {/* ── GOVERNANCE & REVIEWS ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <Section>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center">
            <div className="min-w-0 overflow-hidden">
              <FadeIn delay={150}>
                <ReviewQueueMockup />
              </FadeIn>
            </div>
            <div className="min-w-0">
              <FadeIn>
                <SectionLabel>Governance & Reviews</SectionLabel>
                <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                  Authoritative Org Vaults & Human Approval Queue
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                  No agent can mutate or delete a memory without explicit human sign-off. Agent{" "}
                  <code style={{ fontFamily: "monospace", fontSize: 13, color: "var(--accent)" }}>update_memory</code>{" "}
                  and{" "}
                  <code style={{ fontFamily: "monospace", fontSize: 13, color: "var(--accent)" }}>delete_memory</code>{" "}
                  calls are queued — the vault is left unchanged until you approve.
                </p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  <CheckItem>Color-coded review cards: red for deletions, blue for edits, amber for contradictions</CheckItem>
                  <CheckItem>Contradiction detection: Llama 3.3-70B flags conflicting facts as amber archive recommendations</CheckItem>
                  <CheckItem>Authoritative org memories always take precedence over personal context</CheckItem>
                  <CheckItem>Full version history with rollback — every change timestamped and actor-attributed</CheckItem>
                  <CheckItem>Passing <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>confirm: true</code> has zero effect on agent tokens — queue is mandatory</CheckItem>
                </ul>
              </FadeIn>
            </div>
          </div>
        </Section>
      </div>

      {/* ── API TOKENS & ABAC ── */}
      <Section>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center">
          <div className="min-w-0">
            <FadeIn>
              <SectionLabel>API Security</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                Fine-grained ABAC — so your debug bot can't read financials
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                Generate scoped Bearer tokens with per-tool permission bitmasks. Agent tokens carry ABAC policies that restrict which memory categories and tags an autonomous agent can read or write — enforced at both the SQL query layer and the Vectorize metadata layer. Encrypted data for off-limits categories is never decrypted.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                <CheckItem>PBKDF2-HMAC-SHA256 at 100k iterations — GPU brute-force resistant even on DB leak</CheckItem>
                <CheckItem>Token shown only once at creation; prefix-indexed for sub-millisecond auth lookups at scale</CheckItem>
                <CheckItem><strong style={{ color: "var(--text)" }}>Human tokens:</strong> per-tool bitmask (recall, commit, update, delete)</CheckItem>
                <CheckItem><strong style={{ color: "var(--text)" }}>Agent tokens:</strong> ABAC category filters, tag allowlist/denylist, credential vault gate</CheckItem>
                <CheckItem><strong style={{ color: "var(--text)" }}>#confidential tag:</strong> triggers JIT access request — Slack notification with one-click approval, 15-min token</CheckItem>
                <CheckItem>Instant token revocation; full audit log entry on every MCP call</CheckItem>
              </ul>
            </FadeIn>
          </div>
          <div className="min-w-0 overflow-hidden">
            <FadeIn delay={150}>
              <TokenMockup />
            </FadeIn>
          </div>
        </div>
      </Section>

      {/* ── MEMORY TEMPLATES ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <Section>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-14 items-center">
            <div className="min-w-0 overflow-hidden">
              <FadeIn delay={150}>
                <div style={{ animation: "float 6s ease-in-out infinite" }}>
                  <MemoryTemplatesMockup />
                </div>
              </FadeIn>
            </div>
            <div className="min-w-0">
              <FadeIn>
                <SectionLabel>Memory Templates</SectionLabel>
                <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                  Standardize guidelines, security policies, and runbooks in minutes
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                  Accelerate workspace onboarding. Locker ships pre-built memory templates for DevOps, CI/CD, DevSecOps, SOC2 compliance, project management, and product management — ready to deploy to any org or team vault in one click.
                </p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  <CheckItem>One-click template ingestion to personal, team, or org vault</CheckItem>
                  <CheckItem>Pre-built: DevOps runbooks, CI/CD workflows, Docker security, SOC2 controls, GDPR targets</CheckItem>
                  <CheckItem>Save custom templates from your own stack wizard output for team reuse</CheckItem>
                  <CheckItem>Template variables and system properties for parameterized configs</CheckItem>
                </ul>
              </FadeIn>
            </div>
          </div>
        </Section>
      </div>

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <Step num="1" title="Build or Import Context" desc="Run the Tech Stack Wizard to generate agent configs, ingest pre-built memory templates, paste chatbot exports, or register GitHub/Linear webhooks to auto-commit on PR merge or ticket completion." delay={0} />
            <Step num="2" title="DLP Scan, Encrypt & Graph-Enrich" desc="Every write passes through entropy-based DLP (secrets, PII, adversarial content) and AI sanitization before AES-256-GCM encryption. Workers AI simultaneously extracts entity nodes and relationship edges into the GraphRAG knowledge graph." delay={100} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <Step num="3" title="Bind Universal MCP Endpoint" desc="Connect your vault to Cursor, Claude Code, Copilot, Gemini CLI, Windsurf, or any other MCP client via OAuth or a scoped Bearer token. No sidecar processes — pure HTTP transport." delay={200} />
            <Step num="4" title="Execute with Precise, Governed Context" desc="IDE agents recall hybrid-ranked, graph-expanded context on every prompt cycle. Contradictions surface in the Conflicts Hub. Stale memories are flagged. Agent mutations wait in the approval queue." delay={300} />
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
          <FeatureFilter />
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
            Native HTTP transport for Antigravity, OpenAI Codex, Gemini CLI, Windsurf, Zed, Amp, Kiro, and Kilo Code. mcp-remote bridge for Claude Desktop, Cursor, Cline, Continue, VS Code, and GitHub Copilot. OAuth passthrough for claude.ai and all Claude Code surfaces.
          </p>
        </FadeIn>
        <PlatformScroller />
        <FadeIn delay={400}>
          <div style={{ marginTop: 32 }}>
            <Link to="/docs" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, fontWeight: 500, borderRadius: 8, textDecoration: "none", transition: "border-color 0.15s, color 0.15s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
            >
              View connection docs →
            </Link>
          </div>
        </FadeIn>
      </Section>

      {/* ── USE CASES ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <Section>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <FadeIn>
              <SectionLabel>Use Cases</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2 }}>
                Designed for engineering, DevOps, security, and project governance
              </h2>
            </FadeIn>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {[
              {
                title: "Software Engineers",
                desc: "Generate .cursorrules and CLAUDE.md dynamically from your stack wizard. Keep coding standards, API rules, and project context aligned across every AI assistant — import existing context from ChatGPT, Claude, Gemini, and more in minutes.",
                icon: <IconCode />,
              },
              {
                title: "DevOps & Infrastructure",
                desc: "Maintain memory templates for CI/CD pipelines, Docker security policies, and deployment runbooks. Register GitHub and Linear webhooks to auto-commit PR summaries and ticket learnings to the team vault. Use the PR Policy Gatekeeper to block banned dependencies and architectural drift before they ever merge.",
                icon: <IconDevOps />,
              },
              {
                title: "Security & Compliance",
                desc: "Enforce SOC2 controls and GDPR rulesets in authoritative org scopes. DLP quarantine catches secrets before they persist. ABAC agent policies prevent scope leakage. Audit logs track every MCP call with IP and user-agent.",
                icon: <IconCompliance />,
              },
              {
                title: "Technical Project Managers",
                desc: "Review and approve agent rule updates via the Recommendation Queue. Sync product roadmap context and backlog definitions to team agent configs. Track stale context and resolve contradictions before they mislead the team's AI tools.",
                icon: <IconCalendar />,
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
            Start free with a personal encrypted vault. Upgrade for shared org vaults, team isolation, approval queues, audit logs, knowledge graph, and cross-workspace search.
          </p>
        </FadeIn>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-10 text-left">
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
            View full pricing & feature comparison →
          </Link>
        </FadeIn>
      </Section>

      {/* ── CTA ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        <div className="mx-auto w-full px-6 py-12 md:py-20 text-center" style={{ maxWidth: "600px" }}>
          <FadeIn>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--accent-dim)", border: "1px solid rgba(168,85,247,0.35)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
              <LockerPadlock size={24} />
            </div>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", marginBottom: 14 }}>
              Deploy Secure Context Storage
            </h2>
            <p style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 32 }}>
              Set up your personal encrypted vault in seconds. Add an org when you're ready to share authoritative codebase standards, govern agent permissions, and accelerate engineering pipelines.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link to="/memories" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 28px", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 14, borderRadius: 10, textDecoration: "none", transition: "background 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent)"; }}
              >
                Launch Console
              </Link>
              <Link to="/docs" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", background: "transparent", color: "var(--text-muted)", fontWeight: 600, fontSize: 14, borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", transition: "border-color 0.15s, color 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
              >
                Read the Docs →
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
            <Link to="/pricing" style={{ color: "var(--accent)", textDecoration: "none", marginRight: 24, fontSize: 13 }}>
              Pricing
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
