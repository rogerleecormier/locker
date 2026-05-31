import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, sql } from "drizzle-orm";
import {
  users,
  organizations,
  organizationMembers,
  orgQuotas,
  teams,
  teamMembers,
  apiTokens,
  tokenUsages,
  userPlans,
  invitations,
} from "~/db/schema";
import { requireSession } from "~/server/session";
import { updateSubscriptionSeats } from "~/server/billing";
import { addMemory, deleteMemory, getMemories, submitMemoryRecommendation, listMemoryRecommendations, reviewMemoryRecommendation, getPendingOrgInvitations } from "~/server/memoryFunctions";
import {
  requireFeature,
  getUserEffectivePlan,
  checkOrgMemberLimit,
  checkTeamLimit,
  checkTeamMemberLimit,
  PlanGateError,
  PlanLimitError,
} from "~/server/planGate";
import { PaywallGate } from "~/components/PaywallGate";
import type { CloudflareEnv } from "~/types/cloudflare";
import type { PlanId } from "~/lib/plans";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

// ── shared role helpers (used here and by admin-page) ─────────────────────

export async function verifyOrgAdminHelper(db: any, userId: string, orgId: string): Promise<boolean> {
  const row = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)))
    .limit(1)
    .all();
  if (row.length === 0) return false;
  return row[0].role === "owner" || row[0].role === "admin";
}

export async function verifyTeamAdminHelper(db: any, userId: string, teamId: string): Promise<boolean> {
  const teamRow = await db.select({ orgId: teams.orgId }).from(teams).where(eq(teams.id, teamId)).limit(1).all();
  if (teamRow.length === 0) return false;
  const orgAdmin = await verifyOrgAdminHelper(db, userId, teamRow[0].orgId);
  if (orgAdmin) return true;
  const row = await db.select({ role: teamMembers.role }).from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))).limit(1).all();
  if (row.length === 0) return false;
  return row[0].role === "admin";
}

// ── server functions ───────────────────────────────────────────────────────

export const getUserOrgsAndTeams = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizations, organizationMembers, teams, teamMembers, users, orgQuotas } });

    const { planId } = await getUserEffectivePlan(db, user.id);

    const orgMemberships = await db
      .select({ orgId: organizationMembers.orgId, name: organizations.name, plan: organizations.plan, role: organizationMembers.role })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
      .where(eq(organizationMembers.userId, user.id))
      .all();

    const adminOrgIds = orgMemberships.filter((o) => o.role === "owner" || o.role === "admin").map((o) => o.orgId);
    const managedOrgs = [];

    for (const m of orgMemberships) {
      const members = await db
        .select({ userId: users.id, name: users.name, email: users.email, role: organizationMembers.role, joinedAt: organizationMembers.joinedAt })
        .from(organizationMembers).innerJoin(users, eq(organizationMembers.userId, users.id))
        .where(eq(organizationMembers.orgId, m.orgId)).all();
      const orgTeams = await db.select().from(teams).where(eq(teams.orgId, m.orgId)).all();
      const quotaRow = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, m.orgId)).limit(1).all();
      managedOrgs.push({ id: m.orgId, name: m.name, plan: (quotaRow[0]?.plan ?? "free") as PlanId, role: m.role, members, teams: orgTeams });
    }

    const teamMemberships = await db
      .select({ teamId: teamMembers.teamId, name: teams.name, orgId: teams.orgId, role: teamMembers.role })
      .from(teamMembers).innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(and(eq(teamMembers.userId, user.id), eq(teamMembers.role, "admin"))).all();

    const teamIdsToFetch = new Set<string>();
    for (const t of teamMemberships) teamIdsToFetch.add(t.teamId);
    for (const o of managedOrgs) for (const t of o.teams) teamIdsToFetch.add(t.id);

    const managedTeams = [];
    for (const teamId of teamIdsToFetch) {
      const teamRow = await db
        .select({ id: teams.id, name: teams.name, orgId: teams.orgId, orgName: organizations.name })
        .from(teams).innerJoin(organizations, eq(teams.orgId, organizations.id))
        .where(eq(teams.id, teamId)).limit(1).all();
      const teamDetails = teamRow[0];
      if (!teamDetails) continue;
      const isParentOrgAdmin = adminOrgIds.includes(teamDetails.orgId);
      const role = isParentOrgAdmin ? "admin" : (teamMemberships.find((t) => t.teamId === teamId)?.role ?? "member");
      const members = await db
        .select({ userId: users.id, name: users.name, email: users.email, role: teamMembers.role })
        .from(teamMembers).innerJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, teamId)).all();
      managedTeams.push({ id: teamId, name: teamDetails.name, orgId: teamDetails.orgId, orgName: teamDetails.orgName, role, members });
    }

    return { organizations: managedOrgs, teams: managedTeams, planId };
  }
);

