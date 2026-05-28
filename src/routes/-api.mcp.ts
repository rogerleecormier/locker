import { drizzle } from "drizzle-orm/d1";
import { eq, sql } from "drizzle-orm";
import { memories, apiTokens, oauthAccessTokens, MCP_PERM_RECALL, MCP_PERM_COMMIT } from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { hashToken } from "~/server/crypto";
import { decrypt, isEncrypted } from "~/server/crypto";
import { encrypt } from "~/server/crypto";

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

  // OAuth access token path
  const db = drizzle(env.DB, { schema: { oauthAccessTokens } });
  const rows = await db
    .select()
    .from(oauthAccessTokens)
    .where(eq(oauthAccessTokens.accessToken, rawToken))
    .all();

  console.log("[mcp/oauth] token lookup:", rawToken.slice(0, 8), "found:", rows.length);
  if (!rows.length) return null;
  const oauthToken = rows[0];

  console.log("[mcp/oauth] userId:", oauthToken.userId, "expires:", oauthToken.accessTokenExpiresAt, "now:", Date.now());
  if (!oauthToken.userId) return null;
  if (oauthToken.accessTokenExpiresAt.getTime() < Date.now()) return null;

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
  console.log("[mcp] method:", request.method, "auth header:", authHeader ? authHeader.slice(0, 20) : "NONE");

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
      if (t.name === "recall_context") return !!(claims.permissions & MCP_PERM_RECALL);
      if (t.name === "commit_memory") return !!(claims.permissions & MCP_PERM_COMMIT);
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
  const db = drizzle(env.DB, { schema: { memories } });

  if (method === "initialize") {
    return mcpResult(id, MCP_MANIFEST.result);
  }

  if (method === "tools/list") {
    const allowedTools = ALL_TOOLS.filter((t) => {
      if (t.name === "recall_context") return !!(claims.permissions & MCP_PERM_RECALL);
      if (t.name === "commit_memory") return !!(claims.permissions & MCP_PERM_COMMIT);
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
      .where(
        sql`${memories.id} IN (${sql.join(ids.map((dbId) => sql`${dbId}`), sql`, `)}) AND ${memories.userId} = ${claims.userId}`
      )
      .all();

    // Decrypt facts before returning
    const decrypted = await Promise.all(
      rows.map(async (r) => ({ ...r, fact: await decryptFact(r.fact, env.ENCRYPTION_KEY) }))
    );

    const idOrder = new Map(ids.map((dbId, i) => [dbId, i]));
    const ranked = decrypted.sort((a, b) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));

    return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(ranked) }] });
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

    const tagsList = rawTags.split(",").map(t => t.trim()).filter(Boolean);
    if (!tagsList.includes(source)) tagsList.push(source);
    const finalTags = tagsList.join(", ");

    const memId = crypto.randomUUID();
    const timestamp = Date.now();
    const embedding = await generateEmbedding(env.AI, fact.trim());
    const encryptedFact = await encrypt(fact.trim(), env.ENCRYPTION_KEY);

    await db.insert(memories).values({
      id: memId,
      userId: claims.userId,
      fact: encryptedFact,
      category,
      tags: finalTags,
      timestamp,
    });
    await env.VECTOR_INDEX.insert([
      { id: memId, values: embedding, metadata: { category, tags: finalTags } },
    ]);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, id: memId, fact: fact.trim(), category, tags: finalTags }) },
      ],
    });
  }

  return mcpError(id, -32602, `Unknown tool: ${toolName}`);
}
