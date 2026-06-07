import { drizzle } from "drizzle-orm/d1";
import { eq, sql, and, desc, inArray } from "drizzle-orm";
import { memories, apiTokens, oauthAccessTokensV2, MCP_PERM_RECALL, MCP_PERM_COMMIT, MCP_PERM_UPDATE, MCP_PERM_DELETE, auditLogs, tokenUsages, orgQuotas, memoryVersions, organizations, organizationMembers, teamMembers, teams, jwks, rateLimitCounters, memoryTemplates, users, totpSecrets, credentials, notifications, ABAC_DEFAULT_ALLOW, JIT_PROTECTED_TAG, jitAccessRequests, memoryRecommendations } from "~/db/schema";
import type { AgentPolicy, MemoryCategory } from "~/db/schema";
import { importJWK, jwtVerify } from "jose";
import type { CloudflareEnv } from "~/types/cloudflare";
import { verifyToken, hashToken, getOrCreateVaultKey, decrypt, encrypt, isEncrypted, decryptEphemeral, EphemeralPlaintext } from "~/server/crypto";
import { getUserOrg, verifyVaultAccess, checkQuota, logTokenUsage, logAudit, estimateEmbeddingTokens, parseScope } from "~/server/enterprise";
import { verifyTOTP } from "~/server/totp";
import { PLANS } from "~/lib/plans";
import { getUserEffectivePlan } from "~/server/planGate";
import { sanitizeMemory } from "~/server/sanitization";
import { maskSensitiveData, containsSensitiveData } from "~/server/dlp";
import { extractGraphEntities, persistGraphData, expandByEntityIds } from "~/server/graphRag";

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

async function decryptFact(stored: string, encKey: string | CryptoKey): Promise<string> {
  if (!isEncrypted(stored)) return stored;
  return decrypt(stored, encKey);
}

function normalizeCategory(raw: string | undefined): "rules" | "projects" | "references" {
  if (raw === "rules" || raw === "projects" || raw === "references") return raw;
  return "references";
}

