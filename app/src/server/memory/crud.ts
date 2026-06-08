import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq, sql, and, isNull } from "drizzle-orm";
import {
  memories,
  memoryChunks,
  apiTokens,
  memoryVersions,
  organizations,
  organizationMembers,
  teams,
  teamMembers,
  userPlans,
  users,
  sessions,
  credentials,
  memoryTemplates,
  notifications,
  type Memory,
  type NewMemory,
} from "~/db/schema";
import { persistChunkedVectors, deleteChunkVectors } from "~/server/memory/_shared";
import type { CloudflareEnv } from "~/types/cloudflare";
import { encrypt, isEncrypted, hashToken, extractTokenPrefix, getOrCreateVaultKey } from "~/server/crypto";
import { extractGraphEntities, persistGraphData } from "~/server/graphRag";
import { requireSession, requireAdmin } from "~/server/session";
import { verifyVaultAccess, checkQuota, logTokenUsage, logAudit, estimateEmbeddingTokens, parseScope } from "~/server/enterprise";
import { checkMemoryLimit, checkApiTokenLimit, getUserEffectivePlan } from "~/server/planGate";
import { sanitizeMemory } from "~/server/sanitization";
import { containsSensitiveData } from "~/server/dlp";
import { WEBHOOK_SECRET_GITHUB, WEBHOOK_SECRET_LINEAR, SLACK_JIT_WEBHOOK } from "~/server/webhooks";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memories, memoryChunks, apiTokens, userPlans, organizationMembers, users } });
}

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-m3", { text: [text] });
  const r = result as { data?: number[][]; shape?: number[] };
  return r.data?.[0] ?? [];
}


async function encryptFact(fact: string, encKey: string | CryptoKey): Promise<string> {
  return encrypt(fact, encKey);
}

async function decryptFact(stored: string, encKey: string | CryptoKey): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  const { decrypt } = await import("~/server/crypto");
  return decrypt(stored, encKey);
}

const zProjectKeyFn = z
  .string()
  .max(128)
  .refine(
    (v) => v === "" || v === "personal" || /^org:[0-9a-f-]{36}$/.test(v) || /^team:[0-9a-f-]{36}$/.test(v),
    { message: "projectKey must be empty, 'personal', 'org:<uuid>', or 'team:<uuid>'" }
  )
  .optional();

const IdSchema = z.object({ id: z.string().uuid("id must be a valid UUID") }).strict();

// ── Workspaces ────────────────────────────────────────────────────────────────

export type WorkspaceItem = {
  key: string;
  label: string;
  type: "personal" | "org" | "team";
  role?: string;
};

export const getUserWorkspaces = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<WorkspaceItem[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const { planId } = await getUserEffectivePlan(db, user.id);
    const canAccessSharedWorkspaces = planId !== "free";

    const workspaces: WorkspaceItem[] = [
      { key: "personal", label: "Personal Locker", type: "personal" }
    ];

    if (!canAccessSharedWorkspaces) return workspaces;

    const orgRows = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizationMembers.orgId, organizations.id))
      .where(eq(organizationMembers.userId, user.id))
      .all();

    for (const org of orgRows) {
      workspaces.push({
        key: `org:${org.id}`,
        label: `${org.name} (Org)`,
        type: "org",
        role: org.role,
      });
    }

    const teamRows = await db
      .select({
        id: teams.id,
        name: teams.name,
        role: teamMembers.role,
      })
      .from(teamMembers)
      .innerJoin(teams, eq(teamMembers.teamId, teams.id))
      .where(eq(teamMembers.userId, user.id))
      .all();

    for (const team of teamRows) {
      workspaces.push({
        key: `team:${team.id}`,
        label: `${team.name} (Team)`,
        type: "team",
        role: team.role,
      });
    }

    return workspaces;
  }
);

// ── Get Memories ─────────────────────────────────────────────────────────────

const GetMemoriesSchema = z.object({
  projectKey: zProjectKeyFn,
}).strict();

export const getMemories = createServerFn({ method: "GET" })
  .inputValidator((data) => GetMemoriesSchema.parse(data))
  .handler(
    async ({ data, context }): Promise<Memory[]> => {
      const { env } = (context as unknown as CFContext).cloudflare;
      const user = await requireSession(env);
      const db = getDb(env);

      const { scopeType, scopeId } = parseScope(data?.projectKey);
      const { allowed: vaultAllowed } = await verifyVaultAccess(db, user.id, scopeType, scopeId);
      if (!vaultAllowed) {
        throw new Error(`Forbidden: no access to vault scope '${data?.projectKey ?? "personal"}'`);
      }

      let whereClause;
      if (scopeType === "personal") {
        whereClause = and(eq(memories.userId, user.id), eq(memories.scopeType, "personal"), eq(memories.isActive, true));
      } else {
        whereClause = and(eq(memories.scopeType, scopeType), eq(memories.scopeId, scopeId!), eq(memories.isActive, true));
      }

      const rows = await db
        .select()
        .from(memories)
        .where(whereClause)
        .orderBy(desc(memories.timestamp))
        .all();

      const { decryptMemories } = await import("~/server/memory/_shared");
      return decryptMemories(rows, env.DB, env.ENCRYPTION_KEY);
    }
  );

// ── Add Memory ────────────────────────────────────────────────────────────────

const AddMemorySchema = z.object({
  fact: z.string().min(1, "fact is required").max(10000).transform((s) => s.trim()),
  category: z.enum(["rules", "projects", "references"]),
  tags: z.string().max(500).default("").transform((s) => s.trim()),
  projectKey: zProjectKeyFn,
  isLocked: z.boolean().optional(),
  authorityType: z.enum(["authoritative", "contributed"]).optional(),
}).strict();

export const addMemory = createServerFn({ method: "POST" })
  .inputValidator((data) => AddMemorySchema.parse(data))
  .handler(async ({ data, context }): Promise<Memory> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    console.log("[addMemory] Starting...");
    const user = await requireSession(env);
    const db = getDb(env);
    console.log("[addMemory] User authenticated");

    if (!user.id) {
      throw new Error("Unauthorized: userId is required for vector insert");
    }

    const { scopeType, scopeId } = parseScope(data.projectKey);
    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, scopeType, scopeId);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${data.projectKey ?? "personal"}'`);
    }
    console.log("[addMemory] Vault access verified");

    await checkMemoryLimit(db, user.id);
    console.log("[addMemory] Memory limit checked");

    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) {
      throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);
    }
    console.log("[addMemory] Quota checked");

    const sanitizedFact = sanitizeMemory(data.fact);
    if (!sanitizedFact) {
      throw new Error("Invalid memory fact: content was empty or contained adversarial instructions");
    }
    console.log("[addMemory] Fact sanitized");

    const isQuarantined = containsSensitiveData(sanitizedFact);
    console.log("[addMemory] DLP check complete, quarantined:", isQuarantined);

    const id = crypto.randomUUID();
    const timestamp = Date.now();

    const vaultId = (scopeType === "team" || scopeType === "organization") ? data.projectKey! : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encryptFact(sanitizedFact, vaultKey);
    console.log("[addMemory] Fact encrypted");

    console.log("[addMemory] Starting graph extraction...");
    const graphExtraction = await extractGraphEntities(env.AI, sanitizedFact);
    console.log("[addMemory] Graph extraction complete");
    const tokensConsumed = estimateEmbeddingTokens(sanitizedFact);

    const tagsList = data.tags.split(",").map(t => t.trim()).filter(Boolean);
    if (!tagsList.includes("manual")) {
      tagsList.push("manual");
    }
    const finalTags = tagsList.join(", ");

    // embedding is resolved after chunked vector insertion below;
    // the contradiction queue send is deferred until we have the first chunk embedding.

    let isLocked = false;
    let authorityType: "authoritative" | "contributed" = "contributed";

    if (data.isLocked || data.authorityType === "authoritative") {
      let actualOrgId = orgId;
      if (scopeType === "organization") {
        actualOrgId = scopeId;
      } else if (scopeType === "team" && scopeId) {
        const teamRows = await db
          .select({ orgId: teams.orgId })
          .from(teams)
          .where(eq(teams.id, scopeId))
          .limit(1)
          .all();
        actualOrgId = teamRows[0]?.orgId ?? orgId;
      }

      if (actualOrgId) {
        const memberRow = await db
          .select({ role: organizationMembers.role })
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, actualOrgId), eq(organizationMembers.userId, user.id)))
          .limit(1)
          .all();
        const role = memberRow[0]?.role;
        if (role === "owner" || role === "admin") {
          isLocked = data.isLocked ?? false;
          authorityType = data.authorityType ?? "contributed";
        } else {
          throw new Error("Forbidden: Only organization owners/admins can create locked authoritative memories.");
        }
      }
    }

    const newRow: NewMemory = {
      id,
      userId: user.id,
      fact: encryptedFact,
      category: data.category,
      tags: finalTags,
      timestamp,
      isActive: true,
      projectKey: data.projectKey || null,
      scopeType,
      scopeId,
      isLocked,
      authorityType,
      isQuarantined,
    };

    await db.batch([
      db.insert(memories).values(newRow),
      db.insert(memoryVersions).values({
        id: crypto.randomUUID(),
        memoryId: id,
        fact: encryptedFact,
        category: data.category,
        tags: finalTags,
        changedBy: user.id,
        changeReason: "created",
        timestamp,
      }),
    ]);

    let entityIds: string[] = [];
    try {
      entityIds = await persistGraphData(env.DB, id, user.id, data.projectKey ?? null, graphExtraction);
    } catch (err) {
      console.error("[addMemory] graph persist failed:", err);
    }

    let firstChunkEmbedding: number[] = [];
    try {
      const sharedMeta = {
        userId: user.id,
        category: data.category,
        tags: finalTags,
        projectKey: data.projectKey ?? "",
        entityIds: entityIds.join(" "),
      };
      firstChunkEmbedding = await persistChunkedVectors(
        env.AI,
        env.DB,
        env.VECTOR_INDEX,
        id,
        sanitizedFact,
        sharedMeta,
      );
    } catch (err) {
      console.error(`[addMemory] vector insert failed:`, err);
    }

    try {
      await env.ARCHIVE_QUEUE.send({
        userId: user.id,
        newFact: sanitizedFact,
        embedding: firstChunkEmbedding,
        projectKey: data.projectKey || null,
      });
    } catch (err) {
      console.error("[addMemory] Failed to enqueue contradiction check:", err);
    }

    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "commit_memory", memoryId: id, metadata: { category: data.category, projectKey: data.projectKey, quarantined: isQuarantined } });
    await logTokenUsage(db, "session", "commit", tokensConsumed);

    return { ...newRow, fact: sanitizedFact, tags: newRow.tags ?? "", isActive: true, projectKey: newRow.projectKey ?? null } as Memory;
  });

