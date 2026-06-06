import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq, sql, and, isNull } from "drizzle-orm";
import {
  memories,
  apiTokens,
  memoryVersions,
  auditLogs,
  tokenUsages,
  orgQuotas,
  organizations,
  organizationMembers,
  teams,
  teamMembers,
  userPlans,
  memoryRecommendations,
  notifications,
  users,
  verifications,
  sessions,
  accounts,
  totpSecrets,
  credentials,
  type Memory,
  type NewMemory,
  memoryTemplates,
  type MemoryTemplate,
} from "~/db/schema";
import type { D1Database } from "@cloudflare/workers-types";
import type { CloudflareEnv } from "~/types/cloudflare";
import { encrypt, decrypt, isEncrypted, hashToken, getOrCreateVaultKey, deriveUserKey, decryptEphemeral, EphemeralPlaintext } from "./crypto";
import { requireSession, requireAdmin } from "./session";
import { verifyVaultAccess, checkQuota, logTokenUsage, logAudit, estimateEmbeddingTokens, parseScope } from "./enterprise";
import { checkMemoryLimit, checkApiTokenLimit, getUserEffectivePlan } from "./planGate";
import { sanitizeMemory } from "./sanitization";
import { maskSensitiveData, containsSensitiveData } from "./dlp";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-m3", { text: [text] });
  const r = result as { data?: number[][]; shape?: number[] };
  return r.data?.[0] ?? [];
}

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memories, apiTokens, userPlans, organizationMembers, orgQuotas } });
}

function normalizeCategory(raw: string | undefined): "rules" | "projects" | "references" {
  if (raw === "rules" || raw === "projects" || raw === "references") return raw;
  return "references";
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

// Encrypt a fact for storage. Embedding is always generated from plaintext.
async function encryptFact(fact: string, encKey: string | CryptoKey): Promise<string> {
  return encrypt(fact, encKey);
}

async function decryptFact(stored: string, encKey: string | CryptoKey): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  return decrypt(stored, encKey);
}

async function decryptMemories(rows: Memory[], db: D1Database, masterKey: string): Promise<Memory[]> {
  const ephemerals: EphemeralPlaintext[] = [];
  try {
    return await Promise.all(
      rows.map(async (r) => {
        const vaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : r.userId;
        const vaultKey = await getOrCreateVaultKey(db, masterKey, vaultId);
        if (isEncrypted(r.fact)) {
          const eph = await decryptEphemeral(r.fact, vaultKey);
          ephemerals.push(eph);
          return { ...r, fact: eph.get() };
        }
        return { ...r };
      })
    );
  } finally {
    for (const eph of ephemerals) {
      eph.drop();
    }
  }
}

async function classifyMemories(
  ai: Ai,
  facts: string[]
): Promise<Array<"rules" | "projects" | "references">> {
  if (facts.length === 0) return [];

  const CLASSIFY_BATCH = 20;
  const results: Array<"rules" | "projects" | "references"> = [];

  for (let i = 0; i < facts.length; i += CLASSIFY_BATCH) {
    const batch = facts.slice(i, i + CLASSIFY_BATCH);
    const numbered = batch.map((f, j) => `${j + 1}. ${f}`).join("\n");

    const prompt = `Classify each memory into exactly one category: rules, projects, or references.

RULES = behavioral directives, communication preferences, instructions for how AI should respond, things I always/never want done, tone/format requirements, academic standards I follow, constraints on AI behavior.
Examples: "Tell it like it is; don't sugar-coat responses", "Use a formal professional tone", "Challenge my thinking", "AI must not invent skills I don't possess", "APA 7th edition compliance required"

PROJECTS = active or recent work, specific tasks in progress, features being built, bugs being fixed, purchases being researched, ongoing personal initiatives with concrete next steps.
Examples: "Building a weekly status update automation in Claude", "Troubleshooting STATUS_ACCESS_VIOLATION crashes on Sager laptop", "Purchasing a 2018 Ford Explorer from Carvana", "Creating Student Learning Plans for homeschool scholarship"

REFERENCES = background facts about who I am: identity, location, family, career history, education, certifications, employers, interests, health, financial context, tools used, skills possessed.
Examples: "Lives in Auburndale Florida", "Works as a Technical Program Manager at Vertex Education", "Has five dependent children", "Holds CompTIA Network+ certification", "Weighs 355 lbs"

Respond with ONLY a JSON array of strings, one per numbered item, in order. No explanation.
Example for 3 items: ["rules","projects","references"]

Memories:
${numbered}`;

    const result = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      prompt,
      max_tokens: Math.max(64, batch.length * 16),
    });

    const text = extractText(result).trim();
    const match = text.match(/\[[\s\S]*?\]/);

    if (!match) {
      results.push(...batch.map(() => "references" as const));
      continue;
    }

    try {
      const parsed: unknown[] = JSON.parse(match[0]);
      results.push(...batch.map((_, j) => normalizeCategory(parsed[j] as string | undefined)));
    } catch {
      results.push(...batch.map(() => "references" as const));
    }
  }

  return results;
}

function parseFactsFromText(raw: string): Array<{ fact: string }> {
  const noisePatterns = [
    /^=+$/,
    /^-{3,}$/,
    /^#{1,3}\s/,
    /^evidence:/i,
    /^imported from:/i,
    /^generated:/i,
    /^memory export$/i,
    /^end of export$/i,
    /^\d+\.\s+[A-Z\s]+$/,
    /^[-=*]{4,}/,
    /^[A-Z\s]+ — MEMORY EXPORT/,
  ];

  return raw
    .split("\n")
    .map((line) => {
      let f = line
        .trim()
        .replace(/^\s*[-*•]\s+/, "")
        .replace(/^\[\d{4}-\d{2}-\d{2}\]\s*-?\s*/, "")
        .replace(/^\[unknown\]\s*-?\s*/i, "")
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
        .replace(/^Name:\s*/i, "")
        .replace(/^Location:\s*/i, "")
        .trim();
      return f;
    })
    .filter((f) => {
      if (f.length < 8) return false;
      if (noisePatterns.some((p) => p.test(f))) return false;
      return true;
    })
    .map((f) => ({ fact: f }));
}

async function getUserName(db: ReturnType<typeof getDb>, userId: string, encKey: string): Promise<string> {
  try {
    const rows = await db.select().from(memories).where(eq(memories.userId, userId)).all();
    const nameRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-name")
    );
    if (nameRow) {
      const fact = await decryptFact(nameRow.fact, encKey);
      return fact.replace(/^Name is\s+/i, "").trim();
    }
  } catch (err) {
    console.error("[getUserName] failed to fetch name:", err);
  }
  return "The user";
}

export const parseMemoriesWithAI = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { text: string } => {
    const d = data as { text: string };
    if (!d.text || typeof d.text !== "string") throw new Error("text is required");
    if (d.text.trim().length > 16000) throw new Error("Text exceeds the maximum length of 16,000 characters");
    return { text: d.text.trim() };
  })
  .handler(async ({ data, context }): Promise<Array<{ fact: string; category?: string; tags?: string }>> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const name = await getUserName(db, user.id, env.ENCRYPTION_KEY);

    const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        {
          role: "system",
          content: `You extract discrete memory facts from raw text. Output ONLY a JSON array of strings — one string per fact. No explanation, no markdown, no code fences. Just the raw JSON array.

Example: ["${name} lives in Florida","${name} is a PMP-certified project manager","${name} prefers concise answers"]

Rules:
- Strip all formatting: headers, bullets, dashes, date prefixes like [2025-01-01], bold markdown (**text**), evidence lines, "Imported from:" lines
- Each entry must be one clean self-contained sentence
- Rephrase all facts to refer to "${name}" in the third person. Do NOT use "you are", "you have", "the user is", "I", "my", or "me". For example, convert "You are a software engineer" to "${name} is a software engineer".
- Skip section headers, category labels, horizontal rules, and meta-commentary`,
        },
        {
          role: "user",
          content: data.text,
        },
      ],
      max_tokens: 4096,
    });

    const r = result as Record<string, unknown>;
    if (Array.isArray(r.response)) {
      const facts = (r.response as unknown[])
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((f) => f.length > 0);
      if (facts.length > 0) return facts.map((f) => ({ fact: f }));
    }

    const raw = extractText(result).trim();
    const stripped = raw.replace(/```[\w]*\n?/g, "").trim();
    const arrayMatch = stripped.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const facts = parsed
            .map((item: unknown) => {
              if (typeof item === "string") return item.trim();
              if (item && typeof item === "object") {
                const o = item as Record<string, unknown>;
                return (typeof o.fact === "string" ? o.fact : typeof o.text === "string" ? o.text : "").trim();
              }
              return "";
            })
            .filter((f) => f.length > 0);
          if (facts.length > 0) return facts.map((f) => ({ fact: f }));
        }
      } catch { /* fall through to line parser */ }
    }

    const facts = parseFactsFromText(raw);
    return facts.map((item) => ({ fact: item.fact }));
  });

export const getMemories = createServerFn({ method: "GET" })
  .inputValidator((data: unknown): { projectKey?: string } => {
    const d = data as { projectKey?: string };
    return { projectKey: d?.projectKey };
  })
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
        whereClause = and(eq(memories.userId, user.id), eq(memories.scopeType, "personal"));
      } else {
        whereClause = and(eq(memories.scopeType, scopeType), eq(memories.scopeId, scopeId!));
      }

      const rows = await db
        .select()
        .from(memories)
        .where(whereClause)
        .orderBy(desc(memories.timestamp))
        .all();
      return decryptMemories(rows, env.DB, env.ENCRYPTION_KEY);
    }
  );

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

    // Fetch Orgs
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

    // Fetch Teams
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
    if (projectKey) {
      filter.projectKey = { $in: [projectKey, ""] };
    }
  }

  const results = await env.VECTOR_INDEX.query(embedding, {
    topK: 10,
    filter,
    returnMetadata: "none",
  });

  if (!results.matches || results.matches.length === 0) return;

  const candidates = results.matches.filter((m) => m.score > 0.85);
  if (candidates.length === 0) return;

  const candidateIds = candidates.map((c) => c.id);

  const conditions = [
    sql`${memories.id} IN (${sql.join(candidateIds.map((id) => sql`${id}`), sql`, `)})`,
    eq(memories.isActive, true)
  ];

  if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
    conditions.push(eq(memories.projectKey, projectKey));
  } else {
    conditions.push(eq(memories.userId, userId));
    if (projectKey) {
      conditions.push(
        sql`(${memories.projectKey} = ${projectKey} OR ${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
      );
    } else {
      conditions.push(
        sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
      );
    }
  }

  const rows = await db
    .select()
    .from(memories)
    .where(and(...conditions))
    .all();

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
A contradiction/conflict occurs when the new memory makes the existing memory outdated, invalid, or directly contradicts it (e.g., a change in project stack, changed technical requirement, or updated preference).

New Memory: "${newFact}"

Existing Memories:
${decryptedCandidates.map((c) => `[${c.id}] "${c.ephemeralFact.get()}"`).join("\n")}

