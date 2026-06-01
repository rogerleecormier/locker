import { drizzle } from "drizzle-orm/d1";
import { eq, sql, and, desc, inArray } from "drizzle-orm";
import { memories, apiTokens, oauthAccessTokensV2, MCP_PERM_RECALL, MCP_PERM_COMMIT, MCP_PERM_UPDATE, MCP_PERM_DELETE, auditLogs, tokenUsages, orgQuotas, memoryVersions, organizations, organizationMembers, teamMembers, teams, jwks, rateLimitCounters } from "~/db/schema";
import { importJWK, jwtVerify } from "jose";
import type { CloudflareEnv } from "~/types/cloudflare";
import { hashToken, deriveUserKey } from "~/server/crypto";
import { decrypt, isEncrypted } from "~/server/crypto";
import { encrypt } from "~/server/crypto";
import { getUserOrg, verifyVaultAccess, checkQuota, logTokenUsage, logAudit, estimateEmbeddingTokens } from "~/server/enterprise";
import { PLANS } from "~/lib/plans";
import { getUserEffectivePlan } from "~/server/planGate";

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

const MCP_MANIFEST = {
  jsonrpc: "2.0",
  result: {
    protocolVersion: "2024-11-05",
    serverInfo: { name: "locker", version: "1.0.0" },
    capabilities: { tools: {} },
  },
};

export const ALL_TOOLS = [
  {
    name: "list_accessible_scopes",
    description:
      "List all locker scopes (personal, organizational, team) that this user can access. Use this to discover available workspaces before querying memories.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
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

function isProjectKeyAllowedByToken(
  accessibleScopes: Array<{ type: "personal" | "organization" | "team"; id: string | null }>,
  requestedProjectKey: string | undefined | null
): boolean {
  // If no projectKey specified, allow access to personal scope
  if (!requestedProjectKey) {
    return accessibleScopes.some((s) => s.type === "personal");
  }

  // Check if requestedProjectKey matches any accessible scope
  for (const scope of accessibleScopes) {
    if (scope.type === "personal") {
      // Personal scope allows personal projectKey (null/"")
      if (!requestedProjectKey || requestedProjectKey === "") {
        return true;
      }
    } else if (scope.type === "organization") {
      if (requestedProjectKey === `org:${scope.id}`) {
        return true;
      }
    } else if (scope.type === "team") {
      if (requestedProjectKey === `team:${scope.id}`) {
        return true;
      }
    }
  }

  return false;
}

function resolveProjectKey(
  claims: TokenClaims,
  requestedProjectKey: string | undefined | null
): string | undefined | null {
  if (!requestedProjectKey) {
    if (claims.scopeType === "organization" && claims.scopeId) {
      return `org:${claims.scopeId}`;
    }
    if (claims.scopeType === "team" && claims.scopeId) {
      return `team:${claims.scopeId}`;
    }
    return requestedProjectKey;
  }
  return requestedProjectKey;
}

function mcpError(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } });
}

function mcpResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}

function corsHeaders(origin: string, authHeader: string | null): Record<string, string> {
  // If using opaque OAuth token (cookie-based session), restrict to known origins
  // Bearer tokens (eyJ=JWT, lkr_=API key) are fine since they're explicitly provided
  let token: string | null = null;
  if (authHeader) {
    const authHeaderLower = authHeader.toLowerCase();
    if (authHeaderLower.startsWith("bearer ")) {
      token = authHeader.slice(7).trim();
    } else if (authHeader.trim().startsWith("lkr_")) {
      token = authHeader.trim();
    }
  }
  const isExplicitToken = token?.startsWith("eyJ") || token?.startsWith("lkr_");

  // For opaque tokens or unauthenticated requests from browsers, restrict CORS
  if (!isExplicitToken) {
    // Only allow CORS for requests from the same origin or explicitly whitelisted origins
    // This prevents malicious web pages from making write requests using stored OAuth sessions
    const knownOrigins = [
      "http://localhost:5173",
      "http://localhost:3000",
      ...(typeof process !== "undefined" && process.env.ALLOWED_ORIGINS?.split(",") || []),
    ];

    const allowedOrigin = knownOrigins.includes(origin) ? origin : "null";
    return {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };
  }

  // For Bearer tokens (JWT and API keys), allow any origin
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
  scopeType: "personal" | "organization" | "team";
  scopeId: string | null;
  accessibleScopes: Array<{ type: "personal" | "organization" | "team"; id: string | null }>;
};

