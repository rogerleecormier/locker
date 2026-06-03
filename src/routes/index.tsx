import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PLATFORMS, PLATFORM_GROUPS } from "../lib/platforms";
import { PLANS, PLAN_ORDER } from "~/lib/plans";
import { PlanCard } from "~/components/PaywallGate";

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

function HeroStackCreatorMockup() {
  const [step, setStep] = useState(1);
  const [lang, setLang] = useState("TS");
  const [frontend, setFrontend] = useState("React");
  const [db, setDb] = useState("D1");
  const [orm, setOrm] = useState("Drizzle");
  const [copied, setCopied] = useState(false);
  const [activeFormat, setActiveFormat] = useState<"cursor" | "claude" | "gemini" | "copilot" | "codex" | "antigravity" | "agents">("cursor");

  const getRulesText = () => {
    const rules = [];
    rules.push(`// Architectural constraints for ${lang} + ${frontend} using ${orm} & ${db}`);
    if (lang === "TS") {
      rules.push("- Always enforce strict null checks and avoid explicit 'any'.");
      rules.push("- Use TypeScript interfaces for type declarations instead of types.");
    } else if (lang === "Go") {
      rules.push("- Check all err return values explicitly; never ignore errors.");
      rules.push("- Prefer struct pointers for database model operations.");
    } else {
      rules.push("- Enforce typing via type hints and adhere to PEP8 formatting.");
    }

    if (frontend === "React") {
      rules.push("- Keep components modular; split complex logic into custom hooks.");
      rules.push("- Avoid inline styled elements; structure layouts with CSS classes.");
    } else if (frontend === "Next") {
      rules.push("- Leverage Next.js React Server Components (RSC) to minimize client bundle.");
    }

    if (db === "D1") {
      rules.push("- Batch SQL statements to optimize Cloudflare Workers execution timeouts.");
    }
    if (orm === "Drizzle") {
      rules.push("- Perform schema updates using declarative migrations generated via Drizzle Kit.");
    }

    if (activeFormat === "cursor") {
      return JSON.stringify({
        name: `Locker Stack: ${lang}-${frontend}`,
        description: `Architecture standards for ${lang}/${frontend}`,
        globs: ["*"],
        rules: rules
      }, null, 2);
    } else {
      let title = "Developer Agent Rules";
      let section = "Guidelines";
      if (activeFormat === "claude") {
        title = "Claude System Instructions";
        section = "Enforced Guidelines";
      } else if (activeFormat === "copilot") {
        title = "Copilot Instructions";
        section = "Rules";
      } else if (activeFormat === "gemini") {
        title = "Gemini Rules";
        section = "Coding Guidelines";
      } else if (activeFormat === "antigravity") {
        title = "Antigravity Rules";
        section = "Guidelines";
      } else if (activeFormat === "codex") {
        title = "Codex Rules";
        section = "Rules";
      } else if (activeFormat === "agents") {
        title = "Developer Agent Rules";
        section = "Guidelines";
      }

      return `# ${title}\n\n## ${section}\n${rules.map(r => r).join("\n")}`;
    }
  };

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", textAlign: "left", fontFamily: "monospace" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", opacity: 0.7 }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)", flex: 1 }}>Tech Stack & Agent Rules Wizard</span>
        {step > 1 && (
          <button 
            onClick={() => setStep(step - 1)} 
            style={{ fontSize: 10, background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", padding: "2px 8px", borderRadius: 4, cursor: "pointer" }}
          >
            ← Back
          </button>
        )}
      </div>

      <div style={{ padding: 16, minHeight: 280, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        {step === 1 && (
          <div>
            <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>STEP 1: Core Technologies</div>
            
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>Language</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["TS", "Go", "Python"].map(l => (
                  <button 
                    key={l}
                    onClick={() => setLang(l)}
                    style={{
                      flex: 1, padding: "8px", fontSize: 11,
                      background: lang === l ? "var(--accent-dim)" : "var(--surface2)",
                      border: `1px solid ${lang === l ? "var(--accent)" : "var(--border)"}`,
                      color: lang === l ? "var(--text)" : "var(--text-muted)",
                      fontWeight: lang === l ? 700 : 400,
                      cursor: "pointer"
                    }}
                  >
                    {l === "TS" ? "TypeScript" : l}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>Frontend Framework</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["React", "Next", "Vanilla"].map(f => (
                  <button 
                    key={f}
                    onClick={() => setFrontend(f)}
                    style={{
                      flex: 1, padding: "8px", fontSize: 11,
                      background: frontend === f ? "var(--accent-dim)" : "var(--surface2)",
                      border: `1px solid ${frontend === f ? "var(--accent)" : "var(--border)"}`,
                      color: frontend === f ? "var(--text)" : "var(--text-muted)",
                      fontWeight: frontend === f ? 700 : 400,
                      cursor: "pointer"
                    }}
                  >
                    {f === "React" ? "React/TanStack" : f === "Next" ? "Next.js" : "Vanilla JS"}
                  </button>
                ))}
              </div>
            </div>

            <button 
              onClick={() => setStep(2)}
              style={{ width: "100%", padding: "10px", background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", borderRadius: 6 }}
            >
              Configure Infrastructure →
            </button>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>STEP 2: Infrastructure Configuration</div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>Database</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["D1", "Postgres"].map(d => (
                  <button 
                    key={d}
                    onClick={() => setDb(d)}
                    style={{
                      flex: 1, padding: "8px", fontSize: 11,
                      background: db === d ? "var(--accent-dim)" : "var(--surface2)",
                      border: `1px solid ${db === d ? "var(--accent)" : "var(--border)"}`,
                      color: db === d ? "var(--text)" : "var(--text-muted)",
                      fontWeight: db === d ? 700 : 400,
                      cursor: "pointer"
                    }}
                  >
                    {d === "D1" ? "Cloudflare D1" : "PostgreSQL"}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>ORM / Access Layer</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["Drizzle", "Prisma"].map(o => (
                  <button 
                    key={o}
                    onClick={() => setOrm(o)}
                    style={{
                      flex: 1, padding: "8px", fontSize: 11,
                      background: orm === o ? "var(--accent-dim)" : "var(--surface2)",
                      border: `1px solid ${orm === o ? "var(--accent)" : "var(--border)"}`,
                      color: orm === o ? "var(--text)" : "var(--text-muted)",
                      fontWeight: orm === o ? 700 : 400,
                      cursor: "pointer"
                    }}
                  >
                    {o === "Drizzle" ? "Drizzle ORM" : "Prisma Client"}
                  </button>
                ))}
              </div>
            </div>

            <button 
              onClick={() => setStep(3)}
              style={{ width: "100%", padding: "10px", background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", borderRadius: 6 }}
            >
              Compile Agent Configuration File →
            </button>
          </div>
        )}

        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)", paddingBottom: 8, marginBottom: 4 }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["cursor", "claude", "copilot", "gemini", "codex", "antigravity", "agents"].map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveFormat(tab as any)}
                    style={{
                      fontSize: 10, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                      background: activeFormat === tab ? "var(--accent-dim)" : "transparent",
                      border: `1px solid ${activeFormat === tab ? "var(--accent)" : "transparent"}`,
                      color: activeFormat === tab ? "var(--text)" : "var(--text-muted)",
                      marginBottom: 4
                    }}
                  >
                    {tab === "cursor" 
                      ? ".cursorrules" 
                      : tab === "claude" 
                      ? "CLAUDE.md" 
                      : tab === "copilot" 
                      ? "copilot-instructions.md" 
                      : tab === "gemini" 
                      ? "GEMINI.md" 
                      : tab === "codex" 
                      ? ".codexrules" 
                      : tab === "antigravity" 
                      ? ".antigravityrules" 
                      : "AGENTS.md"}
                  </button>
                ))}
              </div>
              <button 
                onClick={handleCopy}
                style={{
                  fontSize: 10, padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                  background: copied ? "rgba(34,197,94,0.15)" : "var(--surface2)",
                  border: `1px solid ${copied ? "var(--success)" : "var(--border)"}`,
                  color: copied ? "var(--success)" : "var(--text-muted)"
                }}
              >
                {copied ? "✓ Copied" : "Copy"}
              </button>
            </div>

            <pre style={{
              background: "var(--surface2)",
              padding: 10,
              borderRadius: 6,
              fontSize: 10,
              color: "var(--text)",
              lineHeight: 1.4,
              overflowY: "auto",
              height: 140,
              textAlign: "left",
              whiteSpace: "pre-wrap",
              border: "1px solid var(--border)",
              margin: 0
            }}>
              {getRulesText()}
            </pre>

            <button 
              onClick={() => { setStep(1); setCopied(false); }}
              style={{ width: "100%", padding: "8px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", borderRadius: 6, marginTop: 4 }}
            >
              Reset Stack Wizard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryTemplatesMockup() {
  const [selectedCategory, setSelectedCategory] = useState<"coding" | "devops" | "compliance">("coding");
  const [importingCard, setImportingCard] = useState<string | null>(null);
  const [importedStatus, setImportedStatus] = useState<Record<string, boolean>>({});

  const templatesData = {
    coding: [
      { id: "ts-rules", title: "TypeScript Clean Code", desc: "Best practices, type safety enforcement, interfaces constraints.", count: 5, preview: "Avoid explicit any; enable strict null checks; mandate interfaces for API shapes." },
      { id: "rust-sec", title: "Rust Audit Standards", desc: "Handling safety, clippy configurations, thread safety patterns.", count: 6, preview: "Verify cargo clippy passes; isolate unsafe scopes; avoid unwrap() in library codes." }
    ],
    devops: [
      { id: "gha-deploy", title: "GitHub Actions CI/CD", desc: "Pipeline caching, lockfile checking, edge deployments.", count: 4, preview: "Secrets in wrangler.json; verify bundle size limits (< 150KB); run security scanners." },
      { id: "docker-hard", title: "Docker Container Security", desc: "Multi-stage builds, non-root runtimes, layer caching optimizations.", count: 5, preview: "Use alpine distroless base; never run as root; pin exact image SHA digest." }
    ],
    compliance: [
      { id: "soc2-controls", title: "SOC2 Compliance Baseline", desc: "Audit logging, access controls, token lifetimes.", count: 8, preview: "Rotate edge decryption keys every 90 days; log all D1 database accesses; require token scope audits." },
      { id: "gdpr-PII", title: "GDPR Masking & Erasure", desc: "PII isolation, data minimization, delete cascade safety.", count: 6, preview: "Encrypt email hashes; purge user-related vectorize logs on delete request; mask password hashes." }
    ]
  };

  const handleImport = (id: string) => {
    setImportingCard(id);
    setTimeout(() => {
      setImportingCard(null);
      setImportedStatus(prev => ({ ...prev, [id]: true }));
      setTimeout(() => {
        setImportedStatus(prev => ({ ...prev, [id]: false }));
      }, 3000);
    }, 1200);
  };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", textAlign: "left", fontFamily: "monospace" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", opacity: 0.7 }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)" }}>Templates Library</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", minHeight: 280 }}>
        <div style={{ borderRight: "1px solid var(--border)", background: "var(--surface2)", padding: "12px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
          {[
            { id: "coding", label: "Coding Standards" },
            { id: "devops", label: "DevOps & CI" },
            { id: "compliance", label: "Compliance" }
          ].map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id as any)}
              style={{
                fontSize: 10, padding: "6px 8px", textAlign: "left", borderRadius: 4, width: "100%",
                background: selectedCategory === cat.id ? "var(--accent-dim)" : "transparent",
                color: selectedCategory === cat.id ? "var(--text)" : "var(--text-muted)",
                border: "none", cursor: "pointer"
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", maxHeight: 280 }}>
          {templatesData[selectedCategory].map(t => (
            <div 
              key={t.id}
              style={{
                background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: 10,
                display: "flex", flexDirection: "column", gap: 6, transition: "border-color 0.2s"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>{t.title}</div>
                  <div style={{ fontSize: 9, color: "var(--text-muted)", marginTop: 2 }}>{t.desc}</div>
                </div>
                <button
                  onClick={() => handleImport(t.id)}
                  disabled={importingCard === t.id}
                  style={{
                    fontSize: 9, padding: "3px 8px", cursor: "pointer", borderRadius: 4, flexShrink: 0,
                    background: importedStatus[t.id] ? "rgba(34,197,94,0.15)" : "var(--accent)",
                    color: importedStatus[t.id] ? "var(--success)" : "#fff",
                    border: importedStatus[t.id] ? "1px solid var(--success)" : "none"
                  }}
                >
                  {importingCard === t.id ? "Importing..." : importedStatus[t.id] ? "✓ Imported" : "Import"}
                </button>
              </div>

              <div style={{
                background: "var(--surface)", borderLeft: "2px solid var(--accent)", padding: "4px 8px", fontSize: 9,
                color: "var(--text-muted)", whiteSpace: "normal", wordBreak: "break-word"
              }}>
                <span style={{ color: "var(--accent)", fontWeight: 600 }}>Rules preview:</span> {t.preview}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReviewQueueMockup() {
  const [items, setItems] = useState([
    {
      id: "rec-1",
      submittedBy: "dev-carl",
      project: "mobile-gateway",
      action: "commit_memory via Cline IDE",
      diffAdd: "+ Use kysely query builder with node-postgres driver.",
      diffSub: "- Use Prisma ORM clients inside edge handler loops.",
      reason: "Prisma client cold starts exceed Workers 50ms limits.",
      status: "pending"
    },
    {
      id: "rec-2",
      submittedBy: "devops-anna",
      project: "core-auth",
      action: "commit_memory via Copilot",
      diffAdd: "+ Enforce JWT signature verification with RS256 algorithm.",
      diffSub: "",
      reason: "Ensure compliance with security standards on auth verification endpoints.",
      status: "pending"
    }
  ]);

  const handleAction = (id: string, action: "approve" | "reject") => {
    setItems(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, status: action === "approve" ? "approved" : "rejected" };
      }
      return item;
    }));
  };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", textAlign: "left", fontFamily: "monospace" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", opacity: 0.7 }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)", flex: 1 }}>Org Governance Review Queue</span>
        <span style={{ fontSize: 10, background: "rgba(168,85,247,0.15)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
          {items.filter(i => i.status === "pending").length} Pending
        </span>
      </div>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12, minHeight: 280, maxHeight: 310, overflowY: "auto" }}>
        {items.map(item => (
          <div 
            key={item.id} 
            style={{ 
              background: "var(--surface2)", border: `1px solid ${item.status === "approved" ? "rgba(34,197,94,0.3)" : item.status === "rejected" ? "rgba(239,68,68,0.3)" : "var(--border)"}`, 
              borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6,
              opacity: item.status !== "pending" ? 0.75 : 1, transition: "all 0.3s ease"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10 }}>
              <span style={{ color: "var(--text-muted)" }}>
                By <strong style={{ color: "var(--text)" }}>{item.submittedBy}</strong> in <span style={{ color: "var(--accent)" }}>{item.project}</span>
              </span>
              <span style={{ fontSize: 9, opacity: 0.8 }}>{item.action}</span>
            </div>

            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "6px 8px", fontSize: 10, display: "flex", flexDirection: "column", gap: 2 }}>
              {item.diffSub && <div style={{ color: "#ef4444", textDecoration: "line-through" }}>{item.diffSub}</div>}
              {item.diffAdd && <div style={{ color: "#22c55e" }}>{item.diffAdd}</div>}
              <div style={{ fontSize: 9, color: "var(--text-muted)", borderTop: "1px dashed var(--border)", marginTop: 4, paddingTop: 4 }}>
                <span style={{ color: "var(--accent)" }}>Reason:</span> {item.reason}
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
              {item.status === "pending" ? (
                <>
                  <button 
                    onClick={() => handleAction(item.id, "reject")}
                    style={{ fontSize: 10, padding: "4px 10px", background: "transparent", border: "1px solid rgba(239,68,68,0.4)", color: "var(--error)", cursor: "pointer", borderRadius: 4 }}
                  >
                    Reject
                  </button>
                  <button 
                    onClick={() => handleAction(item.id, "approve")}
                    style={{ fontSize: 10, padding: "4px 12px", background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.4)", color: "var(--success)", fontWeight: 700, cursor: "pointer", borderRadius: 4 }}
                  >
                    Approve to Org Vault
                  </button>
                </>
              ) : item.status === "approved" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "var(--success)", fontWeight: 700 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                  Approved & Org Vault Locked (Authoritative) 🔒
                </div>
              ) : (
                <div style={{ fontSize: 10, color: "var(--error)", fontWeight: 700 }}>
                  Rejected Recommendation
                </div>
              )}
            </div>
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
    { label: "AI sends recall_context", color: "#a855f7", icon: "→" },
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
        API Tokens & Scopes
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {[{ name: "Claude Desktop", perms: [0, 1] }, { name: "Codex (read-only)", perms: [0] }].map((tok, i) => (
          <div key={i} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6, textAlign: "left" }}>{tok.name}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {tools.map((t, j) => (
                <span key={j} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: tok.perms.includes(j) ? "rgba(168,85,247,0.15)" : "rgba(255,255,255,0.03)", border: `1px solid ${tok.perms.includes(j) ? "rgba(168,85,247,0.4)" : "var(--border)"}`, color: tok.perms.includes(j) ? "var(--accent)" : "var(--text-muted)", fontFamily: "monospace" }}>
                  {tok.perms.includes(j) ? "✓" : "✗"} {t}
                </span>
              ))}
            </div>
          </div>
        ))}
        <div style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "var(--accent)", fontFamily: "monospace" }}>
          lkr_a8f3c2e1d9b7...  <span style={{ color: "var(--text-muted)" }}>shown once</span>
        </div>
      </div>
    </div>
  );
}

