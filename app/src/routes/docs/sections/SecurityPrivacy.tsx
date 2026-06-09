import type { SectionProps } from "../types";
import { SectionTitle, Lead, Grid, Card, CardTitle, CardBody } from "../ui";

const PILLARS = [
  {
    icon: "🔐",
    title: "Envelope Encryption (AES-256-GCM)",
    body: "Per-vault Data Encryption Key (DEK) is wrapped by a server-side Key Encryption Key (KEK) stored in environment variables. A fresh 12-byte random IV is generated per operation. Plaintext never reaches D1 storage — database compromise alone is completely insufficient to decrypt memory content.",
  },
  {
    icon: "🔑",
    title: "PBKDF2 Token Hardening",
    body: "All API tokens and JIT tokens are hashed with PBKDF2-HMAC-SHA256 at 100,000 iterations with a unique random salt before storage. Comparisons use timing-safe byte equality to prevent oracle and timing attacks.",
  },
  {
    icon: "🚫",
    title: "DLP Quarantine",
    body: "Shannon entropy gating (≥ 4.0 bits/char) catches high-entropy secrets. Structural pattern detection covers AWS keys, lkr_ tokens, GitHub PATs, Stripe keys, PEM blocks, and database URIs. PII regex detects emails, SSNs, phone numbers, and credit cards. Any match returns [REDACTED] to calling agents.",
  },
  {
    icon: "🛡️",
    title: "AI Adversarial Sanitization",
    body: "Every write passes through sanitizeMemoryAsync using Workers AI to detect prompt-injection payloads before storage. Adversarial content is rejected at the gate, preventing it from influencing future model outputs via retrieved context.",
  },
  {
    icon: "🎛️",
    title: "ABAC Agent Policies",
    body: "Agent tokens carry category allowlists/denylists (rules, projects, references, stack), tag allowlists/denylists, and an allowCredentials gate. Enforcement occurs at both SQL query time (column-level filters) and the Vectorize metadata pre-filter layer before any ANN search executes.",
  },
  {
    icon: "⏱️",
    title: "JIT Confidential Access",
    body: "Memories tagged #confidential are redacted by default for agent reads. Each access attempt triggers a Slack notification with an HMAC-signed 30-minute approval URL. Approval mints a 15-minute lkr_jit_ token scoped exclusively to the approved memory ID.",
  },
  {
    icon: "🔢",
    title: "TOTP 2FA (RFC 6238)",
    body: "Time-based OTP is enforced for all human-token destructive operations. Implementation uses Web Crypto HMAC-SHA1 with 30-second windows and ±1 step drift tolerance. Backup codes are generated with CSPRNG and hashed before storage.",
  },
  {
    icon: "✋",
    title: "Human Approval Queue",
    body: "Agent update_memory and delete_memory calls are always written to the memory_recommendations table and never applied directly. The confirm: true parameter is silently ignored for agent tokens. Only human-reviewed approval through the Conflicts Hub applies the change.",
  },
  {
    icon: "📜",
    title: "Memory Versioning & Audit Trail",
    body: "Every create, update, and delete operation is appended to memory_versions with a full diff, the acting principal, and a timestamp. Any memory can be rolled back to a prior state with a single click from the Version History tab in the memory detail modal.",
  },
  {
    icon: "🔍",
    title: "Blind Index Search",
    body: "Tags and category labels are stored as HMAC-SHA256 blind index hashes alongside ciphertext. Server-side database filtering operates entirely on hashed values, enabling precise query execution without ever decrypting any record.",
  },
  {
    icon: "⚡",
    title: "Ephemeral V8 Sandboxing",
    body: "All execution runs inside Cloudflare Workers ephemeral V8 isolates with no persistent process memory between requests. Workers AI calls for entity extraction and adversarial sanitization are also ephemeral. There is zero persistent server-side state across invocations.",
  },
  {
    icon: "🌐",
    title: "BYOK Client-Side Encryption (Enterprise)",
    body: "Bring Your Own Key enables true end-to-end encryption where the plaintext never leaves your browser. Memories are encrypted using AES-256-GCM with Web Crypto API before transmission. The server receives only opaque Base64 ciphertext and never decrypts on your behalf. Supports local hex keys or external KMS endpoints (AWS KMS, HashiCorp Vault, Cloudflare KMS).",
  },
  {
    icon: "🔑",
    title: "Enterprise SSO (SAML/OIDC)",
    body: "Organizations can enforce centralized identity management via SAML 2.0 (Okta, Microsoft Entra ID, PingFederate) or generic OIDC providers. IdP certificates and client secrets are encrypted with the org vault Key Encryption Key. Admins can enforce SSO-only access, eliminating password-based authentication while maintaining per-user audit trails.",
  },
];

export default function SecurityPrivacy(_props: SectionProps) {
  return (
    <div>
      <SectionTitle>Security & Privacy Architecture</SectionTitle>
      <Lead>
        Locker is built on a layered security model. Every pillar below operates independently — compromising
        any single layer is insufficient to expose plaintext memory content or gain unauthorized access.
      </Lead>

      <Grid min={300}>
        {PILLARS.map((pillar) => (
          <Card key={pillar.title}>
            <CardTitle>
              <span style={{ fontSize: 16 }}>{pillar.icon}</span>
              {pillar.title}
            </CardTitle>
            <CardBody>{pillar.body}</CardBody>
          </Card>
        ))}
      </Grid>

      <div
        style={{
          background: "rgba(168,85,247,0.05)",
          border: "1px solid rgba(168,85,247,0.15)",
          borderRadius: 12,
          padding: 18,
          fontSize: 13,
          color: "var(--text-muted)",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "var(--text)", display: "block", marginBottom: 6 }}>
          Defense-in-depth summary
        </strong>
        Server-side envelope encryption (all plans) + BYOK client-side encryption (Enterprise) protect data at rest.
        DLP and AI sanitization protect data at write time. PBKDF2 and TOTP protect token and identity surfaces.
        ABAC and JIT gating protect runtime agent access. Enterprise SSO enforces centralized identity with audit trails.
        The human approval queue and audit trail protect against autonomous agent mutation. Ephemeral V8 isolates
        ensure no cross-request memory leakage at the infrastructure layer.
      </div>
    </div>
  );
}
