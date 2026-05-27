import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq, sql } from "drizzle-orm";
import { memories, apiTokens, type Memory, type NewMemory } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { encrypt, decrypt, isEncrypted, hashToken } from "./crypto";
import { requireSession, requireAdmin } from "./session";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-m3", { text: [text] });
  const r = result as { data?: number[][]; shape?: number[] };
  return r.data?.[0] ?? [];
}

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memories, apiTokens } });
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
async function decryptFact(stored: string, encKey: string): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  return decrypt(stored, encKey);
}

// Decrypt all facts in a row array.
async function decryptMemories(rows: Memory[], encKey: string): Promise<Memory[]> {
  return Promise.all(
    rows.map(async (r) => ({ ...r, fact: await decryptFact(r.fact, encKey) }))
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

export const getMemories = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<Memory[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const rows = await db
      .select()
      .from(memories)
      .where(eq(memories.userId, user.id))
      .orderBy(desc(memories.timestamp))
      .all();
    return decryptMemories(rows, env.ENCRYPTION_KEY);
  }
);

type AddMemoryInput = {
  fact: string;
  category: "rules" | "projects" | "references";
  tags: string;
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
    };
  })
  .handler(async ({ data, context }): Promise<Memory> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const id = crypto.randomUUID();
    const timestamp = Date.now();
    // Embed plaintext, store encrypted
    const embedding = await generateEmbedding(env.AI, data.fact);
    const encryptedFact = await encryptFact(data.fact, env.ENCRYPTION_KEY);

    const tagsList = data.tags.split(",").map(t => t.trim()).filter(Boolean);
    if (!tagsList.includes("manual")) {
      tagsList.push("manual");
    }
    const finalTags = tagsList.join(", ");

    const newRow: NewMemory = {
      id,
      userId: user.id,
      fact: encryptedFact,
      category: data.category,
      tags: finalTags,
      timestamp,
    };

    await db.insert(memories).values(newRow);
    try {
      await env.VECTOR_INDEX.insert([
        {
          id,
          values: embedding,
          metadata: { category: data.category, tags: finalTags } as Record<string, VectorizeVectorMetadata>,
        },
      ]);
    } catch (err) {
      console.error(`[addMemory] vector insert failed:`, err);
    }

    return { ...newRow, fact: data.fact, tags: newRow.tags ?? "" };
  });

type BatchImportItem = { fact: string; category?: string; tags?: string };

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
};

