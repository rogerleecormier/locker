import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
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
import { getAdminStatus } from "~/routes/admin";
import { updateSubscriptionSeats } from "~/server/billing";
import { addMemory, deleteMemory, getMemories, submitMemoryRecommendation, listMemoryRecommendations, reviewMemoryRecommendation } from "~/server/memoryFunctions";
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

async function verifyOrgAdmin(db: any, userId: string, orgId: string): Promise<boolean> {
  const row = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, userId)))
    .limit(1)
    .all();
  if (row.length === 0) return false;
  return row[0].role === "owner" || row[0].role === "admin";
}

async function verifyTeamAdmin(db: any, userId: string, teamId: string): Promise<boolean> {
  const teamRow = await db
    .select({ orgId: teams.orgId })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1)
    .all();
  if (teamRow.length === 0) return false;
  const orgId = teamRow[0].orgId;
  const orgAdmin = await verifyOrgAdmin(db, userId, orgId);
  if (orgAdmin) return true;
  const row = await db
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1)
    .all();
  if (row.length === 0) return false;
  return row[0].role === "admin";
}

export const getUserOrgsAndTeams = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizations, organizationMembers, teams, teamMembers, users, orgQuotas } });

    const { planId } = await getUserEffectivePlan(db, user.id, env.ADMIN_USER_ID);

    const orgMemberships = await db
      .select({
        orgId: organizationMembers.orgId,
        name: organizations.name,
        plan: organizations.plan,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
      .where(eq(organizationMembers.userId, user.id))
      .all();

    const managedOrgs = [];
    const orgIds = orgMemberships.map((o) => o.orgId);
    const adminOrgIds = orgMemberships
      .filter((o) => o.role === "owner" || o.role === "admin")
      .map((o) => o.orgId);

    for (const m of orgMemberships) {
      const members = await db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          role: organizationMembers.role,
          joinedAt: organizationMembers.joinedAt,
        })
        .from(organizationMembers)
        .innerJoin(users, eq(organizationMembers.userId, users.id))
        .where(eq(organizationMembers.orgId, m.orgId))
        .all();

      const orgTeams = await db.select().from(teams).where(eq(teams.orgId, m.orgId)).all();
      const quotaRow = await db.select().from(orgQuotas).where(eq(orgQuotas.orgId, m.orgId)).limit(1).all();

      managedOrgs.push({
        id: m.orgId,
        name: m.name,
        plan: (quotaRow[0]?.plan ?? "free") as PlanId,
        role: m.role,
        members,
        teams: orgTeams,
      });
    }

    const teamMemberships = await db
      .select({
        teamId: teamMembers.teamId,
        name: teams.name,
        orgId: teams.orgId,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(and(eq(teamMembers.userId, user.id), eq(teamMembers.role, "admin")))
      .all();

    const teamIdsToFetch = new Set<string>();
    for (const t of teamMemberships) teamIdsToFetch.add(t.teamId);
    for (const o of managedOrgs) for (const t of o.teams) teamIdsToFetch.add(t.id);

    const managedTeams = [];
    for (const teamId of teamIdsToFetch) {
      const teamRow = await db
        .select({ id: teams.id, name: teams.name, orgId: teams.orgId, orgName: organizations.name })
        .from(teams)
        .innerJoin(organizations, eq(teams.orgId, organizations.id))
        .where(eq(teams.id, teamId))
        .limit(1)
        .all();
      const teamDetails = teamRow[0];
      if (!teamDetails) continue;
      let role = "member";
      const isParentOrgAdmin = adminOrgIds.includes(teamDetails.orgId);
      if (isParentOrgAdmin) {
        role = "admin";
      } else {
        const memRole = teamMemberships.find((t) => t.teamId === teamId)?.role;
        if (memRole) role = memRole;
      }
      const members = await db
        .select({ userId: users.id, name: users.name, email: users.email, role: teamMembers.role })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, teamId))
        .all();
      managedTeams.push({ id: teamId, name: teamDetails.name, orgId: teamDetails.orgId, orgName: teamDetails.orgName, role, members });
    }

    return { organizations: managedOrgs, teams: managedTeams, planId };
  }
);

