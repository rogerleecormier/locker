import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BYOKSetup } from "~/components/Vault/BYOKSetup";
import { useToast } from "~/components/ui/toast";
import { InfoTooltip } from "~/components/InfoTooltip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "~/components/PageHeader";
import { PageContainer } from "~/components/PageContainer";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Label, Input, Select, Textarea } from "~/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "~/components/ui/dialog";
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
  credentials,
  webhookEvents,
  memories,
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

export const saveWebhookSecret = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId: string; platform: "github" | "linear"; secret: string } => {
    const d = data as { orgId: string; platform: string; secret: string };
    if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
    if (d.platform !== "github" && d.platform !== "linear") throw new Error("platform must be 'github' or 'linear'");
    if (!d.secret || typeof d.secret !== "string") throw new Error("secret is required");
    return { orgId: d.orgId, platform: d.platform, secret: d.secret };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizationMembers, credentials } });
    await requireFeature(db, user.id, "organizations");
    const isOrgAdmin = await verifyOrgAdminHelper(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");

    const credName = data.platform === "github" ? "__WEBHOOK_GITHUB__" : "__WEBHOOK_LINEAR__";
    const vaultId = `org:${data.orgId}`;
    const credId = `cred_${crypto.randomUUID().replace(/-/g, "")}`;

    const existing = await db
      .select({ id: credentials.id })
      .from(credentials)
      .where(and(eq(credentials.projectKey, vaultId), eq(credentials.name, credName)))
      .limit(1)
      .all();

    if (existing.length > 0) {
      await db.update(credentials)
        .set({ encryptedValue: data.secret, updatedAt: Date.now() })
        .where(eq(credentials.id, existing[0].id));
    } else {
      await db.insert(credentials).values({
        id: credId,
        userId: user.id,
        name: credName,
        encryptedValue: data.secret,
        projectKey: vaultId,
        scopeType: "organization",
        scopeId: data.orgId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return { success: true };
  });

export const getWebhookEventLog = createServerFn({ method: "GET" })
  .inputValidator((data: unknown): { orgId: string; limit: number } => {
    const d = data as { orgId: string; limit: number };
    if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
    const limit = Math.min(Math.max(1, d.limit || 50), 500);
    return { orgId: d.orgId, limit };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { organizationMembers, webhookEvents, memories, users } });
    await requireFeature(db, user.id, "organizations");
    const isOrgAdmin = await verifyOrgAdminHelper(db, user.id, data.orgId);
    if (!isOrgAdmin) throw new Error("Forbidden: Not an organization owner/admin");

    const rows = await db
      .select({
        id: webhookEvents.id,
        source: webhookEvents.source,
        eventType: webhookEvents.eventType,
        rawTitle: webhookEvents.rawTitle,
        processedAt: webhookEvents.processedAt,
        memoryId: webhookEvents.memoryId,
        externalId: webhookEvents.externalId,
        userName: users.name,
      })
      .from(webhookEvents)
      .leftJoin(users, eq(webhookEvents.userId, users.id))
      .where(eq(webhookEvents.projectKey, `org:${data.orgId}`))
      .orderBy(sql`${webhookEvents.processedAt} DESC`)
      .limit(data.limit)
      .all();

    return { events: rows ?? [] };
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
    <div className="flex justify-between items-center p-3 md:p-3.5 bg-surface2 rounded-xl border border-border">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs md:text-sm font-semibold text-text">{member.name || "–"}</span>
        <span className="text-[10px] md:text-xs text-text-muted font-medium">{member.email}</span>
      </div>
      <div className="flex items-center gap-2 select-none">
        {isReadOnly ? (
          <Badge variant="secondary" className="px-2.5 py-0.5 text-[9px] md:text-[10px]">{member.role}</Badge>
        ) : (
          <>
            <Select
              value={member.role}
              onChange={(e) => onUpdateRole(member.userId, e.target.value)}
              disabled={isUpdating}
              className="h-7 text-xs px-2 min-w-[90px] cursor-pointer"
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </option>
              ))}
            </Select>
            {confirming ? (
              <div className="flex items-center gap-1.5">
                <Button
                  onClick={() => onRemove(member.userId)}
                  disabled={isRemoving}
                  size="sm"
                  className="h-7 text-xs bg-error/15 border-error/30 text-error hover:bg-error/25 hover:border-error/50 font-semibold"
                  variant="outline"
                >
                  {isRemoving ? "…" : "Yes"}
                </Button>
                <Button
                  onClick={() => setConfirming(false)}
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                >
                  No
                </Button>
              </div>
            ) : (
              <Button
                onClick={() => setConfirming(true)}
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-error hover:text-error hover:bg-error/5"
              >
                Remove
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function InviteForm({ label, email, setEmail, role, setRole, roles, onSubmit, loading }: {
  label: string;
  email: string;
  setEmail: (v: string) => void;
  role: string;
  setRole: (v: string) => void;
  roles: string[];
  onSubmit: () => void;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5 bg-surface2 p-4 rounded-xl border border-border select-none">
      <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{label}</span>
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1 h-9 text-xs"
        />
        {roles.length > 0 && (
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="h-9 text-xs min-w-[95px] cursor-pointer"
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </option>
            ))}
          </Select>
        )}
        <Button
          onClick={onSubmit}
          disabled={loading || !email.trim()}
          className="h-9 px-4 font-bold text-xs select-none"
        >
          {loading ? "…" : "Add"}
        </Button>
      </div>
    </div>
  );
}

