import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { memories, organizations, orgQuotas, organizationMembers, users, accounts, userPlans, planEvents, type Memory } from "~/db/schema";
import { nukeEverything, scanDatabaseDuplicates, bulkDeleteMemories, encryptAllMemories, rebuildVectorizeIndex, type DuplicateGroup } from "~/server/memoryFunctions";
import { requireAdmin } from "~/server/session";
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
    const db = drizzle(env.DB, { schema: { orgQuotas } });

    await db
      .update(orgQuotas)
      .set({
        monthlyMemories: data.monthlyMemories,
        monthlyRecalls: data.monthlyRecalls,
        monthlyCommits: data.monthlyCommits,
      })
      .where(eq(orgQuotas.orgId, data.orgId));

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

    return { success: true };
  });

// Helper import for sql and eq in query filters
import { sql, eq, and, or, like } from "drizzle-orm";function AdminPage() {
  const [activeTab, setActiveTab] = useState<"system" | "orgs" | "users">("system");
  const [confirmClear, setConfirmClear] = useState(false);
  const [confirmClearVectorize, setConfirmClearVectorize] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [scanResults, setScanResults] = useState<DuplicateGroup[] | null>(null);
  const [retainSelections, setRetainSelections] = useState<Record<number, string>>({});
  const [encryptResult, setEncryptResult] = useState<{ encrypted: number; alreadyEncrypted: number; failed: number } | null>(null);
  const [rebuildResult, setRebuildResult] = useState<{ processed: number; failed: number } | null>(null);

  // Users management state variables
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [isOrgsModalOpen, setIsOrgsModalOpen] = useState(false);
  const [isResetSuccessModalOpen, setIsResetSuccessModalOpen] = useState(false);

  const [createName, setCreateName] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPlan, setCreatePlan] = useState("free");

  const [selectedUser, setSelectedUser] = useState<UserDetails | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editEmailVerified, setEditEmailVerified] = useState(false);

  const [selectedPlan, setSelectedPlan] = useState("free");
  const [passwordValue, setPasswordValue] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState("");

  const [assignOrgId, setAssignOrgId] = useState("");
  const [assignRole, setAssignRole] = useState<"owner" | "admin" | "member">("member");
  const [userSearch, setUserSearch] = useState("");

  const [editingOrgQuotaId, setEditingOrgQuotaId] = useState<string | null>(null);
  const [editMemories, setEditMemories] = useState(100);
  const [editRecalls, setEditRecalls] = useState(1000);
  const [editCommits, setEditCommits] = useState(500);

  const orgsQuery = useQuery({
    queryKey: ["admin-orgs"],
    queryFn: () => listAllOrgsAndQuotas(),
    enabled: activeTab === "orgs" || activeTab === "users",
  });

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listAllUsersAndDetails(),
    enabled: activeTab === "users",
  });

  const { data: adminStatus } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });

  const createUserMut = useMutation({
    mutationFn: (data: { name: string; email: string; password?: string; plan?: string }) => createUserAdmin({ data }),
    onSuccess: () => {
      usersQuery.refetch();
      setIsCreateModalOpen(false);
      setCreateName("");
      setCreateEmail("");
      setCreatePassword("");
      setCreatePlan("free");
    },
    onError: (err) => alert("Failed to create user: " + String(err)),
  });

  const updateUserMut = useMutation({
    mutationFn: (data: { userId: string; name: string; email: string; emailVerified: boolean }) => updateUserAdmin({ data }),
    onSuccess: () => {
      usersQuery.refetch();
      setIsEditModalOpen(false);
    },
    onError: (err) => alert("Failed to update user: " + String(err)),
  });

  const deleteUserMut = useMutation({
    mutationFn: (userId: string) => deleteUserAdmin({ data: { userId } }),
    onSuccess: () => usersQuery.refetch(),
    onError: (err) => alert("Failed to delete user: " + String(err)),
  });

  const updateUserPlanMut = useMutation({
    mutationFn: (data: { userId: string; plan: string }) => updateUserPlanAdmin({ data }),
    onSuccess: () => {
      usersQuery.refetch();
      setIsPlanModalOpen(false);
    },
    onError: (err) => alert("Failed to update user plan: " + String(err)),
  });

  const setUserPasswordMut = useMutation({
    mutationFn: (data: { userId: string; password: string }) => setUserPasswordAdmin({ data }),
    onSuccess: () => {
      setIsPasswordModalOpen(false);
      setPasswordValue("");
      alert("Password set successfully!");
    },
    onError: (err) => alert("Failed to set password: " + String(err)),
  });

  const resetUserPasswordMut = useMutation({
    mutationFn: (userId: string) => resetUserPasswordAdmin({ data: { userId } }),
    onSuccess: (res) => {
      setGeneratedPassword(res.password || "");
      setIsResetSuccessModalOpen(true);
    },
    onError: (err) => alert("Failed to reset password: " + String(err)),
  });

  const assignUserToOrgMut = useMutation({
    mutationFn: (data: { userId: string; orgId: string; role: "owner" | "admin" | "member" }) => assignUserToOrgAdmin({ data }),
    onSuccess: () => {
      usersQuery.refetch();
      orgsQuery.refetch();
    },
    onError: (err) => alert("Failed to assign user to organization: " + String(err)),
  });

  const removeUserFromOrgMut = useMutation({
    mutationFn: (data: { userId: string; orgId: string }) => removeUserFromOrgAdmin({ data }),
    onSuccess: () => {
      usersQuery.refetch();
      orgsQuery.refetch();
    },
    onError: (err) => alert("Failed to remove user from organization: " + String(err)),
  });

  const updateQuotaMut = useMutation({
    mutationFn: (data: { orgId: string; monthlyMemories: number; monthlyRecalls: number; monthlyCommits: number }) => updateOrgQuota({ data }),
    onSuccess: () => {
      setEditingOrgQuotaId(null);
      orgsQuery.refetch();
    },
    onError: (err) => alert("Failed to update quota: " + String(err)),
  });

  const deleteOrgMut = useMutation({
    mutationFn: (id: string) => deleteOrganization({ data: { id } }),
    onSuccess: () => orgsQuery.refetch(),
    onError: (err) => alert("Failed to delete org: " + String(err)),
  });

  const rebuildMutation = useMutation({
    mutationFn: () => rebuildVectorizeIndex({}),
    onSuccess: (data) => {
      setRebuildResult(data);
      statsQuery.refetch();
      debugQuery.refetch();
    },
  });

  const scanMutation = useMutation({
    mutationFn: scanDatabaseDuplicates,
    onSuccess: (data) => {
      setScanResults(data.groups);
      // Default to retaining the primary memory (the first item) in each group
      const defaults: Record<number, string> = {};
      data.groups.forEach((g, idx) => {
        defaults[idx] = g.primary.id;
      });
      setRetainSelections(defaults);
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      if (!scanResults) return;
      const idsToDelete: string[] = [];
      scanResults.forEach((group, idx) => {
        const retainedId = retainSelections[idx] || group.primary.id;
        const allItems = [group.primary, ...group.duplicates];
        allItems.forEach((item) => {
          if (item.id !== retainedId) {
            idsToDelete.push(item.id);
          }
        });
      });

      if (idsToDelete.length > 0) {
        await bulkDeleteMemories({ data: { ids: idsToDelete } });
      }
    },
    onSuccess: () => {
      setScanResults(null);
      setRetainSelections({});
      statsQuery.refetch();
      debugQuery.refetch();
      alert("Successfully resolved duplicates! Non-retained records were deleted.");
    },
  });

  function handleSelectRetain(groupIdx: number, id: string) {
    setRetainSelections((prev) => ({
      ...prev,
      [groupIdx]: id,
    }));
  }

  const encryptMutation = useMutation({
    mutationFn: () => encryptAllMemories({}),
    onSuccess: (data) => setEncryptResult(data),
  });

  const statsQuery = useQuery({
    queryKey: ["admin-stats"],
    queryFn: async () => getDbStats(),
    refetchInterval: 5000,
  });

  const debugQuery = useQuery({
    queryKey: ["admin-debug"],
    queryFn: async () => getVectorizeDebug(),
    refetchInterval: 10000,
  });

  console.log("[admin page] statsQuery:", {
    data: statsQuery.data,
    status: statsQuery.status,
    error: statsQuery.error,
  });
  console.log("[admin page] debugQuery:", {
    data: debugQuery.data,
    status: debugQuery.status,
    error: debugQuery.error,
  });

  const clearDbMutation = useMutation({
    mutationFn: clearDatabase,
    onSuccess: () => {
      setConfirmClear(false);
      statsQuery.refetch();
      debugQuery.refetch();
    },
  });

  const clearVectorizeMutation = useMutation({
    mutationFn: clearVectorizeIndex,
    onSuccess: () => {
      setConfirmClearVectorize(false);
      statsQuery.refetch();
      debugQuery.refetch();
    },
  });

  const clearAllMutation = useMutation({
    mutationFn: nukeEverything,
    onSuccess: () => {
      setConfirmClearAll(false);
      statsQuery.refetch();
      debugQuery.refetch();
    },
  });

  const filteredUsers = (usersQuery.data || []).filter(
    (u) =>
      u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase())
  );

  return (
    <div style={{ padding: "20px", maxWidth: "900px", margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>Site Admin Panel</h1>
        <Link to="/" style={{ color: "var(--accent)", fontSize: "14px", textDecoration: "none" }}>← Back to App</Link>
      </div>

      <div style={{ display: "flex", gap: "10px", marginTop: "24px", borderBottom: "1px solid var(--border)", paddingBottom: "12px", marginBottom: "20px" }}>
        <button
          onClick={() => setActiveTab("system")}
          style={{
            padding: "8px 20px",
            background: activeTab === "system" ? "var(--accent)" : "transparent",
            color: activeTab === "system" ? "white" : "var(--text-muted)",
            border: activeTab === "system" ? "none" : "1px solid var(--border)",
            borderRadius: "var(--radius)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "13px",
            transition: "all 0.2s ease",
          }}
        >
          System & DB Management
        </button>
        <button
          onClick={() => setActiveTab("orgs")}
          style={{
            padding: "8px 20px",
            background: activeTab === "orgs" ? "var(--accent)" : "transparent",
            color: activeTab === "orgs" ? "white" : "var(--text-muted)",
            border: activeTab === "orgs" ? "none" : "1px solid var(--border)",
            borderRadius: "var(--radius)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "13px",
            transition: "all 0.2s ease",
          }}
        >
          Global Organizations
        </button>
        <button
          onClick={() => setActiveTab("users")}
          style={{
            padding: "8px 20px",
            background: activeTab === "users" ? "var(--accent)" : "transparent",
            color: activeTab === "users" ? "white" : "var(--text-muted)",
            border: activeTab === "users" ? "none" : "1px solid var(--border)",
            borderRadius: "var(--radius)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: "13px",
            transition: "all 0.2s ease",
          }}
        >
          Users Management
        </button>
      </div>

      {activeTab === "system" && (
        <>
          <section style={{ marginTop: "20px" }}>
            <h2>Database Stats</h2>
            {statsQuery.isPending && <p>Loading...</p>}
            {statsQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load stats: {String(statsQuery.error)}</p>}
            {statsQuery.data && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginTop: "10px" }}>
                <div style={{ padding: "15px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "5px" }}>D1 Memories</div>
                  <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--accent)" }}>{statsQuery.data.memoryCount}</div>
                </div>
                <div style={{ padding: "15px", background: "var(--surface2)", borderRadius: "var(--radius)", border: "1px solid var(--border)" }}>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "5px" }}>Vectorize Vectors</div>
                  <div style={{ fontSize: "24px", fontWeight: "bold", color: "var(--accent)" }}>{statsQuery.data.vectorCount}</div>
                </div>
              </div>
            )}
          </section>

          <section style={{ marginTop: "30px" }}>
            <h2>Debug Info</h2>
            {debugQuery.data?.vectors?.length ? (
              <div style={{ marginTop: "10px" }}>
                <p style={{ color: "var(--error)", marginBottom: "10px" }}>
                  Found {debugQuery.data.vectors.length} D1 records with no matching vector (first 100 checked):
                </p>
                <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "10px", fontFamily: "monospace", fontSize: "11px", maxHeight: "200px", overflowY: "auto" }}>
                  {debugQuery.data.vectors.map((v) => (
                    <div key={v.id} style={{ color: "var(--text-muted)", padding: "3px 0" }}>
                      {v.id.slice(0, 8)}... (missing from Vectorize)
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ color: "var(--success)", marginTop: "10px" }}>No orphaned vectors detected</p>
            )}
          </section>

          <section style={{ marginTop: "30px" }}>
            <h2>Database Deduplication Scanner</h2>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "15px" }}>
              Scan all stored memories for semantic duplicates. Locker will identify identical facts with different phrasings and let you choose which to retain.
            </p>

            {!scanResults ? (
              <button
                onClick={() => scanMutation.mutate({})}
                disabled={scanMutation.isPending}
                style={{
                  padding: "10px 20px",
                  background: "var(--accent)",
                  color: "white",
                  border: "none",
                  borderRadius: "var(--radius)",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                {scanMutation.isPending ? "Scanning & Analyzing Database..." : "Scan for Duplicates"}
              </button>
            ) : (
              <div>
                <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                  <button
                    onClick={() => scanMutation.mutate({})}
                    disabled={scanMutation.isPending || resolveMutation.isPending}
                    style={{
                      padding: "8px 16px",
                      background: "var(--surface2)",
                      border: "1px solid var(--border)",
                      color: "var(--text)",
                      borderRadius: "var(--radius)",
                      fontSize: "13px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    {scanMutation.isPending ? "Scanning..." : "Rescan"}
                  </button>
                  <button
                    onClick={() => setScanResults(null)}
                    disabled={scanMutation.isPending || resolveMutation.isPending}
                    style={{
                      padding: "8px 16px",
                      background: "transparent",
                      border: "1px solid transparent",
                      color: "var(--text-muted)",
                      borderRadius: "var(--radius)",
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    Clear Results
                  </button>
                </div>

                {scanResults.length === 0 ? (
                  <div style={{ padding: "20px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: "var(--radius)", color: "var(--success)", fontSize: "14px" }}>
                    🎉 No duplicate memories found in your database!
                  </div>
                ) : (
                  <div>
                    <div style={{ marginBottom: "15px", fontSize: "13px", color: "var(--text-muted)" }}>
                      Found {scanResults.length} duplicate group{scanResults.length !== 1 ? "s" : ""}. Choose which memory in each group you want to **retain** (non-selected items will be deleted):
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                      {scanResults.map((group, groupIdx) => {
                        const allItemsInGroup = [group.primary, ...group.duplicates];
                        const selectedId = retainSelections[groupIdx] || group.primary.id;

                        return (
                          <div
                            key={groupIdx}
                            style={{
                              background: "var(--surface2)",
                              border: "1px solid var(--border)",
                              borderRadius: "var(--radius)",
                              padding: "15px",
                            }}
                          >
                            <div style={{ fontSize: "12px", fontWeight: "bold", color: "var(--accent)", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                              Group {groupIdx + 1}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                              {allItemsInGroup.map((item) => (
                                <label
                                  key={item.id}
                                  style={{
                                    display: "flex",
                                    alignItems: "start",
                                    gap: "10px",
                                    padding: "10px",
                                    background: selectedId === item.id ? "rgba(99,102,241,0.06)" : "var(--surface)",
                                    border: `1px solid ${selectedId === item.id ? "var(--accent)" : "var(--border)"}`,
                                    borderRadius: "var(--radius)",
                                    cursor: "pointer",
                                    transition: "all 0.15s ease",
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name={`group-${groupIdx}`}
                                    checked={selectedId === item.id}
                                    onChange={() => handleSelectRetain(groupIdx, item.id)}
                                    style={{ marginTop: "3px", accentColor: "var(--accent)" }}
                                  />
                                  <div style={{ flex: 1, fontSize: "13px", lineHeight: "1.5" }}>
                                    <p style={{ margin: 0, color: "var(--text)" }}>{item.fact}</p>
                                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "6px" }}>
                                      <span
                                        style={{
                                          fontSize: "10px",
                                          background: "var(--surface2)",
                                          color: "var(--text-muted)",
                                          padding: "2px 6px",
                                          borderRadius: "4px",
                                          textTransform: "uppercase",
                                        }}
                                      >
                                        {item.category}
                                      </span>
                                      <span style={{ fontSize: "10px", color: "var(--text-muted)" }}>
                                        Added {new Date(item.timestamp).toLocaleDateString()}
                                      </span>
                                    </div>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: "20px" }}>
                      <button
                        onClick={() => resolveMutation.mutate()}
                        disabled={resolveMutation.isPending}
                        style={{
                          padding: "10px 24px",
                          background: "var(--error)",
                          color: "white",
                          border: "none",
                          borderRadius: "var(--radius)",
                          fontWeight: "bold",
                          cursor: "pointer",
                          boxShadow: "0 4px 12px rgba(239, 68, 68, 0.2)",
                        }}
                      >
                        {resolveMutation.isPending ? "Resolving Duplicates..." : "Resolve & Delete Duplicates"}
                      </button>
                      {resolveMutation.isError && (
                        <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>
                          Failed to resolve duplicates. Please try again.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section style={{ marginTop: "30px" }}>
            <h2>Vector Index Management</h2>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "15px" }}>
              Rebuild the Vectorize index by generating embeddings for all database memories. Use this if the Vectorize index was migrated or is out of sync with D1.
            </p>
            {rebuildResult && (
              <div style={{ marginBottom: "14px", padding: "10px 14px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: "var(--radius)", fontSize: "13px", color: "var(--success)" }}>
                Done — processed {rebuildResult.processed} memories{rebuildResult.failed > 0 ? `, ${rebuildResult.failed} failed` : ""}.
              </div>
            )}
            <button
              onClick={() => { setRebuildResult(null); rebuildMutation.mutate(); }}
              disabled={rebuildMutation.isPending}
              style={{ padding: "9px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer" }}
            >
              {rebuildMutation.isPending ? "Rebuilding Index…" : "Rebuild Vector Index"}
            </button>
            {rebuildMutation.isError && (
              <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>Index rebuild failed. Check logs.</p>
            )}
          </section>

          <section style={{ marginTop: "30px" }}>
            <h2>Encryption</h2>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "15px" }}>
              Encrypt any plaintext memory facts that were stored before encryption was enabled. Safe to run multiple times — already-encrypted facts are skipped.
            </p>
            {encryptResult && (
              <div style={{ marginBottom: "14px", padding: "10px 14px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: "var(--radius)", fontSize: "13px", color: "var(--success)" }}>
                Done — encrypted {encryptResult.encrypted}, skipped {encryptResult.alreadyEncrypted} already encrypted{encryptResult.failed > 0 ? `, ${encryptResult.failed} failed` : ""}.
              </div>
            )}
            <button
              onClick={() => { setEncryptResult(null); encryptMutation.mutate(); }}
              disabled={encryptMutation.isPending}
              style={{ padding: "9px 20px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontWeight: "bold", cursor: "pointer" }}
            >
              {encryptMutation.isPending ? "Encrypting…" : "Encrypt All Plaintext Memories"}
            </button>
            {encryptMutation.isError && (
              <p style={{ color: "var(--error)", fontSize: "13px", marginTop: "8px" }}>Encryption failed. Check logs.</p>
            )}
          </section>

          <section style={{ marginTop: "30px" }}>
            <h2>Destructive Operations</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", marginTop: "10px" }}>
              <div>
                <button
                  onClick={() => setConfirmClearVectorize(true)}
                  disabled={clearVectorizeMutation.isPending}
                  style={{
                    width: "100%",
                    padding: "10px",
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "var(--error)",
                    borderRadius: "var(--radius)",
                    fontWeight: "bold",
                  }}
                >
                  Clear Vectorize Only
                </button>
                {confirmClearVectorize && (
                  <div style={{ marginTop: "10px", padding: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--error)", borderRadius: "var(--radius)" }}>
                    <p style={{ fontSize: "12px", marginBottom: "8px" }}>This will delete all vectors from Vectorize but keep D1 data.</p>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button
                        onClick={() => clearVectorizeMutation.mutate({})}
                        style={{ flex: 1, padding: "6px", background: "var(--error)", color: "white" }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmClearVectorize(false)}
                        style={{ flex: 1, padding: "6px", background: "var(--surface2)", border: "1px solid var(--border)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <button
                  onClick={() => setConfirmClear(true)}
                  disabled={clearDbMutation.isPending}
                  style={{
                    width: "100%",
                    padding: "10px",
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    color: "var(--error)",
                    borderRadius: "var(--radius)",
                    fontWeight: "bold",
                  }}
                >
                  Clear Database Only
                </button>
                {confirmClear && (
                  <div style={{ marginTop: "10px", padding: "10px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--error)", borderRadius: "var(--radius)" }}>
                    <p style={{ fontSize: "12px", marginBottom: "8px" }}>This will delete all memories from D1 and Vectorize.</p>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button
                        onClick={() => clearDbMutation.mutate({})}
                        style={{ flex: 1, padding: "6px", background: "var(--error)", color: "white" }}
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setConfirmClear(false)}
                        style={{ flex: 1, padding: "6px", background: "var(--surface2)", border: "1px solid var(--border)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <button
                  onClick={() => setConfirmClearAll(true)}
                  disabled={clearAllMutation.isPending}
                  style={{
                    width: "100%",
                    padding: "10px",
                    background: "rgba(239,68,68,0.15)",
                    border: "2px solid rgba(239,68,68,0.5)",
                    color: "var(--error)",
                    borderRadius: "var(--radius)",
                    fontWeight: "bold",
                    fontSize: "14px",
                  }}
                >
                  NUKE: Clear Everything
                </button>
                {confirmClearAll && (
                  <div style={{ marginTop: "10px", padding: "12px", background: "rgba(239,68,68,0.15)", border: "2px solid var(--error)", borderRadius: "var(--radius)" }}>
                    <p style={{ fontSize: "13px", marginBottom: "8px", fontWeight: "bold" }}>This will delete ALL memories from both D1 and Vectorize. This cannot be undone!</p>
                    <div style={{ display: "flex", gap: "5px" }}>
                      <button
                        onClick={() => clearAllMutation.mutate({})}
                        style={{ flex: 1, padding: "8px", background: "var(--error)", color: "white", fontWeight: "bold" }}
                      >
                        NUKE IT
                      </button>
                      <button
                        onClick={() => setConfirmClearAll(false)}
                        style={{ flex: 1, padding: "8px", background: "var(--surface2)", border: "1px solid var(--border)" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section style={{ marginTop: "30px", padding: "15px", background: "rgba(99,102,241,0.1)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
            <p style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              <strong>Status:</strong> {clearDbMutation.isPending || clearVectorizeMutation.isPending || clearAllMutation.isPending ? "Operating..." : "Ready"}
            </p>
          </section>
        </>
      )}

      {activeTab === "orgs" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h2 style={{ margin: 0 }}>Global Organizations</h2>
          </div>

          {orgsQuery.isPending && <p>Loading organizations...</p>}
          {orgsQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load organizations: {String(orgsQuery.error)}</p>}
          {orgsQuery.data && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {orgsQuery.data.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px", border: "1px dashed var(--border)", borderRadius: "var(--radius)", color: "var(--text-muted)" }}>
                  No organizations created yet. Organizations can be registered directly by users from the Organization Console.
                </div>
              ) : (
                orgsQuery.data.map((org) => {
                  const isEditing = editingOrgQuotaId === org.id;

                  return (
                    <div
                      key={org.id}
                      style={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "12px",
                        padding: "20px",
                        boxShadow: "0 4px 6px -1px rgba(0,0,0,0.1)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "bold" }}>{org.name}</h3>
                            <span
                              style={{
                                fontSize: "10px",
                                background: org.plan === "enterprise" ? "rgba(16,185,129,0.15)" : org.plan === "pro" ? "rgba(99,102,241,0.15)" : "var(--surface2)",
                                color: org.plan === "enterprise" ? "#10b981" : org.plan === "pro" ? "var(--accent)" : "var(--text-muted)",
                                padding: "2px 8px",
                                borderRadius: "20px",
                                fontWeight: "bold",
                                textTransform: "uppercase",
                              }}
                            >
                              {org.plan}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                            ID: <code style={{ color: "var(--accent)" }}>{org.id}</code> · Joined {new Date(org.createdAt).toLocaleDateString()} · {org.memberCount} member(s)
                          </div>
                        </div>
                        <button
                          onClick={() => {
                            if (confirm(`Are you sure you want to delete the organization ${org.name}? This will delete all its teams, members, and quotas!`)) {
                              deleteOrgMut.mutate(org.id);
                            }
                          }}
                          style={{
                            padding: "4px 8px",
                            background: "transparent",
                            color: "var(--error)",
                            border: "1px solid transparent",
                            borderRadius: "var(--radius)",
                            cursor: "pointer",
                            fontSize: "12px",
                            transition: "all 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            (e.target as HTMLElement).style.background = "rgba(239, 68, 68, 0.1)";
                            (e.target as HTMLElement).style.borderColor = "rgba(239, 68, 68, 0.2)";
                          }}
                          onMouseLeave={(e) => {
                            (e.target as HTMLElement).style.background = "transparent";
                            (e.target as HTMLElement).style.borderColor = "transparent";
                          }}
                        >
                          Delete
                        </button>
                      </div>

                      <div style={{ background: "var(--surface2)", borderRadius: "8px", padding: "14px", border: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                          <span style={{ fontSize: "12px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Monthly Quotas</span>
                          {!isEditing ? (
                            <button
                              onClick={() => {
                                setEditingOrgQuotaId(org.id);
                                setEditMemories(org.monthlyMemories);
                                setEditRecalls(org.monthlyRecalls);
                                setEditCommits(org.monthlyCommits);
                              }}
                              style={{ padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", cursor: "pointer", color: "var(--text-muted)" }}
                            >
                              Edit Quotas
                            </button>
                          ) : (
                            <div style={{ display: "flex", gap: "5px" }}>
                              <button
                                onClick={() => updateQuotaMut.mutate({ orgId: org.id, monthlyMemories: editMemories, monthlyRecalls: editRecalls, monthlyCommits: editCommits })}
                                disabled={updateQuotaMut.isPending}
                                style={{ padding: "4px 8px", background: "var(--accent)", color: "white", border: "none", borderRadius: "var(--radius)", fontSize: "11px", cursor: "pointer", fontWeight: "bold" }}
                              >
                                {updateQuotaMut.isPending ? "Saving..." : "Save"}
                              </button>
                              <button
                                onClick={() => setEditingOrgQuotaId(null)}
                                style={{ padding: "4px 8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", cursor: "pointer", color: "var(--text-muted)" }}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>

                        {!isEditing ? (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Memories Max</span>
                              <span style={{ fontSize: "14px", fontWeight: "bold" }}>{org.monthlyMemories}</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Recalls Max</span>
                              <span style={{ fontSize: "14px", fontWeight: "bold" }}>{org.monthlyRecalls}</span>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Commits Max</span>
                              <span style={{ fontSize: "14px", fontWeight: "bold" }}>{org.monthlyCommits}</span>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
                            <div>
                              <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Memories Max</span>
                              <input
                                type="number"
                                value={editMemories}
                                onChange={(e) => setEditMemories(Number(e.target.value))}
                                style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px" }}
                              />
                            </div>
                            <div>
                              <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Recalls Max</span>
                              <input
                                type="number"
                                value={editRecalls}
                                onChange={(e) => setEditRecalls(Number(e.target.value))}
                                style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px" }}
                              />
                            </div>
                            <div>
                              <span style={{ fontSize: "11px", color: "var(--text-muted)", display: "block", marginBottom: "4px" }}>Commits Max</span>
                              <input
                                type="number"
                                value={editCommits}
                                onChange={(e) => setEditCommits(Number(e.target.value))}
                                style={{ width: "100%", padding: "5px 8px", fontSize: "12px", borderRadius: "4px" }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}

      {/* Users Tab */}
      {activeTab === "users" && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h2 style={{ margin: 0 }}>Users Directory</h2>
            <button
              onClick={() => {
                setCreateName("");
                setCreateEmail("");
                setCreatePassword("");
                setCreatePlan("free");
                setIsCreateModalOpen(true);
              }}
              style={{
                padding: "8px 16px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                borderRadius: "var(--radius)",
                fontWeight: "bold",
                fontSize: "13px",
              }}
            >
              Create User
            </button>
          </div>

          <div style={{ marginBottom: "20px" }}>
            <input
              type="text"
              placeholder="Search users by name or email..."
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 14px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--text)",
              }}
            />
          </div>

          {usersQuery.isPending && <p>Loading users...</p>}
          {usersQuery.isError && <p style={{ color: "var(--error)" }}>Failed to load users: {String(usersQuery.error)}</p>}
          {usersQuery.data && (
            <div style={{ width: "100%", overflowX: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ padding: "12px 16px", color: "var(--text-muted)", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>User</th>
                    <th style={{ padding: "12px 16px", color: "var(--text-muted)", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>Pricing Plan</th>
                    <th style={{ padding: "12px 16px", color: "var(--text-muted)", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>Organizations</th>
                    <th style={{ padding: "12px 16px", color: "var(--text-muted)", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center" }}>Memories</th>
                    <th style={{ padding: "12px 16px", color: "var(--text-muted)", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em" }}>Joined</th>
                    <th style={{ padding: "12px 16px", color: "var(--text-muted)", fontSize: "11px", fontWeight: "bold", textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)", fontStyle: "italic" }}>
                        No users found matching search criteria.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((user) => (
                      <tr key={user.id} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ fontWeight: "bold", fontSize: "14px" }}>{user.name}</div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{user.email}</div>
                          {user.id === adminStatus?.userId && (
                            <span style={{ fontSize: "9px", background: "rgba(99,102,241,0.15)", color: "var(--accent)", padding: "1px 6px", borderRadius: "10px", fontWeight: "bold", display: "inline-block", marginTop: "4px" }}>
                              ADMIN
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <span
                            style={{
                              fontSize: "10px",
                              background: user.plan === "enterprise" ? "rgba(16,185,129,0.15)" : user.plan === "business" ? "rgba(99,102,241,0.15)" : "var(--surface2)",
                              color: user.plan === "enterprise" ? "#10b981" : user.plan === "business" ? "var(--accent)" : "var(--text-muted)",
                              padding: "2px 8px",
                              borderRadius: "20px",
                              fontWeight: "bold",
                              textTransform: "uppercase",
                            }}
                          >
                            {user.plan}
                          </span>
                        </td>
                        <td style={{ padding: "14px 16px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                            {user.organizations.length === 0 ? (
                              <span style={{ fontSize: "11px", color: "var(--text-muted)", fontStyle: "italic" }}>None</span>
                            ) : (
                              user.organizations.map((org) => (
                                <div key={org.id} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                  <span style={{ fontSize: "11px", fontWeight: "600" }}>{org.name}</span>
                                  <span
                                    style={{
                                      fontSize: "9px",
                                      background: org.role === "owner" ? "rgba(239,68,68,0.1)" : org.role === "admin" ? "rgba(99,102,241,0.1)" : "var(--surface2)",
                                      color: org.role === "owner" ? "var(--error)" : org.role === "admin" ? "var(--accent)" : "var(--text-muted)",
                                      padding: "1px 4px",
                                      borderRadius: "4px",
                                      fontWeight: "600",
                                      textTransform: "uppercase",
                                    }}
                                  >
                                    {org.role}
                                  </span>
                                </div>
                              ))
                            )}
                          </div>
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "center", fontWeight: "600", color: "var(--accent)" }}>
                          {user.memoryCount}
                        </td>
                        <td style={{ padding: "14px 16px", fontSize: "12px", color: "var(--text-muted)" }}>
                          {new Date(user.createdAt).toLocaleDateString()}
                        </td>
                        <td style={{ padding: "14px 16px", textAlign: "right" }}>
                          <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" }}>
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setEditName(user.name);
                                setEditEmail(user.email);
                                setEditEmailVerified(user.emailVerified);
                                setIsEditModalOpen(true);
                              }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600 }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setSelectedPlan(user.plan);
                                setIsPlanModalOpen(true);
                              }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600 }}
                            >
                              Plan
                            </button>
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setIsOrgsModalOpen(true);
                                setAssignOrgId("");
                                setAssignRole("member");
                              }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600 }}
                            >
                              Orgs
                            </button>
                            <button
                              onClick={() => {
                                setSelectedUser(user);
                                setPasswordValue("");
                                setIsPasswordModalOpen(true);
                              }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: 600 }}
                            >
                              Password
                            </button>
                            <button
                              onClick={() => {
                                if (confirm(`Are you sure you want to reset the password for ${user.name}? This will generate a new random password immediately.`)) {
                                  resetUserPasswordMut.mutate(user.id);
                                }
                              }}
                              style={{ padding: "4px 8px", background: "var(--surface2)", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "var(--radius)", fontSize: "11px" }}
                            >
                              Reset
                            </button>
                            {user.id !== adminStatus?.userId && (
                              <button
                                onClick={() => {
                                  if (confirm(`WARNING: Are you sure you want to delete user ${user.name}? This will delete all their account data, sessions, plans, and memories. This action is permanent and cannot be undone!`)) {
                                    deleteUserMut.mutate(user.id);
                                  }
                                }}
                                style={{ padding: "4px 8px", background: "rgba(239,68,68,0.1)", color: "var(--error)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "var(--radius)", fontSize: "11px", fontWeight: "bold" }}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* MODAL DIALOGS */}

      {/* Create User Modal */}
      {isCreateModalOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 17, 23, 0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", width: "100%", maxWidth: "450px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3)", padding: "24px" }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "bold" }}>Create New User</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Full Name</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  placeholder="e.g. John Doe"
                  style={{ width: "100%", padding: "8px 12px" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Email Address</label>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="e.g. john@example.com"
                  style={{ width: "100%", padding: "8px 12px" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Initial Password (Optional)</label>
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="Leave blank for passwordless OAuth"
                  style={{ width: "100%", padding: "8px 12px" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Personal Pricing Plan</label>
                <select
                  value={createPlan}
                  onChange={(e) => setCreatePlan(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px" }}
                >
                  <option value="free">Free (Personal)</option>
                  <option value="business">Business</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!createName || !createEmail) {
                    alert("Name and email are required.");
                    return;
                  }
                  createUserMut.mutate({ name: createName, email: createEmail, password: createPassword || undefined, plan: createPlan });
                }}
                disabled={createUserMut.isPending}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}
              >
                {createUserMut.isPending ? "Creating..." : "Create User"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {isEditModalOpen && selectedUser && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 17, 23, 0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", width: "100%", maxWidth: "450px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3)", padding: "24px" }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "16px", fontWeight: "bold" }}>Edit User</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Full Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px" }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Email Address</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  style={{ width: "100%", padding: "8px 12px" }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                <input
                  type="checkbox"
                  id="edit-email-verified"
                  checked={editEmailVerified}
                  onChange={(e) => setEditEmailVerified(e.target.checked)}
                  style={{ width: "auto" }}
                />
                <label htmlFor="edit-email-verified" style={{ fontSize: "13px", fontWeight: 500 }}>Email Verified</label>
              </div>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setIsEditModalOpen(false)}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (!editName || !editEmail) {
                    alert("Name and email are required.");
                    return;
                  }
                  updateUserMut.mutate({ userId: selectedUser.id, name: editName, email: editEmail, emailVerified: editEmailVerified });
                }}
                disabled={updateUserMut.isPending}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}
              >
                {updateUserMut.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Change Plan Modal */}
      {isPlanModalOpen && selectedUser && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 17, 23, 0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", width: "100%", maxWidth: "400px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3)", padding: "24px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Change Plan</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
              Assign pricing plan manually for <strong>{selectedUser.name}</strong>.
            </p>
            <div>
              <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>Plan</label>
              <select
                value={selectedPlan}
                onChange={(e) => setSelectedPlan(e.target.value)}
                style={{ width: "100%", padding: "8px 12px" }}
              >
                <option value="free">Free (Personal)</option>
                <option value="business">Business</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setIsPlanModalOpen(false)}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={() => updateUserPlanMut.mutate({ userId: selectedUser.id, plan: selectedPlan })}
                disabled={updateUserPlanMut.isPending}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}
              >
                {updateUserPlanMut.isPending ? "Updating..." : "Update Plan"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Password Modal */}
      {isPasswordModalOpen && selectedUser && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 17, 23, 0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", width: "100%", maxWidth: "400px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3)", padding: "24px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Set Password</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
              Set a manual password for <strong>{selectedUser.name}</strong>.
            </p>
            <div>
              <label style={{ display: "block", fontSize: "11px", color: "var(--text-muted)", marginBottom: "4px", fontWeight: "bold", textTransform: "uppercase" }}>New Password</label>
              <input
                type="password"
                value={passwordValue}
                onChange={(e) => setPasswordValue(e.target.value)}
                placeholder="At least 8 characters"
                style={{ width: "100%", padding: "8px 12px" }}
              />
            </div>
            <div style={{ display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setIsPasswordModalOpen(false)}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (passwordValue.length < 8) {
                    alert("Password must be at least 8 characters long.");
                    return;
                  }
                  setUserPasswordMut.mutate({ userId: selectedUser.id, password: passwordValue });
                }}
                disabled={setUserPasswordMut.isPending}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}
              >
                {setUserPasswordMut.isPending ? "Setting..." : "Set Password"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Success Modal */}
      {isResetSuccessModalOpen && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 17, 23, 0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1010, padding: "20px" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", width: "100%", maxWidth: "450px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3)", padding: "24px" }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: "bold", color: "var(--success)" }}>Password Reset Success</h3>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>
              A new temporary password has been successfully generated for the user:
            </p>
            <div
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                padding: "12px 16px",
                borderRadius: "8px",
                fontFamily: "monospace",
                fontSize: "18px",
                textAlign: "center",
                color: "var(--text)",
                letterSpacing: "0.08em",
                fontWeight: "bold",
                marginBottom: "20px",
              }}
            >
              {generatedPassword}
            </div>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(generatedPassword);
                  alert("Copied to clipboard!");
                }}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)", fontWeight: 600 }}
              >
                Copy Password
              </button>
              <button
                onClick={() => {
                  setIsResetSuccessModalOpen(false);
                  setGeneratedPassword("");
                }}
                style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Organizations Modal */}
      {isOrgsModalOpen && selectedUser && (
        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(15, 17, 23, 0.75)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }}>
          <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", width: "100%", maxWidth: "500px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3)", padding: "24px" }}>
            <h3 style={{ margin: "0 0 8px 0", fontSize: "16px", fontWeight: "bold" }}>Manage Organizations</h3>
            <p style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "16px" }}>
              Manage organization memberships for <strong>{selectedUser.name}</strong>.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "200px", overflowY: "auto", marginBottom: "20px", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px", background: "var(--surface2)" }}>
              <span style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", textTransform: "uppercase" }}>Current Memberships</span>
              {selectedUser.organizations.length === 0 ? (
                <span style={{ fontSize: "12px", color: "var(--text-muted)", fontStyle: "italic", padding: "8px 0" }}>Not a member of any organization.</span>
              ) : (
                selectedUser.organizations.map((org) => (
                  <div key={org.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 10px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px" }}>
                    <div>
                      <div style={{ fontWeight: "bold", fontSize: "13px" }}>{org.name}</div>
                      <div style={{ fontSize: "10px", color: "var(--text-muted)" }}>ID: {org.id}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <select
                        value={org.role}
                        onChange={(e) => {
                          assignUserToOrgMut.mutate({
                            userId: selectedUser.id,
                            orgId: org.id,
                            role: e.target.value as any,
                          });
                          const updated = selectedUser.organizations.map(o => o.id === org.id ? { ...o, role: e.target.value } : o);
                          setSelectedUser({ ...selectedUser, organizations: updated });
                        }}
                        style={{ padding: "3px 6px", fontSize: "11px", borderRadius: "4px" }}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button
                        onClick={() => {
                          if (confirm(`Remove ${selectedUser.name} from organization ${org.name}?`)) {
                            removeUserFromOrgMut.mutate({ userId: selectedUser.id, orgId: org.id });
                            const updated = selectedUser.organizations.filter(o => o.id !== org.id);
                            setSelectedUser({ ...selectedUser, organizations: updated });
                          }
                        }}
                        style={{ padding: "4px 8px", background: "transparent", color: "var(--error)", fontSize: "11px", fontWeight: "bold" }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
              <span style={{ display: "block", fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase" }}>Add to Organization</span>
              <div style={{ display: "flex", gap: "8px" }}>
                <select
                  value={assignOrgId}
                  onChange={(e) => setAssignOrgId(e.target.value)}
                  style={{ flex: 1, padding: "8px 12px" }}
                >
                  <option value="">Select organization...</option>
                  {(orgsQuery.data || [])
                    .filter((org) => !selectedUser.organizations.some((o) => o.id === org.id))
                    .map((org) => (
                      <option key={org.id} value={org.id}>{org.name}</option>
                    ))}
                </select>
                <select
                  value={assignRole}
                  onChange={(e) => setAssignRole(e.target.value as any)}
                  style={{ padding: "8px 12px" }}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
                <button
                  onClick={() => {
                    if (!assignOrgId) return;
                    assignUserToOrgMut.mutate({
                      userId: selectedUser.id,
                      orgId: assignOrgId,
                      role: assignRole,
                    });
                    const matchedName = (orgsQuery.data || []).find(o => o.id === assignOrgId)?.name || "New Organization";
                    const updated = [...selectedUser.organizations, { id: assignOrgId, name: matchedName, role: assignRole }];
                    setSelectedUser({ ...selectedUser, organizations: updated });
                    setAssignOrgId("");
                  }}
                  disabled={!assignOrgId || assignUserToOrgMut.isPending}
                  style={{ padding: "8px 16px", background: "var(--accent)", color: "white", fontWeight: "bold" }}
                >
                  Add
                </button>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "24px" }}>
              <button
                onClick={() => setIsOrgsModalOpen(false)}
                style={{ padding: "8px 16px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-muted)", fontWeight: 600 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useSession } from "~/lib/authClient";

function AdminGuard() {
  const { data: adminStatus, isLoading, error } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => getAdminStatus(),
  });

  if (isLoading) return <p style={{ padding: 32, color: "var(--text-muted)" }}>Loading…</p>;

  if (error || !adminStatus?.isAdmin) {
    return (
      <div style={{ padding: 32, textAlign: "center" }}>
        <p style={{ color: "var(--error)", fontSize: 16, fontWeight: 600 }}>403 — Not authorized</p>
        <p style={{ color: "var(--text-muted)", marginTop: 8, fontSize: 13 }}>This page is restricted to the admin account.</p>
        <div style={{ marginTop: 24, fontSize: 12, color: "var(--text-muted)", background: "var(--surface2)", padding: 16, borderRadius: "var(--radius)", display: "inline-block", textAlign: "left", border: "1px solid var(--border)" }}>
          <div style={{ marginBottom: 4 }}><strong>Your User ID:</strong> {adminStatus?.userId ?? "Not logged in"}</div>
          <div><strong>Configured Admin ID:</strong> {adminStatus?.configuredAdminId ? `${adminStatus.configuredAdminId.slice(0, 4)}...${adminStatus.configuredAdminId.slice(-4)}` : "None"}</div>
        </div>
      </div>
    );
  }
  return <AdminPage />;
}

export const Route = createFileRoute("/admin")({
  component: AdminGuard,
});