export const getUserPlan = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizationMembers, orgQuotas, userPlans } });
    return getUserEffectivePlan(db, user.id, env.ADMIN_USER_ID);
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

    await requireFeature(db, user.id, "organizations", env.ADMIN_USER_ID);

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

    await requireFeature(db, user.id, "organizations", env.ADMIN_USER_ID);

    const isOrgAdmin = await verifyOrgAdmin(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");

    await checkOrgMemberLimit(db, data.orgId, user.id, env.ADMIN_USER_ID);

    const emailAddress = data.email.toLowerCase().trim();

    // Check if user is already a member
    const targetUserRows = await db.select().from(users).where(eq(users.email, emailAddress)).limit(1).all();
    if (targetUserRows.length > 0) {
      const targetUser = targetUserRows[0];
      const existingRow = await db.select().from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, targetUser.id)))
        .limit(1).all();
      if (existingRow.length > 0) throw new Error("User is already a member of this organization");
    }

    // Check if there is already an active pending invitation
    const existingInvite = await db.select().from(invitations)
      .where(and(eq(invitations.orgId, data.orgId), eq(invitations.email, emailAddress)))
      .limit(1).all();
    if (existingInvite.length > 0 && existingInvite[0].expiresAt > Date.now()) {
      throw new Error("An active invitation already exists for this email address");
    }

    const orgRow = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, data.orgId)).limit(1).all();
    const orgName = orgRow[0]?.name ?? "an organization";

    const token = crypto.randomUUID();
    const inviteId = `invite_${crypto.randomUUID().replace(/-/g, "")}`;

    await db.insert(invitations).values({
      id: inviteId,
      orgId: data.orgId,
      email: emailAddress,
      role: data.role,
      invitedBy: user.id,
      token,
      expiresAt: Date.now() + 48 * 60 * 60 * 1000, // 48 hours
      createdAt: Date.now(),
    });

    const request = getRequest();
    const origin = new URL(request.url).origin;
    const inviteUrl = `${origin}/invite?token=${token}`;
    console.log(`[invite] Magic Link generated: ${inviteUrl}`);

    if (env.SE_EMAIL) {
      try {
        // Cloudflare SendEmail supports raw message transmission or helper.
        // We will construct a simple message. Standard cloudflare:email module can be imported or used.
        // As a fallback to match multiple CF environments, we construct a basic message structure.
        const rawMessage = `From: Locker <invites@locker.rcormier.dev>\nTo: ${emailAddress}\nSubject: You have been invited to join ${orgName} on Locker\nMIME-Version: 1.0\nContent-Type: text/plain; charset=utf-8\n\nYou have been invited to join the organization "${orgName}" on Locker.\n\nClick the link below to accept the invitation and access the vault:\n${inviteUrl}\n\nThis invitation link expires in 48 hours.`;
        
        // Dynamic import cloudflare:email to prevent bundling crash on non-workers platforms
        const { EmailMessage } = await import("cloudflare:email" as any) as any;
        const message = new EmailMessage("invites@locker.rcormier.dev", emailAddress, rawMessage);
        await env.SE_EMAIL.send(message);
        console.log(`[invite] Invitation email sent to ${emailAddress}`);
      } catch (err) {
        console.error("[invite] Failed to send email via Cloudflare SendEmail:", err);
      }
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

    await requireFeature(db, user.id, "organizations", env.ADMIN_USER_ID);
    const isOrgAdmin = await verifyOrgAdmin(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");

    const targetRow = await db.select().from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)))
      .limit(1).all();
    if (targetRow.length === 0) throw new Error("Member not found in organization");
    const targetMember = targetRow[0];

    if (targetMember.role === "owner" && data.role !== "owner") {
      const otherOwners = await db.select().from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.role, "owner"), sql`${organizationMembers.userId} != ${data.userId}`))
        .all();
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

    await requireFeature(db, user.id, "organizations", env.ADMIN_USER_ID);
    const isOrgAdmin = await verifyOrgAdmin(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");

    const targetRow = await db.select().from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)))
      .limit(1).all();
    if (targetRow.length === 0) throw new Error("Member not found in organization");
    const targetMember = targetRow[0];

    if (targetMember.role === "owner") {
      const otherOwners = await db.select().from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.role, "owner"), sql`${organizationMembers.userId} != ${data.userId}`))
        .all();
      if (otherOwners.length === 0) throw new Error("Cannot remove member: Organization must have at least one owner.");
    }

    await db.delete(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)));

    // Sync seats to Stripe
    await updateSubscriptionSeats(db, env, data.orgId);

    const orgTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.orgId, data.orgId)).all();
    const orgTeamIds = orgTeams.map((t) => t.id);
    if (orgTeamIds.length > 0) {
      await db.delete(teamMembers).where(
        and(eq(teamMembers.userId, data.userId),
          sql`${teamMembers.teamId} IN (${sql.join(orgTeamIds.map((tid) => sql`${tid}`), sql`, `)})`
        )
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
    const db = drizzle(env.DB, { schema: { teams, teamMembers } });

    await requireFeature(db, user.id, "teams", env.ADMIN_USER_ID);
    const isOrgAdmin = await verifyOrgAdmin(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");

    await checkTeamLimit(db, data.orgId, user.id, env.ADMIN_USER_ID);

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
    const db = drizzle(env.DB, { schema: { teams } });

    await requireFeature(db, user.id, "teams", env.ADMIN_USER_ID);
    const isTeamAdmin = await verifyTeamAdmin(db, user.id, data.teamId);
    if (!isTeamAdmin) throw new Error("Forbidden: Not authorized to manage this team");

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

    await requireFeature(db, user.id, "teams", env.ADMIN_USER_ID);
    const isTeamAdmin = await verifyTeamAdmin(db, user.id, data.teamId);
    if (!isTeamAdmin) throw new Error("Forbidden: Not authorized to manage this team");

    await checkTeamMemberLimit(db, data.teamId, user.id, env.ADMIN_USER_ID);

    const teamRow = await db.select({ orgId: teams.orgId }).from(teams).where(eq(teams.id, data.teamId)).limit(1).all();
    if (teamRow.length === 0) throw new Error("Team not found");
    const orgId = teamRow[0].orgId;

    const userRow = await db.select().from(users).where(eq(users.email, data.email)).limit(1).all();
    if (userRow.length === 0) throw new Error(`User with email '${data.email}' not found.`);
    const targetUser = userRow[0];

    let addedToOrg = false;
    const orgMemberRow = await db.select().from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, targetUser.id)))
      .limit(1).all();
    if (orgMemberRow.length === 0) {
      await db.insert(organizationMembers).values({ orgId, userId: targetUser.id, role: "member", joinedAt: Date.now() });
      addedToOrg = true;
    }

    const teamMemberRow = await db.select().from(teamMembers)
      .where(and(eq(teamMembers.teamId, data.teamId), eq(teamMembers.userId, targetUser.id)))
      .limit(1).all();
    if (teamMemberRow.length > 0) throw new Error("User is already a member of this team");

    await db.insert(teamMembers).values({ teamId: data.teamId, userId: targetUser.id, role: data.role });

    if (addedToOrg) {
      await updateSubscriptionSeats(db, env, orgId);
    }

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
    const db = drizzle(env.DB, { schema: { teamMembers } });
    await requireFeature(db, user.id, "teams", env.ADMIN_USER_ID);
    const isTeamAdmin = await verifyTeamAdmin(db, user.id, data.teamId);
    if (!isTeamAdmin) throw new Error("Forbidden");
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
    const db = drizzle(env.DB, { schema: { teamMembers } });
    await requireFeature(db, user.id, "teams", env.ADMIN_USER_ID);
    const isTeamAdmin = await verifyTeamAdmin(db, user.id, data.teamId);
    if (!isTeamAdmin) throw new Error("Forbidden");
    await db.delete(teamMembers)
      .where(and(eq(teamMembers.teamId, data.teamId), eq(teamMembers.userId, data.userId)));
    return { success: true };
  });

