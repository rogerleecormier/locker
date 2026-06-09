import type { SectionProps } from "../types";

const HOW_IT_WORKS = [
  { step: "1", text: "The external platform (GitHub, Linear, Slack) sends an HTTP POST to your Locker webhook endpoint." },
  { step: "2", text: "Locker verifies the HMAC-SHA256 signature using the shared secret you configured. Invalid signatures return 401 immediately." },
  { step: "3", text: "Workers AI (Llama-3.3-70B) generates a one-paragraph summary of the event payload." },
  { step: "4", text: "The summary is AES-256-GCM encrypted and committed to D1 as a new memory." },
  { step: "5", text: "The new memory is tagged automatically (e.g., github, pr-merged, linear, issue-done)." },
];

const INTEGRATIONS = [
  { icon: "🐙", label: "GitHub", description: "PR merged events", id: "webhooks-github" },
  { icon: "📐", label: "Linear", description: "Issue done/completed events", id: "webhooks-linear" },
  { icon: "💬", label: "Slack", description: "JIT confidential access approval messages", id: "webhooks-slack-jit" },
];

export default function Webhooks({ setActiveSection }: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        Webhook Integrations — Overview
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
        Locker can receive HMAC-signed webhook events from external platforms and automatically summarize + encrypt the
        payload as a new memory. Currently supported: GitHub (PR merge), Linear (issue completion), and Slack
        (JIT approval).
      </p>

      {/* How webhooks work */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>How webhooks work</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {HOW_IT_WORKS.map((s) => (
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

      {/* Supported integrations */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Supported integrations</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 28 }}>
        {INTEGRATIONS.map((item) => (
          <div key={item.id} style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>{item.icon}</span>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{item.label}</h4>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 12px 0", lineHeight: 1.5 }}>
              {item.description}
            </p>
            <button
              onClick={() => setActiveSection(item.id)}
              style={{ background: "transparent", border: "none", color: "var(--accent)", cursor: "pointer", textDecoration: "underline", padding: 0, font: "inherit", fontSize: 12, fontWeight: 600 }}
            >
              Setup guide →
            </button>
          </div>
        ))}
      </div>

      {/* Security */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Security</h3>
      <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 12, padding: 18, marginBottom: 28 }}>
        <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>
          <li style={{ marginBottom: 6 }}>
            <strong>Signature verification:</strong> Every incoming webhook request signature is verified before any processing. Invalid signatures return <code>401</code>.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Replay protection:</strong> Locker checks the event timestamp and rejects events older than 5 minutes.
          </li>
          <li>
            <strong>No raw storage:</strong> No event payload is stored raw — only the AI-generated summary (AES-256-GCM encrypted).
          </li>
        </ul>
      </div>

      {/* Endpoint format note */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text)" }}>Webhook endpoint format:</strong> Each integration uses a separate
          endpoint path. See the individual setup guides linked above for the exact URL to paste into each platform.
        </p>
      </div>
    </div>
  );
}