// ── Update Memory ─────────────────────────────────────────────────────────────

const UpdateMemorySchema = z.object({
  id: z.string().uuid("id must be a valid UUID"),
  fact: z.string().min(1, "fact is required").max(10000).transform((s) => s.trim()),
  category: z.enum(["rules", "projects", "references"]),
  tags: z.string().max(500).default("").transform((s) => s.trim()),
}).strict();

export const updateMemory = createServerFn({ method: "POST" })
  .inputValidator((data) => UpdateMemorySchema.parse(data))
  .handler(async ({ data, context }): Promise<Memory> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required for vector upsert");
    }

    const existingRows = await db.select().from(memories).where(eq(memories.id, data.id)).all();
    if (existingRows.length === 0) {
      throw new Error("Memory not found or unauthorized");
    }
    const existing = existingRows[0];

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, existing.projectKey);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${existing.projectKey}'`);
    }

    if (existing.isLocked) {
      let actualOrgId = orgId;
      if (existing.projectKey) {
        if (existing.projectKey.startsWith("org:")) {
          actualOrgId = existing.projectKey.slice(4);
        } else if (existing.projectKey.startsWith("team:")) {
          const teamId = existing.projectKey.slice(5);
          const teamRows = await db
            .select({ orgId: teams.orgId })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1)
            .all();
          actualOrgId = teamRows[0]?.orgId ?? orgId;
        }
      }
      if (actualOrgId) {
        const memberRow = await db
          .select({ role: organizationMembers.role })
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, actualOrgId), eq(organizationMembers.userId, user.id)))
          .limit(1)
          .all();
        const role = memberRow[0]?.role;
        if (role !== "owner" && role !== "admin") {
          throw new Error("Forbidden: Locked organization memories can only be modified by organization owners/admins.");
        }
      } else {
        throw new Error("Forbidden: Locked memories can only be modified by organization owners/admins.");
      }
    }

    if ((!existing.projectKey || existing.projectKey === "personal") && existing.userId !== user.id) {
      throw new Error("Unauthorized");
    }

    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) {
      throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);
    }

    const sanitizedFact = sanitizeMemory(data.fact);
    if (!sanitizedFact) {
      throw new Error("Invalid memory fact: content was empty or contained adversarial instructions");
    }

    const isQuarantined = containsSensitiveData(sanitizedFact);

    const vaultId = (existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"))) ? existing.projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encryptFact(sanitizedFact, vaultKey);

    await db.update(memories)
      .set({ fact: encryptedFact, category: data.category, tags: data.tags, timestamp: Date.now(), isQuarantined })
      .where(eq(memories.id, data.id));

    await db.insert(memoryVersions).values({
      id: crypto.randomUUID(),
      memoryId: data.id,
      fact: encryptedFact,
      category: data.category,
      tags: data.tags,
      changedBy: user.id,
      changeReason: "updated",
      timestamp: Date.now(),
    });

    const tokensConsumed = estimateEmbeddingTokens(sanitizedFact);

    // Re-extract graph entities for the updated fact so knowledge-graph edges stay current.
    const graphExtraction = await extractGraphEntities(env.AI, sanitizedFact);
    let entityIds: string[] = [];
    try {
      entityIds = await persistGraphData(env.DB, data.id, user.id, existing.projectKey ?? null, graphExtraction);
    } catch (err) {
      console.error("[updateMemory] graph persist failed:", err);
    }

    // Purge stale child chunks before re-chunking the updated fact.
    await deleteChunkVectors(env.DB, env.VECTOR_INDEX, data.id);

    const sharedMeta = {
      userId: user.id,
      category: data.category,
      tags: data.tags,
      projectKey: existing.projectKey ?? "",
      entityIds: entityIds.join(" "),
    };
    await persistChunkedVectors(
      env.AI,
      env.DB,
      env.VECTOR_INDEX,
      data.id,
      sanitizedFact,
      sharedMeta,
    );

    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "update_memory", memoryId: data.id, metadata: { category: data.category, quarantined: isQuarantined } });
    await logTokenUsage(db, "session", "commit", tokensConsumed);

    const rows = await db.select().from(memories).where(eq(memories.id, data.id)).all();
    return { ...rows[0], fact: sanitizedFact };
  });

// ── Delete Memory ─────────────────────────────────────────────────────────────

export const deleteMemory = createServerFn({ method: "POST" })
  .inputValidator((data) => IdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ deleted: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required");
    }

    const rows = await db
      .select()
      .from(memories)
      .where(eq(memories.id, data.id))
      .all();

    if (!rows.length) {
      throw new Error("Memory not found or unauthorized");
    }
    const existing = rows[0];

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, existing.projectKey);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${existing.projectKey}'`);
    }

    if (existing.isLocked) {
      let actualOrgId = orgId;
      if (existing.projectKey) {
        if (existing.projectKey.startsWith("org:")) {
          actualOrgId = existing.projectKey.slice(4);
        } else if (existing.projectKey.startsWith("team:")) {
          const teamId = existing.projectKey.slice(5);
          const teamRows = await db
            .select({ orgId: teams.orgId })
            .from(teams)
            .where(eq(teams.id, teamId))
            .limit(1)
            .all();
          actualOrgId = teamRows[0]?.orgId ?? orgId;
        }
      }
      if (actualOrgId) {
        const memberRow = await db
          .select({ role: organizationMembers.role })
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, actualOrgId), eq(organizationMembers.userId, user.id)))
          .limit(1)
          .all();
        const role = memberRow[0]?.role;
        if (role !== "owner" && role !== "admin") {
          throw new Error("Forbidden: Locked organization memories can only be deleted by organization owners/admins.");
        }
      } else {
        throw new Error("Forbidden: Locked memories can only be deleted by organization owners/admins.");
      }
    }

    if ((!existing.projectKey || existing.projectKey === "personal") && existing.userId !== user.id) {
      throw new Error("Unauthorized");
    }

    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) {
      throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);
    }

    await db.delete(memories).where(eq(memories.id, data.id));
    await env.VECTOR_INDEX.deleteByIds([data.id]);

    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "delete_memory", memoryId: data.id });
    await logTokenUsage(db, "session", "commit", 0);

    return { deleted: true };
  });

// ── Archive / Restore / Permanently Delete ─────────────────────────────────

export const archiveMemory = createServerFn({ method: "POST" })
  .inputValidator((data) => IdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ archived: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) throw new Error("Unauthorized: userId is required");

    const rows = await db.select().from(memories).where(eq(memories.id, data.id)).all();
    if (!rows.length) throw new Error("Memory not found");

    const memory = rows[0];
    if (!memory.isActive) throw new Error("Memory is already archived");

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, memory.projectKey);
    if (!vaultAllowed) throw new Error(`Forbidden: no access to vault scope '${memory.projectKey}'`);

    if (memory.isLocked) throw new Error("Locked memories cannot be archived — remove the lock first.");

    if ((!memory.projectKey || memory.projectKey === "personal") && memory.userId !== user.id) {
      throw new Error("Unauthorized");
    }

    await db.update(memories).set({ isActive: false }).where(eq(memories.id, data.id));
    await env.VECTOR_INDEX.deleteByIds([data.id]);

    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "update_memory", memoryId: data.id, metadata: { archived: true } });

    return { archived: true };
  });

const GetArchivedMemoriesSchema = z.object({
  projectKey: zProjectKeyFn,
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
}).strict();