function PlatformGrid() {
  const tested = PLATFORMS.filter((p) => p.status === "tested");
  const testing = PLATFORMS.filter((p) => p.status === "testing");
  const comingSoon = PLATFORMS.filter((p) => p.status === "coming-soon");
  let delay = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, opacity: 0.7 }}>
          Tested & Supported
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center" }}>
          {tested.map((p) => {
            const d = delay;
            delay += 30;
            return (
              <FadeIn key={p.id} delay={d}>
                <div style={{ padding: "5px 13px", borderRadius: 20, background: `${p.color}15`, border: `1px solid ${p.color}40`, color: p.color, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
                  {p.label}
                </div>
              </FadeIn>
            );
          })}
        </div>
      </div>
      {testing.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, opacity: 0.6 }}>
            In Testing
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center" }}>
            {testing.map((p) => {
              const d = delay;
              delay += 25;
              return (
                <FadeIn key={p.id} delay={d}>
                  <div style={{ padding: "5px 13px", borderRadius: 20, background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.25)", color: "var(--accent)", fontSize: 12, fontWeight: 400, whiteSpace: "nowrap" }}>
                    {p.label}
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      )}
      <div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, opacity: 0.5 }}>
          Coming Soon
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, justifyContent: "center" }}>
          {comingSoon.map((p) => {
            const d = delay;
            delay += 20;
            return (
              <FadeIn key={p.id} delay={d}>
                <div style={{ padding: "5px 13px", borderRadius: 20, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12, fontWeight: 400, whiteSpace: "nowrap", opacity: 0.7 }}>
                  {p.label}
                </div>
              </FadeIn>
            );
          })}
        </div>
      </div>
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
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, padding: 16, fontFamily: "monospace", textAlign: "left" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>AES-256-GCM at rest</div>
      <div style={{ position: "relative", height: 64 }}>
        <div style={{ position: "absolute", inset: 0, padding: "10px 12px", borderRadius: 8, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", fontSize: 11, color: "#22c55e", lineHeight: 1.5, opacity: flipped ? 0 : 1, transition: "opacity 0.5s ease" }}>
          <span style={{ color: "var(--text-muted)", fontSize: 10 }}>plaintext </span>{plain}
        </div>
        <div style={{ position: "absolute", inset: 0, padding: "10px 12px", borderRadius: 8, background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.25)", fontSize: 10, color: "var(--accent)", lineHeight: 1.5, wordBreak: "break-all", opacity: flipped ? 1 : 0, transition: "opacity 0.5s ease" }}>
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
    <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 14, background: "var(--accent-dim)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 20, padding: "4px 12px" }}>
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
        style={{ background: "var(--surface)", border: `1px solid ${hovered ? "rgba(168,85,247,0.4)" : "var(--border)"}`, borderRadius: 12, padding: "22px 20px", height: "100%", transition: "border-color 0.2s, transform 0.2s, box-shadow 0.2s", transform: hovered ? "translateY(-3px)" : "none", boxShadow: hovered ? "0 8px 24px rgba(168,85,247,0.12)" : "none", textAlign: "left" }}
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
    <FadeIn delay={delay} style={{ display: "flex", gap: 18, textAlign: "left" }}>
      <div style={{ flexShrink: 0, width: 40, height: 40, borderRadius: "50%", background: "var(--accent-dim)", border: "1px solid rgba(168,85,247,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "var(--accent)" }}>
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
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#logo-grad-hero)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <defs>
                  <linearGradient id="logo-grad-hero" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="var(--accent)" />
                    <stop offset="100%" stopColor="#a855f7" />
                  </linearGradient>
                </defs>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeWidth="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeWidth="2" />
                <path d="M9 14.5h6M9 16.5h6M9 18.5h6M11 11v11M13 11v11" strokeWidth="1" opacity="0.6" />
                <rect x="9.5" y="14" width="5" height="5" rx="0.5" fill="var(--accent)" stroke="url(#logo-grad-hero)" strokeWidth="1" />
              </svg>
            </div>
          </div>

          <div style={{ opacity: heroVisible ? 1 : 0, transform: heroVisible ? "none" : "translateY(24px)", transition: "opacity 0.7s ease 0.1s, transform 0.7s ease 0.1s" }}>
            <h1 style={{ fontSize: "clamp(36px, 6vw, 60px)", fontWeight: 800, letterSpacing: "-0.04em", color: "var(--text)", lineHeight: 1.1, marginBottom: 20 }}>
              The Context & Rule Engine for{" "}
              <span style={{ color: "var(--accent)" }}>AI-Native Engineering</span>
            </h1>
            <p style={{ fontSize: 18, color: "var(--text-muted)", lineHeight: 1.7, maxWidth: 640, margin: "0 auto 36px", fontWeight: 400 }}>
              Standardize developer tribal knowledge, enforce architectural standards, and sync agent files across your team. Secure, edge-native memory vaults powered by the Model Context Protocol (MCP).
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
            { value: PLATFORMS.filter((p) => p.status === "tested").length, suffix: "", label: "Supported AI Clients" },
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
                Define your project's programming language, framework, database, and ORM. Locker generates optimized `.cursorrules`, `CLAUDE.md`, `copilot-instructions.md`, `GEMINI.md`, `.codexrules`, `.antigravityrules`, and `AGENTS.md` configurations dynamically to prevent context drift and token overhead.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {["Tailored coding constraints generated dynamically", "Compatible with Cursor, Claude, Copilot, and Gemini", "Optimized instructions reduce context-window waste", "Download configurations directly into your repo"].map((item) => (
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
                  {["recall_context — semantic vector query of facts", "commit_memory — persist new rules directly from prompt sessions", "Edge-distributed vector search under 50ms", "JSON-RPC 2.0 transport over secure HTTP"].map((item) => (
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
                  Ensure team-wide context remains reliable. Developers can suggest rules from their IDE agents, which queue inside the Recommendation Dashboard. Approving them promotes them to the Authoritative Org Vault.
                </p>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                  {["Proposed agent updates enqueued automatically", "Full markdown diff view for auditing change intents", "Authoritative rules override personal context", "Enforce security standards team-wide"].map((item) => (
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
                Fine-grained access control & scopes
              </h2>
              <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.8, marginBottom: 24 }}>
                Generate Bearer tokens with per-tool permission bitmasks. Give your coding assistant read-only access, while letting your personal Claude write new memories mid-session.
              </p>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
                {["Tokens stored as SHA-256 hashes only", "Shown once at creation, never again", "Toggle recall_context and commit_memory independently", "Revoke any token instantly"].map((item) => (
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
            <Step num="1" title="Build or Import Context" desc="Run the Tech Stack Wizard to output target constraints, or ingest pre-built memory templates and chatbot exports." delay={0} />
            <Step num="2" title="Extract & Tag Rules" desc="Locker automatically indexes, labels, and encrypts facts before writing them as discrete records into the database." delay={100} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
            <Step num="3" title="Bind Universal MCP Endpoint" desc="Expose your Locker context to Cursor, Claude Desktop, Copilot, or CLI clients using your secure bearer token." delay={200} />
            <Step num="4" title="Execute with Precise Context" desc="IDE agents access updated codebase context and organizational rules automatically on every prompt cycle." delay={300} />
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
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, title: "End-to-end encryption", desc: "AES-256-GCM on every fact. Database rows are ciphertext only.", delay: 0 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>, title: "Semantic vector search", desc: "Cloudflare Vectorize powers fuzzy recall — find facts by meaning, not just keywords.", delay: 60 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>, title: "Tech Stack Wizard", desc: "Instantly compile optimized .cursorrules, CLAUDE.md, and AGENTS.md files tailored to your development stack.", delay: 120 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>, title: "Memory Templates", desc: "Deploy pre-built coding guidelines, DevOps runbooks, and SOC2 compliance controls directly to developer agents.", delay: 180 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, title: "Review & Approval Queue", desc: "Review context suggestions made by developer agents before merging them production-wide.", delay: 240 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>, title: "Authoritative Org Vault", desc: "Lock critical standards inside organization scopes. Authoritative rules always take precedence in agent contexts.", delay: 300 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, title: "Per-Token Scopes", desc: "Configure bitmask permissions to toggle read-only recall_context and write-access commit_memory capabilities.", delay: 360 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/></svg>, title: "Cloudflare Edge Native", desc: "Zero-servers to manage. Runs entirely on Cloudflare Workers, Cloudflare D1, and Cloudflare Vectorize.", delay: 420 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>, title: "In-App Notifications", desc: "Receive immediate toasts and notifications when agent-committed rules require TPM or DevOps review.", delay: 480 },
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
            Expose context to your entire toolkit. Claude Code (CLI, Extension, Web), ChatGPT, and Antigravity 2.0 (Editor & CLI) are fully verified. Configuration scripts are provided to hook up all major MCP clients.
          </p>
        </FadeIn>
        <PlatformGrid />
        <FadeIn delay={600}>
          <div style={{ marginTop: 36 }}>
            <Link to="/docs" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 22px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13, fontWeight: 500, borderRadius: 8, textDecoration: "none", transition: "border-color 0.15s, color 0.15s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent)"; (e.currentTarget as HTMLElement).style.color = "var(--text)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.color = "var(--text-muted)"; }}
            >
              View config guides →
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
          {PLAN_ORDER.map((planId) => (
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
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
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
