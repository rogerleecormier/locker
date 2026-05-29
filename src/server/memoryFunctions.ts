import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq, sql, and } from "drizzle-orm";
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
  type Memory,
  type NewMemory,
} from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { encrypt, decrypt, isEncrypted, hashToken, deriveUserKey } from "./crypto";
import { requireSession, requireAdmin } from "./session";
import { verifyVaultAccess, checkQuota, logTokenUsage, logAudit } from "./enterprise";
import { checkMemoryLimit, checkApiTokenLimit, getUserEffectivePlan } from "./planGate";

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
async function encryptFact(fact: string, encKey: string): Promise<string> {
  return encrypt(fact, encKey);
}

// Decrypt a stored fact. If it's not encrypted (legacy plaintext), return as-is.
async function decryptFact(stored: string, encKey: string, fallbackKey?: string): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  try {
    return await decrypt(stored, encKey);
  } catch (err) {
    if (fallbackKey) {
      try {
        return await decrypt(stored, fallbackKey);
      } catch {
        // Fall back to original error
      }
    }
    throw err;
  }
}

// Decrypt all facts in a row array using derived vault keys.
async function decryptMemories(rows: Memory[], masterKey: string): Promise<Memory[]> {
  return Promise.all(
    rows.map(async (r) => {
      const vaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : r.userId;
      const vaultKey = await deriveUserKey(masterKey, vaultId);
      return { ...r, fact: await decryptFact(r.fact, vaultKey, masterKey) };
    })
  );
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

      let whereClause;
      if (data?.projectKey) {
        const { allowed: vaultAllowed } = await verifyVaultAccess(db, user.id, data.projectKey);
        if (!vaultAllowed) {
          throw new Error(`Forbidden: no access to vault scope '${data.projectKey}'`);
        }
        whereClause = eq(memories.projectKey, data.projectKey);
      } else {
        whereClause = and(eq(memories.userId, user.id), sql`${memories.projectKey} IS NULL`);
      }

      const rows = await db
        .select()
        .from(memories)
        .where(whereClause)
        .orderBy(desc(memories.timestamp))
        .all();
      return decryptMemories(rows, env.ENCRYPTION_KEY);
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

  const vaultId = (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) ? projectKey : userId;
  const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);

  const decryptedCandidates = await Promise.all(
    rows.map(async (r: any) => ({
      id: r.id,
      fact: await decryptFact(r.fact, vaultKey, env.ENCRYPTION_KEY),
    }))
  );

  const prompt = `You are an AI assistant that detects contradictions or conflicts between a new memory and a list of existing memories.
A contradiction/conflict occurs when the new memory makes the existing memory outdated, invalid, or directly contradicts it (e.g., a change in project stack, changed technical requirement, or updated preference).

New Memory: "${newFact}"

Existing Memories:
${decryptedCandidates.map((c) => `[${c.id}] "${c.fact}"`).join("\n")}

Identify which existing memories are contradicted or superseded by the new memory.
Respond with ONLY a JSON array of the IDs of the contradicted memories. If none are contradicted, return an empty array [].
Do not include markdown code fences or conversational text. Just the raw JSON array of strings.`;

  try {
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
          console.log("[contradiction] Archiving contradicted memories:", validIdsToArchive);
          
          const toArchiveRows = rows.filter((r: any) => validIdsToArchive.includes(r.id));
          
          await db
            .update(memories)
            .set({ isActive: false })
            .where(
              sql`${memories.id} IN (${sql.join(validIdsToArchive.map((id) => sql`${id}`), sql`, `)})`
            )
            .run();

          // Record new versions for archived memories
          for (const row of toArchiveRows) {
            await db.insert(memoryVersions).values({
              id: crypto.randomUUID(),
              memoryId: row.id,
              fact: row.fact, // already encrypted
              category: row.category,
              tags: row.tags,
              changedBy: "system",
              changeReason: "contradiction",
              timestamp: Date.now(),
            }).run();
          }
        }
      }
    }
  } catch (err) {
    console.error("[archiveContradictingMemories] failed:", err);
  }
}