export const getArchivedMemories = createServerFn({ method: "POST" })
  .inputValidator((data) => GetArchivedMemoriesSchema.parse(data))
  .handler(async ({ data, context }): Promise<any> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required");
    }

    const projectKey = data.projectKey || null;
    const conditions = [eq(memories.isActive, false), eq(memories.userId, user.id)];
    if (projectKey) {
      conditions.push(eq(memories.projectKey, projectKey));
    } else {
      conditions.push(sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`);
    }

    const rows = await db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.timestamp))
      .limit(data.limit)
      .offset(data.offset)
      .all();

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(memories)
      .where(and(...conditions))
      .all();

    return {
      archived: rows,
      total: total[0]?.count ?? 0,
      limit: data.limit,
      offset: data.offset,
    };
  });

export const restoreMemory = createServerFn({ method: "POST" })
  .inputValidator((data) => IdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ restored: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required");
    }

    const rows = await db
      .select()
      .from(memories)
      .where(eq(memories.id, data.id))
      .all();

    if (!rows.length) {
      throw new Error("Memory not found");
    }

    const memory = rows[0];
    if (memory.isActive) {
      throw new Error("Memory is already active");
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, memory.projectKey);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${memory.projectKey}'`);
    }

    await db.update(memories).set({ isActive: true }).where(eq(memories.id, data.id));

    const vaultId = (memory.projectKey && (memory.projectKey.startsWith("team:") || memory.projectKey.startsWith("org:"))) ? memory.projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const decryptedFact = await decryptFact(memory.fact, vaultKey);

    const restoreGraphExtraction = await extractGraphEntities(env.AI, decryptedFact);
    let restoreEntityIds: string[] = [];
    try {
      restoreEntityIds = await persistGraphData(env.DB, memory.id, memory.userId, memory.projectKey ?? null, restoreGraphExtraction);
    } catch (err) {
      console.error("[restoreMemory] graph persist failed:", err);
    }

    await deleteChunkVectors(env.DB, env.VECTOR_INDEX, memory.id);
    await persistChunkedVectors(
      env.AI,
      env.DB,
      env.VECTOR_INDEX,
      memory.id,
      decryptedFact,
      { userId: memory.userId, projectKey: memory.projectKey || "", category: memory.category, tags: memory.tags, entityIds: restoreEntityIds.join(" ") },
    );

    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "update_memory", memoryId: data.id, metadata: { restored: true } });

    return { restored: true };
  });

export const permanentlyDeleteArchivedMemory = createServerFn({ method: "POST" })
  .inputValidator((data) => IdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ deleted: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required");
    }

    const rows = await db
      .select()
      .from(memories)
      .where(eq(memories.id, data.id))
      .all();

    if (!rows.length) {
      throw new Error("Memory not found");
    }

    const memory = rows[0];
    if (memory.isActive) {
      throw new Error("Cannot permanently delete active memories");
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, memory.projectKey);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${memory.projectKey}'`);
    }

    await db.delete(memories).where(eq(memories.id, data.id));
    await env.VECTOR_INDEX.deleteByIds([data.id]);

    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "delete_memory", memoryId: data.id, metadata: { archived: true } });

    return { deleted: true };
  });

// ── Move Memories ─────────────────────────────────────────────────────────────

const MoveMemoriesSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "ids must be a non-empty array").max(200),
  targetProjectKey: z.string().min(1).max(128).transform((s) => s.trim()).refine(
    (v) => v === "personal" || /^org:[0-9a-f-]{36}$/.test(v) || /^team:[0-9a-f-]{36}$/.test(v),
    { message: "targetProjectKey must be 'personal', 'org:<uuid>', or 'team:<uuid>'" }
  ),
}).strict();

export const moveMemories = createServerFn({ method: "POST" })
  .inputValidator((data) => MoveMemoriesSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ moved: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const { allowed: targetAllowed, orgId: targetOrgId } = await verifyVaultAccess(db, user.id, data.targetProjectKey);
    if (!targetAllowed) {
      throw new Error(`Forbidden: no access to target vault scope '${data.targetProjectKey}'`);
    }

    const rows = await db
      .select()
      .from(memories)
      .where(sql`${memories.id} IN (${sql.join(data.ids.map((id) => sql`${id}`), sql`, `)})`)
      .all();

    let movedCount = 0;

    for (const mem of rows) {
      const { allowed: sourceAllowed } = await verifyVaultAccess(db, user.id, mem.projectKey);
      if (!sourceAllowed) continue;

      if ((!mem.projectKey || mem.projectKey === "personal") && mem.userId !== user.id) {
        continue;
      }

      const srcVaultId = (mem.projectKey && (mem.projectKey.startsWith("team:") || mem.projectKey.startsWith("org:"))) ? mem.projectKey : mem.userId;
      const srcVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, srcVaultId);
      const plaintextFact = await decryptFact(mem.fact, srcVaultKey);

      const targetVaultId = (data.targetProjectKey && (data.targetProjectKey.startsWith("team:") || data.targetProjectKey.startsWith("org:"))) ? data.targetProjectKey : user.id;
      const targetVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, targetVaultId);
      const encryptedFact = await encryptFact(plaintextFact, targetVaultKey);

      let scopeType: "personal" | "organization" | "team" = "personal";
      let scopeId: string | null = null;
      if (data.targetProjectKey) {
        if (data.targetProjectKey.startsWith("org:")) {
          scopeType = "organization";
          scopeId = data.targetProjectKey.slice(4);
        } else if (data.targetProjectKey.startsWith("team:")) {
          scopeType = "team";
          scopeId = data.targetProjectKey.slice(5);
        }
      }

      await db.update(memories)
        .set({
          fact: encryptedFact,
          projectKey: data.targetProjectKey === "personal" ? null : data.targetProjectKey,
          scopeType,
          scopeId,
          timestamp: Date.now(),
        })
        .where(eq(memories.id, mem.id));

      await db.insert(memoryVersions).values({
        id: crypto.randomUUID(),
        memoryId: mem.id,
        fact: encryptedFact,
        category: mem.category,
        tags: mem.tags,
        changedBy: user.id,
        changeReason: "moved",
        timestamp: Date.now(),
      });

      const targetProjectKey = data.targetProjectKey === "personal" ? "" : data.targetProjectKey;
      const targetProjectKeyNull = data.targetProjectKey === "personal" ? null : data.targetProjectKey;

      const moveGraphExtraction = await extractGraphEntities(env.AI, plaintextFact);
      let moveEntityIds: string[] = [];
      try {
        moveEntityIds = await persistGraphData(env.DB, mem.id, user.id, targetProjectKeyNull, moveGraphExtraction);
      } catch (err) {
        console.error("[moveMemories] graph persist failed:", err);
      }

      await deleteChunkVectors(env.DB, env.VECTOR_INDEX, mem.id);
      await persistChunkedVectors(
        env.AI,
        env.DB,
        env.VECTOR_INDEX,
        mem.id,
        plaintextFact,
        {
          userId: user.id,
          category: mem.category,
          tags: mem.tags,
          projectKey: targetProjectKey,
          entityIds: moveEntityIds.join(" "),
        } as Record<string, VectorizeVectorMetadata>,
      );

      await logAudit(db, {
        orgId: targetOrgId,
        userId: user.id,
        tokenId: "session",
        action: "update_memory",
        memoryId: mem.id,
        metadata: { action: "move_memory", from: mem.projectKey ?? "personal", to: data.targetProjectKey }
      });

      movedCount++;
    }

    return { moved: movedCount };
  });

// ── Bulk Delete ───────────────────────────────────────────────────────────────

const BulkIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "ids must be a non-empty array").max(200),
}).strict();

export const bulkDeleteMemories = createServerFn({ method: "POST" })
  .inputValidator((data) => BulkIdsSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ deleted: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required");
    }

    const FETCH_CHUNK = 50;
    const memoriesToDelete: Memory[] = [];
    for (let i = 0; i < data.ids.length; i += FETCH_CHUNK) {
      const chunk = data.ids.slice(i, i + FETCH_CHUNK);
      const rows = await db
        .select()
        .from(memories)
        .where(sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`)
        .all();
      memoriesToDelete.push(...rows);
    }

    const authorizedIds: string[] = [];
    for (const mem of memoriesToDelete) {
      const { allowed: vaultAllowed } = await verifyVaultAccess(db, user.id, mem.projectKey);
      if (!vaultAllowed) {
        continue;
      }

      if ((!mem.projectKey || mem.projectKey === "personal") && mem.userId !== user.id) {
        continue;
      }

      if (mem.isLocked) {
        let actualOrgId: string | null = null;
        if (mem.projectKey) {
          if (mem.projectKey.startsWith("org:")) {
            actualOrgId = mem.projectKey.slice(4);
          } else if (mem.projectKey.startsWith("team:")) {
            const teamId = mem.projectKey.slice(5);
            const teamRows = await db
              .select({ orgId: teams.orgId })
              .from(teams)
              .where(eq(teams.id, teamId))
              .limit(1)
              .all();
            actualOrgId = teamRows[0]?.orgId ?? null;
          }
        }
        if (actualOrgId) {
          const memberRow = await db
            .select({ role: organizationMembers.role })
            .from(organizationMembers)
            .where(and(eq(organizationMembers.orgId, actualOrgId), eq(organizationMembers.userId, user.id)))
            .limit(1)
            .all();
          const role = memberRow[0]?.role;
          if (role !== "owner" && role !== "admin") {
            continue;
          }
        } else {
          continue;
        }
      }

      authorizedIds.push(mem.id);
    }

    const CHUNK = 10;
    for (let i = 0; i < authorizedIds.length; i += CHUNK) {
      const chunk = authorizedIds.slice(i, i + CHUNK);
      await db.delete(memories).where(
        sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`
      );
    }

    const VECTOR_CHUNK = 100;
    for (let i = 0; i < authorizedIds.length; i += VECTOR_CHUNK) {
      await env.VECTOR_INDEX.deleteByIds(authorizedIds.slice(i, i + VECTOR_CHUNK));
    }

    return { deleted: authorizedIds.length };
  });

