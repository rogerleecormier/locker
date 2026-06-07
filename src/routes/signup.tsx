import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { LockerLogo } from "~/components/LockerLogo";
import { useState } from "react";
import { signUp, signIn } from "~/lib/authClient";
import { useQuery } from "@tanstack/react-query";
import { getSystemSettings } from "~/routes/admin";
import { getDemoCredentials } from "~/server/demo";

export const Route = createFileRoute("/signup")({
  component: SignupPage,
});

function SignupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["system-settings"],
    queryFn: () => getSystemSettings(),
  });

  async function handleDemoLogin() {
    setError("");
    setLoading(true);
    try {
      const creds = await getDemoCredentials();
      if (!creds.email || !creds.password) {
        setError("Demo login is not available.");
        return;
      }
      const result = await signIn.email({ email: creds.email, password: creds.password });
      if (result.error) {
        setError(result.error.message ?? "Demo login failed");
      } else {
        navigate({ to: "/" });
      }
    } catch {
      setError("Something went wrong with the demo login.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const result = await signUp.email({ name, email, password });
      if (result.error) {
        setError(result.error.message ?? "Failed to create account");
      } else {
        navigate({ to: "/" });
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (settingsLoading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading settings...</p>
        </div>
      </div>
    );
  }

  if (settings && !settings.enableSignups) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <LockerLogo size={32} linked={false} />
          <h1 style={styles.title}>Registrations Closed</h1>
          <p style={styles.subtitle}>Signups are disabled during development</p>

          <div style={{ width: "100%", textAlign: "center", display: "flex", flexDirection: "column", gap: 12, padding: "20px 0" }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
              Locker is currently under active development. Public user registrations are temporarily disabled.
            </p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
              However, you can try out the system using our pre-configured demo account:
            </p>
            <button type="button" onClick={handleDemoLogin} disabled={loading} style={styles.btn}>
              {loading ? "Logging in as demo..." : "Log in with Demo Account"}
            </button>
            {error && <p style={styles.error}>{error}</p>}
          </div>

          <p style={styles.footer}>
            <Link to="/login" style={{ color: "var(--accent)" }}>
              Back to Sign in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <LockerLogo size={32} linked={false} />
        <h1 style={styles.title}>Create your vault</h1>
        <p style={styles.subtitle}>Your memories, encrypted and private</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Roger"
              required
              style={styles.input}
            />
          </div>
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
              placeholder="At least 8 characters"
              required
              style={styles.input}
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              required
              style={styles.input}
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button type="submit" disabled={loading} style={styles.btn}>
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p style={styles.footer}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "var(--accent)" }}>
            Sign in
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
