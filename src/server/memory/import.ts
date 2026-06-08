import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, sql, and } from "drizzle-orm";
import {
  memories,
  memoryVersions,
  apiTokens,
  userPlans,
  organizationMembers,
  orgQuotas,
  users,
  type Memory,
  type NewMemory,
} from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { encrypt, decrypt, isEncrypted, getOrCreateVaultKey } from "~/server/crypto";
import { extractGraphEntities, persistGraphData } from "~/server/graphRag";
import { requireSession } from "~/server/session";
import { verifyVaultAccess, checkQuota, logTokenUsage, logAudit, estimateEmbeddingTokens, parseScope } from "~/server/enterprise";
import { checkMemoryLimit } from "~/server/planGate";
import { sanitizeMemory } from "~/server/sanitization";
import { containsSensitiveData } from "~/server/dlp";
import type { ImportComparisonItem, ComparisonStatus } from "~/types/importTypes";

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

async function decryptFact(stored: string, encKey: string | CryptoKey): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  return decrypt(stored, encKey);
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

function getVectorFilter(userId: string, projectKey: string | undefined): Record<string, any> {
  const filter: Record<string, any> = {};
  if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
    filter.projectKey = projectKey;
  } else {
    filter.userId = userId;
  }
  return filter;
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
Examples: "Tell it like it is; don't sugar-coat responses", "Use a formal professional tone", "Challenge my thinking"

PROJECTS = active or recent work, specific tasks in progress, features being built, bugs being fixed, purchases being researched, ongoing personal initiatives with concrete next steps.
Examples: "Building a weekly status update automation in Claude", "Troubleshooting STATUS_ACCESS_VIOLATION crashes on Sager laptop"

REFERENCES = background facts about who I am: identity, location, family, career history, education, certifications, employers, interests, health, financial context, tools used, skills possessed.
Examples: "Lives in Auburndale Florida", "Works as a Technical Program Manager at Vertex Education"

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

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0, mA = 0, mB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    mA += a[i] * a[i];
    mB += b[i] * b[i];
  }
  if (mA === 0 || mB === 0) return 0;
  return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
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
    .map((line) =>
      line
        .trim()
        .replace(/^\s*[-*•]\s+/, "")
        .replace(/^\[\d{4}-\d{2}-\d{2}\]\s*-?\s*/, "")
        .replace(/^\[unknown\]\s*-?\s*/i, "")
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
        .replace(/^Name:\s*/i, "")
        .replace(/^Location:\s*/i, "")
        .trim()
    )
    .filter((f) => {
      if (f.length < 8) return false;
      if (noisePatterns.some((p) => p.test(f))) return false;
      return true;
    })
    .map((f) => ({ fact: f }));
}

const zProjectKeyFn = z
  .string()
  .max(128)
  .refine(
    (v) => v === "" || v === "personal" || /^org:[0-9a-f-]{36}$/.test(v) || /^team:[0-9a-f-]{36}$/.test(v),
    { message: "projectKey must be empty, 'personal', 'org:<uuid>', or 'team:<uuid>'" }
  )
  .optional();

// ── Parse Memories With AI ───────────────────────────────────────────────────

const ParseMemoriesWithAISchema = z.object({
  text: z.string().min(1).max(100000).transform((s) => s.trim()),
}).strict();

async function getUserName(db: ReturnType<typeof getDb>, userId: string, env: CloudflareEnv): Promise<string> {
  try {
    const { users: usersTable } = await import("~/db/schema");
    const userRow = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, userId)).get();
    if (userRow?.name) return userRow.name;
    const rows = await db.select().from(memories).where(eq(memories.userId, userId)).all();
    const nameRow = rows.find((r) => r.tags.split(",").map((t) => t.trim()).includes("profile-name"));
    if (nameRow) {
      const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, userId);
      const fact = await decryptFact(nameRow.fact, vaultKey);
      return fact.replace(/^Name is\s+/i, "").trim();
    }
  } catch (err) {
    console.error("[getUserName] failed to fetch name:", err);
  }
  return "The user";
}