export const createOrganizationSelfServe = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { name: string } => {
    const d = data as { name: string };
    if (!d.name || typeof d.name !== "string") throw new Error("name is required");
    return { name: d.name.trim() };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean; orgId: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizations, organizationMembers, orgQuotas } });
    await requireFeature(db, user.id, "organizations");
    const orgId = `org_${crypto.randomUUID().replace(/-/g, "")}`;
    await db.insert(organizations).values({ id: orgId, name: data.name, plan: "free", createdAt: Date.now() });
    await db.insert(organizationMembers).values({ orgId, userId: user.id, role: "owner", joinedAt: Date.now() });
    await db.insert(orgQuotas).values({ orgId, plan: "business", monthlyMemories: 10000, monthlyRecalls: 50000, monthlyCommits: 10000 });
    return { success: true, orgId };
  });

export const addOrgMemberByEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId: string; email: string; role: "admin" | "member" } => {
    const d = data as { orgId: string; email: string; role: "admin" | "member" };
    return { orgId: d.orgId, email: d.email.trim(), role: d.role };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizationMembers, users, invitations, organizations } });
    await requireFeature(db, user.id, "organizations");
    const isOrgAdmin = await verifyOrgAdminHelper(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");
    await checkOrgMemberLimit(db, data.orgId, user.id);
    const emailAddress = data.email.toLowerCase().trim();
    const targetUserRows = await db.select().from(users).where(eq(users.email, emailAddress)).limit(1).all();
    if (targetUserRows.length > 0) {
      const existing = await db.select().from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, targetUserRows[0].id)))
        .limit(1).all();
      if (existing.length > 0) throw new Error("User is already a member of this organization");
    }
    const existingInvite = await db.select().from(invitations)
      .where(and(eq(invitations.orgId, data.orgId), eq(invitations.email, emailAddress))).limit(1).all();
    if (existingInvite.length > 0 && existingInvite[0].expiresAt > Date.now())
      throw new Error("An active invitation already exists for this email address");
    const orgRow = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, data.orgId)).limit(1).all();
    const orgName = orgRow[0]?.name ?? "an organization";
    const token = crypto.randomUUID();
    const inviteId = `invite_${crypto.randomUUID().replace(/-/g, "")}`;
    await db.insert(invitations).values({ id: inviteId, orgId: data.orgId, email: emailAddress, role: data.role, invitedBy: user.id, token, expiresAt: Date.now() + 48 * 60 * 60 * 1000, createdAt: Date.now() });
    const request = getRequest();
    const origin = new URL(request.url).origin;
    const inviteUrl = `${origin}/invite?token=${token}`;
    console.log(`[invite] Magic Link: ${inviteUrl}`);
    if (env.SE_EMAIL) {
      try {
        const rawMessage = `From: Locker <invites@locker.rcormier.dev>\nTo: ${emailAddress}\nSubject: You have been invited to join ${orgName} on Locker\nMIME-Version: 1.0\nContent-Type: text/plain; charset=utf-8\n\nYou have been invited to join "${orgName}" on Locker.\n\nClick to accept: ${inviteUrl}\n\nExpires in 48 hours.`;
        const { EmailMessage } = await import("cloudflare:email" as any) as any;
        await env.SE_EMAIL.send(new EmailMessage("invites@locker.rcormier.dev", emailAddress, rawMessage));
      } catch (err) { console.error("[invite] Failed to send email:", err); }
    }
    return { success: true };
  });

