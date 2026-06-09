import type { SectionProps } from "../types";

function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

const SETUP_STEPS = [
  { step: "1", text: 'Go to Admin → Webhooks → Linear. Click "Add Linear Webhook".' },
  { step: "2", text: "Copy your Locker Linear webhook URL (shown below)." },
  { step: "3", text: "Copy the generated HMAC secret." },
  { step: "4", text: 'In Linear, go to Settings → API → Webhooks → New webhook.' },
  { step: "5", text: 'Paste the URL. Enter the signing secret. Select "Issue" event type, filter for "Done" state transition.' },
  { step: "6", text: 'Save. Complete a test issue. A new memory tagged linear should appear in your vault.' },
];

export default function WebhooksLinear({ origin, handleCopy }: SectionProps) {
  const webhookUrl = `${origin}/api/webhooks/linear`;

  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        Linear Webhook — Issue Auto-Commit
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
        Automatically capture completed Linear issues as memories. When an issue reaches "Done" state, Locker
        summarizes the title, description, and resolution into a concise fact.
      </p>

      {/* Webhook URL */}
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
          <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>
            📐 Linear Webhook URL
          </span>
          <button
            onClick={() => handleCopy(webhookUrl)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer" }}
          >
            <CopyIcon size={11} /> Copy URL
          </button>
        </div>
        <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflowX: "auto", whiteSpace: "nowrap" }}>
          {webhookUrl}
        </code>
      </div>

      {/* What gets committed */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>What gets committed</h3>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 28 }}>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: "0 0 10px 0" }}>
          When a Linear issue transitions to Done, Locker commits the following as a single encrypted memory:
        </p>
        <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>
          <li style={{ marginBottom: 6 }}>Issue title</li>
          <li style={{ marginBottom: 6 }}>Team and project name</li>
          <li style={{ marginBottom: 6 }}>AI summary of the description and comments</li>
          <li style={{ marginBottom: 6 }}>Completion timestamp</li>
          <li>Automatic tags: <code>linear</code>, <code>issue-done</code>, plus the team name</li>
        </ul>
      </div>

      {/* Setup steps */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Setup steps</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {SETUP_STEPS.map((s) => (
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

      {/* HMAC verification */}
      <div style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.18)", borderRadius: 12, padding: 18 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6, marginTop: 0 }}>
          🔐 HMAC verification
        </h4>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7, margin: 0 }}>
          Linear signs requests with a <code>Linear-Signature</code> header. Locker verifies this against your
          configured secret on every incoming request. Invalid signatures return HTTP <strong>401</strong> and the
          event is discarded without processing.
        </p>
      </div>
    </div>
  );
}
