import { createFileRoute } from "@tanstack/react-router";
import { AdminGuard } from "./-admin-page";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { sql, eq, and, or, like, desc } from "drizzle-orm";
import { z } from "zod";
import { memories, organizations, orgQuotas, organizationMembers, users, accounts, userPlans, planEvents, systemSettings, auditLogs, apiTokens, memoryVersions, tokenUsages, webhookEvents, featureOverrides } from "~/db/schema";
import { requireAdmin } from "~/server/session";
import { updateSubscriptionSeats } from "~/server/billing";
import { seedNewUserMemory } from "~/server/auth";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

// ── Shared admin Zod validators ────────────────────────────────────────────────
const zAdminUserId = z.string().uuid("userId must be a valid UUID");
const zAdminOrgId  = z.string().uuid("orgId must be a valid UUID");

const UpdateOrgQuotaSchema = z.object({
  orgId:            zAdminOrgId,
  monthlyMemories:  z.number().int().min(0).max(10_000_000),
  monthlyRecalls:   z.number().int().min(0).max(10_000_000),
  monthlyCommits:   z.number().int().min(0).max(10_000_000),
}).strict();

const DeleteOrgSchema = z.object({
  id: zAdminOrgId,
}).strict();

const CreateUserAdminSchema = z.object({
  name:     z.string().min(1).max(256).transform((s) => s.trim()),
  email:    z.string().email().max(320).transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8).max(1024).optional(),
  plan:     z.enum(["free", "business", "business_comp", "enterprise"]).default("free"),
}).strict();

const UpdateUserAdminSchema = z.object({
  userId:        zAdminUserId,
  name:          z.string().min(1).max(256).transform((s) => s.trim()),
  email:         z.string().email().max(320).transform((s) => s.trim().toLowerCase()),
  emailVerified: z.boolean(),
}).strict();

const UserIdSchema = z.object({
  userId: zAdminUserId,
}).strict();

const UpdateUserPlanAdminSchema = z.object({
  userId: zAdminUserId,
  plan:   z.enum(["free", "business", "business_comp", "enterprise"]),
}).strict();

const SetUserPasswordAdminSchema = z.object({
  userId:   zAdminUserId,
  password: z.string().min(8).max(1024),
}).strict();

const AssignUserToOrgAdminSchema = z.object({
  userId: zAdminUserId,
  orgId:  zAdminOrgId,
  role:   z.enum(["owner", "admin", "member"]),
}).strict();

const RemoveUserFromOrgAdminSchema = z.object({
  userId: zAdminUserId,
  orgId:  zAdminOrgId,
}).strict();

const UpdateSystemSettingSchema = z.object({
  key:   z.enum(["enable_signups", "enable_business_plans", "enable_enterprise_plans"]),
  value: z.enum(["true", "false"]),
}).strict();

// Server functions for admin operations
export const getDbStats = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ memoryCount: number; vectorCount: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { memories } });

    const rows = await db.select().from(memories).all();
    // Vectorize has no count API; use D1 row count as the authoritative number
    return { memoryCount: rows.length, vectorCount: rows.length };
  }
);

import { requireSession } from "~/server/session";

export const getAdminStatus = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ isAdmin: boolean; userId: string | null; configuredAdminId: string | null }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    try {
      const user = await requireSession(env);
      return {
        isAdmin: user.id === env.ADMIN_USER_ID,
        userId: user.id,
        configuredAdminId: env.ADMIN_USER_ID || null,
      };
    } catch {
      return {
        isAdmin: false,
        userId: null,
        configuredAdminId: env.ADMIN_USER_ID || null,
      };
    }
  }
);

export const clearVectorizeIndex = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ cleared: boolean; deletedCount: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { memories } });

    const rows = await db.select({ id: memories.id }).from(memories).all();
    const ids = rows.map((r) => r.id);

    if (ids.length === 0) return { cleared: true, deletedCount: 0 };

    const VECTOR_CHUNK = 100;
    for (let i = 0; i < ids.length; i += VECTOR_CHUNK) {
      const chunk = ids.slice(i, i + VECTOR_CHUNK);
      await env.VECTOR_INDEX.deleteByIds(chunk);
    }

    console.log(`[clearVectorizeIndex] deleted ${ids.length} vectors`);
    return { cleared: true, deletedCount: ids.length };
  }
);