// ── Nuke Everything ────────────────────────────────────────────────────────────

export const nukeEverything = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ success: boolean; dbDeleted: number; vectorsDeleted: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const dbRows = await db.select({ id: memories.id }).from(memories).where(eq(memories.userId, user.id)).all();
    const dbIds = dbRows.map((r) => r.id);
    let dbDeleted = 0;

    if (dbIds.length > 0) {
      const CHUNK = 50;
      for (let i = 0; i < dbIds.length; i += CHUNK) {
        const chunk = dbIds.slice(i, i + CHUNK);
        await db.delete(memories).where(
          sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`
        );
      }
      dbDeleted = dbIds.length;
    }

    let vectorsDeleted = 0;
    if (dbIds.length > 0) {
      const VECTOR_CHUNK = 100;
      for (let i = 0; i < dbIds.length; i += VECTOR_CHUNK) {
        await env.VECTOR_INDEX.deleteByIds(dbIds.slice(i, i + VECTOR_CHUNK));
      }
      vectorsDeleted = dbIds.length;
    }

    return { success: true, dbDeleted, vectorsDeleted };
  }
);

// ── Unmask Memory ─────────────────────────────────────────────────────────────

export const unmaskMemory = createServerFn({ method: "POST" })
  .inputValidator((data) => IdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized");
    }

    const existingRows = await db.select().from(memories).where(eq(memories.id, data.id)).all();
    if (existingRows.length === 0) {
      throw new Error("Memory not found or unauthorized");
    }
    const existing = existingRows[0];

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, existing.projectKey);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${existing.projectKey}'`);
    }

    const isSharedVault = existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"));
    if (!isSharedVault && existing.userId !== user.id) {
      throw new Error("Unauthorized");
    }

    if (isSharedVault) {
      const actualOrgId = existing.projectKey!.startsWith("org:") ? existing.projectKey!.slice(4) : orgId;
      if (actualOrgId) {
        const memberRow = await db
          .select({ role: organizationMembers.role })
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, actualOrgId), eq(organizationMembers.userId, user.id)))
          .limit(1)
          .all();
        const role = memberRow[0]?.role;
        if (role !== "owner" && role !== "admin") {
          throw new Error("Forbidden: Only organization owners/admins can unmask memories in a shared vault.");
        }
      } else {
        throw new Error("Forbidden: You do not have permission to modify this memory.");
      }
    }

    await db.update(memories)
      .set({ isQuarantined: false })
      .where(eq(memories.id, data.id));

    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "unmask_memory", memoryId: data.id });

    return { success: true };
  });

// ── Quarantined Memories ───────────────────────────────────────────────────────

const GetQuarantinedSchema = z.object({
  projectKey: z.string().optional(),
});

export const getQuarantinedMemories = createServerFn({ method: "POST" })
  .inputValidator((data) => GetQuarantinedSchema.parse(data))
  .handler(async ({ data, context }): Promise<Memory[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const { allowed: vaultAllowed } = await verifyVaultAccess(db, user.id, data.projectKey);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${data.projectKey ?? "personal"}'`);
    }

    const vaultId = data.projectKey && (data.projectKey.startsWith("team:") || data.projectKey.startsWith("org:"))
      ? data.projectKey
      : user.id;

    const rows = await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, user.id),
          eq(memories.isQuarantined, true),
          eq(memories.isActive, true),
          data.projectKey
            ? eq(memories.projectKey, data.projectKey)
            : isNull(memories.projectKey),
        )
      )
      .orderBy(desc(memories.timestamp))
      .limit(200)
      .all();

    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const { decrypt: decryptFn, isEncrypted: isEnc } = await import("~/server/crypto");

    const decrypted = await Promise.all(
      rows.map(async (row) => {
        try {
          const fact = isEnc(row.fact) ? await decryptFn(row.fact, vaultKey) : row.fact;
          return { ...row, fact };
        } catch {
          return { ...row, fact: "[DECRYPTION ERROR]" };
        }
      })
    );

    return decrypted;
  });

// ── Profile ────────────────────────────────────────────────────────────────────

export const getProfile = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ name: string; location: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const rows = await db.select().from(memories).where(eq(memories.userId, user.id)).all();
    const nameRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-name")
    );
    const locRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-location")
    );

    const profileVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, user.id);

    let name = "";
    if (nameRow) {
      try {
        const fact = await decryptFact(nameRow.fact, profileVaultKey);
        name = fact.replace(/^Name is\s+/i, "").trim();
      } catch {
        name = "";
      }
    }

    let location = "";
    if (locRow) {
      try {
        const fact = await decryptFact(locRow.fact, profileVaultKey);
        location = fact.replace(/^Location is\s+/i, "").trim();
      } catch {
        location = "";
      }
    }

    return { name, location };
  }
);

export const getUserPlan = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ planId: string; personalPlanId: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const { planId } = await getUserEffectivePlan(db, user.id);

    const personalRow = await db
      .select({ plan: userPlans.plan })
      .from(userPlans)
      .where(eq(userPlans.userId, user.id))
      .limit(1)
      .all();
    const personalPlanId = personalRow[0]?.plan ?? "free";

    return { planId, personalPlanId };
  }
);

const SaveProfileSchema = z.object({
  name: z.string().max(256).default("").transform((s) => s.trim()),
  location: z.string().max(256).default("").transform((s) => s.trim()),
}).strict();

export const saveProfile = createServerFn({ method: "POST" })
  .inputValidator((data) => SaveProfileSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required for vector operations");
    }

    const rows = await db.select().from(memories).where(eq(memories.userId, user.id)).all();
    const nameRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-name")
    );
    const locRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-location")
    );

    const saveProfileVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, user.id);

    if (data.name) {
      const fact = `Name is ${data.name}`;
      const encFact = await encryptFact(fact, saveProfileVaultKey);
      const tokensConsumed = estimateEmbeddingTokens(fact);
      const profileNameMeta = { userId: user.id, category: "references", tags: "profile-name", projectKey: "", entityIds: "" } as Record<string, VectorizeVectorMetadata>;
      if (nameRow) {
        await db.update(memories).set({ fact: encFact }).where(eq(memories.id, nameRow.id));
        await deleteChunkVectors(env.DB, env.VECTOR_INDEX, nameRow.id);
        await persistChunkedVectors(env.AI, env.DB, env.VECTOR_INDEX, nameRow.id, fact, profileNameMeta);
      } else {
        const id = crypto.randomUUID();
        await db.insert(memories).values({ id, userId: user.id, fact: encFact, category: "references", tags: "profile-name", timestamp: Date.now(), isActive: true, projectKey: null });
        await persistChunkedVectors(env.AI, env.DB, env.VECTOR_INDEX, id, fact, profileNameMeta);
      }
    } else if (nameRow) {
      await deleteChunkVectors(env.DB, env.VECTOR_INDEX, nameRow.id);
      await db.delete(memories).where(eq(memories.id, nameRow.id));
      await env.VECTOR_INDEX.deleteByIds([nameRow.id]);
    }

    if (data.location) {
      const fact = `Location is ${data.location}`;
      const encFact = await encryptFact(fact, saveProfileVaultKey);
      const profileLocMeta = { userId: user.id, category: "references", tags: "profile-location", projectKey: "", entityIds: "" } as Record<string, VectorizeVectorMetadata>;
      if (locRow) {
        await db.update(memories).set({ fact: encFact }).where(eq(memories.id, locRow.id));
        await deleteChunkVectors(env.DB, env.VECTOR_INDEX, locRow.id);
        await persistChunkedVectors(env.AI, env.DB, env.VECTOR_INDEX, locRow.id, fact, profileLocMeta);
      } else {
        const id = crypto.randomUUID();
        await db.insert(memories).values({ id, userId: user.id, fact: encFact, category: "references", tags: "profile-location", timestamp: Date.now(), isActive: true, projectKey: null });
        await persistChunkedVectors(env.AI, env.DB, env.VECTOR_INDEX, id, fact, profileLocMeta);
      }
    } else if (locRow) {
      await deleteChunkVectors(env.DB, env.VECTOR_INDEX, locRow.id);
      await db.delete(memories).where(eq(memories.id, locRow.id));
      await env.VECTOR_INDEX.deleteByIds([locRow.id]);
    }

    return { success: true };
  });

// ── API Tokens ─────────────────────────────────────────────────────────────────

export type ApiTokenPublic = {
  id: string;
  name: string;
  permissions: number;
  scopeType: "personal" | "organization" | "team";
  scopeId: string | null;
  scopes: string | null;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
  tokenType: "human" | "agent";
  agentPolicy: string | null;
};

