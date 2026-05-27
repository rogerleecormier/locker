import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import { memories } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";

type EmbeddingResponse = {
  shape: number[][];
  data: number[][];
};

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = (await ai.run("@cf/baai/bge-m3", {
    text: [text],
  })) as EmbeddingResponse;
  return result.data[0];
}

function normalizeCategory(raw: string | undefined): "rules" | "projects" | "references" {
  if (raw === "rules" || raw === "projects" || raw === "references") return raw;
  return "references";
}

const MCP_MANIFEST = {
  jsonrpc: "2.0",
  result: {
    protocolVersion: "2024-11-05",
    serverInfo: { name: "locker", version: "1.0.0" },
    capabilities: { tools: {} },
  },
};

const TOOLS_LIST = {
  tools: [
    {
      name: "recall_context",
      description:
        "Semantic search over stored long-term memory. Returns facts ranked by cosine similarity.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Natural-language search query." },
          topK: { type: "number", description: "Max results (default: 5)." },
        },
        required: ["query"],
      },
    },
    {
      name: "commit_memory",
      description: "Persist a new fact into long-term memory.",
      inputSchema: {
        type: "object",
        properties: {
          fact: { type: "string", description: "The factual statement to store." },
          category: { type: "string", enum: ["rules", "projects", "references"] },
          tags: { type: "string", description: "Comma-separated keywords." },
          source: { type: "string", description: "The source chatbot or origin (e.g. chatgpt, claude). Defaults to mcp." },
        },
        required: ["fact"],
      },
    },
  ],
};

function mcpError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

function mcpResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export async function handleMcpRequest(
  request: Request,
  env: CloudflareEnv
): Promise<Response> {
  const origin = request.headers.get("origin") ?? "*";
  const headers = corsHeaders(origin);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }

  if (request.method === "GET") {
    return new Response(JSON.stringify(MCP_MANIFEST), {
      headers: { "Content-Type": "application/json", ...headers },
    });
  }

  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers });
  }

  let body: {
    jsonrpc?: string;
    id?: unknown;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };

  try {
    body = await request.json();
  } catch {
    return mcpError(null, -32700, "Parse error: invalid JSON");
  }

  const { id, method, params } = body;
  const db = drizzle(env.DB, { schema: { memories } });

  if (method === "initialize") {
    return mcpResult(id, MCP_MANIFEST.result);
  }

  if (method === "tools/list") {
    return mcpResult(id, TOOLS_LIST);
  }

  if (method !== "tools/call") {
    return mcpError(id, -32601, `Method not found: ${method}`);
  }

  const toolName = params?.name;
  const args = params?.arguments ?? {};

  if (toolName === "recall_context") {
    const query = args.query as string | undefined;
    if (!query || typeof query !== "string") {
      return mcpError(id, -32602, "Invalid params: query is required");
    }
    const topK = typeof args.topK === "number" ? args.topK : 5;
    const embedding = await generateEmbedding(env.AI, query.trim());
    const vectorResults = await env.VECTOR_INDEX.query(embedding, {
      topK,
      returnMetadata: false,
    });

    if (!vectorResults.matches?.length) {
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify([]) }] });
    }

    const ids = vectorResults.matches.map((m) => m.id);
    const rows = await db
      .select()
      .from(memories)
      .where(sql`${memories.id} IN (${sql.join(ids.map((dbId) => sql`${dbId}`), sql`, `)})`)
      .all();

    const idOrder = new Map(ids.map((dbId, i) => [dbId, i]));
    const ranked = rows.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));

    return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(ranked) }] });
  }

  if (toolName === "commit_memory") {
    const fact = args.fact as string | undefined;
    if (!fact || typeof fact !== "string") {
      return mcpError(id, -32602, "Invalid params: fact is required");
    }
    const category = normalizeCategory(args.category as string | undefined);
    const source = typeof args.source === "string" ? args.source.trim().toLowerCase() : "mcp";
    const rawTags = typeof args.tags === "string" ? args.tags.trim() : "";

    const tagsList = rawTags.split(",").map(t => t.trim()).filter(Boolean);
    if (!tagsList.includes(source)) {
      tagsList.push(source);
    }
    const finalTags = tagsList.join(", ");

    const memId = crypto.randomUUID();
    const timestamp = Date.now();
    const embedding = await generateEmbedding(env.AI, fact.trim());

    await db.insert(memories).values({ id: memId, fact: fact.trim(), category, tags: finalTags, timestamp });
    await env.VECTOR_INDEX.insert([
      { id: memId, values: embedding, metadata: { category, tags: finalTags } },
    ]);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, id: memId, fact: fact.trim(), category, tags: finalTags }) },
      ],
    });
  }

  if (toolName === "debug_vectorize") {
    try {
      console.log("[debug] VECTOR_INDEX type:", typeof env.VECTOR_INDEX);
      const testVec = new Array(1024).fill(0.1);
      const insertRes = await env.VECTOR_INDEX.insert([
        { id: "debug-test-" + Date.now(), values: testVec, metadata: { test: "true" } },
      ]);
      console.log("[debug] insert result:", insertRes);

      const queryRes = await env.VECTOR_INDEX.query(testVec, { topK: 5, returnMetadata: false });
      console.log("[debug] query result:", queryRes);

      return mcpResult(id, {
        content: [{ type: "text", text: JSON.stringify({ insertRes, queryRes }) }],
      });
    } catch (err) {
      console.error("[debug] error:", err);
      return mcpError(id, -32603, `Vectorize test failed: ${String(err)}`);
    }
  }

  return mcpError(id, -32602, `Unknown tool: ${toolName}`);
}