Identify which existing memories are contradicted or superseded by the new memory.
Respond with ONLY a JSON array of the IDs of the contradicted memories. If none are contradicted, return an empty array [].
Do not include markdown code fences or conversational text. Just the raw JSON array of strings.`;

    const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      prompt,
      max_tokens: 256,
    });
    const text = extractText(result).trim();
    const match = text.match(/\[[\s\S]*\]/);
    if (match) {
      const contradictedIds = JSON.parse(match[0]) as string[];
      if (contradictedIds.length > 0) {
        const validIdsToArchive = contradictedIds.filter((id) =>
          decryptedCandidates.some((c) => c.id === id)
        );
        if (validIdsToArchive.length > 0) {
          console.log("[contradiction] Enqueuing contradicted memories for review:", validIdsToArchive);
          
          const toArchiveRows = rows.filter((r: any) => validIdsToArchive.includes(r.id));
          
          // Reroute to Review Queue (memoryRecommendations) instead of silent archiving
          for (const row of toArchiveRows) {
            const dec = decryptedCandidates.find((c) => c.id === row.id);
            const decryptedFact = dec ? dec.ephemeralFact.get() : "";

            const { scopeType: rowScopeType, scopeId: rowScopeId } = parseScope(row.projectKey);

            let orgId: string | null = null;
            if (rowScopeType === "organization") {
              orgId = rowScopeId;
            } else if (rowScopeType === "team" && rowScopeId) {
              const teamRows = await db
                .select({ orgId: teams.orgId })
                .from(teams)
                .where(eq(teams.id, rowScopeId))
                .limit(1)
                .all();
              orgId = teamRows[0]?.orgId ?? null;
            }

            await db.insert(memoryRecommendations).values({
              id: crypto.randomUUID(),
              orgId: orgId, // Nullable for personal, populated for org/team
              userId: userId, // User who added the conflicting memory
              fact: decryptedFact, // Old contradicted memory fact
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

            // Create notification for conflict review
            if (rowScopeType === "personal") {
              await db.insert(notifications).values({
                id: crypto.randomUUID(),
                userId: userId,
                title: "Memory Conflict Review",
                message: `A new memory conflicts with an existing one. Review required.`,
                type: "contradiction_detected",
                status: "unread",
                linkUrl: `/memories`,
                createdAt: Date.now(),
              }).run();
            } else if (orgId) {
              const admins = await db
                .select({ userId: organizationMembers.userId })
                .from(organizationMembers)
                .where(and(
                  eq(organizationMembers.orgId, orgId),
                  sql`${organizationMembers.role} IN ('admin', 'owner')`
                ))
                .all();
              for (const admin of admins) {
                await db.insert(notifications).values({
                  id: crypto.randomUUID(),
                  userId: admin.userId,
                  title: "Conflict Review Required",
                  message: `A memory update conflicts with an existing vault entry. Review required.`,
                  type: "contradiction_detected",
                  status: "unread",
                  linkUrl: `/organization?tab=recommendations`,
                  createdAt: Date.now(),
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
    for (const c of decryptedCandidates) {
      c.ephemeralFact.drop();
    }
  }
}

type AddMemoryInput = {
  fact: string;
  category: "rules" | "projects" | "references";
  tags: string;
  projectKey?: string;
  isLocked?: boolean;
  authorityType?: "authoritative" | "contributed";
};

export const addMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): AddMemoryInput => {
    const d = data as AddMemoryInput;
    if (!d.fact || typeof d.fact !== "string") throw new Error("fact is required");
    if (!["rules", "projects", "references", "stack"].includes(d.category))
      throw new Error("category must be rules, projects, references, or stack");
    return {
      fact: d.fact.trim(),
      category: d.category,
      tags: typeof d.tags === "string" ? d.tags.trim() : "",
      projectKey: typeof d.projectKey === "string" ? d.projectKey.trim() : undefined,
      isLocked: typeof d.isLocked === "boolean" ? d.isLocked : undefined,
      authorityType: d.authorityType === "authoritative" || d.authorityType === "contributed" ? d.authorityType : undefined,
    };
  })
  .handler(async ({ data, context }): Promise<Memory> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required for vector insert");
    }

    const { scopeType, scopeId } = parseScope(data.projectKey);
    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, scopeType, scopeId);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${data.projectKey ?? "personal"}'`);
    }

    await checkMemoryLimit(db, user.id);

    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) {
      throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);
    }

    const sanitizedFact = sanitizeMemory(data.fact);
    if (!sanitizedFact) {
      throw new Error("Invalid memory fact: content was empty or contained adversarial instructions");
    }

    // DLP Quarantine Check: flag if sensitive data is detected, but keep raw fact.
    const isQuarantined = containsSensitiveData(sanitizedFact);

    const id = crypto.randomUUID();
    const timestamp = Date.now();

    const vaultId = (scopeType === "team" || scopeType === "organization") ? data.projectKey! : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encryptFact(sanitizedFact, vaultKey);

    const embedding = await generateEmbedding(env.AI, sanitizedFact);
    const tokensConsumed = estimateEmbeddingTokens(sanitizedFact);

    const tagsList = data.tags.split(",").map(t => t.trim()).filter(Boolean);
    if (!tagsList.includes("manual")) {
      tagsList.push("manual");
    }
    const finalTags = tagsList.join(", ");

    // Run semantic lookup and archive contradicted memories asynchronously via Queue
    try {
      await env.ARCHIVE_QUEUE.send({
        userId: user.id,
        newFact: sanitizedFact,
        embedding,
        projectKey: data.projectKey || null,
      });
    } catch (err) {
      console.error("[addMemory] Failed to enqueue contradiction check:", err);
    }

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

    await db.insert(memories).values(newRow);

    // Record Memory Version
    await db.insert(memoryVersions).values({
      id: crypto.randomUUID(),
      memoryId: id,
      fact: encryptedFact,
      category: data.category,
      tags: finalTags,
      changedBy: user.id,
      changeReason: "created",
      timestamp,
    });

    try {
      await env.VECTOR_INDEX.insert([
        {
          id,
          values: embedding,
          metadata: {
            userId: user.id,
            category: data.category,
            tags: finalTags,
            projectKey: data.projectKey ?? "",
          } as Record<string, VectorizeVectorMetadata>,
        },
      ]);
    } catch (err) {
      console.error(`[addMemory] vector insert failed:`, err);
    }

    // Audit Log & usage tracking
    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "commit_memory", memoryId: id, metadata: { category: data.category, projectKey: data.projectKey, quarantined: isQuarantined } });
    await logTokenUsage(db, "session", "commit", tokensConsumed);

    return { ...newRow, fact: sanitizedFact, tags: newRow.tags ?? "", isActive: true, projectKey: newRow.projectKey ?? null } as Memory;
  });

type BatchImportItem = { fact: string; category?: string; tags?: string; projectKey?: string };

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    mA += a[i] * a[i];
    mB += b[i] * b[i];
  }
  if (mA === 0 || mB === 0) return 0;
  return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
}

type BatchImportInput = {
  items: BatchImportItem[];
  source: string;
  projectKey?: string;
};

