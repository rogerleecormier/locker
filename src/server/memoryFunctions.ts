import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq, sql } from "drizzle-orm";
import { memories, type Memory, type NewMemory } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-m3", { text: [text] });
  const r = result as { data?: number[][]; shape?: number[] };
  return r.data?.[0] ?? [];
}

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memories } });
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

async function classifyMemories(
  ai: Ai,
  facts: string[]
): Promise<Array<"rules" | "projects" | "references">> {
  if (facts.length === 0) return [];

  // process in batches of 20 to avoid token limits
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
    /^=+$/,                                           // === dividers
    /^-{3,}$/,                                        // --- dividers
    /^#{1,3}\s/,                                      // markdown headers
    /^evidence:/i,                                    // evidence lines
    /^imported from:/i,                               // gemini footer
    /^generated:/i,                                   // export headers
    /^memory export$/i,
    /^end of export$/i,
    /^\d+\.\s+[A-Z\s]+$/,                            // "1. INSTRUCTIONS"
    /^[-=*]{4,}/,                                     // long dividers
    /^[A-Z\s]+ — MEMORY EXPORT/,                     // title line
  ];

  return raw
    .split("\n")
    .map((line) => {
      let f = line
        .trim()
        .replace(/^\s*[-*•]\s+/, "")                         // bullet chars
        .replace(/^\[\d{4}-\d{2}-\d{2}\]\s*-?\s*/,"")       // [YYYY-MM-DD] -
        .replace(/^\[unknown\]\s*-?\s*/i, "")                // [unknown] -
        .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")            // **bold**
        .replace(/^Name:\s*/i, "")                           // "Name: Roger"
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

async function getUserName(db: ReturnType<typeof getDb>): Promise<string> {
  try {
    const rows = await db.select().from(memories).all();
    const nameRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-name")
    );
    if (nameRow) {
      return nameRow.fact.replace(/^Name is\s+/i, "").trim();
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
    return { text: d.text.trim() };
  })
  .handler(async ({ data, context }): Promise<Array<{ fact: string; category?: string; tags?: string }>> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = getDb(env);
    const name = await getUserName(db);

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
    console.log("[parse v2] isArray:", Array.isArray(r.response), "keys:", Object.keys(r).join(","), "responseType:", typeof r.response, "sample:", JSON.stringify(r.response)?.slice(0, 100));
    if (Array.isArray(r.response)) {
      const facts = (r.response as unknown[])
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((f) => f.length > 0);
      console.log("[parse v2] extracted facts count:", facts.length);
      if (facts.length > 0) return facts.map((f) => ({ fact: f }));
    }

    // fall back to text extraction + JSON parse
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
    const db = getDb(env);
    return db.select().from(memories).orderBy(desc(memories.timestamp)).all();
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
    const db = getDb(env);

    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const embedding = await generateEmbedding(env.AI, data.fact);

    const newRow: NewMemory = {
      id,
      fact: data.fact,
      category: data.category,
      tags: data.tags,
      timestamp,
    };

    await db.insert(memories).values(newRow);
    try {
      const insertResult = await env.VECTOR_INDEX.insert([
        {
          id,
          values: embedding,
          metadata: { category: data.category, tags: data.tags } as Record<string, VectorizeVectorMetadata>,
        },
      ]);
      console.log(`[addMemory] vector insert result:`, insertResult);
    } catch (err) {
      console.error(`[addMemory] vector insert failed:`, err);
    }

    return { ...newRow, tags: newRow.tags ?? "" };
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

export const batchImportMemories = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): BatchImportItem[] => {
    if (!Array.isArray(data)) throw new Error("Input must be an array");
    return (data as BatchImportItem[]).map((item) => ({
      fact: String(item.fact || "").trim(),
      category: item.category,
      tags: item.tags,
    }));
  })
  .handler(async ({ data, context }): Promise<{ imported: number; skipped: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = getDb(env);

    const valid = data.filter((item) => {
      const f = item.fact;
      if (f.length === 0) return false;
      // drop section headers, evidence lines, and bullets that are just labels
      if (/^#+\s/.test(f)) return false;                          // markdown headers
      if (/^\*{1,2}[^*]+\*{1,2}:?\s*$/.test(f)) return false;   // **Category:** alone
      if (/^evidence:/i.test(f)) return false;                    // Evidence: lines
      if (/^\d+\.\s+\*{0,2}[A-Z]/.test(f) && f.length < 60) return false; // "1. **Category**"
      if (/^imported from:/i.test(f)) return false;               // Gemini footer
      return true;
    });
    if (valid.length === 0) return { imported: 0, skipped: 0 };

    // classify items that have no explicit category
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

    // generate embeddings for all candidates
    const embeddings = await Promise.all(
      valid.map((item) => generateEmbedding(env.AI, item.fact))
    );

    // deduplicate against existing vectors — skip anything with cosine similarity >= 0.98
    // (0.92 was too permissive and skipped too many legitimate facts)
    const DUPE_THRESHOLD = 0.98;
    const CANDIDATE_THRESHOLD = 0.80;

    // First query Vectorize in parallel for all inputs to find possible matches
    const vectorizeMatches = await Promise.all(
      embeddings.map(async (vec, idx) => {
        try {
          // Retrieve top 3 matches to give the LLM good candidate choices
          const result = await env.VECTOR_INDEX.query(vec, { topK: 3, returnMetadata: false });
          return result.matches ?? [];
        } catch (err) {
          console.error(`[batchImportMemories] Vectorize query failed for item ${idx}:`, err);
          return [];
        }
      })
    );

    // Identify unique matched vector IDs above the candidate threshold
    const candidateIds = Array.from(
      new Set(
        vectorizeMatches
          .flat()
          .filter((m): m is VectorizeMatch => m !== null && m.score >= CANDIDATE_THRESHOLD)
          .map((m) => m.id)
      )
    );

    // Query D1 database to verify which of these matched IDs exist in D1
    const existingDbMemories = new Map<string, Memory>();
    if (candidateIds.length > 0) {
      const DB_CHUNK = 50;
      for (let i = 0; i < candidateIds.length; i += DB_CHUNK) {
        const chunk = candidateIds.slice(i, i + DB_CHUNK);
        const rows = await db
          .select()
          .from(memories)
          .where(sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`)
          .all();
        for (const r of rows) {
          existingDbMemories.set(r.id, r);
        }
      }
    }

    // Prepare lists for the LLM prompt
    const dbCandidatesList = Array.from(existingDbMemories.values());
    const newMemoriesList = valid.map((item, idx) => ({
      tempId: `new-${idx}`,
      fact: item.fact,
      category: resolvedCategories[idx] ?? normalizeCategory(item.category),
    }));

    let dupeMapping: Record<string, string | null> = {};

    // Call LLM for semantic deduplication check
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
        console.log("[batchImportMemories] AI deduplication mapping:", dupeMapping);
      }
    } catch (err) {
      console.error("[batchImportMemories] AI deduplication failed, falling back to vector cosine similarity:", err);
    }

    // Now check for duplicates, using the LLM mapping if available, otherwise falling back to cosine similarity
    const dupeFlags: boolean[] = [];
    const keptEmbeddings: { embedding: number[]; index: number }[] = [];
    const hasValidMapping = Object.keys(dupeMapping).length > 0;

    for (let i = 0; i < valid.length; i++) {
      const tempId = `new-${i}`;
      let isDupe = false;

      if (hasValidMapping && dupeMapping[tempId] !== undefined) {
        const mappedVal = dupeMapping[tempId];
        if (mappedVal !== null && mappedVal !== undefined) {
          isDupe = true;
          console.log(`[batchImportMemories] AI flagged item ${i} ("${valid[i].fact}") as duplicate of: ${mappedVal}`);
        }
      } else {
        // Fallback: Cosine Similarity check
        const vec = embeddings[i];

        // 1. Check against previous kept items in batch (intra-batch)
        for (const kept of keptEmbeddings) {
          const sim = cosineSimilarity(vec, kept.embedding);
          if (sim >= DUPE_THRESHOLD) {
            isDupe = true;
            console.log(`[batchImportMemories] Fallback: item ${i} is a duplicate of item ${kept.index} within the same ingest batch (similarity=${sim.toFixed(4)})`);
            break;
          }
        }

        // 2. Check against verified existing database memories
        if (!isDupe) {
          const matches = vectorizeMatches[i];
          const top = matches?.[0]; // Get closest match
          const hasMatch = top !== null && top !== undefined && top.score >= DUPE_THRESHOLD;
          if (hasMatch) {
            if (existingDbMemories.has(top.id)) {
              isDupe = true;
              console.log(`[batchImportMemories] Fallback: item ${i} matched verified DB memory ${top.id} (score=${top.score})`);
            } else {
              console.log(`[batchImportMemories] Fallback: item ${i} matched orphaned vector ${top.id} in Vectorize but not in D1. Skipping duplicate flag (score=${top.score})`);
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
    const allRows: (NewMemory & { embedding: number[]; isDupe: boolean })[] = valid.map((item, i) => ({
      id: crypto.randomUUID(),
      fact: item.fact,
      category: resolvedCategories[i] ?? normalizeCategory(item.category),
      tags: item.tags?.trim() ?? "",
      timestamp,
      embedding: embeddings[i],
      isDupe: dupeFlags[i],
    }));

    const newRows = allRows.filter((r) => !r.isDupe);
    if (newRows.length === 0) return { imported: 0, skipped: allRows.length };

    const CHUNK_SIZE = 10;
    for (let i = 0; i < newRows.length; i += CHUNK_SIZE) {
      await db.insert(memories).values(
        newRows.slice(i, i + CHUNK_SIZE).map(({ id, fact, category, tags, timestamp: ts }) => ({
          id, fact, category, tags, timestamp: ts,
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
        const insertResult = await env.VECTOR_INDEX.insert(chunk);
        console.log(`[batchImportMemories] inserted ${chunk.length} vectors, result:`, insertResult);
      } catch (err) {
        console.error(`[batchImportMemories] vector insert failed:`, err);
      }
    }

    console.log(`[batchImportMemories] total: imported ${newRows.length}, skipped ${allRows.length - newRows.length}`);
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
    const db = getDb(env);
    await db.delete(memories).where(eq(memories.id, data.id));
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
    const db = getDb(env);

    await db.update(memories)
      .set({ fact: data.fact, category: data.category, tags: data.tags })
      .where(eq(memories.id, data.id));

    // re-embed with updated fact text
    const embedding = await generateEmbedding(env.AI, data.fact);
    await env.VECTOR_INDEX.upsert([{
      id: data.id,
      values: embedding,
      metadata: { category: data.category, tags: data.tags } as Record<string, VectorizeVectorMetadata>,
    }]);

    const rows = await db.select().from(memories).where(eq(memories.id, data.id)).all();
    return rows[0];
  });

export const bulkDeleteMemories = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { ids: string[] } => {
    const d = data as { ids: string[] };
    if (!Array.isArray(d.ids) || d.ids.length === 0) throw new Error("ids must be a non-empty array");
    return { ids: d.ids.filter((id) => typeof id === "string") };
  })
  .handler(async ({ data, context }): Promise<{ deleted: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = getDb(env);

    const CHUNK = 10;
    for (let i = 0; i < data.ids.length; i += CHUNK) {
      const chunk = data.ids.slice(i, i + CHUNK);
      await db.delete(memories).where(sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`);
    }

    const VECTOR_CHUNK = 100;
    for (let i = 0; i < data.ids.length; i += VECTOR_CHUNK) {
      const chunk = data.ids.slice(i, i + VECTOR_CHUNK);
      console.log("[bulkDeleteMemories] deleting", chunk.length, "vectors:", chunk.slice(0, 3).join(","));
      await env.VECTOR_INDEX.deleteByIds(chunk);
    }
    console.log("[bulkDeleteMemories] deleted", data.ids.length, "memories from D1 and Vectorize");

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
      .where(sql`${memories.id} IN (${sql.join(ids.map((id: string) => sql`${id}`), sql`, `)})`)
      .all();

    const idOrder = new Map(ids.map((id: string, i: number) => [id, i]));
    return rows.sort(
      (a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999)
    );
  });

export const nukeEverything = createServerFn({ method: "POST" }).handler(
  async ({ context }): Promise<{ success: boolean; dbDeleted: number; vectorsDeleted: number }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = getDb(env);

    // Delete all from D1
    const dbRows = await db.select({ id: memories.id }).from(memories).all();
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
      console.log(`[nukeEverything] deleted ${dbDeleted} memories from D1`);
    }

    // Delete vectors by the IDs we already fetched from D1 (the primary source of truth)
    let vectorsDeleted = 0;

    if (dbIds.length > 0) {
      const VECTOR_CHUNK = 100;
      for (let i = 0; i < dbIds.length; i += VECTOR_CHUNK) {
        const chunk = dbIds.slice(i, i + VECTOR_CHUNK);
        console.log(`[nukeEverything] deleting chunk of ${chunk.length} vectors`);
        await env.VECTOR_INDEX.deleteByIds(chunk);
      }
      vectorsDeleted = dbIds.length;
      console.log(`[nukeEverything] deleted ${vectorsDeleted} vectors from Vectorize`);
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
    const db = getDb(env);

    // 1. Fetch all memories from database
    const allMemories = await db.select().from(memories).all();
    if (allMemories.length <= 1) {
      return { groups: [] };
    }

    // 2. Generate embeddings for all memories (in chunks of 10 to avoid rate limits)
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
            console.error(`[scanDatabaseDuplicates] failed to generate embedding for ${m.id}:`, err);
          }
        })
      );
    }

    // 3. Query Vectorize for each memory to find potential duplicates
    // We use a lower threshold (0.82) to get all candidates, which we'll later filter using the LLM.
    const CANDIDATE_THRESHOLD = 0.82;
    const rawMatches = new Map<string, string[]>(); // map of memory ID -> list of duplicate memory IDs

    const memoriesMap = new Map<string, Memory>(allMemories.map((m) => [m.id, m]));

    for (let i = 0; i < allMemories.length; i += CHUNK_SIZE) {
      const chunk = allMemories.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (m) => {
          const vec = embeddingsMap.get(m.id);
          if (!vec) return;
          try {
            // Find top 3 nearest vectors (excluding itself)
            const result = await env.VECTOR_INDEX.query(vec, { topK: 4, returnMetadata: false });
            const similarIds = (result.matches ?? [])
              .filter((match) => match && match.id !== m.id && match.score >= CANDIDATE_THRESHOLD)
              .map((match) => match.id)
              // Ensure the match actually exists in our database
              .filter((id) => memoriesMap.has(id));
            if (similarIds.length > 0) {
              rawMatches.set(m.id, similarIds);
            }
          } catch (err) {
            console.error(`[scanDatabaseDuplicates] query failed for ${m.id}:`, err);
          }
        })
      );
    }

    // 4. Cluster them into groups to avoid duplicate comparisons
    // If A matches B and B matches A, we only want one cluster [A, B]
    const groupedIds = new Set<string>();
    const initialGroups: { primaryId: string; duplicateIds: string[] }[] = [];

    for (const m of allMemories) {
      if (groupedIds.has(m.id)) continue;
      const simIds = rawMatches.get(m.id) ?? [];
      const unassignedSimIds = simIds.filter((id) => !groupedIds.has(id));
      if (unassignedSimIds.length > 0) {
        groupedIds.add(m.id);
        unassignedSimIds.forEach((id) => groupedIds.add(id));
        initialGroups.push({
          primaryId: m.id,
          duplicateIds: unassignedSimIds,
        });
      }
    }

    if (initialGroups.length === 0) {
      return { groups: [] };
    }

    // 5. Use the LLM to verify duplicates within each group
    // We send groups to Llama in batches (say, 5 groups per batch) to keep prompts readable.
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
            if (dupes.length > 0) {
              verifiedGroups.push({ primary: p, duplicates: dupes });
            }
          }
        }
      } catch (err) {
        console.error(`[scanDatabaseDuplicates] LLM verification failed for batch ${i}:`, err);
        // Fallback: assume all candidate IDs >= 0.98 cosine similarity are duplicates
        for (const g of batch) {
          const p = memoriesMap.get(g.primaryId);
          if (!p) continue;
          const dupes: Memory[] = [];
          for (const id of g.duplicateIds) {
            const c = memoriesMap.get(id);
            if (!c) continue;
            const pVec = embeddingsMap.get(p.id);
            const cVec = embeddingsMap.get(c.id);
            if (pVec && cVec && cosineSimilarity(pVec, cVec) >= 0.98) {
              dupes.push(c);
            }
          }
          if (dupes.length > 0) {
            verifiedGroups.push({ primary: p, duplicates: dupes });
          }
        }
      }
    }

    return { groups: verifiedGroups };
  });

