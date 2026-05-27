import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

// ── Intersection-observer fade-in hook ────────────────────────────────────────
function useFadeIn(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function FadeIn({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: React.CSSProperties }) {
  const { ref, visible } = useFadeIn();
  return (
    <div
      ref={ref}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: `opacity 0.6s ease ${delay}ms, transform 0.6s ease ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [val, setVal] = useState(0);
  const { ref, visible } = useFadeIn(0.5);
  useEffect(() => {
    if (!visible) return;
    let start = 0;
    const step = to / 40;
    const id = setInterval(() => {
      start += step;
      if (start >= to) { setVal(to); clearInterval(id); }
      else setVal(Math.floor(start));
    }, 30);
    return () => clearInterval(id);
  }, [visible, to]);
  return <span ref={ref}>{val}{suffix}</span>;
}

// ── Mockup components ─────────────────────────────────────────────────────────

function MemoryVaultMockup() {
  const rows = [
    { cat: "rules", color: "#818cf8", fact: "Always prefer TypeScript strict mode with no implicit any.", tags: "typescript, rules" },
    { cat: "projects", color: "#34d399", fact: "Locker — encrypted memory vault for AI context. Stack: TanStack Start, Cloudflare Workers, D1.", tags: "locker, active" },
    { cat: "references", color: "#fbbf24", fact: "Lives in Florida. Prefers concise, no-filler responses.", tags: "identity, preferences" },
    { cat: "rules", color: "#818cf8", fact: "Never add trailing summaries or restate what was just done.", tags: "feedback, style" },
  ];
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", fontFamily: "monospace" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", opacity: 0.7 }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)" }}>Memories — 367 entries</span>
      </div>
      <div>
        {rows.map((r, i) => (
          <div key={i} style={{ padding: "10px 16px", borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: r.color, background: `${r.color}18`, border: `1px solid ${r.color}40`, borderRadius: 20, padding: "2px 7px", whiteSpace: "nowrap", marginTop: 1 }}>
              {r.cat}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.5 }}>{r.fact}</div>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 3 }}>{r.tags}</div>
            </div>
            <div style={{ fontSize: 10, color: "#22c55e", opacity: 0.6, marginTop: 1 }}>🔒</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function McpCallMockup() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 4), 1800);
    return () => clearInterval(id);
  }, []);
  const steps = [
    { label: "AI sends recall_context", color: "#6366f1", icon: "→" },
    { label: "Bearer token verified", color: "#22c55e", icon: "🔑" },
    { label: "Semantic search in Vectorize", color: "#fbbf24", icon: "⚡" },
    { label: "Decrypted facts returned", color: "#818cf8", icon: "←" },
  ];
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, fontFamily: "monospace" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>MCP Request Flow</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: step === i ? `${s.color}15` : "var(--surface2)", border: `1px solid ${step === i ? s.color + "50" : "var(--border)"}`, transition: "all 0.4s ease" }}>
            <span style={{ fontSize: 14 }}>{s.icon}</span>
            <span style={{ fontSize: 11, color: step === i ? s.color : "var(--text-muted)", fontWeight: step === i ? 600 : 400, transition: "color 0.4s" }}>{s.label}</span>
            {step === i && <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: s.color, animation: "pulse 1s infinite" }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TokenMockup() {
  const tools = ["recall_context", "commit_memory"];
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface2)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        API Tokens
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {[{ name: "Claude Desktop", perms: [0, 1] }, { name: "Codex (read-only)", perms: [0] }].map((tok, i) => (
          <div key={i} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{tok.name}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {tools.map((t, j) => (
                <span key={j} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: tok.perms.includes(j) ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)", border: `1px solid ${tok.perms.includes(j) ? "rgba(99,102,241,0.4)" : "var(--border)"}`, color: tok.perms.includes(j) ? "var(--accent)" : "var(--text-muted)", fontFamily: "monospace" }}>
                  {tok.perms.includes(j) ? "✓" : "✗"} {t}
                </span>
              ))}
            </div>
          </div>
        ))}
        <div style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "var(--accent)", fontFamily: "monospace" }}>
          lkr_a8f3c2e1d9b7...  <span style={{ color: "var(--text-muted)" }}>shown once</span>
        </div>
      </div>
    </div>
  );
}

function PlatformGrid() {
  const platforms = [
    { label: "Claude Desktop", color: "#d4956a" },
    { label: "Claude Code", color: "#c97b53" },
    { label: "Cursor", color: "#00e5ff" },
    { label: "Cline", color: "#ff6b6b" },
    { label: "Roo Code", color: "#ff8787" },
    { label: "Continue", color: "#2f80ed" },
    { label: "GitHub Copilot", color: "#6f42c1" },
    { label: "VS Code", color: "#007acc" },
    { label: "ChatGPT", color: "#10a37f" },
    { label: "Gemini", color: "#4285f4" },
    { label: "Grok", color: "#e7e7e7" },
    { label: "Perplexity", color: "#20b2aa" },
  ];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
      {platforms.map((p, i) => (
        <FadeIn key={p.label} delay={i * 40}>
          <div style={{ padding: "6px 14px", borderRadius: 20, background: `${p.color}15`, border: `1px solid ${p.color}40`, color: p.color, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
            {p.label}
          </div>
        </FadeIn>
      ))}
    </div>
  );
}

// ── Encryption visualiser ─────────────────────────────────────────────────────
function EncryptionMockup() {
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    const id = setInterval(() => setFlipped((f) => !f), 2400);
    return () => clearInterval(id);
  }, []);
  const plain = "Prefers TypeScript strict mode. Lives in Florida.";
  const enc   = "a3f9d2c1e8b5:9f2a1c4b8e7d3f6a2c5b9e1d4f7a3c6b2e8d5f1a4c7b3e9d6f2a5c8b4e1d7f3a6c2b5e8d4f1...";
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, fontFamily: "monospace" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>AES-256-GCM at rest</div>
      <div style={{ position: "relative", height: 64 }}>
        <div style={{ position: "absolute", inset: 0, padding: "10px 12px", borderRadius: 8, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", fontSize: 11, color: "#22c55e", lineHeight: 1.5, opacity: flipped ? 0 : 1, transition: "opacity 0.5s ease" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>plaintext </span>{plain}
        </div>
        <div style={{ position: "absolute", inset: 0, padding: "10px 12px", borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", fontSize: 10, color: "var(--accent)", lineHeight: 1.5, wordBreak: "break-all", opacity: flipped ? 1 : 0, transition: "opacity 0.5s ease" }}>
          <span style={{ color: "var(--text-muted)" }}>encrypted </span>{enc}
        </div>
      </div>
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
        <span style={{ color: "#22c55e" }}>●</span> Decrypted on read · never stored plaintext
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────
function Section({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <section style={{ padding: "80px 24px", maxWidth: 1040, margin: "0 auto", ...style }}>
      {children}
    </section>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14, background: "var(--accent-dim)", border: "1px solid rgba(99,102,241,0.3)", borderRadius: 20, padding: "4px 12px" }}>
      {children}
    </div>
  );
}

// ── Feature card ──────────────────────────────────────────────────────────────
function FeatureCard({ icon, title, desc, delay }: { icon: React.ReactNode; title: string; desc: string; delay?: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <FadeIn delay={delay}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ background: "var(--surface)", border: `1px solid ${hovered ? "rgba(99,102,241,0.4)" : "var(--border)"}`, borderRadius: 12, padding: "22px 20px", height: "100%", transition: "border-color 0.2s, transform 0.2s, box-shadow 0.2s", transform: hovered ? "translateY(-3px)" : "none", boxShadow: hovered ? "0 8px 24px rgba(99,102,241,0.12)" : "none" }}
      >
        <div style={{ marginBottom: 12 }}>{icon}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{desc}</div>
      </div>
    </FadeIn>
  );
}

// ── How it works step ─────────────────────────────────────────────────────────
function Step({ num, title, desc, delay }: { num: string; title: string; desc: string; delay?: number }) {
  return (
    <FadeIn delay={delay} style={{ display: "flex", gap: 18 }}>
      <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: "50%", background: "var(--accent-dim)", border: "1px solid rgba(99,102,241,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>
        {num}
      </div>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{desc}</div>
      </div>
    </FadeIn>
  );
}

// ── Main landing page ─────────────────────────────────────────────────────────
function LandingPage() {
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
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-60%)", width: 700, height: 700, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />

        <div style={{ position: "relative", maxWidth: 720, margin: "0 auto" }}>
          {/* lock icon animated */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, background: "var(--accent-dim)", border: "1px solid rgba(99,102,241,0.35)", display: "flex", alignItems: "center", justifyContent: "center", animation: "float 4s ease-in-out infinite", opacity: heroVisible ? 1 : 0, transition: "opacity 0.6s ease" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
          </div>

          <div style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? "none" : "translateY(24px)", transition: "opacity 0.7s ease 0.1s, transform 0.7s ease 0.1s" }}>
            <h1 style={{ fontSize: "clamp(36px, 6vw, 60px)", fontWeight: 800, letterSpacing: "-0.04em", color: "var(--text)", lineHeight: 1.1, marginBottom: 20 }}>
              Your AI memory,{" "}
              <span style={{ color: "var(--accent)" }}>encrypted & portable</span>
            </h1>
            <p style={{ fontSize: 18, color: "var(--text-muted)", lineHeight: 1.7, maxWidth: 540, margin: "0 auto 36px", fontWeight: 400 }}>
              Locker is a personal memory vault that securely stores your context and makes it available to any AI tool — via a universal MCP endpoint.
            </p>

            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link to="/memories" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 28px", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 14, borderRadius: 10, textDecoration: "none", transition: "background 0.15s, transform 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>
                Open Vault
              </Link>
              <Link to="/connect" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", background: "transparent", color: "var(--text-muted)", fontWeight: 600, fontSize: 14, borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", transition: "border-color 0.15s, color 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
              >
                Connect an AI client →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* ── STATS ── */}
      <div style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0 }}>
          {[
            { value: 15, suffix: "+", label: "AI platforms supported" },
            { value: 256, suffix: "-bit", label: "AES-GCM encryption" },
            { value: 100, suffix: "%", label: "Self-hosted on Cloudflare" },
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

      {/* ── MEMORY VAULT MOCKUP ── */}
      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
          <div>
            <FadeIn>
              <SectionLabel>Memory Vault</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                All your context, one encrypted vault
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                Store rules, projects, and references as discrete memory entries. Every fact is encrypted with AES-256-GCM before hitting the database — your data stays yours.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {["Rules, projects, and reference categories", "Tags for precise filtering", "Bulk import from any chatbot export", "Edit, delete, and bulk manage entries"].map((item) => (
                  <li key={item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)" }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    {item}
                  </li>
                ))}
              </ul>
            </FadeIn>
          </div>
          <FadeIn delay={150}>
            <div style={{ animation: "float 6s ease-in-out infinite" }}>
              <MemoryVaultMockup />
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
                <SectionLabel>MCP Endpoint</SectionLabel>
                <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                  Universal context, any AI client
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                  A single <code style={{ color: "var(--accent)", fontSize: 13, background: "var(--surface2)", padding: "1px 5px", borderRadius: 4 }}>/api/mcp</code> endpoint speaks the Model Context Protocol. Wire it into Claude Desktop, Cursor, Cline, VS Code Copilot — any MCP-compatible client.
                </p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {["recall_context — semantic vector search", "commit_memory — write new facts mid-session", "Runs on Cloudflare edge, sub-50ms globally", "Standard JSON-RPC 2.0 transport"].map((item) => (
                    <li key={item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)" }}>
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
                Every memory is encrypted with AES-256-GCM using a per-deployment key before storage. The database never sees plaintext — only your running worker can decrypt.
              </p>
              <div style={{ display: "flex", gap: 16 }}>
                {[["AES-256-GCM", "Industry standard"], ["12-byte IV", "Per-record randomness"], ["Edge-only keys", "Never in the DB"]].map(([title, sub]) => (
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

      {/* ── API TOKENS ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <Section>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "center" }}>
            <FadeIn delay={150}>
              <TokenMockup />
            </FadeIn>
            <div>
              <FadeIn>
                <SectionLabel>API Tokens</SectionLabel>
                <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 16 }}>
                  Fine-grained access control
                </h2>
                <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                  Generate Bearer tokens with per-tool permission bitmasks. Give your coding assistant read-only access, while letting your personal Claude write new memories mid-session.
                </p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {["Tokens stored as SHA-256 hashes only", "Shown once at creation, never again", "Toggle recall_context and commit_memory independently", "Revoke any token instantly"].map((item) => (
                    <li key={item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--text-muted)" }}>
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

      {/* ── HOW IT WORKS ── */}
      <Section>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <FadeIn>
            <SectionLabel>How It Works</SectionLabel>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2 }}>
              From export to AI context in minutes
            </h2>
          </FadeIn>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <Step num="1" title="Export memories from any chatbot" desc="Use the built-in prompts on the Import page to pull your existing memories out of ChatGPT, Claude, Gemini, Grok, or Perplexity." delay={0} />
            <Step num="2" title="Paste & AI-extract" desc="Paste the raw chatbot output. Locker's AI parser extracts discrete facts, categorises them, and tags them automatically." delay={100} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <Step num="3" title="Connect your AI client" desc="Follow the Connect guide to add Locker as an MCP server in any compatible client using your Bearer token." delay={200} />
            <Step num="4" title="Your context follows you everywhere" desc="Every AI session starts with your full personal and technical context — encrypted, always up to date, under your control." delay={300} />
          </div>
        </div>
      </Section>

      {/* ── FEATURE CARDS ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <Section>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <FadeIn>
              <SectionLabel>Everything Included</SectionLabel>
              <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2 }}>
                Built for the serious AI user
              </h2>
            </FadeIn>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
            {[
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, title: "End-to-end encryption", desc: "AES-256-GCM on every fact. Database rows are ciphertext only.", delay: 0 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>, title: "Semantic vector search", desc: "Cloudflare Vectorize powers fuzzy recall — find facts by meaning, not just keywords.", delay: 60 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>, title: "15+ platform configs", desc: "One-click config snippets for every major AI client, always up to date.", delay: 120 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>, title: "AI-powered import", desc: "Paste any raw text — Claude extracts, categorises, and deduplicates the facts.", delay: 180 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, title: "Per-token permissions", desc: "Bearer tokens with bitmask permissions — read-only or full write access, per client.", delay: 240 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>, title: "Cloudflare edge", desc: "Workers + D1 + Vectorize — globally distributed, no server to manage.", delay: 300 },
            ].map((f) => (
              <FeatureCard key={f.title} icon={f.icon} title={f.title} desc={f.desc} delay={f.delay} />
            ))}
          </div>
        </Section>
      </div>

      {/* ── PLATFORMS ── */}
      <Section style={{ textAlign: "center" }}>
        <FadeIn>
          <SectionLabel>Supported Platforms</SectionLabel>
          <h2 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 8 }}>
            Works with your whole stack
          </h2>
          <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 36 }}>
            One endpoint, every client. Check the Connect page for ready-to-paste config snippets.
          </p>
        </FadeIn>
        <PlatformGrid />
        <FadeIn delay={600}>
          <div style={{ marginTop: 36 }}>
            <Link to="/connect" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, fontWeight: 500, borderRadius: 8, textDecoration: "none", transition: "border-color 0.15s, color 0.15s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
            >
              View all config guides →
            </Link>
          </div>
        </FadeIn>
      </Section>

      {/* ── CTA ── */}
      <div style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
          <FadeIn>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "var(--accent-dim)", border: "1px solid rgba(99,102,241,0.35)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", marginBottom: 14 }}>
              Your vault is ready
            </h2>
            <p style={{ fontSize: 15, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 32 }}>
              Start building your encrypted memory store. Import from your existing AI tools, connect a client, and let Locker carry your context everywhere.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <Link to="/memories" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 28px", background: "var(--accent)", color: "#fff", fontWeight: 700, fontSize: 14, borderRadius: 10, textDecoration: "none", transition: "background 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent-hover)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--accent)"; }}
              >
                Open Vault
              </Link>
              <Link to="/import" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 24px", background: "transparent", color: "var(--text-muted)", fontWeight: 600, fontSize: 14, borderRadius: 10, border: "1px solid var(--border)", textDecoration: "none", transition: "border-color 0.15s, color 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
              >
                Import memories →
              </Link>
            </div>
          </FadeIn>
        </div>
      </div>
    </div>
  );
}
