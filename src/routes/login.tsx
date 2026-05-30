import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { signIn } from "~/lib/authClient";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? "Invalid email or password");
      } else {
        navigate({ to: "/" });
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#logo-grad-login)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <defs>
              <linearGradient id="logo-grad-login" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--accent)" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeWidth="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeWidth="2" />
            <path d="M9 14.5h6M9 16.5h6M9 18.5h6M11 11v11M13 11v11" strokeWidth="1" opacity="0.6" />
            <rect x="9.5" y="14" width="5" height="5" rx="0.5" fill="var(--accent)" stroke="url(#logo-grad-login)" strokeWidth="1" />
          </svg>
        </div>
        <h1 style={styles.title}>Locker</h1>
        <p style={styles.subtitle}>Sign in to your vault</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              style={styles.input}
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p style={styles.footer}>
          Don't have an account?{" "}
          <Link to="/signup" style={{ color: "var(--accent)" }}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

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
    maxWidth: 420,
    background: "linear-gradient(135deg, rgba(168,85,247,0.03) 0%, var(--surface) 40%)",
    border: "1px solid rgba(168,85,247,0.2)",
    borderRadius: 16,
    padding: "40px 40px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    boxShadow: "0 0 40px rgba(168,85,247,0.06)",
  },
  logo: {
    width: 56,
    height: 56,
    background: "var(--accent-dim)",
    border: "1px solid rgba(168,85,247,0.3)",
    borderRadius: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: "var(--text)",
    letterSpacing: "-0.02em",
  },
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    marginBottom: 16,
  },
  form: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },
  label: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  input: {
    padding: "9px 12px",
    width: "100%",
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
  btn: {
    marginTop: 4,
    padding: "11px 0",
    background: "var(--accent)",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    borderRadius: 8,
    width: "100%",
    border: "none",
    cursor: "pointer",
  },
  footer: {
    marginTop: 8,
    fontSize: 12,
    color: "var(--text-muted)",
  },
};
