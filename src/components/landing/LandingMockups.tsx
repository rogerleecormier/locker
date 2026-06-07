import { useEffect, useState } from "react";

export function HeroStackCreatorMockup() {
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
      <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--surface2)" }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", opacity: 0.7 }} />
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", opacity: 0.7 }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "var(--text-muted)", flex: 1 }}>Stack Blueprint Wizard</span>
      </div>

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

        {step === 2 && (
          <div>
            <PillSelect label="Frontend" value={frontend} options={["React / TanStack", "Next.js", "Svelte / SvelteKit", "Vue / Nuxt"]} onChange={setFrontend} />
            <PillSelect label="Styling" value={styling} options={["Vanilla CSS", "Tailwind CSS", "CSS Modules", "Sass/SCSS"]} onChange={setStyling} />
            <NavButtons prevStep={1} nextStep={3} nextLabel="Infrastructure →" />
          </div>
        )}

        {step === 3 && (
          <div>
            <PillSelect label="Hosting" value={hosting} options={["Cloudflare Edge", "Vercel", "Netlify", "Fly.io"]} onChange={setHosting} />
            <PillSelect label="Database" value={db} options={["Cloudflare D1", "PostgreSQL", "Supabase (Postgres)", "SQLite"]} onChange={setDb} />
            <PillSelect label="ORM" value={orm} options={["Drizzle ORM", "Prisma", "Kysely", "SQL (Raw)"]} onChange={setOrm} />
            <NavButtons prevStep={2} nextStep={4} nextLabel="Extra Specs →" />
          </div>
        )}

        {step === 4 && (
          <div>
            <PillSelect label="Auth" value={auth} options={["Better Auth", "Auth.js", "Clerk", "Custom"]} onChange={setAuth} />
            <NavButtons prevStep={3} nextStep={5} nextLabel="Preview Output →" />
          </div>
        )}

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

export function MemoryTemplatesMockup() {
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const templates = [
    { id: "ts-defaults",  name: "TypeScript Defaults",      category: "configs",    rules: 5, vars: 0, desc: "Strict mode, null checks, interface conventions." },
    { id: "code-review",  name: "Code Review Checklist",    category: "configs",    rules: 6, vars: 0, desc: "Security vulnerabilities, test coverage, error handling." },
    { id: "gha-deploy",   name: "GitHub Actions CI/CD",     category: "devops",     rules: 4, vars: 2, desc: "Pipeline caching, lockfile checks, edge deployments." },
    { id: "soc2",         name: "SOC2 Compliance Baseline", category: "compliance", rules: 8, vars: 0, desc: "Audit logging, access controls, token lifetimes." },
  ];

  const categoryColor: Record<string, string> = {
    configs: "#22c55e", devops: "#3b82f6", compliance: "#f59e0b", governance: "#a855f7", documentation: "#06b6d4",
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

      <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)", display: "grid", gridTemplateColumns: "20px 1fr 80px 80px", gap: 10, alignItems: "center", background: "var(--surface2)" }}>
        <input type="checkbox" readOnly style={{ cursor: "pointer", accentColor: "var(--accent)" }} />
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{selected.size > 0 ? `${selected.size} selected` : `${templates.length} templates`}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "center" }}>Category</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right" }}>Actions</span>
      </div>

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

export function ReviewQueueMockup() {
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

  const categoryColor: Record<string, string> = { rules: "#a855f7", projects: "#3b82f6", references: "#f59e0b", configs: "#22c55e" };

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

            <p style={{ fontSize: 11, color: "var(--text)", lineHeight: 1.55, margin: 0 }}>
              "{item.fact}"
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 20, background: `${categoryColor[item.category]}18`, border: `1px solid ${categoryColor[item.category]}40`, color: categoryColor[item.category], fontWeight: 600 }}>
                {item.category}
              </span>
              <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontFamily: "monospace" }}>
                {item.tags}
              </span>
            </div>

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

export function McpCallMockup() {
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

export function TokenMockup() {
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

export function EncryptionMockup() {
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