export const updateOrgMemberRole = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId: string; userId: string; role: "owner" | "admin" | "member" } => {
    const d = data as { orgId: string; userId: string; role: "owner" | "admin" | "member" };
    return { orgId: d.orgId, userId: d.userId, role: d.role };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizationMembers } });
    await requireFeature(db, user.id, "organizations");
    if (!await verifyOrgAdminHelper(db, user.id, data.orgId)) throw new Error("Forbidden: Not an organization owner/admin");
    const targetRow = await db.select().from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId))).limit(1).all();
    if (targetRow.length === 0) throw new Error("Member not found in organization");
    if (targetRow[0].role === "owner" && data.role !== "owner") {
      const otherOwners = await db.select().from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.role, "owner"), sql`${organizationMembers.userId} != ${data.userId}`)).all();
      if (otherOwners.length === 0) throw new Error("Cannot change role: Organization must have at least one owner.");
    }
    await db.update(organizationMembers).set({ role: data.role })
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)));
    return { success: true };
  });

export const removeOrgMember = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId: string; userId: string } => {
    const d = data as { orgId: string; userId: string };
    return { orgId: d.orgId, userId: d.userId };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizationMembers, teamMembers, teams } });
    await requireFeature(db, user.id, "organizations");
    if (!await verifyOrgAdminHelper(db, user.id, data.orgId)) throw new Error("Forbidden: Not an organization owner/admin");
    const targetRow = await db.select().from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId))).limit(1).all();
    if (targetRow.length === 0) throw new Error("Member not found");
    if (targetRow[0].role === "owner") {
      const otherOwners = await db.select().from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.role, "owner"), sql`${organizationMembers.userId} != ${data.userId}`)).all();
      if (otherOwners.length === 0) throw new Error("Cannot remove: Organization must have at least one owner.");
    }
    await db.delete(organizationMembers).where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)));
    await updateSubscriptionSeats(db, env, data.orgId);
    const orgTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.orgId, data.orgId)).all();
    const orgTeamIds = orgTeams.map((t) => t.id);
    if (orgTeamIds.length > 0) {
      await db.delete(teamMembers).where(
        and(eq(teamMembers.userId, data.userId), sql`${teamMembers.teamId} IN (${sql.join(orgTeamIds.map((tid) => sql`${tid}`), sql`, `)})`)
      );
    }
    return { success: true };
  });

export const createTeam = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId: string; name: string } => {
    const d = data as { orgId: string; name: string };
    return { orgId: d.orgId, name: d.name.trim() };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { teams, teamMembers, organizationMembers } });
    await requireFeature(db, user.id, "teams");
    if (!await verifyOrgAdminHelper(db, user.id, data.orgId)) throw new Error("Forbidden: Not an organization owner/admin");
    await checkTeamLimit(db, data.orgId, user.id);
    const teamId = `team_${crypto.randomUUID()}`;
    await db.insert(teams).values({ id: teamId, orgId: data.orgId, name: data.name, createdAt: Date.now() });
    await db.insert(teamMembers).values({ teamId, userId: user.id, role: "admin" });
    return { success: true };
  });

export const deleteTeam = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { teamId: string } => {
    const d = data as { teamId: string };
    return { teamId: d.teamId };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { teams, organizationMembers, teamMembers } });
    await requireFeature(db, user.id, "teams");
    if (!await verifyTeamAdminHelper(db, user.id, data.teamId)) throw new Error("Forbidden");
    await db.delete(teams).where(eq(teams.id, data.teamId));
    return { success: true };
  });

export const addTeamMemberByEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { teamId: string; email: string; role: string } => {
    const d = data as { teamId: string; email: string; role: string };
    return { teamId: d.teamId, email: d.email.trim(), role: d.role };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { teams, teamMembers, organizationMembers, users } });
    await requireFeature(db, user.id, "teams");
    if (!await verifyTeamAdminHelper(db, user.id, data.teamId)) throw new Error("Forbidden");
    await checkTeamMemberLimit(db, data.teamId, user.id);
    const teamRow = await db.select({ orgId: teams.orgId }).from(teams).where(eq(teams.id, data.teamId)).limit(1).all();
    if (teamRow.length === 0) throw new Error("Team not found");
    const orgId = teamRow[0].orgId;
    const userRow = await db.select().from(users).where(eq(users.email, data.email)).limit(1).all();
    if (userRow.length === 0) throw new Error(`User with email '${data.email}' not found.`);
    const targetUser = userRow[0];
    const orgMemberRow = await db.select().from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, targetUser.id))).limit(1).all();
    const addedToOrg = orgMemberRow.length === 0;
    if (addedToOrg) await db.insert(organizationMembers).values({ orgId, userId: targetUser.id, role: "member", joinedAt: Date.now() });
    const existing = await db.select().from(teamMembers)
      .where(and(eq(teamMembers.teamId, data.teamId), eq(teamMembers.userId, targetUser.id))).limit(1).all();
    if (existing.length > 0) throw new Error("User is already a member of this team");
    await db.insert(teamMembers).values({ teamId: data.teamId, userId: targetUser.id, role: data.role });
    if (addedToOrg) await updateSubscriptionSeats(db, env, orgId);
    return { success: true };
  });

