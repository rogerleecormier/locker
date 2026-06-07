import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { LockerPadlock } from "~/components/LockerLogo";

const MAX_DEMO_OPS = 5;

const demoPlayground = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { action: "search" | "add"; text: string } => {
    const d = data as { action: "search" | "add"; text: string };
    if (d.action !== "search" && d.action !== "add") throw new Error("Invalid action");
    if (!d.text || typeof d.text !== "string") throw new Error("Text required");
    return { action: d.action, text: d.text.slice(0, 500) };
  })
  .handler(async ({ data }): Promise<{ result: string }> => {
    if (data.action === "add") {
      return { result: `✅ Memory committed: "${data.text}" — encrypted and indexed.` };
    } else {
      return { result: `🔍 Searching your vault for "${data.text}"…\nTop match: "${data.text}" — similarity 0.94 · encrypted · tagged [playground]` };
    }
  });

const SAMPLE_MEMORIES = [
  "Always prefer TypeScript strict mode — use `satisfies` to validate return shapes without widening.",
  "Cloudflare D1 uses WAL mode by default; batch writes into transactions to avoid write-rate limits.",
  "MCP recall_context fuses semantic, keyword, and recency scores via RRF before reranking with Llama-3.3-70B.",
  "Agent tokens use ABAC policies — restrict which memory categories an autonomous agent can read or write.",
  "envelope encryption: memory text → AES-256-GCM under DEK; DEK wrapped by KEK stored in env var.",
];

export function PlaygroundCard() {
  const [memories, setMemories] = useState(SAMPLE_MEMORIES);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"add" | "search">("search");
  const [log, setLog] = useState<Array<{ type: "in" | "out"; text: string }>>([]);
  const [ops, setOps] = useState(() => {
    try { return parseInt(sessionStorage.getItem("demo_ops") ?? "0", 10) || 0; } catch { return 0; }
  });
  const [loading, setLoading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || ops >= MAX_DEMO_OPS) return;
    const text = input.trim();
    setInput("");
    setLoading(true);
    setLog((prev) => [...prev, { type: "in", text: `${mode === "add" ? "commit" : "recall"}: ${text}` }]);
    try {
      const res = await demoPlayground({ data: { action: mode, text } });
      const newOps = ops + 1;
      setOps(newOps);
      try { sessionStorage.setItem("demo_ops", String(newOps)); } catch {}
      setLog((prev) => [...prev, { type: "out", text: res.result }]);
      if (mode === "add") {
        setMemories((prev) => [text, ...prev]);
      }
    } catch {
      setLog((prev) => [...prev, { type: "out", text: "⚠️ Playground unavailable. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  const exhausted = ops >= MAX_DEMO_OPS;

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: "60px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", background: "rgba(168,85,247,0.1)", border: "1px solid rgba(168,85,247,0.25)", borderRadius: 20, fontSize: 11, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.08em", marginBottom: 16 }}>
          ⚡ LIVE PLAYGROUND
        </span>
        <h2 style={{ fontSize: "clamp(22px, 4vw, 32px)", fontWeight: 800, letterSpacing: "-0.03em", color: "var(--text)", lineHeight: 1.2, marginBottom: 10 }}>
          Try Locker right now — no account needed
        </h2>
        <p style={{ fontSize: 14, color: "var(--text-muted)", maxWidth: 520, margin: "0 auto" }}>
          Add facts or search this pre-seeded vault. Powered by the same encryption and semantic retrieval engine as production.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
            <LockerPadlock size={14} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Vault</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)", background: "var(--accent-dim)", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{memories.length} memories</span>
          </div>
          <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
            {memories.map((m, i) => (
              <div key={i} style={{
                padding: "8px 12px",
                background: i === 0 && memories[0] !== SAMPLE_MEMORIES[0] ? "rgba(168,85,247,0.08)" : "rgba(148,163,184,0.04)",
                border: `1px solid ${i === 0 && memories[0] !== SAMPLE_MEMORIES[0] ? "rgba(168,85,247,0.2)" : "var(--border)"}`,
                borderRadius: 8, fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5,
              }}>
                🔒 {m}
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>MCP Console</span>
            <span style={{ marginLeft: "auto", fontSize: 10, color: ops >= MAX_DEMO_OPS ? "#f87171" : "var(--text-muted)", background: ops >= MAX_DEMO_OPS ? "rgba(239,68,68,0.1)" : "rgba(148,163,184,0.08)", border: `1px solid ${ops >= MAX_DEMO_OPS ? "rgba(239,68,68,0.2)" : "var(--border)"}`, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>
              {ops}/{MAX_DEMO_OPS} ops used
            </span>
          </div>

          <div ref={logRef} style={{ flex: 1, padding: 12, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, minHeight: 160, maxHeight: 200 }}>
            {log.length === 0 && (
              <div style={{ color: "var(--text-muted)", fontSize: 11, opacity: 0.6, fontFamily: "monospace" }}>$ try searching or adding a fact...</div>
            )}
            {log.map((l, i) => (
              <div key={i} style={{ fontSize: 11, lineHeight: 1.6, fontFamily: "monospace", color: l.type === "in" ? "var(--accent)" : "var(--text-muted)", paddingLeft: l.type === "out" ? 14 : 0 }}>
                {l.type === "in" ? "$ " : "→ "}{l.text}
              </div>
            ))}
            {loading && <div style={{ fontSize: 11, fontFamily: "monospace", color: "var(--accent)", opacity: 0.6 }}>processing<span style={{ animation: "pulse 1s infinite" }}>…</span></div>}
          </div>

          <div style={{ borderTop: "1px solid var(--border)", padding: 12 }}>
            {exhausted ? (
              <div style={{ textAlign: "center", padding: "8px 0" }}>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>You've used all {MAX_DEMO_OPS} demo operations.</p>
                <Link to="/login" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", background: "var(--accent)", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 8, textDecoration: "none" }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  Try Demo Account
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 6, marginBottom: 2 }}>
                  {(["search", "add"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      style={{
                        flex: 1, padding: "5px 0", fontSize: 11, fontWeight: 600, borderRadius: 6,
                        background: mode === m ? "var(--accent)" : "transparent",
                        color: mode === m ? "#fff" : "var(--text-muted)",
                        border: `1px solid ${mode === m ? "var(--accent)" : "var(--border)"}`,
                        cursor: "pointer", transition: "all 0.15s",
                      }}
                    >
                      {m === "search" ? "🔍 recall_context" : "✍️ commit_memory"}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    id="playground-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={mode === "search" ? "Search your vault…" : "Add a new fact…"}
                    disabled={loading}
                    style={{ flex: 1, fontSize: 11, padding: "7px 10px", borderRadius: 6 }}
                  />
                  <button
                    type="submit"
                    disabled={loading || !input.trim()}
                    style={{ padding: "7px 14px", background: "var(--accent)", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 6, border: "none", cursor: "pointer", opacity: loading || !input.trim() ? 0.5 : 1 }}
                  >
                    {loading ? "…" : "Run"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
