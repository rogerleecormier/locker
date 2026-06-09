import type { SectionProps } from "../types";
import {
  SectionTitle,
  Lead,
  SubHeading,
  Card,
  CardTitle,
  CardBody,
  StepList,
  CodeBlock,
} from "../ui";

export default function ConnectOAuth({ origin }: SectionProps) {
  const pkceSteps = [
    {
      step: "1",
      title: "Generate code verifier",
      text: "Client generates a cryptographically random code verifier (CSPRNG, 43–128 characters) using the Web Crypto API or equivalent.",
    },
    {
      step: "2",
      title: "Derive code challenge",
      text: "Client computes code_challenge = BASE64URL(SHA-256(verifier)). This is the S256 method — the only method Locker accepts.",
    },
    {
      step: "3",
      title: "Redirect to authorize endpoint",
      text: `Client redirects the user to ${origin}/api/oauth/authorize with response_type=code, client_id, redirect_uri, code_challenge, code_challenge_method=S256, and scope=mcp.`,
    },
    {
      step: "4",
      title: "User authenticates and approves",
      text: "Locker presents a login/consent screen. The user authenticates and grants access. Locker stores the hashed code challenge alongside the short-lived authorization code.",
    },
    {
      step: "5",
      title: "Receive authorization code",
      text: "Locker redirects back to the client's redirect_uri with an authorization code in the query string.",
    },
    {
      step: "6",
      title: "Exchange code for access token",
      text: `Client POSTs the code and the original code verifier to ${origin}/api/oauth/token. Locker verifies that SHA-256(verifier) matches the stored challenge before issuing the access token.`,
    },
  ];

  return (
    <div>
      <SectionTitle>Connecting Clients — OAuth</SectionTitle>
      <Lead>
        Some AI clients (like Claude.ai remote MCP) support OAuth 2.1 PKCE for authentication. Locker
        supports OAuth with strict PKCE validation to eliminate authorization code interception attacks.
      </Lead>

      <SubHeading>How OAuth PKCE works with Locker</SubHeading>
      <StepList items={pkceSteps} />

      <SubHeading>Endpoints</SubHeading>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 28 }}>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
          <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, display: "block", marginBottom: 8 }}>
            Authorization Endpoint
          </span>
          <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflowX: "auto", whiteSpace: "nowrap" }}>
            {origin}/api/oauth/authorize
          </code>
        </div>
        <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18 }}>
          <span style={{ fontSize: 11, color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, display: "block", marginBottom: 8 }}>
            Token Endpoint
          </span>
          <code style={{ display: "block", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontFamily: "monospace", fontSize: 12, color: "var(--text)", overflowX: "auto", whiteSpace: "nowrap" }}>
            {origin}/api/oauth/token
          </code>
        </div>
      </div>

      <SubHeading>Supported clients</SubHeading>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 28 }}>
        <Card accent="purple">
          <CardTitle>Claude.ai Remote MCP</CardTitle>
          <CardBody>
            Claude.ai supports OAuth 2.1 PKCE natively when adding a remote MCP server. Enter the
            authorize and token endpoint URLs and Claude handles the full PKCE flow automatically.
          </CardBody>
        </Card>
        <Card accent="blue">
          <CardTitle>Any OAuth 2.1 PKCE-Compliant Client</CardTitle>
          <CardBody>
            Any client that implements the OAuth 2.1 PKCE authorization code flow can connect to
            Locker's OAuth endpoints using the URLs above.
          </CardBody>
        </Card>
      </div>

      <SubHeading>Scopes</SubHeading>
      <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 12, padding: 18, marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <code style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px", fontFamily: "monospace", fontSize: 12, color: "var(--accent)", flexShrink: 0 }}>mcp</code>
          <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
            Full MCP tool access. This is currently the only scope. Scope-grained access is managed at
            the token/ABAC level, not the OAuth scope level. Fine-grained category and tag restrictions
            are configured on the resulting agent token after OAuth authorization completes.
          </p>
        </div>
      </div>

      <CodeBlock label="Example authorize redirect (query parameters)">
        {`response_type=code
client_id=<your-client-id>
redirect_uri=<your-redirect-uri>
code_challenge=<BASE64URL(SHA-256(verifier))>
code_challenge_method=S256
scope=mcp`}
      </CodeBlock>

      <div
        style={{
          background: "rgba(239,68,68,0.05)",
          border: "1px solid rgba(239,68,68,0.2)",
          borderRadius: 12,
          padding: 18,
          fontSize: 13,
          color: "var(--text-muted)",
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: "var(--text)", display: "block", marginBottom: 6 }}>
          Security note — CVE-2025-4144 mitigation
        </strong>
        Locker enforces strict PKCE per CVE-2025-4144 mitigation. The <code style={{ fontFamily: "monospace", fontSize: 12, color: "rgba(239,68,68,0.8)" }}>plain</code> code
        challenge method is unconditionally rejected. Only <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>S256</code> is accepted.
        Authorization requests that omit <code style={{ fontFamily: "monospace", fontSize: 12, color: "var(--accent)" }}>code_challenge</code> or send
        an unsupported method receive a 400 error and are not processed.
      </div>
    </div>
  );
}
