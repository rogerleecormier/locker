import { createFileRoute } from "@tanstack/react-router";
import { AdminGuard } from "./admin-page";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { sql, eq, and, or, like } from "drizzle-orm";
import { memories, organizations, orgQuotas, organizationMembers, users, accounts, userPlans, planEvents } from "~/db/schema";
import { requireAdmin } from "~/server/session";
import { updateSubscriptionSeats } from "~/server/billing";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

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
  .inputValidator((data: unknown): { orgId: string; monthlyMemories: number; monthlyRecalls: number; monthlyCommits: number } => {
    const d = data as { orgId: string; monthlyMemories: number; monthlyRecalls: number; monthlyCommits: number };
    return {
      orgId: d.orgId,
      monthlyMemories: Number(d.monthlyMemories),
      monthlyRecalls: Number(d.monthlyRecalls),
      monthlyCommits: Number(d.monthlyCommits),
    };
  })
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
  .inputValidator((data: unknown): { id: string } => {
    const d = data as { id: string };
    return { id: d.id };
  })
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
  .inputValidator((data: unknown): { name: string; email: string; password?: string; plan?: string } => {
    const d = data as { name: string; email: string; password?: string; plan?: string };
    if (!d.name || typeof d.name !== "string") throw new Error("Name is required");
    if (!d.email || typeof d.email !== "string") throw new Error("Email is required");
    return {
      name: d.name.trim(),
      email: d.email.trim().toLowerCase(),
      password: d.password ? d.password : undefined,
      plan: d.plan ? d.plan.trim() : "free",
    };
  })
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
      plan: data.plan || "free",
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

    return { success: true, userId };
  });

export const updateUserAdmin = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { userId: string; name: string; email: string; emailVerified: boolean } => {
    const d = data as { userId: string; name: string; email: string; emailVerified: boolean };
    return {
      userId: d.userId,
      name: d.name.trim(),
      email: d.email.trim().toLowerCase(),
      emailVerified: !!d.emailVerified,
    };
  })
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
  .inputValidator((data: unknown): { userId: string } => {
    const d = data as { userId: string };
    return { userId: d.userId };
  })
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
  .inputValidator((data: unknown): { userId: string; plan: string } => {
    const d = data as { userId: string; plan: string };
    return { userId: d.userId, plan: d.plan.trim() };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = drizzle(env.DB, { schema: { userPlans, planEvents } });

    // Check if userPlan exists
    const existing = await db.select().from(userPlans).where(eq(userPlans.userId, data.userId)).all();
    const oldPlan = existing[0]?.plan || "free";

    if (existing.length > 0) {
      await db
        .update(userPlans)
        .set({
          plan: data.plan,
          billingSubscriptionId: null, // Clear Stripe subscription ref on manual override
          updatedAt: new Date(),
        })
        .where(eq(userPlans.userId, data.userId));
    } else {
      await db.insert(userPlans).values({
        userId: data.userId,
        plan: data.plan,
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
  .inputValidator((data: unknown): { userId: string; password: string } => {
    const d = data as { userId: string; password: string };
    if (!d.password || d.password.length < 8) throw new Error("Password must be at least 8 characters long.");
    return { userId: d.userId, password: d.password };
  })
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
  .inputValidator((data: unknown): { userId: string } => {
    const d = data as { userId: string };
    return { userId: d.userId };
  })
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
  .inputValidator((data: unknown): { userId: string; orgId: string; role: "owner" | "admin" | "member" } => {
    const d = data as { userId: string; orgId: string; role: "owner" | "admin" | "member" };
    return { userId: d.userId, orgId: d.orgId, role: d.role };
  })
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
  .inputValidator((data: unknown): { userId: string; orgId: string } => {
    const d = data as { userId: string; orgId: string };
    return { userId: d.userId, orgId: d.orgId };
  })
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

export const Route = createFileRoute("/admin")({
  component: AdminGuard,
});