type AddMemoryInput = {
  fact: string;
  category: "rules" | "projects" | "references";
  tags: string;
  projectKey?: string;
};

export const addMemory = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): AddMemoryInput => {
    const d = data as AddMemoryInput;
    if (!d.fact || typeof d.fact !== "string") throw new Error("fact is required");
    if (!["rules", "projects", "references"].includes(d.category))
      throw new Error("category must be rules, projects, or references");
    return {
      fact: d.fact.trim(),
      category: d.category,
      tags: typeof d.tags === "string" ? d.tags.trim() : "",
      projectKey: typeof d.projectKey === "string" ? d.projectKey.trim() : undefined,
    };
  })
  .handler(async ({ data, context }): Promise<Memory> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) {
      throw new Error("Unauthorized: userId is required for vector insert");
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, data.projectKey);
    if (!vaultAllowed) {
      throw new Error(`Forbidden: no access to vault scope '${data.projectKey}'`);
    }

    await checkMemoryLimit(db, user.id);

    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) {
      throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);
    }

    const id = crypto.randomUUID();
    const timestamp = Date.now();
    
    const vaultId = (data.projectKey && (data.projectKey.startsWith("team:") || data.projectKey.startsWith("org:"))) ? data.projectKey : user.id;
    const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encryptFact(data.fact, vaultKey);

    const embedding = await generateEmbedding(env.AI, data.fact);

    const tagsList = data.tags.split(",").map(t => t.trim()).filter(Boolean);
    if (!tagsList.includes("manual")) {
      tagsList.push("manual");
    }
    const finalTags = tagsList.join(", ");

    // Run semantic lookup and archive contradicted memories asynchronously via Queue
    try {
      await env.ARCHIVE_QUEUE.send({
        userId: user.id,
        newFact: data.fact,
        embedding,
        projectKey: data.projectKey || null,
      });
    } catch (err) {
      console.error("[addMemory] Failed to enqueue contradiction check:", err);
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
    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "commit_memory", memoryId: id, metadata: { category: data.category, projectKey: data.projectKey } });
    await logTokenUsage(db, "session", "commit", 0);

    return { ...newRow, fact: data.fact, tags: newRow.tags ?? "", isActive: true, projectKey: newRow.projectKey ?? null };
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

    const valid = items.filter((item) => {
      const f = item.fact;
      if (f.length === 0) return false;
      if (/^#+\s/.test(f)) return false;
      if (/^\*{1,2}[^*]+\*{1,2}:?\s*$/.test(f)) return false;
      if (/^evidence:/i.test(f)) return false;
      if (/^\d+\.\s+\*{0,2}[A-Z]/.test(f) && f.length < 60) return false;
      if (/^imported from:/i.test(f)) return false;
      return true;
    });
    if (valid.length === 0) return { imported: 0, skipped: 0 };

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
        // Decrypt facts using derived per-vault keys
        for (const r of rows) {
          const rVaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : r.userId;
          const rVaultKey = await deriveUserKey(env.ENCRYPTION_KEY, rVaultId);
          existingDbMemories.set(r.id, { ...r, fact: await decryptFact(r.fact, rVaultKey, env.ENCRYPTION_KEY) });
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
            await db.update(memories).set({ tags: newTags }).where(eq(memories.id, matchedDbId));
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
      const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);
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
      };
    }));

    const newRows = allRows.filter((r) => !r.isDupe);
    if (newRows.length === 0) return { imported: 0, skipped: allRows.length };

    const CHUNK_SIZE = 10;
    for (let i = 0; i < newRows.length; i += CHUNK_SIZE) {
      await db.insert(memories).values(
        newRows.slice(i, i + CHUNK_SIZE).map(({ id, userId, fact, category, tags, timestamp: ts, projectKey: pk }) => ({
          id, userId, fact, category, tags, timestamp: ts, isActive: true, projectKey: pk,
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
    await logTokenUsage(db, "session", "commit", 0, newRows.length);

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

    // Additional check: if personal memory, must be the owner
    if ((!existing.projectKey || existing.projectKey === "personal") && existing.userId !== user.id) {
      throw new Error("Unauthorized");
    }

    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) {
      throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);
    }

    const vaultId = (existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"))) ? existing.projectKey : user.id;
    const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encryptFact(data.fact, vaultKey);

    await db.update(memories)
      .set({ fact: encryptedFact, category: data.category, tags: data.tags })
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

    const embedding = await generateEmbedding(env.AI, data.fact);
    await env.VECTOR_INDEX.upsert([{
      id: data.id,
      values: embedding,
      metadata: { userId: user.id, category: data.category, tags: data.tags, projectKey: existing.projectKey ?? "" } as Record<string, VectorizeVectorMetadata>,
    }]);

    // Audit logging & usage tracking
    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "update_memory", memoryId: data.id, metadata: { category: data.category } });
    await logTokenUsage(db, "session", "commit", 0);

    const rows = await db.select().from(memories).where(eq(memories.id, data.id)).all();
    return { ...rows[0], fact: data.fact };
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

    const CHUNK = 10;
    for (let i = 0; i < data.ids.length; i += CHUNK) {
      const chunk = data.ids.slice(i, i + CHUNK);
      await db.delete(memories).where(
        sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)}) AND ${memories.userId} = ${user.id}`
      );
    }

    const VECTOR_CHUNK = 100;
    for (let i = 0; i < data.ids.length; i += VECTOR_CHUNK) {
      await env.VECTOR_INDEX.deleteByIds(data.ids.slice(i, i + VECTOR_CHUNK));
    }

    return { deleted: data.ids.length };
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

    const embedding = await generateEmbedding(env.AI, data.query);
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
      await logTokenUsage(db, "session", "recall", 0);
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
    const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);

    const idOrder = new Map(ids.map((id: string, i: number) => [id, i]));
    const sorted = rows.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
    const decrypted = await Promise.all(
      sorted.map(async (r) => ({ ...r, fact: await decryptFact(r.fact, vaultKey, env.ENCRYPTION_KEY) }))
    );

    // Audit logging & usage tracking
    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "recall_context", metadata: { query: data.query, projectKey: data.projectKey, matchCount: decrypted.length } });
    await logTokenUsage(db, "session", "recall", 0);

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
    const allMemories = await decryptMemories(encryptedRows, env.ENCRYPTION_KEY);
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

    let name = "";
    if (nameRow) {
      const fact = await decryptFact(nameRow.fact, env.ENCRYPTION_KEY);
      name = fact.replace(/^Name is\s+/i, "").trim();
    }

    let location = "";
    if (locRow) {
      const fact = await decryptFact(locRow.fact, env.ENCRYPTION_KEY);
      location = fact.replace(/^Location is\s+/i, "").trim();
    }

    return { name, location };
  }
);

export const getUserPlan = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ planId: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const { planId } = await getUserEffectivePlan(db, user.id);
    return { planId };
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

    if (data.name) {
      const fact = `Name is ${data.name}`;
      const encFact = await encryptFact(fact, env.ENCRYPTION_KEY);
      const embedding = await generateEmbedding(env.AI, fact);
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
      const encFact = await encryptFact(fact, env.ENCRYPTION_KEY);
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
  createdAt: number;
  lastUsedAt: number | null;
};

export const listApiTokens = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<ApiTokenPublic[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const rows = await db
      .select({ id: apiTokens.id, name: apiTokens.name, permissions: apiTokens.permissions, createdAt: apiTokens.createdAt, lastUsedAt: apiTokens.lastUsedAt })
      .from(apiTokens)
      .where(eq(apiTokens.userId, user.id))
      .all();
    return rows;
  }
);

export const createApiToken = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { name: string; permissions: number } => {
    const d = data as { name: string; permissions: number };
    if (!d.name || typeof d.name !== "string") throw new Error("name is required");
    const perms = typeof d.permissions === "number" ? d.permissions : 15;
    return { name: d.name.trim().slice(0, 64), permissions: perms & 15 }; // mask to valid bits
  })
  .handler(async ({ data, context }): Promise<{ token: string; id: string; name: string; permissions: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    await checkApiTokenLimit(db, user.id);

    const rawToken = `lkr_${crypto.randomUUID().replace(/-/g, "")}`;
    const tokenHash = await hashToken(rawToken);
    const id = crypto.randomUUID();

    await db.insert(apiTokens).values({
      id,
      userId: user.id,
      name: data.name,
      tokenHash,
      permissions: data.permissions,
      createdAt: Date.now(),
    });

    return { token: rawToken, id, name: data.name, permissions: data.permissions };
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

export const encryptAllMemories = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ encrypted: number; alreadyEncrypted: number; failed: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    await requireAdmin(env);
    const db = getDb(env);

    const rows = await db.select({ id: memories.id, fact: memories.fact, userId: memories.userId, projectKey: memories.projectKey }).from(memories).all();

    let encrypted = 0;
    let alreadyEncrypted = 0;
    let failed = 0;

    const CHUNK = 20;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async (row) => {
        try {
          const vaultId = (row.projectKey && (row.projectKey.startsWith("team:") || row.projectKey.startsWith("org:"))) ? row.projectKey : row.userId;
          const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);

          if (isEncrypted(row.fact)) {
            // Check if it's already encrypted with the derived key. If decrypting with derived key fails but decrypting with master key succeeds, re-encrypt it!
            try {
              await decrypt(row.fact, vaultKey);
              alreadyEncrypted++;
              return;
            } catch {
              // Try to decrypt with master key, then re-encrypt
              const decrypted = await decrypt(row.fact, env.ENCRYPTION_KEY);
              const reEncrypted = await encrypt(decrypted, vaultKey);
              await db.update(memories).set({ fact: reEncrypted }).where(eq(memories.id, row.id));
              encrypted++;
              return;
            }
          } else {
            // Plaintext fact
            const encFact = await encrypt(row.fact, vaultKey);
            await db.update(memories).set({ fact: encFact }).where(eq(memories.id, row.id));
            encrypted++;
          }
        } catch (err) {
          console.error(`[encryptAllMemories] failed for ${row.id}:`, err);
          failed++;
        }
      }));
    }

    return { encrypted, alreadyEncrypted, failed };
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
        // Decrypt facts in chunk using derived vault keys
        const decryptedFacts = await Promise.all(
          chunk.map(async (row) => {
            const vaultId = (row.projectKey && (row.projectKey.startsWith("team:") || row.projectKey.startsWith("org:"))) ? row.projectKey : row.userId;
            const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);
            return decryptFact(row.fact, vaultKey, env.ENCRYPTION_KEY);
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

    // Decrypt versions using derived vault keys
    const vaultId = (mem.projectKey && (mem.projectKey.startsWith("team:") || mem.projectKey.startsWith("org:"))) ? mem.projectKey : user.id;
    const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);

    return Promise.all(
      versions.map(async (v: any) => ({
        ...v,
        fact: await decryptFact(v.fact, vaultKey, env.ENCRYPTION_KEY),
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

    // Decrypt the version to generate a new embedding
    const vaultId = (mem.projectKey && (mem.projectKey.startsWith("team:") || mem.projectKey.startsWith("org:"))) ? mem.projectKey : user.id;
    const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);
    const decryptedFact = await decryptFact(ver.fact, vaultKey, env.ENCRYPTION_KEY);

    const embedding = await generateEmbedding(env.AI, decryptedFact);

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
    await logTokenUsage(db, "session", "commit", 0);

    return { success: true };
  });
