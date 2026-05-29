import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, sql } from "drizzle-orm";
import {
  users,
  organizations,
  organizationMembers,
  teams,
  teamMembers
} from "~/db/schema";
import { requireSession } from "~/server/session";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

// Helpers for role validation on the server
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

  // Organization admins can manage all teams within the organization
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

// Server functions
export const getUserOrgsAndTeams = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizations, organizationMembers, teams, teamMembers, users } });

    // 1. Get organizations where the user is owner/admin
    const orgMemberships = await db
      .select({
        orgId: organizationMembers.orgId,
        name: organizations.name,
        plan: organizations.plan,
        role: organizationMembers.role
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
      .where(
        and(
          eq(organizationMembers.userId, user.id),
          sql`${organizationMembers.role} IN ('owner', 'admin')`
        )
      )
      .all();

    const managedOrgs = [];
    const orgIds = orgMemberships.map((o) => o.orgId);

    for (const m of orgMemberships) {
      // Fetch members of this org
      const members = await db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          role: organizationMembers.role,
          joinedAt: organizationMembers.joinedAt
        })
        .from(organizationMembers)
        .innerJoin(users, eq(organizationMembers.userId, users.id))
        .where(eq(organizationMembers.orgId, m.orgId))
        .all();

      // Fetch teams of this org
      const orgTeams = await db
        .select()
        .from(teams)
        .where(eq(teams.orgId, m.orgId))
        .all();

      managedOrgs.push({
        id: m.orgId,
        name: m.name,
        plan: m.plan,
        role: m.role,
        members,
        teams: orgTeams
      });
    }

    // 2. Fetch teams where the user is a team admin
    const teamMemberships = await db
      .select({
        teamId: teamMembers.teamId,
        name: teams.name,
        orgId: teams.orgId,
        role: teamMembers.role
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(
        and(
          eq(teamMembers.userId, user.id),
          eq(teamMembers.role, "admin")
        )
      )
      .all();

    // 3. We also fetch ALL teams belonging to managedOrgs
    const teamIdsToFetch = new Set<string>();
    for (const t of teamMemberships) {
      teamIdsToFetch.add(t.teamId);
    }
    for (const o of managedOrgs) {
      for (const t of o.teams) {
        teamIdsToFetch.add(t.id);
      }
    }

    const managedTeams = [];
    for (const teamId of teamIdsToFetch) {
      const teamRow = await db
        .select({
          id: teams.id,
          name: teams.name,
          orgId: teams.orgId,
          orgName: organizations.name
        })
        .from(teams)
        .innerJoin(organizations, eq(teams.orgId, organizations.id))
        .where(eq(teams.id, teamId))
        .limit(1)
        .all();

      const teamDetails = teamRow[0];
      if (!teamDetails) continue;

      let role = "member";
      const isParentOrgAdmin = orgIds.includes(teamDetails.orgId);
      if (isParentOrgAdmin) {
        role = "admin";
      } else {
        const memRole = teamMemberships.find((t) => t.teamId === teamId)?.role;
        if (memRole) role = memRole;
      }

      // Fetch team members
      const members = await db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          role: teamMembers.role
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, teamId))
        .all();

      managedTeams.push({
        id: teamId,
        name: teamDetails.name,
        orgId: teamDetails.orgId,
        orgName: teamDetails.orgName,
        role,
        members
      });
    }

    return {
      organizations: managedOrgs,
      teams: managedTeams
    };
  }
);