export const parseMemoriesWithAI = createServerFn({ method: "POST" })
  .inputValidator((data) => ParseMemoriesWithAISchema.parse(data))
  .handler(async ({ data, context }): Promise<Array<{ fact: string; category?: string; tags?: string }>> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const name = await getUserName(db, user.id, env);

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
    return parseFactsFromText(raw).map((item) => ({ fact: item.fact }));
  });

// ── Compare Imported Memories ─────────────────────────────────────────────────

const CompareImportedMemoriesSchema = z.object({
  items: z.array(z.object({
    fact: z.string().min(1).max(10000).transform((s) => s.trim()),
    category: z.enum(["rules", "projects", "references"]).optional(),
    tags: z.string().max(500).optional(),
    projectKey: zProjectKeyFn,
  }).strict()).max(200, "Cannot compare more than 200 items at once"),
  projectKey: zProjectKeyFn,
}).strict();

export const compareImportedMemories = createServerFn({ method: "POST" })
  .inputValidator((data) => CompareImportedMemoriesSchema.parse(data))
  .handler(async ({ data, context }): Promise<ImportComparisonItem[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const { items, projectKey } = data;

    if (!user.id) throw new Error("Unauthorized: userId is required for vector operations");

    const distinctProjectKeys = Array.from(new Set([projectKey, ...items.map(item => item.projectKey)]))
      .filter((pk): pk is string => typeof pk === "string");
    if (distinctProjectKeys.length === 0) distinctProjectKeys.push("personal");

    let orgId: string | null = null;
    for (const pk of distinctProjectKeys) {
      const { allowed: vaultAllowed, orgId: pOrgId } = await verifyVaultAccess(db, user.id, pk);
      if (!vaultAllowed) throw new Error(`Forbidden: no access to vault scope '${pk}'`);
      if (pOrgId) orgId = pOrgId;
    }

    const sanitizedItems = items.map((item) => ({
      ...item,
      fact: sanitizeMemory(item.fact),
    }));

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

    if (valid.length === 0) return [];

    const needsClassification = valid.map((item) =>
      item.category === "rules" || item.category === "projects" || item.category === "references" ? null : item.fact
    );
    const unclassifiedFacts = needsClassification.filter((f): f is string => f !== null);
    const classified = await classifyMemories(env.AI, unclassifiedFacts);

    let classifiedIdx = 0;
    const resolvedCategories = needsClassification.map((f) => f === null ? null : classified[classifiedIdx++]);

    const embeddings = await Promise.all(valid.map((item) => generateEmbedding(env.AI, item.fact)));

    const vectorizeMatches = await Promise.all(
      embeddings.map(async (vec, idx) => {
        try {
          const itemPk = valid[idx].projectKey || projectKey;
          const filter = getVectorFilter(user.id, itemPk);
          const result = await env.VECTOR_INDEX.query(vec, { topK: 3, filter, returnMetadata: "none" });
          return result.matches ?? [];
        } catch (err) {
          console.error(`[compareImportedMemories] Vectorize query failed:`, err);
          return [];
        }
      })
    );

    const candidateIds = Array.from(
      new Set(
        vectorizeMatches.flat()
          .filter((m): m is VectorizeMatch => m !== null && m.score >= 0.80)
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
          .where(and(sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`, eq(memories.isActive, true)))
          .all();
        for (const r of rows) {
          const rVaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : r.userId;
          const rVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, rVaultId);
          existingDbMemories.set(r.id, { ...r, fact: await decryptFact(r.fact, rVaultKey) });
        }
      }
    }

    const candidatesToCheck: { tempId: string; fact: string; category: string; potentialMatches: { id: string; fact: string; category: string }[] }[] = [];
    const comparisonResults: Record<string, { status: ComparisonStatus; matchedId: string | null; reason: string }> = {};

    for (let i = 0; i < valid.length; i++) {
      const tempId = `new-${i}`;
      const item = valid[i];
      const itemCategory = resolvedCategories[i] ?? normalizeCategory(item.category);
      const matches = vectorizeMatches[i] ?? [];
      const itemMatches = matches
        .filter((m) => m.score >= 0.80 && existingDbMemories.has(m.id))
        .map((m) => {
          const dbMem = existingDbMemories.get(m.id)!;
          return { id: dbMem.id, fact: dbMem.fact, category: dbMem.category };
        });

      if (itemMatches.length > 0) {
        candidatesToCheck.push({ tempId, fact: item.fact, category: itemCategory, potentialMatches: itemMatches });
      } else {
        comparisonResults[tempId] = { status: "new", matchedId: null, reason: "No semantically similar memories found in the database." };
      }
    }

    if (candidatesToCheck.length > 0) {
      const LLM_BATCH = 15;
      for (let i = 0; i < candidatesToCheck.length; i += LLM_BATCH) {
        const batch = candidatesToCheck.slice(i, i + LLM_BATCH);
        try {
          const prompt = `You are a memory context analyzer. I will provide a list of incoming new memories alongside potential existing matching memories.
For each new memory, classify it against its potential matches as one of:
- "duplicate": expresses the exact same semantic fact (may be phrased differently).
- "update": refines, expands, corrects, or updates the information in an existing memory.
- "contradiction": directly conflicts with an existing memory.
- "new": has no relation to the existing candidate memories.

Respond with ONLY a JSON object mapping each new memory's temp ID (e.g. "new-0") to:
{
  "status": "duplicate" | "update" | "contradiction" | "new",
  "matchedId": "id-of-existing-memory" (or null if "new"),
  "reason": "short explanation of the relationship"
}

Do not include any intro, markdown formatting, or code blocks. Just the raw JSON object.

Memories to compare:
${JSON.stringify(batch, null, 2)}
`;
          const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
            prompt,
            max_tokens: Math.max(256, batch.length * 96),
          });
          const rawText = extractText(result).trim();
          const match = rawText.match(/\{[\s\S]*\}/);
          if (match) {
            const parsed = JSON.parse(match[0]) as Record<string, { status: ComparisonStatus; matchedId: string | null; reason: string }>;
            for (const [key, val] of Object.entries(parsed)) {
              comparisonResults[key] = val;
            }
          }
        } catch (err) {
          console.error(`[compareImportedMemories] LLM query failed for batch starting at ${i}:`, err);
          for (const item of batch) {
            if (!comparisonResults[item.tempId]) {
              comparisonResults[item.tempId] = { status: "new", matchedId: null, reason: "AI analysis failed, defaulting to new entry." };
            }
          }
        }
      }
    }

    return valid.map((item, i) => {
      const tempId = `new-${i}`;
      const classification = comparisonResults[tempId] || { status: "new" as const, matchedId: null, reason: "No comparison could be completed." };

      let matchedMem = undefined;
      if (classification.matchedId && existingDbMemories.has(classification.matchedId)) {
        const dbMem = existingDbMemories.get(classification.matchedId)!;
        matchedMem = {
          id: dbMem.id,
          fact: dbMem.fact,
          category: dbMem.category as "rules" | "projects" | "references",
          tags: dbMem.tags,
          projectKey: dbMem.projectKey,
        };
      }

      return {
        tempId,
        fact: item.fact,
        category: (resolvedCategories[i] ?? normalizeCategory(item.category)) as "rules" | "projects" | "references",
        tags: item.tags,
        projectKey: item.projectKey || projectKey,
        status: classification.status,
        matchedMemory: matchedMem,
        reason: classification.reason,
      };
    });
  });

// ── Execute Import Actions ────────────────────────────────────────────────────

const ExecuteImportActionsSchema = z.object({
  items: z.array(z.object({
    fact: z.string().min(1).max(10000).transform((s) => s.trim()),
    category: z.enum(["rules", "projects", "references"]),
    tags: z.string().max(500).optional(),
    projectKey: zProjectKeyFn,
    action: z.enum(["import", "skip", "update", "archive_and_import", "exclude"]),
    matchedMemoryId: z.string().uuid().optional(),
  }).strict()).max(200),
  source: z.string().max(64).default("manual").transform((s) => s.trim().toLowerCase()),
  projectKey: zProjectKeyFn,
}).strict();

export const executeImportActions = createServerFn({ method: "POST" })
  .inputValidator((data) => ExecuteImportActionsSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ imported: number; updated: number; archived: number; skipped: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const { items, source, projectKey } = data;

    if (!user.id) throw new Error("Unauthorized: userId is required");

    const distinctProjectKeys = Array.from(new Set([projectKey, ...items.map(item => item.projectKey)]))
      .filter((pk): pk is string => typeof pk === "string");
    if (distinctProjectKeys.length === 0) distinctProjectKeys.push("personal");

    let orgId: string | null = null;
    for (const pk of distinctProjectKeys) {
      const { allowed: vaultAllowed, orgId: pOrgId } = await verifyVaultAccess(db, user.id, pk);
      if (!vaultAllowed) throw new Error(`Forbidden: no access to vault scope '${pk}'`);
      if (pOrgId) orgId = pOrgId;
    }

    let imported = 0, updated = 0, archived = 0, skipped = 0;

    const CONCURRENCY_LIMIT = 5;
    for (let i = 0; i < items.length; i += CONCURRENCY_LIMIT) {
      const chunk = items.slice(i, i + CONCURRENCY_LIMIT);
      await Promise.all(
        chunk.map(async (item) => {
          const { fact, category, tags, action, matchedMemoryId } = item;
          const itemPk = item.projectKey || projectKey || null;
          const { scopeType, scopeId } = parseScope(itemPk);

          if (action === "exclude") { skipped++; return; }

          if (action === "skip") {
            skipped++;
            if (matchedMemoryId) {
              const existingRows = await db.select().from(memories).where(eq(memories.id, matchedMemoryId)).all();
              if (existingRows.length > 0) {
                const existing = existingRows[0];
                const tagsList = (existing.tags ?? "").split(",").map(t => t.trim()).filter(Boolean);
                if (!tagsList.includes(source)) {
                  tagsList.push(source);
                  const newTags = tagsList.join(", ");
                  await db.update(memories).set({ tags: newTags, timestamp: Date.now() }).where(eq(memories.id, matchedMemoryId));
                  try {
                    const newVec = await generateEmbedding(env.AI, fact);
                    await env.VECTOR_INDEX.upsert([{ id: matchedMemoryId, values: newVec, metadata: { userId: user.id, category: existing.category, tags: newTags, projectKey: existing.projectKey ?? "" } as Record<string, VectorizeVectorMetadata> }]);
                  } catch (err) {
                    console.error("[executeImportActions] Vectorize update tags failed:", err);
                  }
                }
              }
            }
            return;
          }

          if (action === "archive_and_import" && matchedMemoryId) {
            const existingRows = await db.select().from(memories).where(eq(memories.id, matchedMemoryId)).all();
            if (existingRows.length > 0) {
              const existing = existingRows[0];
              if (!existing.isLocked) {
                await db.update(memories).set({ isActive: false }).where(eq(memories.id, matchedMemoryId));
                try { await env.VECTOR_INDEX.deleteByIds([matchedMemoryId]); } catch (err) { console.error("[executeImportActions] Vectorize delete failed:", err); }
                await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "update_memory", memoryId: matchedMemoryId, metadata: { archived: true } });
                archived++;
              }
            }
          }

          if (action === "update" && matchedMemoryId) {
            const existingRows = await db.select().from(memories).where(eq(memories.id, matchedMemoryId)).all();
            if (existingRows.length > 0) {
              const existing = existingRows[0];
              if (existing.isLocked) throw new Error("Cannot update a locked memory.");
              const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
              if (!quotaCheck.allowed) throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);

              const sanitizedFact = sanitizeMemory(fact);
              if (!sanitizedFact) return;

              const isQuarantined = containsSensitiveData(sanitizedFact);
              const vaultId = (existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"))) ? existing.projectKey : user.id;
              const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
              const encryptedFact = await encryptFact(sanitizedFact, vaultKey);

              const tagsList = (tags ?? "").split(",").map(t => t.trim()).filter(Boolean);
              if (!tagsList.includes(source)) tagsList.push(source);
              const finalTags = tagsList.join(", ");

              const updateTimestamp = Date.now();
              await db.batch([
                db.update(memories).set({ fact: encryptedFact, category, tags: finalTags, timestamp: updateTimestamp, isQuarantined }).where(eq(memories.id, matchedMemoryId)),
                db.insert(memoryVersions).values({ id: crypto.randomUUID(), memoryId: matchedMemoryId, fact: encryptedFact, category, tags: finalTags, changedBy: user.id, changeReason: "updated", timestamp: updateTimestamp }),
              ]);

              const embedding = await generateEmbedding(env.AI, sanitizedFact);
              const tokensConsumed = estimateEmbeddingTokens(sanitizedFact);
              await env.VECTOR_INDEX.upsert([{ id: matchedMemoryId, values: embedding, metadata: { userId: user.id, category, tags: finalTags, projectKey: existing.projectKey ?? "" } as Record<string, VectorizeVectorMetadata> }]);
              await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "update_memory", memoryId: matchedMemoryId, metadata: { category, quarantined: isQuarantined } });
              await logTokenUsage(db, "session", "commit", tokensConsumed);
              updated++;
              return;
            }
          }

          if (action === "import" || action === "archive_and_import") {
            await checkMemoryLimit(db, user.id);
            const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
            if (!quotaCheck.allowed) throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);

            const sanitizedFact = sanitizeMemory(fact);
            if (!sanitizedFact) return;

            const isQuarantined = containsSensitiveData(sanitizedFact);
            const id = crypto.randomUUID();
            const timestamp = Date.now();

            const vaultId = (scopeType === "team" || scopeType === "organization") ? itemPk! : user.id;
            const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
            const encryptedFact = await encryptFact(sanitizedFact, vaultKey);

            const [embedding, graphExtraction] = await Promise.all([
              generateEmbedding(env.AI, sanitizedFact),
              extractGraphEntities(env.AI, sanitizedFact),
            ]);
            const tokensConsumed = estimateEmbeddingTokens(sanitizedFact);

            const tagsList = (tags ?? "").split(",").map(t => t.trim()).filter(Boolean);
            if (!tagsList.includes(source)) tagsList.push(source);
            const finalTags = tagsList.join(", ");

            const newRow: NewMemory = {
              id, userId: user.id, fact: encryptedFact, category, tags: finalTags,
              timestamp, isActive: true, projectKey: itemPk, scopeType, scopeId,
              isLocked: false, authorityType: "contributed", isQuarantined,
            };

            await db.batch([
              db.insert(memories).values(newRow),
              db.insert(memoryVersions).values({ id: crypto.randomUUID(), memoryId: id, fact: encryptedFact, category, tags: finalTags, changedBy: user.id, changeReason: "created", timestamp }),
            ]);

            let entityIds: string[] = [];
            try { entityIds = await persistGraphData(env.DB, id, user.id, itemPk, graphExtraction); } catch (err) { console.error("[executeImportActions] graph persist failed:", err); }

            try {
              await env.VECTOR_INDEX.insert([{ id, values: embedding, metadata: { userId: user.id, category, tags: finalTags, projectKey: itemPk ?? "", entityIds: entityIds.join(" ") } as Record<string, VectorizeVectorMetadata> }]);
            } catch (err) { console.error(`[executeImportActions] vector insert failed:`, err); }

            await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "commit_memory", memoryId: id, metadata: { category, projectKey: itemPk, quarantined: isQuarantined } });
            await logTokenUsage(db, "session", "commit", tokensConsumed);
            imported++;
          }
        })
      );
    }

    return { imported, updated, archived, skipped };
  });

// ── Batch Import Memories ─────────────────────────────────────────────────────

export type DuplicateGroup = {
  primary: Memory;
  duplicates: Memory[];
};

const BatchImportSchema = z.object({
  items: z.array(z.object({
    fact: z.string().min(1).max(10000).transform((s) => s.trim()),
    category: z.enum(["rules", "projects", "references"]).optional(),
    tags: z.string().max(500).optional().default(""),
    projectKey: zProjectKeyFn,
  }).strict()).max(500),
  source: z.string().max(64).default("manual").transform((s) => s.trim().toLowerCase()),
  projectKey: zProjectKeyFn,
}).strict();

export const batchImportMemories = createServerFn({ method: "POST" })
  .inputValidator((data) => BatchImportSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ imported: number; skipped: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const { items, source, projectKey } = data;

    if (!user.id) throw new Error("Unauthorized: userId is required for vector operations");

    const distinctProjectKeys = Array.from(new Set([projectKey, ...items.map(item => item.projectKey)]))
      .filter((pk): pk is string => typeof pk === "string");
    if (distinctProjectKeys.length === 0) distinctProjectKeys.push("personal");

    let orgId: string | null = null;
    for (const pk of distinctProjectKeys) {
      const { allowed: vaultAllowed, orgId: pOrgId } = await verifyVaultAccess(db, user.id, pk);
      if (!vaultAllowed) throw new Error(`Forbidden: no access to vault scope '${pk}'`);
      if (pOrgId) orgId = pOrgId;
    }

    const quotaCheck = await checkQuota(db, user.id, "session", "commit", orgId);
    if (!quotaCheck.allowed) throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);

    const sanitizedItems = items.map((item) => {
      const sanitized = sanitizeMemory(item.fact);
      const isQuarantined = containsSensitiveData(sanitized);
      return { ...item, fact: sanitized, isQuarantined };
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
      item.category === "rules" || item.category === "projects" || item.category === "references" ? null : item.fact
    );
    const unclassifiedFacts = needsClassification.filter((f): f is string => f !== null);
    const classified = await classifyMemories(env.AI, unclassifiedFacts);

    let classifiedIdx = 0;
    const resolvedCategories = needsClassification.map((f) => f === null ? null : classified[classifiedIdx++]);

    const embeddings = await Promise.all(valid.map((item) => generateEmbedding(env.AI, item.fact)));
    const totalTokensConsumed = valid.reduce((sum, item) => sum + estimateEmbeddingTokens(item.fact), 0);

    const vectorizeMatches = await Promise.all(
      embeddings.map(async (vec, idx) => {
        try {
          const result = await env.VECTOR_INDEX.query(vec, { topK: 3, filter: { userId: user.id }, returnMetadata: "none" });
          return result.matches ?? [];
        } catch (err) {
          console.error(`[batchImportMemories] Vectorize query failed for item ${idx}:`, err);
          return [];
        }
      })
    );

    const candidateIds = Array.from(
      new Set(
        vectorizeMatches.flat()
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
        for (const r of rows) {
          const rVaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : r.userId;
          const rVaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, rVaultId);
          existingDbMemories.set(r.id, { ...r, fact: await decryptFact(r.fact, rVaultKey) });
        }
      }
    }

    const dupeMapping: Record<string, string | null> = {};
    const candidatesToCheck: { tempId: string; fact: string; category: string; matchingCandidates: { id: string; fact: string; category: string }[] }[] = [];

    for (let i = 0; i < valid.length; i++) {
      const tempId = `new-${i}`;
      const fact = valid[i].fact;
      const category = resolvedCategories[i] ?? normalizeCategory(valid[i].category);
      const embedding = embeddings[i];

      let isDefiniteDupe = false;
      const matchingCandidates: { id: string; fact: string; category: string }[] = [];

      for (let j = 0; j < i; j++) {
        const priorTempId = `new-${j}`;
        if (dupeMapping[priorTempId]) continue;
        const sim = cosineSimilarity(embedding, embeddings[j]);
        if (sim > 0.99) { isDefiniteDupe = true; dupeMapping[tempId] = dupeMapping[priorTempId] || priorTempId; break; }
        else if (sim > 0.92) { matchingCandidates.push({ id: priorTempId, fact: valid[j].fact, category: resolvedCategories[j] ?? normalizeCategory(valid[j].category) }); }
      }

      if (isDefiniteDupe) continue;

      const matches = vectorizeMatches[i] ?? [];
      for (const m of matches) {
        if (!existingDbMemories.has(m.id)) continue;
        const dbMem = existingDbMemories.get(m.id)!;
        if (m.score > 0.99) { isDefiniteDupe = true; dupeMapping[tempId] = m.id; break; }
        else if (m.score > 0.92) { matchingCandidates.push({ id: m.id, fact: dbMem.fact, category: dbMem.category }); }
      }

      if (isDefiniteDupe) continue;
      if (matchingCandidates.length > 0) { candidatesToCheck.push({ tempId, fact, category, matchingCandidates }); }
      else { dupeMapping[tempId] = null; }
    }

    if (candidatesToCheck.length > 0) {
      try {
        const prompt = `You are a memory deduplication assistant. Your job is to check a list of new memories against potential duplicate candidates and identify if they are actual duplicates.

A new memory is a duplicate of a candidate if it expresses the exact same fact or semantic meaning (even if phrased differently, or if it is a subset of the candidate).

Please check the following potential duplicate pairs:

${candidatesToCheck.map((c) => `New Memory: [${c.tempId}] (${c.category}) "${c.fact}"
Candidates to check against:
${c.matchingCandidates.map((m) => `  - [${m.id}] (${m.category}) "${m.fact}"`).join("\n")}`).join("\n\n")}

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
          for (const [key, val] of Object.entries(llmMappings)) { dupeMapping[key] = val; }
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
          if (!mappedVal.startsWith("new-")) matchedDbId = mappedVal;
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
              await env.VECTOR_INDEX.upsert([{ id: matchedDbId, values: embeddings[i], metadata: { userId: user.id, category: existing.category, tags: newTags, projectKey: existing.projectKey ?? "" } as Record<string, VectorizeVectorMetadata> }]);
            } catch (err) { console.error(`[batchImportMemories] Vectorize upsert failed:`, err); }
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
        id: crypto.randomUUID(), userId: user.id, fact: encryptedFact, plaintextFact: item.fact,
        category: resolvedCategories[i] ?? normalizeCategory(item.category), tags: finalTags,
        timestamp, embedding: embeddings[i], isDupe: dupeFlags[i], projectKey: itemPk, isQuarantined: !!item.isQuarantined,
      };
    }));

    const newRows = allRows.filter((r) => !r.isDupe);
    if (newRows.length === 0) return { imported: 0, skipped: allRows.length };

    const CHUNK_SIZE = 10;
    const batchQueries: any[] = [];
    for (let i = 0; i < newRows.length; i += CHUNK_SIZE) {
      batchQueries.push(
        db.insert(memories).values(newRows.slice(i, i + CHUNK_SIZE).map(({ id, userId, fact, category, tags, timestamp: ts, projectKey: pk, isQuarantined }) => ({ id, userId, fact, category, tags, timestamp: ts, isActive: true, projectKey: pk, isQuarantined })))
      );
    }
    for (let i = 0; i < newRows.length; i += CHUNK_SIZE) {
      const chunk = newRows.slice(i, i + CHUNK_SIZE);
      batchQueries.push(db.insert(memoryVersions).values(chunk.map((row) => ({ id: crypto.randomUUID(), memoryId: row.id, fact: row.fact, category: row.category, tags: row.tags, changedBy: user.id, changeReason: "imported", timestamp: row.timestamp }))));
    }
    await (db as any).batch(batchQueries);

    const vectorBatch: VectorizeVector[] = newRows.map((row) => ({
      id: row.id, values: row.embedding,
      metadata: { userId: user.id, category: row.category, tags: row.tags ?? "", projectKey: row.projectKey ?? "" } as Record<string, VectorizeVectorMetadata>,
    }));

    const VECTOR_CHUNK = 100;
    for (let i = 0; i < vectorBatch.length; i += VECTOR_CHUNK) {
      try { await env.VECTOR_INDEX.insert(vectorBatch.slice(i, i + VECTOR_CHUNK)); } catch (err) { console.error(`[batchImportMemories] vector insert failed:`, err); }
    }

    await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "import_memories", metadata: { count: newRows.length } });
    await logTokenUsage(db, "session", "commit", totalTokensConsumed, newRows.length);

    return { imported: newRows.length, skipped: allRows.length - newRows.length };
  });

