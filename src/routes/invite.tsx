import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { invitations, organizations, organizationMembers, users } from "~/db/schema";
import { useSession } from "~/lib/authClient";
import { requireSession } from "~/server/session";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

export const getInvitationDetails = createServerFn({ method: "GET" })
  .inputValidator((data: unknown): { token: string } => {
    const d = data as { token: string };
    if (!d.token) throw new Error("Token is required");
    return { token: d.token };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = drizzle(env.DB, { schema: { invitations, organizations } });

    const rows = await db
      .select({
        id: invitations.id,
        orgId: invitations.orgId,
        orgName: organizations.name,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(organizations, eq(invitations.orgId, organizations.id))
      .where(eq(invitations.token, data.token))
      .limit(1)
      .all();

    if (rows.length === 0) {
      throw new Error("Invitation not found or invalid");
    }

    const invite = rows[0];
    const isExpired = invite.expiresAt < Date.now();

    return {
      orgName: invite.orgName,
      email: invite.email,
      role: invite.role,
      isExpired,
    };
  });

export const acceptInvitation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { token: string } => {
    const d = data as { token: string };
    if (!d.token) throw new Error("Token is required");
    return { token: d.token };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { invitations, organizationMembers, users } });

    const inviteRows = await db
      .select()
      .from(invitations)
      .where(eq(invitations.token, data.token))
      .limit(1)
      .all();

    if (inviteRows.length === 0) {
      throw new Error("Invitation not found or invalid");
    }

    const invite = inviteRows[0];
    if (invite.expiresAt < Date.now()) {
      throw new Error("This invitation has expired");
    }

    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new Error(`This invitation was sent to ${invite.email}, but you are signed in as ${user.email}.`);
    }

    // Verify if user is already a member
    const existingRow = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, invite.orgId), eq(organizationMembers.userId, user.id)))
      .limit(1)
      .all();

    if (existingRow.length > 0) {
      // Just clean up the invite and succeed
      await db.delete(invitations).where(eq(invitations.id, invite.id));
      return { success: true };
    }

    // Add member
    await db.insert(organizationMembers).values({
      orgId: invite.orgId,
      userId: user.id,
      role: invite.role,
      joinedAt: Date.now(),
    });

    // Delete invite
    await db.delete(invitations).where(eq(invitations.id, invite.id));

    return { success: true };
  });

export const declineInvitation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { token: string } => {
    const d = data as { token: string };
    if (!d.token) throw new Error("Token is required");
    return { token: d.token };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { invitations } });

    const inviteRows = await db
      .select()
      .from(invitations)
      .where(eq(invitations.token, data.token))
      .limit(1)
      .all();

    if (inviteRows.length === 0) {
      throw new Error("Invitation not found or invalid");
    }

    const invite = inviteRows[0];
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new Error("You are not authorized to decline this invitation");
    }

    await db.delete(invitations).where(eq(invitations.id, invite.id));
    return { success: true };
  });

export const Route = createFileRoute("/invite")({
  component: InvitePage,
});