export const addOrgMemberByEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId: string; email: string; role: "admin" | "member" } => {
    const d = data as { orgId: string; email: string; role: "admin" | "member" };
    return { orgId: d.orgId, email: d.email.trim(), role: d.role };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizationMembers, users } });

    const isOrgAdmin = await verifyOrgAdmin(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");

    // Find user by email
    const userRow = await db
      .select()
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1)
      .all();
    if (userRow.length === 0) {
      throw new Error(`User with email '${data.email}' not found. They must register for a Locker account first.`);
    }
    const targetUser = userRow[0];

    // Check if already in org
    const existingRow = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, targetUser.id)))
      .limit(1)
      .all();
    if (existingRow.length > 0) {
      throw new Error("User is already a member of this organization");
    }

    // Add member
    await db.insert(organizationMembers).values({
      orgId: data.orgId,
      userId: targetUser.id,
      role: data.role,
      joinedAt: Date.now()
    });

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

    const isOrgAdmin = await verifyOrgAdmin(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");

    // Check if we are demoting the last owner
    const targetRow = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)))
      .limit(1)
      .all();
    if (targetRow.length === 0) throw new Error("Member not found in organization");
    const targetMember = targetRow[0];

    if (targetMember.role === "owner" && data.role !== "owner") {
      const otherOwners = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.orgId, data.orgId),
            eq(organizationMembers.role, "owner"),
            sql`${organizationMembers.userId} != ${data.userId}`
          )
        )
        .all();
      if (otherOwners.length === 0) {
        throw new Error("Cannot change role: Organization must have at least one owner.");
      }
    }

    await db
      .update(organizationMembers)
      .set({ role: data.role })
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

    const isOrgAdmin = await verifyOrgAdmin(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");

    // Check owner constraint
    const targetRow = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)))
      .limit(1)
      .all();
    if (targetRow.length === 0) throw new Error("Member not found in organization");
    const targetMember = targetRow[0];

    if (targetMember.role === "owner") {
      const otherOwners = await db
        .select()
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.orgId, data.orgId),
            eq(organizationMembers.role, "owner"),
            sql`${organizationMembers.userId} != ${data.userId}`
          )
        )
        .all();
      if (otherOwners.length === 0) {
        throw new Error("Cannot remove member: Organization must have at least one owner.");
      }
    }

    // Delete from organization members
    await db
      .delete(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)));

    // Delete from all teams in this org
    const orgTeams = await db
      .select({ id: teams.id })
      .from(teams)
      .where(eq(teams.orgId, data.orgId))
      .all();
    const orgTeamIds = orgTeams.map((t) => t.id);

    if (orgTeamIds.length > 0) {
      await db
        .delete(teamMembers)
        .where(
          and(
            eq(teamMembers.userId, data.userId),
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

    const isOrgAdmin = await verifyOrgAdmin(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");

    const teamId = `team_${crypto.randomUUID()}`;

    await db.insert(teams).values({
      id: teamId,
      orgId: data.orgId,
      name: data.name,
      createdAt: Date.now()
    });

    // Auto-add creator as admin of the team
    await db.insert(teamMembers).values({
      teamId,
      userId: user.id,
      role: "admin"
    });

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

    const isTeamAdmin = await verifyTeamAdmin(db, user.id, data.teamId);
    if (!isTeamAdmin) throw new Error("Forbidden: Not authorized to manage this team");

    // Get team parent org
    const teamRow = await db
      .select({ orgId: teams.orgId })
      .from(teams)
      .where(eq(teams.id, data.teamId))
      .limit(1)
      .all();
    if (teamRow.length === 0) throw new Error("Team not found");
    const orgId = teamRow[0].orgId;

    // Find user by email
    const userRow = await db
      .select()
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1)
      .all();
    if (userRow.length === 0) {
      throw new Error(`User with email '${data.email}' not found. They must register for a Locker account first.`);
    }
    const targetUser = userRow[0];

    // Check if they are in the parent org
    const orgMemberRow = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, targetUser.id)))
      .limit(1)
      .all();
    
    if (orgMemberRow.length === 0) {
      // Auto-add user to the parent org as a member
      await db.insert(organizationMembers).values({
        orgId,
        userId: targetUser.id,
        role: "member",
        joinedAt: Date.now()
      });
    }

    // Check if already in the team
    const teamMemberRow = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, data.teamId), eq(teamMembers.userId, targetUser.id)))
      .limit(1)
      .all();
    
    if (teamMemberRow.length > 0) {
      throw new Error("User is already a member of this team");
    }

    // Add to team members
    await db.insert(teamMembers).values({
      teamId: data.teamId,
      userId: targetUser.id,
      role: data.role
    });

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

    const isTeamAdmin = await verifyTeamAdmin(db, user.id, data.teamId);
    if (!isTeamAdmin) throw new Error("Forbidden: Not authorized to manage this team");

    await db
      .update(teamMembers)
      .set({ role: data.role })
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

    const isTeamAdmin = await verifyTeamAdmin(db, user.id, data.teamId);
    if (!isTeamAdmin) throw new Error("Forbidden: Not authorized to manage this team");

    await db
      .delete(teamMembers)
      .where(and(eq(teamMembers.teamId, data.teamId), eq(teamMembers.userId, data.userId)));

    return { success: true };
  });