export const batchImportMemories = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): BatchImportInput => {
    const d = data as BatchImportInput;
    if (!Array.isArray(d.items)) throw new Error("items must be an array");
    const validatedItems = d.items.map((item) => ({
      fact: String(item.fact || "").trim(),
      category: item.category,
      tags: item.tags,
      projectKey: item.projectKey,
    }));
    return {
      items: validatedItems,
      source: typeof d.source === "string" ? d.source.trim().toLowerCase() : "manual",
      projectKey: d.projectKey,
    };
  })
  .handler(async ({ data, context }): Promise<{ imported: number; skipped: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const { items, source, projectKey } = data;

    if (!user.id) {
      throw new Error("Unauthorized: userId is required for vector operations");
    }

    // Vault Scoping Access Verification
    const distinctProjectKeys = Array.from(new Set([projectKey, ...items.map(item => item.projectKey)]))
      .filter((pk): pk is string => typeof pk === "string");
    if (distinctProjectKeys.length === 0) distinctProjectKeys.push("personal");

    let orgId: string | null = null;
    for (const pk of distinctProjectKeys) {
      const { allowed: vaultAllowed, orgId: pOrgId } = await verifyVaultAccess(db, user.id, pk);
      if (!vaultAllowed) {
        throw new Error(`Forbidden: no access to vault scope '${pk}'`);
      }
      if (pOrgId) orgId = pOrgId;
    }

    // Quota Verification
    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) {
      throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);
    }

    // Sanitize then check DLP (entropy-based + PII regex) for quarantine.
    const sanitizedItems = items.map((item) => {
      const sanitized = sanitizeMemory(item.fact);
      const isQuarantined = containsSensitiveData(sanitized);
      return {
        ...item,
        fact: sanitized,
        isQuarantined,
      };
    });

    const valid = sanitizedItems.filter((item) => {
      const f = item.fact;
      if (f.length === 0) return false;
      if (/^#+\s/.test(f)) return false;
      if (/^\*{1,2}[^*]+\*{1,2}:?\s*$/.test(f)) return false;
      if (/^evidence:/i.test(f)) return false;
      if (/^\d+\.\s+\*{0,2}[A-Z]/.test(f) && f.length < 60) return false;
      if (/^imported from:/i.test(f)) return false;
      return true;
    });
    if (valid.length === 0) return { imported: 0, skipped: items.length };

    const needsClassification = valid.map((item) =>
      item.category === "rules" || item.category === "projects" || item.category === "references"
        ? null
        : item.fact
    );
    const unclassifiedFacts = needsClassification.filter((f): f is string => f !== null);
    const classified = await classifyMemories(env.AI, unclassifiedFacts);

    let classifiedIdx = 0;
    const resolvedCategories = needsClassification.map((f) =>
      f === null ? null : classified[classifiedIdx++]
    );

    const embeddings = await Promise.all(
      valid.map((item) => generateEmbedding(env.AI, item.fact))
    );
    const totalTokensConsumed = valid.reduce((sum, item) => sum + estimateEmbeddingTokens(item.fact), 0);

    const DUPE_THRESHOLD = 0.98;
    const CANDIDATE_THRESHOLD = 0.80;

    const vectorizeMatches = await Promise.all(
      embeddings.map(async (vec, idx) => {
        try {
          const result = await env.VECTOR_INDEX.query(vec, {
            topK: 3,
            filter: { userId: user.id },
            returnMetadata: "none",
          });
          return result.matches ?? [];
        } catch (err) {
          console.error(`[batchImportMemories] Vectorize query failed for item ${idx}:`, err);
          return [];
        }
      })
    );

    const candidateIds = Array.from(
      new Set(
        vectorizeMatches
          .flat()
          .filter((m): m is VectorizeMatch => m !== null && m.score >= 0.92)
          .map((m) => m.id)
      )
    );

    const existingDbMemories = new Map<string, Memory>();
    if (candidateIds.length > 0) {
      const DB_CHUNK = 50;
      for (let i = 0; i < candidateIds.length; i += DB_CHUNK) {
        const chunk = candidateIds.slice(i, i + DB_CHUNK);
        const rows = await db
          .select()
          .from(memories)
          .where(sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)}) AND ${memories.userId} = ${user.id}`)
          .all();
        // Decrypt facts using envelope-encrypted vault keys (with legacy HKDF fallback)
        for (const r of rows) {
          const rVaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : r.userId;
          const rVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, rVaultId);
          existingDbMemories.set(r.id, { ...r, fact: await decryptFact(r.fact, rVaultKey) });
        }
      }
    }

    const dupeMapping: Record<string, string | null> = {};
    const candidatesToCheck: {
      tempId: string;
      fact: string;
      category: string;
      matchingCandidates: { id: string; fact: string; category: string }[];
    }[] = [];

    // Pre-filter duplicates using cosine similarity
    for (let i = 0; i < valid.length; i++) {
      const tempId = `new-${i}`;
      const fact = valid[i].fact;
      const category = resolvedCategories[i] ?? normalizeCategory(valid[i].category);
      const embedding = embeddings[i];

      let isDefiniteDupe = false;
      const matchingCandidates: { id: string; fact: string; category: string }[] = [];

      // 1. Check against prior new memories in this batch
      for (let j = 0; j < i; j++) {
        const priorTempId = `new-${j}`;
        if (dupeMapping[priorTempId]) continue; // Skip if prior was a duplicate

        const sim = cosineSimilarity(embedding, embeddings[j]);
        if (sim > 0.99) {
          isDefiniteDupe = true;
          dupeMapping[tempId] = dupeMapping[priorTempId] || priorTempId;
          break;
        } else if (sim > 0.92) {
          matchingCandidates.push({
            id: priorTempId,
            fact: valid[j].fact,
            category: resolvedCategories[j] ?? normalizeCategory(valid[j].category),
          });
        }
      }

      if (isDefiniteDupe) continue;

      // 2. Check against Vectorize query matches from the database
      const matches = vectorizeMatches[i] ?? [];
      for (const m of matches) {
        if (!existingDbMemories.has(m.id)) continue;
        const dbMem = existingDbMemories.get(m.id)!;

        if (m.score > 0.99) {
          isDefiniteDupe = true;
          dupeMapping[tempId] = m.id;
          break;
        } else if (m.score > 0.92) {
          matchingCandidates.push({
            id: m.id,
            fact: dbMem.fact,
            category: dbMem.category,
          });
        }
      }

      if (isDefiniteDupe) continue;

      // 3. Collect for LLM evaluation if similarity is between 0.92 and 0.99
      if (matchingCandidates.length > 0) {
        candidatesToCheck.push({
          tempId,
          fact,
          category,
          matchingCandidates,
        });
      } else {
        dupeMapping[tempId] = null;
      }
    }

    // Run LLM deduplication on potential duplicate pairs
    if (candidatesToCheck.length > 0) {
      try {
        const prompt = `You are a memory deduplication assistant. Your job is to check a list of new memories against potential duplicate candidates and identify if they are actual duplicates.

A new memory is a duplicate of a candidate if it expresses the exact same fact or semantic meaning (even if phrased differently, or if it is a subset of the candidate).

Please check the following potential duplicate pairs:

${candidatesToCheck
  .map(
    (c) => `New Memory: [${c.tempId}] (${c.category}) "${c.fact}"
Candidates to check against:
${c.matchingCandidates.map((m) => `  - [${m.id}] (${m.category}) "${m.fact}"`).join("\n")}`
  )
  .join("\n\n")}

Respond with ONLY a JSON object mapping each checked new memory's ID (e.g. "new-0") to:
- The ID of the candidate it duplicates (from the Candidates list), OR
- null if it is not a duplicate of any candidate.

Do not include any intro, markdown formatting, or code blocks. Just the raw JSON object.`;

        const llmResult = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          prompt,
          max_tokens: Math.max(128, candidatesToCheck.length * 48),
        });

        const rawText = extractText(llmResult).trim();
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
          const llmMappings = JSON.parse(match[0]) as Record<string, string | null>;
          for (const [key, val] of Object.entries(llmMappings)) {
            dupeMapping[key] = val;
          }
        }
      } catch (err) {
        console.error("[batchImportMemories] AI deduplication failed:", err);
      }
    }

    const dupeFlags: boolean[] = [];
    const hasValidMapping = Object.keys(dupeMapping).length > 0;

    for (let i = 0; i < valid.length; i++) {
      const tempId = `new-${i}`;
      let isDupe = false;
      let matchedDbId: string | null = null;

      if (hasValidMapping && dupeMapping[tempId] !== undefined) {
        const mappedVal = dupeMapping[tempId];
        if (mappedVal !== null && mappedVal !== undefined) {
          isDupe = true;
          if (!mappedVal.startsWith("new-")) {
            matchedDbId = mappedVal;
          }
        }
      }

      if (isDupe && matchedDbId) {
        const existing = existingDbMemories.get(matchedDbId);
        if (existing) {
          const tagsList = (existing.tags ?? "").split(",").map(t => t.trim()).filter(Boolean);
          if (!tagsList.includes(source)) {
            tagsList.push(source);
            const newTags = tagsList.join(", ");
            await db.update(memories).set({ tags: newTags, timestamp: Date.now() }).where(eq(memories.id, matchedDbId));
            try {
              await env.VECTOR_INDEX.upsert([
                {
                  id: matchedDbId,
                  values: embeddings[i],
                  metadata: { userId: user.id, category: existing.category, tags: newTags, projectKey: existing.projectKey ?? "" } as Record<string, VectorizeVectorMetadata>,
                },
              ]);
            } catch (err) {
              console.error(`[batchImportMemories] Vectorize upsert failed:`, err);
            }
          }
        }
      }

      dupeFlags.push(isDupe);
    }

    const timestamp = Date.now();
    const allRows = await Promise.all(valid.map(async (item, i) => {
      const tagsList = (item.tags ?? "").split(",").map(t => t.trim()).filter(Boolean);
      if (!tagsList.includes(source)) tagsList.push(source);
      const finalTags = tagsList.join(", ");

      const itemPk = item.projectKey || projectKey || null;
      const vaultId = itemPk && (itemPk.startsWith("team:") || itemPk.startsWith("org:")) ? itemPk : user.id;
      const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
      const encryptedFact = await encryptFact(item.fact, vaultKey);

      return {
        id: crypto.randomUUID(),
        userId: user.id,
        fact: encryptedFact,
        plaintextFact: item.fact,
        category: resolvedCategories[i] ?? normalizeCategory(item.category),
        tags: finalTags,
        timestamp,
        embedding: embeddings[i],
        isDupe: dupeFlags[i],
        projectKey: itemPk,
        isQuarantined: !!item.isQuarantined,
      };
    }));

    const newRows = allRows.filter((r) => !r.isDupe);
    if (newRows.length === 0) return { imported: 0, skipped: allRows.length };

    const CHUNK_SIZE = 10;
    for (let i = 0; i < newRows.length; i += CHUNK_SIZE) {
      await db.insert(memories).values(
        newRows.slice(i, i + CHUNK_SIZE).map(({ id, userId, fact, category, tags, timestamp: ts, projectKey: pk, isQuarantined }) => ({
          id, userId, fact, category, tags, timestamp: ts, isActive: true, projectKey: pk, isQuarantined,
        }))
      );
    }

    // Insert new memory versions for imported memories
    for (let i = 0; i < newRows.length; i += CHUNK_SIZE) {
      const chunk = newRows.slice(i, i + CHUNK_SIZE);
      await db.insert(memoryVersions).values(
        chunk.map((row) => ({
          id: crypto.randomUUID(),
          memoryId: row.id,
          fact: row.fact,
          category: row.category,
          tags: row.tags,
          changedBy: user.id,
          changeReason: "imported",
          timestamp: row.timestamp,
        }))
      );
    }

    const vectorBatch: VectorizeVector[] = newRows.map((row) => ({
      id: row.id,
      values: row.embedding,
      metadata: {
        userId: user.id,
        category: row.category,
        tags: row.tags ?? "",
        projectKey: row.projectKey ?? "",
      } as Record<string, VectorizeVectorMetadata>,
    }));

    const VECTOR_CHUNK = 100;
    for (let i = 0; i < vectorBatch.length; i += VECTOR_CHUNK) {
      const chunk = vectorBatch.slice(i, i + VECTOR_CHUNK);
      try {
        await env.VECTOR_INDEX.insert(chunk);
      } catch (err) {
        console.error(`[batchImportMemories] vector insert failed:`, err);
      }
    }

    // Audit logging & usage tracking
    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "import_memories", metadata: { count: newRows.length } });
    await logTokenUsage(db, "session", "commit", totalTokensConsumed, newRows.length);

    return { imported: newRows.length, skipped: allRows.length - newRows.length };
  });

export const deleteMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { id: string } => {
    const d = data as { id: string };
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    return { id: d.id };
  })
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

    // Additional check: if personal memory, must be the owner
    if ((!existing.projectKey || existing.projectKey === "personal") && existing.userId !== user.id) {
      throw new Error("Unauthorized");
    }

    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) {
      throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);
    }

    // Delete from DB and Vectorize
    await db.delete(memories).where(eq(memories.id, data.id));
    await env.VECTOR_INDEX.deleteByIds([data.id]);

    // Audit logging & usage tracking
    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "delete_memory", memoryId: data.id });
    await logTokenUsage(db, "session", "commit", 0);

    return { deleted: true };
  });

type UpdateMemoryInput = {
  id: string;
  fact: string;
  category: "rules" | "projects" | "references";
  tags: string;
};

export const updateMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): UpdateMemoryInput => {
    const d = data as UpdateMemoryInput;
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    if (!d.fact || typeof d.fact !== "string") throw new Error("fact is required");
    if (!["rules", "projects", "references"].includes(d.category)) throw new Error("invalid category");
    return { id: d.id, fact: d.fact.trim(), category: d.category, tags: typeof d.tags === "string" ? d.tags.trim() : "" };
  })
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

    // Additional check: if personal memory, must be the owner
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

    // DLP Quarantine Check: flag if sensitive data is detected, but keep raw fact.
    const isQuarantined = containsSensitiveData(sanitizedFact);

    const vaultId = (existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"))) ? existing.projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encryptFact(sanitizedFact, vaultKey);

    await db.update(memories)
      .set({ fact: encryptedFact, category: data.category, tags: data.tags, timestamp: Date.now(), isQuarantined })
      .where(eq(memories.id, data.id));

    // Record Memory Version
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

    const embedding = await generateEmbedding(env.AI, sanitizedFact);
    const tokensConsumed = estimateEmbeddingTokens(sanitizedFact);
    await env.VECTOR_INDEX.upsert([{
      id: data.id,
      values: embedding,
      metadata: { userId: user.id, category: data.category, tags: data.tags, projectKey: existing.projectKey ?? "" } as Record<string, VectorizeVectorMetadata>,
    }]);

    // Audit logging & usage tracking
    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "update_memory", memoryId: data.id, metadata: { category: data.category, quarantined: isQuarantined } });
    await logTokenUsage(db, "session", "commit", tokensConsumed);

    const rows = await db.select().from(memories).where(eq(memories.id, data.id)).all();
    return { ...rows[0], fact: sanitizedFact };
  });

type UnmaskMemoryInput = {
  id: string;
};

export const unmaskMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): UnmaskMemoryInput => {
    const d = data as UnmaskMemoryInput;
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    return { id: d.id };
  })
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

    // Audit log
    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "unmask_memory", memoryId: data.id });

    return { success: true };
  });

export const archiveMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { id: string } => {
    const d = data as { id: string };
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    return { id: d.id };
  })
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

export const getArchivedMemories = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { projectKey?: string; limit: number; offset: number } => {
    const d = data as { projectKey?: string; limit?: number; offset?: number };
    return {
      projectKey: typeof d?.projectKey === "string" ? d.projectKey : undefined,
      limit: typeof d?.limit === "number" ? d.limit : 50,
      offset: typeof d?.offset === "number" ? d.offset : 0,
    };
  })
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
  .inputValidator((data: unknown): { id: string } => {
    const d = data as { id: string };
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    return { id: d.id };
  })
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

    // Re-insert into Vectorize
    const vaultId = (memory.projectKey && (memory.projectKey.startsWith("team:") || memory.projectKey.startsWith("org:"))) ? memory.projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const decryptedFact = await decryptFact(memory.fact, vaultKey);
    const embedding = await generateEmbedding(env.AI, decryptedFact);
    await env.VECTOR_INDEX.upsert([{
      id: memory.id,
      values: embedding,
      metadata: { userId: memory.userId, projectKey: memory.projectKey || "" }
    }]);

    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "update_memory", memoryId: data.id, metadata: { restored: true } });

    return { restored: true };
  });

export const permanentlyDeleteArchivedMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { id: string } => {
    const d = data as { id: string };
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    return { id: d.id };
  })
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

export const moveMemories = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { ids: string[]; targetProjectKey: string } => {
    const d = data as { ids: string[]; targetProjectKey: string };
    if (!Array.isArray(d.ids) || d.ids.length === 0) throw new Error("ids must be a non-empty array");
    if (typeof d.targetProjectKey !== "string") throw new Error("targetProjectKey is required");
    return { ids: d.ids.filter((id) => typeof id === "string"), targetProjectKey: d.targetProjectKey.trim() };
  })
  .handler(async ({ data, context }): Promise<{ moved: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    // 1. Verify target vault access
    const { allowed: targetAllowed, orgId: targetOrgId } = await verifyVaultAccess(db, user.id, data.targetProjectKey);
    if (!targetAllowed) {
      throw new Error(`Forbidden: no access to target vault scope '${data.targetProjectKey}'`);
    }

    // 2. Fetch existing memories to move
    const rows = await db
      .select()
      .from(memories)
      .where(sql`${memories.id} IN (${sql.join(data.ids.map((id) => sql`${id}`), sql`, `)})`)
      .all();

    let movedCount = 0;

    for (const mem of rows) {
      // 3. Verify source vault access
      const { allowed: sourceAllowed } = await verifyVaultAccess(db, user.id, mem.projectKey);
      if (!sourceAllowed) continue;

      // If personal memory, verify ownership
      if ((!mem.projectKey || mem.projectKey === "personal") && mem.userId !== user.id) {
        continue;
      }

      // 4. Decrypt from source vault key
      const srcVaultId = (mem.projectKey && (mem.projectKey.startsWith("team:") || mem.projectKey.startsWith("org:"))) ? mem.projectKey : mem.userId;
      const srcVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, srcVaultId);
      const plaintextFact = await decryptFact(mem.fact, srcVaultKey);

      // 5. Encrypt for target vault key
      const targetVaultId = (data.targetProjectKey && (data.targetProjectKey.startsWith("team:") || data.targetProjectKey.startsWith("org:"))) ? data.targetProjectKey : user.id;
      const targetVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, targetVaultId);
      const encryptedFact = await encryptFact(plaintextFact, targetVaultKey);

      // 6. Generate embedding
      const embedding = await generateEmbedding(env.AI, plaintextFact);

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

      // 7. Update database
      await db.update(memories)
        .set({
          fact: encryptedFact,
          projectKey: data.targetProjectKey === "personal" ? null : data.targetProjectKey,
          scopeType,
          scopeId,
          timestamp: Date.now(),
        })
        .where(eq(memories.id, mem.id));

      // Record Memory Version
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

      // Update Vectorize index
      await env.VECTOR_INDEX.upsert([{
        id: mem.id,
        values: embedding,
        metadata: {
          userId: user.id,
          category: mem.category,
          tags: mem.tags,
          projectKey: data.targetProjectKey === "personal" ? "" : data.targetProjectKey,
        } as Record<string, VectorizeVectorMetadata>,
      }]);

      // Log audit
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

export const bulkDeleteMemories = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { ids: string[] } => {
    const d = data as { ids: string[] };
    if (!Array.isArray(d.ids) || d.ids.length === 0) throw new Error("ids must be a non-empty array");
    return { ids: d.ids.filter((id) => typeof id === "string") };
  })
  .handler(async ({ data, context }): Promise<{ deleted: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required");
    }

    // Fetch all memories to be deleted
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

    // Verify authorization for each memory
    const authorizedIds: string[] = [];
    for (const mem of memoriesToDelete) {
      const { allowed: vaultAllowed } = await verifyVaultAccess(db, user.id, mem.projectKey);
      if (!vaultAllowed) {
        continue;
      }

      // Additional check: if personal memory, must be the owner
      if ((!mem.projectKey || mem.projectKey === "personal") && mem.userId !== user.id) {
        continue;
      }

      // Check if memory is locked
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

    // Delete authorized memories
    const CHUNK = 10;
    for (let i = 0; i < authorizedIds.length; i += CHUNK) {
      const chunk = authorizedIds.slice(i, i + CHUNK);
      await db.delete(memories).where(
        sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`
      );
    }

    // Delete from Vectorize
    const VECTOR_CHUNK = 100;
    for (let i = 0; i < authorizedIds.length; i += VECTOR_CHUNK) {
      await env.VECTOR_INDEX.deleteByIds(authorizedIds.slice(i, i + VECTOR_CHUNK));
    }

    return { deleted: authorizedIds.length };
  });