export const listApiTokens = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<ApiTokenPublic[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const rows = await db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        permissions: apiTokens.permissions,
        scopeType: apiTokens.scopeType,
        scopeId: apiTokens.scopeId,
        scopes: apiTokens.scopes,
        createdAt: apiTokens.createdAt,
        lastUsedAt: apiTokens.lastUsedAt,
        expiresAt: apiTokens.expiresAt,
        tokenType: apiTokens.tokenType,
        agentPolicy: apiTokens.agentPolicy,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, user.id))
      .all() as any;
    return rows;
  }
);

const AgentCategoryEnum = z.enum(["rules", "projects", "references", "configs"]);

const CreateApiTokenSchema = z.object({
  name: z.string().min(1, "name is required").max(64).transform((s) => s.trim()),
  permissions: z.number().int().min(0).max(15).default(15).transform((n) => n & 15),
  scopeType: z.enum(["personal", "organization", "team"]).default("personal"),
  scopeId: z.string().max(128).optional(),
  scopes: z.unknown().optional(),
  ttlDays: z.number().int().min(1).max(3650).default(365),
  tokenType: z.enum(["human", "agent"]).default("human"),
  agentContext: z.string().max(128).optional().transform((s) => s?.trim()),
  allowedCategories: z.array(AgentCategoryEnum).default([]),
  deniedCategories: z.array(AgentCategoryEnum).default([]),
  allowedTags: z.array(z.string().max(64)).default([]).transform((arr) => arr.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  deniedTags: z.array(z.string().max(64)).default([]).transform((arr) => arr.map((t) => t.trim().toLowerCase()).filter(Boolean)),
  allowCredentials: z.boolean().default(false),
}).strict().superRefine((val, ctx) => {
  if (val.tokenType === "agent" && !val.agentContext) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "agentContext is required for agent tokens", path: ["agentContext"] });
  }
});

export const createApiToken = createServerFn({ method: "POST" })
  .inputValidator((data) => CreateApiTokenSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ token: string; id: string; name: string; permissions: number; scopeType: string; scopeId: string | null; scopes: string | null; expiresAt: number; tokenType: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    await checkApiTokenLimit(db, user.id);

    const id = crypto.randomUUID();
    const idHex = id.replace(/-/g, "");
    const secretBytes = crypto.getRandomValues(new Uint8Array(16));
    const secretHex = Array.from(secretBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const rawToken = `lkr_${idHex}_${secretHex}`;
    const tokenHash = await hashToken(rawToken);
    const now = Date.now();
    const expiresAt = now + (data.ttlDays * 24 * 60 * 60 * 1000);
    const scopesJson = data.scopes ? (typeof data.scopes === "string" ? data.scopes : JSON.stringify(data.scopes)) : null;

    const agentPolicyJson = data.tokenType === "agent" && data.agentContext
      ? JSON.stringify({
          agentContext: data.agentContext,
          allowedCategories: data.allowedCategories ?? [],
          deniedCategories: data.deniedCategories ?? [],
          allowedTags: data.allowedTags ?? [],
          deniedTags: data.deniedTags ?? [],
          allowCredentials: data.allowCredentials ?? false,
        })
      : null;

    await db.insert(apiTokens).values({
      id,
      userId: user.id,
      name: data.name,
      tokenHash,
      tokenPrefix: extractTokenPrefix(rawToken),
      permissions: data.permissions,
      scopeType: data.scopeType,
      scopeId: data.scopeId || null,
      scopes: scopesJson,
      tokenType: data.tokenType,
      agentPolicy: agentPolicyJson,
      createdAt: now,
      expiresAt,
    });

    return { token: rawToken, id, name: data.name, permissions: data.permissions, scopeType: data.scopeType, scopeId: data.scopeId || null, scopes: scopesJson, expiresAt, tokenType: data.tokenType };
  });

export const revokeApiToken = createServerFn({ method: "POST" })
  .inputValidator((data) => IdSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ revoked: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    await db.delete(apiTokens).where(
      sql`${apiTokens.id} = ${data.id} AND ${apiTokens.userId} = ${user.id}`
    );
    return { revoked: true };
  });

const UpdateTokenPermissionsSchema = z.object({
  id: z.string().uuid(),
  permissions: z.number().int().min(0).max(15).transform((n) => n & 15),
}).strict();

export const updateApiTokenPermissions = createServerFn({ method: "POST" })
  .inputValidator((data) => UpdateTokenPermissionsSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ updated: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    await db.update(apiTokens)
      .set({ permissions: data.permissions })
      .where(sql`${apiTokens.id} = ${data.id} AND ${apiTokens.userId} = ${user.id}`);
    return { updated: true };
  });

const RenewApiTokenSchema = z.object({
  id: z.string().uuid(),
  ttlDays: z.number().int().min(1).max(3650).default(30),
}).strict();

export const renewApiToken = createServerFn({ method: "POST" })
  .inputValidator((data) => RenewApiTokenSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ expiresAt: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const now = Date.now();
    const expiresAt = now + (data.ttlDays * 24 * 60 * 60 * 1000);
    await db.update(apiTokens)
      .set({ expiresAt })
      .where(sql`${apiTokens.id} = ${data.id} AND ${apiTokens.userId} = ${user.id}`);
    return { expiresAt };
  });

// ── Session Management ─────────────────────────────────────────────────────────

export const listActiveSessions = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { sessions } });

    const userSessions = await db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        expiresAt: sessions.expiresAt,
        ipAddress: sessions.ipAddress,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
      .orderBy(desc(sessions.createdAt))
      .all();

    return userSessions;
  }
);

const SessionIdSchema = z.object({ sessionId: z.string().min(1).max(256) }).strict();

export const revokeSession = createServerFn({ method: "POST" })
  .inputValidator((data) => SessionIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { sessions } });

    const session = await db.select().from(sessions).where(eq(sessions.id, data.sessionId)).limit(1).all();
    if (!session.length || session[0].userId !== user.id) {
      throw new Response(JSON.stringify({ error: "Session not found" }), { status: 404 });
    }

    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.id, data.sessionId))
      .run();

    return { success: true };
  });

export const revokeAllSessions = createServerFn({ method: "POST" }).handler(
  async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { sessions } });

    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.userId, user.id))
      .run();

    return { success: true };
  }
);

// ── Password / Email Auth ─────────────────────────────────────────────────────

const EmailSchema = z.object({
  email: z.string().email("valid email is required").max(254).transform((s) => s.toLowerCase().trim()),
}).strict();

export const sendPasswordResetEmail = createServerFn({ method: "POST" })
  .inputValidator((data) => EmailSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const { verifications } = await import("~/db/schema");
    const db = drizzle(env.DB, { schema: { users, verifications } });

    const userRows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1)
      .all();

    if (!userRows.length) {
      return { success: true };
    }

    const userId = userRows[0].id;
    const resetToken = crypto.randomUUID();
    const expiresAt = Date.now() + 60 * 60 * 1000;

    await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        identifier: `password_reset:${userId}`,
        value: resetToken,
        expiresAt: new Date(expiresAt),
        createdAt: new Date(),
      });

    if (!env.SE_EMAIL) {
      throw new Error("Email sending is not configured. Contact support.");
    }

    const resetLink = `${env.BETTER_AUTH_URL}/reset-password/${resetToken}`;
    try {
      await env.SE_EMAIL.send({
        to: data.email,
        from: "noreply@locker.dev",
        subject: "Reset your Locker password",
        text: `Click this link to reset your password:\n\n${resetLink}\n\nThis link expires in 1 hour.`,
        html: `<p>Click <a href="${resetLink}">here to reset your password</a>.</p><p>This link expires in 1 hour.</p>`,
      });
    } catch (err) {
      console.error("[password-reset] Email send failed:", err);
      throw new Error("Failed to send reset email. Please try again or contact support.");
    }

    return { success: true };
  });

const ResetPasswordSchema = z.object({
  token: z.string().uuid("token must be a valid UUID"),
  password: z.string().min(8, "Password must be at least 8 characters").max(256),
}).strict();

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator((data) => ResetPasswordSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const { verifications, accounts } = await import("~/db/schema");
    const db = drizzle(env.DB, { schema: { users, verifications, accounts } });

    const verRows = await db
      .select()
      .from(verifications)
      .where(sql`${verifications.value} = ${data.token} AND ${verifications.expiresAt} > ${Date.now()}`)
      .limit(1)
      .all();

    if (!verRows.length || !verRows[0].identifier.startsWith("password_reset:")) {
      throw new Error("Invalid or expired reset token");
    }

    const userId = verRows[0].identifier.split(":")[1];
    const { hashPassword } = await import("better-auth/crypto");
    const hash = await hashPassword(data.password);

    await db
      .update(accounts)
      .set({
        password: hash,
        updatedAt: new Date(),
      })
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")));

    await db.delete(verifications).where(eq(verifications.id, verRows[0].id));

    return { success: true };
  });

const SendVerificationEmailSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID"),
  email: z.string().email("valid email is required").max(254).transform((s) => s.toLowerCase().trim()),
}).strict();

