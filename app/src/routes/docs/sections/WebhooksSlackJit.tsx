import type { SectionProps } from "../types";

const JIT_FLOW = [
  { step: "1", text: "Agent calls recall_context → memory tagged #confidential is matched." },
  { step: "2", text: "Instead of returning the memory, Locker sends a Slack message to the configured approval channel." },
  { step: "3", text: "The Slack message contains the agent label, the query, and an HMAC-signed approval URL valid for 30 minutes." },
  { step: "4", text: "A human approves by clicking the URL in Slack." },
  { step: "5", text: "Locker mints a temporary lkr_jit_ token valid for 15 minutes, scoped to only the approved memory ID." },
  { step: "6", text: "The agent uses this token to retrieve the memory on its next call." },
];

const SETUP_STEPS = [
  { step: "1", text: 'Go to Admin → Webhooks → Slack JIT. Click "Connect Slack".' },
  { step: "2", text: "Authorize the Locker Slack app in your workspace via the OAuth flow." },
  { step: "3", text: "Select the approval channel (a private channel is recommended)." },
  { step: "4", text: "Test by tagging a memory with #confidential and having an agent token call recall_context for it." },
  { step: "5", text: 'You should receive a Slack notification. Click "Approve" to test the full flow.' },
];

export default function WebhooksSlackJit(_props: SectionProps) {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 800, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        Slack — JIT Confidential Access Approval
      </h2>
      <p style={{ color: "var(--text-muted)", fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>
        Memories tagged <code>#confidential</code> are redacted by default for agent reads. When an agent attempts to
        access one, Locker sends a Slack message with a time-limited approval button. This section explains how to
        configure the Slack integration for JIT approvals.
      </p>

      {/* End-to-end flow */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>How JIT works end-to-end</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {JIT_FLOW.map((s) => (
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

      {/* Security properties */}
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>Security properties</h3>
      <div style={{ background: "rgba(168,85,247,0.04)", border: "1px solid rgba(168,85,247,0.15)", borderRadius: 12, padding: 18, marginBottom: 20 }}>
        <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-muted)", fontSize: 13, lineHeight: 1.7 }}>
          <li style={{ marginBottom: 6 }}>
            <strong>Approval URL:</strong> HMAC-signed with a server-side secret and expires in <strong>30 minutes</strong>. Cannot be reused after approval.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>JIT token storage:</strong> The minted <code>lkr_jit_</code> token is stored hashed with PBKDF2 and has a <strong>15-minute TTL</strong>.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Scoped access:</strong> The token is bound to a single memory ID — it cannot be used to access any other memories in the vault.
          </li>
          <li>
            <strong>Audit trail:</strong> All JIT access events are logged in the Agent Activity dashboard with agent label, query, approval timestamp, and memory ID.
          </li>
        </ul>
      </div>

      {/* No approval received */}
      <div style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 12, padding: 18 }}>
        <h4 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 6, marginTop: 0, display: "flex", alignItems: "center", gap: 8 }}>
          ⚠️ No approval received
        </h4>
        <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          If no human approves within 30 minutes, the JIT request expires. The agent receives an empty result for
          that memory. Agents should handle this gracefully — for example, by surfacing a message to the end user
          indicating that confidential context was requested but not yet approved.
        </p>
      </div>
    </div>
  );
}