export const recallContext = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { query: string; topK?: number; projectKey?: string; isActive?: boolean } => {
    const d = data as { query: string; topK?: number; projectKey?: string; isActive?: boolean };
    if (!d.query || typeof d.query !== "string") throw new Error("query is required");
    return {
      query: d.query.trim(),
      topK: d.topK ?? 5,
      projectKey: typeof d.projectKey === "string" ? d.projectKey.trim() : undefined,
      isActive: typeof d.isActive === "boolean" ? d.isActive : true,
    };
  })
  .handler(async ({ data, context }): Promise<Memory[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required for vector query");
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, data.projectKey);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${data.projectKey}'`);
    }

    const quotaCheck = await checkQuota(db, user.id, "session", "recall", orgId);
    if (!quotaCheck.allowed) {
      throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);
    }

    const queryTrimmed = data.query;
    const embedding = await generateEmbedding(env.AI, queryTrimmed);
    const tokensConsumed = estimateEmbeddingTokens(queryTrimmed);
    const topK = Math.min(20, data.topK ?? 5);

    const filter: Record<string, any> = {};
    if (data.projectKey && (data.projectKey.startsWith("team:") || data.projectKey.startsWith("org:"))) {
      filter.projectKey = data.projectKey;
    } else {
      filter.userId = user.id;
      if (data.projectKey) {
        filter.projectKey = { $in: [data.projectKey, ""] };
      }
    }

    const results = await env.VECTOR_INDEX.query(embedding, {
      topK,
      filter,
      returnMetadata: "none",
    });

    if (!results.matches || results.matches.length === 0) {
      await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "recall_context", metadata: { query: data.query, projectKey: data.projectKey, matchCount: 0 } });
      await logTokenUsage(db, "session", "recall", tokensConsumed);
      return [];
    }

    const ids = results.matches.map((m: VectorizeMatch) => m.id);
    const conditions = [
      sql`${memories.id} IN (${sql.join(ids.map((id: string) => sql`${id}`), sql`, `)})`
    ];

    if (data.isActive !== undefined) {
      conditions.push(eq(memories.isActive, data.isActive));
    }

    if (data.projectKey && (data.projectKey.startsWith("team:") || data.projectKey.startsWith("org:"))) {
      conditions.push(eq(memories.projectKey, data.projectKey));
    } else {
      conditions.push(eq(memories.userId, user.id));
      if (data.projectKey) {
        conditions.push(
          sql`(${memories.projectKey} = ${data.projectKey} OR ${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
        );
      } else {
        conditions.push(
          sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
        );
      }
    }

    const rows = await db
      .select()
      .from(memories)
      .where(and(...conditions))
      .all();

    const vaultId = (data.projectKey && (data.projectKey.startsWith("team:") || data.projectKey.startsWith("org:"))) ? data.projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

    const idOrder = new Map(ids.map((id: string, i: number) => [id, i]));
    const sorted = rows.sort((a, b) => {
      if (a.authorityType === "authoritative" && b.authorityType !== "authoritative") return -1;
      if (a.authorityType !== "authoritative" && b.authorityType === "authoritative") return 1;
      return (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999);
    });
    const decrypted = await Promise.all(
      sorted.map(async (r) => ({ ...r, fact: await decryptFact(r.fact, vaultKey) }))
    );

    // Audit logging & usage tracking
    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "recall_context", metadata: { query: data.query, projectKey: data.projectKey, matchCount: decrypted.length } });
    await logTokenUsage(db, "session", "recall", tokensConsumed);

    return decrypted;
  });

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

export type DuplicateGroup = {
  primary: Memory;
  duplicates: Memory[];
};

export const scanDatabaseDuplicates = createServerFn({ method: "POST" })
  .handler(async ({ context }): Promise<{ groups: DuplicateGroup[] }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required for vector query");
    }

    const encryptedRows = await db.select().from(memories).where(and(eq(memories.userId, user.id), eq(memories.isActive, true))).all();
    const allMemories = await decryptMemories(encryptedRows, env.DB, env.ENCRYPTION_KEY);
    if (allMemories.length <= 1) return { groups: [] };

    const embeddingsMap = new Map<string, number[]>();
    const CHUNK_SIZE = 10;
    for (let i = 0; i < allMemories.length; i += CHUNK_SIZE) {
      const chunk = allMemories.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (m) => {
          try {
            const vec = await generateEmbedding(env.AI, m.fact);
            embeddingsMap.set(m.id, vec);
          } catch (err) {
            console.error(`[scanDatabaseDuplicates] embedding failed for ${m.id}:`, err);
          }
        })
      );
    }

    const CANDIDATE_THRESHOLD = 0.82;
    const rawMatches = new Map<string, string[]>();
    const memoriesMap = new Map<string, Memory>(allMemories.map((m) => [m.id, m]));

    for (let i = 0; i < allMemories.length; i += CHUNK_SIZE) {
      const chunk = allMemories.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (m) => {
          const vec = embeddingsMap.get(m.id);
          if (!vec) return;
          try {
            const result = await env.VECTOR_INDEX.query(vec, {
              topK: 4,
              filter: { userId: user.id },
              returnMetadata: "none",
            });
            const similarIds = (result.matches ?? [])
              .filter((match) => match && match.id !== m.id && match.score >= CANDIDATE_THRESHOLD)
              .map((match) => match.id)
              .filter((id) => memoriesMap.has(id));
            if (similarIds.length > 0) rawMatches.set(m.id, similarIds);
          } catch (err) {
            console.error(`[scanDatabaseDuplicates] query failed for ${m.id}:`, err);
          }
        })
      );
    }

    const groupedIds = new Set<string>();
    const initialGroups: { primaryId: string; duplicateIds: string[] }[] = [];

    for (const m of allMemories) {
      if (groupedIds.has(m.id)) continue;
      const simIds = rawMatches.get(m.id) ?? [];
      const unassignedSimIds = simIds.filter((id) => !groupedIds.has(id));
      if (unassignedSimIds.length > 0) {
        groupedIds.add(m.id);
        unassignedSimIds.forEach((id) => groupedIds.add(id));
        initialGroups.push({ primaryId: m.id, duplicateIds: unassignedSimIds });
      }
    }

    if (initialGroups.length === 0) return { groups: [] };

    const verifiedGroups: DuplicateGroup[] = [];
    const LLM_BATCH_SIZE = 5;

    for (let i = 0; i < initialGroups.length; i += LLM_BATCH_SIZE) {
      const batch = initialGroups.slice(i, i + LLM_BATCH_SIZE);

      const prompt = `You are a database deduplication assistant. I will give you groups of memories that are vector-similar. For each group, determine which of the candidate memories are actual semantic duplicates of the primary memory.

A candidate memory is a duplicate if:
1. It expresses the exact same fact or semantic meaning as the primary memory (even if phrased differently, e.g. "lives in FL" vs "lives in Florida").
2. It expresses a fact that is a subset of or already fully covered by the primary memory.

Groups to analyze:
${batch.map((g, idx) => {
  const p = memoriesMap.get(g.primaryId);
  const candidates = g.duplicateIds.map((id) => memoriesMap.get(id)).filter(Boolean);
  return `Group ${idx + 1}:
- Primary: [${g.primaryId}] "${p?.fact}"
- Candidates:
${candidates.map((c) => `  * [${c?.id}] "${c?.fact}"`).join("\n")}`;
}).join("\n\n")}

Respond with ONLY a JSON array of objects, one per group, in this format:
[
  { "primaryId": "primary-memory-id", "verifiedDuplicateIds": ["duplicate-id-1"] }
]
Only include duplicate IDs that are actual semantic duplicates of the primary memory. If a group has no duplicates, verifiedDuplicateIds should be empty. Do not include markdown code fences or conversational intro/outro.`;

      try {
        const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
          prompt,
          max_tokens: Math.max(128, batch.length * 64),
        });
        const text = extractText(result).trim();
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { primaryId: string; verifiedDuplicateIds: string[] }[];
          for (const item of parsed) {
            const p = memoriesMap.get(item.primaryId);
            if (!p) continue;
            const dupes = (item.verifiedDuplicateIds ?? [])
              .map((id) => memoriesMap.get(id))
              .filter((c): c is Memory => c !== undefined);
            if (dupes.length > 0) verifiedGroups.push({ primary: p, duplicates: dupes });
          }
        }
      } catch (err) {
        console.error(`[scanDatabaseDuplicates] LLM verification failed for batch ${i}:`, err);
        for (const g of batch) {
          const p = memoriesMap.get(g.primaryId);
          if (!p) continue;
          const dupes: Memory[] = [];
          for (const id of g.duplicateIds) {
            const c = memoriesMap.get(id);
            if (!c) continue;
            const pVec = embeddingsMap.get(p.id);
            const cVec = embeddingsMap.get(c.id);
            if (pVec && cVec && cosineSimilarity(pVec, cVec) >= 0.98) dupes.push(c);
          }
          if (dupes.length > 0) verifiedGroups.push({ primary: p, duplicates: dupes });
        }
      }
    }

    return { groups: verifiedGroups };
  });

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

    // Derive the per-user vault key (envelope DEK) with legacy HKDF fallback
    const profileVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, user.id);

    let name = "";
    if (nameRow) {
      const fact = await decryptFact(nameRow.fact, profileVaultKey);
      name = fact.replace(/^Name is\s+/i, "").trim();
    }

    let location = "";
    if (locRow) {
      const fact = await decryptFact(locRow.fact, profileVaultKey);
      location = fact.replace(/^Location is\s+/i, "").trim();
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

export const saveProfile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { name: string; location: string } => {
    const d = data as { name: string; location: string };
    return { name: String(d.name || "").trim(), location: String(d.location || "").trim() };
  })
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

    // Use the per-user vault DEK for profile memories
    const saveProfileVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, user.id);

    if (data.name) {
      const fact = `Name is ${data.name}`;
      const encFact = await encryptFact(fact, saveProfileVaultKey);
      const embedding = await generateEmbedding(env.AI, fact);
      const tokensConsumed = estimateEmbeddingTokens(fact);
      if (nameRow) {
        await db.update(memories).set({ fact: encFact }).where(eq(memories.id, nameRow.id));
        await env.VECTOR_INDEX.upsert([{
          id: nameRow.id,
          values: embedding,
          metadata: { userId: user.id, category: "references", tags: "profile-name", projectKey: "" } as Record<string, VectorizeVectorMetadata>,
        }]);
      } else {
        const id = crypto.randomUUID();
        await db.insert(memories).values({ id, userId: user.id, fact: encFact, category: "references", tags: "profile-name", timestamp: Date.now(), isActive: true, projectKey: null });
        await env.VECTOR_INDEX.insert([{ id, values: embedding, metadata: { userId: user.id, category: "references", tags: "profile-name", projectKey: "" } as Record<string, VectorizeVectorMetadata> }]);
      }
    } else if (nameRow) {
      await db.delete(memories).where(eq(memories.id, nameRow.id));
      await env.VECTOR_INDEX.deleteByIds([nameRow.id]);
    }

    if (data.location) {
      const fact = `Location is ${data.location}`;
      const encFact = await encryptFact(fact, saveProfileVaultKey);
      const embedding = await generateEmbedding(env.AI, fact);
      if (locRow) {
        await db.update(memories).set({ fact: encFact }).where(eq(memories.id, locRow.id));
        await env.VECTOR_INDEX.upsert([{
          id: locRow.id,
          values: embedding,
          metadata: { userId: user.id, category: "references", tags: "profile-location", projectKey: "" } as Record<string, VectorizeVectorMetadata>,
        }]);
      } else {
        const id = crypto.randomUUID();
        await db.insert(memories).values({ id, userId: user.id, fact: encFact, category: "references", tags: "profile-location", timestamp: Date.now(), isActive: true, projectKey: null });
        await env.VECTOR_INDEX.insert([{ id, values: embedding, metadata: { userId: user.id, category: "references", tags: "profile-location", projectKey: "" } as Record<string, VectorizeVectorMetadata> }]);
      }
    } else if (locRow) {
      await db.delete(memories).where(eq(memories.id, locRow.id));
      await env.VECTOR_INDEX.deleteByIds([locRow.id]);
    }

    return { success: true };
  });

// ── API Token management ──────────────────────────────────────────────────────

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
 
const VALID_AGENT_CATEGORIES = ["rules", "projects", "references", "stack"] as const;

export const createApiToken = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): {
    name: string;
    permissions: number;
    scopeType: "personal" | "organization" | "team";
    scopeId?: string;
    scopes?: any;
    ttlDays: number;
    tokenType: "human" | "agent";
    agentContext?: string;
    allowedCategories?: string[];
    deniedCategories?: string[];
    allowCredentials?: boolean;
  } => {
    const d = data as any;
    if (!d.name || typeof d.name !== "string") throw new Error("name is required");
    const perms = typeof d.permissions === "number" ? d.permissions : 15;
    const scope = d.scopeType === "organization" || d.scopeType === "team" ? d.scopeType : "personal";
    const ttl = typeof d.ttlDays === "number" ? Math.max(1, d.ttlDays) : 365;
    const tokenType: "human" | "agent" = d.tokenType === "agent" ? "agent" : "human";

    if (tokenType === "agent") {
      if (!d.agentContext || typeof d.agentContext !== "string") throw new Error("agentContext is required for agent tokens");
    }

    const allowedCategories = Array.isArray(d.allowedCategories)
      ? d.allowedCategories.filter((c: unknown) => VALID_AGENT_CATEGORIES.includes(c as any))
      : [];
    const deniedCategories = Array.isArray(d.deniedCategories)
      ? d.deniedCategories.filter((c: unknown) => VALID_AGENT_CATEGORIES.includes(c as any))
      : [];

    return {
      name: d.name.trim().slice(0, 64),
      permissions: perms & 15,
      scopeType: scope,
      scopeId: d.scopeId,
      scopes: d.scopes,
      ttlDays: ttl,
      tokenType,
      agentContext: typeof d.agentContext === "string" ? d.agentContext.trim().slice(0, 128) : undefined,
      allowedCategories,
      deniedCategories,
      allowCredentials: !!d.allowCredentials,
    };
  })
  .handler(async ({ data, context }): Promise<{ token: string; id: string; name: string; permissions: number; scopeType: string; scopeId: string | null; scopes: string | null; expiresAt: number; tokenType: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    await checkApiTokenLimit(db, user.id);

    // New token format: lkr_<id-no-dashes>_<random-secret>
    // Embedding the row id lets us look up the row without a full-table scan while
    // still verifying the secret with PBKDF2.
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
          allowCredentials: data.allowCredentials ?? false,
        })
      : null;

    await db.insert(apiTokens).values({
      id,
      userId: user.id,
      name: data.name,
      tokenHash,
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
  .inputValidator((data: unknown): { id: string } => {
    const d = data as { id: string };
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    return { id: d.id };
  })
  .handler(async ({ data, context }): Promise<{ revoked: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    await db.delete(apiTokens).where(
      sql`${apiTokens.id} = ${data.id} AND ${apiTokens.userId} = ${user.id}`
    );
    return { revoked: true };
  });

export const updateApiTokenPermissions = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { id: string; permissions: number } => {
    const d = data as { id: string; permissions: number };
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    return { id: d.id, permissions: (d.permissions & 15) };
  })
  .handler(async ({ data, context }): Promise<{ updated: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    await db.update(apiTokens)
      .set({ permissions: data.permissions })
      .where(sql`${apiTokens.id} = ${data.id} AND ${apiTokens.userId} = ${user.id}`);
    return { updated: true };
  });

export const renewApiToken = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { id: string; ttlDays: number } => {
    const d = data as { id: string; ttlDays?: number };
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    const ttl = typeof d.ttlDays === "number" ? Math.max(1, d.ttlDays) : 30;
    return { id: d.id, ttlDays: ttl };
  })
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

export type MigrateV2Result = {
  memories: { migrated: number; skipped: number; failed: number };
  totp: { migrated: number; skipped: number; failed: number };
  credentials: { migrated: number; skipped: number; failed: number };
  tokens: { invalidated: number };
};

export const migrateToV2 = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<MigrateV2Result> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);

    const result: MigrateV2Result = {
      memories:    { migrated: 0, skipped: 0, failed: 0 },
      totp:        { migrated: 0, skipped: 0, failed: 0 },
      credentials: { migrated: 0, skipped: 0, failed: 0 },
      tokens:      { invalidated: 0 },
    };

    // ── 1. Memories ──────────────────────────────────────────────────────────
    const CHUNK = 20;
    const memRows = await db.select({ id: memories.id, fact: memories.fact, userId: memories.userId, projectKey: memories.projectKey }).from(memories).all();
    for (let i = 0; i < memRows.length; i += CHUNK) {
      await Promise.all(memRows.slice(i, i + CHUNK).map(async (row) => {
        try {
          const vaultId = (row.projectKey && (row.projectKey.startsWith("team:") || row.projectKey.startsWith("org:"))) ? row.projectKey : row.userId;
          const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
          const legacyKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);

          if (isEncrypted(row.fact)) {
            try {
              await decrypt(row.fact, vaultKey);
              result.memories.skipped++;
            } catch {
              // Encrypted under legacy HKDF — re-encrypt under DEK
              let plaintext: string;
              try {
                plaintext = await decrypt(row.fact, legacyKey);
              } catch {
                plaintext = await decrypt(row.fact, env.ENCRYPTION_KEY);
              }
              await db.update(memories).set({ fact: await encrypt(plaintext, vaultKey) }).where(eq(memories.id, row.id));
              result.memories.migrated++;
            }
          } else {
            await db.update(memories).set({ fact: await encrypt(row.fact, vaultKey) }).where(eq(memories.id, row.id));
            result.memories.migrated++;
          }
        } catch (err) {
          console.error(`[migrateToV2] memory ${row.id} failed:`, err);
          result.memories.failed++;
        }
      }));
    }

    // ── 2. TOTP secrets ──────────────────────────────────────────────────────
    const totpRows = await db.select({ id: totpSecrets.id, userId: totpSecrets.userId, secret: totpSecrets.secret }).from(totpSecrets).all();
    for (let i = 0; i < totpRows.length; i += CHUNK) {
      await Promise.all(totpRows.slice(i, i + CHUNK).map(async (row) => {
        try {
          const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, row.userId);
          const legacyKey = await deriveUserKey(env.ENCRYPTION_KEY, row.userId);

          if (isEncrypted(row.secret)) {
            try {
              await decrypt(row.secret, vaultKey);
              result.totp.skipped++;
            } catch {
              const plaintext = await decrypt(row.secret, legacyKey);
              await db.update(totpSecrets).set({ secret: await encrypt(plaintext, vaultKey) }).where(eq(totpSecrets.id, row.id));
              result.totp.migrated++;
            }
          } else {
            await db.update(totpSecrets).set({ secret: await encrypt(row.secret, vaultKey) }).where(eq(totpSecrets.id, row.id));
            result.totp.migrated++;
          }
        } catch (err) {
          console.error(`[migrateToV2] totp ${row.id} failed:`, err);
          result.totp.failed++;
        }
      }));
    }

    // ── 3. Credentials ───────────────────────────────────────────────────────
    const credRows = await db.select({ id: credentials.id, userId: credentials.userId, encryptedValue: credentials.encryptedValue }).from(credentials).all();
    for (let i = 0; i < credRows.length; i += CHUNK) {
      await Promise.all(credRows.slice(i, i + CHUNK).map(async (row) => {
        try {
          const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, row.userId);
          const legacyKey = await deriveUserKey(env.ENCRYPTION_KEY, row.userId);

          if (isEncrypted(row.encryptedValue)) {
            try {
              await decrypt(row.encryptedValue, vaultKey);
              result.credentials.skipped++;
            } catch {
              const plaintext = await decrypt(row.encryptedValue, legacyKey);
              await db.update(credentials).set({ encryptedValue: await encrypt(plaintext, vaultKey) }).where(eq(credentials.id, row.id));
              result.credentials.migrated++;
            }
          } else {
            await db.update(credentials).set({ encryptedValue: await encrypt(row.encryptedValue, vaultKey) }).where(eq(credentials.id, row.id));
            result.credentials.migrated++;
          }
        } catch (err) {
          console.error(`[migrateToV2] credential ${row.id} failed:`, err);
          result.credentials.failed++;
        }
      }));
    }

    // ── 4. API tokens — invalidate SHA-256 hashed tokens ─────────────────────
    // PBKDF2 hashes start with "pbkdf2$". SHA-256 hashes are 64-char hex with no prefix.
    // We cannot re-hash without the plaintext, so legacy tokens are deleted — users must regenerate.
    const legacyTokenRows = await db.select({ id: apiTokens.id, tokenHash: apiTokens.tokenHash })
      .from(apiTokens)
      .all();
    const legacyIds = legacyTokenRows
      .filter(t => !t.tokenHash.startsWith("pbkdf2$"))
      .map(t => t.id);
    for (const id of legacyIds) {
      await db.delete(apiTokens).where(eq(apiTokens.id, id));
      result.tokens.invalidated++;
    }

    return result;
  }
);

export const rebuildVectorizeIndex = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ processed: number; failed: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);

    // Fetch all memories from DB
    const allMemories = await db.select().from(memories).all();

    let processed = 0;
    let failed = 0;

    const CHUNK_SIZE = 10;
    for (let i = 0; i < allMemories.length; i += CHUNK_SIZE) {
      const chunk = allMemories.slice(i, i + CHUNK_SIZE);
      try {
        // Decrypt facts in chunk using envelope-encrypted vault keys (with legacy HKDF fallback)
        const decryptedFacts = await Promise.all(
          chunk.map(async (row) => {
            const vaultId = (row.projectKey && (row.projectKey.startsWith("team:") || row.projectKey.startsWith("org:"))) ? row.projectKey : row.userId;
            const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
            return decryptFact(row.fact, vaultKey);
          })
        );

        // Generate embeddings for decrypted facts
        const embeddings = await Promise.all(
          decryptedFacts.map(async (fact) => generateEmbedding(env.AI, fact))
        );

        // Prepare vectors for Vectorize V2 index
        const vectors: VectorizeVector[] = chunk.map((row, idx) => {
          if (!row.userId) {
            throw new Error(`Memory row ${row.id} does not have a userId`);
          }
          return {
            id: row.id,
            values: embeddings[idx],
            metadata: {
              userId: row.userId,
              category: row.category,
              tags: row.tags ?? "",
              projectKey: row.projectKey ?? "",
            } as Record<string, VectorizeVectorMetadata>,
          };
        });

        // Insert/Upsert vectors into Vectorize
        await env.VECTOR_INDEX.upsert(vectors);
        processed += chunk.length;
      } catch (err) {
        console.error(`[rebuildVectorizeIndex] failed chunk starting at index ${i}:`, err);
        failed += chunk.length;
      }
    }

    return { processed, failed };
  }
);

export const getMemoryTimeline = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { memoryId: string } => {
    const d = data as { memoryId: string };
    if (!d.memoryId || typeof d.memoryId !== "string") throw new Error("memoryId is required");
    return { memoryId: d.memoryId };
  })
  .handler(async ({ data, context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    // Fetch memory first to verify access
    const memRows = await db
      .select()
      .from(memories)
      .where(eq(memories.id, data.memoryId))
      .all();
    if (memRows.length === 0) {
      throw new Error("Memory not found or unauthorized");
    }
    const mem = memRows[0];

    const { allowed } = await verifyVaultAccess(db, user.id, mem.projectKey);
    if (!allowed) {
      throw new Error("Forbidden: no access to vault scope");
    }

    // Additional check: if personal memory, must be the owner
    if ((!mem.projectKey || mem.projectKey === "personal") && mem.userId !== user.id) {
      throw new Error("Unauthorized");
    }

    const versions = await db
      .select()
      .from(memoryVersions)
      .where(eq(memoryVersions.memoryId, data.memoryId))
      .orderBy(desc(memoryVersions.timestamp))
      .all();

    const vaultId = (mem.projectKey && (mem.projectKey.startsWith("team:") || mem.projectKey.startsWith("org:"))) ? mem.projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

    return Promise.all(
      versions.map(async (v: any) => ({
        ...v,
        fact: await decryptFact(v.fact, vaultKey),
      }))
    );
  });

export const getAuditLogs = createServerFn({ method: "GET" })
  .handler(async ({ context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);

    return db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.timestamp))
      .limit(100)
      .all();
  });

export const revertMemoryVersion = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { versionId: string } => {
    const d = data as { versionId: string };
    if (!d.versionId || typeof d.versionId !== "string") throw new Error("versionId is required");
    return { versionId: d.versionId };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const versionRows = await db
      .select()
      .from(memoryVersions)
      .where(eq(memoryVersions.id, data.versionId))
      .all();
    if (versionRows.length === 0) {
      throw new Error("Version not found");
    }
    const ver = versionRows[0];

    const memRows = await db
      .select()
      .from(memories)
      .where(eq(memories.id, ver.memoryId))
      .all();
    if (memRows.length === 0) {
      throw new Error("Memory not found or unauthorized");
    }
    const mem = memRows[0];

    const { allowed, orgId } = await verifyVaultAccess(db, user.id, mem.projectKey);
    if (!allowed) {
      throw new Error("Forbidden");
    }

    // Additional check: if personal memory, must be the owner
    if ((!mem.projectKey || mem.projectKey === "personal") && mem.userId !== user.id) {
      throw new Error("Unauthorized");
    }

    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) {
      throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);
    }

    const vaultId = (mem.projectKey && (mem.projectKey.startsWith("team:") || mem.projectKey.startsWith("org:"))) ? mem.projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const decryptedFact = await decryptFact(ver.fact, vaultKey);

    const embedding = await generateEmbedding(env.AI, decryptedFact);
    const tokensConsumed = estimateEmbeddingTokens(decryptedFact);

    // Update memory
    await db
      .update(memories)
      .set({
        fact: ver.fact,
        category: ver.category,
        tags: ver.tags,
        isActive: true, // Reverting also makes it active
      })
      .where(eq(memories.id, mem.id));

    // Record a new memory version for the revert action
    await db.insert(memoryVersions).values({
      id: crypto.randomUUID(),
      memoryId: mem.id,
      fact: ver.fact,
      category: ver.category,
      tags: ver.tags,
      changedBy: user.id,
      changeReason: `reverted to version from ${new Date(ver.timestamp).toLocaleString()}`,
      timestamp: Date.now(),
    });

    // Update vectorize
    await env.VECTOR_INDEX.upsert([{
      id: mem.id,
      values: embedding,
      metadata: { userId: user.id, category: ver.category, tags: ver.tags, projectKey: mem.projectKey ?? "" } as Record<string, VectorizeVectorMetadata>,
    }]);

    // Audit Log & usage
    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "revert_version", memoryId: mem.id, metadata: { versionId: data.versionId } });
    await logTokenUsage(db, "session", "commit", tokensConsumed);

    return { success: true };
  });

export const submitMemoryRecommendation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId: string; fact: string; category: "rules" | "projects" | "references"; tags: string; projectKey?: string } => {
    const d = data as { orgId: string; fact: string; category: "rules" | "projects" | "references"; tags: string; projectKey?: string };
    if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
    if (!d.fact || typeof d.fact !== "string") throw new Error("fact is required");
    if (!["rules", "projects", "references"].includes(d.category)) throw new Error("invalid category");
    return {
      orgId: d.orgId.trim(),
      fact: d.fact.trim(),
      category: d.category,
      tags: typeof d.tags === "string" ? d.tags.trim() : "",
      projectKey: d.projectKey,
    };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean; id: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    // 1. Verify user belongs to the organization
    const memberRow = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, user.id)))
      .limit(1)
      .all();
    if (memberRow.length === 0) {
      throw new Error("Forbidden: User is not a member of this organization.");
    }

    const recId = crypto.randomUUID();
    const timestamp = Date.now();

    const sanitizedFact = sanitizeMemory(data.fact);
    if (!sanitizedFact) {
      throw new Error("Invalid memory recommendation: content was empty or contained adversarial instructions");
    }

    // 2. Insert the recommendation
    await db.insert(memoryRecommendations).values({
      id: recId,
      orgId: data.orgId,
      userId: user.id,
      fact: sanitizedFact,
      category: data.category,
      tags: data.tags,
      projectKey: data.projectKey || `org:${data.orgId}`,
      status: "pending",
      createdAt: timestamp,
    });

    // 3. Create notifications for organization admins/owners
    const admins = await db
      .select({ userId: organizationMembers.userId })
      .from(organizationMembers)
      .where(and(
        eq(organizationMembers.orgId, data.orgId),
        sql`${organizationMembers.role} IN ('admin', 'owner')`
      ))
      .all();

    const submitterName = user.name || user.email || "A team member";

    for (const admin of admins) {
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: admin.userId,
        title: "New Memory Recommendation",
        message: `${submitterName} recommended a new memory for the organization vault.`,
        type: "recommendation_submitted",
        status: "unread",
        linkUrl: `/organization?tab=reviews`,
        createdAt: timestamp,
      });
    }

    return { success: true, id: recId };
  });

export const listMemoryRecommendations = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId: string } => {
    const d = data as { orgId: string };
    if (!d.orgId || typeof d.orgId !== "string") throw new Error("orgId is required");
    return { orgId: d.orgId.trim() };
  })
  .handler(async ({ data, context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    // Verify membership
    const memberRow = await db
      .select()
      .from(organizationMembers)
      .where(and(eq(organizationMembers.orgId, data.orgId), eq(organizationMembers.userId, user.id)))
      .limit(1)
      .all();
    if (memberRow.length === 0) {
      throw new Error("Forbidden");
    }

    const role = memberRow[0].role;
    let queryBuilder = db
      .select()
      .from(memoryRecommendations)
      .where(eq(memoryRecommendations.orgId, data.orgId));

    // If they aren't admin/owner, they can only see their own recommendations
    if (role !== "owner" && role !== "admin") {
      queryBuilder = db
        .select()
        .from(memoryRecommendations)
        .where(and(
          eq(memoryRecommendations.orgId, data.orgId),
          eq(memoryRecommendations.userId, user.id)
        ));
    }

    return queryBuilder.orderBy(desc(memoryRecommendations.createdAt)).all();
  });

export const reviewMemoryRecommendation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { id: string; action: "approve" | "reject"; reviewNotes?: string } => {
    const d = data as { id: string; action: "approve" | "reject"; reviewNotes?: string };
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    if (!["approve", "reject"].includes(d.action)) throw new Error("invalid action");
    return { id: d.id, action: d.action, reviewNotes: d.reviewNotes?.trim() };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    // 1. Fetch recommendation
    const recs = await db
      .select()
      .from(memoryRecommendations)
      .where(eq(memoryRecommendations.id, data.id))
      .all();
    if (recs.length === 0) {
      throw new Error("Recommendation not found");
    }
    const rec = recs[0];

    // 2. Resolve orgId (if team scoped) and verify reviewer authorization
    let orgId = rec.orgId;
    if (!orgId && rec.scopeType === "team" && rec.scopeId) {
      const teamRows = await db
        .select({ orgId: teams.orgId })
        .from(teams)
        .where(eq(teams.id, rec.scopeId))
        .limit(1)
        .all();
      orgId = teamRows[0]?.orgId ?? null;
    }

    if (rec.scopeType === "personal") {
      if (rec.userId !== user.id) {
        throw new Error("Forbidden: You can only review your own personal recommendations.");
      }
    } else {
      if (!orgId) {
        throw new Error("Forbidden: Recommendation does not have a valid organization ID.");
      }
      const reviewerMember = await db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, orgId), eq(organizationMembers.userId, user.id)))
        .limit(1)
        .all();
      const reviewerRole = reviewerMember[0]?.role;
      if (reviewerRole !== "owner" && reviewerRole !== "admin") {
        throw new Error("Forbidden: Only organization owners/admins can review recommendations.");
      }
    }

    const timestamp = Date.now();

    if (data.action === "approve") {
      if (rec.recommendationType === "archive") {
        if (!rec.targetMemoryId) {
          throw new Error("Invalid recommendation: targetMemoryId is required for archiving.");
        }
        const targets = await db
          .select()
          .from(memories)
          .where(eq(memories.id, rec.targetMemoryId))
          .all();
        if (targets.length === 0) {
          throw new Error("Target memory not found.");
        }
        const targetMem = targets[0];

        // Mark target memory as inactive
        await db
          .update(memories)
          .set({ isActive: false })
          .where(eq(memories.id, rec.targetMemoryId))
          .run();

        // Record new memory version for archiving
        await db.insert(memoryVersions).values({
          id: crypto.randomUUID(),
          memoryId: rec.targetMemoryId,
          fact: targetMem.fact,
          category: targetMem.category,
          tags: targetMem.tags,
          changedBy: user.id,
          changeReason: "contradiction_approved",
          timestamp,
        }).run();

        // Update recommendation status
        await db
          .update(memoryRecommendations)
          .set({
            status: "approved",
            reviewedBy: user.id,
            reviewedAt: timestamp,
            reviewNotes: data.reviewNotes,
          })
          .where(eq(memoryRecommendations.id, data.id));

        // Notify submitter/user
        await db.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: rec.userId,
          title: "Archive Approved!",
          message: `Your archive request has been approved. The old memory has been archived.`,
          type: "recommendation_actioned",
          status: "unread",
          createdAt: timestamp,
        });

        await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "approve_archive_recommendation", memoryId: rec.targetMemoryId, metadata: { recId: rec.id } });

      } else {
        // Standard "add" recommendation flow
        const projectKey = rec.projectKey || (orgId ? `org:${orgId}` : "personal");
        const vaultId = (rec.scopeType === "team" || rec.scopeType === "organization") ? projectKey : rec.userId;
        const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
        const encryptedFact = await encryptFact(rec.fact, vaultKey);

        const memId = crypto.randomUUID();

        await db.insert(memories).values({
          id: memId,
          userId: rec.userId,
          fact: encryptedFact,
          category: rec.category,
          tags: rec.tags,
          timestamp,
          isActive: true,
          projectKey: rec.projectKey,
          scopeType: rec.scopeType,
          scopeId: rec.scopeId,
          isLocked: rec.scopeType !== "personal",
          authorityType: rec.scopeType !== "personal" ? "authoritative" : "contributed",
        });

        // Record Memory Version
        await db.insert(memoryVersions).values({
          id: crypto.randomUUID(),
          memoryId: memId,
          fact: encryptedFact,
          category: rec.category,
          tags: rec.tags,
          changedBy: user.id,
          changeReason: "approved_recommendation",
          timestamp,
        });

        // Insert Vector Embedding
        const embedding = await generateEmbedding(env.AI, rec.fact);
        await env.VECTOR_INDEX.insert([{
          id: memId,
          values: embedding,
          metadata: {
            userId: rec.userId,
            category: rec.category,
            tags: rec.tags,
            projectKey: projectKey === "personal" ? "" : projectKey,
          } as Record<string, VectorizeVectorMetadata>,
        }]);

        // Update Recommendation Status
        await db
          .update(memoryRecommendations)
          .set({
            status: "approved",
            reviewedBy: user.id,
            reviewedAt: timestamp,
            reviewNotes: data.reviewNotes,
          })
          .where(eq(memoryRecommendations.id, data.id));

        // Notify Submitter
        await db.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: rec.userId,
          title: "Recommendation Approved!",
          message: `Your memory recommendation has been approved and added to the vault.`,
          type: "recommendation_actioned",
          status: "unread",
          createdAt: timestamp,
        });

        await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "approve_recommendation", memoryId: memId, metadata: { recId: rec.id } });
      }

    } else {
      // Reject Action
      await db
        .update(memoryRecommendations)
        .set({
          status: "rejected",
          reviewedBy: user.id,
          reviewedAt: timestamp,
          reviewNotes: data.reviewNotes,
        })
        .where(eq(memoryRecommendations.id, data.id));

      // Notify Submitter
      await db.insert(notifications).values({
        id: crypto.randomUUID(),
        userId: rec.userId,
        title: "Recommendation Rejected",
        message: `Your memory recommendation has been rejected.`,
        type: "recommendation_actioned",
        status: "unread",
        createdAt: timestamp,
      });

      await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "reject_recommendation", metadata: { recId: rec.id } });
    }

    return { success: true };
  });

export const listNotifications = createServerFn({ method: "GET" })
  .handler(async ({ context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    return db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50)
      .all();
  });

export const markNotificationRead = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { id?: string; all?: boolean } => {
    const d = data as { id?: string; all?: boolean };
    return { id: d.id, all: d.all };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (data.all) {
      await db
        .update(notifications)
        .set({ status: "read" })
        .where(and(eq(notifications.userId, user.id), eq(notifications.status, "unread")));
    } else if (data.id) {
      await db
        .update(notifications)
        .set({ status: "read" })
        .where(and(eq(notifications.userId, user.id), eq(notifications.id, data.id)));
    }

    return { success: true };
  });

export const sendPasswordResetEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { email: string } => {
    const d = data as { email: string };
    if (!d.email || typeof d.email !== "string") throw new Error("email is required");
    return { email: d.email.toLowerCase().trim() };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
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

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { token: string; password: string } => {
    const d = data as { token: string; password: string };
    if (!d.token || typeof d.token !== "string") throw new Error("token is required");
    if (!d.password || typeof d.password !== "string") throw new Error("password is required");
    if (d.password.length < 8) throw new Error("Password must be at least 8 characters");
    return { token: d.token, password: d.password };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
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

export const sendVerificationEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { userId: string; email: string } => {
    const d = data as { userId: string; email: string };
    if (!d.userId || typeof d.userId !== "string") throw new Error("userId is required");
    if (!d.email || typeof d.email !== "string") throw new Error("email is required");
    return { userId: d.userId, email: d.email };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
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

export const verifyEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { token: string } => {
    const d = data as { token: string };
    if (!d.token || typeof d.token !== "string") throw new Error("token is required");
    return { token: d.token };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
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

export const getPendingOrgInvitations = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { orgId: string } => {
    const d = data as { orgId: string };
    if (!d.orgId) throw new Error("orgId is required");
    return { orgId: d.orgId };
  })
  .handler(async ({ data, context }): Promise<Array<{ id: string; email: string; role: string; expiresAt: number; createdAt: number }>> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
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

// ── Session Management (SEC-13) ────────────────────────────────────────────

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

export const revokeSession = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { sessionId: string } => {
    const d = data as { sessionId: string };
    if (!d.sessionId || typeof d.sessionId !== "string") throw new Error("sessionId is required");
    return { sessionId: d.sessionId };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB, { schema: { sessions } });

    // Verify session belongs to user
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

// ── Audit Log Viewer (SEC-12) ──────────────────────────────────────────────

// Shared helper: enrich raw audit log rows with user name/email, token name, memory snippet
async function enrichAuditLogs(
  db: ReturnType<typeof drizzle>,
  logs: Array<{ userId: string; tokenId: string | null; memoryId: string | null; metadata: string | null; [key: string]: unknown }>
) {
  // Collect unique IDs to batch-fetch
  const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
  const tokenIds = [...new Set(logs.map((l) => l.tokenId).filter((t): t is string => !!t && t !== "session"))];
  const memoryIds = [...new Set(logs.map((l) => l.memoryId).filter((m): m is string => !!m))];

  const [userRows, tokenRows, memoryRows] = await Promise.all([
    userIds.length > 0
      ? db.select({ id: users.id, name: users.name, email: users.email }).from(users)
          .where(sql`${users.id} IN (${sql.join(userIds.map((uid) => sql`${uid}`), sql`, `)})`)
          .all()
      : Promise.resolve([] as { id: string; name: string; email: string }[]),
    tokenIds.length > 0
      ? db.select({ id: apiTokens.id, name: apiTokens.name }).from(apiTokens)
          .where(sql`${apiTokens.id} IN (${sql.join(tokenIds.map((tid) => sql`${tid}`), sql`, `)})`)
          .all()
      : Promise.resolve([] as { id: string; name: string }[]),
    memoryIds.length > 0
      ? db.select({ id: memories.id, fact: memories.fact }).from(memories)
          .where(sql`${memories.id} IN (${sql.join(memoryIds.map((mid) => sql`${mid}`), sql`, `)})`)
          .all()
      : Promise.resolve([] as { id: string; fact: string }[]),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const tokenMap = new Map(tokenRows.map((t) => [t.id, t.name]));
  const memoryMap = new Map(memoryRows.map((m) => [m.id, m.fact]));

  return logs.map((log) => {
    const userInfo = userMap.get(log.userId);
    const tokenName = log.tokenId && log.tokenId !== "session"
      ? (tokenMap.get(log.tokenId) ?? log.tokenId.slice(0, 8) + "…")
      : (log.tokenId === "session" ? "Session" : null);
    const rawFact = log.memoryId ? (memoryMap.get(log.memoryId) ?? null) : null;
    const memorySnippet = rawFact ? rawFact.slice(0, 100) + (rawFact.length > 100 ? "…" : "") : null;
    return {
      ...log,
      userName: userInfo?.name ?? null,
      userEmail: userInfo?.email ?? null,
      tokenName,
      memorySnippet,
    };
  });
}

export const getOrgAuditLogs = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): {
    limit?: number;
    offset?: number;
    memoryId?: string;
    action?: string;
    userId?: string;
    dateFrom?: number;
    dateTo?: number;
  } => {
    const d = data as any;
    return {
      limit: typeof d?.limit === "number" ? d.limit : undefined,
      offset: typeof d?.offset === "number" ? d.offset : undefined,
      memoryId: typeof d?.memoryId === "string" ? d.memoryId : undefined,
      action: typeof d?.action === "string" ? d.action : undefined,
      userId: typeof d?.userId === "string" ? d.userId : undefined,
      dateFrom: typeof d?.dateFrom === "number" ? d.dateFrom : undefined,
      dateTo: typeof d?.dateTo === "number" ? d.dateTo : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB);

    // ── Programmatic guard: user must be admin/owner of at least one org ────
    const orgMember = await db
      .select({ orgId: organizationMembers.orgId, role: organizationMembers.role })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id))
      .all();

    if (!orgMember.length) {
      throw new Response(JSON.stringify({ error: "No organization access" }), { status: 403 });
    }

    // Find all orgs where the user is admin/owner
    const adminOrgIds = orgMember
      .filter((m) => m.role === "admin" || m.role === "owner")
      .map((m) => m.orgId);

    if (!adminOrgIds.length) {
      throw new Response(JSON.stringify({ error: "Admin or owner access required" }), { status: 403 });
    }

    // Use the first (primary) admin org for scoping
    const orgId = adminOrgIds[0];

    const limit = Math.min(data.limit ?? 50, 100);
    const offset = data.offset ?? 0;

    // Build conditions — scoped to this org only
    const conditions: ReturnType<typeof eq>[] = [eq(auditLogs.orgId, orgId)];
    if (data.memoryId) conditions.push(eq(auditLogs.memoryId, data.memoryId));
    if (data.action) conditions.push(eq(auditLogs.action, data.action));
    if (data.userId) conditions.push(eq(auditLogs.userId, data.userId));
    if (data.dateFrom) conditions.push(sql`${auditLogs.timestamp} >= ${data.dateFrom}` as any);
    if (data.dateTo) conditions.push(sql`${auditLogs.timestamp} <= ${data.dateTo}` as any);

    const rawLogs = await db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .offset(offset)
      .all();

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(and(...conditions))
      .all();

    const enriched = await enrichAuditLogs(db, rawLogs as any);

    return {
      logs: enriched,
      total: countResult[0]?.count ?? 0,
      limit,
      offset,
    };
  });

export const exportAuditLogsCsv = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { action?: string; userId?: string } => {
    const d = data as { action?: string; userId?: string };
    return {
      action: typeof d?.action === "string" ? d.action : undefined,
      userId: typeof d?.userId === "string" ? d.userId : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB);

    // ── Programmatic guard: user must be admin/owner of an org ──────────────
    const orgMember = await db
      .select({ orgId: organizationMembers.orgId, role: organizationMembers.role })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, user.id))
      .all();

    if (!orgMember.length) {
      throw new Response(JSON.stringify({ error: "No organization access" }), { status: 403 });
    }
    const adminOrgEntry = orgMember.find((m) => m.role === "admin" || m.role === "owner");
    if (!adminOrgEntry) {
      throw new Response(JSON.stringify({ error: "Admin access required" }), { status: 403 });
    }
    const orgId = adminOrgEntry.orgId;

    const conditions: ReturnType<typeof eq>[] = [eq(auditLogs.orgId, orgId)];
    if (data.action) conditions.push(eq(auditLogs.action, data.action));
    if (data.userId) conditions.push(eq(auditLogs.userId, data.userId));

    // Fetch up to 5000 rows
    const rawLogs = await db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(desc(auditLogs.timestamp))
      .limit(5000)
      .all();

    // Enrich with human-readable fields
    const enriched = await enrichAuditLogs(db, rawLogs as any);

    // Build CSV with enriched columns
    const headers = [
      "Timestamp", "Action",
      "User Name", "User Email", "User ID",
      "Token Name", "Token ID",
      "Memory Snippet", "Memory ID",
      "IP Address", "User Agent", "Metadata",
    ];
    const rows = enriched.map((log: any) => [
      new Date(log.timestamp).toISOString(),
      log.action,
      log.userName || "",
      log.userEmail || "",
      log.userId,
      log.tokenName || "",
      log.tokenId || "",
      log.memorySnippet || "",
      log.memoryId || "",
      log.ipAddress || "",
      log.userAgent || "",
      log.metadata ? JSON.stringify(log.metadata) : "",
    ]);

    const csv = [
      headers.map((h) => `"${h}"`).join(","),
      ...rows.map((row: string[]) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    return { csv };
  });

// ── Site-Level Audit Log (site admin only) ─────────────────────────────────
export const getSiteAuditLogs = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): {
    limit?: number;
    offset?: number;
    action?: string;
    userId?: string;
    orgId?: string;
    dateFrom?: number;
    dateTo?: number;
  } => {
    const d = data as any;
    return {
      limit: typeof d?.limit === "number" ? d.limit : undefined,
      offset: typeof d?.offset === "number" ? d.offset : undefined,
      action: typeof d?.action === "string" ? d.action : undefined,
      userId: typeof d?.userId === "string" ? d.userId : undefined,
      orgId: typeof d?.orgId === "string" ? d.orgId : undefined,
      dateFrom: typeof d?.dateFrom === "number" ? d.dateFrom : undefined,
      dateTo: typeof d?.dateTo === "number" ? d.dateTo : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    // ── Hard server-side guard: ONLY the configured site admin ─────────────
    await requireAdmin(env);

    const db = drizzle(env.DB);
    const limit = Math.min(data.limit ?? 50, 100);
    const offset = data.offset ?? 0;

    // Build filter conditions across all orgs
    const conditions: any[] = [];
    if (data.orgId) conditions.push(eq(auditLogs.orgId, data.orgId));
    if (data.action) conditions.push(eq(auditLogs.action, data.action));
    if (data.userId) conditions.push(eq(auditLogs.userId, data.userId));
    if (data.dateFrom) conditions.push(sql`${auditLogs.timestamp} >= ${data.dateFrom}`);
    if (data.dateTo) conditions.push(sql`${auditLogs.timestamp} <= ${data.dateTo}`);

    const rawLogs = await db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .offset(offset)
      .all();

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .all();

    // Enrich logs and also resolve orgId -> org name
    const enriched = await enrichAuditLogs(db, rawLogs as any);

    // Collect unique orgIds for org name resolution
    const orgIds = [...new Set(rawLogs.map((l) => l.orgId).filter((o): o is string => !!o))];
    const orgRows = orgIds.length > 0
      ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations)
          .where(sql`${organizations.id} IN (${sql.join(orgIds.map((o) => sql`${o}`), sql`, `)})`)
          .all()
      : [];
    const orgNameMap = new Map(orgRows.map((o) => [o.id, o.name]));

    const logsWithOrg = (enriched as any[]).map((log) => ({
      ...log,
      orgName: log.orgId ? (orgNameMap.get(log.orgId) ?? log.orgId) : null,
    }));

    return {
      logs: logsWithOrg,
      total: countResult[0]?.count ?? 0,
      limit,
      offset,
    };
  });

export const exportSiteAuditLogsCsv = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { action?: string; userId?: string; orgId?: string } => {
    const d = data as any;
    return {
      action: typeof d?.action === "string" ? d.action : undefined,
      userId: typeof d?.userId === "string" ? d.userId : undefined,
      orgId: typeof d?.orgId === "string" ? d.orgId : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    // ── Hard server-side guard: ONLY the configured site admin ─────────────
    await requireAdmin(env);

    const db = drizzle(env.DB);
    const conditions: any[] = [];
    if (data.orgId) conditions.push(eq(auditLogs.orgId, data.orgId));
    if (data.action) conditions.push(eq(auditLogs.action, data.action));
    if (data.userId) conditions.push(eq(auditLogs.userId, data.userId));

    const rawLogs = await db
      .select()
      .from(auditLogs)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.timestamp))
      .limit(5000)
      .all();

    const enriched = await enrichAuditLogs(db, rawLogs as any);

    const orgIds = [...new Set(rawLogs.map((l) => l.orgId).filter((o): o is string => !!o))];
    const orgRows = orgIds.length > 0
      ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations)
          .where(sql`${organizations.id} IN (${sql.join(orgIds.map((o) => sql`${o}`), sql`, `)})`)
          .all()
      : [];
    const orgNameMap = new Map(orgRows.map((o) => [o.id, o.name]));

    const headers = [
      "Timestamp", "Action",
      "Org Name", "Org ID",
      "User Name", "User Email", "User ID",
      "Token Name", "Token ID",
      "Memory Snippet", "Memory ID",
      "IP Address", "User Agent", "Metadata",
    ];
    const rows = (enriched as any[]).map((log) => [
      new Date(log.timestamp).toISOString(),
      log.action,
      log.orgId ? (orgNameMap.get(log.orgId) ?? "") : "",
      log.orgId || "",
      log.userName || "",
      log.userEmail || "",
      log.userId,
      log.tokenName || "",
      log.tokenId || "",
      log.memorySnippet || "",
      log.memoryId || "",
      log.ipAddress || "",
      log.userAgent || "",
      log.metadata ? JSON.stringify(log.metadata) : "",
    ]);

    const csv = [
      headers.map((h) => `"${h}"`).join(","),
      ...rows.map((row: string[]) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    return { csv };
  });

export const analyzeProjectRequirements = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { description: string } => {
    const d = data as { description: string };
    if (!d.description || typeof d.description !== "string") {
      throw new Error("description is required");
    }
    return { description: d.description.trim() };
  })
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
    await requireSession(env); // Ensure authenticated

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

    // Default fallback
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

export const generateStackRecommendation = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): {
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
  } => {
    const d = data as any;
    return {
      language: String(d.language || ""),
      frontend: String(d.frontend || ""),
      hosting: String(d.hosting || ""),
      database: String(d.database || ""),
      storage: String(d.storage || ""),
      search: String(d.search || ""),
      vector: String(d.vector || ""),
      componentLibrary: String(d.componentLibrary || ""),
      orm: String(d.orm || ""),
      auth: String(d.auth || ""),
      styling: String(d.styling || ""),
      stateCache: String(d.stateCache || ""),
      bannedProviders: Array.isArray(d.bannedProviders) ? d.bannedProviders.map(String) : [],
    };
  })
  .handler(async ({ data, context }): Promise<{
    name: string;
    description: string;
    rules: string[];
  }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireSession(env); // Ensure authenticated

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
    
    // Fallback if parsing fails
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

export const listMemoryTemplates = createServerFn({ method: "GET" })
  .handler(async ({ context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireSession(env);
    const db = drizzle(env.DB);
    return db.select().from(memoryTemplates).all();
  });

export const createMemoryTemplate = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): {
    name: string;
    description: string;
    category: "stack" | "governance" | "devops" | "compliance" | "documentation";
    configPayload: string;
  } => {
    const d = data as any;
    if (!d.name || typeof d.name !== "string") throw new Error("name is required");
    if (!d.description || typeof d.description !== "string") throw new Error("description is required");
    if (!["stack", "governance", "devops", "compliance", "documentation"].includes(d.category)) {
      throw new Error("Invalid category");
    }
    if (!d.configPayload || typeof d.configPayload !== "string") throw new Error("configPayload is required");
    return {
      name: d.name.trim(),
      description: d.description.trim(),
      category: d.category,
      configPayload: d.configPayload,
    };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB);
    const id = crypto.randomUUID();
    const result = await db.insert(memoryTemplates).values({
      id,
      name: data.name,
      description: data.description,
      category: data.category,
      configPayload: data.configPayload,
      createdAt: Math.floor(Date.now() / 1000),
    }).returning();
    // Audit log: template created
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
  .inputValidator((data: unknown): {
    id: string;
    name: string;
    description: string;
    category: "stack" | "governance" | "devops" | "compliance" | "documentation";
    configPayload: string;
  } => {
    const d = data as any;
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    if (!d.name || typeof d.name !== "string") throw new Error("name is required");
    if (!d.description || typeof d.description !== "string") throw new Error("description is required");
    if (!["stack", "governance", "devops", "compliance", "documentation"].includes(d.category)) {
      throw new Error("Invalid category");
    }
    if (!d.configPayload || typeof d.configPayload !== "string") throw new Error("configPayload is required");
    return {
      id: d.id,
      name: d.name.trim(),
      description: d.description.trim(),
      category: d.category,
      configPayload: d.configPayload,
    };
  })
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
      })
      .where(eq(memoryTemplates.id, data.id))
      .returning();
    // Audit log: template updated
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
  .inputValidator((data: unknown): { id: string } => {
    const d = data as any;
    if (!d.id || typeof d.id !== "string") throw new Error("id is required");
    return { id: d.id };
  })
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB);
    await db.delete(memoryTemplates).where(eq(memoryTemplates.id, data.id)).run();
    // Audit log: template deleted
    await logAudit(db, {
      orgId: null,
      userId: user.id,
      tokenId: "session",
      action: "delete_template",
      metadata: { templateId: data.id },
    });
    return { success: true };
  });

export const setDeletionPasscode = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { passcode: string } => {
    const d = data as { passcode: string };
    if (!d.passcode || typeof d.passcode !== "string" || d.passcode.length < 4 || d.passcode.length > 32) {
      throw new Error("Passcode must be between 4 and 32 characters long");
    }
    return { passcode: d.passcode };
  })
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

export const listPersonalMemoryRecommendations = createServerFn({ method: "GET" })
  .handler(async ({ context }): Promise<any[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    return db
      .select()
      .from(memoryRecommendations)
      .where(and(
        eq(memoryRecommendations.userId, user.id),
        eq(memoryRecommendations.scopeType, "personal"),
        eq(memoryRecommendations.status, "pending")
      ))
      .orderBy(desc(memoryRecommendations.createdAt))
      .all();
  });