export function CreateOrgModal({ onClose, onSubmit, loading, nameValue, onNameChange }: {
  onClose: () => void;
  onSubmit: (name: string) => void;
  loading: boolean;
  nameValue: string;
  onNameChange: (v: string) => void;
}) {
  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Create Organization</DialogTitle>
          <DialogDescription>You will be automatically added as the Owner.</DialogDescription>
        </DialogHeader>

        <div className="py-2 flex flex-col gap-3 select-none">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-org-name">Organization Name</Label>
            <Input
              id="new-org-name"
              type="text"
              value={nameValue}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. Acme Corporation"
              autoFocus
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit(nameValue)}
            disabled={loading || !nameValue.trim()}
          >
            {loading ? "Creating..." : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

  const orgIcon = (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );

  if (isLoading) {
    return (
      <div className="flex-grow flex items-center justify-center min-h-[400px]">
        <div className="text-text-muted font-medium animate-pulse">Loading…</div>
      </div>
    );
  }

  if (planId === "free") {
    return (
      <div className="flex-1 min-h-screen bg-background">
        <PageHeader
          title="Team Space"
          icon={orgIcon}
          description="Authoritative knowledge, team recommendations, and member management for your organization."
        />
        <PageContainer>
          <PaywallGate feature="organizations" currentPlan="free" requiredPlan="business">
            <></>
          </PaywallGate>
          <div className="mt-8 select-none">
            <h2 className="text-base font-semibold mb-4 text-text">What you get with Business</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { icon: "🏢", title: "Organizations", desc: "Shared workspace with role-based access" },
                { icon: "👥", title: "Teams", desc: "Sub-teams with scoped memory vaults" },
                { icon: "📚", title: "Shared Vaults", desc: "AI sessions access shared context automatically" },
                { icon: "📊", title: "Usage Analytics", desc: "Track MCP usage per API token" },
              ].map(({ icon, title, desc }) => (
                <div
                  key={title}
                  className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl"
                >
                  <div className="text-sm font-semibold mb-1 text-text">
                    <span className="mr-1.5">{icon}</span> {title}
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 text-center">
              <Link
                to="/pricing"
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent-hover text-white font-semibold text-sm rounded-lg transition-colors"
              >
                View Plans & Pricing →
              </Link>
            </div>
          </div>
        </PageContainer>
      </div>
    );
  }

  if (orgs.length === 0) {
    return (
      <div className="flex-1 min-h-screen bg-background">
        <PageHeader
          title="Team Space"
          icon={orgIcon}
          description="Authoritative knowledge, team recommendations, and member management for your organization."
        />
        <PageContainer>
          <div className="py-16 text-center max-w-md mx-auto flex flex-col items-center gap-4 select-none">
            <div className="text-4xl">🏢</div>
            <h2 className="text-xl font-bold tracking-tight text-text">No organizations yet</h2>
            <p className="text-sm text-text-muted leading-relaxed">
              Ask your site administrator to create an organization and add you as a member.
            </p>
            <Link
              to="/admin"
              className="px-5 py-2 bg-accent hover:bg-accent-hover text-white font-semibold text-sm rounded-lg transition-colors"
            >
              Go to Admin →
            </Link>
          </div>
        </PageContainer>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-screen bg-background">
      <PageHeader
        title="Team Space"
        icon={orgIcon}
        description="Authoritative knowledge, team recommendations, and member management for your organization."
      >
        <div className="flex items-center gap-2 mt-2">
          <InfoTooltip text="Team Space is the shared workspace for your organization — add authoritative memories all members' AI sessions will inherit, review member-submitted recommendations, and manage who has access." />
          <Badge variant="projects" className="normal-case font-semibold tracking-normal">
            Team
          </Badge>
        </div>
      </PageHeader>

      <PageContainer>
        {orgs.length > 1 && (
          <div className="flex gap-3 items-center p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl mb-2 select-none">
            <label className="text-xs font-bold text-text-muted uppercase tracking-wider whitespace-nowrap">
              Organization:
            </label>
            <Select
              value={currentOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="cursor-pointer font-semibold"
            >
              {orgs.map((o: any) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {currentOrg && <OrgVaultView org={currentOrg} />}
      </PageContainer>
    </div>
  );
}

function OrgVaultView({ org }: { org: any }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<"vault" | "recommendations" | "members" | "security">("vault");
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
    onSuccess: () => {
      setRecFact("");
      setRecTags("");
      setRecProjectKey("");
      refetchRecs();
      toast.success("Recommendation submitted for review!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const addDirectMemoryMut = useMutation({
    mutationFn: (data: any) => addMemory({ data }),
    onSuccess: () => {
      setDirectFact("");
      setDirectTags("");
      setDirectProjectKey("");
      refetchOrgMemories();
      queryClient.invalidateQueries({ queryKey: ["orgs-and-teams-data"] });
      toast.success("Authoritative memory added!");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMemoryMut = useMutation({
    mutationFn: (data: { id: string }) => deleteMemory({ data }),
    onSuccess: () => {
      refetchOrgMemories();
      queryClient.invalidateQueries({ queryKey: ["orgs-and-teams-data"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reviewRecMut = useMutation({
    mutationFn: (data: any) => reviewMemoryRecommendation({ data }),
    onSuccess: () => {
      refetchRecs();
      queryClient.invalidateQueries({ queryKey: ["orgs-and-teams-data"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const tabBtn = (id: "vault" | "recommendations" | "members" | "security", label: string, tooltip?: string) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => setActiveTab(id)}
        className={`px-4 py-2.5 text-xs md:text-sm font-semibold border-b-2 whitespace-nowrap transition-colors -mb-[1px] rounded-t-md hover:bg-surface2/40 uppercase tracking-wider text-[11px] flex items-center gap-1.5 ${
          active
            ? "border-accent text-accent bg-surface"
            : "border-transparent text-text-muted hover:text-text"
        }`}
      >
        {label}
        {tooltip && <InfoTooltip text={tooltip} size={12} />}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="p-5 bg-surface border border-border rounded-xl shadow-xs select-none">
        <h2 className="text-lg font-bold text-text mb-1">{org.name}</h2>
        <p className="text-xs text-text-muted">
          {org.members.length} members · {org.teams.length} teams · Role:{" "}
          <strong className="text-accent font-semibold">{org.role}</strong>
        </p>
      </div>

      <div className="flex border-b border-border gap-1 overflow-x-auto no-scrollbar select-none">
        {tabBtn(
          "vault",
          "Vault",
          "Org-approved memories that are automatically included in every member's AI sessions. Only admins can add entries directly."
        )}
        {tabBtn(
          "recommendations",
          isAdmin ? "Review Recommendations" : "Recommendations",
          isAdmin
            ? "Member-submitted memory suggestions pending your approval. Approved entries are promoted to the Vault."
            : "Submit memories for org admin review. Approved entries will be promoted to the Vault and shared with all members."
        )}
        {isAdmin &&
          tabBtn(
            "members",
            "Members",
            "View current org members and pending invitations. To invite someone new, use Admin → Organizations."
          )}
        {isAdmin && org.plan === "enterprise" &&
          tabBtn(
            "security",
            "Security",
            "Configure Enterprise SSO (SAML/OIDC) and Bring Your Own Key (BYOK) end-to-end encryption."
          )}
      </div>

      {activeTab === "vault" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 shadow-xs">
            <h3 className="text-sm font-bold text-text flex items-center gap-1.5 uppercase tracking-wider select-none">
              Add Authoritative Memory
              <InfoTooltip
                text="Authoritative memories are locked org facts — coding standards, architectural decisions, team norms — that override individual member memories during AI sessions."
                size={13}
              />
            </h3>
            {isAdmin ? (
              <div className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="direct-fact" className="text-[10px]">
                    Fact
                  </Label>
                  <Textarea
                    id="direct-fact"
                    placeholder="e.g. Always use camelCase for folder structure"
                    value={directFact}
                    onChange={(e) => setDirectFact(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="direct-cat" className="text-[10px]">
                      Category
                    </Label>
                    <Select
                      id="direct-cat"
                      value={directCategory}
                      onChange={(e: any) => setDirectCategory(e.target.value)}
                    >
                      <option value="rules">Rules</option>
                      <option value="projects">Projects</option>
                      <option value="references">References</option>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="direct-scope" className="text-[10px]">
                      Scope
                    </Label>
                    <Select
                      id="direct-scope"
                      value={directProjectKey}
                      onChange={(e) => setDirectProjectKey(e.target.value)}
                    >
                      <option value="">Whole Organization</option>
                      {org.teams.map((t: any) => (
                        <option key={t.id} value={`team:${t.id}`}>
                          Team: {t.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="direct-tags" className="text-[10px]">
                    Tags
                  </Label>
                  <Input
                    id="direct-tags"
                    type="text"
                    placeholder="e.g. guidelines, styles"
                    value={directTags}
                    onChange={(e) => setDirectTags(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() =>
                    addDirectMemoryMut.mutate({
                      fact: directFact,
                      category: directCategory,
                      tags: directTags,
                      projectKey: directProjectKey || `org:${org.id}`,
                      isLocked: true,
                      authorityType: "authoritative",
                    })
                  }
                  disabled={addDirectMemoryMut.isPending || !directFact.trim()}
                  className="mt-1 font-bold text-xs select-none"
                >
                  {addDirectMemoryMut.isPending ? "Creating..." : "Add Authoritative Memory"}
                </Button>
              </div>
            ) : (
              <div className="text-xs text-text-muted italic p-5 bg-surface2 border border-border rounded-xl text-center select-none">
                Only owners/admins can add authoritative memories directly.
              </div>
            )}
          </div>
          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 shadow-xs">
            <h3 className="text-sm font-bold text-text uppercase tracking-wider select-none">
              Vault Entries
            </h3>
            {memoriesLoading ? (
              <div className="text-text-muted text-center py-6 animate-pulse font-medium text-sm">
                Loading...
              </div>
            ) : orgMemories.length === 0 ? (
              <div className="text-text-muted text-center py-6 text-xs italic select-none">
                No memories in vault.
              </div>
            ) : (
              <div className="flex flex-col gap-3 overflow-y-auto max-h-[380px] no-scrollbar pr-1">
                {orgMemories.map((m: any) => (
                  <div
                    key={m.id}
                    className="p-3.5 bg-surface2 border border-border rounded-xl flex flex-col gap-2 shadow-2xs hover:border-border-hover transition-colors"
                  >
                    <div className="flex justify-between items-start gap-3">
                      <p className="text-xs text-text font-medium leading-relaxed flex-1">
                        "{m.fact}"
                      </p>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (confirm("Delete this memory?")) deleteMemoryMut.mutate({ id: m.id });
                          }}
                          disabled={deleteMemoryMut.isPending}
                          className="h-5 px-1.5 text-[10px] text-error hover:bg-error/5 hover:text-error hover:border-error/20"
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={m.isLocked ? "accent" : "secondary"} className="h-4 text-[9px] px-1.5 py-0">
                        {m.authorityType}
                      </Badge>
                      <Badge variant={m.category} className="h-4 text-[9px] px-1.5 py-0">
                        {m.category}
                      </Badge>
                      {m.tags && (
                        <span className="text-[10px] text-text-muted bg-tag-bg border border-tag-border px-1.5 rounded-sm font-mono leading-none">
                          {m.tags}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "recommendations" && (
        <div className={`grid gap-6 ${isAdmin ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
          {!isAdmin && (
            <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 shadow-xs">
              <h3 className="text-sm font-bold text-text uppercase tracking-wider select-none">
                Recommend Entry for Org Vault
              </h3>
              <div className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rec-fact" className="text-[10px]">
                    Fact
                  </Label>
                  <Textarea
                    id="rec-fact"
                    placeholder="Recommend a rule or fact"
                    value={recFact}
                    onChange={(e) => setRecFact(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rec-cat" className="text-[10px]">
                      Category
                    </Label>
                    <Select
                      id="rec-cat"
                      value={recCategory}
                      onChange={(e: any) => setRecCategory(e.target.value)}
                    >
                      <option value="rules">Rules</option>
                      <option value="projects">Projects</option>
                      <option value="references">References</option>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rec-scope" className="text-[10px]">
                      Scope
                    </Label>
                    <Select
                      id="rec-scope"
                      value={recProjectKey}
                      onChange={(e) => setRecProjectKey(e.target.value)}
                    >
                      <option value="">Whole Organization</option>
                      {org.teams.map((t: any) => (
                        <option key={t.id} value={`team:${t.id}`}>
                          Team: {t.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="rec-tags" className="text-[10px]">
                    Tags
                  </Label>
                  <Input
                    id="rec-tags"
                    type="text"
                    placeholder="e.g. guidelines, styles"
                    value={recTags}
                    onChange={(e) => setRecTags(e.target.value)}
                  />
                </div>
                <Button
                  onClick={() =>
                    submitRecMut.mutate({
                      orgId: org.id,
                      fact: recFact,
                      category: recCategory,
                      tags: recTags,
                      projectKey: recProjectKey || undefined,
                    })
                  }
                  disabled={submitRecMut.isPending || !recFact.trim()}
                  className="mt-1 font-bold text-xs select-none"
                >
                  {submitRecMut.isPending ? "Submitting..." : "Submit Recommendation"}
                </Button>
              </div>
            </div>
          )}
          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 shadow-xs">
            <h3 className="text-sm font-bold text-text uppercase tracking-wider select-none">
              {isAdmin ? "Review Queue" : "My Submission History"}
            </h3>
            {recsLoading ? (
              <div className="text-text-muted text-center py-6 animate-pulse font-medium text-sm">
                Loading...
              </div>
            ) : recs.length === 0 ? (
              <div className="text-text-muted text-center py-6 text-xs italic select-none">
                No recommendations found.
              </div>
            ) : (
              <div className="flex flex-col gap-3 overflow-y-auto max-h-[380px] no-scrollbar pr-1">
                {recs.map((r: any) => (
                  <div
                    key={r.id}
                    className="p-3.5 bg-surface2 border border-border rounded-xl flex flex-col gap-3 shadow-2xs"
                  >
                    <div className="flex justify-between items-center flex-wrap gap-2 select-none">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[9px] font-bold uppercase px-2 py-0.5 border rounded-full ${
                            r.status === "approved"
                              ? "border-success/30 bg-success/10 text-success"
                              : r.status === "rejected"
                                ? "border-error/30 bg-error/10 text-error"
                                : "border-amber-500/30 bg-amber-500/10 text-amber-400"
                          }`}
                        >
                          {r.status}
                        </span>
                        {r.recommendationType === "archive" && (
                          <span className="text-[9px] font-bold uppercase px-2 py-0.5 border rounded-full border-red-500/35 bg-red-500/15 text-red-400">
                            Archive Proposal
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-text-muted font-medium">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-text font-medium leading-relaxed">
                      {r.recommendationType === "archive" ? (
                        <span>
                          Proposing to archive existing memory: <span className="text-red-400 italic">"{r.fact}"</span>
                        </span>
                      ) : (
                        <span>"{r.fact}"</span>
                      )}
                    </p>
                    <div className="flex items-center gap-1.5 select-none">
                      <Badge variant={r.category} className="h-4 text-[9px] px-1.5 py-0">
                        {r.category}
                      </Badge>
                      {r.tags && (
                        <span className="text-[10px] text-text-muted bg-tag-bg border border-tag-border px-1.5 rounded-sm font-mono leading-none">
                          {r.tags}
                        </span>
                      )}
                    </div>
                    {r.reviewNotes && (
                      <div className="text-xs text-text-muted bg-surface p-2.5 rounded-lg border-l-2 border-accent select-none">
                        <strong>Notes:</strong> {r.reviewNotes}
                      </div>
                    )}
                    {isAdmin && r.status === "pending" && (
                      <div className="flex flex-col gap-2 mt-1 border-t border-border pt-3">
                        <Input
                          type="text"
                          placeholder="Review notes (optional)"
                          value={notesMap[r.id] ?? ""}
                          onChange={(e) => setNotesMap({ ...notesMap, [r.id]: e.target.value })}
                          className="h-8 text-xs"
                        />
                        <div className="flex gap-2 justify-end select-none">
                          <Button
                            onClick={() =>
                              reviewRecMut.mutate({
                                id: r.id,
                                action: "reject",
                                reviewNotes: notesMap[r.id],
                              })
                            }
                            disabled={reviewRecMut.isPending}
                            className="h-7 text-xs bg-error/10 border-error/20 text-error hover:bg-error/20 hover:border-error/40 font-semibold"
                            variant="outline"
                          >
                            Reject
                          </Button>
                          <Button
                            onClick={() =>
                              reviewRecMut.mutate({
                                id: r.id,
                                action: "approve",
                                reviewNotes: notesMap[r.id],
                              })
                            }
                            disabled={reviewRecMut.isPending}
                            className="h-7 text-xs bg-success/15 border-success/30 text-success hover:bg-success/25 hover:border-success/50 font-semibold"
                            variant="outline"
                          >
                            Approve
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "members" && isAdmin && (
        <div className="flex flex-col gap-6 select-none">
          {/* Invite callout */}
          <div className="flex items-start gap-3 p-4 bg-accent/5 border border-accent/20 rounded-xl">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-accent flex-shrink-0 mt-0.5"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <div className="text-xs md:text-sm text-text-muted leading-relaxed">
              <strong className="text-text">To invite new members,</strong> go to{" "}
              <a
                href="/admin"
                className="text-accent hover:underline font-semibold"
              >
                Admin → Organizations
              </a>{" "}
              and use the <em>Add Member by Email</em> form. Invitations are sent by email with a
              48-hour acceptance window, and will appear as Pending here once sent.
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 shadow-xs">
            <h3 className="text-sm font-bold text-text uppercase tracking-wider">Current Members</h3>
            {org.members.length === 0 ? (
              <p className="text-text-muted text-xs italic">No members yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {org.members.map((m: any) => (
                  <div
                    key={m.id}
                    className="flex justify-between items-center p-3 bg-surface2 border border-border rounded-xl text-xs"
                  >
                    <div>
                      <div className="font-semibold text-text">{m.name || m.email}</div>
                      <div className="text-text-muted text-[11px] font-medium mt-0.5">{m.email}</div>
                    </div>
                    <Badge variant="accent" className="h-5 text-[9px] px-2.5 font-bold tracking-normal normal-case">
                      {m.role}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 shadow-xs">
            <h3 className="text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
              Pending Invitations{" "}
              {pendingInvitations.length > 0 && (
                <span className="text-xs font-normal text-text-muted normal-case tracking-normal">
                  ({pendingInvitations.length})
                </span>
              )}
            </h3>
            {invitationsLoading ? (
              <p className="text-text-muted text-xs font-medium animate-pulse">Loading...</p>
            ) : pendingInvitations.length === 0 ? (
              <p className="text-text-muted text-xs italic">No pending invitations.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {pendingInvitations.map((inv: any) => (
                  <div
                    key={inv.id}
                    className="flex justify-between items-center p-3 bg-surface2 border border-border rounded-xl text-xs"
                  >
                    <div>
                      <div className="font-semibold text-text">{inv.email}</div>
                      <div className="text-text-muted text-[11px] font-medium mt-0.5">
                        Expires {new Date(inv.expiresAt).toLocaleDateString()} · Role: {inv.role}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        disabled
                        variant="outline"
                        className="h-6 text-[10px] px-2.5 border-accent/20 bg-accent/5 text-accent font-semibold"
                      >
                        Pending
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-text-muted mt-2 pt-3 border-t border-border leading-relaxed">
              Pending invitations expire after 48 hours. Use{" "}
              <a href="/admin" className="text-accent hover:underline">
                Admin → Organizations
              </a>{" "}
              to resend or cancel invitations.
            </p>
          </div>
        </div>
      )}

      {activeTab === "security" && isAdmin && org.plan === "enterprise" && (
        <SecurityPanel org={org} />
      )}
    </div>
  );
}

function IntegrationsPanel({ org }: { org: any }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [githubSecret, setGithubSecret] = useState("");
  const [linearSecret, setLinearSecret] = useState("");

  const { data: webhookEventsData, isLoading: eventsLoading, refetch: refetchEvents } = useQuery({
    queryKey: ["webhook-events", org.id],
    queryFn: () => getWebhookEventLog({ data: { orgId: org.id, limit: 50 } }),
  });

  const saveGithubMut = useMutation({
    mutationFn: (secret: string) =>
      saveWebhookSecret({ data: { orgId: org.id, platform: "github", secret } }),
    onSuccess: () => {
      setGithubSecret("");
      toast.success("GitHub webhook secret saved!");
      refetchEvents();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const saveLinearMut = useMutation({
    mutationFn: (secret: string) =>
      saveWebhookSecret({ data: { orgId: org.id, platform: "linear", secret } }),
    onSuccess: () => {
      setLinearSecret("");
      toast.success("Linear webhook secret saved!");
      refetchEvents();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const events = webhookEventsData?.events ?? [];

  return (
    <div className="flex flex-col gap-6 select-none">
      {/* Webhook Configuration Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* GitHub */}
        <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 shadow-xs">
          <h3 className="text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
            🐙 GitHub Webhook
          </h3>
          <p className="text-xs text-text-muted leading-relaxed">
            Configure webhook signing secret for GitHub "PR Merged" events.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="github-secret" className="text-[10px]">
              Webhook Secret
            </Label>
            <Input
              id="github-secret"
              type="password"
              placeholder="ghp_... or your custom secret"
              value={githubSecret}
              onChange={(e) => setGithubSecret(e.target.value)}
              className="text-xs"
            />
          </div>
          <Button
            onClick={() => saveGithubMut.mutate(githubSecret)}
            disabled={saveGithubMut.isPending || !githubSecret.trim()}
            className="mt-1 font-bold text-xs select-none"
          >
            {saveGithubMut.isPending ? "Saving..." : "Save Secret"}
          </Button>
        </div>

        {/* Linear */}
        <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 shadow-xs">
          <h3 className="text-sm font-bold text-text uppercase tracking-wider flex items-center gap-2">
            ⚡ Linear Webhook
          </h3>
          <p className="text-xs text-text-muted leading-relaxed">
            Configure webhook signing secret for Linear "Ticket Done" events.
          </p>
          <div className="flex flex-col gap-2">
            <Label htmlFor="linear-secret" className="text-[10px]">
              Webhook Secret
            </Label>
            <Input
              id="linear-secret"
              type="password"
              placeholder="lin_... or your custom secret"
              value={linearSecret}
              onChange={(e) => setLinearSecret(e.target.value)}
              className="text-xs"
            />
          </div>
          <Button
            onClick={() => saveLinearMut.mutate(linearSecret)}
            disabled={saveLinearMut.isPending || !linearSecret.trim()}
            className="mt-1 font-bold text-xs select-none"
          >
            {saveLinearMut.isPending ? "Saving..." : "Save Secret"}
          </Button>
        </div>
      </div>

      {/* Webhook Event Log Section */}
      <div className="bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 shadow-xs">
        <h3 className="text-sm font-bold text-text uppercase tracking-wider">
          Recent Webhook Events
        </h3>
        {eventsLoading ? (
          <div className="text-text-muted text-center py-6 animate-pulse font-medium text-sm">
            Loading events…
          </div>
        ) : events.length === 0 ? (
          <div className="text-text-muted text-center py-6 text-xs italic">
            No webhook events processed yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left p-2.5 text-text-muted font-bold uppercase tracking-wider text-[10px]">Source</th>
                  <th className="text-left p-2.5 text-text-muted font-bold uppercase tracking-wider text-[10px]">Event Type</th>
                  <th className="text-left p-2.5 text-text-muted font-bold uppercase tracking-wider text-[10px]">Title</th>
                  <th className="text-left p-2.5 text-text-muted font-bold uppercase tracking-wider text-[10px]">Processed At</th>
                  <th className="text-left p-2.5 text-text-muted font-bold uppercase tracking-wider text-[10px]">Memory Link</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event: any) => (
                  <tr key={event.id} className="border-b border-border/50 hover:bg-surface2/40 transition-colors">
                    <td className="p-2.5">
                      <Badge variant="secondary" className="h-4 text-[9px] px-1.5 py-0">
                        {event.source === "github" ? "🐙" : "⚡"} {event.source}
                      </Badge>
                    </td>
                    <td className="p-2.5">
                      <span className="text-text font-medium">
                        {event.eventType === "pr.merged" ? "PR Merged" : "Ticket Done"}
                      </span>
                    </td>
                    <td className="p-2.5">
                      <span className="text-text-muted truncate max-w-xs block" title={event.rawTitle}>
                        {event.rawTitle || "—"}
                      </span>
                    </td>
                    <td className="p-2.5 text-text-muted">
                      {new Date(event.processedAt).toLocaleString()}
                    </td>
                    <td className="p-2.5">
                      {event.memoryId ? (
                        <a
                          href={`/memories?id=${event.memoryId}`}
                          className="text-accent hover:underline font-mono text-[9px]"
                          title={event.memoryId}
                        >
                          {event.memoryId.slice(0, 8)}…
                        </a>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── SecurityPanel ─────────────────────────────────────────────────────────────

function SecurityPanel({ org }: { org: any }) {
  return (
    <div className="flex flex-col gap-8">
      {/* ── BYOK ── */}
      <div className="bg-surface border border-border rounded-xl p-5 shadow-xs flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-bold text-text uppercase tracking-wider">
            End-to-End Encryption (BYOK)
          </h3>
          <p className="text-xs text-text-muted mt-1">
            Memories are encrypted in your browser before leaving your device.
            The Locker server only stores the ciphertext — it never sees
            plaintext content.
          </p>
        </div>
        <BYOKSetup
          orgId={org.id}
          onSaved={() => {}}
        />
      </div>

      {/* ── SSO ── */}
      <div className="bg-surface border border-border rounded-xl p-5 shadow-xs flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-bold text-text uppercase tracking-wider">
            Single Sign-On (SSO)
          </h3>
          <p className="text-xs text-text-muted mt-1">
            Configure SAML 2.0 (Okta, Entra ID, PingFederate) or OIDC for
            your organization. Contact{" "}
            <a
              href="mailto:support@locker.app"
              className="text-accent hover:underline"
            >
              support@locker.app
            </a>{" "}
            to provision your IdP metadata and ACS URL, then your IdP
            credentials will appear here for activation.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface2 p-4 text-xs text-text-muted space-y-2">
          <p className="font-semibold text-text">Supported providers</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li>Okta (SAML 2.0)</li>
            <li>Microsoft Entra ID / Azure AD (SAML 2.0)</li>
            <li>Google Workspace (OIDC)</li>
            <li>PingFederate / PingOne (SAML 2.0)</li>
            <li>Any OIDC-compliant IdP</li>
          </ul>
          <p className="pt-2">
            Your Service Provider (SP) entity ID and ACS URL will be
            provisioned when SSO is enabled. IdP certificate and client
            secrets are encrypted at rest with your org vault key.
          </p>
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute("/organization")({
  component: OrganizationPage,
});

