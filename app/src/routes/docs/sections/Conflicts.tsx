import type { SectionProps } from "../types";

const STEPS = [
  { step: "1", text: 'Click "Conflicts" in the sidebar. Review the recommendation cards sorted by severity.' },
  { step: "2", text: "Click a card to open the side-by-side diff view. Left = existing memory. Right = agent-proposed change." },
  { step: "3", text: 'Read both versions. Click "Accept" to apply the change, "Reject" to discard it, or "Merge" to manually edit a combined version.' },
  { step: "4", text: "The card is closed and the recommendation is marked resolved. Memory versioning records the decision." },
];

const CARD_COLORS = [
  {
    color: "Amber",
    bg: "rgba(245,158,11,0.05)",
    border: "rgba(245,158,11,0.25)",
    dot: "#f59e0b",
    label: "Low-confidence conflict",
    description: "Possible contradiction detected — warrants review but the system is not certain. These appear most frequently.",
  },
  {
    color: "Blue",
    bg: "rgba(59,130,246,0.05)",
    border: "rgba(59,130,246,0.25)",
    dot: "#3b82f6",
    label: "Agent-proposed addition",
    description: "A new fact from an agent token that needs human approval before it is committed to the vault.",
  },
  {
    color: "Red",
    bg: "rgba(239,68,68,0.05)",
    border: "rgba(239,68,68,0.25)",
    dot: "#ef4444",
    label: "High-confidence contradiction",
    description: "Two facts directly conflict. Action required — one of the versions must be accepted or the conflict merged.",
  },
];

export default function Conflicts(_props: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        Conflict Resolution Hub
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
        When agents detect contradicting facts in your vault, Locker surfaces them in the Conflict Resolution Hub — a
        side-by-side diff review interface where you can choose the authoritative version and close the recommendation
        with a single click.
      </p>

      {/* How conflicts are detected */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>How conflicts are detected</h3>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 28 }}>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7, margin: 0 }}>
          Whenever an agent calls <code>update_memory</code> or <code>commit_memory</code> with content that
          semantically contradicts an existing memory — detected via <strong>Llama-3.3-70B</strong> comparison
          during the recommendation queue process — a conflict recommendation is created. The nav badge on
          <strong> "Conflicts"</strong> increments to alert you.
        </p>
      </div>

      {/* Card color key */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Recommendation card colors</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
        {CARD_COLORS.map((c) => (
          <div
            key={c.color}
            style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, padding: 16, display: "flex", alignItems: "flex-start", gap: 14 }}
          >
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: c.dot, flexShrink: 0, marginTop: 2 }} />
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{c.color} — {c.label}</span>
              <p style={{ margin: "4px 0 0 0", fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>{c.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Resolving a conflict */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Resolving a conflict</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {STEPS.map((s) => (
          <div
            key={s.step}
            style={{ display: "flex", gap: 14, alignItems: "flex-start", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}
          >
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0, border: "1px solid rgba(168,85,247,0.2)" }}>
              {s.step}
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.5 }}>{s.text}</p>
          </div>
        ))}
      </div>

      {/* Agent mutation queue vs human tokens */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Token behavior</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16, marginBottom: 8 }}>
        <div style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.15)", borderRadius: 12, padding: 18 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
            🤖 Agent mutation queue
          </h4>
          <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            <li style={{ marginBottom: 6 }}>All <code>update_memory</code> and <code>delete_memory</code> calls from agent tokens are <strong>automatically queued</strong> — never applied directly.</li>
            <li style={{ marginBottom: 6 }}>Queued mutations appear here as <strong>blue recommendation cards</strong> regardless of conflict detection.</li>
            <li>Human review is always required before any queued mutation is applied. The <code>confirm: true</code> parameter is silently ignored for agent tokens.</li>
          </ul>
        </div>

        <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 12, padding: 18 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 8, marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
            👤 Human tokens
          </h4>
          <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
            <li style={{ marginBottom: 6 }}>Human token mutation calls <strong>bypass the queue</strong> and are applied directly after TOTP or passcode verification.</li>
            <li style={{ marginBottom: 6 }}>Every human mutation creates a version record in <code>memory_versions</code> with a full diff and timestamp.</li>
            <li>Human mutations do <strong>not</strong> create conflict recommendation cards.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