export const clearDatabase = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ cleared: boolean; deletedCount: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { memories } });

    // Delete from D1
    const rows = await db.select({ id: memories.id }).from(memories).all();
    const dbIds = rows.map((r) => r.id);

    if (dbIds.length > 0) {
      const CHUNK = 10;
      for (let i = 0; i < dbIds.length; i += CHUNK) {
        const chunk = dbIds.slice(i, i + CHUNK);
        await db.delete(memories).where(
          sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`
        );
      }
      console.log(`[clearDatabase] deleted ${dbIds.length} memories from D1`);
    }

    // Delete vectors using the same IDs we already fetched from D1
    if (dbIds.length > 0) {
      const VECTOR_CHUNK = 100;
      for (let i = 0; i < dbIds.length; i += VECTOR_CHUNK) {
        const chunk = dbIds.slice(i, i + VECTOR_CHUNK);
        console.log(`[clearDatabase] deleting ${chunk.length} vectors: ${chunk.slice(0, 3).join(",")}`);
        await env.VECTOR_INDEX.deleteByIds(chunk);
      }
      console.log(`[clearDatabase] deleted ${dbIds.length} vectors from Vectorize`);
    }

    return { cleared: true, deletedCount: dbIds.length };
  }
);

export const getVectorizeDebug = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ vectors: Array<{ id: string }> }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { memories } });

    // Get all IDs from D1
    const rows = await db.select({ id: memories.id }).from(memories).all();
    const dbIds = rows.map((r) => r.id);

    // Check each D1 vector exists in Vectorize by querying getByIds (if available)
    // Vectorize has no enumerate API, so we can only flag IDs in D1 with no vector counterpart
    // by attempting a getByIds call — fall back to reporting 0 orphans if unsupported
    try {
      const existing = await env.VECTOR_INDEX.getByIds(dbIds.slice(0, 100));
      const existingIds = new Set((existing ?? []).map((v: { id: string }) => v.id));
      const missing = dbIds.filter((id) => !existingIds.has(id)).slice(0, 20);
      return { vectors: missing.map((id) => ({ id })) };
    } catch {
      return { vectors: [] };
    }
  }
);

export type OrgWithQuota = {
  id: string;
  name: string;
  plan: string;
  createdAt: number;
  memberCount: number;
  monthlyMemories: number;
  monthlyRecalls: number;
  monthlyCommits: number;
};

export const listAllOrgsAndQuotas = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<OrgWithQuota[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { memories, organizations, orgQuotas, organizationMembers } });

    const orgRows = await db.select().from(organizations).all();
    const result: OrgWithQuota[] = [];

    for (const org of orgRows) {
      // Get member count
      const memberCountResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(organizationMembers)
        .where(eq(organizationMembers.orgId, org.id))
        .all();
      const memberCount = memberCountResult[0]?.count ?? 0;

      // Get quota details
      const quotaRows = await db
        .select()
        .from(orgQuotas)
        .where(eq(orgQuotas.orgId, org.id))
        .all();
      const quota = quotaRows[0];

      result.push({
        id: org.id,
        name: org.name,
        plan: org.plan,
        createdAt: org.createdAt,
        memberCount,
        monthlyMemories: quota?.monthlyMemories ?? 100,
        monthlyRecalls: quota?.monthlyRecalls ?? 1000,
        monthlyCommits: quota?.monthlyCommits ?? 500,
      });
    }

    return result;
  }
);



export const updateOrgQuota = createServerFn({ method: "POST" })
  .inputValidator((data) => UpdateOrgQuotaSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { orgQuotas, organizations } });

    await db
      .update(orgQuotas)
      .set({
        monthlyMemories: data.monthlyMemories,
        monthlyRecalls: data.monthlyRecalls,
        monthlyCommits: data.monthlyCommits,
      })
      .where(eq(orgQuotas.orgId, data.orgId));

    // Clear Stripe subscription ref on manual quota override
    await db
      .update(organizations)
      .set({
        billingSubscriptionId: null,
      })
      .where(eq(organizations.id, data.orgId));

    return { success: true };
  });

export const deleteOrganization = createServerFn({ method: "POST" })
  .inputValidator((data) => DeleteOrgSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { organizations } });

    await db.delete(organizations).where(eq(organizations.id, data.id));
    return { success: true };
  });

export type UserOrgDetails = {
  id: string;
  name: string;
  role: string;
};

export type UserDetails = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: number;
  plan: string;
  organizations: UserOrgDetails[];
  memoryCount: number;
};

export const listAllUsersAndDetails = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<UserDetails[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { users, userPlans, organizationMembers, organizations, memories } });

    const allUsers = await db.select().from(users).all();
    const allPlans = await db.select().from(userPlans).all();
    const allOrgMemberships = await db
      .select({
        userId: organizationMembers.userId,
        orgId: organizationMembers.orgId,
        orgName: organizations.name,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
      .all();

    const allMemoryCounts = await db
      .select({
        userId: memories.userId,
        count: sql<number>`count(*)`,
      })
      .from(memories)
      .groupBy(memories.userId)
      .all();

    const planMap = new Map(allPlans.map((p) => [p.userId, p.plan]));
    const memCountMap = new Map(allMemoryCounts.map((m) => [m.userId, m.count]));
    const orgsMap = new Map<string, UserOrgDetails[]>();

    for (const m of allOrgMemberships) {
      const list = orgsMap.get(m.userId) || [];
      list.push({ id: m.orgId, name: m.orgName, role: m.role });
      orgsMap.set(m.userId, list);
    }

    return allUsers.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      createdAt: u.createdAt instanceof Date ? u.createdAt.getTime() : Number(u.createdAt),
      plan: planMap.get(u.id) || "free",
      organizations: orgsMap.get(u.id) || [],
      memoryCount: memCountMap.get(u.id) || 0,
    }));
  }
);

export const createUserAdmin = createServerFn({ method: "POST" })
  .inputValidator((data) => CreateUserAdminSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean; userId: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { users, accounts, userPlans } });

    // Check if email already exists
    const existing = await db.select().from(users).where(eq(users.email, data.email)).all();
    if (existing.length > 0) {
      throw new Error("A user with this email address already exists.");
    }

    const userId = crypto.randomUUID().replace(/-/g, "");

    // Insert user
    await db.insert(users).values({
      id: userId,
      name: data.name,
      email: data.email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Insert plan
    await db.insert(userPlans).values({
      userId,
      plan: (data.plan || "free") as "free" | "business" | "business_comp" | "enterprise",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // If password is provided, hash it and insert into accounts
    if (data.password) {
      const { hashPassword } = await import("better-auth/crypto");
      const hashedPassword = await hashPassword(data.password);
      await db.insert(accounts).values({
        id: crypto.randomUUID().replace(/-/g, ""),
        accountId: data.email,
        providerId: "credential",
        userId,
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    seedNewUserMemory(userId, env).catch(() => {});

    return { success: true, userId };
  });

export const updateUserAdmin = createServerFn({ method: "POST" })
  .inputValidator((data) => UpdateUserAdminSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { users, accounts } });

    // Check if email belongs to someone else
    const existing = await db.select().from(users).where(eq(users.email, data.email)).all();
    const otherUser = existing.find((u) => u.id !== data.userId);
    if (otherUser) {
      throw new Error("This email is already in use by another user.");
    }

    // Update user
    await db
      .update(users)
      .set({
        name: data.name,
        email: data.email,
        emailVerified: data.emailVerified,
        updatedAt: new Date(),
      })
      .where(eq(users.id, data.userId));

    // Update credential account ID if email changed
    await db
      .update(accounts)
      .set({
        accountId: data.email,
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.userId, data.userId), eq(accounts.providerId, "credential")));

    return { success: true };
  });

export const deleteUserAdmin = createServerFn({ method: "POST" })
  .inputValidator((data) => UserIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    
    // Check we aren't deleting the configured admin using this panel
    if (data.userId === env.ADMIN_USER_ID) {
      throw new Error("Cannot delete the active site administrator.");
    }

    const db = drizzle(env.DB, { schema: { users, memories } });

    // Fetch memory IDs first so we can remove them from Vectorize
    const userMemories = await db
      .select({ id: memories.id })
      .from(memories)
      .where(eq(memories.userId, data.userId))
      .all();
    
    const memIds = userMemories.map((m) => m.id);

    // Delete user from D1 (cascade deletes will clean up D1 sessions, accounts, plans, memories, etc.)
    await db.delete(users).where(eq(users.id, data.userId));

    // Delete from Vectorize
    if (memIds.length > 0) {
      const VECTOR_CHUNK = 100;
      for (let i = 0; i < memIds.length; i += VECTOR_CHUNK) {
        await env.VECTOR_INDEX.deleteByIds(memIds.slice(i, i + VECTOR_CHUNK));
      }
    }

    return { success: true };
  });

export const updateUserPlanAdmin = createServerFn({ method: "POST" })
  .inputValidator((data) => UpdateUserPlanAdminSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { userPlans, planEvents } });

    // Check if userPlan exists
    const existing = await db.select().from(userPlans).where(eq(userPlans.userId, data.userId)).all();
    const oldPlan = existing[0]?.plan || "free";

    const planValue = data.plan as "free" | "business" | "business_comp" | "enterprise";
    if (existing.length > 0) {
      await db
        .update(userPlans)
        .set({
          plan: planValue,
          billingSubscriptionId: null,
          updatedAt: new Date(),
        })
        .where(eq(userPlans.userId, data.userId));
    } else {
      await db.insert(userPlans).values({
        userId: data.userId,
        plan: planValue,
        billingSubscriptionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Log event
    await db.insert(planEvents).values({
      id: crypto.randomUUID().replace(/-/g, ""),
      userId: data.userId,
      fromPlan: oldPlan,
      toPlan: data.plan,
      reason: "Admin manual assignment",
      timestamp: Date.now(),
    });

    return { success: true };
  });

export const setUserPasswordAdmin = createServerFn({ method: "POST" })
  .inputValidator((data) => SetUserPasswordAdminSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { users, accounts } });

    // Fetch user email to use as accountId
    const userRows = await db.select({ email: users.email }).from(users).where(eq(users.id, data.userId)).all();
    if (userRows.length === 0) {
      throw new Error("User not found.");
    }
    const userEmail = userRows[0].email;

    const { hashPassword } = await import("better-auth/crypto");
    const hashedPassword = await hashPassword(data.password);

    const credentialAccounts = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, data.userId), eq(accounts.providerId, "credential")))
      .all();

    if (credentialAccounts.length > 0) {
      await db
        .update(accounts)
        .set({
          password: hashedPassword,
          accountId: userEmail,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, credentialAccounts[0].id));
    } else {
      await db.insert(accounts).values({
        id: crypto.randomUUID().replace(/-/g, ""),
        accountId: userEmail,
        providerId: "credential",
        userId: data.userId,
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return { success: true };
  });

export const resetUserPasswordAdmin = createServerFn({ method: "POST" })
  .inputValidator((data) => UserIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean; password?: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { users, accounts } });

    // Fetch user email
    const userRows = await db.select({ email: users.email }).from(users).where(eq(users.id, data.userId)).all();
    if (userRows.length === 0) {
      throw new Error("User not found.");
    }
    const userEmail = userRows[0].email;

    // Generate random 12-char password
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let tempPassword = "";
    const randomValues = new Uint8Array(12);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 12; i++) {
      tempPassword += chars[randomValues[i] % chars.length];
    }

    const { hashPassword } = await import("better-auth/crypto");
    const hashedPassword = await hashPassword(tempPassword);

    const credentialAccounts = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, data.userId), eq(accounts.providerId, "credential")))
      .all();

    if (credentialAccounts.length > 0) {
      await db
        .update(accounts)
        .set({
          password: hashedPassword,
          accountId: userEmail,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, credentialAccounts[0].id));
    } else {
      await db.insert(accounts).values({
        id: crypto.randomUUID().replace(/-/g, ""),
        accountId: userEmail,
        providerId: "credential",
        userId: data.userId,
        password: hashedPassword,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    return { success: true, password: tempPassword };
  });

export const assignUserToOrgAdmin = createServerFn({ method: "POST" })
  .inputValidator((data) => AssignUserToOrgAdminSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { organizationMembers } });

    // Check if membership exists
    const existing = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)))
      .all();

    if (existing.length > 0) {
      await db
        .update(organizationMembers)
        .set({
          role: data.role,
        })
        .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)));
    } else {
      await db.insert(organizationMembers).values({
        orgId: data.orgId,
        userId: data.userId,
        role: data.role,
        joinedAt: Date.now(),
      });

      // Sync seats to Stripe
      await updateSubscriptionSeats(db, env, data.orgId);
    }

    return { success: true };
  });

export const removeUserFromOrgAdmin = createServerFn({ method: "POST" })
  .inputValidator((data) => RemoveUserFromOrgAdminSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { organizationMembers } });

    const targetMember = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)))
      .all();

    if (targetMember.length > 0 && targetMember[0].role === "owner") {
      const otherOwners = await db
        .select()
        .from(organizationMembers)
        .where(and(
          eq(organizationMembers.orgId, data.orgId),
          eq(organizationMembers.role, "owner"),
          sql`${organizationMembers.userId} != ${data.userId}`
        ))
        .all();
      if (otherOwners.length === 0) {
        throw new Error("Cannot remove member: This user is the sole owner of the organization. Promote another owner first.");
      }
    }

    await db
      .delete(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, data.userId)));

    // Sync seats to Stripe
    await updateSubscriptionSeats(db, env, data.orgId);

    return { success: true };
  });

export const promoteToSiteAdminAdmin = createServerFn({ method: "POST" })
  .inputValidator((data) => UserIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean; message: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);

    // Note: In production, you'd want to update ADMIN_USER_ID via environment config or a database table.
    // For now, this function grants business_comp plan and documents the promotion.
    // The actual site admin designation depends on your deployment setup.

    const db = drizzle(env.DB, { schema: { userPlans, featureOverrides, users } });

    // Verify user exists
    const userRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, data.userId))
      .all();

    if (userRows.length === 0) {
      throw new Error("User not found.");
    }

    const userEmail = userRows[0].email;

    // Grant business_comp plan (admin tier)
    const existing = await db
      .select()
      .from(userPlans)
      .where(eq(userPlans.userId, data.userId))
      .all();

    const now = Date.now();
    if (existing.length > 0) {
      await db
        .update(userPlans)
        .set({
          plan: "business_comp",
          planActivatedAt: now,
          updatedAt: new Date(),
        })
        .where(eq(userPlans.userId, data.userId));
    } else {
      await db
        .insert(userPlans)
        .values({
          userId: data.userId,
          plan: "business_comp",
          planActivatedAt: now,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
    }

    // Revoke any conflicting feature overrides
    await db
      .delete(featureOverrides)
      .where(eq(featureOverrides.userId, data.userId));

    console.log(`[admin] Promoted user ${userEmail} (${data.userId}) to site admin tier`);

    return {
      success: true,
      message: `Promoted ${userEmail} to Site Admin. Update your ADMIN_USER_ID environment variable to ${data.userId} to grant full admin access.`,
    };
  });

export const removeAdminStatusAdmin = createServerFn({ method: "POST" })
  .inputValidator((data) => UserIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean; message: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireAdmin(env);

    // Prevent self-removal of admin status
    if (data.userId === user.id) {
      throw new Error("Cannot remove admin status from yourself. Ask another admin to do it.");
    }

    const db = drizzle(env.DB, { schema: { userPlans, users } });

    // Verify user exists
    const userRows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.id, data.userId))
      .all();

    if (userRows.length === 0) {
      throw new Error("User not found.");
    }

    const userEmail = userRows[0].email;

    // Downgrade from business_comp to free
    const existing = await db
      .select()
      .from(userPlans)
      .where(eq(userPlans.userId, data.userId))
      .all();

    if (existing.length > 0 && existing[0].plan === "business_comp") {
      await db
        .update(userPlans)
        .set({
          plan: "free",
          updatedAt: new Date(),
        })
        .where(eq(userPlans.userId, data.userId));
    }

    console.log(`[admin] Removed admin status from user ${userEmail} (${data.userId})`);

    return {
      success: true,
      message: `Removed admin status from ${userEmail}. Their plan is now Free.`,
    };
  });

export type SystemSettingsData = {
  enableSignups: boolean;
  enableBusinessPlans: boolean;
  enableEnterprisePlans: boolean;
};

export const getSystemSettings = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<SystemSettingsData> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = drizzle(env.DB, { schema: { systemSettings } });

    const rows = await db.select().from(systemSettings).all();
    const map = new Map(rows.map((r) => [r.key, r.value]));

    return {
      enableSignups: map.get("enable_signups") === "true",
      enableBusinessPlans: map.get("enable_business_plans") !== "false",
      enableEnterprisePlans: map.get("enable_enterprise_plans") !== "false",
    };
  }
);

export const updateSystemSetting = createServerFn({ method: "POST" })
  .inputValidator((data) => UpdateSystemSettingSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { systemSettings } });

    await db
      .insert(systemSettings)
      .values({ key: data.key, value: data.value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: data.value, updatedAt: new Date() },
      })
      .run();

    return { success: true };
  });

// ── System Metrics ─────────────────────────────────────────────────────────────
export type PlanDistribution = { plan: string; count: number };
export type DailyActivity = { date: string; recalls: number; commits: number };
export type CategoryBreakdown = { category: string; count: number };

export type SystemMetrics = {
  users: {
    total: number;
    newLast7d: number;
    newLast30d: number;
    byPlan: PlanDistribution[];
    recentSignups: Array<{ id: string; name: string; email: string; plan: string; createdAt: number }>;
  };
  memories: {
    total: number;
    byCategory: CategoryBreakdown[];
    addedLast7d: number;
    addedLast30d: number;
  };
  activity: {
    totalRecalls: number;
    totalCommits: number;
    last7dActivity: DailyActivity[];
    topActions: Array<{ action: string; count: number }>;
  };
  orgs: {
    total: number;
    byPlan: PlanDistribution[];
    totalMembers: number;
  };
  webhooks: {
    total: number;
    last7d: number;
    byStatus: Array<{ status: string; count: number }>;
  };
  planEvents: {
    last30d: Array<{ fromPlan: string; toPlan: string; count: number }>;
  };
};

export const getSystemMetrics = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<SystemMetrics> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, {
      schema: { users, memories, userPlans, organizations, organizationMembers, auditLogs, tokenUsages, webhookEvents, planEvents },
    });

    const now = Date.now();
    const ms7d = 7 * 24 * 60 * 60 * 1000;
    const ms30d = 30 * 24 * 60 * 60 * 1000;

    // ── Users ────────────────────────────────────────────────────────────────
    const allUsers = await db.select({ id: users.id, name: users.name, email: users.email, createdAt: users.createdAt }).from(users).all();
    const allPlans = await db.select({ userId: userPlans.userId, plan: userPlans.plan }).from(userPlans).all();
    const planMap = new Map(allPlans.map((p) => [p.userId, p.plan]));

    const newLast7d = allUsers.filter((u) => {
      const ts = u.createdAt instanceof Date ? u.createdAt.getTime() : Number(u.createdAt);
      return now - ts < ms7d;
    }).length;
    const newLast30d = allUsers.filter((u) => {
      const ts = u.createdAt instanceof Date ? u.createdAt.getTime() : Number(u.createdAt);
      return now - ts < ms30d;
    }).length;

    const planCounts = new Map<string, number>();
    for (const u of allUsers) {
      const p = planMap.get(u.id) || "free";
      planCounts.set(p, (planCounts.get(p) || 0) + 1);
    }
    const byPlan: PlanDistribution[] = Array.from(planCounts.entries()).map(([plan, count]) => ({ plan, count }));

    const recentSignups = allUsers
      .sort((a, b) => {
        const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : Number(a.createdAt);
        const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : Number(b.createdAt);
        return tb - ta;
      })
      .slice(0, 10)
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        plan: planMap.get(u.id) || "free",
        createdAt: u.createdAt instanceof Date ? u.createdAt.getTime() : Number(u.createdAt),
      }));

    // ── Memories ─────────────────────────────────────────────────────────────
    const allMemories = await db.select({ id: memories.id, category: memories.category, timestamp: memories.timestamp }).from(memories).all();

    const catCounts = new Map<string, number>();
    for (const m of allMemories) {
      catCounts.set(m.category, (catCounts.get(m.category) || 0) + 1);
    }
    const byCategory: CategoryBreakdown[] = Array.from(catCounts.entries()).map(([category, count]) => ({ category, count }));

    const memAdded7d = allMemories.filter((m) => {
      return now - Number(m.timestamp) < ms7d;
    }).length;
    const memAdded30d = allMemories.filter((m) => {
      return now - Number(m.timestamp) < ms30d;
    }).length;

    // ── Activity (audit_logs) ─────────────────────────────────────────────────
    const recentLogs = await db
      .select({ action: auditLogs.action, timestamp: auditLogs.timestamp })
      .from(auditLogs)
      .where(sql`${auditLogs.timestamp} > ${now - ms30d}`)
      .all()
      .catch(() => [] as Array<{ action: string; timestamp: number }>);

    let totalRecalls = 0;
    let totalCommits = 0;
    const actionCounts = new Map<string, number>();
    const dailyMap = new Map<string, { recalls: number; commits: number }>();

    for (const log of recentLogs) {
      actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1);
      if (log.action === "recall_context" || log.action === "search_memories") totalRecalls++;
      if (log.action === "commit_memory") totalCommits++;

      const dateStr = new Date(log.timestamp).toISOString().slice(0, 10);
      const day = dailyMap.get(dateStr) || { recalls: 0, commits: 0 };
      if (log.action === "recall_context" || log.action === "search_memories") day.recalls++;
      if (log.action === "commit_memory") day.commits++;
      dailyMap.set(dateStr, day);
    }

    // Build last 7 days array (most recent last)
    const last7dActivity: DailyActivity[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const day = dailyMap.get(d) || { recalls: 0, commits: 0 };
      last7dActivity.push({ date: d, ...day });
    }

    const topActions = Array.from(actionCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([action, count]) => ({ action, count }));

    // ── Orgs ─────────────────────────────────────────────────────────────────
    const allOrgs = await db.select({ id: organizations.id, plan: organizations.plan }).from(organizations).all().catch(() => [] as Array<{ id: string; plan: string }>);
    const totalMembers = await db.select({ count: sql<number>`count(*)` }).from(organizationMembers).all().then((r) => r[0]?.count ?? 0).catch(() => 0);
    const orgPlanCounts = new Map<string, number>();
    for (const o of allOrgs) {
      orgPlanCounts.set(o.plan, (orgPlanCounts.get(o.plan) || 0) + 1);
    }

    // ── Webhooks ─────────────────────────────────────────────────────────────
    const allWebhooks = await db.select({ source: webhookEvents.source, processedAt: webhookEvents.processedAt }).from(webhookEvents).all().catch(() => [] as Array<{ source: string; processedAt: number }>);
    const webhooksLast7d = allWebhooks.filter((w) => {
      return now - Number(w.processedAt) < ms7d;
    }).length;
    const webhookStatusCounts = new Map<string, number>();
    for (const w of allWebhooks) {
      const s = w.source || "unknown";
      webhookStatusCounts.set(s, (webhookStatusCounts.get(s) || 0) + 1);
    }

    // ── Plan Events ────────────────────────────────────────────────────────────
    const recentPlanEvents = await db
      .select({ fromPlan: planEvents.fromPlan, toPlan: planEvents.toPlan })
      .from(planEvents)
      .where(sql`${planEvents.timestamp} > ${now - ms30d}`)
      .all()
      .catch(() => [] as Array<{ fromPlan: string; toPlan: string }>);
    const peKey = (e: { fromPlan: string; toPlan: string }) => `${e.fromPlan}→${e.toPlan}`;
    const peCounts = new Map<string, number>();
    for (const e of recentPlanEvents) {
      peCounts.set(peKey(e), (peCounts.get(peKey(e)) || 0) + 1);
    }
    const planEventsLast30d = Array.from(peCounts.entries()).map(([k, count]) => {
      const [fromPlan, toPlan] = k.split("→");
      return { fromPlan, toPlan, count };
    });

    return {
      users: { total: allUsers.length, newLast7d, newLast30d, byPlan, recentSignups },
      memories: { total: allMemories.length, byCategory, addedLast7d: memAdded7d, addedLast30d: memAdded30d },
      activity: { totalRecalls, totalCommits, last7dActivity, topActions },
      orgs: {
        total: allOrgs.length,
        byPlan: Array.from(orgPlanCounts.entries()).map(([plan, count]) => ({ plan, count })),
        totalMembers,
      },
      webhooks: {
        total: allWebhooks.length,
        last7d: webhooksLast7d,
        byStatus: Array.from(webhookStatusCounts.entries()).map(([status, count]) => ({ status, count })),
      },
      planEvents: { last30d: planEventsLast30d },
    };
  }
);

export type AuditLogEntry = {
  id: string;
  userId: string;
  userEmail: string | null;
  userName: string | null;
  tokenId: string | null;
  tokenName: string | null;
  action: string;
  memoryId: string | null;
  memorySnippet: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  toolName: string | null;
  timestamp: number;
  metadata: string | null;
  orgId: string | null;
  orgName: string | null;
};

const AdminAuditLogSchema = z.object({
  limit:     z.number().int().min(1).max(500).default(100),
  offset:    z.number().int().min(0).default(0),
  userId:    z.string().uuid().optional(),
  action:    z.string().max(64).regex(/^[a-z_]+$/, "action must be lowercase snake_case").optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD").optional(),
  endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "endDate must be YYYY-MM-DD").optional(),
}).strict();

export const getAdminAuditLogs = createServerFn({ method: "POST" })
  .inputValidator((data) => AdminAuditLogSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ logs: AuditLogEntry[]; total: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB);

    const limit = Math.min(data.limit ?? 100, 500);
    const offset = data.offset ?? 0;

    const conditions: any[] = [];
    if (data.action) conditions.push(eq(auditLogs.action, data.action));
    if (data.userId) conditions.push(eq(auditLogs.userId, data.userId));
    if (data.startDate) {
      const ts = new Date(data.startDate + "T00:00:00Z").getTime();
      conditions.push(sql`${auditLogs.timestamp} >= ${ts}`);
    }
    if (data.endDate) {
      const ts = new Date(data.endDate + "T23:59:59Z").getTime();
      conditions.push(sql`${auditLogs.timestamp} <= ${ts}`);
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rawLogs, countResult] = await Promise.all([
      db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.timestamp)).limit(limit).offset(offset).all(),
      db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(where).all(),
    ]);

    // Batch-fetch users, tokens, orgs, memory snippets
    const userIds = [...new Set(rawLogs.map((l) => l.userId).filter(Boolean))] as string[];
    const tokenIds = [...new Set(rawLogs.map((l) => l.tokenId).filter((t): t is string => !!t && t !== "session"))];
    const memoryIds = [...new Set(rawLogs.map((l) => l.memoryId).filter((m): m is string => !!m))];
    const orgIds = [...new Set(rawLogs.map((l) => l.orgId).filter((o): o is string => !!o))];

    const [userRows, tokenRows, versionRows, orgRows] = await Promise.all([
      userIds.length > 0
        ? db.select({ id: users.id, name: users.name, email: users.email }).from(users)
            .where(sql`${users.id} IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`)
            .all()
        : Promise.resolve([] as { id: string; name: string; email: string }[]),
      tokenIds.length > 0
        ? db.select({ id: apiTokens.id, name: apiTokens.name }).from(apiTokens)
            .where(sql`${apiTokens.id} IN (${sql.join(tokenIds.map((id) => sql`${id}`), sql`, `)})`)
            .all()
        : Promise.resolve([] as { id: string; name: string }[]),
      memoryIds.length > 0
        ? db.select({ memoryId: memoryVersions.memoryId, fact: memoryVersions.fact })
            .from(memoryVersions)
            .where(sql`${memoryVersions.memoryId} IN (${sql.join(memoryIds.map((id) => sql`${id}`), sql`, `)})`)
            .orderBy(desc(memoryVersions.timestamp))
            .all()
        : Promise.resolve([] as { memoryId: string; fact: string }[]),
      orgIds.length > 0
        ? db.select({ id: organizations.id, name: organizations.name }).from(organizations)
            .where(sql`${organizations.id} IN (${sql.join(orgIds.map((id) => sql`${id}`), sql`, `)})`)
            .all()
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    const userMap = new Map(userRows.map((u) => [u.id, u]));
    const tokenMap = new Map(tokenRows.map((t) => [t.id, t.name]));
    const orgNameMap = new Map(orgRows.map((o) => [o.id, o.name]));
    const snippetMap = new Map<string, string>();
    for (const v of versionRows) {
      if (!snippetMap.has(v.memoryId)) {
        snippetMap.set(v.memoryId, v.fact.slice(0, 120) + (v.fact.length > 120 ? "…" : ""));
      }
    }

    const logs: AuditLogEntry[] = rawLogs.map((log) => {
      const userInfo = userMap.get(log.userId);
      const tokenName = log.tokenId && log.tokenId !== "session"
        ? (tokenMap.get(log.tokenId) ?? log.tokenId.slice(0, 8) + "…")
        : (log.tokenId === "session" ? "Session" : null);
      const ua = log.userAgent ?? "";
      let toolName: string | null = null;
      if (ua) {
        const ual = ua.toLowerCase();
        if (ual.includes("cursor")) toolName = "Cursor";
        else if (ual.includes("claude-desktop") || ual.includes("claude desktop")) toolName = "Claude Desktop";
        else if (ual.includes("claude-code") || ual.includes("claude code")) toolName = "Claude Code";
        else if (ual.includes("windsurf")) toolName = "Windsurf";
        else if (ual.includes("cline")) toolName = "Cline";
        else if (ual.includes("copilot")) toolName = "GitHub Copilot";
        else if (ual.includes("continue")) toolName = "Continue";
        else if (ual.includes("zed")) toolName = "Zed";
        else toolName = ua.split("/")[0] || null;
      }
      return {
        id: log.id,
        userId: log.userId,
        userEmail: userInfo?.email ?? null,
        userName: userInfo?.name ?? null,
        tokenId: log.tokenId ?? null,
        tokenName,
        action: log.action,
        memoryId: log.memoryId ?? null,
        memorySnippet: log.memoryId ? (snippetMap.get(log.memoryId) ?? null) : null,
        ipAddress: log.ipAddress ?? null,
        userAgent: log.userAgent ?? null,
        toolName,
        timestamp: log.timestamp,
        metadata: log.metadata ?? null,
        orgId: log.orgId ?? null,
        orgName: log.orgId ? (orgNameMap.get(log.orgId) ?? null) : null,
      };
    });

    return { logs, total: countResult[0]?.count ?? 0 };
  });

export const Route = createFileRoute("/admin")({
  component: AdminGuard,
});