// ── Scan Database Duplicates ──────────────────────────────────────────────────

export const scanDatabaseDuplicates = createServerFn({ method: "POST" })
  .handler(async ({ context }): Promise<{ groups: DuplicateGroup[] }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) throw new Error("Unauthorized: userId is required for vector query");

    const encryptedRows = await db.select().from(memories).where(and(eq(memories.userId, user.id), eq(memories.isActive, true))).all();

    const { decryptEphemeral } = await import("~/server/crypto");
    const ephemerals: any[] = [];
    let allMemories: Memory[];
    try {
      allMemories = await Promise.all(encryptedRows.map(async (r) => {
        const vaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : r.userId;
        const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
        if (isEncrypted(r.fact)) {
          const eph = await decryptEphemeral(r.fact, vaultKey);
          ephemerals.push(eph);
          return { ...r, fact: eph.get() };
        }
        return { ...r };
      }));
    } finally {
      for (const eph of ephemerals) eph.drop();
    }

    if (allMemories.length <= 1) return { groups: [] };

    const embeddingsMap = new Map<string, number[]>();
    const CHUNK_SIZE = 10;
    for (let i = 0; i < allMemories.length; i += CHUNK_SIZE) {
      const chunk = allMemories.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (m) => {
        try { embeddingsMap.set(m.id, await generateEmbedding(env.AI, m.fact)); } catch (err) { console.error(`[scanDatabaseDuplicates] embedding failed for ${m.id}:`, err); }
      }));
    }

    const CANDIDATE_THRESHOLD = 0.82;
    const rawMatches = new Map<string, string[]>();
    const memoriesMap = new Map<string, Memory>(allMemories.map((m) => [m.id, m]));

    for (let i = 0; i < allMemories.length; i += CHUNK_SIZE) {
      const chunk = allMemories.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (m) => {
        const vec = embeddingsMap.get(m.id);
        if (!vec) return;
        try {
          const result = await env.VECTOR_INDEX.query(vec, { topK: 4, filter: { userId: user.id }, returnMetadata: "none" });
          const similarIds = (result.matches ?? []).filter((match) => match && match.id !== m.id && match.score >= CANDIDATE_THRESHOLD).map((match) => match.id).filter((id) => memoriesMap.has(id));
          if (similarIds.length > 0) rawMatches.set(m.id, similarIds);
        } catch (err) { console.error(`[scanDatabaseDuplicates] query failed for ${m.id}:`, err); }
      }));
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
1. It expresses the exact same fact or semantic meaning as the primary memory.
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
Only include duplicate IDs that are actual semantic duplicates. If a group has no duplicates, verifiedDuplicateIds should be empty. Do not include markdown code fences.`;

      try {
        const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { prompt, max_tokens: Math.max(128, batch.length * 64) });
        const text = extractText(result).trim();
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { primaryId: string; verifiedDuplicateIds: string[] }[];
          for (const item of parsed) {
            const p = memoriesMap.get(item.primaryId);
            if (!p) continue;
            const dupes = (item.verifiedDuplicateIds ?? []).map((id) => memoriesMap.get(id)).filter((c): c is Memory => c !== undefined);
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