function OrganizationPage() {
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState<string>("");

  const { data: workspaceData, isLoading, isError, refetch } = useQuery({
    queryKey: ["orgs-and-teams-data"],
    queryFn: () => getUserOrgsAndTeams()
  });

  // UI state for adding members/teams
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [newTeamName, setNewTeamName] = useState("");

  const orgs = workspaceData?.organizations ?? [];
  const teamsList = workspaceData?.teams ?? [];

  // Unified list of options for the selector
  const selectionOptions = useMemo(() => {
    const opts: Array<{ key: string; label: string; type: "org" | "team"; name: string }> = [];
    orgs.forEach((o) => {
      opts.push({ key: `org:${o.id}`, label: `${o.name} (Org)`, type: "org", name: o.name });
    });
    teamsList.forEach((t) => {
      opts.push({ key: `team:${t.id}`, label: `${t.orgName} > ${t.name} (Team)`, type: "team", name: t.name });
    });
    return opts;
  }, [orgs, teamsList]);

  // Handle setting initial selected key once data is loaded
  useState(() => {
    if (selectionOptions.length > 0 && !selectedKey) {
      setSelectedKey(selectionOptions[0].key);
    }
  });

  // If selectedKey is not set but options exist, auto-select first one
  const currentKey = selectedKey || (selectionOptions[0]?.key ?? "");

  const activeSelection = useMemo(() => {
    if (!currentKey) return null;
    const [type, id] = currentKey.split(":");
    if (type === "org") {
      return { type: "org" as const, data: orgs.find((o) => o.id === id) };
    } else {
      return { type: "team" as const, data: teamsList.find((t) => t.id === id) };
    }
  }, [currentKey, orgs, teamsList]);

  // Mutations
  const addOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; email: string; role: "admin" | "member" }) => addOrgMemberByEmail({ data }),
    onSuccess: () => {
      setInviteEmail("");
      refetch();
      alert("Member added successfully!");
    },
    onError: (err) => alert("Failed to add org member: " + String(err))
  });

  const updateOrgMemberRoleMut = useMutation({
    mutationFn: (data: { orgId: string; userId: string; role: "owner" | "admin" | "member" }) => updateOrgMemberRole({ data }),
    onSuccess: () => {
      refetch();
    },
    onError: (err) => alert("Failed to update role: " + String(err))
  });

  const removeOrgMemberMut = useMutation({
    mutationFn: (data: { orgId: string; userId: string }) => removeOrgMember({ data }),
    onSuccess: () => {
      refetch();
    },
    onError: (err) => alert("Failed to remove member: " + String(err))
  });

  const createTeamMut = useMutation({
    mutationFn: (data: { orgId: string; name: string }) => createTeam({ data }),
    onSuccess: () => {
      setNewTeamName("");
      refetch();
      alert("Team created successfully!");
    },
    onError: (err) => alert("Failed to create team: " + String(err))
  });

  const deleteTeamMut = useMutation({
    mutationFn: (data: { teamId: string }) => deleteTeam({ data }),
    onSuccess: () => {
      setSelectedKey(selectionOptions[0]?.key ?? "");
      refetch();
      alert("Team deleted successfully!");
    },
    onError: (err) => alert("Failed to delete team: " + String(err))
  });

  const addTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; email: string; role: string }) => addTeamMemberByEmail({ data }),
    onSuccess: () => {
      setInviteEmail("");
      refetch();
      alert("Team member added successfully!");
    },
    onError: (err) => alert("Failed to add team member: " + String(err))
  });

  const updateTeamMemberRoleMut = useMutation({
    mutationFn: (data: { teamId: string; userId: string; role: string }) => updateTeamMemberRole({ data }),
    onSuccess: () => {
      refetch();
    },
    onError: (err) => alert("Failed to update team member role: " + String(err))
  });

  const removeTeamMemberMut = useMutation({
    mutationFn: (data: { teamId: string; userId: string }) => removeTeamMember({ data }),
    onSuccess: () => {
      refetch();
    },
    onError: (err) => alert("Failed to remove team member: " + String(err))
  });

  if (isLoading) {
    return <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>Loading console...</div>;
  }

  if (isError || !workspaceData) {
    return (
      <div style={{ padding: "40px", textAlign: "center" }}>
        <h3 style={{ color: "var(--error)" }}>Error loading console</h3>
        <p style={{ color: "var(--text-muted)", marginTop: "8px" }}>Please verify you are logged in and have admin permissions.</p>
      </div>
    );
  }

  if (selectionOptions.length === 0) {
    return (
      <div style={{ padding: "40px", maxWidth: "600px", margin: "0 auto", textAlign: "center" }}>
        <h2 style={{ fontSize: "20px", fontWeight: "bold", marginBottom: "12px" }}>No Admin Workspaces</h2>
        <p style={{ color: "var(--text-muted)", lineHeight: "1.6" }}>
          You do not currently own or admin any organizations or teams. Ask your system administrator to provision an organization and add you as an owner or administrator.
        </p>
        <div style={{ marginTop: "24px" }}>
          <Link to="/" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>← Back to App</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "20px", maxWidth: "1000px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: "bold", color: "var(--text)", letterSpacing: "-0.02em" }}>Organization Console</h1>
        <Link to="/" style={{ color: "var(--accent)", fontSize: "14px", textDecoration: "none" }}>← Back to App</Link>
      </div>

      {/* Selector dropdown */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center", padding: "16px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", marginBottom: "24px" }}>
        <label style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Workspace to Manage:</label>
        <select
          value={currentKey}
          onChange={(e) => {
            setSelectedKey(e.target.value);
            setInviteEmail("");
            setNewTeamName("");
          }}
          style={{ padding: "8px 16px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", flex: 1, outline: "none", fontWeight: "600" }}
        >
          {selectionOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>{opt.label}</option>
          ))}
        </select>
      </div>

      {activeSelection && activeSelection.type === "org" && activeSelection.data && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Org Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0 }}>{activeSelection.data.name}</h2>
                <span style={{ fontSize: "10px", background: "var(--accent-dim)", color: "var(--accent)", padding: "2px 8px", borderRadius: "20px", fontWeight: "bold", textTransform: "uppercase" }}>
                  {activeSelection.data.plan}
                </span>
              </div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                Organization Locker Vault · {activeSelection.data.members.length} members · {activeSelection.data.teams.length} teams
              </p>
            </div>
            <span style={{ fontSize: "11px", color: "var(--text-muted)", border: "1px solid var(--border)", padding: "4px 10px", borderRadius: "8px" }}>
              Your Role: <strong style={{ color: "var(--text)" }}>{activeSelection.data.role}</strong>
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
            {/* Members Card */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0, borderBottom: "1px solid var(--border)", paddingBottom: "10px" }}>Org Members</h3>

              {/* Add Member Form */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "var(--surface2)", padding: "12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase" }}>Add Member by Email</span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="email"
                    placeholder="user@example.com"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    style={{ flex: 1, padding: "6px 10px", fontSize: "13px" }}
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    style={{ padding: "6px 8px", fontSize: "12px" }}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    onClick={() => addOrgMemberMut.mutate({ orgId: activeSelection.data!.id, email: inviteEmail, role: inviteRole as any })}
                    disabled={addOrgMemberMut.isPending || !inviteEmail.trim()}
                    style={{ padding: "6px 12px", background: "var(--accent)", color: "white", fontSize: "12px", fontWeight: "bold" }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Members List */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "300px", overflowY: "auto" }}>
                {activeSelection.data.members.map((member) => (
                  <div key={member.userId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: "13px", fontWeight: "600" }}>{member.name || "Pending Account"}</span>
                      <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{member.email}</span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      {/* Role selection dropdown */}
                      <select
                        value={member.role}
                        onChange={(e) => updateOrgMemberRoleMut.mutate({ orgId: activeSelection.data!.id, userId: member.userId, role: e.target.value as any })}
                        disabled={updateOrgMemberRoleMut.isPending}
                        style={{ padding: "4px 6px", fontSize: "11px", background: "var(--surface)" }}
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>

                      <button
                        onClick={() => {
                          if (confirm(`Remove ${member.email} from the organization?`)) {
                            removeOrgMemberMut.mutate({ orgId: activeSelection.data!.id, userId: member.userId });
                          }
                        }}
                        disabled={removeOrgMemberMut.isPending}
                        style={{ padding: "4px 8px", background: "transparent", color: "var(--error)", border: "1px solid transparent", fontSize: "11px" }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Teams Card */}
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
              <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0, borderBottom: "1px solid var(--border)", paddingBottom: "10px" }}>Org Teams</h3>

              {/* Create Team Form */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "var(--surface2)", padding: "12px", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase" }}>Create New Team</span>
                <div style={{ display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    placeholder="e.g. engineering, marketing"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    style={{ flex: 1, padding: "6px 10px", fontSize: "13px" }}
                  />
                  <button
                    onClick={() => createTeamMut.mutate({ orgId: activeSelection.data!.id, name: newTeamName })}
                    disabled={createTeamMut.isPending || !newTeamName.trim()}
                    style={{ padding: "6px 16px", background: "var(--accent)", color: "white", fontSize: "12px", fontWeight: "bold" }}
                  >
                    Create
                  </button>
                </div>
              </div>

              {/* Teams List */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "300px", overflowY: "auto" }}>
                {activeSelection.data.teams.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: "12px" }}>No teams created yet.</div>
                ) : (
                  activeSelection.data.teams.map((team) => (
                    <div key={team.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                      <div>
                        <span style={{ fontSize: "13px", fontWeight: "600" }}>{team.name}</span>
                        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "2px" }}>Created {new Date(team.createdAt).toLocaleDateString()}</div>
                      </div>

                      <div style={{ display: "flex", gap: "8px" }}>
                        <button
                          onClick={() => setSelectedKey(`team:${team.id}`)}
                          style={{ padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: "11px" }}
                        >
                          Manage Members
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete the team ${team.name}? This will delete all team memories and memberships!`)) {
                              deleteTeamMut.mutate({ teamId: team.id });
                            }
                          }}
                          disabled={deleteTeamMut.isPending}
                          style={{ padding: "4px 8px", background: "transparent", color: "var(--error)", border: "1px solid transparent", fontSize: "11px" }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSelection && activeSelection.type === "team" && activeSelection.data && (
        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Team Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }}>
            <div>
              <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0 }}>{activeSelection.data.name}</h2>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                Team Locker Vault under <span style={{ color: "var(--accent)" }}>{activeSelection.data.orgName}</span> · {activeSelection.data.members.length} members
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                onClick={() => {
                  if (confirm(`Delete this team (${activeSelection.data!.name})?`)) {
                    deleteTeamMut.mutate({ teamId: activeSelection.data!.id });
                  }
                }}
                style={{ padding: "5px 10px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid var(--error)", color: "var(--error)", fontSize: "11px", fontWeight: "bold" }}
              >
                Delete Team
              </button>
              <span style={{ fontSize: "11px", color: "var(--text-muted)", border: "1px solid var(--border)", padding: "4px 10px", borderRadius: "8px" }}>
                Your Role: <strong style={{ color: "var(--text)" }}>{activeSelection.data.role}</strong>
              </span>
            </div>
          </div>

          {/* Team Members Card */}
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: "bold", margin: 0, borderBottom: "1px solid var(--border)", paddingBottom: "10px" }}>Team Members</h3>

            {/* Add Team Member Form */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", background: "var(--surface2)", padding: "12px", borderRadius: "var(--radius)", border: "1px solid var(--border)", maxWidth: "500px" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase" }}>Add Team Member by Email</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  style={{ flex: 1, padding: "6px 10px", fontSize: "13px" }}
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  style={{ padding: "6px 8px", fontSize: "12px" }}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={() => addTeamMemberMut.mutate({ teamId: activeSelection.data!.id, email: inviteEmail, role: inviteRole })}
                  disabled={addTeamMemberMut.isPending || !inviteEmail.trim()}
                  style={{ padding: "6px 12px", background: "var(--accent)", color: "white", fontSize: "12px", fontWeight: "bold" }}
                >
                  Add
                </button>
              </div>
            </div>

            {/* Team Members List */}
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {activeSelection.data.members.map((member) => (
                <div key={member.userId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: "13px", fontWeight: "600" }}>{member.name || "Pending Account"}</span>
                    <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>{member.email}</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <select
                      value={member.role}
                      onChange={(e) => updateTeamMemberRoleMut.mutate({ teamId: activeSelection.data!.id, userId: member.userId, role: e.target.value })}
                      disabled={updateTeamMemberRoleMut.isPending}
                      style={{ padding: "4px 6px", fontSize: "11px", background: "var(--surface)" }}
                    >
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                    </select>

                    <button
                      onClick={() => {
                        if (confirm(`Remove ${member.email} from the team?`)) {
                          removeTeamMemberMut.mutate({ teamId: activeSelection.data!.id, userId: member.userId });
                        }
                      }}
                      disabled={removeTeamMemberMut.isPending}
                      style={{ padding: "4px 8px", background: "transparent", color: "var(--error)", border: "1px solid transparent", fontSize: "11px" }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/organization")({
  component: OrganizationPage
});
