import { drizzle } from "drizzle-orm/d1";
import { eq, sql, and, desc } from "drizzle-orm";
import { memories, apiTokens, oauthAccessTokensV2, MCP_PERM_RECALL, MCP_PERM_COMMIT } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { hashToken } from "~/server/crypto";
import { decrypt, isEncrypted } from "~/server/crypto";
import { encrypt } from "~/server/crypto";
import { createAuth } from "~/server/auth";

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

async function decryptFact(stored: string, encKey: string): Promise<string> {
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

async function archiveContradictingMemories(
  db: any,
  env: CloudflareEnv,
  userId: string,
  newFact: string,
  embedding: number[],
  projectKey: string | undefined
): Promise<void> {
  if (!userId) throw new Error("Unauthorized: userId is required for vector query");

  const filter: Record<string, any> = { userId };
  if (projectKey) {
    filter.projectKey = { $in: [projectKey, ""] };
  } else {
    filter.projectKey = "";
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

  const rows = await db
    .select()
    .from(memories)
    .where(
      sql`${memories.id} IN (${sql.join(candidateIds.map((id) => sql`${id}`), sql`, `)}) AND ${memories.userId} = ${userId} AND ${memories.isActive} = 1`
    )
    .all();

  if (rows.length === 0) return;

  const decryptedCandidates = await Promise.all(
    rows.map(async (r: any) => ({
      id: r.id,
      fact: await decryptFact(r.fact, env.ENCRYPTION_KEY),
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
          await db
            .update(memories)
            .set({ isActive: false })
            .where(
              sql`${memories.id} IN (${sql.join(validIdsToArchive.map((id) => sql`${id}`), sql`, `)})`
            )
            .run();
        }
      }
    }
  } catch (err) {
    console.error("[archiveContradictingMemories] failed:", err);
  }
}

const MCP_MANIFEST = {
  jsonrpc: "2.0",
  result: {
    protocolVersion: "2024-11-05",
    serverInfo: { name: "locker", version: "1.0.0" },
    capabilities: { tools: {} },
  },
};

const ALL_TOOLS = [
  {
    name: "recall_context",
    description:
      "Semantic search over stored long-term memory. Returns facts ranked by cosine similarity.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query." },
        topK: { type: "number", description: "Max results (default: 5)." },
        category: { type: "string", enum: ["rules", "projects", "references"], description: "Optional category filter." },
        tag: { type: "string", description: "Optional tag filter (case-insensitive)." },
        keyword: { type: "string", description: "Optional exact substring filter (case-insensitive)." },
        projectKey: { type: "string", description: "Optional project workspace key (e.g. repository hash or folder slug)." },
        isActive: { type: "boolean", description: "Filter by active status. Defaults to true." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_memories",
    description: "List and filter stored long-term memories. Useful for retrieving all rules, scanning projects, or finding memories by exact keyword or tag matching without semantic similarity.",
    inputSchema: {
      type: "object",
      properties: {
        category: { type: "string", enum: ["rules", "projects", "references"], description: "Filter by category." },
        tag: { type: "string", description: "Filter by tag (case-insensitive)." },
        keyword: { type: "string", description: "Case-insensitive substring search within facts." },
        limit: { type: "number", description: "Max results to return (default: 50, max: 200)." },
        offset: { type: "number", description: "Pagination offset (default: 0)." },
        projectKey: { type: "string", description: "Optional project workspace key to scope memories." },
        isActive: { type: "boolean", description: "Filter by active status. Defaults to true." },
      },
    },
  },
  {
    name: "get_memory_summary",
    description: "Get counts of memories by category and a list of all unique tags with their frequency counts. Helps the chatbot understand what context is available in the memory store.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
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
        projectKey: { type: "string", description: "Optional project workspace key to scope this memory." },
      },
      required: ["fact"],
    },
  },
  {
    name: "update_memory",
    description: "Update an existing memory fact, category, or tags by its unique ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The unique ID of the memory to update." },
        fact: { type: "string", description: "The updated factual statement." },
        category: { type: "string", enum: ["rules", "projects", "references"], description: "Optional updated category." },
        tags: { type: "string", description: "Optional updated comma-separated keywords/tags." },
      },
      required: ["id", "fact"],
    },
  },
  {
    name: "delete_memory",
    description: "Delete an existing memory by its unique ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The unique ID of the memory to delete." },
      },
      required: ["id"],
    },
  },
];

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
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

