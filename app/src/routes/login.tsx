import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { signIn } from "~/lib/authClient";
import { LockerLogo } from "~/components/LockerLogo";
import { getDemoCredentials } from "~/server/demo";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState(false);

  async function handleDemoLogin() {
    setError("");
    setDemoLoading(true);
    try {
      const creds = await getDemoCredentials();
      if (!creds.email || !creds.password) {
        setError("Demo login is not available.");
        return;
      }
      const result = await signIn.email({ email: creds.email, password: creds.password });
      if (result.error) {
        setError(result.error.message ?? "Demo login failed. Try again shortly.");
      } else {
        navigate({ to: "/" });
      }
    } catch {
      setError("Demo login unavailable. Please try again.");
    } finally {
      setDemoLoading(false);
    }
  }

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
        <LockerLogo size={32} linked={false} />
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

        <div style={{ width: "100%", display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
          <Link to="/forgot-password" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Forgot password?
          </Link>
          <span>
            Don't have an account?{" "}
            <Link to="/signup" style={{ color: "var(--accent)", textDecoration: "none" }}>
              Create one
            </Link>
          </span>
        </div>

        {/* Demo account divider */}
        <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, marginTop: 16 }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500, whiteSpace: "nowrap" }}>or explore without an account</span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>

        <button
          id="demo-login-btn"
          type="button"
          onClick={handleDemoLogin}
          disabled={demoLoading || loading}
          style={{
            ...styles.btn,
            marginTop: 0,
            background: "transparent",
            border: "1px solid rgba(168,85,247,0.35)",
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          {demoLoading ? "Signing in to demo…" : "Try Demo Account"}
        </button>
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
