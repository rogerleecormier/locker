import { createServerFn } from "@tanstack/react-start";
import { drizzle } from "drizzle-orm/d1";
import { desc, sql } from "drizzle-orm";
import { memories, type Memory, type NewMemory } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

type EmbeddingResponse = {
  shape: number[];
  data: number[][];
};

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = (await ai.run("@cf/baai/bge-m3", {
    text: [text],
  })) as EmbeddingResponse;
  return result.data[0];
}

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memories } });
}

function normalizeCategory(raw: string | undefined): "rules" | "projects" | "references" {
  if (raw === "rules" || raw === "projects" || raw === "references") return raw;
  return "references";
}

type AiTextResponse = { response?: string };

async function classifyMemories(
  ai: Ai,
  facts: string[]
): Promise<Array<"rules" | "projects" | "references">> {
  if (facts.length === 0) return [];

  const numbered = facts.map((f, i) => `${i + 1}. ${f}`).join("\n");
  const prompt = `Classify each memory into exactly one category: rules, projects, or references.

- rules: preferences, behaviors, constraints, coding standards, how I like things done
- projects: active work, features, bugs, tasks, deadlines, initiatives
- references: links, tools, services, credentials, external resources, facts to look up

Respond with ONLY a JSON array of strings in order, one per item. Example: ["rules","projects","references"]

Memories:
${numbered}`;

  const result = (await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
    prompt,
    max_tokens: 256,
  })) as AiTextResponse;

  const text = result.response?.trim() ?? "";
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return facts.map(() => "references" as const);

  try {
    const parsed: unknown[] = JSON.parse(match[0]);
    return facts.map((_, i) => normalizeCategory(parsed[i] as string | undefined));
  } catch {
    return facts.map(() => "references" as const);
  }
}

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

    const valid = data.filter((item) => item.fact.length > 0);
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

    const [embeddings] = await Promise.all([
      Promise.all(valid.map((item) => generateEmbedding(env.AI, item.fact))),
    ]);

    const timestamp = Date.now();
    const rows: NewMemory[] = valid.map((item, i) => ({
      id: crypto.randomUUID(),
      fact: item.fact,
      category: resolvedCategories[i] ?? normalizeCategory(item.category),
      tags: item.tags?.trim() ?? "",
      timestamp,
    }));

    const CHUNK_SIZE = 25;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await db.insert(memories).values(rows.slice(i, i + CHUNK_SIZE));
    }

    const vectorBatch: VectorizeVector[] = rows.map((row, idx) => ({
      id: row.id,
      values: embeddings[idx],
      metadata: {
        category: row.category,
        tags: row.tags ?? "",
      } as Record<string, VectorizeVectorMetadata>,
    }));

    const VECTOR_CHUNK = 100;
    for (let i = 0; i < vectorBatch.length; i += VECTOR_CHUNK) {
      await env.VECTOR_INDEX.insert(vectorBatch.slice(i, i + VECTOR_CHUNK));
    }

    return { imported: rows.length };
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
      returnMetadata: "none",
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