export const sendVerificationEmail = createServerFn({ method: "POST" })
  .inputValidator((data) => SendVerificationEmailSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const { verifications } = await import("~/db/schema");
    const db = drizzle(env.DB, { schema: { verifications } });

    const verifyToken = crypto.randomUUID();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;

    await db
      .insert(verifications)
      .values({
        id: crypto.randomUUID(),
        identifier: `email_verify:${data.userId}`,
        value: verifyToken,
        expiresAt: new Date(expiresAt),
        createdAt: new Date(),
      });

    if (env.SE_EMAIL) {
      const verifyLink = `${env.BETTER_AUTH_URL}/verify-email/${verifyToken}`;
      try {
        await env.SE_EMAIL.send({
          to: data.email,
          from: "noreply@locker.dev",
          subject: "Verify your Locker email address",
          text: `Click this link to verify your email:\n\n${verifyLink}\n\nThis link expires in 24 hours.`,
          html: `<p>Click <a href="${verifyLink}">here to verify your email</a>.</p><p>This link expires in 24 hours.</p>`,
        });
      } catch (err) {
        console.error("[email-verify] Email send failed:", err);
      }
    }

    return { success: true };
  });

const VerifyEmailSchema = z.object({ token: z.string().uuid("token must be a valid UUID") }).strict();

export const verifyEmail = createServerFn({ method: "POST" })
  .inputValidator((data) => VerifyEmailSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const { verifications } = await import("~/db/schema");
    const db = drizzle(env.DB, { schema: { users, verifications } });

    const verRows = await db
      .select()
      .from(verifications)
      .where(sql`${verifications.value} = ${data.token} AND ${verifications.expiresAt} > ${Date.now()}`)
      .limit(1)
      .all();

    if (!verRows.length || !verRows[0].identifier.startsWith("email_verify:")) {
      throw new Error("Invalid or expired verification token");
    }

    const userId = verRows[0].identifier.split(":")[1];

    await db.update(users).set({ emailVerified: true }).where(eq(users.id, userId));

    await db.delete(verifications).where(eq(verifications.id, verRows[0].id));

    return { success: true };
  });

// ── Passcode ───────────────────────────────────────────────────────────────────

const SetPasscodeSchema = z.object({
  passcode: z.string().min(4, "Passcode must be at least 4 characters").max(32, "Passcode must be at most 32 characters"),
}).strict();

export const setDeletionPasscode = createServerFn({ method: "POST" })
  .inputValidator((data) => SetPasscodeSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const hashed = await hashToken(data.passcode);
    await db
      .update(users)
      .set({ writePasscodeHash: hashed })
      .where(eq(users.id, user.id));

    return { success: true };
  });

export const removeDeletionPasscode = createServerFn({ method: "POST" })
  .handler(async ({ context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    await db
      .update(users)
      .set({ writePasscodeHash: null })
      .where(eq(users.id, user.id));

    return { success: true };
  });

export const getPasscodeStatus = createServerFn({ method: "GET" })
  .handler(async ({ context }): Promise<{ enabled: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const rows = await db
      .select({ hash: users.writePasscodeHash })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1)
      .all();

    return { enabled: rows.length > 0 && rows[0].hash !== null };
  });

// ── Pending Org Invitations ───────────────────────────────────────────────────

const OrgIdSchema = z.object({ orgId: z.string().uuid("orgId must be a valid UUID") }).strict();

export const getPendingOrgInvitations = createServerFn({ method: "POST" })
  .inputValidator((data) => OrgIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<Array<{ id: string; email: string; role: string; expiresAt: number; createdAt: number }>> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireSession(env);
    const { invitations } = await import("~/db/schema");
    const db = drizzle(env.DB, { schema: { invitations } });

    const invRows = await db
      .select({
        id: invitations.id,
        email: invitations.email,
        role: invitations.role,
        expiresAt: invitations.expiresAt,
        createdAt: invitations.createdAt,
      })
      .from(invitations)
      .where(
        and(
          eq(invitations.orgId, data.orgId),
          sql`${invitations.expiresAt} > ${Date.now()}`
        )
      )
      .all();

    return invRows;
  });

// ── Memory Usage Stats ─────────────────────────────────────────────────────────

export const getMemoryUsageStats = createServerFn({ method: "GET" })
  .handler(async ({ context }): Promise<{ used: number; limit: number | null }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { memories, userPlans } });

    const { planId } = await getUserEffectivePlan(db, user.id);

    const countRows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(memories)
      .where(
        and(
          eq(memories.userId, user.id),
          eq(memories.isActive, true),
          sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
        )
      )
      .all();

    const used = Number(countRows[0]?.count ?? 0);
    const { PLANS } = await import("~/lib/plans");
    const limit = PLANS[planId].limits.maxMemories === Infinity ? null : PLANS[planId].limits.maxMemories;

    return { used, limit };
  });

// ── Memory Templates ──────────────────────────────────────────────────────────

export const listMemoryTemplates = createServerFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireSession(env);
    const db = drizzle(env.DB);
    return db.select().from(memoryTemplates).all();
  });

const TemplateCategoryEnum = z.enum(["configs", "compliance", "project_management", "product_management", "devops", "devsecops", "cicd"]);

const TemplateVariableSchema = z.object({
  key: z.string().min(1).max(64),
  description: z.string().max(256).optional().default(""),
  default: z.string().max(512).optional().default(""),
});

const MemoryTemplateSchema = z.object({
  name: z.string().min(1, "name is required").max(128).transform((s) => s.trim()),
  description: z.string().min(1, "description is required").max(512).transform((s) => s.trim()),
  category: TemplateCategoryEnum,
  configPayload: z.string().min(1, "configPayload is required").max(50000),
  params: z.record(z.string(), z.string()).optional(),
  variables: z.array(TemplateVariableSchema).optional(),
  systemProperties: z.record(z.string(), z.string()).optional(),
  workflowCategory: TemplateCategoryEnum.optional(),
}).strict();

export const createMemoryTemplate = createServerFn({ method: "POST" })
  .inputValidator((data) => MemoryTemplateSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB);
    const id = crypto.randomUUID();
    const now = Date.now();
    const result = await db.insert(memoryTemplates).values({
      id,
      name: data.name,
      description: data.description,
      category: data.category,
      configPayload: data.configPayload,
      params: data.params ? JSON.stringify(data.params) : null,
      variables: data.variables?.length ? JSON.stringify(data.variables) : null,
      systemProperties: data.systemProperties ? JSON.stringify(data.systemProperties) : null,
      workflowCategory: data.workflowCategory ?? data.category,
      createdAt: Math.floor(now / 1000),
      updatedAt: now,
    }).returning();
    await logAudit(db, {
      orgId: null,
      userId: user.id,
      tokenId: "session",
      action: "create_template",
      metadata: { templateId: id, name: data.name, category: data.category },
    });
    return result[0];
  });

export const updateMemoryTemplate = createServerFn({ method: "POST" })
  .inputValidator((data) => MemoryTemplateSchema.extend({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB);
    const result = await db.update(memoryTemplates)
      .set({
        name: data.name,
        description: data.description,
        category: data.category,
        configPayload: data.configPayload,
        params: data.params ? JSON.stringify(data.params) : null,
        variables: data.variables?.length ? JSON.stringify(data.variables) : null,
        systemProperties: data.systemProperties ? JSON.stringify(data.systemProperties) : null,
        workflowCategory: data.workflowCategory ?? data.category,
        updatedAt: Date.now(),
      })
      .where(eq(memoryTemplates.id, data.id))
      .returning();
    await logAudit(db, {
      orgId: null,
      userId: user.id,
      tokenId: "session",
      action: "update_template",
      metadata: { templateId: data.id, name: data.name },
    });
    return result[0];
  });

export const deleteMemoryTemplate = createServerFn({ method: "POST" })
  .inputValidator((data) => IdSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB);
    await db.delete(memoryTemplates).where(eq(memoryTemplates.id, data.id)).run();
    await logAudit(db, {
      orgId: null,
      userId: user.id,
      tokenId: "session",
      action: "delete_template",
      metadata: { templateId: data.id },
    });
    return { success: true };
  });

// ── Agent Config ──────────────────────────────────────────────────────────────

const AgentConfigSchema = z.object({
  name: z.string().min(1).max(128).transform((s) => s.trim()),
  systemPrompt: z.string().max(50000).optional().default("").transform((s) => s.trim()),
  techStack: z.record(z.string(), z.string()).optional().default({}),
  codeStyle: z.record(z.string(), z.string()).optional().default({}),
  params: z.record(z.string(), z.string()).optional().default({}),
  variables: z.array(z.object({
    key: z.string().min(1).max(64),
    description: z.string().max(256).optional().default(""),
    default: z.string().max(512).optional().default(""),
  })).optional().default([]),
  systemProperties: z.record(z.string(), z.string()).optional().default({}),
  ruleInclusions: z.array(z.string()).optional().default([]),
  tags: z.string().optional().default(""),
  projectKey: zProjectKeyFn,
  exportAsTemplate: z.boolean().optional().default(false),
  templateCategory: TemplateCategoryEnum.optional().default("configs"),
  templateDescription: z.string().max(512).optional().default(""),
}).strict();

