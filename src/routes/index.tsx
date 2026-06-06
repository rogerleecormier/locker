import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { PLATFORMS } from "../lib/platforms";
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
  const [name, setName] = useState("My App Stack");
  const [lang, setLang] = useState("TypeScript");
  const [frontend, setFrontend] = useState("React / TanStack");
  const [styling, setStyling] = useState("Vanilla CSS");
  const [hosting, setHosting] = useState("Cloudflare Edge");
  const [db, setDb] = useState("Cloudflare D1");
  const [orm, setOrm] = useState("Drizzle ORM");
  const [auth, setAuth] = useState("Better Auth");
  const [activeFormat, setActiveFormat] = useState<"cursor" | "claude" | "antigravity" | "agents">("cursor");
  const [copied, setCopied] = useState(false);

  const STEPS = ["Metadata", "Core Tech", "Infra", "Extra", "Preview"];
  const TOTAL = STEPS.length;

  const getPreview = () => {
    const rules = [
      lang === "TypeScript" ? "Always enforce strict null checks; avoid explicit any." : lang === "Go" ? "Check all err return values explicitly; never ignore errors." : "Enforce type hints and adhere to PEP8 formatting.",
      frontend.includes("React") ? "Keep components modular; split complex logic into custom hooks." : frontend.includes("Next") ? "Leverage React Server Components to minimize client bundle." : "Keep JS modules small and single-purpose.",
      db === "Cloudflare D1" ? "Batch SQL statements to optimize Workers execution timeouts." : "Use connection pooling; avoid N+1 query patterns.",
      orm === "Drizzle ORM" ? "Perform schema updates via Drizzle Kit declarative migrations." : "Define all models explicitly; avoid implicit schema changes.",
      hosting === "Cloudflare Edge" ? "Keep Worker bundle under 1MB; avoid Node-only modules." : "Ensure all secrets are in env vars, never in source.",
    ];
    if (activeFormat === "cursor") return JSON.stringify({ name, description: `${lang} + ${frontend} stack blueprint`, globs: ["*"], rules }, null, 2);
    const titles: Record<string, [string, string]> = { claude: ["Claude System Instructions", "Enforced Guidelines"], antigravity: ["Antigravity Rules", "Guidelines"], agents: ["Developer Agent Rules", "Guidelines"] };
    const [title, section] = titles[activeFormat] ?? ["Rules", "Guidelines"];
    return `# ${title}\n\n## ${section}\n${rules.map(r => `- ${r}`).join("\n")}`;
  };

  const handleCopy = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const PillSelect = ({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {options.map(o => (
          <button key={o} onClick={() => onChange(o)} style={{
            padding: "4px 10px", fontSize: 10, borderRadius: 20, cursor: "pointer",
            background: value === o ? "var(--accent-dim)" : "var(--surface2)",
            border: `1px solid ${value === o ? "var(--accent)" : "var(--border)"}`,
            color: value === o ? "var(--accent)" : "var(--text-muted)",
            fontWeight: value === o ? 700 : 400,
          }}>{o}</button>
        ))}
      </div>
    </div>
  );

  const NavButtons = ({ prevStep, nextStep, nextLabel }: { prevStep?: number; nextStep?: number; nextLabel?: string }) => (
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      {prevStep !== undefined && (
        <button onClick={() => setStep(prevStep)} style={{ flex: 1, padding: "8px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, cursor: "pointer", borderRadius: 6 }}>← Back</button>
      )}
      {nextStep !== undefined && (
        <button onClick={() => setStep(nextStep)} style={{ flex: 2, padding: "8px", background: "var(--accent)", color: "#fff", fontSize: 10, fontWeight: 700, cursor: "pointer", borderRadius: 6, border: "none" }}>
          {nextLabel ?? "Next →"}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", textAlign: "left", fontFamily: "monospace" }}>
      {/* Title bar */}
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", opacity: 0.7 }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)", flex: 1 }}>Stack Blueprint Wizard</span>
      </div>

      {/* Step tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}>
        {STEPS.map((label, i) => {
          const s = i + 1;
          const active = step === s;
          const done = step > s;
          return (
            <button key={s} onClick={() => done && setStep(s)} style={{
              flex: 1, minWidth: 0, padding: "7px 2px", fontSize: 9, fontWeight: active ? 700 : 500,
              background: "transparent", border: "none",
              borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
              color: active ? "var(--accent)" : done ? "var(--text-muted)" : "rgba(128,128,160,0.4)",
              cursor: done ? "pointer" : "default",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
              marginBottom: -1, whiteSpace: "nowrap", overflow: "hidden",
            }}>
              <span style={{
                width: 14, height: 14, borderRadius: "50%", fontSize: 8, fontWeight: 700, flexShrink: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                background: active ? "var(--accent)" : done ? "rgba(168,85,247,0.25)" : "var(--border)",
                color: active ? "#fff" : done ? "var(--accent)" : "rgba(128,128,160,0.4)",
              }}>{done ? "✓" : s}</span>
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ padding: 16, minHeight: 240 }}>
        {/* Step 1: Metadata */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ fontSize: 9, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>Template Name</div>
              <input value={name} onChange={e => setName(e.target.value)} style={{ width: "100%", padding: "7px 10px", fontSize: 11, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", outline: "none", boxSizing: "border-box" }} placeholder="e.g. My App Stack" />
            </div>
            <PillSelect label="Language" value={lang} options={["TypeScript", "Python", "Go", "Rust"]} onChange={setLang} />
            <NavButtons nextStep={2} nextLabel="Core Tech →" />
          </div>
        )}

        {/* Step 2: Core Tech */}
        {step === 2 && (
          <div>
            <PillSelect label="Frontend" value={frontend} options={["React / TanStack", "Next.js", "Svelte / SvelteKit", "Vue / Nuxt"]} onChange={setFrontend} />
            <PillSelect label="Styling" value={styling} options={["Vanilla CSS", "Tailwind CSS", "CSS Modules", "Sass/SCSS"]} onChange={setStyling} />
            <NavButtons prevStep={1} nextStep={3} nextLabel="Infrastructure →" />
          </div>
        )}

        {/* Step 3: Infrastructure */}
        {step === 3 && (
          <div>
            <PillSelect label="Hosting" value={hosting} options={["Cloudflare Edge", "Vercel", "Netlify", "Fly.io"]} onChange={setHosting} />
            <PillSelect label="Database" value={db} options={["Cloudflare D1", "PostgreSQL", "Supabase (Postgres)", "SQLite"]} onChange={setDb} />
            <PillSelect label="ORM" value={orm} options={["Drizzle ORM", "Prisma", "Kysely", "SQL (Raw)"]} onChange={setOrm} />
            <NavButtons prevStep={2} nextStep={4} nextLabel="Extra Specs →" />
          </div>
        )}

        {/* Step 4: Additional Specs */}
        {step === 4 && (
          <div>
            <PillSelect label="Auth" value={auth} options={["Better Auth", "Auth.js", "Clerk", "Custom"]} onChange={setAuth} />
            <NavButtons prevStep={3} nextStep={5} nextLabel="Preview Output →" />
          </div>
        )}

        {/* Step 5: Preview */}
        {step === TOTAL && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--border)", paddingBottom: 8, flexWrap: "wrap" }}>
              {(["cursor", "claude", "antigravity", "agents"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveFormat(tab)} style={{
                  fontSize: 9, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                  background: activeFormat === tab ? "var(--accent-dim)" : "transparent",
                  border: `1px solid ${activeFormat === tab ? "var(--accent)" : "var(--border)"}`,
                  color: activeFormat === tab ? "var(--accent)" : "var(--text-muted)",
                  fontWeight: activeFormat === tab ? 700 : 400,
                }}>
                  {tab === "cursor" ? ".cursorrules" : tab === "claude" ? "CLAUDE.md" : tab === "antigravity" ? "rules.md" : "AGENTS.md"}
                </button>
              ))}
              <button onClick={handleCopy} style={{
                marginLeft: "auto", fontSize: 9, padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                background: copied ? "rgba(34,197,94,0.15)" : "var(--surface2)",
                border: `1px solid ${copied ? "var(--success)" : "var(--border)"}`,
                color: copied ? "var(--success)" : "var(--text-muted)",
              }}>{copied ? "✓ Copied" : "Copy"}</button>
            </div>
            <pre style={{ background: "var(--surface2)", padding: 10, borderRadius: 6, fontSize: 9, color: "var(--text)", lineHeight: 1.45, overflowY: "auto", height: 130, whiteSpace: "pre-wrap", border: "1px solid var(--border)", margin: 0 }}>
              {getPreview()}
            </pre>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setStep(4)} style={{ flex: 1, padding: "7px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, cursor: "pointer", borderRadius: 6 }}>← Back</button>
              <button onClick={() => { setStep(1); setName("My App Stack"); }} style={{ flex: 1, padding: "7px", background: "transparent", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 10, cursor: "pointer", borderRadius: 6 }}>Reset</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MemoryTemplatesMockup() {
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const templates = [
    { id: "ts-defaults",  name: "TypeScript Defaults",      category: "stack",      rules: 5, vars: 0, desc: "Strict mode, null checks, interface conventions." },
    { id: "code-review",  name: "Code Review Checklist",    category: "stack",      rules: 6, vars: 0, desc: "Security vulnerabilities, test coverage, error handling." },
    { id: "gha-deploy",   name: "GitHub Actions CI/CD",     category: "devops",     rules: 4, vars: 2, desc: "Pipeline caching, lockfile checks, edge deployments." },
    { id: "soc2",         name: "SOC2 Compliance Baseline", category: "compliance", rules: 8, vars: 0, desc: "Audit logging, access controls, token lifetimes." },
  ];

  const categoryColor: Record<string, string> = {
    stack: "#22c55e", devops: "#3b82f6", compliance: "#f59e0b", governance: "#a855f7", documentation: "#06b6d4",
  };

  const handleImport = (id: string) => {
    setImportingId(id);
    setTimeout(() => {
      setImportingId(null);
      setImportedIds(prev => new Set([...prev, id]));
      setTimeout(() => setImportedIds(prev => { const n = new Set(prev); n.delete(id); return n; }), 3000);
    }, 1100);
  };

  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", textAlign: "left" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", opacity: 0.7 }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)", flex: 1 }}>Memory Templates</span>
        <span style={{ fontSize: 10, background: "var(--accent-dim)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
          {templates.length} templates
        </span>
      </div>

      {/* Table header */}
      <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "20px 1fr 80px 80px", gap: 10, alignItems: "center", background: "var(--surface2)" }}>
        <input type="checkbox" readOnly style={{ cursor: "pointer", accentColor: "var(--accent)" }} />
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{selected.size > 0 ? `${selected.size} selected` : `${templates.length} templates`}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>Category</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Actions</span>
      </div>

      {/* Rows */}
      <div style={{ display: "flex", flexDirection: "column", maxHeight: 240, overflowY: "auto" }}>
        {templates.map(t => (
          <div
            key={t.id}
            style={{
              padding: "10px 14px", borderBottom: "1px solid var(--border)",
              display: "grid", gridTemplateColumns: "20px 1fr 80px 80px", gap: 10, alignItems: "center",
              background: selected.has(t.id) ? "rgba(168,85,247,0.04)" : "transparent",
            }}
          >
            <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelect(t.id)} style={{ cursor: "pointer", accentColor: "var(--accent)" }} />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t.name}</span>
                <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 20, background: "rgba(59,130,246,0.15)", border: "1px solid rgba(59,130,246,0.3)", color: "#60a5fa", fontWeight: 600 }}>
                  {t.rules} Rules
                </span>
                {t.vars > 0 && (
                  <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 20, background: "var(--accent-dim)", border: "1px solid rgba(168,85,247,0.3)", color: "var(--accent)", fontWeight: 600 }}>
                    {t.vars} Vars
                  </span>
                )}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{t.desc}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <span style={{ fontSize: 9, padding: "2px 8px", borderRadius: 20, background: `${categoryColor[t.category]}18`, border: `1px solid ${categoryColor[t.category]}40`, color: categoryColor[t.category], fontWeight: 600 }}>
                {t.category}
              </span>
            </div>
            <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
              <button
                onClick={() => handleImport(t.id)}
                disabled={importingId === t.id}
                style={{
                  fontSize: 9, padding: "3px 7px", cursor: "pointer", borderRadius: 4,
                  background: importedIds.has(t.id) ? "rgba(34,197,94,0.15)" : "transparent",
                  color: importedIds.has(t.id) ? "var(--success)" : "var(--text-muted)",
                  border: `1px solid ${importedIds.has(t.id) ? "rgba(34,197,94,0.4)" : "var(--border)"}`,
                }}
              >
                {importingId === t.id ? "…" : importedIds.has(t.id) ? "✓" : "Import"}
              </button>
              <button style={{ fontSize: 9, padding: "3px 7px", cursor: "pointer", borderRadius: 4, background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewQueueMockup() {
  const [items, setItems] = useState([
    { id: "rec-1", category: "rules", recommendationType: "add", fact: "Use kysely query builder instead of Prisma inside edge handler loops — Prisma cold starts exceed Workers limits.", tags: "database, edge, performance", status: "pending", date: "Jun 3, 2026", notes: "" },
    { id: "rec-2", category: "rules", recommendationType: "add", fact: "Enforce JWT signature verification with RS256 algorithm on all auth endpoints.", tags: "security, auth, compliance", status: "pending", date: "Jun 4, 2026", notes: "" },
  ]);
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  const handleAction = (id: string, action: "approve" | "reject") => {
    setItems(prev => prev.map(item =>
      item.id === id ? { ...item, status: action === "approve" ? "approved" : "rejected", notes: notesMap[id] ?? "" } : item
    ));
  };

  const categoryColor: Record<string, string> = { rules: "#a855f7", projects: "#3b82f6", references: "#f59e0b", stack: "#22c55e" };

  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", textAlign: "left" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", opacity: 0.7 }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)", flex: 1 }}>Review Queue</span>
        <span style={{ fontSize: 10, background: "rgba(168,85,247,0.15)", color: "var(--accent)", border: "1px solid rgba(168,85,247,0.3)", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
          {items.filter(i => i.status === "pending").length} Pending
        </span>
      </div>

      <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, minHeight: 280, maxHeight: 320, overflowY: "auto" }}>
        {items.map(item => (
          <div
            key={item.id}
            style={{
              background: "var(--surface2)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10,
              border: `1px solid ${item.status === "approved" ? "rgba(34,197,94,0.25)" : item.status === "rejected" ? "rgba(239,68,68,0.25)" : "var(--border)"}`,
              opacity: item.status !== "pending" ? 0.7 : 1, transition: "all 0.3s ease",
            }}
          >
            {/* Status row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em",
                padding: "2px 8px", borderRadius: 20,
                background: item.status === "approved" ? "rgba(34,197,94,0.12)" : item.status === "rejected" ? "rgba(239,68,68,0.12)" : "rgba(251,191,36,0.12)",
                border: `1px solid ${item.status === "approved" ? "rgba(34,197,94,0.3)" : item.status === "rejected" ? "rgba(239,68,68,0.3)" : "rgba(251,191,36,0.3)"}`,
                color: item.status === "approved" ? "var(--success)" : item.status === "rejected" ? "var(--error)" : "#fbbf24",
              }}>
                {item.status}
              </span>
              <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{item.date}</span>
            </div>

            {/* Fact */}
            <p style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.55, margin: 0 }}>
              "{item.fact}"
            </p>

            {/* Category + tags */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 20, background: `${categoryColor[item.category]}18`, border: `1px solid ${categoryColor[item.category]}40`, color: categoryColor[item.category], fontWeight: 600 }}>
                {item.category}
              </span>
              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "monospace" }}>
                {item.tags}
              </span>
            </div>

            {/* Review notes + actions (pending only) */}
            {item.status === "pending" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                <input
                  type="text"
                  placeholder="Review notes (optional)"
                  value={notesMap[item.id] ?? ""}
                  onChange={e => setNotesMap(prev => ({ ...prev, [item.id]: e.target.value }))}
                  style={{ fontSize: 10, padding: "5px 8px", borderRadius: 6, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", outline: "none" }}
                />
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button
                    onClick={() => handleAction(item.id, "reject")}
                    style={{ fontSize: 10, padding: "4px 10px", cursor: "pointer", borderRadius: 4, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", fontWeight: 600 }}
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleAction(item.id, "approve")}
                    style={{ fontSize: 10, padding: "4px 12px", cursor: "pointer", borderRadius: 4, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.35)", color: "var(--success)", fontWeight: 700 }}
                  >
                    Approve
                  </button>
                </div>
              </div>
            )}

            {/* Review notes display (post-review) */}
            {item.status !== "pending" && item.notes && (
              <div style={{ fontSize: 10, color: "var(--text-muted)", background: "var(--surface)", borderLeft: "2px solid var(--accent)", padding: "4px 8px", borderRadius: 4 }}>
                <strong>Notes:</strong> {item.notes}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function McpCallMockup() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % 5), 1800);
    return () => clearInterval(id);
  }, []);
  const steps = [
    { label: "AI sends recall_context", color: "#a855f7", icon: "→" },
    { label: "Bearer token verified", color: "#22c55e", icon: "🔑" },
    { label: "RRF fusion: semantic + keyword + recency ranks", color: "#fbbf24", icon: "⚡" },
    { label: "Graph expansion via entity IDs", color: "#f97316", icon: "🕸" },
    { label: "RRF-ranked, decrypted facts returned", color: "#818cf8", icon: "←" },
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
  const humanTools = ["recall_context", "commit_memory", "update_memory", "delete_memory"];
  return (
    <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface2)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        API Tokens & Scopes
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {[{ name: "Claude Desktop", perms: [0, 1, 2, 3] }, { name: "Codex (read-only)", perms: [0] }].map((tok, i) => (
          <div key={i} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", marginBottom: 6, textAlign: "left" }}>{tok.name}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {humanTools.map((t, j) => (
                <span key={j} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: tok.perms.includes(j) ? "rgba(168,85,247,0.15)" : "rgba(255,255,255,0.03)", border: `1px solid ${tok.perms.includes(j) ? "rgba(168,85,247,0.4)" : "var(--border)"}`, color: tok.perms.includes(j) ? "var(--accent)" : "var(--text-muted)", fontFamily: "monospace" }}>
                  {tok.perms.includes(j) ? "✓" : "✗"} {t}
                </span>
              ))}
            </div>
          </div>
        ))}
        {/* Agent token with ABAC policy */}
        <div style={{ background: "var(--surface2)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", textAlign: "left" }}>Deploy Pipeline Bot</span>
            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.04em" }}>Agent</span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6, fontStyle: "italic" }}>deploy pipeline · allowed: stack, rules · tags: #architecture, #internal · credentials: denied</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {["stack ✓", "rules ✓", "projects ✗", "references ✗", "#architecture ✓", "#internal ✓", "#confidential 🔐", "credentials ✗"].map((label, j) => (
              <span key={j} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: label.includes("✓") ? "rgba(168,85,247,0.1)" : label.includes("🔐") ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${label.includes("✓") ? "rgba(168,85,247,0.3)" : label.includes("🔐") ? "rgba(245,158,11,0.3)" : "var(--border)"}`, color: label.includes("✓") ? "var(--accent)" : label.includes("🔐") ? "#f59e0b" : "var(--text-muted)", fontFamily: "monospace" }}>
                {label}
              </span>
            ))}
          </div>
        </div>
        <div style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 8, padding: "8px 12px", fontSize: 11, color: "var(--accent)", fontFamily: "monospace" }}>
          lkr_a8f3c2e1d9b7...  <span style={{ color: "var(--text-muted)" }}>shown once</span>
        </div>
      </div>
    </div>
  );
}

function PlatformScroller() {
  const pills = [...PLATFORMS, ...PLATFORMS];
  return (
    <div style={{ position: "relative", overflow: "hidden", width: "100%" }}>
      <div style={{
        position: "absolute", left: 0, top: 0, bottom: 0, width: 64,
        background: "linear-gradient(to right, var(--bg, #0a0a0f), transparent)",
        zIndex: 1, pointerEvents: "none"
      }} />
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 64,
        background: "linear-gradient(to left, var(--bg, #0a0a0f), transparent)",
        zIndex: 1, pointerEvents: "none"
      }} />
      <style>{`
        @keyframes scroll-left {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .platform-track {
          display: flex;
          gap: 8px;
          width: max-content;
          animation: scroll-left 32s linear infinite;
        }
        .platform-track:hover { animation-play-state: paused; }
      `}</style>
      <div className="platform-track">
        {pills.map((p, i) => (
          <div
            key={`${p.id}-${i}`}
            style={{
              padding: "5px 14px", borderRadius: 20,
              background: `${p.color}15`, border: `1px solid ${p.color}40`,
              color: p.color, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {p.label}
          </div>
        ))}
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
            <Step num="1" title="Build or Import Context" desc="Run the Tech Stack Wizard to output target constraints, or ingest pre-built memory templates and chatbot exports." delay={0} />
            <Step num="2" title="Extract, Tag & Graph-Enrich" desc="DLP scans and encrypts facts under a per-vault DEK. Workers AI simultaneously extracts entity nodes and edges, building a GraphRAG knowledge graph." delay={100} />
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
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, title: "Envelope encryption", desc: "AES-256-GCM with per-vault DEKs wrapped by a KEK. Database + env var must both be compromised to decrypt anything.", delay: 0 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>, title: "GraphRAG hybrid retrieval", desc: "Semantic (bge-m3), keyword, and recency ranks fused via RRF with GraphRAG entity expansion. Includes Llama-3.3-70B cross-encoder reranking and optional system-prompt synthesis.", delay: 60 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>, title: "Tech Stack Wizard", desc: "Instantly compile optimized .cursorrules, CLAUDE.md, and AGENTS.md files tailored to your development stack.", delay: 120 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 5v14M5 12l7 7 7-7"/></svg>, title: "Memory Templates", desc: "Deploy pre-built coding guidelines, DevOps runbooks, and SOC2 compliance controls directly to developer agents.", delay: 180 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>, title: "Review & Approval Queue", desc: "Agent mutations are held in the approval queue. The Vault Actions panel displays color-coded cards to easily review, approve, or deny actions.", delay: 240 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>, title: "Authoritative Org Vault", desc: "Lock critical standards inside organization scopes. Authoritative rules always take precedence in agent contexts.", delay: 300 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>, title: "Per-Token Scopes", desc: "Configure bitmask permissions to toggle read-only recall_context and write-access commit_memory capabilities.", delay: 360 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/><circle cx="12" cy="16" r="1"/></svg>, title: "Cloudflare Edge Native", desc: "Zero-servers to manage. Runs entirely on Cloudflare Workers, Cloudflare D1, and Cloudflare Vectorize.", delay: 420 },
              { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>, title: "Non-Destructive DLP", desc: "High-entropy secrets and PII are quarantined at write time. Agents receive redacted placeholders; authorized humans can unmask facts in the dashboard.", delay: 480 },
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
