import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LockerPadlock } from "~/components/LockerLogo";
import { useState, useEffect } from "react";
import { verifyEmail } from "~/server/memoryFunctions";

export const Route = createFileRoute("/verify-email/$token")({
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const navigate = useNavigate();
  const { token } = Route.useParams();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function verify() {
      try {
        await verifyEmail({ data: { token } });
        setStatus("success");
        setMessage("Email verified successfully! Redirecting to login...");
        setTimeout(() => navigate({ to: "/login" }), 2000);
      } catch (err: any) {
        setStatus("error");
        setMessage(err.message || "Failed to verify email. The link may have expired.");
      }
    }
    verify();
  }, [token, navigate]);

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <LockerPadlock size={28} />
        </div>
        <h1 style={styles.title}>
          {status === "verifying" ? "Verifying Email" : status === "success" ? "Email Verified" : "Verification Failed"}
        </h1>
        <p style={{ ...styles.subtitle, color: status === "success" ? "var(--accent)" : status === "error" ? "var(--error)" : "var(--text-muted)" }}>
          {message}
        </p>
        {status === "verifying" && (
          <div style={styles.spinner}>
            <div style={styles.spinnerInner}></div>
          </div>
        )}
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
    padding: "60px 40px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
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
    textAlign: "center" as const,
  },
  subtitle: {
    fontSize: 13,
    marginBottom: 16,
    textAlign: "center" as const,
  },
  spinner: {
    width: 40,
    height: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  spinnerInner: {
    width: 32,
    height: 32,
    border: "2px solid rgba(168,85,247,0.2)",
    borderTop: "2px solid var(--accent)",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
};

// Add CSS animation
if (typeof document !== "undefined") {
  const style = document.createElement("style");
  style.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}