export const saveAgentConfig = createServerFn({ method: "POST" })
  .inputValidator((data) => AgentConfigSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB);

    const projectKey = data.projectKey || null;
    const { allowed: vaultAllowed } = await verifyVaultAccess(db, user.id, projectKey);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${projectKey}'`);
    }

    const stackLines = Object.entries(data.techStack).map(([k, v]) => `- ${k}: ${v}`).join("\n");
    const styleLines = Object.entries(data.codeStyle).map(([k, v]) => `- ${k}: ${v}`).join("\n");
    const ruleLines = data.ruleInclusions.map((r) => `- ${r}`).join("\n");
    const paramLines = Object.entries(data.params).map(([k, v]) => `- ${k}: ${v}`).join("\n");
    const propLines = Object.entries(data.systemProperties).map(([k, v]) => `- ${k}: ${v}`).join("\n");
    const varLines = data.variables.map((v) => `- ${v.key}${v.default ? ` (default: ${v.default})` : ""}${v.description ? ` — ${v.description}` : ""}`).join("\n");

    let factContent = `[config:${data.name}]`;
    if (data.systemPrompt) factContent += `\n\n## System Prompt\n${data.systemPrompt}`;
    if (stackLines) factContent += `\n\n## Tech Stack\n${stackLines}`;
    if (styleLines) factContent += `\n\n## Code Style\n${styleLines}`;
    if (paramLines) factContent += `\n\n## Parameters\n${paramLines}`;
    if (varLines) factContent += `\n\n## Variables\n${varLines}`;
    if (propLines) factContent += `\n\n## System Properties\n${propLines}`;
    if (ruleLines) factContent += `\n\n## Rule Inclusions\n${ruleLines}`;

    const vaultId = (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) ? projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encrypt(factContent, vaultKey);

    const tagsList = data.tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (!tagsList.includes("config")) tagsList.push("config");
    const finalTags = tagsList.join(", ");

    let scopeType: "personal" | "organization" | "team" = "personal";
    let scopeId: string | null = null;
    if (projectKey?.startsWith("org:")) { scopeType = "organization"; scopeId = projectKey.slice(4); }
    else if (projectKey?.startsWith("team:")) { scopeType = "team"; scopeId = projectKey.slice(5); }

    const memId = crypto.randomUUID();
    const timestamp = Date.now();
    const isQuarantined = containsSensitiveData(factContent);

    await db.insert(memories).values({
      id: memId,
      userId: user.id,
      fact: encryptedFact,
      category: "configs",
      tags: finalTags,
      timestamp,
      isActive: true,
      projectKey: projectKey,
      scopeType,
      scopeId,
      isQuarantined,
      sourceType: "ui",
    });

    await db.insert(memoryVersions).values({
      id: crypto.randomUUID(),
      memoryId: memId,
      fact: encryptedFact,
      category: "configs",
      tags: finalTags,
      changedBy: user.id,
      changeReason: "created",
      timestamp,
    });

    let templateId: string | null = null;
    if (data.exportAsTemplate) {
      const configPayload = JSON.stringify({
        systemPrompt: data.systemPrompt,
        techStack: data.techStack,
        codeStyle: data.codeStyle,
        ruleInclusions: data.ruleInclusions,
        tags: data.tags,
        params: data.params,
        variables: data.variables,
        systemProperties: data.systemProperties,
      });
      templateId = crypto.randomUUID();
      const now = Date.now();
      await db.insert(memoryTemplates).values({
        id: templateId,
        name: data.name,
        description: data.templateDescription || `Agent config: ${data.name}`,
        category: data.templateCategory,
        configPayload,
        params: Object.keys(data.params).length ? JSON.stringify(data.params) : null,
        variables: data.variables.length ? JSON.stringify(data.variables) : null,
        systemProperties: Object.keys(data.systemProperties).length ? JSON.stringify(data.systemProperties) : null,
        workflowCategory: data.templateCategory,
        createdAt: Math.floor(now / 1000),
        updatedAt: now,
      });
    }

    await logAudit(db, {
      orgId: null,
      userId: user.id,
      tokenId: "session",
      action: "save_agent_config",
      memoryId: memId,
      metadata: { name: data.name, projectKey, exportAsTemplate: data.exportAsTemplate, templateId },
    });

    return { success: true, memoryId: memId, templateId };
  });

// ── Analyze Project / Generate Stack ──────────────────────────────────────────

function extractText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.response === "string") return r.response;
    if (typeof r.text === "string") return r.text;
    if (typeof r.result === "string") return r.result;
    if (Array.isArray(r.choices) && r.choices[0]) {
      const c = r.choices[0] as Record<string, unknown>;
      if (typeof c.text === "string") return c.text;
      if (c.message && typeof (c.message as Record<string, unknown>).content === "string")
        return (c.message as Record<string, unknown>).content as string;
    }
  }
  return "";
}

const AnalyzeProjectSchema = z.object({
  description: z.string().min(1, "description is required").max(4000).transform((s) => s.trim()),
}).strict();

export const analyzeProjectRequirements = createServerFn({ method: "POST" })
  .inputValidator((data) => AnalyzeProjectSchema.parse(data))
  .handler(async ({ data, context }): Promise<{
    language: string;
    frontend: string;
    hosting: string;
    database: string;
    storage: string;
    search: string;
    vector: string;
    componentLibrary: string;
    orm: string;
    auth: string;
    styling: string;
    stateCache: string;
    bannedProviders: string[];
  }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireSession(env);

    const prompt = `You are an AI system analyzer. A developer will describe their project requirements.
Based on the description, recommend the most appropriate options for their tech stack from the following choices:
- Preferred Language: "TypeScript", "JavaScript", "Python", "Go", "Rust", "Ruby", "Java", "C#", "C++", "PHP"
- Frontend Ecosystem / Framework: "React / TanStack", "Next.js", "Remix", "Vue / Nuxt", "Svelte / SvelteKit", "Astro", "SolidJS", "Angular", "Node.js / Express", "HTML/JS"
- Hosting / Runtime Environment: "Cloudflare Edge", "Vercel", "Netlify", "AWS Lambda", "Google Cloud Run", "Azure App Service", "Fly.io", "Heroku", "Railway", "Render", "Self-Hosted VPS"
- Database: "Cloudflare D1", "PostgreSQL", "MySQL", "SQLite", "MongoDB", "Redis", "Supabase (Postgres)", "Neon (Postgres)", "PlanetScale", "Prisma Postgres", "Azure SQL Database", "Google Cloud SQL"
- ORM / DB Access: "Drizzle ORM", "Prisma", "Mongoose", "TypeORM", "Kysely", "Sequelize", "Entity Framework Core", "SQL (Raw)", "None"
- Authentication: "Better Auth", "Auth.js (NextAuth)", "Clerk", "Supabase Auth", "Firebase Auth", "Microsoft Entra ID", "Kinde", "Lucia", "Custom", "None"
- CSS / Styling: "Vanilla CSS", "Tailwind CSS", "Bootstrap", "Material Design", "CSS Modules", "Styled Components", "Sass/SCSS", "Tailwind + CSS Modules"
- Client State / Cache: "TanStack Store", "Cloudflare KV", "Zustand", "Redux Toolkit", "Jotai", "Recoil", "React Context", "Pinia", "Vuex", "Redis Cache", "None"
- Blob/Object Storage: "Cloudflare R2", "AWS S3", "Supabase Storage", "Vercel Blob", "Firebase Storage", "Azure Blob Storage", "Google Cloud Storage", "Local Filesystem", "None"
- Search Index: "Fuse.js", "Algolia", "Meilisearch", "Elasticsearch", "None"
- Vector Index: "Cloudflare Vectorize", "Pinecone", "pgvector", "Supabase Vector", "Qdrant", "None"
- UI Component Library: "shadcn/ui", "MUI (Material UI)", "Chakra UI", "Radix UI", "DaisyUI", "PrimeReact", "None"
- Banned Providers/Services: Recommend any cloud providers (like "AWS", "Google Cloud", "Azure", "Atlassian/Jira") that should be explicitly banned if the user expresses privacy or competitor concerns. Choose from: "AWS", "Google Cloud", "Azure", "Atlassian/Jira".

Respond with ONLY a JSON object conforming to the following format. Do not include explanation, markdown code fences, or any other text.
{
  "language": string,
  "frontend": string,
  "hosting": string,
  "database": string,
  "storage": string,
  "search": string,
  "vector": string,
  "componentLibrary": string,
  "orm": string,
  "auth": string,
  "styling": string,
  "stateCache": string,
  "bannedProviders": string[]
}

Project Description:
"${data.description}"`;

    try {
      const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        prompt,
        max_tokens: 512,
      });

      const text = extractText(result).trim();
      const match = text.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return {
          language: String(parsed.language || "TypeScript"),
          frontend: String(parsed.frontend || "React / TanStack"),
          hosting: String(parsed.hosting || "Cloudflare Edge"),
          database: String(parsed.database || "Cloudflare D1"),
          storage: String(parsed.storage || "Cloudflare R2"),
          search: String(parsed.search || "None"),
          vector: String(parsed.vector || "Cloudflare Vectorize"),
          componentLibrary: String(parsed.componentLibrary || "None"),
          orm: String(parsed.orm || "Drizzle ORM"),
          auth: String(parsed.auth || "Better Auth"),
          styling: String(parsed.styling || "Tailwind CSS"),
          stateCache: String(parsed.stateCache || "TanStack Store"),
          bannedProviders: Array.isArray(parsed.bannedProviders) ? parsed.bannedProviders.map(String) : [],
        };
      }
    } catch (e) {
      console.error("[analyzeProjectRequirements] error:", e);
    }

    return {
      language: "TypeScript",
      frontend: "React / TanStack",
      hosting: "Cloudflare Edge",
      database: "Cloudflare D1",
      storage: "Cloudflare R2",
      search: "None",
      vector: "Cloudflare Vectorize",
      componentLibrary: "None",
      orm: "Drizzle ORM",
      auth: "Better Auth",
      styling: "Vanilla CSS",
      stateCache: "TanStack Store",
      bannedProviders: ["AWS", "Google Cloud"],
    };
  });