export const updateTeamMemberRole = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { teamId: string; userId: string; role: string } => {
    const d = data as { teamId: string; userId: string; role: string };
    return { teamId: d.teamId, userId: d.userId, role: d.role };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { teamMembers, teams, organizationMembers } });
    await requireFeature(db, user.id, "teams");
    if (!await verifyTeamAdminHelper(db, user.id, data.teamId)) throw new Error("Forbidden");
    await db.update(teamMembers).set({ role: data.role })
      .where(and(eq(teamMembers.teamId, data.teamId), eq(teamMembers.userId, data.userId)));
    return { success: true };
  });

export const removeTeamMember = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { teamId: string; userId: string } => {
    const d = data as { teamId: string; userId: string };
    return { teamId: d.teamId, userId: d.userId };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { teamMembers, teams, organizationMembers } });
    await requireFeature(db, user.id, "teams");
    if (!await verifyTeamAdminHelper(db, user.id, data.teamId)) throw new Error("Forbidden");
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, data.teamId), eq(teamMembers.userId, data.userId)));
    return { success: true };
  });

// ── shared UI components (used here and by admin-page) ────────────────────

export function MemberRow({ member, onUpdateRole, onRemove, roles, isUpdating, isRemoving, currentUserRole = "member" }: {
  member: { userId: string; name: string; email: string; role: string };
  onUpdateRole: (userId: string, role: string) => void;
  onRemove: (userId: string) => void;
  roles: string[];
  isUpdating: boolean;
  isRemoving: boolean;
  currentUserRole?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const isReadOnly = currentUserRole === "member";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{member.name || "–"}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{member.email}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {isReadOnly ? (
          <span style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "capitalize", paddingRight: 8 }}>{member.role}</span>
        ) : (
          <>
            <select value={member.role} onChange={(e) => onUpdateRole(member.userId, e.target.value)} disabled={isUpdating}
              style={{ padding: "4px 6px", fontSize: 11, background: "var(--surface)" }}>
              {roles.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
            {confirming ? (
              <>
                <button onClick={() => onRemove(member.userId)} disabled={isRemoving}
                  style={{ padding: "3px 8px", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "var(--error)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                  {isRemoving ? "…" : "Yes"}
                </button>
                <button onClick={() => setConfirming(false)}
                  style={{ padding: "3px 8px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>
                  No
                </button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)}
                style={{ padding: "3px 8px", background: "transparent", color: "var(--error)", border: "1px solid transparent", fontSize: 11, cursor: "pointer" }}>
                Remove
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function InviteForm({ label, email, setEmail, role, setRole, roles, onSubmit, loading }: {
  label: string; email: string; setEmail: (v: string) => void;
  role: string; setRole: (v: string) => void; roles: string[];
  onSubmit: () => void; loading: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "var(--surface2)", padding: "12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
      <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", gap: "8px" }}>
        <input type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ flex: 1, padding: "6px 10px", fontSize: "13px" }} />
        {roles.length > 0 && (
          <select value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: "6px 8px", fontSize: "12px" }}>
            {roles.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
          </select>
        )}
        <button onClick={onSubmit} disabled={loading || !email.trim()}
          style={{ padding: "6px 14px", background: "var(--accent)", color: "white", fontSize: "12px", fontWeight: "bold", border: "none", borderRadius: "var(--radius)", cursor: "pointer" }}>
          {loading ? "…" : "Add"}
        </button>
      </div>
    </div>
  );
}

export function CreateOrgModal({ onClose, onSubmit, loading, nameValue, onNameChange }: {
  onClose: () => void; onSubmit: (name: string) => void;
  loading: boolean; nameValue: string; onNameChange: (v: string) => void;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px", width: "100%", maxWidth: "420px", boxShadow: "0 24px 48px rgba(0,0,0,0.4)", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "bold" }}>Create Organization</h3>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>You will be automatically added as the Owner.</p>
        <div>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Organization Name</label>
          <input type="text" value={nameValue} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. Acme Corporation"
            style={{ width: "100%", padding: "8px 12px", borderRadius: "var(--radius)" }} autoFocus />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer", fontSize: "13px", borderRadius: "var(--radius)" }}>Cancel</button>
          <button onClick={() => onSubmit(nameValue)} disabled={loading || !nameValue.trim()}
            style={{ padding: "8px 20px", background: "var(--accent)", color: "white", border: "none", fontWeight: "bold", cursor: "pointer", fontSize: "13px", borderRadius: "var(--radius)" }}>
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── /organization page: Vault + Recommendations only ─────────────────────

function OrganizationPage() {
  const { data: workspaceData, isLoading, refetch } = useQuery({
    queryKey: ["orgs-and-teams-data"],
    queryFn: () => getUserOrgsAndTeams(),
  });

  const orgs = workspaceData?.organizations ?? [];
  const planId = workspaceData?.planId ?? "free";
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const currentOrgId = selectedOrgId || orgs[0]?.id;
  const currentOrg = orgs.find((o) => o.id === currentOrgId);

  const orgPageHeader = (
    <div style={{ background: "var(--surface2)", borderBottom: "1px solid var(--border)", padding: "20px 24px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Org Vault</h1>
          <span style={{ fontSize: 11, background: "rgba(34,197,94,0.12)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 20, padding: "2px 8px", fontWeight: 600 }}>
            Team
          </span>
        </div>
        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: 0 }}>
          Shared memory vaults for your organization and teams.
        </p>
      </div>
    </div>
  );

  if (isLoading) return <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;

  if (planId === "free") {
    return (
      <div>
        {orgPageHeader}
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>
          <PaywallGate feature="organizations" currentPlan="free" requiredPlan="business"><></></PaywallGate>
          <div style={{ marginTop: 32 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>What you get with Business</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {[
                { icon: "🏢", title: "Organizations", desc: "Shared workspace with role-based access" },
                { icon: "👥", title: "Teams", desc: "Sub-teams with scoped memory vaults" },
                { icon: "📚", title: "Shared Vaults", desc: "AI sessions access shared context automatically" },
                { icon: "📊", title: "Usage Analytics", desc: "Track MCP usage per API token" },
              ].map(({ icon, title, desc }) => (
                <div key={title} style={{ padding: "16px", background: "linear-gradient(135deg, rgba(34,197,94,0.03) 0%, rgba(16,185,129,0.01) 100%)", border: "1px solid rgba(34,197,94,0.12)", borderRadius: 12 }}>
                  <div style={{ fontSize: 16, marginBottom: 6 }}>{icon} <span style={{ fontWeight: 600 }}>{title}</span></div>
                  <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>{desc}</p>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 20, textAlign: "center" }}>
              <Link to="/admin" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 24px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 14, borderRadius: 10, textDecoration: "none" }}>
                View Plans & Pricing →
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div>
        {orgPageHeader}
        <div style={{ maxWidth: 960, margin: "0 auto", padding: "60px 24px", textAlign: "center" }}>
          <h2 style={{ fontSize: "24px", fontWeight: "800", letterSpacing: "-0.03em", marginBottom: "8px" }}>No organizations yet</h2>
          <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "24px", lineHeight: "1.6" }}>
            Ask your site administrator to create an organization and add you as a member.
          </p>
          <Link to="/admin" style={{ padding: "10px 24px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, borderRadius: "var(--radius)", textDecoration: "none" }}>
            Go to Admin →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      {orgPageHeader}
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "28px 24px" }}>

      {orgs.length > 1 && (
        <div style={{ display: "flex", gap: "12px", alignItems: "center", padding: "14px 16px", background: "linear-gradient(135deg, rgba(34,197,94,0.03) 0%, rgba(16,185,129,0.01) 100%)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: "12px", marginBottom: "24px" }}>
          <label style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>Organization:</label>
          <select value={currentOrgId} onChange={(e) => setSelectedOrgId(e.target.value)}
            style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", flex: 1, fontWeight: 600 }}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </div>
      )}

      {currentOrg && <OrgVaultView org={currentOrg} onRefetch={refetch} />}
      </div>
    </div>
  );
}

function OrgVaultView({ org, onRefetch }: { org: any; onRefetch: () => void }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"vault" | "recommendations" | "members">("vault");
  const [recFact, setRecFact] = useState("");
  const [recCategory, setRecCategory] = useState<"rules" | "projects" | "references">("references");
  const [recTags, setRecTags] = useState("");
  const [recProjectKey, setRecProjectKey] = useState("");
  const [directFact, setDirectFact] = useState("");
  const [directCategory, setDirectCategory] = useState<"rules" | "projects" | "references">("references");
  const [directTags, setDirectTags] = useState("");
  const [directProjectKey, setDirectProjectKey] = useState("");
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  const isAdmin = org.role === "owner" || org.role === "admin";

  const { data: recs = [], refetch: refetchRecs, isLoading: recsLoading } = useQuery({
    queryKey: ["org-recommendations", org.id],
    queryFn: () => listMemoryRecommendations({ data: { orgId: org.id } }),
    enabled: activeTab === "recommendations",
  });

  const { data: orgMemories = [], refetch: refetchOrgMemories, isLoading: memoriesLoading } = useQuery({
    queryKey: ["org-memories", org.id],
    queryFn: () => getMemories({ data: { projectKey: `org:${org.id}` } }),
    enabled: activeTab === "vault",
  });

  const { data: pendingInvitations = [], isLoading: invitationsLoading } = useQuery({
    queryKey: ["pending-org-invitations", org.id],
    queryFn: () => getPendingOrgInvitations({ data: { orgId: org.id } }),
    enabled: activeTab === "members" && isAdmin,
  });

  const submitRecMut = useMutation({
    mutationFn: (data: any) => submitMemoryRecommendation({ data }),
    onSuccess: () => { setRecFact(""); setRecTags(""); setRecProjectKey(""); refetchRecs(); alert("Recommendation submitted for review!"); },
    onError: (err: Error) => alert(err.message),
  });

  const addDirectMemoryMut = useMutation({
    mutationFn: (data: any) => addMemory({ data }),
    onSuccess: () => { setDirectFact(""); setDirectTags(""); setDirectProjectKey(""); refetchOrgMemories(); queryClient.invalidateQueries({ queryKey: ["orgs-and-teams-data"] }); alert("Authoritative memory added!"); },
    onError: (err: Error) => alert(err.message),
  });

  const deleteMemoryMut = useMutation({
    mutationFn: (data: { id: string }) => deleteMemory({ data }),
    onSuccess: () => { refetchOrgMemories(); queryClient.invalidateQueries({ queryKey: ["orgs-and-teams-data"] }); },
    onError: (err: Error) => alert(err.message),
  });

  const reviewRecMut = useMutation({
    mutationFn: (data: any) => reviewMemoryRecommendation({ data }),
    onSuccess: () => { refetchRecs(); queryClient.invalidateQueries({ queryKey: ["orgs-and-teams-data"] }); },
    onError: (err: Error) => alert(err.message),
  });

  const tabBtn = (id: "vault" | "recommendations" | "members", label: string) => (
    <button onClick={() => setActiveTab(id)} style={{ padding: "8px 16px", background: "transparent", color: activeTab === id ? "var(--accent)" : "var(--text-muted)", borderBottom: activeTab === id ? "2px solid var(--accent)" : "2px solid transparent", fontWeight: "bold", borderRadius: 0, cursor: "pointer", fontSize: 13, border: "none" }}>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: "0 0 4px 0" }}>{org.name}</h2>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>{org.members.length} members · {org.teams.length} teams · Role: <strong>{org.role}</strong></p>
      </div>

      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", gap: 16 }}>
        {tabBtn("vault", "Vault")}
        {tabBtn("recommendations", isAdmin ? "Review Recommendations" : "Recommendations")}
        {isAdmin && tabBtn("members", "Members")}
      </div>

      {activeTab === "vault" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Add Authoritative Memory</h3>
            {isAdmin ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>FACT</label>
                  <textarea placeholder="e.g. Always use camelCase for folder structure" value={directFact} onChange={(e) => setDirectFact(e.target.value)} style={{ width: "100%", height: "80px", padding: "8px 10px", resize: "none" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>CATEGORY</label>
                    <select value={directCategory} onChange={(e: any) => setDirectCategory(e.target.value)} style={{ width: "100%", padding: "6px 8px" }}>
                      <option value="rules">Rules</option>
                      <option value="projects">Projects</option>
                      <option value="references">References</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>SCOPE</label>
                    <select value={directProjectKey} onChange={(e) => setDirectProjectKey(e.target.value)} style={{ width: "100%", padding: "6px 8px" }}>
                      <option value="">Whole Organization</option>
                      {org.teams.map((t: any) => <option key={t.id} value={`team:${t.id}`}>Team: {t.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>TAGS</label>
                  <input type="text" placeholder="e.g. guidelines, styles" value={directTags} onChange={(e) => setDirectTags(e.target.value)} style={{ width: "100%", padding: "6px 10px" }} />
                </div>
                <button onClick={() => addDirectMemoryMut.mutate({ fact: directFact, category: directCategory, tags: directTags, projectKey: directProjectKey || `org:${org.id}`, isLocked: true, authorityType: "authoritative" })}
                  disabled={addDirectMemoryMut.isPending || !directFact.trim()}
                  style={{ padding: "8px 16px", background: "var(--accent)", color: "#fff", fontWeight: "bold", borderRadius: "var(--radius)", border: "none", cursor: "pointer" }}>
                  {addDirectMemoryMut.isPending ? "Creating..." : "Add Authoritative Memory"}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", padding: "20px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)", textAlign: "center" }}>
                Only owners/admins can add authoritative memories directly.
              </div>
            )}
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Vault Entries</h3>
            {memoriesLoading ? <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>Loading...</div>
              : orgMemories.length === 0 ? <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0", fontSize: 12 }}>No memories in vault.</div>
              : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", maxHeight: "350px" }}>
                  {orgMemories.map((m: any) => (
                    <div key={m.id} style={{ padding: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <p style={{ fontSize: 12, margin: 0, lineHeight: 1.4, flex: 1 }}>"{m.fact}"</p>
                        {isAdmin && <button onClick={() => { if (confirm("Delete this memory?")) deleteMemoryMut.mutate({ id: m.id }); }} disabled={deleteMemoryMut.isPending} style={{ background: "transparent", color: "var(--error)", border: "none", fontSize: 10, padding: "2px 4px", cursor: "pointer" }}>Delete</button>}
                      </div>
                      <div style={{ fontSize: 9, color: "var(--text-muted)", display: "flex", gap: 6 }}>
                        <span style={{ background: m.isLocked ? "rgba(168,85,247,0.15)" : "transparent", color: m.isLocked ? "var(--accent)" : "var(--text-muted)", padding: "1px 4px", borderRadius: 3, fontWeight: m.isLocked ? "bold" : "normal" }}>{m.authorityType}</span>
                        <span>· {m.category}</span>
                        {m.tags && <span>· {m.tags}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}

      {activeTab === "recommendations" && (
        <div style={{ display: "grid", gridTemplateColumns: isAdmin ? "1fr" : "1fr 1fr", gap: "24px" }}>
          {!isAdmin && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Recommend Entry for Org Vault</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>FACT</label>
                  <textarea placeholder="Recommend a rule or fact" value={recFact} onChange={(e) => setRecFact(e.target.value)} style={{ width: "100%", height: "80px", padding: "8px 10px", resize: "none" }} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>CATEGORY</label>
                    <select value={recCategory} onChange={(e: any) => setRecCategory(e.target.value)} style={{ width: "100%", padding: "6px 8px" }}>
                      <option value="rules">Rules</option>
                      <option value="projects">Projects</option>
                      <option value="references">References</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>SCOPE</label>
                    <select value={recProjectKey} onChange={(e) => setRecProjectKey(e.target.value)} style={{ width: "100%", padding: "6px 8px" }}>
                      <option value="">Whole Organization</option>
                      {org.teams.map((t: any) => <option key={t.id} value={`team:${t.id}`}>Team: {t.name}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>TAGS</label>
                  <input type="text" placeholder="e.g. guidelines, styles" value={recTags} onChange={(e) => setRecTags(e.target.value)} style={{ width: "100%", padding: "6px 10px" }} />
                </div>
                <button onClick={() => submitRecMut.mutate({ orgId: org.id, fact: recFact, category: recCategory, tags: recTags, projectKey: recProjectKey || undefined })}
                  disabled={submitRecMut.isPending || !recFact.trim()}
                  style={{ padding: "8px 16px", background: "var(--accent)", color: "#fff", fontWeight: "bold", borderRadius: "var(--radius)", border: "none", cursor: "pointer" }}>
                  {submitRecMut.isPending ? "Submitting..." : "Submit Recommendation"}
                </button>
              </div>
            </div>
          )}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>{isAdmin ? "Review Queue" : "My Submission History"}</h3>
            {recsLoading ? <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>Loading...</div>
              : recs.length === 0 ? <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0", fontSize: 12 }}>No recommendations found.</div>
              : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", maxHeight: "350px" }}>
                  {recs.map((r: any) => {
                    const c = { pending: { bg: "rgba(234,179,8,0.1)", text: "#eab308", border: "rgba(234,179,8,0.3)" }, approved: { bg: "rgba(34,197,94,0.1)", text: "#22c55e", border: "rgba(34,197,94,0.3)" }, rejected: { bg: "rgba(239,68,68,0.1)", text: "#ef4444", border: "rgba(239,68,68,0.3)" } }[r.status as "pending" | "approved" | "rejected"] ?? { bg: "rgba(234,179,8,0.1)", text: "#eab308", border: "rgba(234,179,8,0.3)" };
                    return (
                      <div key={r.id} style={{ padding: 12, background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 10, fontWeight: "bold", textTransform: "uppercase", padding: "2px 6px", borderRadius: 4, background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>{r.status}</span>
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{new Date(r.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p style={{ fontSize: 12, margin: 0, lineHeight: 1.4 }}>"{r.fact}"</p>
                        <div style={{ fontSize: 9, color: "var(--text-muted)", display: "flex", gap: 4 }}><span>Category: {r.category}</span>{r.tags && <span>· {r.tags}</span>}</div>
                        {r.reviewNotes && <div style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--surface)", padding: "6px 8px", borderRadius: 4, borderLeft: `2px solid ${c.text}` }}><strong>Notes:</strong> {r.reviewNotes}</div>}
                        {isAdmin && r.status === "pending" && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                            <input type="text" placeholder="Review notes (optional)" value={notesMap[r.id] ?? ""} onChange={(e) => setNotesMap({ ...notesMap, [r.id]: e.target.value })} style={{ padding: "6px 10px", fontSize: 11, width: "100%", background: "var(--surface)" }} />
                            <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                              <button onClick={() => reviewRecMut.mutate({ id: r.id, action: "reject", reviewNotes: notesMap[r.id] })} disabled={reviewRecMut.isPending} style={{ padding: "4px 10px", background: "rgba(239,68,68,0.1)", color: "var(--error)", border: "1px solid var(--error)", fontSize: 11, fontWeight: "bold", borderRadius: "var(--radius)", cursor: "pointer" }}>Reject</button>
                              <button onClick={() => reviewRecMut.mutate({ id: r.id, action: "approve", reviewNotes: notesMap[r.id] })} disabled={reviewRecMut.isPending} style={{ padding: "4px 10px", background: "var(--success)", color: "white", border: "none", fontSize: 11, fontWeight: "bold", borderRadius: "var(--radius)", cursor: "pointer" }}>Approve</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
          </div>
        </div>
      )}

      {activeTab === "members" && isAdmin && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Current Members</h3>
            {org.members.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>No members yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {org.members.map((m: any) => (
                  <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px", background: "var(--surface2)", borderRadius: "var(--radius)", fontSize: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{m.name || m.email}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{m.email}</div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, background: "rgba(168,85,247,0.1)", color: "var(--accent)", padding: "2px 8px", borderRadius: 4 }}>{m.role}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Pending Invitations {pendingInvitations.length > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>({pendingInvitations.length})</span>}</h3>
            {invitationsLoading ? (
              <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>Loading...</p>
            ) : pendingInvitations.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 12, margin: 0 }}>No pending invitations.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {pendingInvitations.map((inv: any) => (
                  <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px", background: "var(--surface2)", borderRadius: "var(--radius)", fontSize: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{inv.email}</div>
                      <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                        Expires {new Date(inv.expiresAt).toLocaleDateString()} · Role: {inv.role}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        disabled
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "4px 10px",
                          background: "rgba(168,85,247,0.1)",
                          color: "var(--accent)",
                          border: "1px solid rgba(168,85,247,0.3)",
                          borderRadius: "var(--radius)",
                          cursor: "default",
                        }}
                      >
                        Pending
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "12px 0 0 0", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
              Invitations are sent to the email address with a 48-hour acceptance window. Members can accept invitations on the invite link in their email.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/organization")({
  component: OrganizationPage,
});
