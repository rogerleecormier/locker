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

- rules: explicit instructions, preferences, behavioral guidelines, "always do X", "never do Y", how I like things done, coding standards, tone/format preferences
- projects: active or recent work, features being built, bugs, tasks, deadlines, initiatives, apps or products I am building
- references: personal facts, identity, demographics, career history, education, relationships, location, certifications, tools I use, skills, financial info, anything that is background context about who I am

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

export const parseMemoriesWithAI = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): { text: string } => {
    const d = data as { text: string };
    if (!d.text || typeof d.text !== "string") throw new Error("text is required");
    return { text: d.text.trim() };
  })
  .handler(async ({ data, context }): Promise<Array<{ fact: string; category?: string; tags?: string }>> => {
    const { env } = (context as unknown as CFContext).cloudflare;

    const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        {
          role: "system",
          content: `You extract discrete memory facts from raw text. Output ONLY a JSON array of strings — one string per fact. No explanation, no markdown, no code fences. Just the raw JSON array.

Example: ["The user lives in Florida","The user is a PMP-certified project manager","The user prefers concise answers"]

Rules:
- Strip all formatting: headers, bullets, dashes, date prefixes like [2025-01-01], bold markdown (**text**), evidence lines, "Imported from:" lines
- Each entry must be one clean self-contained sentence
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
    await env.VECTOR_INDEX.insert([
      {
        id,
        values: embedding,
        metadata: { category: data.category, tags: data.tags } as Record<string, VectorizeVectorMetadata>,
      },
    ]);

    return { ...newRow, tags: newRow.tags ?? "" };
  });

type BatchImportItem = { fact: string; category?: string; tags?: string };

export const batchImportMemories = createServerFn({ method: "POST" })
  .inputValidator((data: unknown): BatchImportItem[] => {
    if (!Array.isArray(data)) throw new Error("Input must be an array");
    return (data as BatchImportItem[]).map((item) => ({
      fact: String(item.fact || "").trim(),
      category: item.category,
      tags: item.tags,
    }));
  })
  .handler(async ({ data, context }): Promise<{ imported: number }> => {
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
    if (valid.length === 0) return { imported: 0 };

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

    // deduplicate against existing vectors — skip anything with cosine similarity >= 0.92
    const DUPE_THRESHOLD = 0.92;
    const dupeFlags = await Promise.all(
      embeddings.map(async (vec) => {
        const result = await env.VECTOR_INDEX.query(vec, { topK: 1, returnMetadata: false });
        const top = result.matches?.[0];
        return top !== undefined && top.score >= DUPE_THRESHOLD;
      })
    );

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
      await env.VECTOR_INDEX.insert(vectorBatch.slice(i, i + VECTOR_CHUNK));
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
