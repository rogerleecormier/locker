import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq, sql, and } from "drizzle-orm";
import {
  memories,
  memoryVersions,
  memoryRecommendations,
  notifications,
  organizations,
  organizationMembers,
  teams,
  apiTokens,
  userPlans,
  orgQuotas,
  users,
} from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { encrypt, isEncrypted, getOrCreateVaultKey, decryptEphemeral, type EphemeralPlaintext } from "~/server/crypto";
import { requireSession } from "~/server/session";
import { verifyVaultAccess, parseScope } from "~/server/enterprise";
import { sanitizeMemory } from "~/server/sanitization";
import { containsSensitiveData } from "~/server/dlp";
import { persistChunkedVectors, deleteChunkVectors } from "~/server/memory/_shared";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memories, apiTokens, userPlans, organizationMembers, orgQuotas, users } });
}

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-m3", { text: [text] });
  const r = result as { data?: number[][]; shape?: number[] };
  return r.data?.[0] ?? [];
}

async function encryptFact(fact: string, encKey: string | CryptoKey): Promise<string> {
  return encrypt(fact, encKey);
}

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

// ── Archive Contradicting Memories (queue worker helper) ──────────────────────

export async function archiveContradictingMemories(
  db: any,
  env: CloudflareEnv,
  userId: string,
  newFact: string,
  embedding: number[],
  projectKey: string | undefined
): Promise<void> {
  if (!userId) throw new Error("Unauthorized: userId is required for vector query");

  const filter: Record<string, any> = {};
  if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
    filter.projectKey = projectKey;
  } else {
    filter.userId = userId;
    if (projectKey) filter.projectKey = { $in: [projectKey, ""] };
  }

  const results = await env.VECTOR_INDEX.query(embedding, { topK: 10, filter, returnMetadata: "none" });
  if (!results.matches || results.matches.length === 0) return;

  const candidates = results.matches.filter((m: any) => m.score > 0.85);
  if (candidates.length === 0) return;

  const candidateIds = candidates.map((c: any) => c.id);

  const conditions: any[] = [
    sql`${memories.id} IN (${sql.join(candidateIds.map((id: string) => sql`${id}`), sql`, `)})`,
    eq(memories.isActive, true),
  ];

  if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
    conditions.push(eq(memories.projectKey, projectKey));
  } else {
    conditions.push(eq(memories.userId, userId));
    if (projectKey) {
      conditions.push(sql`(${memories.projectKey} = ${projectKey} OR ${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`);
    } else {
      conditions.push(sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`);
    }
  }

  const rows = await db.select().from(memories).where(and(...conditions)).all();
  if (rows.length === 0) return;

  const decryptedCandidates: Array<{ id: string; ephemeralFact: EphemeralPlaintext }> = [];
  try {
    const vaultId = (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) ? projectKey : userId;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

    for (const r of rows) {
      const eph = await decryptEphemeral(r.fact, vaultKey);
      decryptedCandidates.push({ id: r.id, ephemeralFact: eph });
    }

    const prompt = `You are an AI assistant that detects contradictions or conflicts between a new memory and a list of existing memories.
A contradiction/conflict occurs when the new memory makes the existing memory outdated, invalid, or directly contradicts it.

New Memory: "${newFact}"

Existing Memories:
${decryptedCandidates.map((c) => `[${c.id}] "${c.ephemeralFact.get()}"`).join("\n")}

Identify which existing memories are contradicted or superseded by the new memory.
Respond with ONLY a JSON array of the IDs of the contradicted memories. If none are contradicted, return an empty array [].
Do not include markdown code fences or conversational text. Just the raw JSON array of strings.`;

    const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { prompt, max_tokens: 256 });
    const text = extractText(result).trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const contradictedIds = JSON.parse(match[0]) as string[];
      if (contradictedIds.length > 0) {
        const validIdsToArchive = contradictedIds.filter((id) => decryptedCandidates.some((c) => c.id === id));
        if (validIdsToArchive.length > 0) {
          console.log("[contradiction] Enqueuing contradicted memories for review:", validIdsToArchive);
          const toArchiveRows = rows.filter((r: any) => validIdsToArchive.includes(r.id));

          for (const row of toArchiveRows) {
            const dec = decryptedCandidates.find((c) => c.id === row.id);
            const decryptedFact = dec ? dec.ephemeralFact.get() : "";
            const { scopeType: rowScopeType, scopeId: rowScopeId } = parseScope(row.projectKey);

            let orgId: string | null = null;
            if (rowScopeType === "organization") {
              orgId = rowScopeId;
            } else if (rowScopeType === "team" && rowScopeId) {
              const teamRows = await db.select({ orgId: teams.orgId }).from(teams).where(eq(teams.id, rowScopeId)).limit(1).all();
              orgId = teamRows[0]?.orgId ?? null;
            }

            await db.insert(memoryRecommendations).values({
              id: crypto.randomUUID(),
              orgId,
              userId,
              fact: decryptedFact,
              category: row.category,
              tags: row.tags,
              projectKey: row.projectKey,
              scopeType: rowScopeType,
              scopeId: rowScopeId,
              recommendationType: "archive",
              targetMemoryId: row.id,
              status: "pending",
              reviewNotes: `Superseded by new memory: "${newFact}"`,
              createdAt: Date.now(),
            }).run();

            if (rowScopeType === "personal") {
              await db.insert(notifications).values({
                id: crypto.randomUUID(), userId,
                title: "Memory Conflict Review",
                message: `A new memory conflicts with an existing one. Review required.`,
                type: "contradiction_detected", status: "unread", linkUrl: `/memories`, createdAt: Date.now(),
              }).run();
            } else if (orgId) {
              const admins = await db
                .select({ userId: organizationMembers.userId })
                .from(organizationMembers)
                .where(and(eq(organizationMembers.orgId, orgId), sql`${organizationMembers.role} IN ('admin', 'owner')`))
                .all();
              for (const admin of admins) {
                await db.insert(notifications).values({
                  id: crypto.randomUUID(), userId: admin.userId,
                  title: "Conflict Review Required",
                  message: `A memory update conflicts with an existing vault entry. Review required.`,
                  type: "contradiction_detected", status: "unread", linkUrl: `/organization?tab=recommendations`, createdAt: Date.now(),
                }).run();
              }
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("[archiveContradictingMemories] failed:", err);
  } finally {
    for (const c of decryptedCandidates) c.ephemeralFact.drop();
  }
}

// ── Submit Memory Recommendation ──────────────────────────────────────────────

const zProjectKeyFn = z
  .string()
  .max(128)
  .refine(
    (v) => v === "" || v === "personal" || /^org:[0-9a-f-]{36}$/.test(v) || /^team:[0-9a-f-]{36}$/.test(v),
    { message: "projectKey must be empty, 'personal', 'org:<uuid>', or 'team:<uuid>'" }
  )
  .optional();

const SubmitRecommendationSchema = z.object({
  orgId: z.string().uuid("orgId must be a valid UUID"),
  fact: z.string().min(1, "fact is required").max(10000).transform((s) => s.trim()),
  category: z.enum(["rules", "projects", "references"]),
  tags: z.string().max(500).default("").transform((s) => s.trim()),
  projectKey: zProjectKeyFn,
}).strict();

export const submitMemoryRecommendation = createServerFn({ method: "POST" })
  .inputValidator((data) => SubmitRecommendationSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean; id: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const memberRow = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, user.id)))
      .limit(1)
      .all();
    if (memberRow.length === 0) throw new Error("Forbidden: User is not a member of this organization.");

    const recId = crypto.randomUUID();
    const timestamp = Date.now();

    const sanitizedFact = sanitizeMemory(data.fact);
    if (!sanitizedFact) throw new Error("Invalid memory recommendation: content was empty or contained adversarial instructions");

    await db.insert(memoryRecommendations).values({
      id: recId, orgId: data.orgId, userId: user.id, fact: sanitizedFact,
      category: data.category, tags: data.tags, projectKey: data.projectKey || `org:${data.orgId}`,
      status: "pending", createdAt: timestamp,
    });

    const admins = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), sql`${organizationMembers.role} IN ('admin', 'owner')`))
      .all();

    const submitterName = user.name || user.email || "A team member";
    for (const admin of admins) {
      await db.insert(notifications).values({
        id: crypto.randomUUID(), userId: admin.userId,
        title: "New Memory Recommendation",
        message: `${submitterName} recommended a new memory for the organization vault.`,
        type: "recommendation_submitted", status: "unread", linkUrl: `/organization?tab=reviews`, createdAt: timestamp,
      });
    }

    return { success: true, id: recId };
  });

// ── List Memory Recommendations ───────────────────────────────────────────────

const OrgIdSchema = z.object({ orgId: z.string().uuid("orgId must be a valid UUID") }).strict();

export const listMemoryRecommendations = createServerFn({ method: "POST" })
  .inputValidator((data) => OrgIdSchema.parse(data))
  .handler(async ({ data, context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const memberRow = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, user.id)))
      .limit(1)
      .all();
    if (memberRow.length === 0) throw new Error("Forbidden");

    const role = memberRow[0].role;
    if (role !== "owner" && role !== "admin") {
      return db.select().from(memoryRecommendations)
        .where(and(eq(memoryRecommendations.orgId, data.orgId), eq(memoryRecommendations.userId, user.id)))
        .orderBy(desc(memoryRecommendations.createdAt)).all();
    }

    return db.select().from(memoryRecommendations)
      .where(eq(memoryRecommendations.orgId, data.orgId))
      .orderBy(desc(memoryRecommendations.createdAt)).all();
  });

// ── Review Memory Recommendation ──────────────────────────────────────────────

const ReviewRecommendationSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  reviewNotes: z.string().max(1000).optional().transform((s) => s?.trim()),
}).strict();

export const reviewMemoryRecommendation = createServerFn({ method: "POST" })
  .inputValidator((data) => ReviewRecommendationSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const recs = await db.select().from(memoryRecommendations).where(eq(memoryRecommendations.id, data.id)).all();
    if (recs.length === 0) throw new Error("Recommendation not found");
    const rec = recs[0];

    let orgId = rec.orgId;
    if (!orgId && rec.scopeType === "team" && rec.scopeId) {
      const teamRows = await db.select({ orgId: teams.orgId }).from(teams).where(eq(teams.id, rec.scopeId)).limit(1).all();
      orgId = teamRows[0]?.orgId ?? null;
    }

    if (rec.scopeType === "personal") {
      if (rec.userId !== user.id) throw new Error("Forbidden: You can only review your own personal recommendations.");
    } else {
      if (!orgId) throw new Error("Forbidden: Recommendation does not have a valid organization ID.");
      const reviewerMember = await db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, user.id)))
        .limit(1).all();
      const reviewerRole = reviewerMember[0]?.role;
      if (reviewerRole !== "owner" && reviewerRole !== "admin") {
        throw new Error("Forbidden: Only organization owners/admins can review recommendations.");
      }
    }

    const timestamp = Date.now();

    if (data.action === "approve") {
      if (rec.recommendationType === "delete") {
        if (!rec.targetMemoryId) throw new Error("Invalid recommendation: targetMemoryId is required for deletion.");
        const targets = await db.select().from(memories).where(eq(memories.id, rec.targetMemoryId)).all();
        if (targets.length === 0) {
          await db.update(memoryRecommendations).set({ status: "approved", reviewedBy: user.id, reviewedAt: timestamp, reviewNotes: data.reviewNotes }).where(eq(memoryRecommendations.id, data.id));
          return { success: true };
        }
        await db.delete(memories).where(eq(memories.id, rec.targetMemoryId));
        try { await env.VECTOR_INDEX.deleteByIds([rec.targetMemoryId]); } catch (e) { console.error("[reviewMemoryRecommendation] vector delete failed:", e); }
        await db.update(memoryRecommendations).set({ status: "approved", reviewedBy: user.id, reviewedAt: timestamp, reviewNotes: data.reviewNotes }).where(eq(memoryRecommendations.id, data.id));
        const { logAudit } = await import("~/server/enterprise");
        await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "approve_agent_delete", memoryId: rec.targetMemoryId, metadata: { recId: rec.id, agentContext: rec.agentContext } });
        return { success: true };

      } else if (rec.recommendationType === "update") {
        if (!rec.targetMemoryId) throw new Error("Invalid recommendation: targetMemoryId is required for update.");
        const targets = await db.select().from(memories).where(eq(memories.id, rec.targetMemoryId)).all();
        if (targets.length === 0) throw new Error("Target memory not found — it may have been deleted.");
        const targetMem = targets[0];

        if (!rec.proposedFact) throw new Error("Invalid recommendation: proposedFact is missing.");

        const proposedCategory = (rec.proposedCategory as any) ?? targetMem.category;
        const proposedTags = rec.proposedTags ?? targetMem.tags;

        const vaultId = (targetMem.projectKey && (targetMem.projectKey.startsWith("team:") || targetMem.projectKey.startsWith("org:"))) ? targetMem.projectKey : targetMem.userId;
        const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
        const encryptedFact = await encryptFact(rec.proposedFact, vaultKey);
        const isQuarantined = containsSensitiveData(rec.proposedFact);

        await db.update(memories).set({ fact: encryptedFact, category: proposedCategory, tags: proposedTags, timestamp, isQuarantined }).where(eq(memories.id, rec.targetMemoryId));
        await db.insert(memoryVersions).values({ id: crypto.randomUUID(), memoryId: rec.targetMemoryId, fact: encryptedFact, category: proposedCategory, tags: proposedTags, changedBy: user.id, changeReason: "agent_update_approved", timestamp });

        try {
          await deleteChunkVectors(env.DB, env.VECTOR_INDEX, rec.targetMemoryId);
          await persistChunkedVectors(env.AI, env.DB, env.VECTOR_INDEX, rec.targetMemoryId, rec.proposedFact, { userId: targetMem.userId, category: proposedCategory, tags: proposedTags, projectKey: targetMem.projectKey ?? "", entityIds: "" } as Record<string, VectorizeVectorMetadata>);
        } catch (e) { console.error("[reviewMemoryRecommendation] vector upsert failed:", e); }

        await db.update(memoryRecommendations).set({ status: "approved", reviewedBy: user.id, reviewedAt: timestamp, reviewNotes: data.reviewNotes }).where(eq(memoryRecommendations.id, data.id));
        const { logAudit } = await import("~/server/enterprise");
        await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "approve_agent_update", memoryId: rec.targetMemoryId, metadata: { recId: rec.id, agentContext: rec.agentContext } });
        return { success: true };

      } else if (rec.recommendationType === "archive") {
        if (!rec.targetMemoryId) throw new Error("Invalid recommendation: targetMemoryId is required for archiving.");
        const targets = await db.select().from(memories).where(eq(memories.id, rec.targetMemoryId)).all();
        if (targets.length === 0) throw new Error("Target memory not found.");
        const targetMem = targets[0];

        await db.update(memories).set({ isActive: false }).where(eq(memories.id, rec.targetMemoryId)).run();
        await db.insert(memoryVersions).values({ id: crypto.randomUUID(), memoryId: rec.targetMemoryId, fact: targetMem.fact, category: targetMem.category, tags: targetMem.tags, changedBy: user.id, changeReason: "contradiction_approved", timestamp }).run();
        await db.update(memoryRecommendations).set({ status: "approved", reviewedBy: user.id, reviewedAt: timestamp, reviewNotes: data.reviewNotes }).where(eq(memoryRecommendations.id, data.id));
        await db.insert(notifications).values({ id: crypto.randomUUID(), userId: rec.userId, title: "Archive Approved!", message: `Your archive request has been approved. The old memory has been archived.`, type: "recommendation_actioned", status: "unread", createdAt: timestamp });
        const { logAudit } = await import("~/server/enterprise");
        await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "approve_archive_recommendation", memoryId: rec.targetMemoryId, metadata: { recId: rec.id } });

      } else {
        // Standard "add" recommendation flow
        const projectKey = rec.projectKey || (orgId ? `org:${orgId}` : "personal");
        const vaultId = (rec.scopeType === "team" || rec.scopeType === "organization") ? projectKey : rec.userId;
        const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
        const encryptedFact = await encryptFact(rec.fact, vaultKey);
        const memId = crypto.randomUUID();

        await db.insert(memories).values({
          id: memId, userId: rec.userId, fact: encryptedFact, category: rec.category, tags: rec.tags,
          timestamp, isActive: true, projectKey: rec.projectKey, scopeType: rec.scopeType, scopeId: rec.scopeId,
          isLocked: rec.scopeType !== "personal", authorityType: rec.scopeType !== "personal" ? "authoritative" : "contributed",
        });
        await db.insert(memoryVersions).values({ id: crypto.randomUUID(), memoryId: memId, fact: encryptedFact, category: rec.category, tags: rec.tags, changedBy: user.id, changeReason: "approved_recommendation", timestamp });

        await persistChunkedVectors(env.AI, env.DB, env.VECTOR_INDEX, memId, rec.fact, { userId: rec.userId, category: rec.category, tags: rec.tags, projectKey: projectKey === "personal" ? "" : projectKey, entityIds: "" } as Record<string, VectorizeVectorMetadata>);

        await db.update(memoryRecommendations).set({ status: "approved", reviewedBy: user.id, reviewedAt: timestamp, reviewNotes: data.reviewNotes }).where(eq(memoryRecommendations.id, data.id));
        await db.insert(notifications).values({ id: crypto.randomUUID(), userId: rec.userId, title: "Recommendation Approved!", message: `Your memory recommendation has been approved and added to the vault.`, type: "recommendation_actioned", status: "unread", createdAt: timestamp });

        const { logAudit } = await import("~/server/enterprise");
        await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "approve_recommendation", memoryId: memId, metadata: { recId: rec.id } });
      }

    } else {
      await db.update(memoryRecommendations).set({ status: "rejected", reviewedBy: user.id, reviewedAt: timestamp, reviewNotes: data.reviewNotes }).where(eq(memoryRecommendations.id, data.id));
      await db.insert(notifications).values({ id: crypto.randomUUID(), userId: rec.userId, title: "Recommendation Rejected", message: `Your memory recommendation has been rejected.`, type: "recommendation_actioned", status: "unread", createdAt: timestamp });
      const { logAudit } = await import("~/server/enterprise");
      await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "reject_recommendation", metadata: { recId: rec.id } });
    }

    return { success: true };
  });

// ── Notifications ─────────────────────────────────────────────────────────────

export const listNotifications = createServerFn({ method: "GET" })
  .handler(async ({ context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    return db.select().from(notifications).where(eq(notifications.userId, user.id)).orderBy(desc(notifications.createdAt)).limit(50).all();
  });

const MarkNotificationSchema = z.object({
  id: z.string().uuid().optional(),
  all: z.boolean().optional(),
}).strict();

export const markNotificationRead = createServerFn({ method: "POST" })
  .inputValidator((data) => MarkNotificationSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (data.all) {
      await db.update(notifications).set({ status: "read" }).where(and(eq(notifications.userId, user.id), eq(notifications.status, "unread")));
    } else if (data.id) {
      await db.update(notifications).set({ status: "read" }).where(and(eq(notifications.userId, user.id), eq(notifications.id, data.id)));
    }

    return { success: true };
  });

// ── Personal Recommendations / Conflicts ──────────────────────────────────────

export const listPersonalMemoryRecommendations = createServerFn({ method: "GET" })
  .handler(async ({ context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    return db.select().from(memoryRecommendations)
      .where(and(
        eq(memoryRecommendations.userId, user.id),
        eq(memoryRecommendations.status, "pending"),
        sql`(${memoryRecommendations.scopeType} = 'personal' OR ${memoryRecommendations.recommendationType} IN ('update', 'delete'))`
      ))
      .orderBy(desc(memoryRecommendations.createdAt)).all();
  });

export const getConflicts = createServerFn({ method: "GET" })
  .handler(async ({ context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    return db.select().from(memoryRecommendations)
      .where(and(
        eq(memoryRecommendations.userId, user.id),
        eq(memoryRecommendations.status, "pending"),
        sql`${memoryRecommendations.recommendationType} IN ('update', 'delete')`
      ))
      .orderBy(desc(memoryRecommendations.createdAt)).all();
  });