function InvitePage() {
  const navigate = useNavigate();
  const { data: session, isPending: sessionPending } = useSession();

  const token = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") ?? "" : "";

  const { data: invite, isLoading, error } = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => getInvitationDetails({ data: { token } }),
    enabled: !!token,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: () => acceptInvitation({ data: { token } }),
    onSuccess: () => {
      navigate({ to: "/organization" });
    },
    onError: (err: Error) => {
      alert(err.message);
    },
  });

  const declineMutation = useMutation({
    mutationFn: () => declineInvitation({ data: { token } }),
    onSuccess: () => {
      navigate({ to: "/" });
    },
    onError: (err: Error) => {
      alert(err.message);
    },
  });

  if (sessionPending || isLoading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading invitation details…</p>
        </div>
      </div>
    );
  }

  if (error || !token || !invite) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logoError}>✕</div>
          <h1 style={styles.title}>Invalid Invitation</h1>
          <p style={styles.subtitle}>
            {error ? (error as Error).message : "No invitation token was provided or it has expired."}
          </p>
          <Link to="/" style={styles.backLink}>Back to dashboard</Link>
        </div>
      </div>
    );
  }

  if (invite.isExpired) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.logoError}>✕</div>
          <h1 style={styles.title}>Invitation Expired</h1>
          <p style={styles.subtitle}>
            This invitation link has expired. Please contact the administrator to request a new link.
          </p>
          <Link to="/" style={styles.backLink}>Back to dashboard</Link>
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

  const emailMismatch = session.user.email.toLowerCase() !== invite.email.toLowerCase();

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>

        <h1 style={styles.title}>Join Organization</h1>
        <p style={styles.subtitle}>
          You have been invited to join <strong>{invite.orgName}</strong> as an {invite.role}.
        </p>

        {emailMismatch ? (
          <div style={styles.warningBox}>
            <div style={styles.warningTitle}>Email Mismatch</div>
            <p style={styles.warningDesc}>
              This invitation was sent to <strong>{invite.email}</strong>, but you are currently signed in as <strong>{session.user.email}</strong>.
            </p>
            <p style={{ ...styles.warningDesc, marginTop: 4 }}>
              Please switch accounts or sign in with the correct email before accepting.
            </p>
          </div>
        ) : (
          <div style={styles.infoBox}>
            <p style={{ margin: 0 }}>
              Signed in as <strong>{session.user.email}</strong>
            </p>
          </div>
        )}

        <div style={styles.actions}>
          <button
            onClick={() => declineMutation.mutate()}
            disabled={declineMutation.isPending || acceptMutation.isPending}
            style={styles.declineBtn}
          >
            {declineMutation.isPending ? "Declining…" : "Decline"}
          </button>
          <button
            onClick={() => acceptMutation.mutate()}
            disabled={acceptMutation.isPending || declineMutation.isPending || emailMismatch}
            style={emailMismatch ? styles.disabledBtn : styles.acceptBtn}
          >
            {acceptMutation.isPending ? "Accepting…" : "Accept"}
          </button>
        </div>
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
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "40px 36px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
    textAlign: "center",
  },
  logo: {
    width: 52,
    height: 52,
    background: "var(--accent-dim)",
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  logoError: {
    width: 52,
    height: 52,
    background: "rgba(239, 68, 68, 0.1)",
    border: "1px solid rgba(239, 68, 68, 0.2)",
    color: "var(--error)",
    fontSize: 22,
    fontWeight: "bold",
    borderRadius: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text)",
    letterSpacing: "-0.02em",
    margin: 0,
  },
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    margin: 0,
  },
  infoBox: {
    width: "100%",
    background: "var(--surface2)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 14px",
    fontSize: 12,
    color: "var(--text-muted)",
    marginTop: 8,
  },
  warningBox: {
    width: "100%",
    background: "rgba(245, 158, 11, 0.08)",
    border: "1px solid rgba(245, 158, 11, 0.2)",
    borderRadius: 8,
    padding: "12px 14px",
    textAlign: "left",
    marginTop: 8,
  },
  warningTitle: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#f59e0b",
    marginBottom: 4,
  },
  warningDesc: {
    fontSize: 11,
    color: "var(--text-muted)",
    margin: 0,
    lineHeight: 1.4,
  },
  actions: {
    display: "flex",
    gap: 10,
    width: "100%",
    marginTop: 12,
  },
  declineBtn: {
    flex: 1,
    padding: "10px 0",
    background: "var(--surface2)",
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 13,
    borderRadius: 8,
    border: "1px solid var(--border)",
    cursor: "pointer",
  },
  acceptBtn: {
    flex: 2,
    padding: "10px 0",
    background: "var(--accent)",
    color: "#fff",
    fontWeight: 600,
    fontSize: 13,
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
  },
  disabledBtn: {
    flex: 2,
    padding: "10px 0",
    background: "var(--surface2)",
    color: "var(--text-muted)",
    fontWeight: 600,
    fontSize: 13,
    borderRadius: 8,
    border: "none",
    cursor: "not-allowed",
    opacity: 0.5,
  },
  backLink: {
    color: "var(--accent)",
    fontSize: 12,
    textDecoration: "none",
    marginTop: 12,
  },
};