export const batchImportMemories = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): BatchImportInput => {
    const d = data as BatchImportInput;
    if (!Array.isArray(d.items)) throw new Error("items must be an array");
    const validatedItems = d.items.map((item) => ({
      fact: String(item.fact || "").trim(),
      category: item.category,
      tags: item.tags,
    }));
    return {
      items: validatedItems,
      source: typeof d.source === "string" ? d.source.trim().toLowerCase() : "manual",
    };
  })
  .handler(async ({ data, context }): Promise<{ imported: number; skipped: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);
    const { items, source } = data;

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
          const result = await env.VECTOR_INDEX.query(vec, { topK: 3, returnMetadata: false });
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
          .filter((m): m is VectorizeMatch => m !== null && m.score >= CANDIDATE_THRESHOLD)
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
        // Decrypt facts for LLM comparison
        for (const r of rows) {
          existingDbMemories.set(r.id, { ...r, fact: await decryptFact(r.fact, env.ENCRYPTION_KEY) });
        }
      }
    }

    const dbCandidatesList = Array.from(existingDbMemories.values());
    const newMemoriesList = valid.map((item, idx) => ({
      tempId: `new-${idx}`,
      fact: item.fact,
      category: resolvedCategories[idx] ?? normalizeCategory(item.category),
    }));

    let dupeMapping: Record<string, string | null> = {};

    try {
      const prompt = `You are a memory deduplication assistant. Your job is to check a list of new memories against a list of existing memories and identify duplicates.

A new memory is a duplicate if:
1. It expresses the exact same fact or semantic meaning as an existing memory (even if phrased differently, e.g., "graduated with a BS in IT" is a duplicate if "The user has a BS in IT degree" is already stored).
2. It expresses a fact that is a subset of or already fully covered by an existing memory.
3. It duplicates a previous new memory in the list (in this case, map it to that previous new memory's ID).

Existing Memories:
${dbCandidatesList.length > 0
  ? dbCandidatesList.map((m) => `[${m.id}] (${m.category}) "${m.fact}"`).join("\n")
  : "(None)"}

New Memories to Check:
${newMemoriesList.map((m) => `[${m.tempId}] (${m.category}) "${m.fact}"`).join("\n")}

Respond with ONLY a JSON object mapping each new memory's ID (e.g. "new-0") to:
- The ID of the existing memory it duplicates (from the Existing Memories list), OR
- The temporary ID of a previous new memory it duplicates (from the New Memories list), OR
- null if it is not a duplicate.

Do not include any intro, markdown formatting, or code blocks. Just the raw JSON object.

Example output:
{
  "new-0": "6091fbef-95a2-4235-b97e-cc1f360f73b2",
  "new-1": "new-0",
  "new-2": null
}`;

      const llmResult = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        prompt,
        max_tokens: Math.max(128, valid.length * 48),
      });

      const rawText = extractText(llmResult).trim();
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        dupeMapping = JSON.parse(match[0]);
      }
    } catch (err) {
      console.error("[batchImportMemories] AI deduplication failed:", err);
    }

    const dupeFlags: boolean[] = [];
    const keptEmbeddings: { embedding: number[]; index: number }[] = [];
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
      } else {
        const vec = embeddings[i];
        for (const kept of keptEmbeddings) {
          const sim = cosineSimilarity(vec, kept.embedding);
          if (sim >= DUPE_THRESHOLD) {
            isDupe = true;
            break;
          }
        }

        if (!isDupe) {
          const matches = vectorizeMatches[i];
          const top = matches?.[0];
          const hasMatch = top !== null && top !== undefined && top.score >= DUPE_THRESHOLD;
          if (hasMatch && existingDbMemories.has(top.id)) {
            isDupe = true;
            matchedDbId = top.id;
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
                  metadata: { category: existing.category, tags: newTags } as Record<string, VectorizeVectorMetadata>,
                },
              ]);
            } catch (err) {
              console.error(`[batchImportMemories] Vectorize upsert failed:`, err);
            }
          }
        }
      }

      dupeFlags.push(isDupe);
      if (!isDupe) {
        keptEmbeddings.push({ embedding: embeddings[i], index: i });
      }
    }

    const timestamp = Date.now();
    const allRows = await Promise.all(valid.map(async (item, i) => {
      const tagsList = (item.tags ?? "").split(",").map(t => t.trim()).filter(Boolean);
      if (!tagsList.includes(source)) tagsList.push(source);
      const finalTags = tagsList.join(", ");
      const encryptedFact = await encryptFact(item.fact, env.ENCRYPTION_KEY);

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
      };
    }));

    const newRows = allRows.filter((r) => !r.isDupe);
    if (newRows.length === 0) return { imported: 0, skipped: allRows.length };

    const CHUNK_SIZE = 10;
    for (let i = 0; i < newRows.length; i += CHUNK_SIZE) {
      await db.insert(memories).values(
        newRows.slice(i, i + CHUNK_SIZE).map(({ id, userId, fact, category, tags, timestamp: ts }) => ({
          id, userId, fact, category, tags, timestamp: ts,
        }))
      );
    }

    const vectorBatch: VectorizeVector[] = newRows.map((row) => ({
      id: row.id,
      values: row.embedding,
      metadata: {
        category: row.category,
        tags: row.tags ?? "",
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
    // Only delete if belongs to this user
    await db.delete(memories).where(sql`${memories.id} = ${data.id} AND ${memories.userId} = ${user.id}`);
    await env.VECTOR_INDEX.deleteByIds([data.id]);
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

    const encryptedFact = await encryptFact(data.fact, env.ENCRYPTION_KEY);
    await db.update(memories)
      .set({ fact: encryptedFact, category: data.category, tags: data.tags })
      .where(sql`${memories.id} = ${data.id} AND ${memories.userId} = ${user.id}`);

    const embedding = await generateEmbedding(env.AI, data.fact);
    await env.VECTOR_INDEX.upsert([{
      id: data.id,
      values: embedding,
      metadata: { category: data.category, tags: data.tags } as Record<string, VectorizeVectorMetadata>,
    }]);

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
  .inputValidator((data: unknown): { query: string; topK?: number } => {
    const d = data as { query: string; topK?: number };
    if (!d.query || typeof d.query !== "string") throw new Error("query is required");
    return { query: d.query.trim(), topK: d.topK ?? 5 };
  })
  .handler(async ({ data, context }): Promise<Memory[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const embedding = await generateEmbedding(env.AI, data.query);
    const results = await env.VECTOR_INDEX.query(embedding, {
      topK: data.topK ?? 5,
      returnMetadata: false,
    });

    if (!results.matches || results.matches.length === 0) return [];

    const ids = results.matches.map((m: VectorizeMatch) => m.id);
    const rows = await db
      .select()
      .from(memories)
      .where(sql`${memories.id} IN (${sql.join(ids.map((id: string) => sql`${id}`), sql`, `)}) AND ${memories.userId} = ${user.id}`)
      .all();

    const idOrder = new Map(ids.map((id: string, i: number) => [id, i]));
    const sorted = rows.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
    return decryptMemories(sorted, env.ENCRYPTION_KEY);
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

    const encryptedRows = await db.select().from(memories).where(eq(memories.userId, user.id)).all();
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
            const result = await env.VECTOR_INDEX.query(vec, { topK: 4, returnMetadata: false });
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

export const saveProfile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { name: string; location: string } => {
    const d = data as { name: string; location: string };
    return { name: String(d.name || "").trim(), location: String(d.location || "").trim() };
  })
  .handler(async ({ data, context }): Promise<{ success: boolean }> => {
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

    if (data.name) {
      const fact = `Name is ${data.name}`;
      const encFact = await encryptFact(fact, env.ENCRYPTION_KEY);
      const embedding = await generateEmbedding(env.AI, fact);
      if (nameRow) {
        await db.update(memories).set({ fact: encFact }).where(eq(memories.id, nameRow.id));
        await env.VECTOR_INDEX.upsert([{
          id: nameRow.id,
          values: embedding,
          metadata: { category: "references", tags: "profile-name" } as Record<string, VectorizeVectorMetadata>,
        }]);
      } else {
        const id = crypto.randomUUID();
        await db.insert(memories).values({ id, userId: user.id, fact: encFact, category: "references", tags: "profile-name", timestamp: Date.now() });
        await env.VECTOR_INDEX.insert([{ id, values: embedding, metadata: { category: "references", tags: "profile-name" } as Record<string, VectorizeVectorMetadata> }]);
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
          metadata: { category: "references", tags: "profile-location" } as Record<string, VectorizeVectorMetadata>,
        }]);
      } else {
        const id = crypto.randomUUID();
        await db.insert(memories).values({ id, userId: user.id, fact: encFact, category: "references", tags: "profile-location", timestamp: Date.now() });
        await env.VECTOR_INDEX.insert([{ id, values: embedding, metadata: { category: "references", tags: "profile-location" } as Record<string, VectorizeVectorMetadata> }]);
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
    const perms = typeof d.permissions === "number" ? d.permissions : 3;
    return { name: d.name.trim().slice(0, 64), permissions: perms & 3 }; // mask to valid bits
  })
  .handler(async ({ data, context }): Promise<{ token: string; id: string; name: string; permissions: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

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
    return { id: d.id, permissions: (d.permissions & 3) };
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

    const rows = await db.select({ id: memories.id, fact: memories.fact }).from(memories).all();

    let encrypted = 0;
    let alreadyEncrypted = 0;
    let failed = 0;

    const CHUNK = 20;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async (row) => {
        try {
          if (isEncrypted(row.fact)) {
            alreadyEncrypted++;
            return;
          }
          const encFact = await encrypt(row.fact, env.ENCRYPTION_KEY);
          await db.update(memories).set({ fact: encFact }).where(eq(memories.id, row.id));
          encrypted++;
        } catch (err) {
          console.error(`[encryptAllMemories] failed for ${row.id}:`, err);
          failed++;
        }
      }));
    }

    return { encrypted, alreadyEncrypted, failed };
  }
);
