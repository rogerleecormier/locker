import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { resetPassword } from "~/server/memoryFunctions";

export const Route = createFileRoute("/reset-password/$token")({
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token } = Route.useParams();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    setError("");
    setMessage("");
    setLoading(true);
    try {
      await resetPassword({ data: { token, password } });
      setMessage("Password reset successfully. Redirecting to login...");
      setTimeout(() => navigate({ to: "/login" }), 2000);
    } catch (err: any) {
      setError(err.message || "Failed to reset password. The reset link may have expired.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#logo-grad-reset)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <defs>
              <linearGradient id="logo-grad-reset" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="var(--accent)" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" strokeWidth="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" strokeWidth="2" />
            <path d="M9 14.5h6M9 16.5h6M9 18.5h6M11 11v11M13 11v11" strokeWidth="1" opacity="0.6" />
            <rect x="9.5" y="14" width="5" height="5" rx="0.5" fill="var(--accent)" stroke="url(#logo-grad-reset)" strokeWidth="1" />
          </svg>
        </div>
        <h1 style={styles.title}>Set New Password</h1>
        <p style={styles.subtitle}>Enter your new password below</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>New Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={!!message}
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
              disabled={!!message}
              style={styles.input}
            />
          </div>

          {message && <p style={{ ...styles.message, color: "var(--accent)" }}>{message}</p>}
          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading || !!message} style={styles.btn}>
            {loading ? "Resetting…" : "Reset Password"}
          </button>
        </form>
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
    textAlign: "center" as const,
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
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  input: {
    padding: "10px 12px",
    fontSize: 14,
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    color: "var(--text)",
    fontFamily: "inherit",
  },
  btn: {
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 600,
    background: "var(--accent)",
    color: "white",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    marginTop: 4,
  },
  message: {
    fontSize: 12,
    padding: "10px 12px",
    background: "rgba(168,85,247,0.07)",
    border: "1px solid rgba(168,85,247,0.2)",
    borderRadius: 6,
  },
  error: {
    fontSize: 12,
    color: "var(--error)",
    padding: "10px 12px",
    background: "rgba(239,68,68,0.07)",
    border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: 6,
  },
};
