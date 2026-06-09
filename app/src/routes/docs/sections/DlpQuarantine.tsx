import type { SectionProps } from "../types";
import {
  SectionTitle,
  Lead,
  SubHeading,
  Card,
  CardTitle,
  CardBody,
  Grid,
  StepList,
} from "../ui";

const PIPELINE_STEPS = [
  {
    step: "1",
    title: "Shannon entropy gate",
    text: "Calculates bits-per-character of the content. Values ≥ 4.0 bits/char indicate high randomness consistent with secrets or API keys and trigger immediate quarantine.",
  },
  {
    step: "2",
    title: "Structural pattern matching",
    text: "Regex checks for: AWS access keys (AKIA…), GitHub PATs (ghp_, github_pat_), Stripe keys (sk_live_, rk_), PEM blocks (-----BEGIN), database URIs (postgres://, mysql://, mongodb://), and JWT tokens.",
  },
  {
    step: "3",
    title: "PII regex",
    text: "Detects email addresses, SSN patterns (XXX-XX-XXXX), US phone numbers, and credit card numbers using Luhn check-compatible patterns.",
  },
  {
    step: "4",
    title: "AI sanitization",
    text: "sanitizeMemoryAsync passes content through Workers AI to detect adversarial prompt-injection payloads that evade pattern-based checks.",
  },
];

const DLP_PATTERNS = [
  { label: "AWS access key", pattern: "AKIA…" },
  { label: "GitHub PAT", pattern: "ghp_  /  github_pat_" },
  { label: "Stripe secret key", pattern: "sk_live_  /  rk_" },
  { label: "PEM block", pattern: "-----BEGIN …-----" },
  { label: "Database URI", pattern: "postgres://  mysql://  mongodb://" },
  { label: "JWT token", pattern: "eyJ…" },
  { label: "Email address", pattern: "user@domain.tld" },
  { label: "SSN", pattern: "XXX-XX-XXXX" },
  { label: "US phone number", pattern: "(XXX) XXX-XXXX" },
  { label: "Credit card number", pattern: "Luhn-compatible 13–19 digit" },
];

export default function DlpQuarantine(_props: SectionProps) {
  return (
    <div>
      <SectionTitle>DLP Quarantine</SectionTitle>
      <Lead>
        Locker's Data Loss Prevention (DLP) layer intercepts high-entropy secrets, credential patterns,
        and PII before they are committed to the vault — protecting against accidental exposure and prompt
        injection via stored secrets.
      </Lead>

      <SubHeading>How DLP works</SubHeading>
      <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
        Every <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>commit_memory</code> and{" "}
        <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>update_memory</code> call runs through a
        synchronous four-stage pipeline before encryption:
      </p>
      <StepList items={PIPELINE_STEPS} />

      <SubHeading>Detected patterns</SubHeading>
      <div style={{ border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface2)", marginBottom: 28, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)" }}>
              <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700, textAlign: "left" }}>Type</th>
              <th style={{ padding: "12px 16px", color: "var(--text)", fontWeight: 700, textAlign: "left" }}>Pattern / Example</th>
            </tr>
          </thead>
          <tbody>
            {DLP_PATTERNS.map((row, i) => (
              <tr key={row.label} style={{ borderBottom: i < DLP_PATTERNS.length - 1 ? "1px solid var(--border)" : "none" }}>
                <td style={{ padding: "10px 16px", color: "var(--text-muted)" }}>{row.label}</td>
                <td style={{ padding: "10px 16px" }}>
                  <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>{row.pattern}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SubHeading>What happens when content is flagged</SubHeading>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
        {[
          { icon: "🚫", text: <>The <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>commit_memory</code> or <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>update_memory</code> call returns a DLP quarantine error (<code style={{ fontFamily: "monospace", fontSize: 12, color: "rgba(239,68,68,0.8)" }}>-32002</code>).</> },
          { icon: "🔒", text: "The content is NOT stored. Nothing is written to D1 or Vectorize." },
          { icon: "📋", text: "The agent receives a structured error message explaining which gate triggered (entropy, pattern, PII, or AI sanitization)." },
          { icon: "🔑", text: <>The agent should use <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>store_credential</code> for secrets instead of <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>commit_memory</code>.</> },
        ].map(({ icon, text }, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
            <span style={{ fontSize: 15, flexShrink: 0, marginTop: 1 }}>{icon}</span>
            <span style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6 }}>{text}</span>
          </div>
        ))}
      </div>

      <SubHeading>Quarantine vs. redaction</SubHeading>
      <Grid min={260}>
        <Card accent="orange">
          <CardTitle>Quarantine — write-time rejection</CardTitle>
          <CardBody>
            Content is rejected at write time. Nothing is stored. The call returns an error immediately.
            This is the primary DLP mode for all new writes.
          </CardBody>
        </Card>
        <Card accent="purple">
          <CardTitle>Redaction — read-time masking</CardTitle>
          <CardBody>
            Content that was already stored (pre-DLP era data or edge cases) is masked as{" "}
            <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>[REDACTED]</code>{" "}
            when returned to agents. The ciphertext remains in storage but is never surfaced in plaintext.
          </CardBody>
        </Card>
      </Grid>

      <SubHeading>False positives</SubHeading>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 28, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.7 }}>
        Base64-encoded images, long hex hashes, and dense serialized data can occasionally trigger entropy
        gates. If legitimate content is being rejected:
        <ul style={{ paddingLeft: 20, marginTop: 8, marginBottom: 0 }}>
          <li style={{ marginBottom: 6 }}>Break the content into smaller chunks — each chunk is evaluated independently.</li>
          <li>Store the sensitive portion as a credential using <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>store_credential</code> and reference it by name in the memory body.</li>
        </ul>
      </div>

      <SubHeading>store_credential — the right tool for secrets</SubHeading>
      <div
        style={{
          background: "rgba(16,185,129,0.05)",
          border: "1px solid rgba(16,185,129,0.2)",
          borderRadius: 12,
          padding: 18,
          fontSize: 13,
          color: "var(--text-muted)",
          lineHeight: 1.7,
          marginBottom: 28,
        }}
      >
        <strong style={{ color: "var(--text)", display: "block", marginBottom: 6 }}>Use store_credential for actual secrets</strong>
        For API keys, tokens, passwords, and other credentials, use{" "}
        <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>store_credential</code> instead of{" "}
        <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>commit_memory</code>. Credentials are stored in a
        separate encrypted vault with a dedicated Key Encryption Key (KEK), accessible only by tokens with{" "}
        <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>allowCredentials: true</code> in their ABAC policy.
        DLP does not block <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>store_credential</code> writes —
        that pathway is purpose-built for high-entropy values.
      </div>

      <div
        style={{
          background: "rgba(239,68,68,0.05)",
          border: "1px solid rgba(239,68,68,0.18)",
          borderRadius: 12,
          padding: 16,
          fontSize: 13,
          color: "var(--text-muted)",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>DLP scope — not bypassable</strong>
        DLP runs on both human token and agent token writes. It executes synchronously before any encryption
        or storage step. No token type — including admin tokens — can bypass the DLP pipeline.
      </div>
    </div>
  );
}