async function validateBearerToken(
  request: Request,
  env: CloudflareEnv
): Promise<TokenClaims | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    try {
      const { createAuth } = await import("~/server/auth");
      const auth = await createAuth(env);
      const session = await auth.api.getSession({ headers: request.headers });
      if (session) {
        const db = drizzle(env.DB);
        const [orgMemberships, teamMemberships] = await Promise.all([
          db
            .select({ orgId: organizationMembers.orgId })
            .from(organizationMembers)
            .where(eq(organizationMembers.userId, session.user.id))
            .all(),
          db
            .select({ teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(eq(teamMembers.userId, session.user.id))
            .all(),
        ]);

        const accessibleScopes: Array<{ type: "personal" | "organization" | "team"; id: string | null }> = [
          { type: "personal", id: null },
        ];

        orgMemberships.forEach((m) => {
          accessibleScopes.push({ type: "organization", id: m.orgId });
        });

        teamMemberships.forEach((m) => {
          accessibleScopes.push({ type: "team", id: m.teamId });
        });

        return {
          userId: session.user.id,
          tokenId: session.session.token,
          permissions: MCP_PERM_RECALL | MCP_PERM_COMMIT | MCP_PERM_UPDATE | MCP_PERM_DELETE,
          scopeType: "personal",
          scopeId: null,
          accessibleScopes,
        };
      }
    } catch (e) {
      console.error("[api-mcp] Failed to validate cookie session:", e);
    }
    return null;
  }

  let rawToken = "";
  const authHeaderLower = authHeader.toLowerCase();
  if (authHeaderLower.startsWith("bearer ")) {
    rawToken = authHeader.slice(7).trim();
  } else if (authHeader.trim().startsWith("lkr_")) {
    rawToken = authHeader.trim();
  } else {
    return null;
  }

  // API token path (lkr_ prefix)
  if (rawToken.startsWith("lkr_")) {
    const tokenHash = await hashToken(rawToken);
    const db = drizzle(env.DB, { schema: { apiTokens, organizationMembers, teamMembers } });

    const rows = await db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, tokenHash))
      .all();

    if (!rows.length) return null;
    const token = rows[0];

    if (token.expiresAt && token.expiresAt < Date.now()) return null;

    // Verify live membership for scoped tokens
    if (token.scopeType === "organization" && token.scopeId) {
      const membershipRows = await db
        .select({ userId: organizationMembers.userId })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.orgId, token.scopeId), eq(organizationMembers.userId, token.userId)))
        .limit(1)
        .all();
      if (!membershipRows.length) {
        console.log("[api-token] user no longer member of scoped organization");
        return null;
      }
    } else if (token.scopeType === "team" && token.scopeId) {
      const membershipRows = await db
        .select({ userId: teamMembers.userId })
        .from(teamMembers)
        .where(and(eq(teamMembers.teamId, token.scopeId), eq(teamMembers.userId, token.userId)))
        .limit(1)
        .all();
      if (!membershipRows.length) {
        console.log("[api-token] user no longer member of scoped team");
        return null;
      }
    }

    db.update(apiTokens)
      .set({ lastUsedAt: Date.now() })
      .where(eq(apiTokens.id, token.id))
      .run()
      .catch(() => {});

    // For scoped tokens, parse multiple scopes if available, otherwise fallback to single scope
    let accessibleScopes: Array<{ type: "personal" | "organization" | "team"; id: string | null }> = [];
    if (token.scopes) {
      try {
        accessibleScopes = JSON.parse(token.scopes);
      } catch (e) {
        console.error("[api-token] Failed to parse token.scopes:", e);
      }
    }

    if (!accessibleScopes || accessibleScopes.length === 0) {
      accessibleScopes = [
        { type: token.scopeType as any, id: token.scopeId },
      ];
    }

    return {
      userId: token.userId,
      tokenId: token.id,
      permissions: token.permissions,
      scopeType: token.scopeType as any,
      scopeId: token.scopeId,
      accessibleScopes,
    };
  }

  // OAuth JWT path — verify signature against stored JWKS then do a live membership lookup
  if (rawToken.startsWith("eyJ")) {
    try {
      const jwtDb = drizzle(env.DB);

      // Decode header to get kid and alg without trusting the payload yet
      const headerJson = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(atob(rawToken.split(".")[0].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
        )
      ) as Record<string, unknown>;
      const kid = headerJson.kid as string | undefined;
      const alg = (headerJson.alg as string | undefined) ?? "RS256";

      // Load the matching key by kid, or all keys if no kid
      const keyRows = kid
        ? await jwtDb.select({ publicKey: jwks.publicKey }).from(jwks).where(eq(jwks.id, kid)).all()
        : await jwtDb.select({ publicKey: jwks.publicKey }).from(jwks).all();

      let payload: Record<string, unknown> | null = null;
      for (const row of keyRows) {
        try {
          const jwk = JSON.parse(row.publicKey) as Record<string, unknown>;
          const publicKey = await importJWK(jwk, alg);
          const result = await jwtVerify(rawToken, publicKey, {
            issuer: env.BETTER_AUTH_URL,
            audience: `${env.BETTER_AUTH_URL}/api/mcp`,
          });
          payload = result.payload as Record<string, unknown>;
          break;
        } catch (e) {
          console.log("[jwt] key attempt failed:", String(e));
        }
      }

      if (!payload) {
        console.log("[jwt] signature verification failed against all JWKS keys");
        return null;
      }

      const userId = payload.sub as string | undefined;
      if (!userId) {
        console.log("[jwt] no sub in verified JWT");
        return null;
      }

      // Parse scopes claim and map to permission bitmask
      let permissions = 0;
      const scopes = (payload.scope as string)?.split(" ") ?? [];
      for (const scope of scopes) {
        if (scope === "openid:mcp:recall") permissions |= MCP_PERM_RECALL;
        if (scope === "openid:mcp:commit") permissions |= MCP_PERM_COMMIT;
        if (scope === "openid:mcp:update") permissions |= MCP_PERM_UPDATE;
        if (scope === "openid:mcp:delete") permissions |= MCP_PERM_DELETE;
      }

      // Always do a live membership lookup — JWT claims go stale when memberships change
      const [orgRows, teamRows] = await Promise.all([
        jwtDb.select({ orgId: organizationMembers.orgId }).from(organizationMembers).where(eq(organizationMembers.userId, userId)).all(),
        jwtDb.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, userId)).all(),
      ]);
      const orgIds = orgRows.map((r) => r.orgId);
      const teamIds = teamRows.map((r) => r.teamId);

      console.log("[jwt] verified userId:", userId, "orgIds:", orgIds, "teamIds:", teamIds, "permissions:", permissions);

      const accessibleScopes: Array<{ type: "personal" | "organization" | "team"; id: string | null }> = [
        { type: "personal", id: null },
      ];
      orgIds.forEach((orgId) => accessibleScopes.push({ type: "organization", id: orgId }));
      teamIds.forEach((teamId) => accessibleScopes.push({ type: "team", id: teamId }));

      return {
        userId,
        tokenId: userId,
        permissions,
        scopeType: "personal",
        scopeId: null,
        accessibleScopes,
      };
    } catch (e) {
      console.log("[jwt] verification exception:", String(e));
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

  // Check for org and team memberships
  const [orgMemberships, teamMemberships] = await Promise.all([
    db
      .select({ orgId: organizationMembers.orgId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, oauthToken.userId))
      .all(),
    db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, oauthToken.userId))
      .all(),
  ]);

  const accessibleScopes: Array<{ type: "personal" | "organization" | "team"; id: string | null }> = [
    { type: "personal", id: null },
  ];

  orgMemberships.forEach((m) => {
    accessibleScopes.push({ type: "organization", id: m.orgId });
  });

  teamMemberships.forEach((m) => {
    accessibleScopes.push({ type: "team", id: m.teamId });
  });

  return {
    userId: oauthToken.userId,
    tokenId: oauthToken.id,
    permissions: MCP_PERM_RECALL | MCP_PERM_COMMIT | MCP_PERM_UPDATE | MCP_PERM_DELETE,
    scopeType: "personal",
    scopeId: null,
    accessibleScopes,
  };
}