// Thrown to signal that a caller attempted to use a generic memory tool on the configs category.
function configsCategoryForbidden(id: unknown): Response {
  return mcpError(id, -32003, "Forbidden: The 'configs' category cannot be mutated via generic memory tools. Use 'store_config' or 'update_config'.");
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

type PackableMemory = {
  fact: string;
  category: string;
  tags: string;
  authorityType?: string;
};

async function packPrompt(ai: Ai, query: string, items: PackableMemory[]): Promise<string> {
  if (items.length === 0) return "";
  const chunks = items.map((m, i) => {
    const tagStr = m.tags ? ` [tags: ${m.tags}]` : "";
    const auth = m.authorityType === "authoritative" ? " [authoritative]" : "";
    return `${i + 1}. [${m.category}${auth}${tagStr}] ${m.fact}`;
  }).join("\n");

  const systemPrompt =
    "You are a context-compression assistant. Your job is to synthesize a list of memory fragments into a single, highly dense system prompt for an AI coding agent. " +
    "Rules:\n" +
    "- Deduplicate overlapping facts (keep the most specific or authoritative version).\n" +
    "- Merge related facts into concise statements.\n" +
    "- Preserve all concrete details: file paths, URLs, identifiers, version numbers, decisions, constraints.\n" +
    "- Prioritise [authoritative] items over contributed ones when they conflict.\n" +
    "- Format the result as a compact bulleted list grouped by category (rules, projects, references, configs).\n" +
    "- Do NOT add commentary, preamble, or explanation — output only the compressed prompt.\n" +
    "- Keep the output under 800 tokens.";

  const userMessage =
    `User query: "${query}"\n\nMemory fragments to compress:\n${chunks}\n\nOutput the optimised system prompt now.`;
  try {
    const result = await ai.run("@cf/meta/llama-3.1-8b-instruct-fp8", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      max_tokens: 1024,
    });

    return extractText(result).trim();
  } catch (err) {
    console.error("[packPrompt] compression failed:", err);
    return items.map((m, i) => `${i + 1}. [${m.category}] ${m.fact}`).join("\n");
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
      "Hybrid semantic and keyword search over stored long-term memory. Combines conceptual vector search (Cloudflare Vectorize) and exact token/substring matches (SQLite) using Reciprocal Rank Fusion (RRF) to prevent zero-result keyword matches.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query." },
        topK: { type: "number", description: "Max results (default: 5)." },
        category: { type: "string", enum: ["rules", "projects", "references", "configs"], description: "Optional category filter." },
        tag: { type: "string", description: "Optional tag filter (case-insensitive)." },
        keyword: { type: "string", description: "Optional exact substring filter (case-insensitive)." },
        projectKey: { type: "string", description: "Optional project workspace key (e.g. repository hash or folder slug)." },
        isActive: { type: "boolean", description: "Filter by active status. Defaults to true." },
        optimize: { type: "boolean", description: "When true, pipe retrieved memories through an LLM to synthesize a single dense, deduplicated system-prompt string optimised for the query. Reduces token usage for the caller. Defaults to false." },
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
        category: { type: "string", enum: ["rules", "projects", "references", "configs"], description: "Filter by category." },
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
    description: "Update an existing memory fact, category, or tags by its unique ID. Warning: This is a destructive/modifying action and requires confirmation and potentially MFA verification.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The unique ID of the memory to update." },
        fact: { type: "string", description: "The updated factual statement." },
        category: { type: "string", enum: ["rules", "projects", "references"], description: "Optional updated category." },
        tags: { type: "string", description: "Optional updated comma-separated keywords/tags." },
        confirm: { type: "boolean", description: "Must be explicitly set to true by human-in-the-loop action." },
        totpCode: { type: "string", description: "6-digit Authenticator TOTP code (required if 2FA is enabled)." },
        passcode: { type: "string", description: "Locker deletion passcode (required if set and 2FA is disabled)." },
      },
      required: ["id", "fact", "confirm"],
    },
  },
  {
    name: "delete_memory",
    description: "Delete an existing memory by its unique ID. Warning: This is a destructive action and requires confirmation and potentially MFA verification.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The unique ID of the memory to delete." },
        confirm: { type: "boolean", description: "Must be explicitly set to true by human-in-the-loop action." },
        totpCode: { type: "string", description: "6-digit Authenticator TOTP code (required if 2FA is enabled)." },
        passcode: { type: "string", description: "Locker deletion passcode (required if set and 2FA is disabled)." },
      },
      required: ["id", "confirm"],
    },
  },
  {
    name: "sync_agent_configs",
    description: "Syncs workspace agent configuration files. Compiles all active configs-category memories for the project and writes them to ALL agent config formats at once: CLAUDE.md, GEMINI.md, AGENTS.md (OpenAI Codex), .cursorrules, .github/copilot-instructions.md, and .agents/rules/rules.md. Returns an array of { markdown, targetPath } objects — one per format. IMPORTANT: Do NOT call recall_context, search_memories, or any other memory tool before calling this tool. This tool is fully self-contained and fetches only the relevant configs memories itself. The downstream developer agent MUST write each returned markdown string to disk at its targetPath using OVERWRITE mode — if the file already exists it must be fully replaced, never appended to. Create any missing parent directories as needed.",
    inputSchema: {
      type: "object",
      properties: {
        projectKey: { type: "string", description: "The project workspace key." },
      },
      required: ["projectKey"],
      additionalProperties: false,
    },
  },
  {
    name: "store_credential",
    description: "Store an encrypted secret credential in the vault. Values are encrypted at rest and will be redacted in context results.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The unique uppercase name for the credential (e.g. SLACK_API_TOKEN)." },
        value: { type: "string", description: "The secret value to encrypt and store." },
        projectKey: { type: "string", description: "Optional workspace project key scope." },
      },
      required: ["name", "value"],
    },
  },
  {
    name: "list_credentials",
    description: "List the names of all secure credentials stored in this scope. Does NOT return the secret values.",
    inputSchema: {
      type: "object",
      properties: {
        projectKey: { type: "string", description: "Optional workspace project key scope." },
      },
    },
  },
  {
    name: "retrieve_credential",
    description: "Retrieve the decrypted secret value of a credential by name. Warning: The returned raw value will be visible in the current LLM context window.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name of the credential to retrieve." },
        projectKey: { type: "string", description: "Optional workspace project key scope." },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_credential",
    description: "Delete a secure credential by name from the vault.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The name of the credential to delete." },
        projectKey: { type: "string", description: "Optional workspace project key scope." },
      },
      required: ["name"],
    },
  },
  {
    name: "store_config",
    description: "Store an agent configuration in the vault under the protected 'configs' category. Content is envelope-encrypted at rest. Use this instead of commit_memory when the payload is an agent system prompt, LLM parameter set, or architectural config blueprint.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "A unique name for this config (e.g. 'claude-code-baseline')." },
        content: { type: "string", description: "The raw config content (system prompt, parameter JSON, etc.)." },
        projectKey: { type: "string", description: "Optional workspace project key to scope this config." },
        tags: { type: "string", description: "Optional comma-separated tags." },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "update_config",
    description: "Update an existing agent config entry by its memory ID. For human tokens, executes immediately after TOTP/passcode verification. For agent tokens, the update is queued for human approval.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The memory ID of the config to update." },
        content: { type: "string", description: "The new config content." },
        confirm: { type: "boolean", description: "Must be explicitly set to true." },
        totpCode: { type: "string", description: "6-digit TOTP code (required if 2FA is enabled)." },
        passcode: { type: "string", description: "Write passcode (required if set and 2FA is disabled)." },
      },
      required: ["id", "content", "confirm"],
    },
  },
  {
    name: "approve_jit_access",
    description: "Approve or deny a pending Just-in-Time access request for #confidential memories. Only the memory owner (human token) may call this. On approval a short-lived token valid for 15 minutes is returned; the agent must re-run its original query using that token as its Bearer credential.",
    inputSchema: {
      type: "object",
      properties: {
        jitRequestId: { type: "string", description: "The JIT request ID returned in a previous recall_context or search_memories response." },
        decision: { type: "string", enum: ["approve", "deny"], description: "approve to grant access, deny to reject." },
        reviewNotes: { type: "string", description: "Optional notes recorded in the audit log." },
      },
      required: ["jitRequestId", "decision"],
      additionalProperties: false,
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

// Returns null for human tokens (no filter) or a Set of allowed categories for agent tokens.
// "configs" is an isolated layer — it is never included in ABAC_DEFAULT_ALLOW and must be
// granted explicitly in the agent policy's allowedCategories list.
function resolveAgentCategoryFilter(claims: TokenClaims): Set<MemoryCategory> | null {
  if (!claims.isAgent || !claims.agentPolicy) return null;
  const { allowedCategories, deniedCategories } = claims.agentPolicy;
  // Start from explicit policy or the default safe set (which excludes "configs").
  const base: MemoryCategory[] = allowedCategories.length > 0 ? allowedCategories : ABAC_DEFAULT_ALLOW;
  // Always strip "configs" unless the policy explicitly listed it in allowedCategories.
  const configsExplicit = allowedCategories.includes("configs");
  return new Set(
    base
      .filter((c) => !deniedCategories.includes(c))
      .filter((c) => c !== "configs" || configsExplicit)
  );
}

function checkCategoryAccess(category: string, filter: Set<MemoryCategory> | null): boolean {
  if (filter === null) return true;
  return filter.has(category as MemoryCategory);
}

// Tag-level ABAC result for a single memory row.
type TagAccessResult =
  | { access: "allow" }
  | { access: "deny" }
  | { access: "jit" }; // triggers JIT approval workflow

// Normalise a raw tags string into a set of lowercase tag tokens.
function normaliseTags(raw: string): Set<string> {
  const tags = new Set<string>();
  for (const t of raw.split(",")) {
    const trimmed = t.trim().toLowerCase();
    if (trimmed) tags.add(trimmed);
  }
  return tags;
}

// Evaluate tag-level ABAC for a single memory row against the agent policy.
// Returns "allow", "deny", or "jit" (needs approval before access is granted).
function checkTagAccess(rawTags: string, policy: AgentPolicy | null): TagAccessResult {
  if (!policy) return { access: "allow" };

  const memTags = normaliseTags(rawTags);
  const allowedTags = policy.allowedTags ?? [];
  const deniedTags = policy.deniedTags ?? [];

  // Denied tags win first — but #confidential gets JIT instead of hard-deny.
  for (const dt of deniedTags) {
    if (memTags.has(dt)) {
      return dt === JIT_PROTECTED_TAG ? { access: "jit" } : { access: "deny" };
    }
  }

  // If the memory has #confidential and the agent hasn't been explicitly allowed it, trigger JIT.
  if (memTags.has(JIT_PROTECTED_TAG) && !allowedTags.includes(JIT_PROTECTED_TAG)) {
    return { access: "jit" };
  }

  // If an explicit allowlist is set, the memory must match at least one allowed tag.
  if (allowedTags.length > 0) {
    const hasAllowed = allowedTags.some((at) => memTags.has(at));
    if (!hasAllowed) return { access: "deny" };
  }

  return { access: "allow" };
}

// Create a JIT access request row and notify the developer via in-app notification.
// Returns the newly-created JIT request id.
async function createJitRequest(
  db: ReturnType<typeof drizzle>,
  params: {
    tokenId: string;
    userId: string;
    toolName: string;
    args: Record<string, unknown>;
    blockedMemoryIds: string[];
    agentContext: string;
  },
): Promise<string> {
  const jitId = crypto.randomUUID();
  await db.insert(jitAccessRequests).values({
    id: jitId,
    tokenId: params.tokenId,
    userId: params.userId,
    mcpMethod: params.toolName,
    mcpArgs: JSON.stringify(params.args),
    blockedMemoryIds: params.blockedMemoryIds.join(","),
    status: "pending",
    createdAt: Date.now(),
  });
  try {
    await db.insert(notifications).values({
      id: crypto.randomUUID(),
      userId: params.userId,
      title: "JIT Access Approval Required",
      message: `Agent "${params.agentContext}" requested access to #confidential memories via ${params.toolName}. Approve or deny at Settings → Agent Tokens.`,
      type: "warning",
      linkUrl: `/settings/agent-tokens?jit=${jitId}`,
      createdAt: Date.now(),
    });
  } catch (e) {
    console.error("[JIT] Failed to write notification:", e);
  }
  console.warn(`[JIT] Request created id=${jitId} agent="${params.agentContext}" tool=${params.toolName} blocked=${params.blockedMemoryIds.join(",")}`);
  return jitId;
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
  isAgent: boolean;
  agentPolicy: AgentPolicy | null;
  // Set when the token is a JIT token — grants access to the listed memory IDs only.
  jitRequestId: string | null;
  jitAllowedMemoryIds: Set<string> | null;
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
          isAgent: false,
          agentPolicy: null,
          jitRequestId: null,
          jitAllowedMemoryIds: null,
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
    const db = drizzle(env.DB, { schema: { apiTokens, organizationMembers, teamMembers } });

    // Handle JIT short-lived tokens
    if (rawToken.startsWith("lkr_jit_")) {
      const jitDb = drizzle(env.DB, { schema: { jitAccessRequests } });
      const jitRows = await jitDb
        .select()
        .from(jitAccessRequests)
        .where(eq(jitAccessRequests.status, "approved"))
        .all();
      
      let matchedRow = null;
      for (const row of jitRows) {
        if (row.jitTokenHash && row.jitExpiresAt && row.jitExpiresAt > Date.now()) {
          const jitValid = await verifyToken(rawToken, row.jitTokenHash);
          if (jitValid) {
            matchedRow = row;
            break;
          }
        }
      }

      if (matchedRow) {
        // Load original agent token's policy and scopes
        const tokenRows = await db.select().from(apiTokens).where(eq(apiTokens.id, matchedRow.tokenId)).all();
        if (tokenRows.length > 0) {
          const token = tokenRows[0];
          let accessibleScopes: Array<{ type: "personal" | "organization" | "team"; id: string | null }> = [];
          if (token.scopes) {
            try {
              accessibleScopes = JSON.parse(token.scopes);
            } catch (e) {}
          }
          if (accessibleScopes.length === 0) {
            accessibleScopes = [{ type: token.scopeType as any, id: token.scopeId }];
          }
          const isAgent = token.tokenType === "agent";
          let agentPolicy = null;
          if (isAgent && token.agentPolicy) {
            try {
              agentPolicy = JSON.parse(token.agentPolicy);
            } catch {}
          }
          
          return {
            userId: token.userId,
            tokenId: token.id,
            permissions: token.permissions,
            scopeType: token.scopeType as any,
            scopeId: token.scopeId,
            accessibleScopes,
            isAgent,
            agentPolicy,
            jitRequestId: matchedRow.id,
            jitAllowedMemoryIds: new Set(
              matchedRow.blockedMemoryIds ? matchedRow.blockedMemoryIds.split(",").filter(Boolean) : []
            ),
          };
        }
      }
      return null;
    }

    // Token format: lkr_<32-hex-id>_<32-hex-secret>
    // Look up by embedded row id, then verify with PBKDF2.
    const afterPrefix = rawToken.slice(4); // strip "lkr_"
    const secondUnderscore = afterPrefix.indexOf("_");
    if (secondUnderscore !== 32) return null; // not a valid v2 token

    const embeddedIdHex = afterPrefix.slice(0, 32);
    const embeddedId = [
      embeddedIdHex.slice(0, 8),
      embeddedIdHex.slice(8, 12),
      embeddedIdHex.slice(12, 16),
      embeddedIdHex.slice(16, 20),
      embeddedIdHex.slice(20),
    ].join("-");
    let rows;
    try {
      rows = await db.select().from(apiTokens).where(eq(apiTokens.id, embeddedId)).all();
    } catch (dbErr: any) {
      console.error("D1 token query failed:", dbErr);
      return null;
    }

    if (!rows.length) return null;
    const token = rows[0];

    const valid = await verifyToken(rawToken, token.tokenHash);
    if (!valid) return null;

    // Opportunistically upgrade legacy SHA-256 hashes to PBKDF2 on first successful auth.
    // A plain SHA-256 hash is 64 lowercase hex chars with no "$" prefix.
    if (/^[0-9a-f]{64}$/.test(token.tokenHash)) {
      try {
        const upgradedHash = await hashToken(rawToken);
        await db.update(apiTokens).set({ tokenHash: upgradedHash }).where(eq(apiTokens.id, token.id)).run();
        console.log(`[api-token] upgraded SHA-256 hash to PBKDF2 for token ${token.id}`);
      } catch (upgradeErr) {
        console.error("[api-token] PBKDF2 upgrade failed (non-fatal):", upgradeErr);
      }
    }

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

    const isAgent = token.tokenType === "agent";
    let agentPolicy: AgentPolicy | null = null;
    if (isAgent && token.agentPolicy) {
      try {
        agentPolicy = JSON.parse(token.agentPolicy) as AgentPolicy;
      } catch {
        agentPolicy = { agentContext: "unknown", allowedCategories: [], deniedCategories: [], allowedTags: [], deniedTags: [], allowCredentials: false };
      }
    }

    // Check if this lkr_ token is being used as a JIT token for a specific approved request.
    let jitRequestId: string | null = null;
    let jitAllowedMemoryIds: Set<string> | null = null;
    if (isAgent) {
      const jitDb = drizzle(env.DB);
      const jitRows = await jitDb
        .select()
        .from(jitAccessRequests)
        .where(
          and(
            eq(jitAccessRequests.tokenId, token.id),
            eq(jitAccessRequests.status, "approved"),
          )
        )
        .all();
      // Find a row whose jitTokenHash matches rawToken and has not yet expired.
      for (const row of jitRows) {
        if (row.jitTokenHash && row.jitExpiresAt && row.jitExpiresAt > Date.now()) {
          const jitValid = await verifyToken(rawToken, row.jitTokenHash);
          if (jitValid) {
            jitRequestId = row.id;
            jitAllowedMemoryIds = new Set(
              row.blockedMemoryIds ? row.blockedMemoryIds.split(",").filter(Boolean) : []
            );
            break;
          }
        }
      }
    }

    return {
      userId: token.userId,
      tokenId: token.id,
      permissions: token.permissions,
      scopeType: token.scopeType as any,
      scopeId: token.scopeId,
      accessibleScopes,
      isAgent,
      agentPolicy,
      jitRequestId,
      jitAllowedMemoryIds,
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
        isAgent: false,
        agentPolicy: null,
        jitRequestId: null,
        jitAllowedMemoryIds: null,
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
    isAgent: false,
    agentPolicy: null,
    jitRequestId: null,
    jitAllowedMemoryIds: null,
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
      if (t.name === "sync_agent_configs") return !!(claims.permissions & MCP_PERM_RECALL);
      if (t.name === "store_credential") return !!(claims.permissions & MCP_PERM_COMMIT);
      if (t.name === "delete_credential") return !!(claims.permissions & MCP_PERM_DELETE);
      if (t.name === "list_credentials" || t.name === "retrieve_credential") return !!(claims.permissions & MCP_PERM_RECALL);
      if (t.name === "store_config") return !!(claims.permissions & MCP_PERM_COMMIT);
      if (t.name === "update_config") return !!(claims.permissions & MCP_PERM_UPDATE);
      // approve_jit_access is only exposed to human (non-agent) tokens.
      if (t.name === "approve_jit_access") return !!(claims.permissions & MCP_PERM_RECALL) && !claims.isAgent;
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
      if (t.name === "sync_agent_configs") return !!(claims.permissions & MCP_PERM_RECALL);
      if (t.name === "store_credential") return !!(claims.permissions & MCP_PERM_COMMIT);
      if (t.name === "delete_credential") return !!(claims.permissions & MCP_PERM_DELETE);
      if (t.name === "list_credentials" || t.name === "retrieve_credential") return !!(claims.permissions & MCP_PERM_RECALL);
      if (t.name === "approve_jit_access") return !!(claims.permissions & MCP_PERM_RECALL) && !claims.isAgent;
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
    const optimize = !!args.optimize;
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

    // ABAC: resolve category filter for agent tokens
    const categoryFilter = resolveAgentCategoryFilter(claims);
    if (categoryFilter !== null && categoryFilter.size === 0) {
      await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "recall_context_abac_denied", ipAddress, userAgent, metadata: { query, projectKey, agentContext: claims.agentPolicy?.agentContext, reason: "no_allowed_categories" } });
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify([]) }] });
    }

    // Build the D1 database conditions to query all active candidate memories for the current user & scope
    const scopeConditions = [];
    if (isActive !== undefined) {
      scopeConditions.push(eq(memories.isActive, isActive));
    }
    if (categoryFilter !== null) {
      const allowed = Array.from(categoryFilter);
      scopeConditions.push(sql`${memories.category} IN (${sql.join(allowed.map((c) => sql`${c}`), sql`, `)})`);
    }

    let orgAndTeamKeys: string[] = [];
    let allowedScopeKeys: (string | null)[] = [null, ""];

    if (crossWorkspaceSearch) {
      const [orgs, teamsList] = await Promise.all([
        db.select({ orgId: organizationMembers.orgId }).from(organizationMembers).where(eq(organizationMembers.userId, claims.userId)).all(),
        db.select({ teamId: teamMembers.teamId }).from(teamMembers).where(eq(teamMembers.userId, claims.userId)).all()
      ]);
      orgAndTeamKeys = [
        ...orgs.map((o) => `org:${o.orgId}`),
        ...teamsList.map((t) => `team:${t.teamId}`),
      ];
      allowedScopeKeys = [null, "", ...orgAndTeamKeys];
      scopeConditions.push(
        sql`(${memories.userId} = ${claims.userId} OR ${memories.projectKey} IN (${sql.join(allowedScopeKeys.map((k) => sql`${k}`), sql`, `)}))`
      );
    } else {
      if (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) {
        scopeConditions.push(eq(memories.projectKey, projectKey));
      } else {
        scopeConditions.push(eq(memories.userId, claims.userId));
        if (projectKey) {
          scopeConditions.push(
            sql`(${memories.projectKey} = ${projectKey} OR ${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
          );
        } else {
          scopeConditions.push(
            sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`
          );
        }
      }
    }

    // Promise 1: Query D1 database for all scope memories
    const d1Promise = db
      .select()
      .from(memories)
      .where(and(...scopeConditions))
      .all();

    // Promise 2: Query Vectorize — return indexed metadata so we can read entityIds for graph expansion.
    let vectorizePromise: Promise<any[]>;
    if (crossWorkspaceSearch) {
      const personalFilter: Record<string, any> = { userId: claims.userId };
      const orgFilter: Record<string, any> = { projectKey: { $in: orgAndTeamKeys } };
      if (categoryFilter !== null) {
        const allowed = Array.from(categoryFilter);
        personalFilter.category = { $in: allowed };
        orgFilter.category = { $in: allowed };
      }
      vectorizePromise = Promise.all([
        env.VECTOR_INDEX.query(embedding, { topK: vectorTopK, filter: personalFilter, returnMetadata: "indexed" }),
        orgAndTeamKeys.length > 0
          ? env.VECTOR_INDEX.query(embedding, { topK: vectorTopK, filter: orgFilter, returnMetadata: "indexed" })
          : Promise.resolve({ matches: [] })
      ]).then(([personalResults, orgResults]) => {
        return [...(personalResults.matches ?? []), ...(orgResults.matches ?? [])];
      });
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
      if (categoryFilter !== null) {
        filter.category = { $in: Array.from(categoryFilter) };
      }

      vectorizePromise = env.VECTOR_INDEX.query(embedding, {
        topK: vectorTopK,
        filter,
        returnMetadata: "indexed",
      }).then((res) => res.matches ?? []);
    }

    // Execute database and vector search queries in parallel
    const [vectorMatches, dbRows] = await Promise.all([vectorizePromise, d1Promise]);

    // GraphRAG expansion: collect entity IDs stored in Vectorize metadata and use a
    // lightning-fast IN (...) lookup on memory_graph_edges to pull adjacent memories.
    const vectorIds = vectorMatches.map((m: any) => m.id as string);
    const entityIds = vectorMatches.flatMap((m: any) => {
      const raw = (m.metadata as Record<string, unknown> | undefined)?.entityIds;
      if (typeof raw !== "string" || !raw) return [];
      return raw.split(" ").filter(Boolean);
    });
    // expandedIds may include graph-adjacent memory IDs not in the original vector results.
    const expandedIds = entityIds.length > 0
      ? await expandByEntityIds(env.DB, entityIds, vectorIds)
      : vectorIds;

    if (!dbRows.length) {
      await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "recall_context", ipAddress, userAgent, metadata: { query, projectKey, matchCount: 0 } });
      await logTokenUsage(db, claims.tokenId, "recall", tokensConsumed);
      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify([]) }] });
    }

    const decrypted: Array<{ row: typeof dbRows[0]; ephemeralFact: EphemeralPlaintext }> = [];
    try {
      for (const r of dbRows) {
        const vaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : claims.userId;
        const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
        let eph;
        if (isEncrypted(r.fact)) {
          eph = await decryptEphemeral(r.fact, vaultKey);
        } else {
          eph = new EphemeralPlaintext(new TextEncoder().encode(r.fact));
        }
        decrypted.push({ row: r, ephemeralFact: eph });
      }

      // Apply hard filters (category, tag, keyword) using ephemeralFact.get()
      const filteredDecrypted = decrypted.filter(({ row, ephemeralFact }) => {
        if (category && row.category !== category) return false;
        if (tag) {
          const lowerTag = tag.toLowerCase().trim();
          const tagsList = (row.tags || "").split(",").map((t) => t.trim().toLowerCase());
          if (!tagsList.includes(lowerTag)) return false;
        }
        if (keyword) {
          const lowerKw = keyword.toLowerCase().trim();
          if (!ephemeralFact.get().toLowerCase().includes(lowerKw)) return false;
        }
        return true;
      });

      // 1. Semantic Search (Vectorize) Ranked List
      // Map vector matches back to decrypted memories (preserving semantic ordering)
      const decryptedMap = new Map(filteredDecrypted.map((m) => [m.row.id, m]));
      const vectorRanked = vectorMatches
        .map((vm: any) => decryptedMap.get(vm.id))
        .filter((m): m is NonNullable<typeof m> => !!m);

      // 1b. Graph-expanded results: memories adjacent via shared entity nodes.
      // These get a fixed low RRF score so they appear after semantic/FTS results but
      // before the topK cutoff when they're genuinely related architectural components.
      const graphExpandedSet = new Set(expandedIds);
      const graphRanked = filteredDecrypted.filter(
        (m) => graphExpandedSet.has(m.row.id) && !vectorMatches.some((vm: any) => vm.id === m.row.id)
      );

      // 2. Keyword/Full-Text Search Ranked List
      const queryLower = queryTrimmed.toLowerCase();
      const queryTokens = queryLower.split(/[^a-z0-9]+/i).filter((t) => t.length > 0);

      const ftsRanked = filteredDecrypted
        .map((m) => {
          let score = 0;
          const factLower = m.ephemeralFact.get().toLowerCase();

          // Exact substring match on full query
          if (factLower.includes(queryLower)) {
            score += 1000;
          }

          // Token match scoring
          for (const token of queryTokens) {
            if (factLower.includes(token)) {
              score += 10;
            }
          }

          // Tag matching booster
          const tagsLower = (m.row.tags || "").toLowerCase();
          for (const token of queryTokens) {
            if (tagsLower.includes(token)) {
              score += 5;
            }
          }

          return { item: m, score };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || b.item.row.timestamp - a.item.row.timestamp)
        .map((item) => item.item);

      // 3. Reciprocal Rank Fusion (RRF)
      const rrfMap = new Map<string, { item: typeof decrypted[0]; rrfScore: number }>();
      const k = 60;

      vectorRanked.forEach((m, idx) => {
        const score = 1 / (k + idx + 1);
        rrfMap.set(m.row.id, { item: m, rrfScore: score });
      });

      ftsRanked.forEach((m, idx) => {
        const score = 1 / (k + idx + 1);
        const existing = rrfMap.get(m.row.id);
        if (existing) {
          existing.rrfScore += score;
        } else {
          rrfMap.set(m.row.id, { item: m, rrfScore: score });
        }
      });

      // Graph-expanded results enter the RRF map at a fixed score below any ranked result
      // so they surface only when topK is not already filled by semantic/FTS matches.
      const graphBaseScore = 1 / (k + vectorRanked.length + ftsRanked.length + 1);
      graphRanked.forEach((m) => {
        if (!rrfMap.has(m.row.id)) {
          rrfMap.set(m.row.id, { item: m, rrfScore: graphBaseScore });
        }
      });

      // Sort RRF merged list:
      const ranked = Array.from(rrfMap.values())
        .sort((a, b) => {
          const authA = a.item.row.authorityType === "authoritative" ? 1 : 0;
          const authB = b.item.row.authorityType === "authoritative" ? 1 : 0;
          if (authA !== authB) {
            return authB - authA; // authoritative first
          }
          return b.rrfScore - a.rrfScore;
        })
        .map((x) => x.item);

      const finalResults = ranked.slice(0, topK);

      // Audit log & token usage
      await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "recall_context", ipAddress, userAgent, metadata: { query, projectKey, matchCount: finalResults.length } });
      await logTokenUsage(db, claims.tokenId, "recall", tokensConsumed);

      // Update lastAccessedAt for recalled memories
      if (finalResults.length > 0) {
        const recalledIds = finalResults.map((r) => r.row.id);
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

      // Tag-level ABAC: evaluate each result; collect any that need JIT.
      const jitBlockedIds: string[] = [];
      const payloadResults = finalResults.map((m) => {
        if (m.row.isQuarantined) {
          return { id: m.row.id, userId: m.row.userId, fact: "[REDACTED]", category: m.row.category, tags: m.row.tags, timestamp: m.row.timestamp, isActive: m.row.isActive, projectKey: m.row.projectKey, scopeType: m.row.scopeType, scopeId: m.row.scopeId, isLocked: m.row.isLocked, authorityType: m.row.authorityType, lastAccessedAt: m.row.lastAccessedAt };
        }
        // JIT bypass: if this token was issued for this specific request, unredact allowed IDs.
        if (claims.jitAllowedMemoryIds?.has(m.row.id)) {
          return { id: m.row.id, userId: m.row.userId, fact: m.ephemeralFact.get(), category: m.row.category, tags: m.row.tags, timestamp: m.row.timestamp, isActive: m.row.isActive, projectKey: m.row.projectKey, scopeType: m.row.scopeType, scopeId: m.row.scopeId, isLocked: m.row.isLocked, authorityType: m.row.authorityType, lastAccessedAt: m.row.lastAccessedAt };
        }
        const tagCheck = checkTagAccess(m.row.tags, claims.agentPolicy);
        if (tagCheck.access === "jit") {
          jitBlockedIds.push(m.row.id);
          return { id: m.row.id, userId: m.row.userId, fact: "[APPROVAL PENDING]", category: m.row.category, tags: m.row.tags, timestamp: m.row.timestamp, isActive: m.row.isActive, projectKey: m.row.projectKey, scopeType: m.row.scopeType, scopeId: m.row.scopeId, isLocked: m.row.isLocked, authorityType: m.row.authorityType, lastAccessedAt: m.row.lastAccessedAt };
        }
        if (tagCheck.access === "deny") {
          return null;
        }
        return { id: m.row.id, userId: m.row.userId, fact: m.ephemeralFact.get(), category: m.row.category, tags: m.row.tags, timestamp: m.row.timestamp, isActive: m.row.isActive, projectKey: m.row.projectKey, scopeType: m.row.scopeType, scopeId: m.row.scopeId, isLocked: m.row.isLocked, authorityType: m.row.authorityType, lastAccessedAt: m.row.lastAccessedAt };
      }).filter((r): r is NonNullable<typeof r> => r !== null);

      // If any memories needed JIT approval, create a pending request and include it in the response.
      let jitMeta: { jitRequestId: string; message: string } | undefined;
      if (jitBlockedIds.length > 0 && claims.isAgent) {
        const jitId = await createJitRequest(db, {
          tokenId: claims.tokenId,
          userId: claims.userId,
          toolName: "recall_context",
          args,
          blockedMemoryIds: jitBlockedIds,
          agentContext: claims.agentPolicy?.agentContext ?? "unknown",
        });
        jitMeta = {
          jitRequestId: jitId,
          message: `${jitBlockedIds.length} memory(s) tagged #confidential require developer approval before they can be returned. A notification has been sent. Retry with your JIT token once approved.`,
        };
        await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "jit_access_requested", ipAddress, userAgent, metadata: { jitId, blockedCount: jitBlockedIds.length, toolName: "recall_context" } });
      }

      if (optimize && payloadResults.length > 0) {
        // Only pack facts that are visible (skip redacted/pending entries).
        const packable = payloadResults.filter(
          (r) => r.fact !== "[REDACTED]" && r.fact !== "[APPROVAL PENDING]"
        );
        const optimizedPrompt = await packPrompt(env.AI, query, packable);
        const responseText = JSON.stringify({
          optimized_prompt: optimizedPrompt,
          ...(jitMeta ? { jit: jitMeta } : {}),
        });
        return mcpResult(id, { content: [{ type: "text", text: responseText }] });
      }

      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify({ results: payloadResults, ...(jitMeta ? { jit: jitMeta } : {}) }) }] });
    } finally {
      // Clean up all ephemeral plaintext
      for (const m of decrypted) {
        m.ephemeralFact.drop();
      }
    }
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

    // ABAC: agent tokens are restricted to their allowed categories
    const searchCategoryFilter = resolveAgentCategoryFilter(claims);
    if (searchCategoryFilter !== null && category && !searchCategoryFilter.has(category as MemoryCategory)) {
      return mcpError(id, -32003, `Forbidden: agent token cannot search category '${category}'`);
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
    } else if (searchCategoryFilter !== null) {
      const allowed = Array.from(searchCategoryFilter);
      if (allowed.length === 0) {
        return mcpResult(id, { content: [{ type: "text", text: JSON.stringify([]) }] });
      }
      conditions.push(sql`${memories.category} IN (${sql.join(allowed.map((c) => sql`${c}`), sql`, `)})`);
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

    const decrypted: Array<{ row: typeof rows[0]; ephemeralFact: EphemeralPlaintext }> = [];
    try {
      const vaultId = (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) ? projectKey : claims.userId;
      const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

      for (const r of rows) {
        let eph;
        if (isEncrypted(r.fact)) {
          eph = await decryptEphemeral(r.fact, vaultKey);
        } else {
          eph = new EphemeralPlaintext(new TextEncoder().encode(r.fact));
        }
        decrypted.push({ row: r, ephemeralFact: eph });
      }

      // Filter in memory for tag and keyword using ephemeralFact.get()
      let filtered = decrypted;
      if (tag) {
        const lowerTag = tag.toLowerCase().trim();
        filtered = filtered.filter((item) =>
          (item.row.tags || "").split(",").map((t) => t.trim().toLowerCase()).includes(lowerTag)
        );
      }
      if (keyword) {
        const lowerKw = keyword.toLowerCase().trim();
        filtered = filtered.filter((item) => item.ephemeralFact.get().toLowerCase().includes(lowerKw));
      }

      const paginated = filtered.slice(offset, offset + limit);

      // Audit log & token usage
      await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "search_memories", ipAddress, userAgent, metadata: { category, tag, keyword, projectKey, matchCount: paginated.length } });
      await logTokenUsage(db, claims.tokenId, "recall", 0);

      // Tag-level ABAC + JIT intercept.
      const searchJitBlockedIds: string[] = [];
      const payloadResults = paginated.map((item) => {
        if (item.row.isQuarantined) {
          return { id: item.row.id, userId: item.row.userId, fact: "[REDACTED]", category: item.row.category, tags: item.row.tags, timestamp: item.row.timestamp, isActive: item.row.isActive, projectKey: item.row.projectKey, scopeType: item.row.scopeType, scopeId: item.row.scopeId, isLocked: item.row.isLocked, authorityType: item.row.authorityType, lastAccessedAt: item.row.lastAccessedAt };
        }
        if (claims.jitAllowedMemoryIds?.has(item.row.id)) {
          return { id: item.row.id, userId: item.row.userId, fact: item.ephemeralFact.get(), category: item.row.category, tags: item.row.tags, timestamp: item.row.timestamp, isActive: item.row.isActive, projectKey: item.row.projectKey, scopeType: item.row.scopeType, scopeId: item.row.scopeId, isLocked: item.row.isLocked, authorityType: item.row.authorityType, lastAccessedAt: item.row.lastAccessedAt };
        }
        const tagCheck = checkTagAccess(item.row.tags, claims.agentPolicy);
        if (tagCheck.access === "jit") {
          searchJitBlockedIds.push(item.row.id);
          return { id: item.row.id, userId: item.row.userId, fact: "[APPROVAL PENDING]", category: item.row.category, tags: item.row.tags, timestamp: item.row.timestamp, isActive: item.row.isActive, projectKey: item.row.projectKey, scopeType: item.row.scopeType, scopeId: item.row.scopeId, isLocked: item.row.isLocked, authorityType: item.row.authorityType, lastAccessedAt: item.row.lastAccessedAt };
        }
        if (tagCheck.access === "deny") return null;
        return { id: item.row.id, userId: item.row.userId, fact: item.ephemeralFact.get(), category: item.row.category, tags: item.row.tags, timestamp: item.row.timestamp, isActive: item.row.isActive, projectKey: item.row.projectKey, scopeType: item.row.scopeType, scopeId: item.row.scopeId, isLocked: item.row.isLocked, authorityType: item.row.authorityType, lastAccessedAt: item.row.lastAccessedAt };
      }).filter((r): r is NonNullable<typeof r> => r !== null);

      let searchJitMeta: { jitRequestId: string; message: string } | undefined;
      if (searchJitBlockedIds.length > 0 && claims.isAgent) {
        const jitId = await createJitRequest(db, {
          tokenId: claims.tokenId,
          userId: claims.userId,
          toolName: "search_memories",
          args,
          blockedMemoryIds: searchJitBlockedIds,
          agentContext: claims.agentPolicy?.agentContext ?? "unknown",
        });
        searchJitMeta = {
          jitRequestId: jitId,
          message: `${searchJitBlockedIds.length} memory(s) tagged #confidential require developer approval before they can be returned. A notification has been sent. Retry with your JIT token once approved.`,
        };
        await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "jit_access_requested", ipAddress, userAgent, metadata: { jitId, blockedCount: searchJitBlockedIds.length, toolName: "search_memories" } });
      }

      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify({ results: payloadResults, ...(searchJitMeta ? { jit: searchJitMeta } : {}) }) }] });
    } finally {
      // Clean up all ephemeral plaintext
      for (const item of decrypted) {
        item.ephemeralFact.drop();
      }
    }
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

    const summaryCategoryFilter = resolveAgentCategoryFilter(claims);
    if (summaryCategoryFilter !== null) {
      const allowed = Array.from(summaryCategoryFilter);
      if (allowed.length > 0) {
        conditions.push(sql`${memories.category} IN (${sql.join(allowed.map((c) => sql`${c}`), sql`, `)})`);
      }
    }

    const rows = await db
      .select({ category: memories.category, tags: memories.tags })
      .from(memories)
      .where(and(...conditions))
      .all();

    const summary = {
      total: 0,
      categories: {
        rules: 0,
        projects: 0,
        references: 0,
        configs: 0,
      },
      tags: {} as Record<string, number>,
    };

    for (const row of rows) {
      if (summaryCategoryFilter !== null && !summaryCategoryFilter.has(row.category as MemoryCategory)) continue;
      summary.total++;
      if (row.category in summary.categories) {
        summary.categories[row.category as "rules" | "projects" | "references" | "configs"]++;
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

    // Block generic writes to the protected configs category.
    if ((args.category as string | undefined) === "configs") {
      return configsCategoryForbidden(id);
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

    // ABAC: agent tokens cannot commit to categories outside their policy
    const commitCategoryFilter = resolveAgentCategoryFilter(claims);
    if (!checkCategoryAccess(category, commitCategoryFilter)) {
      return mcpError(id, -32003, `Forbidden: agent token cannot commit memories to category '${category}'. Allowed: ${Array.from(commitCategoryFilter!).join(", ")}`);
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

    const sanitizedFact = sanitizeMemory(fact.trim());
    if (!sanitizedFact) {
      return mcpError(id, -32602, "Invalid params: fact was empty or contained adversarial instructions");
    }

    // DLP Quarantine Check: flag if sensitive data is detected, but keep raw fact.
    const isQuarantined = containsSensitiveData(sanitizedFact);

    const memId = crypto.randomUUID();
    const timestamp = Date.now();
    const [embedding, graphExtraction] = await Promise.all([
      generateEmbedding(env.AI, sanitizedFact),
      extractGraphEntities(env.AI, sanitizedFact),
    ]);
    const tokensConsumed = estimateEmbeddingTokens(sanitizedFact);

    // Fetch envelope DEK for this vault
    const vaultId = (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) ? projectKey : claims.userId;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encrypt(sanitizedFact, vaultKey);

    // Archive contradicted memories asynchronously via Queue
    try {
      await env.ARCHIVE_QUEUE.send({
        userId: claims.userId,
        newFact: sanitizedFact,
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
      isQuarantined,
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

    // Persist GraphRAG entity nodes and edges; best-effort — must not block the write.
    let entityIds: string[] = [];
    try {
      entityIds = await persistGraphData(env.DB, memId, claims.userId, projectKey ?? null, graphExtraction);
    } catch (err) {
      console.error("[mcp commit_memory] graph persist failed:", err);
    }

    await env.VECTOR_INDEX.insert([
      {
        id: memId,
        values: embedding,
        metadata: {
          userId: claims.userId,
          category,
          tags: finalTags,
          projectKey: projectKey ?? "",
          // Space-separated entity node IDs enable O(1) IN() graph expansion at recall time.
          entityIds: entityIds.join(" "),
        },
      },
    ]);

    // Audit log & token usage
    await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "commit_memory", memoryId: memId, ipAddress, userAgent, metadata: { category, projectKey, quarantined: isQuarantined } });
    await logTokenUsage(db, claims.tokenId, "commit", tokensConsumed);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, id: memId, fact: isQuarantined ? "[REDACTED]" : sanitizedFact, category, tags: finalTags, projectKey }) },
      ],
    });
  }

  if (toolName === "update_memory") {
    if (!(claims.permissions & MCP_PERM_UPDATE)) {
      return mcpError(id, -32001, "Token does not have update_memory permission");
    }

    // Block generic updates to the protected configs category (incoming or existing row).
    if ((args.category as string | undefined) === "configs") {
      return configsCategoryForbidden(id);
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

    const confirm = args.confirm as boolean | undefined;
    if (confirm !== true) {
      return mcpError(id, -32602, "Invalid params: confirm must be set to true");
    }

    // ── AGENT APPROVAL GATE ────────────────────────────────────────────────────
    // Agent tokens cannot execute destructive writes directly — regardless of
    // `confirm: true`. The request is routed into the approval queue so the human
    // must click "Approve" in the Locker UI before any change is applied.
    if (claims.isAgent) {
      const rows = await db.select().from(memories).where(eq(memories.id, memId)).all();
      if (!rows.length) {
        return mcpError(id, -32602, `Memory not found or unauthorized: ${memId}`);
      }
      const existing = rows[0];

      if (!isProjectKeyAllowedByToken(claims.accessibleScopes, existing.projectKey)) {
        return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${existing.projectKey ?? "personal"}'`);
      }

      const updateCategoryFilter = resolveAgentCategoryFilter(claims);
      if (!checkCategoryAccess(existing.category, updateCategoryFilter)) {
        return mcpError(id, -32003, `Forbidden: agent token cannot update memories in category '${existing.category}'`);
      }

      const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, existing.projectKey);
      if (!vaultAllowed) {
        return mcpError(id, -32003, `Forbidden: no access to vault scope '${existing.projectKey}'`);
      }

      const sanitizedFact = sanitizeMemory(fact.trim());
      if (!sanitizedFact) {
        return mcpError(id, -32602, "Invalid params: fact was empty or contained adversarial instructions");
      }

      const proposedCategory = args.category !== undefined
        ? normalizeCategory(args.category as string | undefined)
        : existing.category;
      const proposedTags = args.tags !== undefined
        ? (typeof args.tags === "string" ? args.tags.trim() : existing.tags)
        : existing.tags;

      // Decrypt the current fact to display in the approval UI
      const vaultId = (existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"))) ? existing.projectKey : claims.userId;
      const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
      const currentFact = isEncrypted(existing.fact) ? await decrypt(existing.fact, vaultKey) : existing.fact;

      const agentLabel = claims.agentPolicy?.agentContext ?? "unknown agent";
      const recId = crypto.randomUUID();

      await db.insert(memoryRecommendations).values({
        id: recId,
        orgId: orgId ?? null,
        userId: claims.userId,
        fact: currentFact,
        category: existing.category,
        tags: existing.tags,
        projectKey: existing.projectKey ?? null,
        scopeType: existing.scopeType,
        scopeId: existing.scopeId ?? null,
        recommendationType: "update",
        targetMemoryId: memId,
        status: "pending",
        proposedFact: sanitizedFact,
        proposedCategory,
        proposedTags,
        agentContext: agentLabel,
        createdAt: Date.now(),
      });

      try {
        await db.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: claims.userId,
          title: "Agent Update Approval Required",
          message: `Agent "${agentLabel}" wants to update a memory. Review and approve in your Locker vault.`,
          type: "warning",
          status: "unread",
          linkUrl: "/memories",
          createdAt: Date.now(),
        });
      } catch (e) {
        console.error("[update_memory] notification failed:", e);
      }

      await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "update_memory_queued", memoryId: memId, ipAddress, userAgent, metadata: { recId, agentContext: agentLabel } });

      return mcpResult(id, {
        content: [
          { type: "text", text: JSON.stringify({ queued: true, recommendationId: recId, message: "Update request queued for human approval. The memory will not be changed until the owner approves it in the Locker UI." }) },
        ],
      });
    }
    // ── END AGENT GATE ─────────────────────────────────────────────────────────

    // MFA / Passcode verification (human tokens only)
    const totpRows = await db
      .select()
      .from(totpSecrets)
      .where(and(eq(totpSecrets.userId, claims.userId), eq(totpSecrets.verified, true)))
      .all();

    if (totpRows.length > 0) {
      const totpCode = args.totpCode as string | undefined;
      if (!totpCode || typeof totpCode !== "string") {
        return mcpError(id, -32024, "MFA Verification Required: Please provide a valid 6-digit TOTP code.");
      }
      const totpEnvKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, claims.userId);
      const ephemeralSecret = await decryptEphemeral(totpRows[0].secret, totpEnvKey);
      let verified = false;
      try {
        verified = await verifyTOTP(ephemeralSecret.get(), totpCode);
      } finally {
        ephemeralSecret.drop();
      }
      if (!verified) {
        return mcpError(id, -32024, "MFA Verification Failed: Invalid TOTP code.");
      }
    } else {
      const userRows = await db
        .select({ writePasscodeHash: users.writePasscodeHash })
        .from(users)
        .where(eq(users.id, claims.userId))
        .all();
      if (userRows.length > 0 && userRows[0].writePasscodeHash) {
        const passcode = args.passcode as string | undefined;
        if (!passcode || typeof passcode !== "string") {
          return mcpError(id, -32025, "Passcode Verification Required: Please provide your deletion passcode.");
        }
        const valid = await verifyToken(passcode, userRows[0].writePasscodeHash);
        if (!valid) {
          return mcpError(id, -32025, "Passcode Verification Failed: Invalid deletion passcode.");
        }
      }
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

    // Block generic update_memory on configs category rows — use update_config instead.
    if (existing.category === "configs") {
      return configsCategoryForbidden(id);
    }

    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, existing.projectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${existing.projectKey ?? "personal"}'`);
    }

    // ABAC: agent tokens cannot update memories in blocked categories
    const updateCategoryFilter = resolveAgentCategoryFilter(claims);
    if (!checkCategoryAccess(existing.category, updateCategoryFilter)) {
      return mcpError(id, -32003, `Forbidden: agent token cannot update memories in category '${existing.category}'`);
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

    const sanitizedFact = sanitizeMemory(fact.trim());
    if (!sanitizedFact) {
      return mcpError(id, -32602, "Invalid params: fact was empty or contained adversarial instructions");
    }

    // DLP Quarantine Check: flag if sensitive data is detected, but keep raw fact.
    const isQuarantined = containsSensitiveData(sanitizedFact);

    const embedding = await generateEmbedding(env.AI, sanitizedFact);
    const tokensConsumed = estimateEmbeddingTokens(sanitizedFact);

    // Fetch envelope DEK for this vault
    const vaultId = (existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"))) ? existing.projectKey : claims.userId;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encrypt(sanitizedFact, vaultKey);

    await db.update(memories)
      .set({
        fact: encryptedFact,
        category,
        tags: rawTags,
        timestamp: Date.now(),
        isQuarantined,
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
    await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "update_memory", memoryId: memId, ipAddress, userAgent, metadata: { category, quarantined: isQuarantined } });
    await logTokenUsage(db, claims.tokenId, "commit", tokensConsumed);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, id: memId, fact: isQuarantined ? "[REDACTED]" : sanitizedFact, category, tags: rawTags }) },
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

    const confirm = args.confirm as boolean | undefined;
    if (confirm !== true) {
      return mcpError(id, -32602, "Invalid params: confirm must be set to true");
    }

    // ── AGENT APPROVAL GATE ────────────────────────────────────────────────────
    // Agent tokens cannot delete memories directly. The request is queued for
    // human approval in the Locker UI. The memory is unchanged until approved.
    if (claims.isAgent) {
      const rows = await db.select().from(memories).where(eq(memories.id, memId)).all();
      if (!rows.length) {
        return mcpError(id, -32602, `Memory not found or unauthorized: ${memId}`);
      }
      const existing = rows[0];

      if (!isProjectKeyAllowedByToken(claims.accessibleScopes, existing.projectKey)) {
        return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${existing.projectKey ?? "personal"}'`);
      }

      const deleteCategoryFilter = resolveAgentCategoryFilter(claims);
      if (!checkCategoryAccess(existing.category, deleteCategoryFilter)) {
        return mcpError(id, -32003, `Forbidden: agent token cannot delete memories in category '${existing.category}'`);
      }

      const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, existing.projectKey);
      if (!vaultAllowed) {
        return mcpError(id, -32003, `Forbidden: no access to vault scope '${existing.projectKey}'`);
      }

      // Decrypt the current fact to display in the approval UI
      const vaultId = (existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"))) ? existing.projectKey : claims.userId;
      const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
      const currentFact = isEncrypted(existing.fact) ? await decrypt(existing.fact, vaultKey) : existing.fact;

      const agentLabel = claims.agentPolicy?.agentContext ?? "unknown agent";
      const recId = crypto.randomUUID();

      await db.insert(memoryRecommendations).values({
        id: recId,
        orgId: orgId ?? null,
        userId: claims.userId,
        fact: currentFact,
        category: existing.category,
        tags: existing.tags,
        projectKey: existing.projectKey ?? null,
        scopeType: existing.scopeType,
        scopeId: existing.scopeId ?? null,
        recommendationType: "delete",
        targetMemoryId: memId,
        status: "pending",
        agentContext: agentLabel,
        createdAt: Date.now(),
      });

      try {
        await db.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: claims.userId,
          title: "Agent Deletion Approval Required",
          message: `Agent "${agentLabel}" wants to delete a memory. Review and approve in your Locker vault.`,
          type: "warning",
          status: "unread",
          linkUrl: "/memories",
          createdAt: Date.now(),
        });
      } catch (e) {
        console.error("[delete_memory] notification failed:", e);
      }

      await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "delete_memory_queued", memoryId: memId, ipAddress, userAgent, metadata: { recId, agentContext: agentLabel } });

      return mcpResult(id, {
        content: [
          { type: "text", text: JSON.stringify({ queued: true, recommendationId: recId, message: "Deletion request queued for human approval. The memory will not be deleted until the owner approves it in the Locker UI." }) },
        ],
      });
    }
    // ── END AGENT GATE ─────────────────────────────────────────────────────────

    // MFA / Passcode verification (human tokens only)
    const totpRows = await db
      .select()
      .from(totpSecrets)
      .where(and(eq(totpSecrets.userId, claims.userId), eq(totpSecrets.verified, true)))
      .all();

    if (totpRows.length > 0) {
      const totpCode = args.totpCode as string | undefined;
      if (!totpCode || typeof totpCode !== "string") {
        return mcpError(id, -32024, "MFA Verification Required: Please provide a valid 6-digit TOTP code.");
      }
      const totpEnvKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, claims.userId);
      const ephemeralSecret = await decryptEphemeral(totpRows[0].secret, totpEnvKey);
      let verified = false;
      try {
        verified = await verifyTOTP(ephemeralSecret.get(), totpCode);
      } finally {
        ephemeralSecret.drop();
      }
      if (!verified) {
        return mcpError(id, -32024, "MFA Verification Failed: Invalid TOTP code.");
      }
    } else {
      const userRows = await db
        .select({ writePasscodeHash: users.writePasscodeHash })
        .from(users)
        .where(eq(users.id, claims.userId))
        .all();
      if (userRows.length > 0 && userRows[0].writePasscodeHash) {
        const passcode = args.passcode as string | undefined;
        if (!passcode || typeof passcode !== "string") {
          return mcpError(id, -32025, "Passcode Verification Required: Please provide your deletion passcode.");
        }
        const valid = await verifyToken(passcode, userRows[0].writePasscodeHash);
        if (!valid) {
          return mcpError(id, -32025, "Passcode Verification Failed: Invalid deletion passcode.");
        }
      }
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

    // ABAC: agent tokens cannot delete memories in blocked categories
    const deleteCategoryFilter = resolveAgentCategoryFilter(claims);
    if (!checkCategoryAccess(existing.category, deleteCategoryFilter)) {
      return mcpError(id, -32003, `Forbidden: agent token cannot delete memories in category '${existing.category}'`);
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

  if (toolName === "sync_agent_configs") {
    if (!(claims.permissions & MCP_PERM_RECALL)) {
      return mcpError(id, -32001, "Token does not have recall_context permission");
    }
    // ABAC: this tool reads "configs" category memories exclusively.
    // Agent tokens must have "configs" explicitly in their allowedCategories policy.
    const syncCategoryFilter = resolveAgentCategoryFilter(claims);
    if (syncCategoryFilter !== null && !syncCategoryFilter.has("configs")) {
      return mcpError(id, -32003, "Forbidden: agent token cannot access configs memories required for workspace config sync");
    }

    const projectKey = args.projectKey as string | undefined;

    if (projectKey === undefined || typeof projectKey !== "string") {
      return mcpError(id, -32602, "Invalid params: projectKey is required");
    }

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required for syncing agent configs");
    }

    const resolvedProjectKey = resolveProjectKey(claims, projectKey);
    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, resolvedProjectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${resolvedProjectKey ?? "personal"}'`);
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, resolvedProjectKey);
    if (!vaultAllowed) {
      return mcpError(id, -32003, `Forbidden: no access to vault scope '${resolvedProjectKey}'`);
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "recall", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    // Select all active configs-category memories for this workspace.
    const scopeCondition = resolvedProjectKey && (resolvedProjectKey.startsWith("team:") || resolvedProjectKey.startsWith("org:"))
      ? eq(memories.projectKey, resolvedProjectKey)
      : and(eq(memories.userId, claims.userId), sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`);

    const rows = await db
      .select()
      .from(memories)
      .where(and(scopeCondition, eq(memories.isActive, true), eq(memories.category, "configs")))
      .all();

    const decryptedMemories: Array<{ row: typeof rows[0]; ephemeralFact: EphemeralPlaintext } | null> = [];
    try {
      const vaultId = (resolvedProjectKey && (resolvedProjectKey.startsWith("team:") || resolvedProjectKey.startsWith("org:"))) ? resolvedProjectKey : claims.userId;
      const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

      for (const r of rows) {
        try {
          let eph;
          if (isEncrypted(r.fact)) {
            eph = await decryptEphemeral(r.fact, vaultKey);
          } else {
            eph = new EphemeralPlaintext(new TextEncoder().encode(r.fact));
          }
          decryptedMemories.push({ row: r, ephemeralFact: eph });
        } catch {
          decryptedMemories.push(null);
        }
      }

      const valid = decryptedMemories.filter((item): item is NonNullable<typeof item> => item !== null);

      // Expand collapsed single-line markdown into properly formatted multi-line markdown.
      // Handles old-format facts where headers and bullets were stored inline on one line.
      function normalizeFactMarkdown(text: string): string {
        // Already has real newlines — no normalization needed.
        if (text.includes("\n")) return text;
        // Split on markdown headings (##, ###, #) to separate sections.
        // Then within each section, split on " - " bullet separators.
        const sections = text.split(/(#{1,3} )/);
        // sections alternates between: ["pre", "## ", "content", "## ", "content", ...]
        const rebuilt: string[] = [];
        for (let i = 0; i < sections.length; i++) {
          const part = sections[i];
          if (/^#{1,3} $/.test(part)) {
            // This is a heading marker — next element is the section content
            const content = sections[++i] ?? "";
            // Split section content into intro text and bullet items
            const bulletParts = content.split(/ - (?=[A-Za-z])/);
            const intro = bulletParts[0].trimEnd();
            const bullets = bulletParts.slice(1).map((b) => `- ${b.trimEnd()}`);
            rebuilt.push(`\n\n${part}${intro}`);
            if (bullets.length > 0) rebuilt.push(bullets.join("\n"));
          } else if (part.trim()) {
            rebuilt.push(part.trim());
          }
        }
        return rebuilt.join("\n").trim();
      }

      // Build per-config structured blocks, preserving markdown formatting from stored fact content.
      const configBlocks = valid
        .filter((item) => !item.row.isQuarantined)
        .map((item) => {
          const raw = item.ephemeralFact.get();
          // Strip the leading [config:name] tag if present, then normalize and return clean markdown.
          const withoutTag = raw.replace(/^\[config:[^\]]*\]\n?/, "").trim();
          const normalized = normalizeFactMarkdown(withoutTag);
          const name = item.row.name ?? item.row.id;
          return `## ${name}\n\n${normalized}`;
        });

      const configSection = configBlocks.length > 0 ? configBlocks.join("\n\n---\n\n") + "\n\n" : "";

      // Flat rule list for .cursorrules JSON (extract leaf bullet lines only).
      const cursorRules = valid.flatMap((item) => {
        if (item.row.isQuarantined) return [];
        return item.ephemeralFact.get().split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("- "))
          .map((l) => l.slice(2));
      });

      const generatedAt = new Date().toISOString();

      // Authoritative Locker integration boilerplate — injected into every generated config.
      const lockerBoilerplate = `# Locker Memory Vault Integration — Custom Instructions

You have access to Locker (MCP memory vault) for user profile, projects, rules, and secrets. Proactively read/write to it throughout our chat without prompting.

1. READ:
- Start: Call get_memory_summary or list_accessible_scopes on first turn to align context.
- Before coding/answering: Search relevant guidelines using recall_context (use optimize:true for summaries) or search_memories. Don't assume; check Locker first.

2. WRITE:
- Automatically call commit_memory when I state preferences, tech stack choices, rules, or project paths.
- Fact format: Atomic, third-person declarative statements (no "I" or "You").
- Categories: "rules" (guidelines), "projects" (configs/state), "references" (background). Assign lowercase tags.
- Update/Delete: If a rule/state changes, find the ID and call update_memory or delete_memory. Prevent duplicate/stale data.

3. SECRETS:
- Never commit plaintext API keys/secrets to normal memories. Use store_credential and retrieve_credential.

4. PROTOCOLS:
- Background use: Execute calls silently.
- Priority: Locker memories supersede your defaults.

`;

      const buildMarkdown = (header: string) =>
        `${lockerBoilerplate}# ${header}\n\n${configSection}---\n*Generated at: ${generatedAt}*\n`;

      const outputConfigs: Array<{ targetPath: string; markdown: string }> = [
        {
          targetPath: "./CLAUDE.md",
          markdown: buildMarkdown("Claude Agent Config — Workspace Blueprint"),
        },
        {
          targetPath: "./GEMINI.md",
          markdown: buildMarkdown("Gemini Agent Config — Workspace Blueprint"),
        },
        {
          targetPath: "./AGENTS.md",
          markdown: buildMarkdown("Developer Agent Rules — Workspace Blueprint"),
        },
        {
          targetPath: "./.cursorrules",
          markdown: JSON.stringify(
            {
              name: "Workspace Agent Config",
              description: "Agent config synced from Locker configs vault",
              globs: ["*"],
              lockerBoilerplate: lockerBoilerplate.trim(),
              rules: cursorRules,
            },
            null,
            2
          ),
        },
        {
          targetPath: "./.github/copilot-instructions.md",
          markdown: buildMarkdown("GitHub Copilot Instructions — Workspace Blueprint"),
        },
        {
          targetPath: "./.agents/rules/rules.md",
          markdown: buildMarkdown("Antigravity Agent Rules — Workspace Blueprint"),
        },
      ];

      await logAudit(db, {
        orgId,
        userId: claims.userId,
        tokenId: claims.tokenId,
        action: "sync_agent_configs",
        ipAddress,
        userAgent,
        metadata: { projectKey: resolvedProjectKey, formatsCount: outputConfigs.length, configsCount: configBlocks.length },
      });
      await logTokenUsage(db, claims.tokenId, "recall", 0);

      return mcpResult(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              configs: outputConfigs,
              projectKey: resolvedProjectKey,
              configsCount: configBlocks.length,
            }),
          },
        ],
      });
    } finally {
      for (const item of decryptedMemories) {
        if (item) item.ephemeralFact.drop();
      }
    }
  }

  if (toolName === "store_credential") {
    if (!(claims.permissions & MCP_PERM_COMMIT)) {
      return mcpError(id, -32001, "Token does not have commit_memory permission");
    }
    if (claims.isAgent && claims.agentPolicy && !claims.agentPolicy.allowCredentials) {
      return mcpError(id, -32003, "Forbidden: agent token requires allowCredentials=true to store credentials");
    }

    const name = args.name as string | undefined;
    const value = args.value as string | undefined;
    const projectKey = args.projectKey as string | undefined;

    if (!name || typeof name !== "string") {
      return mcpError(id, -32602, "Invalid params: name is required");
    }
    if (!value || typeof value !== "string") {
      return mcpError(id, -32602, "Invalid params: value is required");
    }

    const upperName = name.trim().toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(upperName)) {
      return mcpError(id, -32602, "Invalid params: credential name must contain only uppercase alphanumeric characters and underscores");
    }

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required");
    }

    const resolvedProjectKey = resolveProjectKey(claims, projectKey);
    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, resolvedProjectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${resolvedProjectKey ?? "personal"}'`);
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, resolvedProjectKey);
    if (!vaultAllowed) {
      return mcpError(id, -32003, `Forbidden: no access to vault scope '${resolvedProjectKey}'`);
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "commit", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    const { scopeType, scopeId } = parseScope(resolvedProjectKey);

    const vaultId = (resolvedProjectKey && (resolvedProjectKey.startsWith("team:") || resolvedProjectKey.startsWith("org:"))) ? resolvedProjectKey : claims.userId;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

    const encryptedVal = await encrypt(value, vaultKey);

    const scopeConditions = resolvedProjectKey && (resolvedProjectKey.startsWith("team:") || resolvedProjectKey.startsWith("org:"))
      ? eq(credentials.projectKey, resolvedProjectKey)
      : and(eq(credentials.userId, claims.userId), sql`(${credentials.projectKey} IS NULL OR ${credentials.projectKey} = '')`);

    const existing = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.name, upperName), scopeConditions))
      .limit(1)
      .all();

    if (existing.length > 0) {
      await db
        .update(credentials)
        .set({
          encryptedValue: encryptedVal,
          updatedAt: Date.now(),
        })
        .where(eq(credentials.id, existing[0].id))
        .run();
    } else {
      const credId = crypto.randomUUID();
      await db
        .insert(credentials)
        .values({
          id: credId,
          userId: claims.userId,
          name: upperName,
          encryptedValue: encryptedVal,
          projectKey: resolvedProjectKey || null,
          scopeType,
          scopeId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        })
        .run();
    }

    await logAudit(db, {
      orgId,
      userId: claims.userId,
      tokenId: claims.tokenId,
      action: "store_credential",
      metadata: { name: upperName, projectKey: resolvedProjectKey },
    });
    await logTokenUsage(db, claims.tokenId, "commit", 0);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, name: upperName }) },
      ],
    });
  }

  if (toolName === "list_credentials") {
    if (!(claims.permissions & MCP_PERM_RECALL)) {
      return mcpError(id, -32001, "Token does not have recall_context permission");
    }
    if (claims.isAgent && claims.agentPolicy && !claims.agentPolicy.allowCredentials) {
      return mcpError(id, -32003, "Forbidden: agent token requires allowCredentials=true to list credentials");
    }

    const projectKey = args.projectKey as string | undefined;

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required");
    }

    const resolvedProjectKey = resolveProjectKey(claims, projectKey);
    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, resolvedProjectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${resolvedProjectKey ?? "personal"}'`);
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, resolvedProjectKey);
    if (!vaultAllowed) {
      return mcpError(id, -32003, `Forbidden: no access to vault scope '${resolvedProjectKey}'`);
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "recall", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    const scopeConditions = resolvedProjectKey && (resolvedProjectKey.startsWith("team:") || resolvedProjectKey.startsWith("org:"))
      ? eq(credentials.projectKey, resolvedProjectKey)
      : and(eq(credentials.userId, claims.userId), sql`(${credentials.projectKey} IS NULL OR ${credentials.projectKey} = '')`);

    const rows = await db
      .select({ name: credentials.name })
      .from(credentials)
      .where(scopeConditions)
      .all();

    await logAudit(db, {
      orgId,
      userId: claims.userId,
      tokenId: claims.tokenId,
      action: "list_credentials",
      metadata: { projectKey: resolvedProjectKey, count: rows.length },
    });
    await logTokenUsage(db, claims.tokenId, "recall", 0);

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify(rows.map(r => r.name)) },
      ],
    });
  }

  if (toolName === "retrieve_credential") {
    if (!(claims.permissions & MCP_PERM_RECALL)) {
      return mcpError(id, -32001, "Token does not have recall_context permission");
    }
    if (claims.isAgent && claims.agentPolicy && !claims.agentPolicy.allowCredentials) {
      return mcpError(id, -32003, "Forbidden: agent token requires allowCredentials=true to retrieve credentials");
    }

    const name = args.name as string | undefined;
    const projectKey = args.projectKey as string | undefined;

    if (!name || typeof name !== "string") {
      return mcpError(id, -32602, "Invalid params: name is required");
    }

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required");
    }

    const resolvedProjectKey = resolveProjectKey(claims, projectKey);
    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, resolvedProjectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${resolvedProjectKey ?? "personal"}'`);
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, resolvedProjectKey);
    if (!vaultAllowed) {
      return mcpError(id, -32003, `Forbidden: no access to vault scope '${resolvedProjectKey}'`);
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "recall", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    const upperName = name.trim().toUpperCase();
    const scopeConditions = resolvedProjectKey && (resolvedProjectKey.startsWith("team:") || resolvedProjectKey.startsWith("org:"))
      ? eq(credentials.projectKey, resolvedProjectKey)
      : and(eq(credentials.userId, claims.userId), sql`(${credentials.projectKey} IS NULL OR ${credentials.projectKey} = '')`);

    const rows = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.name, upperName), scopeConditions))
      .limit(1)
      .all();

    if (rows.length === 0) {
      return mcpError(id, -32602, "Credential not found");
    }

    const vaultId = (resolvedProjectKey && (resolvedProjectKey.startsWith("team:") || resolvedProjectKey.startsWith("org:"))) ? resolvedProjectKey : claims.userId;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const ephemeralValue = await decryptEphemeral(rows[0].encryptedValue, vaultKey);
    let payloadText = "";
    try {
      payloadText = JSON.stringify({ name: rows[0].name, value: ephemeralValue.get() });
    } finally {
      ephemeralValue.drop();
    }

    await logAudit(db, {
      orgId,
      userId: claims.userId,
      tokenId: claims.tokenId,
      action: "retrieve_credential",
      metadata: { name: upperName, projectKey: resolvedProjectKey, success: true },
    });
    await logTokenUsage(db, claims.tokenId, "recall", 0);

    return mcpResult(id, {
      content: [
        { type: "text", text: payloadText },
      ],
    });
  }

  if (toolName === "delete_credential") {
    if (!(claims.permissions & MCP_PERM_DELETE)) {
      return mcpError(id, -32001, "Token does not have delete_memory permission");
    }
    if (claims.isAgent && claims.agentPolicy && !claims.agentPolicy.allowCredentials) {
      return mcpError(id, -32003, "Forbidden: agent token requires allowCredentials=true to delete credentials");
    }

    const name = args.name as string | undefined;
    const projectKey = args.projectKey as string | undefined;

    if (!name || typeof name !== "string") {
      return mcpError(id, -32602, "Invalid params: name is required");
    }

    if (!claims.userId) {
      throw new Error("Unauthorized: userId is required");
    }

    const resolvedProjectKey = resolveProjectKey(claims, projectKey);
    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, resolvedProjectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${resolvedProjectKey ?? "personal"}'`);
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, resolvedProjectKey);
    if (!vaultAllowed) {
      return mcpError(id, -32003, `Forbidden: no access to vault scope '${resolvedProjectKey}'`);
    }

    const upperName = name.trim().toUpperCase();
    const scopeConditions = resolvedProjectKey && (resolvedProjectKey.startsWith("team:") || resolvedProjectKey.startsWith("org:"))
      ? eq(credentials.projectKey, resolvedProjectKey)
      : and(eq(credentials.userId, claims.userId), sql`(${credentials.projectKey} IS NULL OR ${credentials.projectKey} = '')`);

    await db
      .delete(credentials)
      .where(and(eq(credentials.name, upperName), scopeConditions))
      .run();

    await logAudit(db, {
      orgId,
      userId: claims.userId,
      tokenId: claims.tokenId,
      action: "delete_credential",
      metadata: { name: upperName, projectKey: resolvedProjectKey },
    });

    return mcpResult(id, {
      content: [
        { type: "text", text: JSON.stringify({ success: true, name: upperName }) },
      ],
    });
  }

  if (toolName === "store_config") {
    if (!(claims.permissions & MCP_PERM_COMMIT)) {
      return mcpError(id, -32001, "Token does not have commit_memory permission");
    }

    // Agent tokens cannot write configs directly — must be queued.
    if (claims.isAgent) {
      return mcpError(id, -32003, "Forbidden: agent tokens cannot store configs directly. Use commit_memory with category 'projects' and tag '#config-request' to request a human review.");
    }

    const name = args.name as string | undefined;
    const content = args.content as string | undefined;
    if (!name || typeof name !== "string") {
      return mcpError(id, -32602, "Invalid params: name is required");
    }
    if (!content || typeof content !== "string") {
      return mcpError(id, -32602, "Invalid params: content is required");
    }
    if (content.length > 50000) {
      return mcpError(id, -32602, "Invalid params: content exceeds max length of 50000 characters");
    }

    const rawTags = typeof args.tags === "string" ? args.tags.trim() : "";
    const projectKey = resolveProjectKey(claims, args.projectKey as string | undefined);

    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, projectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${projectKey ?? "personal"}'`);
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, projectKey);
    if (!vaultAllowed) {
      return mcpError(id, -32003, `Forbidden: no access to vault scope '${projectKey}'`);
    }

    const quotaCheck = await checkQuota(db, claims.userId, claims.tokenId, "commit", orgId);
    if (!quotaCheck.allowed) {
      return mcpError(id, -32004, `Quota Exceeded: ${quotaCheck.reason}`);
    }

    const tagsList = rawTags.split(",").map((t) => t.trim()).filter(Boolean);
    if (!tagsList.includes("config")) tagsList.push("config");
    const finalTags = tagsList.join(", ");

    const sanitized = sanitizeMemory(content.trim());
    if (!sanitized) {
      return mcpError(id, -32602, "Invalid params: content was empty or contained adversarial instructions");
    }

    const isQuarantined = containsSensitiveData(sanitized);
    const memId = crypto.randomUUID();
    const timestamp = Date.now();

    const vaultId = (projectKey && (projectKey.startsWith("team:") || projectKey.startsWith("org:"))) ? projectKey : claims.userId;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const encryptedContent = await encrypt(sanitized, vaultKey);

    const [embedding] = await Promise.all([
      generateEmbedding(env.AI, sanitized),
    ]);

    let scopeType: "personal" | "organization" | "team" = "personal";
    let scopeId: string | null = null;
    if (projectKey) {
      if (projectKey.startsWith("org:")) { scopeType = "organization"; scopeId = projectKey.slice(4); }
      else if (projectKey.startsWith("team:")) { scopeType = "team"; scopeId = projectKey.slice(5); }
    }

    const factContent = `[config:${name}]\n${sanitized}`;
    const encryptedFact = await encrypt(factContent, vaultKey);

    await db.insert(memories).values({
      id: memId,
      userId: claims.userId,
      fact: encryptedFact,
      category: "configs",
      tags: finalTags,
      timestamp,
      isActive: true,
      projectKey: projectKey || null,
      scopeType,
      scopeId,
      isQuarantined,
    });

    await db.insert(memoryVersions).values({
      id: crypto.randomUUID(),
      memoryId: memId,
      fact: encryptedFact,
      category: "configs",
      tags: finalTags,
      changedBy: claims.userId,
      changeReason: "created",
      timestamp,
    });

    await env.VECTOR_INDEX.insert([{
      id: memId,
      values: embedding,
      metadata: {
        userId: claims.userId,
        category: "configs",
        tags: finalTags,
        projectKey: projectKey ?? "",
      },
    }]);

    await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "store_config", memoryId: memId, ipAddress, userAgent, metadata: { name, projectKey, quarantined: isQuarantined } });
    await logTokenUsage(db, claims.tokenId, "commit", estimateEmbeddingTokens(sanitized));

    return mcpResult(id, {
      content: [{ type: "text", text: JSON.stringify({ success: true, id: memId, name, category: "configs", tags: finalTags, projectKey }) }],
    });
  }

  if (toolName === "update_config") {
    if (!(claims.permissions & MCP_PERM_UPDATE)) {
      return mcpError(id, -32001, "Token does not have update_memory permission");
    }

    const memId = args.id as string | undefined;
    const content = args.content as string | undefined;
    if (!memId || typeof memId !== "string") {
      return mcpError(id, -32602, "Invalid params: id is required");
    }
    if (!content || typeof content !== "string") {
      return mcpError(id, -32602, "Invalid params: content is required");
    }
    if (content.length > 50000) {
      return mcpError(id, -32602, "Invalid params: content exceeds max length of 50000 characters");
    }
    if (args.confirm !== true) {
      return mcpError(id, -32602, "Invalid params: confirm must be set to true");
    }

    // Agent tokens must queue their update for human approval.
    if (claims.isAgent) {
      const rows = await db.select().from(memories).where(eq(memories.id, memId)).all();
      if (!rows.length) return mcpError(id, -32602, `Config memory not found: ${memId}`);
      const existing = rows[0];
      if (existing.category !== "configs") return mcpError(id, -32602, "Target memory is not in the configs category");

      if (!isProjectKeyAllowedByToken(claims.accessibleScopes, existing.projectKey)) {
        return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${existing.projectKey ?? "personal"}'`);
      }

      const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, existing.projectKey);
      if (!vaultAllowed) return mcpError(id, -32003, `Forbidden: no access to vault scope '${existing.projectKey}'`);

      const sanitized = sanitizeMemory(content.trim());
      if (!sanitized) return mcpError(id, -32602, "Invalid params: content was empty or contained adversarial instructions");

      const vaultId = (existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"))) ? existing.projectKey : claims.userId;
      const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
      const currentFact = isEncrypted(existing.fact) ? await decrypt(existing.fact, vaultKey) : existing.fact;
      const agentLabel = claims.agentPolicy?.agentContext ?? "unknown agent";
      const recId = crypto.randomUUID();

      await db.insert(memoryRecommendations).values({
        id: recId,
        orgId: orgId ?? null,
        userId: claims.userId,
        fact: currentFact,
        category: "configs",
        tags: existing.tags,
        projectKey: existing.projectKey ?? null,
        scopeType: existing.scopeType,
        scopeId: existing.scopeId ?? null,
        recommendationType: "update",
        targetMemoryId: memId,
        status: "pending",
        proposedFact: sanitized,
        proposedCategory: "configs",
        proposedTags: existing.tags,
        agentContext: agentLabel,
        createdAt: Date.now(),
      });

      try {
        await db.insert(notifications).values({
          id: crypto.randomUUID(),
          userId: claims.userId,
          title: "Agent Config Update Approval Required",
          message: `Agent "${agentLabel}" wants to update a config memory. Review and approve in your Locker vault.`,
          type: "warning",
          status: "unread",
          linkUrl: "/memories",
          createdAt: Date.now(),
        });
      } catch (e) {
        console.error("[update_config] notification failed:", e);
      }

      await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "update_config_queued", memoryId: memId, ipAddress, userAgent, metadata: { recId, agentContext: agentLabel } });
      return mcpResult(id, {
        content: [{ type: "text", text: JSON.stringify({ queued: true, recommendationId: recId, message: "Config update queued for human approval." }) }],
      });
    }

    // Human token: MFA / passcode verification then direct update.
    const totpRows = await db.select().from(totpSecrets).where(and(eq(totpSecrets.userId, claims.userId), eq(totpSecrets.verified, true))).all();
    if (totpRows.length > 0) {
      const totpCode = args.totpCode as string | undefined;
      if (!totpCode) return mcpError(id, -32024, "MFA Verification Required: Please provide a valid 6-digit TOTP code.");
      const totpEnvKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, claims.userId);
      const ephemeralSecret = await decryptEphemeral(totpRows[0].secret, totpEnvKey);
      let verified = false;
      try { verified = await verifyTOTP(ephemeralSecret.get(), totpCode); } finally { ephemeralSecret.drop(); }
      if (!verified) return mcpError(id, -32024, "MFA Verification Failed: Invalid TOTP code.");
    } else {
      const userRows = await db.select({ writePasscodeHash: users.writePasscodeHash }).from(users).where(eq(users.id, claims.userId)).all();
      if (userRows.length > 0 && userRows[0].writePasscodeHash) {
        const passcode = args.passcode as string | undefined;
        if (!passcode) return mcpError(id, -32025, "Passcode Verification Required: Please provide your deletion passcode.");
        const valid = await verifyToken(passcode, userRows[0].writePasscodeHash);
        if (!valid) return mcpError(id, -32025, "Passcode Verification Failed: Invalid deletion passcode.");
      }
    }

    const rows = await db.select().from(memories).where(eq(memories.id, memId)).all();
    if (!rows.length) return mcpError(id, -32602, `Config memory not found: ${memId}`);
    const existing = rows[0];
    if (existing.category !== "configs") return mcpError(id, -32602, "Target memory is not in the configs category");

    if (!isProjectKeyAllowedByToken(claims.accessibleScopes, existing.projectKey)) {
      return mcpError(id, -32003, `Forbidden: API token scope prevents access to vault scope '${existing.projectKey ?? "personal"}'`);
    }
    if (existing.userId !== claims.userId) {
      return mcpError(id, -32003, "Forbidden: You do not have permission to modify this config.");
    }

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, claims.userId, existing.projectKey);
    if (!vaultAllowed) return mcpError(id, -32003, `Forbidden: no access to vault scope '${existing.projectKey}'`);

    const sanitized = sanitizeMemory(content.trim());
    if (!sanitized) return mcpError(id, -32602, "Invalid params: content was empty or contained adversarial instructions");

    const isQuarantined = containsSensitiveData(sanitized);
    const vaultId = (existing.projectKey && (existing.projectKey.startsWith("team:") || existing.projectKey.startsWith("org:"))) ? existing.projectKey : claims.userId;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);
    const encryptedFact = await encrypt(sanitized, vaultKey);
    const embedding = await generateEmbedding(env.AI, sanitized);

    await db.update(memories).set({ fact: encryptedFact, timestamp: Date.now(), isQuarantined }).where(eq(memories.id, memId));

    await db.insert(memoryVersions).values({
      id: crypto.randomUUID(),
      memoryId: memId,
      fact: encryptedFact,
      category: "configs",
      tags: existing.tags,
      changedBy: claims.userId,
      changeReason: "updated",
      timestamp: Date.now(),
    });

    await env.VECTOR_INDEX.upsert([{
      id: memId,
      values: embedding,
      metadata: { userId: claims.userId, category: "configs", tags: existing.tags, projectKey: existing.projectKey ?? "" },
    }]);

    await logAudit(db, { orgId, userId: claims.userId, tokenId: claims.tokenId, action: "update_config", memoryId: memId, ipAddress, userAgent, metadata: { quarantined: isQuarantined } });
    await logTokenUsage(db, claims.tokenId, "commit", estimateEmbeddingTokens(sanitized));

    return mcpResult(id, {
      content: [{ type: "text", text: JSON.stringify({ success: true, id: memId, category: "configs" }) }],
    });
  }

  if (toolName === "approve_jit_access") {
    // Only human (non-agent) tokens may approve/deny JIT requests.
    if (claims.isAgent) {
      return mcpError(id, -32003, "Forbidden: agent tokens cannot approve JIT requests");
    }
    if (!(claims.permissions & MCP_PERM_RECALL)) {
      return mcpError(id, -32001, "Token does not have recall_context permission");
    }

    const jitRequestId = args.jitRequestId as string | undefined;
    const decision = args.decision as "approve" | "deny" | undefined;
    const reviewNotes = args.reviewNotes as string | undefined;

    if (!jitRequestId || typeof jitRequestId !== "string") {
      return mcpError(id, -32602, "Invalid params: jitRequestId is required");
    }
    if (decision !== "approve" && decision !== "deny") {
      return mcpError(id, -32602, "Invalid params: decision must be 'approve' or 'deny'");
    }

    const jitRows = await db
      .select()
      .from(jitAccessRequests)
      .where(eq(jitAccessRequests.id, jitRequestId))
      .all();

    if (!jitRows.length) {
      return mcpError(id, -32602, `JIT request not found: ${jitRequestId}`);
    }
    const jitRow = jitRows[0];

    // Only the user who owns the token being granted may approve.
    if (jitRow.userId !== claims.userId) {
      return mcpError(id, -32003, "Forbidden: you may only approve JIT requests for your own agent tokens");
    }

    if (jitRow.status !== "pending") {
      return mcpError(id, -32602, `JIT request is already ${jitRow.status}`);
    }

    const now = Date.now();

    if (decision === "deny") {
      await db
        .update(jitAccessRequests)
        .set({ status: "denied", reviewedAt: now, reviewedBy: claims.userId, reviewNotes: reviewNotes ?? null })
        .where(eq(jitAccessRequests.id, jitRequestId));

      await logAudit(db, { orgId: null, userId: claims.userId, tokenId: claims.tokenId, action: "jit_access_denied", ipAddress, userAgent, metadata: { jitRequestId, agentTokenId: jitRow.tokenId } });

      return mcpResult(id, { content: [{ type: "text", text: JSON.stringify({ success: true, decision: "deny", jitRequestId }) }] });
    }

    // Issue a 15-minute JIT token: generate a random secret, hash it, store the hash.
    const jitSecret = `lkr_jit_${crypto.randomUUID().replace(/-/g, "")}`;
    const jitTokenHash = await hashToken(jitSecret);
    const jitExpiresAt = now + 15 * 60 * 1000; // 15 minutes

    await db
      .update(jitAccessRequests)
      .set({
        status: "approved",
        jitTokenHash,
        jitExpiresAt,
        reviewedAt: now,
        reviewedBy: claims.userId,
        reviewNotes: reviewNotes ?? null,
      })
      .where(eq(jitAccessRequests.id, jitRequestId));

    await logAudit(db, { orgId: null, userId: claims.userId, tokenId: claims.tokenId, action: "jit_access_approved", ipAddress, userAgent, metadata: { jitRequestId, agentTokenId: jitRow.tokenId, expiresAt: jitExpiresAt } });

    return mcpResult(id, {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          decision: "approve",
          jitRequestId,
          jitToken: jitSecret,
          expiresAt: jitExpiresAt,
          expiresIn: "15 minutes",
          instructions: "Pass this token as the Bearer Authorization header when re-running the original query. It grants access only to the specific #confidential memories listed in this request and expires automatically.",
        }),
      }],
    });
  }

  return mcpError(id, -32602, `Unknown tool: ${toolName}`);
}