type TokenClaims = {
  userId: string;
  tokenId: string;
  permissions: number;
};

async function validateBearerToken(
  request: Request,
  env: CloudflareEnv
): Promise<TokenClaims | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const rawToken = authHeader.slice(7).trim();

  // API token path (lkr_ prefix)
  if (rawToken.startsWith("lkr_")) {
    const tokenHash = await hashToken(rawToken);
    const db = drizzle(env.DB, { schema: { apiTokens } });

    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, tokenHash))
      .all();

    if (!rows.length) return null;
    const token = rows[0];

    db.update(apiTokens)
      .set({ lastUsedAt: Date.now() })
      .where(eq(apiTokens.id, token.id))
      .run()
      .catch(() => {});

    return {
      userId: token.userId,
      tokenId: token.id,
      permissions: token.permissions,
    };
  }

  // OAuth JWT path — validate via userinfo endpoint internally (JWT plugin uses separate key from JWKS)
  if (rawToken.startsWith("eyJ")) {
    try {
      const auth = createAuth(env);
      const userinfoReq = new Request(`${env.BETTER_AUTH_URL}/api/auth/oauth2/userinfo`, {
        method: "GET",
        headers: { Authorization: `Bearer ${rawToken}` },
      });
      const res = await auth.handler(userinfoReq);
      if (!res.ok) {
        console.log("[jwt] userinfo rejected:", res.status);
        return null;
      }
      const info = await res.json() as { sub?: string };
      const userId = info.sub;
      if (!userId) return null;
      console.log("[jwt] accepted via userinfo for userId:", userId);
      return { userId, tokenId: userId, permissions: MCP_PERM_RECALL | MCP_PERM_COMMIT };
    } catch (e) {
      console.log("[jwt] userinfo exception:", String(e));
      return null;
    }
  }

  // OAuth opaque access token path (@better-auth/oauth-provider)
  const db = drizzle(env.DB, { schema: { oauthAccessTokensV2 } });
  const rows = await db
    .select()
    .from(oauthAccessTokensV2)
    .where(eq(oauthAccessTokensV2.token, rawToken))
    .all();

  if (!rows.length) return null;
  const oauthToken = rows[0];

  if (!oauthToken.userId) return null;
  if (oauthToken.expiresAt && oauthToken.expiresAt.getTime() < Date.now()) return null;

  return {
    userId: oauthToken.userId,
    tokenId: oauthToken.id,
    permissions: MCP_PERM_RECALL | MCP_PERM_COMMIT,
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

  const authHeader = request.headers.get("Authorization");
  let authType = "NONE";
  let tokenLength = 0;
  if (authHeader) {
    if (authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      tokenLength = token.length;
      if (token.startsWith("lkr_")) {
        authType = "lkr_ API Key";
      } else if (token.startsWith("eyJ")) {
        authType = "OAuth JWT (eyJ)";
      } else {
        authType = "Opaque OAuth";
      }
    } else {
      authType = "Invalid Scheme";
    }
  }
  console.log(`[mcp] method: ${request.method} auth type: ${authType} length: ${tokenLength}`);

  // Validate API token
  const claims = await validateBearerToken(request, env);
  if (!claims) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: valid Bearer token required" } },
      {
        status: 401,
        headers: {
          ...headers,
          "WWW-Authenticate": `Bearer resource_metadata="${env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource", scope="openid profile email offline_access"`,
        },
      }
    );
  }

  if (request.method === "GET") {
    const allowedTools = ALL_TOOLS.filter((t) => {
      if (t.name === "recall_context" || t.name === "search_memories" || t.name === "get_memory_summary") return !!(claims.permissions & MCP_PERM_RECALL);
      if (t.name === "commit_memory" || t.name === "update_memory" || t.name === "delete_memory") {
        return !!(claims.permissions & MCP_PERM_COMMIT);
      }
      return false;
    });
    return new Response(
      JSON.stringify({ ...MCP_MANIFEST, result: { ...MCP_MANIFEST.result, tools: allowedTools } }),
      { headers: { "Content-Type": "application/json", ...headers } }
    );
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
  console.log("[mcp] rpc method:", method, "id:", id);
  const db = drizzle(env.DB, { schema: { memories } });

  if (method === "initialize") {
    const sessionId = crypto.randomUUID();
    return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: MCP_MANIFEST.result }), {
      headers: {
        "Content-Type": "application/json",
        "Mcp-Session-Id": sessionId,
        ...headers,
      },
    });
  }

  // Notifications (no id, no response needed)
  if (method === "notifications/initialized" || (method && method.startsWith("notifications/"))) {
    return new Response(null, { status: 202, headers });
  }

  if (method === "tools/list") {
    const allowedTools = ALL_TOOLS.filter((t) => {
      if (t.name === "recall_context" || t.name === "search_memories" || t.name === "get_memory_summary") return !!(claims.permissions & MCP_PERM_RECALL);
      if (t.name === "commit_memory" || t.name === "update_memory" || t.name === "delete_memory") {
        return !!(claims.permissions & MCP_PERM_COMMIT);
      }
      return false;
    });
    return mcpResult(id, { tools: allowedTools });
  }

  if (method !== "tools/call") {
    return mcpError(id, -32601, `Method not found: ${method}`);
  }

  const toolName = params?.name;
  const args = params?.arguments ?? {};

  if (toolName === "recall_context") {
    if (!(claims.permissions & MCP_PERM_RECALL)) {
      return mcpError(id, -32001, "Token does not have recall_context permission");
    }

    const query = args.query as string | undefined;
    if (!query || typeof query !== "string") {
      return mcpError(id, -32602, "Invalid params: query is required");
    }
    const topK = typeof args.topK === "number" ? args.topK : 5;
    const category = args.category as string | undefined;
    const tag = args.tag as string | undefined;
    const keyword = args.keyword as string | undefined;
    const projectKey = args.projectKey as string | undefined;
    const isActive = typeof args.isActive === "boolean" ? args.isActive : true;

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required for vector query");
    }

    const embedding = await generateEmbedding(env.AI, query.trim());
    const vectorTopK = (category || tag || keyword)
      ? Math.min(20, topK * 3)
      : Math.min(20, topK);

    const filter: Record<string, any> = { userId: claims.userId };
    if (projectKey) {
      filter.projectKey = { $in: [projectKey, ""] };
    } else {
      filter.projectKey = "";
    }

    const vectorResults = await env.VECTOR_INDEX.query(embedding, {
      topK: vectorTopK,
      filter,
      returnMetadata: "none",
    });

    if (!vectorResults.matches?.length) {
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify([]) }] });
    }

    const ids = vectorResults.matches.map((m) => m.id);
    const conditions = [
      sql`${memories.id} IN (${sql.join(ids.map((dbId) => sql`${dbId}`), sql`, `)})`,
      eq(memories.userId, claims.userId),
    ];
    if (isActive !== undefined) {
      conditions.push(eq(memories.isActive, isActive));
    }
    if (projectKey) {
      conditions.push(
        sql`(${memories.projectKey} = ${projectKey} OR ${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
      );
    } else {
      conditions.push(
        sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
      );
    }

    const rows = await db
      .select()
      .from(memories)
      .where(and(...conditions))
      .all();

    // Decrypt facts before returning
    const decrypted = await Promise.all(
      rows.map(async (r) => ({ ...r, fact: await decryptFact(r.fact, env.ENCRYPTION_KEY) }))
    );

    // Filter decrypted facts
    let filtered = decrypted;
    if (category) {
      filtered = filtered.filter((r) => r.category === category);
    }
    if (tag) {
      const lowerTag = tag.toLowerCase().trim();
      filtered = filtered.filter((r) => 
        r.tags.split(",").map((t) => t.trim().toLowerCase()).includes(lowerTag)
      );
    }
    if (keyword) {
      const lowerKw = keyword.toLowerCase().trim();
      filtered = filtered.filter((r) => r.fact.toLowerCase().includes(lowerKw));
    }

    const idOrder = new Map(ids.map((dbId, i) => [dbId, i]));
    const ranked = filtered.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
    const finalResults = ranked.slice(0, topK);

    return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(finalResults) }] });
  }

  if (toolName === "search_memories") {
    if (!(claims.permissions & MCP_PERM_RECALL)) {
      return mcpError(id, -32001, "Token does not have recall_context permission");
    }

    const category = args.category as string | undefined;
    const tag = args.tag as string | undefined;
    const keyword = args.keyword as string | undefined;
    const limit = typeof args.limit === "number" ? Math.min(200, Math.max(1, args.limit)) : 50;
    const offset = typeof args.offset === "number" ? Math.max(0, args.offset) : 0;
    const projectKey = args.projectKey as string | undefined;
    const isActive = typeof args.isActive === "boolean" ? args.isActive : true;

    const conditions = [eq(memories.userId, claims.userId)];
    if (category) {
      conditions.push(eq(memories.category, category as "rules" | "projects" | "references"));
    }
    if (isActive !== undefined) {
      conditions.push(eq(memories.isActive, isActive));
    }
    if (projectKey) {
      conditions.push(
        sql`(${memories.projectKey} = ${projectKey} OR ${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
      );
    } else {
      conditions.push(
        sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
      );
    }

    const rows = await db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.timestamp))
      .all();

    // Decrypt
    const decrypted = await Promise.all(
      rows.map(async (r) => ({ ...r, fact: await decryptFact(r.fact, env.ENCRYPTION_KEY) }))
    );

    // Filter in memory for tag and keyword
    let filtered = decrypted;
    if (tag) {
      const lowerTag = tag.toLowerCase().trim();
      filtered = filtered.filter((r) => 
        r.tags.split(",").map((t) => t.trim().toLowerCase()).includes(lowerTag)
      );
    }
    if (keyword) {
      const lowerKw = keyword.toLowerCase().trim();
      filtered = filtered.filter((r) => r.fact.toLowerCase().includes(lowerKw));
    }

    const paginated = filtered.slice(offset, offset + limit);

    return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(paginated) }] });
  }

  if (toolName === "get_memory_summary") {
    if (!(claims.permissions & MCP_PERM_RECALL)) {
      return mcpError(id, -32001, "Token does not have recall_context permission");
    }

    const rows = await db
      .select({ category: memories.category, tags: memories.tags })
      .from(memories)
      .where(eq(memories.userId, claims.userId))
      .all();

    const summary = {
      total: rows.length,
      categories: {
        rules: 0,
        projects: 0,
        references: 0,
      },
      tags: {} as Record<string, number>,
    };

    for (const row of rows) {
      if (row.category in summary.categories) {
        summary.categories[row.category as "rules" | "projects" | "references"]++;
      }
      if (row.tags) {
        const tagsList = row.tags.split(",").map((t) => t.trim()).filter(Boolean);
        for (const t of tagsList) {
          summary.tags[t] = (summary.tags[t] ?? 0) + 1;
        }
      }
    }

    return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(summary) }] });
  }

  if (toolName === "commit_memory") {
    if (!(claims.permissions & MCP_PERM_COMMIT)) {
      return mcpError(id, -32001, "Token does not have commit_memory permission");
    }

    const fact = args.fact as string | undefined;
    if (!fact || typeof fact !== "string") {
      return mcpError(id, -32602, "Invalid params: fact is required");
    }
    const category = normalizeCategory(args.category as string | undefined);
    const source = typeof args.source === "string" ? args.source.trim().toLowerCase() : "mcp";
    const rawTags = typeof args.tags === "string" ? args.tags.trim() : "";
    const projectKey = args.projectKey as string | undefined;

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required for vector insert");
    }

    const tagsList = rawTags.split(",").map(t => t.trim()).filter(Boolean);
    if (!tagsList.includes(source)) tagsList.push(source);
    const finalTags = tagsList.join(", ");

    const memId = crypto.randomUUID();
    const timestamp = Date.now();
    const embedding = await generateEmbedding(env.AI, fact.trim());
    const encryptedFact = await encrypt(fact.trim(), env.ENCRYPTION_KEY);

    // Archive contradicted memories before inserting the new one
    await archiveContradictingMemories(db, env, claims.userId, fact.trim(), embedding, projectKey);

    await db.insert(memories).values({
      id: memId,
      userId: claims.userId,
      fact: encryptedFact,
      category,
      tags: finalTags,
      timestamp,
      isActive: true,
      projectKey: projectKey || null,
    });
    await env.VECTOR_INDEX.insert([
      {
        id: memId,
        values: embedding,
        metadata: {
          userId: claims.userId,
          category,
          tags: finalTags,
          projectKey: projectKey ?? "",
        },
      },
    ]);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, id: memId, fact: fact.trim(), category, tags: finalTags, projectKey }) },
      ],
    });
  }

  if (toolName === "update_memory") {
    if (!(claims.permissions & MCP_PERM_COMMIT)) {
      return mcpError(id, -32001, "Token does not have commit_memory permission");
    }

    const memId = args.id as string | undefined;
    const fact = args.fact as string | undefined;
    if (!memId || typeof memId !== "string") {
      return mcpError(id, -32602, "Invalid params: id is required");
    }
    if (!fact || typeof fact !== "string") {
      return mcpError(id, -32602, "Invalid params: fact is required");
    }

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required for vector upsert");
    }

    // Fetch existing memory to get defaults for category/tags if not provided
    const rows = await db
      .select()
      .from(memories)
      .where(sql`${memories.id} = ${memId} AND ${memories.userId} = ${claims.userId}`)
      .all();

    if (!rows.length) {
      return mcpError(id, -32602, `Memory not found or unauthorized: ${memId}`);
    }
    const existing = rows[0];

    const category = args.category !== undefined 
      ? normalizeCategory(args.category as string | undefined)
      : existing.category;

    const rawTags = args.tags !== undefined
      ? (typeof args.tags === "string" ? args.tags.trim() : "")
      : existing.tags;

    const embedding = await generateEmbedding(env.AI, fact.trim());
    const encryptedFact = await encrypt(fact.trim(), env.ENCRYPTION_KEY);

    await db.update(memories)
      .set({
        fact: encryptedFact,
        category,
        tags: rawTags,
      })
      .where(sql`${memories.id} = ${memId} AND ${memories.userId} = ${claims.userId}`);

    await env.VECTOR_INDEX.upsert([
      {
        id: memId,
        values: embedding,
        metadata: {
          userId: claims.userId,
          category,
          tags: rawTags,
          projectKey: existing.projectKey ?? "",
        },
      },
    ]);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, id: memId, fact: fact.trim(), category, tags: rawTags }) },
      ],
    });
  }

  if (toolName === "delete_memory") {
    if (!(claims.permissions & MCP_PERM_COMMIT)) {
      return mcpError(id, -32001, "Token does not have commit_memory permission");
    }

    const memId = args.id as string | undefined;
    if (!memId || typeof memId !== "string") {
      return mcpError(id, -32602, "Invalid params: id is required");
    }

    // Delete from DB and Vectorize
    await db.delete(memories).where(sql`${memories.id} = ${memId} AND ${memories.userId} = ${claims.userId}`);
    await env.VECTOR_INDEX.deleteByIds([memId]);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, id: memId }) },
      ],
    });
  }

  return mcpError(id, -32602, `Unknown tool: ${toolName}`);
}