const MCP_RATE_LIMIT_PER_MINUTE = 60;

async function checkFallbackRateLimit(db: any, key: string): Promise<boolean> {
  const now = Date.now();
  const minuteStart = Math.floor(now / 60000) * 60000;

  const existing = await db
    .select()
    .from(rateLimitCounters)
    .where(eq(rateLimitCounters.key, key))
    .get();

  if (existing && existing.minuteStart === minuteStart) {
    const updated = await db
      .update(rateLimitCounters)
      .set({ count: sql`${rateLimitCounters.count} + 1` })
      .where(eq(rateLimitCounters.key, key))
      .returning({ count: rateLimitCounters.count })
      .get();
    return updated && updated.count <= MCP_RATE_LIMIT_PER_MINUTE;
  }

  await db
    .insert(rateLimitCounters)
    .values({ key, count: 1, minuteStart })
    .onConflictDoUpdate({
      target: rateLimitCounters.key,
      set: { count: 1, minuteStart },
    });

  return true;
}

export async function handleMcpRequest(
  request: Request,
  env: CloudflareEnv,
  ctx?: ExecutionContext
): Promise<Response> {
  const origin = request.headers.get("origin") ?? "*";
  const authHeader = request.headers.get("Authorization");
  const headers = corsHeaders(origin, authHeader);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  let authType = "NONE";
  let tokenLength = 0;
  if (authHeader) {
    const authHeaderLower = authHeader.toLowerCase();
    if (authHeaderLower.startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      tokenLength = token.length;
      if (token.startsWith("lkr_")) {
        authType = "lkr_ API Key (Bearer)";
      } else if (token.startsWith("eyJ")) {
        authType = "OAuth JWT (eyJ)";
      } else {
        authType = "Opaque OAuth";
      }
    } else if (authHeader.trim().startsWith("lkr_")) {
      const token = authHeader.trim();
      tokenLength = token.length;
      authType = "lkr_ API Key (Direct)";
    } else {
      authType = "Invalid Scheme";
    }
  }
  console.log(`[mcp] method: ${request.method} auth type: ${authType} length: ${tokenLength}`);

  const ipAddress = request.headers.get("cf-connecting-ip") ?? "";
  const userAgent = request.headers.get("user-agent") ?? "";

  // Validate API token
  const claims = await validateBearerToken(request, env);
  if (!claims) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: valid Bearer token required" } },
      {
        status: 401,
        headers: {
          ...headers,
          "WWW-Authenticate": `Bearer resource_metadata="${env.BETTER_AUTH_URL}/.well-known/oauth-protected-resource", scope="openid profile email offline_access openid:mcp:recall openid:mcp:commit openid:mcp:update openid:mcp:delete"`,
        },
      }
    );
  }

  // Rate Limiting Check (with fallback to D1-based per-minute counter)
  const limitKey = claims.tokenId || claims.userId;
  let rateLimitSuccess = true;

  if (env.RATE_LIMITER) {
    try {
      const { success } = await env.RATE_LIMITER.limit({ key: limitKey });
      rateLimitSuccess = success;
    } catch (err) {
      console.error("[rate-limit] Limiter error:", err);
    }
  } else {
    rateLimitSuccess = await checkFallbackRateLimit(drizzle(env.DB), limitKey);
  }

  if (!rateLimitSuccess) {
    return new Response("Too Many Requests", { status: 429, headers });
  }

  if (request.method === "GET") {
    const allowedTools = ALL_TOOLS.filter((t) => {
      if (t.name === "list_accessible_scopes") return true;
      if (t.name === "recall_context" || t.name === "search_memories" || t.name === "get_memory_summary") return !!(claims.permissions & MCP_PERM_RECALL);
      if (t.name === "commit_memory") return !!(claims.permissions & MCP_PERM_COMMIT);
      if (t.name === "update_memory") return !!(claims.permissions & MCP_PERM_UPDATE);
      if (t.name === "delete_memory") return !!(claims.permissions & MCP_PERM_DELETE);
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
  const db = drizzle(env.DB);

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
      if (t.name === "list_accessible_scopes") return true;
      if (t.name === "recall_context" || t.name === "search_memories" || t.name === "get_memory_summary") return !!(claims.permissions & MCP_PERM_RECALL);
      if (t.name === "commit_memory") return !!(claims.permissions & MCP_PERM_COMMIT);
      if (t.name === "update_memory") return !!(claims.permissions & MCP_PERM_UPDATE);
      if (t.name === "delete_memory") return !!(claims.permissions & MCP_PERM_DELETE);
      return false;
    });
    return mcpResult(id, { tools: allowedTools });
  }

  if (method !== "tools/call") {
    return mcpError(id, -32601, `Method not found: ${method}`);
  }

  const toolName = params?.name;
  const args = params?.arguments ?? {};

  if (toolName === "list_accessible_scopes") {
    const orgIds = claims.accessibleScopes.filter((s) => s.type === "organization" && s.id).map((s) => s.id as string);
    const teamIds = claims.accessibleScopes.filter((s) => s.type === "team" && s.id).map((s) => s.id as string);

    const [orgRows, teamRows] = await Promise.all([
      orgIds.length > 0
        ? db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(sql`${organizations.id} IN (${sql.join(orgIds.map((o) => sql`${o}`), sql`, `)})`).all()
        : Promise.resolve([] as { id: string; name: string }[]),
      teamIds.length > 0
        ? db.select({ id: teams.id, name: teams.name }).from(teams).where(sql`${teams.id} IN (${sql.join(teamIds.map((t) => sql`${t}`), sql`, `)})`).all()
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    const orgNameMap = new Map(orgRows.map((r) => [r.id, r.name]));
    const teamNameMap = new Map(teamRows.map((r) => [r.id, r.name]));

    const scopes = claims.accessibleScopes.map((s) => {
      if (s.type === "personal") {
        return { type: "personal", id: null, projectKey: null, label: "Personal Locker" };
      } else if (s.type === "organization") {
        const name = orgNameMap.get(s.id!) ?? s.id;
        return { type: "organization", id: s.id, projectKey: `org:${s.id}`, label: name };
      } else if (s.type === "team") {
        const name = teamNameMap.get(s.id!) ?? s.id;
        return { type: "team", id: s.id, projectKey: `team:${s.id}`, label: name };
      }
      return null;
    }).filter((s): s is NonNullable<typeof s> => s !== null);

    return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(scopes) }] });
  }

  if (toolName === "recall_context") {
    if (!(claims.permissions & MCP_PERM_RECALL)) {
      return mcpError(id, -32001, "Token does not have recall_context permission");
    }

    const query = args.query as string | undefined;
    if (!query || typeof query !== "string") {
      return mcpError(id, -32602, "Invalid params: query is required");
    }
    if (query.length > 10000) {
      return mcpError(id, -32602, "Invalid params: query exceeds max length of 10000 characters");
    }
    const topK = typeof args.topK === "number" ? args.topK : 5;
    const category = args.category as string | undefined;
    const tag = args.tag as string | undefined;
    const keyword = args.keyword as string | undefined;
    const crossWorkspaceSearch = !!args.crossWorkspaceSearch;
    const projectKey = crossWorkspaceSearch ? undefined : resolveProjectKey(claims, args.projectKey as string | undefined);
    const isActive = typeof args.isActive === "boolean" ? args.isActive : true;

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required for vector query");
    }

    let orgId: string | null = null;

    if (crossWorkspaceSearch) {
      const { planId, orgId: userOrgId } = await getUserEffectivePlan(db, claims.userId);
      orgId = userOrgId;
      if (!PLANS[planId].features.crossWorkspaceSearch) {
        return mcpError(id, -32005, `Forbidden: cross-workspace search requires the Business plan or higher. Current plan: ${planId}`);
      }
      if (claims.scopeType !== "personal") {
        return mcpError(id, -32005, `Forbidden: Scoped API tokens cannot perform cross-workspace searches.`);
      }
    } else {
      if (!isProjectKeyAllowedByToken(claims.accessibleScopes, projectKey)) {
        return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${projectKey ?? "personal"}'`);
      }

      const { allowed: vaultAllowed, orgId: vOrgId } = await verifyVaultAccess(db, claims.userId, projectKey);
      if (!vaultAllowed) {
        return mcpError(id, -32003, `Forbidden: no access to vault scope '${projectKey}'`);
      }
      orgId = vOrgId;
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "recall", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    const queryTrimmed = query.trim();
    const embedding = await generateEmbedding(env.AI, queryTrimmed);
    const tokensConsumed = estimateEmbeddingTokens(queryTrimmed);
    const vectorTopK = (category || tag || keyword)
      ? Math.min(20, topK * 3)
      : Math.min(20, topK);

    let matches: any[] = [];
    if (crossWorkspaceSearch) {
      const orgs = await db.select({ orgId: organizationMembers.orgId }).from(organizationMembers).where(eq(organizationMembers.userId, claims.userId)).all();
      const teamsList = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, claims.userId)).all();
      const orgAndTeamKeys = [
        ...orgs.map((o) => `org:${o.orgId}`),
        ...teamsList.map((t) => `team:${t.teamId}`),
      ];

      const [personalResults, orgResults] = await Promise.all([
        env.VECTOR_INDEX.query(embedding, { topK: vectorTopK, filter: { userId: claims.userId }, returnMetadata: "none" }),
        orgAndTeamKeys.length > 0
          ? env.VECTOR_INDEX.query(embedding, { topK: vectorTopK, filter: { projectKey: { $in: orgAndTeamKeys } }, returnMetadata: "none" })
          : Promise.resolve({ matches: [] })
      ]);

      matches = [...(personalResults.matches ?? []), ...(orgResults.matches ?? [])];
    } else {
      const filter: Record<string, any> = {};
      if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
        filter.projectKey = projectKey;
      } else {
        filter.userId = claims.userId;
        if (projectKey) {
          filter.projectKey = { $in: [projectKey, ""] };
        }
      }

      const vectorResults = await env.VECTOR_INDEX.query(embedding, {
        topK: vectorTopK,
        filter,
        returnMetadata: "none",
      });
      matches = vectorResults.matches ?? [];
    }

    if (!matches.length) {
      await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "recall_context", ipAddress, userAgent, metadata: { query, projectKey, matchCount: 0 } });
      await logTokenUsage(db, claims.tokenId, "recall", tokensConsumed);
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify([]) }] });
    }

    const ids = matches.map((m) => m.id);
    const conditions = [
      sql`${memories.id} IN (${sql.join(ids.map((dbId) => sql`${dbId}`), sql`, `)})`
    ];
    if (isActive !== undefined) {
      conditions.push(eq(memories.isActive, isActive));
    }
    if (crossWorkspaceSearch) {
      const orgs = await db.select({ orgId: organizationMembers.orgId }).from(organizationMembers).where(eq(organizationMembers.userId, claims.userId)).all();
      const teamsList = await db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, claims.userId)).all();
      const allowedScopeKeys = [
        null,
        "",
        ...orgs.map((o) => `org:${o.orgId}`),
        ...teamsList.map((t) => `team:${t.teamId}`),
      ];
      conditions.push(
        sql`(${memories.userId} = ${claims.userId} OR ${memories.projectKey} IN (${sql.join(allowedScopeKeys.map((k) => sql`${k}`), sql`, `)}))`
      );
    } else {
      if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
        conditions.push(eq(memories.projectKey, projectKey));
      } else {
        conditions.push(eq(memories.userId, claims.userId));
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
    }

    const rows = await db
      .select()
      .from(memories)
      .where(and(...conditions))
      .all();

    const decrypted = await Promise.all(
      rows.map(async (r) => {
        const vaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : claims.userId;
        const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);
        return { ...r, fact: await decryptFact(r.fact, vaultKey, env.ENCRYPTION_KEY) };
      })
    );

    // Filter decrypted facts
    let filtered = decrypted;
    if (category) {
      filtered = filtered.filter((r) => r.category === category);
    }
    if (tag) {
      const lowerTag = tag.toLowerCase().trim();
      filtered = filtered.filter((r) =>
        (r.tags || "").split(",").map((t) => t.trim().toLowerCase()).includes(lowerTag)
      );
    }
    if (keyword) {
      const lowerKw = keyword.toLowerCase().trim();
      filtered = filtered.filter((r) => r.fact.toLowerCase().includes(lowerKw));
    }

    const idOrder = new Map(ids.map((dbId, i) => [dbId, i]));
    const ranked = filtered.sort((a, b) => {
      if (a.authorityType === "authoritative" && b.authorityType !== "authoritative") return -1;
      if (a.authorityType !== "authoritative" && b.authorityType === "authoritative") return 1;
      return (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999);
    });
    const finalResults = ranked.slice(0, topK);

    // Audit log & token usage
    await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "recall_context", ipAddress, userAgent, metadata: { query, projectKey, matchCount: finalResults.length } });
    await logTokenUsage(db, claims.tokenId, "recall", tokensConsumed);

    // Update lastAccessedAt for recalled memories
    if (finalResults.length > 0) {
      const recalledIds = finalResults.map((r) => r.id);
      if (ctx?.waitUntil) {
        ctx.waitUntil(
          db.update(memories).set({ lastAccessedAt: Date.now() })
            .where(inArray(memories.id, recalledIds))
            .run()
        );
      } else {
        await db.update(memories).set({ lastAccessedAt: Date.now() })
          .where(inArray(memories.id, recalledIds))
          .run();
      }
    }

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
    const projectKey = resolveProjectKey(claims, args.projectKey as string | undefined);
    const isActive = typeof args.isActive === "boolean" ? args.isActive : true;

    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, projectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${projectKey ?? "personal"}'`);
    }

    // Vault Scoping & Quota Check
    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, projectKey);
    if (!vaultAllowed) {
      return mcpError(id, -32003, `Forbidden: no access to vault scope '${projectKey}'`);
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "recall", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    const conditions = [];
    if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
      conditions.push(eq(memories.projectKey, projectKey));
    } else {
      conditions.push(eq(memories.userId, claims.userId));
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
    if (category) {
      conditions.push(eq(memories.category, category as "rules" | "projects" | "references"));
    }
    if (isActive !== undefined) {
      conditions.push(eq(memories.isActive, isActive));
    }

    const rows = await db
      .select()
      .from(memories)
      .where(and(...conditions))
      .orderBy(desc(memories.timestamp))
      .all();

    // Decrypt using derived vault key
    const vaultId = (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) ? projectKey : claims.userId;
    const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);
    const decrypted = await Promise.all(
      rows.map(async (r) => ({ ...r, fact: await decryptFact(r.fact, vaultKey, env.ENCRYPTION_KEY) }))
    );

    // Filter in memory for tag and keyword
    let filtered = decrypted;
    if (tag) {
      const lowerTag = tag.toLowerCase().trim();
      filtered = filtered.filter((r) =>
        (r.tags || "").split(",").map((t) => t.trim().toLowerCase()).includes(lowerTag)
      );
    }
    if (keyword) {
      const lowerKw = keyword.toLowerCase().trim();
      filtered = filtered.filter((r) => r.fact.toLowerCase().includes(lowerKw));
    }

    const paginated = filtered.slice(offset, offset + limit);

    // Audit log & token usage
    await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "search_memories", ipAddress, userAgent, metadata: { category, tag, keyword, projectKey, matchCount: paginated.length } });
    await logTokenUsage(db, claims.tokenId, "recall", 0);

    return mcpResult(id, { content: [{ type: "text", text: JSON.stringify(paginated) }] });
  }

  if (toolName === "get_memory_summary") {
    if (!(claims.permissions & MCP_PERM_RECALL)) {
      return mcpError(id, -32001, "Token does not have recall_context permission");
    }

    const projectKey = resolveProjectKey(claims, undefined);
    let orgId: string | null = null;
    const conditions = [];

    if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
      const { allowed: vaultAllowed, orgId: vOrgId } = await verifyVaultAccess(db, claims.userId, projectKey);
      if (!vaultAllowed) {
        return mcpError(id, -32003, `Forbidden: no access to vault scope '${projectKey}'`);
      }
      orgId = vOrgId;
      conditions.push(eq(memories.projectKey, projectKey));
    } else {
      orgId = await getUserOrg(db, claims.userId);
      conditions.push(eq(memories.userId, claims.userId));
      conditions.push(sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`);
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "recall", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    const rows = await db
      .select({ category: memories.category, tags: memories.tags })
      .from(memories)
      .where(and(...conditions))
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
        const tagsList = (row.tags || "").split(",").map((t) => t.trim()).filter(Boolean);
        for (const t of tagsList) {
          summary.tags[t] = (summary.tags[t] ?? 0) + 1;
        }
      }
    }

    // Audit log & token usage
    await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "get_memory_summary", ipAddress, userAgent });
    await logTokenUsage(db, claims.tokenId, "recall", 0);

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
    if (fact.length > 10000) {
      return mcpError(id, -32602, "Invalid params: fact exceeds max length of 10000 characters");
    }
    const category = normalizeCategory(args.category as string | undefined);
    const source = typeof args.source === "string" ? args.source.trim().toLowerCase() : "mcp";
    const rawTags = typeof args.tags === "string" ? args.tags.trim() : "";
    const projectKey = resolveProjectKey(claims, args.projectKey as string | undefined);

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required for vector insert");
    }

    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, projectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${projectKey ?? "personal"}'`);
    }

    // Vault Scoping & Quota Check
    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, projectKey);
    if (!vaultAllowed) {
      return mcpError(id, -32003, `Forbidden: no access to vault scope '${projectKey}'`);
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "commit", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    const tagsList = rawTags.split(",").map(t => t.trim()).filter(Boolean);
    if (!tagsList.includes(source)) tagsList.push(source);
    const finalTags = tagsList.join(", ");

    const memId = crypto.randomUUID();
    const timestamp = Date.now();
    const factTrimmed = fact.trim();
    const embedding = await generateEmbedding(env.AI, factTrimmed);
    const tokensConsumed = estimateEmbeddingTokens(factTrimmed);

    // Derive vault key
    const vaultId = (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) ? projectKey : claims.userId;
    const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encrypt(factTrimmed, vaultKey);

    // Archive contradicted memories asynchronously via Queue
    try {
      await env.ARCHIVE_QUEUE.send({
        userId: claims.userId,
        newFact: factTrimmed,
        embedding,
        projectKey: projectKey || null,
      });
    } catch (err) {
      console.error("[mcp] Failed to enqueue contradiction check:", err);
    }

    let scopeType: "personal" | "organization" | "team" = "personal";
    let scopeId: string | null = null;
    if (projectKey) {
      if (projectKey.startsWith("org:")) {
        scopeType = "organization";
        scopeId = projectKey.slice(4);
      } else if (projectKey.startsWith("team:")) {
        scopeType = "team";
        scopeId = projectKey.slice(5);
      }
    }

    await db.insert(memories).values({
      id: memId,
      userId: claims.userId,
      fact: encryptedFact,
      category,
      tags: finalTags,
      timestamp,
      isActive: true,
      projectKey: projectKey || null,
      scopeType,
      scopeId,
    });

    // Record Memory Version
    await db.insert(memoryVersions).values({
      id: crypto.randomUUID(),
      memoryId: memId,
      fact: encryptedFact,
      category,
      tags: finalTags,
      changedBy: claims.userId,
      changeReason: "created",
      timestamp,
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

    // Audit log & token usage
    await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "commit_memory", memoryId: memId, ipAddress, userAgent, metadata: { category, projectKey } });
    await logTokenUsage(db, claims.tokenId, "commit", tokensConsumed);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, id: memId, fact: factTrimmed, category, tags: finalTags, projectKey }) },
      ],
    });
  }

  if (toolName === "update_memory") {
    if (!(claims.permissions & MCP_PERM_UPDATE)) {
      return mcpError(id, -32001, "Token does not have update_memory permission");
    }

    const memId = args.id as string | undefined;
    const fact = args.fact as string | undefined;
    if (!memId || typeof memId !== "string") {
      return mcpError(id, -32602, "Invalid params: id is required");
    }
    if (!fact || typeof fact !== "string") {
      return mcpError(id, -32602, "Invalid params: fact is required");
    }
    if (fact.length > 10000) {
      return mcpError(id, -32602, "Invalid params: fact exceeds max length of 10000 characters");
    }

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required for vector upsert");
    }

    // Fetch existing memory to check scoping
    const rows = await db
      .select()
      .from(memories)
      .where(eq(memories.id, memId))
      .all();

    if (!rows.length) {
      return mcpError(id, -32602, `Memory not found or unauthorized: ${memId}`);
    }
    const existing = rows[0];

    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, existing.projectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${existing.projectKey ?? "personal"}'`);
    }

    // Vault Scoping & Quota Check
    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, existing.projectKey);
    if (!vaultAllowed) {
      return mcpError(id, -32003, `Forbidden: no access to vault scope '${existing.projectKey}'`);
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
          .where(and(eq(organizationMembers.orgId, actualOrgId), eq(organizationMembers.userId, claims.userId)))
          .limit(1)
          .all();
        const role = memberRow[0]?.role;
        if (role !== "owner" && role !== "admin") {
          return mcpError(id, -32003, `Forbidden: Locked organization memories can only be modified by organization owners/admins.`);
        }
      } else {
        return mcpError(id, -32003, `Forbidden: Locked memories can only be modified by organization owners/admins.`);
      }
    }

    const isSharedVault = existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"));
    if (!isSharedVault && existing.userId !== claims.userId) {
      return mcpError(id, -32003, `Forbidden: You do not have permission to modify this memory.`);
    }

    if (isSharedVault && existing.userId !== claims.userId) {
      const actualOrgId = existing.projectKey!.startsWith("org:") ? existing.projectKey!.slice(4) : orgId;
      if (actualOrgId) {
        const memberRow = await db
          .select({ role: organizationMembers.role })
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, actualOrgId), eq(organizationMembers.userId, claims.userId)))
          .limit(1)
          .all();
        const role = memberRow[0]?.role;
        if (role !== "owner" && role !== "admin") {
          return mcpError(id, -32003, `Forbidden: Only organization owners/admins can modify other members' memories in a shared vault.`);
        }
      } else {
        return mcpError(id, -32003, `Forbidden: You do not have permission to modify this memory.`);
      }
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "commit", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    const category = args.category !== undefined 
      ? normalizeCategory(args.category as string | undefined)
      : existing.category;

    const rawTags = args.tags !== undefined
      ? (typeof args.tags === "string" ? args.tags.trim() : "")
      : existing.tags;

    const factTrimmed = fact.trim();
    const embedding = await generateEmbedding(env.AI, factTrimmed);
    const tokensConsumed = estimateEmbeddingTokens(factTrimmed);

    // Derive vault key
    const vaultId = (existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"))) ? existing.projectKey : claims.userId;
    const vaultKey = await deriveUserKey(env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encrypt(factTrimmed, vaultKey);

    await db.update(memories)
      .set({
        fact: encryptedFact,
        category,
        tags: rawTags,
        timestamp: Date.now(),
      })
      .where(eq(memories.id, memId));

    // Record Memory Version
    await db.insert(memoryVersions).values({
      id: crypto.randomUUID(),
      memoryId: memId,
      fact: encryptedFact,
      category,
      tags: rawTags,
      changedBy: claims.userId,
      changeReason: "updated",
      timestamp: Date.now(),
    });

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

    // Audit log & token usage
    await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "update_memory", memoryId: memId, ipAddress, userAgent, metadata: { category } });
    await logTokenUsage(db, claims.tokenId, "commit", tokensConsumed);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, id: memId, fact: factTrimmed, category, tags: rawTags }) },
      ],
    });
  }

  if (toolName === "delete_memory") {
    if (!(claims.permissions & MCP_PERM_DELETE)) {
      return mcpError(id, -32001, "Token does not have delete_memory permission");
    }

    const memId = args.id as string | undefined;
    if (!memId || typeof memId !== "string") {
      return mcpError(id, -32602, "Invalid params: id is required");
    }

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required");
    }

    // Fetch existing memory to check scoping
    const rows = await db
      .select()
      .from(memories)
      .where(eq(memories.id, memId))
      .all();

    if (!rows.length) {
      return mcpError(id, -32602, `Memory not found or unauthorized: ${memId}`);
    }
    const existing = rows[0];

    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, existing.projectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${existing.projectKey ?? "personal"}'`);
    }

    // Vault Scoping & Quota Check
    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, existing.projectKey);
    if (!vaultAllowed) {
      return mcpError(id, -32003, `Forbidden: no access to vault scope '${existing.projectKey}'`);
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
          .where(and(eq(organizationMembers.orgId, actualOrgId), eq(organizationMembers.userId, claims.userId)))
          .limit(1)
          .all();
        const role = memberRow[0]?.role;
        if (role !== "owner" && role !== "admin") {
          return mcpError(id, -32003, `Forbidden: Locked organization memories can only be deleted by organization owners/admins.`);
        }
      } else {
        return mcpError(id, -32003, `Forbidden: Locked memories can only be deleted by organization owners/admins.`);
      }
    }

    const isSharedVault = existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"));
    if (!isSharedVault && existing.userId !== claims.userId) {
      return mcpError(id, -32003, `Forbidden: You do not have permission to delete this memory.`);
    }

    if (isSharedVault && existing.userId !== claims.userId) {
      const actualOrgId = existing.projectKey!.startsWith("org:") ? existing.projectKey!.slice(4) : orgId;
      if (actualOrgId) {
        const memberRow = await db
          .select({ role: organizationMembers.role })
          .from(organizationMembers)
          .where(and(eq(organizationMembers.orgId, actualOrgId), eq(organizationMembers.userId, claims.userId)))
          .limit(1)
          .all();
        const role = memberRow[0]?.role;
        if (role !== "owner" && role !== "admin") {
          return mcpError(id, -32003, `Forbidden: Only organization owners/admins can delete other members' memories in a shared vault.`);
        }
      } else {
        return mcpError(id, -32003, `Forbidden: You do not have permission to delete this memory.`);
      }
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "commit", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    // Delete from DB and Vectorize
    await db.delete(memories).where(eq(memories.id, memId));
    await env.VECTOR_INDEX.deleteByIds([memId]);

    // Audit log & token usage
    await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "delete_memory", memoryId: memId, ipAddress, userAgent });
    await logTokenUsage(db, claims.tokenId, "commit", 0);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, id: memId }) },
      ],
    });
  }

  return mcpError(id, -32602, `Unknown tool: ${toolName}`);
}