const StackFieldSchema = z.string().max(128).default("");

const GenerateStackSchema = z.object({
  language: StackFieldSchema,
  frontend: StackFieldSchema,
  hosting: StackFieldSchema,
  database: StackFieldSchema,
  storage: StackFieldSchema,
  search: StackFieldSchema,
  vector: StackFieldSchema,
  componentLibrary: StackFieldSchema,
  orm: StackFieldSchema,
  auth: StackFieldSchema,
  styling: StackFieldSchema,
  stateCache: StackFieldSchema,
  bannedProviders: z.array(z.string().max(64)).default([]),
}).strict();

export const generateStackRecommendation = createServerFn({ method: "POST" })
  .inputValidator((data) => GenerateStackSchema.parse(data))
  .handler(async ({ data, context }): Promise<{
    name: string;
    description: string;
    rules: string[];
  }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireSession(env);

    const prompt = `You are an expert software architect. Based on the following stack preferences, generate a comprehensive architectural baseline/ruleset.

Preferences:
- Preferred Language: ${data.language}
- Frontend Ecosystem / Framework: ${data.frontend}
- Hosting / Runtime Environment: ${data.hosting}
- Database: ${data.database}
- Blob/Object Storage: ${data.storage}
- Search Index: ${data.search}
- Vector Index: ${data.vector}
- Component Library: ${data.componentLibrary}
- ORM / DB Access: ${data.orm}
- Authentication: ${data.auth}
- CSS / Styling: ${data.styling}
- Client State / Cache: ${data.stateCache}
- Banned Providers/Services: ${data.bannedProviders.join(", ") || "None"}

Please return your response in raw JSON format (no markdown code blocks, no explanation, no headers) conforming to the following TypeScript interface:
{
  "name": string,
  "description": string,
  "rules": string[]
}
`;

    try {
      const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        prompt,
        max_tokens: 1500,
      });

      const text = extractText(result).trim();
      const match = text.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.name && parsed.description && Array.isArray(parsed.rules)) {
          return {
            name: String(parsed.name),
            description: String(parsed.description),
            rules: parsed.rules.map(String),
          };
        }
      }
    } catch (e) {
      console.error("[generateStackRecommendation] Failed to parse JSON response:", e);
    }

    return {
      name: `${data.frontend || "Custom"} Stack Blueprint`,
      description: `Architectural blueprint for a stack using ${data.language} with ${data.frontend}, ${data.hosting}, using ${data.orm} and ${data.auth}.`,
      rules: [
        `Enforce ${data.language} as the primary language.`,
        `Enforce ${data.frontend} for frontend structure and routing.`,
        `Enforce ${data.hosting} for hosting compute runtimes.`,
        `Enforce ${data.database} as the primary database.`,
        `Enforce ${data.orm} for database ORM and query building.`,
        `Enforce ${data.auth} for user sessions and identity.`,
        `Enforce ${data.styling} for styling user interface components.`,
        `Enforce ${data.stateCache} for client-side state / server-side caching.`,
        `Enforce ${data.storage} for object storage.`,
        `Enforce ${data.search} for search indexing.`,
        `Enforce ${data.vector} for vector database indexing.`,
        `Enforce ${data.componentLibrary} for UI component library.`,
        ...data.bannedProviders.map(p => `Strict negative constraint: ${p} services are explicitly banned.`)
      ]
    };
  });

// ── Webhook Secret Management ─────────────────────────────────────────────────

export type WebhookSource = "github" | "linear" | "slack_jit";

const WEBHOOK_CRED_NAMES: Record<WebhookSource, string> = {
  github: WEBHOOK_SECRET_GITHUB,
  linear: WEBHOOK_SECRET_LINEAR,
  slack_jit: SLACK_JIT_WEBHOOK,
};

async function resolveWebhookVault(
  db: ReturnType<typeof getDb>,
  userId: string,
  scopeKey: string | null
): Promise<{ vaultId: string; scopeType: "personal" | "organization"; scopeId: string | null }> {
  if (!scopeKey || scopeKey === "personal") {
    return { vaultId: userId, scopeType: "personal", scopeId: null };
  }
  if (scopeKey.startsWith("org:")) {
    const orgId = scopeKey.slice(4);
    return { vaultId: `org:${orgId}`, scopeType: "organization", scopeId: orgId };
  }
  if (scopeKey.startsWith("team:")) {
    const teamId = scopeKey.slice(5);
    const row = await db
      .select({ orgId: teams.orgId })
      .from(teams)
      .where(eq(teams.id, teamId))
      .limit(1)
      .all();
    const orgId = row[0]?.orgId ?? null;
    if (orgId) return { vaultId: `org:${orgId}`, scopeType: "organization", scopeId: orgId };
  }
  return { vaultId: userId, scopeType: "personal", scopeId: null };
}

export const getWebhookSecret = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => {
    const d = data as { source: WebhookSource; scopeKey?: string | null };
    return { source: d.source, scopeKey: d.scopeKey ?? null };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const { vaultId } = await resolveWebhookVault(db, user.id, data.scopeKey ?? null);
    const credName = WEBHOOK_CRED_NAMES[data.source];

    const scopeCondition = vaultId.startsWith("org:") || vaultId.startsWith("team:")
      ? and(eq(credentials.projectKey, vaultId), eq(credentials.name, credName))
      : and(eq(credentials.userId, user.id), eq(credentials.name, credName));

    const rows = await (db as any)
      .select({ id: credentials.id, name: credentials.name })
      .from(credentials)
      .where(scopeCondition)
      .limit(1)
      .all();

    return { configured: rows.length > 0, source: data.source, scopeKey: data.scopeKey ?? null };
  });

export const setWebhookSecret = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const d = data as { source: WebhookSource; secret: string; scopeKey?: string | null };
    if (!d.source || !d.secret) throw new Error("source and secret are required");
    return { source: d.source, secret: d.secret.trim(), scopeKey: d.scopeKey ?? null };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const { vaultId, scopeType, scopeId } = await resolveWebhookVault(db, user.id, data.scopeKey ?? null);

    if (scopeType === "organization" && scopeId) {
      const membership = await (db as any)
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, scopeId), eq(organizationMembers.userId, user.id)))
        .limit(1)
        .all();
      const role = membership[0]?.role;
      if (role !== "owner" && role !== "admin") {
        throw new Error("Forbidden: only org owners and admins can configure org webhook secrets");
      }
    }

    const credName = WEBHOOK_CRED_NAMES[data.source];
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const encryptedValue = await encrypt(data.secret, vaultKey);

    const isOrgOrTeam = vaultId.startsWith("org:") || vaultId.startsWith("team:");
    const scopeCondition = isOrgOrTeam
      ? and(eq(credentials.projectKey, vaultId), eq(credentials.name, credName))
      : and(eq(credentials.userId, user.id), eq(credentials.name, credName));

    const existing = await (db as any)
      .select({ id: credentials.id })
      .from(credentials)
      .where(scopeCondition)
      .limit(1)
      .all();

    if (existing.length > 0) {
      await (db as any)
        .update(credentials)
        .set({ encryptedValue, updatedAt: Date.now() })
        .where(eq(credentials.id, existing[0].id))
        .run();
    } else {
      await (db as any)
        .insert(credentials)
        .values({
          id: crypto.randomUUID(),
          userId: user.id,
          name: credName,
          encryptedValue,
          projectKey: vaultId.startsWith("org:") || vaultId.startsWith("team:") ? vaultId : null,
          scopeType,
          scopeId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
    }

    return { ok: true, source: data.source, scopeKey: data.scopeKey ?? null };
  });

export const deleteWebhookSecret = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const d = data as { source: WebhookSource; scopeKey?: string | null };
    if (!d.source) throw new Error("source is required");
    return { source: d.source, scopeKey: d.scopeKey ?? null };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const { vaultId, scopeType, scopeId } = await resolveWebhookVault(db, user.id, data.scopeKey ?? null);

    if (scopeType === "organization" && scopeId) {
      const membership = await (db as any)
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, scopeId), eq(organizationMembers.userId, user.id)))
        .limit(1)
        .all();
      const role = membership[0]?.role;
      if (role !== "owner" && role !== "admin") {
        throw new Error("Forbidden: only org owners and admins can remove org webhook secrets");
      }
    }

    const credName = WEBHOOK_CRED_NAMES[data.source];
    const isOrgOrTeam = vaultId.startsWith("org:") || vaultId.startsWith("team:");
    const scopeCondition = isOrgOrTeam
      ? and(eq(credentials.projectKey, vaultId), eq(credentials.name, credName))
      : and(eq(credentials.userId, user.id), eq(credentials.name, credName));

    await (db as any).delete(credentials).where(scopeCondition).run();

    return { ok: true, source: data.source, scopeKey: data.scopeKey ?? null };
  });
