import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useSession } from "~/lib/authClient";

export const Route = createFileRoute("/oauth/consent")({
  component: ConsentPage,
});

const CLIENT_NAMES: Record<string, string> = {
  claude: "Claude (claude.ai)",
};

function ConsentPage() {
  const { data: session, isPending } = useSession();
  // The new oauthProvider passes the full signed query string as params.
  // We pass them back as oauth_query when posting consent.
  const oauthQuery = typeof window !== "undefined" ? window.location.search.slice(1) : "";
  const search = new URLSearchParams(oauthQuery);
  const clientId = search.get("client_id") ?? "";
  const scopeRaw = search.get("scope") ?? "";
  const scopes = scopeRaw.split(" ").filter(Boolean);

  const [loading, setLoading] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState("");

  const clientName = CLIENT_NAMES[clientId] ?? clientId;

  async function respond(accept: boolean) {
    setLoading(accept ? "allow" : "deny");
    setError("");
    try {
      const res = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      });
      const data = await res.json() as { url?: string; redirectURI?: string; redirect_uri?: string; error?: string };
      const redirectTo = data.url ?? data.redirectURI ?? data.redirect_uri;
      if (!res.ok || !redirectTo) {
        setError(data.error ?? "Something went wrong.");
        setLoading(null);
        return;
      }
      window.location.href = redirectTo;
    } catch {
      setError("Network error. Please try again.");
      setLoading(null);
    }
  }

  if (isPending) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    if (typeof window !== "undefined") {
      window.location.href = `/login?redirect=${encodeURIComponent(window.location.href)}`;
    }
    return null;
  }

  if (!oauthQuery || !clientId) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={{ color: "var(--error)", fontSize: 13 }}>Invalid authorization request.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>

        <h1 style={styles.title}>Authorize Access</h1>
        <p style={styles.subtitle}>
          <strong>{clientName}</strong> wants to access your Locker vault
        </p>

        <div style={styles.scopeBox}>
          <div style={styles.scopeLabel}>Permissions requested</div>
          {scopes.map((s) => (
            <div key={s} style={styles.scopeRow}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{SCOPE_LABELS[s] ?? s}</span>
            </div>
          ))}
        </div>

        <p style={styles.note}>
          Signed in as <strong>{session.user.email}</strong>
        </p>

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.actions}>
          <button
            onClick={() => respond(false)}
            disabled={loading !== null}
            style={styles.denyBtn}
          >
            {loading === "deny" ? "Denying…" : "Deny"}
          </button>
          <button
            onClick={() => respond(true)}
            disabled={loading !== null}
            style={styles.allowBtn}
          >
            {loading === "allow" ? "Authorizing…" : "Allow"}
          </button>
        </div>
      </div>
    </div>
  );
}

const SCOPE_LABELS: Record<string, string> = {
  openid: "Verify your identity",
  profile: "Read your profile (name)",
  email: "Read your email address",
  offline_access: "Stay connected (refresh tokens)",
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--bg)",
    padding: "24px",
  },
  card: {
    width: "100%",
    maxWidth: 400,
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "40px 36px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
  },
  logo: {
    width: 52,
    height: 52,
    background: "var(--accent-dim)",
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text)",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
    marginBottom: 4,
  },
  scopeBox: {
    width: "100%",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 7,
    marginTop: 4,
  },
  scopeLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    marginBottom: 2,
  },
  scopeRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text)",
  },
  note: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 4,
  },
  error: {
    fontSize: 12,
    color: "var(--error)",
    background: "rgba(239,68,68,0.08)",
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 6,
    padding: "8px 10px",
    width: "100%",
    textAlign: "center",
  },
  actions: {
    display: "flex",
    gap: 10,
    width: "100%",
    marginTop: 8,
  },
  denyBtn: {
    flex: 1,
    padding: "10px 0",
    background: "var(--surface2)",
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 14,
    borderRadius: 8,
    border: "1px solid var(--border)",
  },
  allowBtn: {
    flex: 2,
    padding: "10px 0",
    background: "var(--accent)",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    borderRadius: 8,
    border: "none",
  },
};