export const getProfile = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<{ name: string; location: string }> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const db = getDb(env);

    const rows = await db.select().from(memories).all();
    const nameRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-name")
    );
    const locRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-location")
    );

    let name = "";
    if (nameRow) {
      name = nameRow.fact.replace(/^Name is\s+/i, "").trim();
    }

    let location = "";
    if (locRow) {
      location = locRow.fact.replace(/^Location is\s+/i, "").trim();
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
    const db = getDb(env);

    const rows = await db.select().from(memories).all();
    const nameRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-name")
    );
    const locRow = rows.find((r) =>
      r.tags.split(",").map((t) => t.trim()).includes("profile-location")
    );

    // Save Name memory
    if (data.name) {
      const fact = `Name is ${data.name}`;
      if (nameRow) {
        await db.update(memories).set({ fact }).where(eq(memories.id, nameRow.id));
        const embedding = await generateEmbedding(env.AI, fact);
        await env.VECTOR_INDEX.upsert([
          {
            id: nameRow.id,
            values: embedding,
            metadata: { category: "references", tags: "profile-name" } as Record<string, VectorizeVectorMetadata>,
          },
        ]);
      } else {
        const id = crypto.randomUUID();
        await db.insert(memories).values({
          id,
          fact,
          category: "references",
          tags: "profile-name",
          timestamp: Date.now(),
        });
        const embedding = await generateEmbedding(env.AI, fact);
        await env.VECTOR_INDEX.insert([
          {
            id,
            values: embedding,
            metadata: { category: "references", tags: "profile-name" } as Record<string, VectorizeVectorMetadata>,
          },
        ]);
      }
    } else if (nameRow) {
      await db.delete(memories).where(eq(memories.id, nameRow.id));
      await env.VECTOR_INDEX.deleteByIds([nameRow.id]);
    }

    // Save Location memory
    if (data.location) {
      const fact = `Location is ${data.location}`;
      if (locRow) {
        await db.update(memories).set({ fact }).where(eq(memories.id, locRow.id));
        const embedding = await generateEmbedding(env.AI, fact);
        await env.VECTOR_INDEX.upsert([
          {
            id: locRow.id,
            values: embedding,
            metadata: { category: "references", tags: "profile-location" } as Record<string, VectorizeVectorMetadata>,
          },
        ]);
      } else {
        const id = crypto.randomUUID();
        await db.insert(memories).values({
          id,
          fact,
          category: "references",
          tags: "profile-location",
          timestamp: Date.now(),
        });
        const embedding = await generateEmbedding(env.AI, fact);
        await env.VECTOR_INDEX.insert([
          {
            id,
            values: embedding,
            metadata: { category: "references", tags: "profile-location" } as Record<string, VectorizeVectorMetadata>,
          },
        ]);
      }
    } else if (locRow) {
      await db.delete(memories).where(eq(memories.id, locRow.id));
      await env.VECTOR_INDEX.deleteByIds([locRow.id]);
    }

    return { success: true };
  });