function MemberRow({
  member,
  onUpdateRole,
  onRemove,
  roles,
  isUpdating,
  isRemoving,
  currentUserRole = "member",
}: {
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
          <span style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "capitalize", paddingRight: 8 }}>
            {member.role}
          </span>
        ) : (
          <>
            <select
              value={member.role}
              onChange={(e) => onUpdateRole(member.userId, e.target.value)}
              disabled={isUpdating}
              style={{ padding: "4px 6px", fontSize: 11, background: "var(--surface)" }}
            >
              {roles.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
            </select>
            {confirming ? (
              <>
                <button onClick={() => onRemove(member.userId)} disabled={isRemoving}
                  style={{ padding: "3px 8px", background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)", color: "var(--error)", fontSize: 11, fontWeight: 600 }}>
                  {isRemoving ? "…" : "Yes"}
                </button>
                <button onClick={() => setConfirming(false)}
                  style={{ padding: "3px 8px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 11 }}>
                  No
                </button>
              </>
            ) : (
              <button onClick={() => setConfirming(true)}
                style={{ padding: "3px 8px", background: "transparent", color: "var(--error)", border: "1px solid transparent", fontSize: 11 }}>
                Remove
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function OrganizationPage() {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [newTeamName, setNewTeamName] = useState("");
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgNameInput, setNewOrgNameInput] = useState("");

  const { data: planData, isLoading: planLoading } = useQuery({
    queryKey: ["user-plan"],
    queryFn: () => getUserPlan(),
  });

  const currentPlan: PlanId = planData?.planId ?? "free";

  const { data: workspaceData, isLoading, isError, refetch } = useQuery({
    queryKey: ["orgs-and-teams-data"],
    queryFn: () => getUserOrgsAndTeams(),
    enabled: currentPlan !== "free",
  });

  const orgs = workspaceData?.organizations ?? [];
  const teamsList = workspaceData?.teams ?? [];

  const selectionOptions = useMemo(() => {
    const opts: Array<{ key: string; label: string; type: "org" | "team"; name: string }> = [];
    orgs.forEach((o) => opts.push({ key: `org:${o.id}`, label: `${o.name} (Org)`, type: "org", name: o.name }));
    teamsList.forEach((t) => opts.push({ key: `team:${t.id}`, label: `${t.orgName} > ${t.name} (Team)`, type: "team", name: t.name }));
    return opts;
  }, [orgs, teamsList]);

  const currentKey = selectedKey || (selectionOptions[0]?.key ?? "");

  const activeSelection = useMemo(() => {
    if (!currentKey) return null;
    const [type, id] = currentKey.split(":");
    if (type === "org") return { type: "org" as const, data: orgs.find((o) => o.id === id) };
    return { type: "team" as const, data: teamsList.find((t) => t.id === id) };
  }, [currentKey, orgs, teamsList]);

  const mutOpts = { onSuccess: () => refetch(), onError: (err: Error) => alert(err.message) };

  const createOrgMut = useMutation({
    mutationFn: (data: { name: string }) => createOrganizationSelfServe({ data }),
    onSuccess: (res) => { setShowCreateOrg(false); setNewOrgNameInput(""); refetch(); setSelectedKey(`org:${res.orgId}`); },
    onError: (err: Error) => alert(err.message),
  });
  const addOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; email: string; role: "admin" | "member" }) => addOrgMemberByEmail({ data }),
    onSuccess: () => { setInviteEmail(""); refetch(); },
    onError: (err: Error) => alert(err.message),
  });
  const updateOrgRoleMut = useMutation({
    mutationFn: (data: { orgId: string; userId: string; role: "owner" | "admin" | "member" }) => updateOrgMemberRole({ data }),
    ...mutOpts,
  });
  const removeOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; userId: string }) => removeOrgMember({ data }),
    ...mutOpts,
  });
  const createTeamMut = useMutation({
    mutationFn: (data: { orgId: string; name: string }) => createTeam({ data }),
    onSuccess: () => { setNewTeamName(""); refetch(); },
    onError: (err: Error) => alert(err.message),
  });
  const deleteTeamMut = useMutation({
    mutationFn: (data: { teamId: string }) => deleteTeam({ data }),
    onSuccess: () => { setSelectedKey(selectionOptions[0]?.key ?? ""); refetch(); },
    onError: (err: Error) => alert(err.message),
  });
  const addTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; email: string; role: string }) => addTeamMemberByEmail({ data }),
    onSuccess: () => { setInviteEmail(""); refetch(); },
    onError: (err: Error) => alert(err.message),
  });
  const updateTeamRoleMut = useMutation({
    mutationFn: (data: { teamId: string; userId: string; role: string }) => updateTeamMemberRole({ data }),
    ...mutOpts,
  });
  const removeTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; userId: string }) => removeTeamMember({ data }),
    ...mutOpts,
  });

  if (planLoading) return <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading…</div>;

  if (currentPlan === "free") {
    return (
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 20px" }}>
        <header style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Organization Console</h1>
          </div>
        </header>

        <PaywallGate feature="organizations" currentPlan="free" requiredPlan="business">
          {/* This content never renders on free plan */}
          <></>
        </PaywallGate>

        <div style={{ marginTop: 40 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, color: "var(--text)" }}>What you get with Business</h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { icon: "🏢", title: "Organizations", desc: "Create a shared workspace with role-based access for your team" },
              { icon: "👥", title: "Teams", desc: "Sub-teams with their own scoped memory vaults" },
              { icon: "📚", title: "Shared Vaults", desc: "Any team member's AI session accesses the shared context automatically" },
              { icon: "📊", title: "Usage Analytics", desc: "Track MCP recall and commit counts per API token" },
              { icon: "🔒", title: "Audit Logs", desc: "Full history of every read and write across your organization" },
              { icon: "🔍", title: "Cross-Workspace Search", desc: "Find memories across personal and organizational vaults" },
            ].map(({ icon, title, desc }) => (
              <div key={title} style={{ padding: "14px 16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
                <div style={{ fontSize: 16, marginBottom: 6 }}>{icon} <span style={{ fontWeight: 600, color: "var(--text)" }}>{title}</span></div>
                <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>{desc}</p>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <Link to="/billing" style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 24px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 14, borderRadius: 10, textDecoration: "none" }}>
              View Plans & Pricing →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (selectionOptions.length === 0) {
    return (
      <div style={{ padding: "40px 20px", maxWidth: "680px", margin: "40px auto", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "64px", height: "64px", borderRadius: "50%", background: "var(--accent-dim)", color: "var(--accent)", marginBottom: "20px" }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
        </div>
        <h2 style={{ fontSize: "24px", fontWeight: "800", color: "var(--text)", letterSpacing: "-0.03em", marginBottom: "8px" }}>Create your first organization</h2>
        <p style={{ fontSize: "14px", color: "var(--text-muted)", marginBottom: "32px", lineHeight: "1.6" }}>
          Set up a shared memory vault for your team with role-based access.
        </p>
        <button onClick={() => setShowCreateOrg(true)}
          style={{ padding: "10px 24px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 13, borderRadius: "var(--radius)", border: "none", cursor: "pointer", boxShadow: "0 4px 12px rgba(168, 85, 247, 0.25)" }}>
          + Create Organization
        </button>

        {showCreateOrg && <CreateOrgModal onClose={() => setShowCreateOrg(false)} onSubmit={(name) => createOrgMut.mutate({ name })} loading={createOrgMut.isPending} nameValue={newOrgNameInput} onNameChange={setNewOrgNameInput} />}
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", maxWidth: "1000px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", color: "var(--text)", letterSpacing: "-0.02em" }}>Organization Console</h1>
        <Link to="/" style={{ color: "var(--accent)", fontSize: "14px", textDecoration: "none" }}>← Back to App</Link>
      </div>

      <div style={{ display: "flex", gap: "12px", alignItems: "center", padding: "16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "24px" }}>
        <label style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>Workspace:</label>
        <select
          value={currentKey}
          onChange={(e) => { setSelectedKey(e.target.value); setInviteEmail(""); setNewTeamName(""); }}
          style={{ padding: "8px 16px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", flex: 1, fontWeight: "600" }}
        >
          {selectionOptions.map((opt) => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
        </select>
        <button onClick={() => setShowCreateOrg(true)}
          style={{ padding: "8px 16px", background: "var(--accent)", color: "#fff", fontWeight: 600, fontSize: 12, borderRadius: "var(--radius)", border: "none", cursor: "pointer", whiteSpace: "nowrap" }}>
          + Create Org
        </button>
      </div>

      {activeSelection?.type === "org" && activeSelection.data && (
        <OrgView
          org={activeSelection.data}
          inviteEmail={inviteEmail}
          setInviteEmail={setInviteEmail}
          inviteRole={inviteRole}
          setInviteRole={setInviteRole}
          newTeamName={newTeamName}
          setNewTeamName={setNewTeamName}
          onAddMember={(email: string, role: string) => addOrgMemberMut.mutate({ orgId: activeSelection.data!.id, email, role: role as "admin" | "member" })}
          onUpdateRole={(userId: string, role: string) => updateOrgRoleMut.mutate({ orgId: activeSelection.data!.id, userId, role: role as any })}
          onRemoveMember={(userId: string) => removeOrgMemberMut.mutate({ orgId: activeSelection.data!.id, userId })}
          onCreateTeam={(name: string) => createTeamMut.mutate({ orgId: activeSelection.data!.id, name })}
          onSelectTeam={(teamId: string) => setSelectedKey(`team:${teamId}`)}
          onDeleteTeam={(teamId: string) => { if (confirm("Delete this team?")) deleteTeamMut.mutate({ teamId }); }}
          isAddingMember={addOrgMemberMut.isPending}
          isUpdatingRole={updateOrgRoleMut.isPending}
          isRemovingMember={removeOrgMemberMut.isPending}
          isCreatingTeam={createTeamMut.isPending}
          isDeletingTeam={deleteTeamMut.isPending}
        />
      )}

      {activeSelection?.type === "team" && activeSelection.data && (
        <TeamView
          team={activeSelection.data}
          inviteEmail={inviteEmail}
          setInviteEmail={setInviteEmail}
          inviteRole={inviteRole}
          setInviteRole={setInviteRole}
          onAddMember={(email: string, role: string) => addTeamMemberMut.mutate({ teamId: activeSelection.data!.id, email, role })}
          onUpdateRole={(userId: string, role: string) => updateTeamRoleMut.mutate({ teamId: activeSelection.data!.id, userId, role })}
          onRemoveMember={(userId: string) => removeTeamMemberMut.mutate({ teamId: activeSelection.data!.id, userId })}
          onDeleteTeam={() => { if (confirm("Delete this team?")) deleteTeamMut.mutate({ teamId: activeSelection.data!.id }); }}
          isAddingMember={addTeamMemberMut.isPending}
          isUpdatingRole={updateTeamRoleMut.isPending}
          isRemovingMember={removeTeamMemberMut.isPending}
          isDeletingTeam={deleteTeamMut.isPending}
        />
      )}

      {showCreateOrg && (
        <CreateOrgModal
          onClose={() => setShowCreateOrg(false)}
          onSubmit={(name) => createOrgMut.mutate({ name })}
          loading={createOrgMut.isPending}
          nameValue={newOrgNameInput}
          onNameChange={setNewOrgNameInput}
        />
      )}
    </div>
  );
}

function CreateOrgModal({ onClose, onSubmit, loading, nameValue, onNameChange }: {
  onClose: () => void;
  onSubmit: (name: string) => void;
  loading: boolean;
  nameValue: string;
  onNameChange: (v: string) => void;
}) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "24px", width: "100%", maxWidth: "420px", boxShadow: "0 24px 48px rgba(0,0,0,0.4)", display: "flex", flexDirection: "column", gap: "16px" }}>
        <h3 style={{ margin: 0, fontSize: "18px", fontWeight: "bold", color: "var(--text)" }}>Create Organization</h3>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>You will be automatically added as the Owner.</p>
        <div>
          <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Organization Name</label>
          <input type="text" value={nameValue} onChange={(e) => onNameChange(e.target.value)} placeholder="e.g. Acme Corporation" style={{ width: "100%", padding: "8px 12px", borderRadius: "var(--radius)" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px" }}>
          <button onClick={onClose} style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer", fontSize: "13px" }}>Cancel</button>
          <button onClick={() => onSubmit(nameValue)} disabled={loading || !nameValue.trim()} style={{ padding: "8px 20px", background: "var(--accent)", color: "white", border: "none", fontWeight: "bold", cursor: "pointer", fontSize: "13px" }}>
            {loading ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function InviteForm({ label, email, setEmail, role, setRole, roles, onSubmit, loading }: {
  label: string; email: string; setEmail: (v: string) => void;
  role: string; setRole: (v: string) => void; roles: string[];
  onSubmit: () => void; loading: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "var(--surface2)", padding: "12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
      <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", gap: "8px" }}>
        <input type="email" placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, padding: "6px 10px", fontSize: "13px" }} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ padding: "6px 8px", fontSize: "12px" }}>
          {roles.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
        </select>
        <button onClick={onSubmit} disabled={loading || !email.trim()} style={{ padding: "6px 14px", background: "var(--accent)", color: "white", fontSize: "12px", fontWeight: "bold" }}>
          {loading ? "…" : "Add"}
        </button>
      </div>
    </div>
  );
}

function OrgView({ org, inviteEmail, setInviteEmail, inviteRole, setInviteRole, newTeamName, setNewTeamName, onAddMember, onUpdateRole, onRemoveMember, onCreateTeam, onSelectTeam, onDeleteTeam, isAddingMember, isUpdatingRole, isRemovingMember, isCreatingTeam, isDeletingTeam }: any) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"overview" | "vault" | "recommendations">("overview");

  // Input states
  const [recFact, setRecFact] = useState("");
  const [recCategory, setRecCategory] = useState<"rules" | "projects" | "references">("references");
  const [recTags, setRecTags] = useState("");
  const [recProjectKey, setRecProjectKey] = useState("");

  // Direct memory input states
  const [directFact, setDirectFact] = useState("");
  const [directCategory, setDirectCategory] = useState<"rules" | "projects" | "references">("references");
  const [directTags, setDirectTags] = useState("");
  const [directProjectKey, setDirectProjectKey] = useState("");

  // Review states
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

  const submitRecMut = useMutation({
    mutationFn: (data: { orgId: string; fact: string; category: "rules" | "projects" | "references"; tags: string; projectKey?: string }) => submitMemoryRecommendation({ data }),
    onSuccess: () => {
      setRecFact("");
      setRecTags("");
      setRecProjectKey("");
      refetchRecs();
      alert("Success: Memory recommendation submitted for review!");
    },
    onError: (err: Error) => alert(err.message),
  });

  const addDirectMemoryMut = useMutation({
    mutationFn: (data: { fact: string; category: "rules" | "projects" | "references"; tags: string; projectKey?: string; isLocked?: boolean; authorityType?: "authoritative" | "contributed" }) => addMemory({ data }),
    onSuccess: () => {
      setDirectFact("");
      setDirectTags("");
      setDirectProjectKey("");
      refetchOrgMemories();
      queryClient.invalidateQueries({ queryKey: ["orgs-and-teams-data"] });
      alert("Success: Authoritative memory added directly to vault!");
    },
    onError: (err: Error) => alert(err.message),
  });

  const deleteMemoryMut = useMutation({
    mutationFn: (data: { id: string }) => deleteMemory({ data }),
    onSuccess: () => {
      refetchOrgMemories();
      queryClient.invalidateQueries({ queryKey: ["orgs-and-teams-data"] });
    },
    onError: (err: Error) => alert(err.message),
  });

  const reviewRecMut = useMutation({
    mutationFn: (data: { id: string; action: "approve" | "reject"; reviewNotes?: string }) => reviewMemoryRecommendation({ data }),
    onSuccess: () => {
      refetchRecs();
      queryClient.invalidateQueries({ queryKey: ["orgs-and-teams-data"] });
    },
    onError: (err: Error) => alert(err.message),
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }}>
        <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: "0 0 4px 0" }}>{org.name}</h2>
        <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>{org.members.length} members · {org.teams.length} teams · Role: <strong>{org.role}</strong></p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", gap: 16 }}>
        <button
          onClick={() => setActiveTab("overview")}
          style={{
            padding: "8px 16px",
            background: "transparent",
            color: activeTab === "overview" ? "var(--accent)" : "var(--text-muted)",
            borderBottom: activeTab === "overview" ? "2px solid var(--accent)" : "2px solid transparent",
            fontWeight: "bold",
            borderRadius: 0,
            cursor: "pointer",
            fontSize: 13
          }}
        >
          Members & Teams
        </button>
        <button
          onClick={() => setActiveTab("vault")}
          style={{
            padding: "8px 16px",
            background: "transparent",
            color: activeTab === "vault" ? "var(--accent)" : "var(--text-muted)",
            borderBottom: activeTab === "vault" ? "2px solid var(--accent)" : "2px solid transparent",
            fontWeight: "bold",
            borderRadius: 0,
            cursor: "pointer",
            fontSize: 13
          }}
        >
          Authoritative Vault
        </button>
        <button
          onClick={() => setActiveTab("recommendations")}
          style={{
            padding: "8px 16px",
            background: "transparent",
            color: activeTab === "recommendations" ? "var(--accent)" : "var(--text-muted)",
            borderBottom: activeTab === "recommendations" ? "2px solid var(--accent)" : "2px solid transparent",
            fontWeight: "bold",
            borderRadius: 0,
            cursor: "pointer",
            fontSize: 13
          }}
        >
          {isAdmin ? "Review Recommendations" : "Recommendations"}
        </button>
      </div>

      {/* Tab Panel: Members & Teams */}
      {activeTab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Members</h3>
            {org.role !== "member" ? (
              <InviteForm label="Add Member by Email" email={inviteEmail} setEmail={setInviteEmail} role={inviteRole} setRole={setInviteRole} roles={["member", "admin"]} onSubmit={() => onAddMember(inviteEmail, inviteRole)} loading={isAddingMember} />
            ) : (
              <div style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", padding: "10px 12px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                Viewing only (Owner/Admin permissions required to invite members)
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
              {org.members.map((m: any) => (
                <MemberRow key={m.userId} member={m} roles={["member", "admin", "owner"]} onUpdateRole={(uid, role) => onUpdateRole(uid, role)} onRemove={(uid) => onRemoveMember(uid)} isUpdating={isUpdatingRole} isRemoving={isRemovingMember} currentUserRole={org.role} />
              ))}
            </div>
          </div>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Teams</h3>
            {org.role !== "member" ? (
              <InviteForm label="Create Team" email={newTeamName} setEmail={setNewTeamName} role="" setRole={() => {}} roles={[]} onSubmit={() => onCreateTeam(newTeamName)} loading={isCreatingTeam} />
            ) : (
              <div style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", padding: "10px 12px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                Viewing only (Owner/Admin permissions required to create teams)
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "300px", overflowY: "auto" }}>
              {org.teams.map((t: any) => (
                <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    {org.role !== "member" ? (
                      <>
                         <button onClick={() => onSelectTeam(t.id)} style={{ padding: "3px 8px", background: "transparent", border: "1px solid var(--border)", fontSize: 11, cursor: "pointer" }}>Edit</button>
                        <button onClick={() => onDeleteTeam(t.id)} disabled={isDeletingTeam} style={{ padding: "3px 8px", background: "transparent", color: "var(--error)", border: "1px solid transparent", fontSize: 11, cursor: "pointer" }}>Delete</button>
                      </>
                    ) : (
                      <button onClick={() => onSelectTeam(t.id)} style={{ padding: "3px 8px", background: "transparent", border: "1px solid var(--border)", fontSize: 11, cursor: "pointer" }}>View members</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab Panel: Authoritative Vault */}
      {activeTab === "vault" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
          {/* Direct Add Column */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Add Authoritative Memory</h3>
            {isAdmin ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: "600" }}>FACT</label>
                  <textarea
                    placeholder="Enter an authoritative rule or fact (e.g. Always use camelCase for folder structure)"
                    value={directFact}
                    onChange={(e) => setDirectFact(e.target.value)}
                    style={{ width: "100%", height: "80px", padding: "8px 10px", resize: "none" }}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: "600" }}>CATEGORY</label>
                    <select
                      value={directCategory}
                      onChange={(e: any) => setDirectCategory(e.target.value)}
                      style={{ width: "100%", padding: "6px 8px" }}
                    >
                      <option value="rules">Rules</option>
                      <option value="projects">Projects</option>
                      <option value="references">References</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: "600" }}>SCOPE (OPTIONAL)</label>
                    <select
                      value={directProjectKey}
                      onChange={(e) => setDirectProjectKey(e.target.value)}
                      style={{ width: "100%", padding: "6px 8px" }}
                    >
                      <option value="">Whole Organization</option>
                      {org.teams.map((t: any) => (
                        <option key={t.id} value={`team:${t.id}`}>Team: {t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: "600" }}>TAGS (COMMA SEPARATED)</label>
                  <input
                    type="text"
                    placeholder="e.g. guidelines, styles, deploy"
                    value={directTags}
                    onChange={(e) => setDirectTags(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px" }}
                  />
                </div>
                <button
                  onClick={() => addDirectMemoryMut.mutate({
                    fact: directFact,
                    category: directCategory,
                    tags: directTags,
                    projectKey: directProjectKey || `org:${org.id}`,
                    isLocked: true,
                    authorityType: "authoritative",
                  })}
                  disabled={addDirectMemoryMut.isPending || !directFact.trim()}
                  style={{
                    padding: "8px 16px",
                    background: "var(--accent)",
                    color: "#fff",
                    fontWeight: "bold",
                    marginTop: 8,
                    borderRadius: "var(--radius)",
                    border: "none",
                    cursor: "pointer"
                  }}
                >
                  {addDirectMemoryMut.isPending ? "Creating..." : "Add Authoritative Memory"}
                </button>
              </div>
            ) : (
              <div style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", padding: "20px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)", textAlign: "center" }}>
                Only organization owners/admins can add authoritative memories directly.
              </div>
            )}
          </div>

          {/* List Column */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Vault Memories</h3>
            {memoriesLoading ? (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>Loading...</div>
            ) : orgMemories.length === 0 ? (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0", fontSize: 12 }}>
                No memories in the organization vault.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", maxHeight: "350px", paddingRight: 4 }}>
                {orgMemories.map((m: any) => (
                  <div
                    key={m.id}
                    style={{
                      padding: 12,
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius)",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      textAlign: "left"
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <p style={{ fontSize: 12, margin: 0, color: "var(--text)", lineHeight: 1.4, flex: 1 }}>
                        "{m.fact}"
                      </p>
                      {isAdmin && (
                        <button
                          onClick={() => { if (confirm("Delete this memory?")) deleteMemoryMut.mutate({ id: m.id }); }}
                          disabled={deleteMemoryMut.isPending}
                          style={{
                            background: "transparent",
                            color: "var(--error)",
                            border: "none",
                            fontSize: 10,
                            padding: "2px 4px",
                            cursor: "pointer"
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 9, color: "var(--text-muted)", alignItems: "center" }}>
                      <span style={{
                        background: m.isLocked ? "rgba(168,85,247,0.15)" : "transparent",
                        color: m.isLocked ? "var(--accent)" : "var(--text-muted)",
                        padding: "1px 4px",
                        borderRadius: 3,
                        fontWeight: m.isLocked ? "bold" : "normal"
                      }}>
                        {m.authorityType}
                      </span>
                      <span>· Category: {m.category}</span>
                      {m.tags && <span>· Tags: {m.tags}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Panel: Recommendations */}
      {activeTab === "recommendations" && (
        <div style={{ display: "grid", gridTemplateColumns: isAdmin ? "1fr" : "1fr 1fr", gap: "24px" }}>
          {/* Submit Panel (only for non-admins) */}
          {!isAdmin && (
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Recommend Memory to Org Vault</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: "600" }}>FACT</label>
                  <textarea
                    placeholder="Recommend a rule or fact (e.g. Always use camelCase for folder structure)"
                    value={recFact}
                    onChange={(e) => setRecFact(e.target.value)}
                    style={{ width: "100%", height: "80px", padding: "8px 10px", resize: "none" }}
                  />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: "600" }}>CATEGORY</label>
                    <select
                      value={recCategory}
                      onChange={(e: any) => setRecCategory(e.target.value)}
                      style={{ width: "100%", padding: "6px 8px" }}
                    >
                      <option value="rules">Rules</option>
                      <option value="projects">Projects</option>
                      <option value="references">References</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: "600" }}>SCOPE (OPTIONAL)</label>
                    <select
                      value={recProjectKey}
                      onChange={(e) => setRecProjectKey(e.target.value)}
                      style={{ width: "100%", padding: "6px 8px" }}
                    >
                      <option value="">Whole Organization</option>
                      {org.teams.map((t: any) => (
                        <option key={t.id} value={`team:${t.id}`}>Team: {t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginBottom: 4, fontWeight: "600" }}>TAGS (COMMA SEPARATED)</label>
                  <input
                    type="text"
                    placeholder="e.g. guidelines, styles, deploy"
                    value={recTags}
                    onChange={(e) => setRecTags(e.target.value)}
                    style={{ width: "100%", padding: "6px 10px" }}
                  />
                </div>
                <button
                  onClick={() => submitRecMut.mutate({
                    orgId: org.id,
                    fact: recFact,
                    category: recCategory,
                    tags: recTags,
                    projectKey: recProjectKey || undefined,
                  })}
                  disabled={submitRecMut.isPending || !recFact.trim()}
                  style={{
                    padding: "8px 16px",
                    background: "var(--accent)",
                    color: "#fff",
                    fontWeight: "bold",
                    marginTop: 8,
                    borderRadius: "var(--radius)",
                    border: "none",
                    cursor: "pointer"
                  }}
                >
                  {submitRecMut.isPending ? "Submitting..." : "Submit Recommendation"}
                </button>
              </div>
            </div>
          )}

          {/* History/Review Panel */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>
              {isAdmin ? "Review Queue" : "My Submission History"}
            </h3>
            {recsLoading ? (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>Loading...</div>
            ) : recs.length === 0 ? (
              <div style={{ color: "var(--text-muted)", textAlign: "center", padding: "24px 0", fontSize: 12 }}>
                No recommendations found.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", maxHeight: "350px", paddingRight: 4 }}>
                {recs.map((r: any) => {
                  const statusColors = {
                    pending: { bg: "rgba(234,179,8,0.1)", text: "#eab308", border: "rgba(234,179,8,0.3)" },
                    approved: { bg: "rgba(34,197,94,0.1)", text: "#22c55e", border: "rgba(34,197,94,0.3)" },
                    rejected: { bg: "rgba(239,68,68,0.1)", text: "#ef4444", border: "rgba(239,68,68,0.3)" }
                  };
                  const colors = statusColors[r.status as keyof typeof statusColors] || statusColors.pending;

                  return (
                    <div
                      key={r.id}
                      style={{
                        padding: 12,
                        background: "var(--surface2)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        textAlign: "left"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{
                          fontSize: 10,
                          fontWeight: "bold",
                          textTransform: "uppercase",
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: colors.bg,
                          color: colors.text,
                          border: `1px solid ${colors.border}`
                        }}>
                          {r.status}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                          {new Date(r.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <p style={{ fontSize: 12, margin: 0, color: "var(--text)", lineHeight: 1.4 }}>
                        "{r.fact}"
                      </p>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", fontSize: 9, color: "var(--text-muted)" }}>
                        <span>Category: {r.category}</span>
                        {r.tags && <span>· Tags: {r.tags}</span>}
                      </div>

                      {r.reviewNotes && (
                        <div style={{
                          fontSize: 11,
                          color: "var(--text-muted)",
                          background: "var(--surface)",
                          padding: "6px 8px",
                          borderRadius: 4,
                          borderLeft: `2px solid ${colors.text}`
                        }}>
                          <strong>Notes:</strong> {r.reviewNotes}
                        </div>
                      )}

                      {/* Admin controls */}
                      {isAdmin && r.status === "pending" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                          <input
                            type="text"
                            placeholder="Add review notes (optional)..."
                            value={notesMap[r.id] ?? ""}
                            onChange={(e) => setNotesMap({ ...notesMap, [r.id]: e.target.value })}
                            style={{ padding: "6px 10px", fontSize: 11, width: "100%", background: "var(--surface)" }}
                          />
                          <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <button
                              onClick={() => reviewRecMut.mutate({ id: r.id, action: "reject", reviewNotes: notesMap[r.id] })}
                              disabled={reviewRecMut.isPending}
                              style={{
                                padding: "4px 10px",
                                background: "rgba(239,68,68,0.1)",
                                color: "var(--error)",
                                border: "1px solid var(--error)",
                                fontSize: 11,
                                fontWeight: "bold",
                                borderRadius: "var(--radius)",
                                cursor: "pointer"
                              }}
                            >
                              Reject
                            </button>
                            <button
                              onClick={() => reviewRecMut.mutate({ id: r.id, action: "approve", reviewNotes: notesMap[r.id] })}
                              disabled={reviewRecMut.isPending}
                              style={{
                                padding: "4px 10px",
                                background: "var(--success)",
                                color: "white",
                                border: "none",
                                fontSize: 11,
                                fontWeight: "bold",
                                borderRadius: "var(--radius)",
                                cursor: "pointer"
                              }}
                            >
                              Approve
                            </button>
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
    </div>
  );
}

function TeamView({ team, inviteEmail, setInviteEmail, inviteRole, setInviteRole, onAddMember, onUpdateRole, onRemoveMember, onDeleteTeam, isAddingMember, isUpdatingRole, isRemovingMember, isDeletingTeam }: any) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <div style={{ padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: "0 0 4px 0" }}>{team.name}</h2>
          <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>{team.orgName} · {team.members.length} members · Role: <strong>{team.role}</strong></p>
        </div>
        {team.role !== "member" && (
          <button onClick={onDeleteTeam} disabled={isDeletingTeam} style={{ padding: "6px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--error)", fontSize: 12, cursor: "pointer" }}>Delete Team</button>
        )}
      </div>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0 }}>Members</h3>
        {team.role !== "member" ? (
          <InviteForm label="Add Member by Email" email={inviteEmail} setEmail={setInviteEmail} role={inviteRole} setRole={setInviteRole} roles={["member", "admin"]} onSubmit={() => onAddMember(inviteEmail, inviteRole)} loading={isAddingMember} />
        ) : (
          <div style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", padding: "10px 12px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
            Viewing only (Team Admin permissions required to manage members)
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "400px", overflowY: "auto" }}>
          {team.members.map((m: any) => (
            <MemberRow key={m.userId} member={m} roles={["member", "admin"]} onUpdateRole={(uid, role) => onUpdateRole(uid, role)} onRemove={(uid) => onRemoveMember(uid)} isUpdating={isUpdatingRole} isRemoving={isRemovingMember} currentUserRole={team.role} />
          ))}
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/organization")({
  component: OrganizationPage,
});
