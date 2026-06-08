import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { desc, eq, sql, and, gte, lte, like, or } from "drizzle-orm";
import {
  memories,
  apiTokens,
  memoryVersions,
  auditLogs,
  organizations,
  organizationMembers,
  userPlans,
  orgQuotas,
  users,
  type Memory,
} from "~/db/schema";
import type { CloudflareEnv } from "~/types/cloudflare";
import { isEncrypted, getOrCreateVaultKey, decryptEphemeral, type EphemeralPlaintext } from "~/server/crypto";
import { expandByEntityIds } from "~/server/graphRag";
import { requireSession } from "~/server/session";
import { verifyVaultAccess, checkQuota, logTokenUsage, logAudit, estimateEmbeddingTokens, parseScope } from "~/server/enterprise";

type CFContext = { cloudflare: { env: CloudflareEnv; ctx: ExecutionContext } };

function getDb(env: CloudflareEnv) {
  return drizzle(env.DB, { schema: { memories, apiTokens, userPlans, organizationMembers, orgQuotas, users } });
}

async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const result = await ai.run("@cf/baai/bge-m3", { text: [text] });
  const r = result as { data?: number[][]; shape?: number[] };
  return r.data?.[0] ?? [];
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

async function decryptMemories(rows: Memory[], db: D1Database, masterKey: string): Promise<Memory[]> {
  const ephemerals: EphemeralPlaintext[] = [];
  try {
    return await Promise.all(
      rows.map(async (r) => {
        const vaultId = (r.projectKey && (r.projectKey.startsWith("team:") || r.projectKey.startsWith("org:"))) ? r.projectKey : r.userId;
        const vaultKey = await getOrCreateVaultKey(db, masterKey, vaultId);
        if (isEncrypted(r.fact)) {
          const eph = await decryptEphemeral(r.fact, vaultKey);
          ephemerals.push(eph);
          return { ...r, fact: eph.get() };
        }
        return { ...r };
      })
    );
  } finally {
    for (const eph of ephemerals) eph.drop();
  }
}

// ── RRF helpers ───────────────────────────────────────────────────────────────

const RRF_K = 60;
const RECENCY_LAMBDA = 0.005;
const CROSS_ENCODER_TOP = 20;
const CROSS_ENCODER_OUTPUT = 10;

function rrfScore(ranks: number[]): number {
  return ranks.reduce((sum, r) => sum + 1 / (RRF_K + r + 1), 0);
}

function recencyScore(timestamp: number): number {
  const ageDays = (Date.now() - timestamp) / 86_400_000;
  return Math.exp(-RECENCY_LAMBDA * ageDays);
}

function tokenise(text: string): Set<string> {
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
  return new Set(tokens);
}

function keywordScore(row: Memory, queryTokens: Set<string>): number {
  if (queryTokens.size === 0) return 0;
  const haystack = `${row.tags} ${row.category}`.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  let hits = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) hits++;
  }
  return hits / queryTokens.size;
}

const zProjectKeyFn = z
  .string()
  .max(128)
  .refine(
    (v) => v === "" || v === "personal" || /^org:[0-9a-f-]{36}$/.test(v) || /^team:[0-9a-f-]{36}$/.test(v),
    { message: "projectKey must be empty, 'personal', 'org:<uuid>', or 'team:<uuid>'" }
  )
  .optional();

// ── Recall Context ─────────────────────────────────────────────────────────────

const RecallContextSchema = z.object({
  query: z.string().min(1, "query is required").max(10000).transform((s) => s.trim()),
  topK: z.number().int().min(1).max(50).default(5),
  projectKey: zProjectKeyFn,
  isActive: z.boolean().default(true),
}).strict();

export const recallContext = createServerFn({ method: "POST" })
  .inputValidator((data) => RecallContextSchema.parse(data))
  .handler(async ({ data, context }): Promise<Memory[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    if (!user.id) throw new Error("Unauthorized: userId is required for vector query");

    const { allowed: vaultAllowed, orgId } = await verifyVaultAccess(db, user.id, data.projectKey);
    if (!vaultAllowed) throw new Error(`Forbidden: no access to vault scope '${data.projectKey}'`);

    const quotaCheck = await checkQuota(db, user.id, "session", "recall", orgId);
    if (!quotaCheck.allowed) throw new Error(`Quota Exceeded: ${quotaCheck.reason}`);

    const queryTrimmed = data.query;
    const embedding = await generateEmbedding(env.AI, queryTrimmed);
    const tokensConsumed = estimateEmbeddingTokens(queryTrimmed);
    const finalTopK = Math.min(data.topK ?? 5, 50);

    const VECTOR_CANDIDATE_K = Math.min(Math.max(finalTopK * 4, 40), 100);

    const filter: Record<string, any> = {};
    if (data.projectKey && (data.projectKey.startsWith("team:") || data.projectKey.startsWith("org:"))) {
      filter.projectKey = data.projectKey;
    } else {
      filter.userId = user.id;
      if (data.projectKey) filter.projectKey = { $in: [data.projectKey, ""] };
    }

    const vectorResults = await env.VECTOR_INDEX.query(embedding, { topK: VECTOR_CANDIDATE_K, filter, returnMetadata: "indexed" });

    if (!vectorResults.matches || vectorResults.matches.length === 0) {
      await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "recall_context", metadata: { query: data.query, projectKey: data.projectKey, matchCount: 0 } });
      await logTokenUsage(db, "session", "recall", tokensConsumed);
      return [];
    }

    const vectorRankMap = new Map<string, number>(vectorResults.matches.map((m: VectorizeMatch, i: number) => [m.id, i]));
    const vectorIds = vectorResults.matches.map((m: VectorizeMatch) => m.id);

    const entityIds = vectorResults.matches.flatMap((m: VectorizeMatch) => {
      const raw = (m.metadata as Record<string, unknown> | undefined)?.entityIds;
      if (typeof raw !== "string" || !raw) return [];
      return raw.split(" ").filter(Boolean);
    });
    const expandedIds = await expandByEntityIds(env.DB, entityIds, vectorIds);

    const conditions = [sql`${memories.id} IN (${sql.join(expandedIds.map((id: string) => sql`${id}`), sql`, `)})`];
    if (data.isActive !== undefined) conditions.push(eq(memories.isActive, data.isActive));

    if (data.projectKey && (data.projectKey.startsWith("team:") || data.projectKey.startsWith("org:"))) {
      conditions.push(eq(memories.projectKey, data.projectKey));
    } else {
      conditions.push(eq(memories.userId, user.id));
      if (data.projectKey) {
        conditions.push(sql`(${memories.projectKey} = ${data.projectKey} OR ${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`);
      } else {
        conditions.push(sql`(${memories.projectKey} IS NULL OR ${memories.projectKey} = '')`);
      }
    }

    const rows = await db.select().from(memories).where(and(...conditions)).all();

    if (rows.length === 0) {
      await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "recall_context", metadata: { query: data.query, projectKey: data.projectKey, matchCount: 0 } });
      await logTokenUsage(db, "session", "recall", tokensConsumed);
      return [];
    }

    const queryTokens = tokenise(queryTrimmed);
    const keywordScored = rows.map((r) => ({ id: r.id, score: keywordScore(r, queryTokens) })).sort((a, b) => b.score - a.score);
    const keywordRankMap = new Map<string, number>(keywordScored.map((e, i) => [e.id, i]));

    const recencyScored = rows.map((r) => ({ id: r.id, score: recencyScore(r.timestamp) })).sort((a, b) => b.score - a.score);
    const recencyRankMap = new Map<string, number>(recencyScored.map((e, i) => [e.id, i]));

    const fused = rows
      .map((r) => ({
        row: r,
        rfScore: rrfScore([vectorRankMap.get(r.id) ?? rows.length, keywordRankMap.get(r.id) ?? rows.length, recencyRankMap.get(r.id) ?? rows.length]),
      }))
      .sort((a, b) => {
        if (a.row.authorityType === "authoritative" && b.row.authorityType !== "authoritative") return -1;
        if (a.row.authorityType !== "authoritative" && b.row.authorityType === "authoritative") return 1;
        return b.rfScore - a.rfScore;
      });

    const vaultId = (data.projectKey && (data.projectKey.startsWith("team:") || data.projectKey.startsWith("org:"))) ? data.projectKey : user.id;
    const vaultKey = await getOrCreateVaultKey(env.DB, env.ENCRYPTION_KEY, vaultId);

    const crossEncoderPool = fused.slice(0, CROSS_ENCODER_TOP);
    const ephemerals: Array<{ id: string; eph: EphemeralPlaintext }> = [];
    let decryptedPool: Array<{ row: Memory; fact: string }>;

    try {
      decryptedPool = await Promise.all(
        crossEncoderPool.map(async ({ row }) => {
          if (isEncrypted(row.fact)) {
            const eph = await decryptEphemeral(row.fact, vaultKey);
            ephemerals.push({ id: row.id, eph });
            return { row, fact: eph.get() };
          }
          return { row, fact: row.fact };
        })
      );

      let finalOrder: string[] | null = null;

      if (decryptedPool.length > 1) {
        const candidateLines = decryptedPool.map((c, i) => `[${i}] ${c.fact.slice(0, 300)}`).join("\n");
        const cePrompt = `You are a precision memory retrieval ranker. Given the user's query and a numbered list of candidate memory facts, output ONLY a JSON array of the candidate indices (integers), ordered from most relevant to least relevant. Include only indices whose facts are genuinely useful for answering the query. Omit irrelevant facts entirely. No explanation, no markdown.

Query: "${queryTrimmed}"

Candidates:
${candidateLines}

Respond with ONLY a JSON array of integers, e.g.: [2,0,4]`;

        try {
          const ceResult = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { prompt: cePrompt, max_tokens: Math.max(64, decryptedPool.length * 6) });
          const ceText = extractText(ceResult).trim();
          const match = ceText.match(/\[[\s\S]*?\]/);
          if (match) {
            const parsed: unknown[] = JSON.parse(match[0]);
            const indices = parsed
              .filter((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v < decryptedPool.length)
              .slice(0, CROSS_ENCODER_OUTPUT);
            if (indices.length > 0) finalOrder = indices.map((i) => decryptedPool[i].row.id);
          }
        } catch (ceErr) {
          console.error("[recallContext] cross-encoder failed, falling back to RRF order:", ceErr);
        }
      }

      const redactQuarantined = (r: Memory): Memory =>
        r.isQuarantined ? { ...r, fact: "[REDACTED - Pending Human Review]" } : r;

      let result: Memory[];
      if (finalOrder && finalOrder.length > 0) {
        const poolMap = new Map(decryptedPool.map((c) => [c.row.id, c]));
        const ceOrdered = finalOrder.map((id) => poolMap.get(id)).filter((c): c is { row: Memory; fact: string } => c !== undefined);
        const authoritative = ceOrdered.filter((c) => c.row.authorityType === "authoritative");
        const contributed = ceOrdered.filter((c) => c.row.authorityType !== "authoritative");
        result = [...authoritative, ...contributed].slice(0, finalTopK).map((c) => redactQuarantined({ ...c.row, fact: c.fact }));
      } else {
        const poolMap = new Map(decryptedPool.map((c) => [c.row.id, c]));
        result = crossEncoderPool
          .slice(0, finalTopK)
          .map(({ row }) => { const c = poolMap.get(row.id); return c ? redactQuarantined({ ...row, fact: c.fact }) : null; })
          .filter((r): r is Memory => r !== null);
      }

      const returnedIds = result.map((r) => r.id);
      if (returnedIds.length > 0) {
        db.update(memories).set({ lastAccessedAt: Date.now() })
          .where(sql`${memories.id} IN (${sql.join(returnedIds.map((id) => sql`${id}`), sql`, `)})`)
          .run()
          .catch((err) => console.error("[recallContext] lastAccessedAt update failed:", err));
      }

      await logAudit(db, { orgId, userId: user.id, tokenId: "session", action: "recall_context", metadata: { query: data.query, projectKey: data.projectKey, matchCount: result.length } });
      await logTokenUsage(db, "session", "recall", tokensConsumed);

      return result;
    } finally {
      for (const { eph } of ephemerals) eph.drop();
    }
  });

// ── Semantic Search ────────────────────────────────────────────────────────────

const SemanticSearchSchema = z.object({
  query: z.string().min(1).max(500),
  projectKey: zProjectKeyFn,
  category: z.enum(["rules", "projects", "references", "configs"]).optional(),
  topK: z.number().int().min(1).max(50).default(20),
}).strict();

export const semanticSearchMemories = createServerFn({ method: "POST" })
  .inputValidator((data) => SemanticSearchSchema.parse(data))
  .handler(async ({ data, context }): Promise<Memory[]> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const { scopeType, scopeId } = parseScope(data.projectKey);
    const { allowed: vaultAllowed } = await verifyVaultAccess(db, user.id, scopeType, scopeId);
    if (!vaultAllowed) throw new Error(`Forbidden: no access to vault scope '${data.projectKey ?? "personal"}'`);

    const embedding = await generateEmbedding(env.AI, data.query);
    const filter = getVectorFilter(user.id, data.projectKey);
    if (data.category) filter.category = data.category;

    const vectorResult = await env.VECTOR_INDEX.query(embedding, { topK: data.topK, filter, returnMetadata: "none" });

    const matches = vectorResult.matches ?? [];
    if (matches.length === 0) return [];

    const matchIds = matches.map((m) => m.id);
    const scoreMap = new Map(matches.map((m) => [m.id, m.score]));

    const DB_CHUNK = 50;
    const rows: Memory[] = [];
    for (let i = 0; i < matchIds.length; i += DB_CHUNK) {
      const chunk = matchIds.slice(i, i + DB_CHUNK);
      const chunkRows = await db
        .select()
        .from(memories)
        .where(and(sql`${memories.id} IN (${sql.join(chunk.map((id) => sql`${id}`), sql`, `)})`, eq(memories.isActive, true)))
        .all();
      rows.push(...chunkRows);
    }

    const decrypted = await decryptMemories(rows, env.DB, env.ENCRYPTION_KEY);
    decrypted.sort((a, b) => (scoreMap.get(b.id) ?? 0) - (scoreMap.get(a.id) ?? 0));
    return decrypted;
  });

// ── Agent Activity Dashboard ──────────────────────────────────────────────────

export type AgentActivityEntry = {
  id: string;
  timestamp: number;
  action: string;
  actionLabel: string;
  toolName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  memoryId: string | null;
  memoryFact: string | null;
  memoryCategory: string | null;
  tokenId: string | null;
  tokenName: string | null;
  query: string | null;
  topK: number | null;
  matchCount: number | null;
  semanticScore: number | null;
  rrfScore: number | null;
  injectedFacts: Array<{ id: string; fact: string; category: string; tags: string; score: number | null }>;
  filterCategory: string | null;
  filterTag: string | null;
  filterProjectKey: string | null;
  optimize: boolean | null;
  projectKey: string | null;
  isAbacDenied: boolean;
  rawMetadata: Record<string, string | number | boolean | null> | null;
};

export type AgentActivityStats = {
  totalRecalls: number;
  totalCommits: number;
  totalUpdates: number;
  totalDeletes: number;
  abacDenials: number;
  avgSemanticScore: number | null;
  topTools: Array<{ tool: string; count: number }>;
  topActions: Array<{ action: string; count: number }>;
  topInjectedFacts: Array<{ fact: string; frequency: number }>;
};

export type AgentActivityResult = {
  entries: AgentActivityEntry[];
  total: number;
  page: number;
  pageSize: number;
  stats: AgentActivityStats;
};

const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  recall_context: "Recalled Context",
  recall_context_abac_denied: "Recall Denied (ABAC)",
  commit_memory: "Committed Memory",
  update_memory: "Updated Memory",
  delete_memory: "Deleted Memory",
  search_memories: "Searched Memories",
  get_memory_summary: "Fetched Summary",
  export_memories: "Exported Memories",
  list_accessible_scopes: "Listed Scopes",
  jit_access_requested: "JIT Access Requested",
  jit_access_approved: "JIT Approved",
  jit_access_denied: "JIT Denied",
  update_memory_queued: "Update Queued",
  delete_memory_queued: "Delete Queued",
  store_credential: "Stored Credential",
  retrieve_credential: "Retrieved Credential",
  delete_credential: "Deleted Credential",
  sync_agent_configs: "Synced Agent Configs",
};

function deriveToolName(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (ua.includes("cursor")) return "Cursor";
  if (ua.includes("claude-desktop") || ua.includes("claude desktop")) return "Claude Desktop";
  if (ua.includes("claude_code") || ua.includes("claude-code") || ua.includes("claude code")) return "Claude Code";
  if (ua.includes("windsurf")) return "Windsurf";
  if (ua.includes("cline")) return "Cline";
  if (ua.includes("copilot")) return "GitHub Copilot";
  if (ua.includes("continue")) return "Continue";
  if (ua.includes("zed")) return "Zed";
  if (ua.includes("jetbrains") || ua.includes("intellij") || ua.includes("pycharm") || ua.includes("webstorm")) return "JetBrains";
  if (ua.includes("vscode") || ua.includes("visual studio code")) return "VS Code";
  return userAgent.split("/")[0] || null;
}

const AgentActivitySchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
  action: z.string().max(64).optional(),
  toolName: z.string().max(128).optional(),
  search: z.string().max(512).optional(),
  startDate: z.number().optional(),
  endDate: z.number().optional(),
}).strict();

export const getAgentActivityLogs = createServerFn({ method: "POST" })
  .inputValidator((data) => AgentActivitySchema.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<AgentActivityResult> => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = getDb(env);

    const pageSize = Math.min(data.pageSize ?? data.limit ?? 50, 200);
    const page = data.page ?? 1;
    const offset = data.offset ?? (page - 1) * pageSize;

    const conditions: ReturnType<typeof eq>[] = [eq(auditLogs.userId, user.id) as any];
    if (data.action) conditions.push(eq(auditLogs.action, data.action) as any);
    if (data.startDate) conditions.push(gte(auditLogs.timestamp, data.startDate) as any);
    if (data.endDate) conditions.push(lte(auditLogs.timestamp, data.endDate) as any);
    if (data.search) {
      conditions.push(or(like(auditLogs.action, `%${data.search}%`), like(auditLogs.metadata, `%${data.search}%`), like(auditLogs.userAgent, `%${data.search}%`)) as any);
    }

    const whereClause = and(...conditions);
    const [rows, countRows] = await Promise.all([
      db.select().from(auditLogs).where(whereClause).orderBy(desc(auditLogs.timestamp)).limit(pageSize).offset(offset).all(),
      db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(whereClause).all(),
    ]);

    const total = countRows[0]?.count ?? 0;
    const tokenIds = [...new Set(rows.map((r) => r.tokenId).filter((t): t is string => !!t && t !== "session"))];
    const memoryIds = [...new Set(rows.map((r) => r.memoryId).filter((m): m is string => !!m))];

    const [tokenRows, memoryRows] = await Promise.all([
      tokenIds.length > 0
        ? db.select({ id: apiTokens.id, name: apiTokens.name }).from(apiTokens).where(sql`${apiTokens.id} IN (${sql.join(tokenIds.map((id) => sql`${id}`), sql`, `)})`).all()
        : Promise.resolve([] as { id: string; name: string }[]),
      memoryIds.length > 0
        ? db.select({ id: memories.id, fact: memories.fact, category: memories.category }).from(memories).where(sql`${memories.id} IN (${sql.join(memoryIds.map((id) => sql`${id}`), sql`, `)})`).all()
        : Promise.resolve([] as { id: string; fact: string; category: string }[]),
    ]);

    const tokenMap = new Map(tokenRows.map((t) => [t.id, t.name]));
    const memoryMap = new Map(memoryRows.map((m) => [m.id, { fact: m.fact, category: m.category }]));

    const entries: AgentActivityEntry[] = rows.map((row) => {
      let meta: Record<string, unknown> | null = null;
      try { if (row.metadata) meta = JSON.parse(row.metadata); } catch { /* noop */ }

      const toolName = deriveToolName(row.userAgent);
      if (data.toolName && toolName !== data.toolName) return null as unknown as AgentActivityEntry;

      const injectedFacts: AgentActivityEntry["injectedFacts"] = [];
      if (meta && Array.isArray((meta as any).injectedFacts)) {
        for (const f of (meta as any).injectedFacts) {
          injectedFacts.push({ id: String(f.id ?? ""), fact: String(f.fact ?? ""), category: String(f.category ?? ""), tags: String(f.tags ?? ""), score: typeof f.score === "number" ? f.score : null });
        }
      }
      if (injectedFacts.length === 0 && meta && Array.isArray((meta as any).results)) {
        for (const r of (meta as any).results as any[]) {
          if (r?.fact) injectedFacts.push({ id: String(r.id ?? ""), fact: String(r.fact), category: String(r.category ?? ""), tags: String(r.tags ?? ""), score: typeof r.score === "number" ? r.score : null });
        }
      }

      const memInfo = row.memoryId ? memoryMap.get(row.memoryId) : undefined;
      const tokenName = row.tokenId && row.tokenId !== "session"
        ? (tokenMap.get(row.tokenId) ?? row.tokenId.slice(0, 8) + "…")
        : (row.tokenId === "session" ? "Session" : null);

      return {
        id: row.id, timestamp: row.timestamp, action: row.action,
        actionLabel: ACTIVITY_ACTION_LABELS[row.action] ?? row.action,
        toolName, userAgent: row.userAgent ?? null, ipAddress: row.ipAddress ?? null,
        memoryId: row.memoryId ?? null, memoryFact: memInfo?.fact ?? null, memoryCategory: memInfo?.category ?? null,
        tokenId: row.tokenId ?? null, tokenName,
        query: (meta as any)?.query ?? null,
        topK: typeof (meta as any)?.topK === "number" ? (meta as any).topK : null,
        matchCount: typeof (meta as any)?.matchCount === "number" ? (meta as any).matchCount : null,
        semanticScore: typeof (meta as any)?.semanticScore === "number" ? (meta as any).semanticScore : (typeof (meta as any)?.vectorScore === "number" ? (meta as any).vectorScore : (typeof (meta as any)?.score === "number" ? (meta as any).score : null)),
        rrfScore: typeof (meta as any)?.rrfScore === "number" ? (meta as any).rrfScore : null,
        injectedFacts,
        filterCategory: (meta as any)?.category ?? null,
        filterTag: (meta as any)?.tag ?? null,
        filterProjectKey: (meta as any)?.projectKey ?? null,
        optimize: typeof (meta as any)?.optimize === "boolean" ? (meta as any).optimize : null,
        projectKey: (meta as any)?.projectKey ?? null,
        isAbacDenied: row.action === "recall_context_abac_denied",
        rawMetadata: meta as Record<string, string | number | boolean | null> | null,
      };
    }).filter((e): e is AgentActivityEntry => e !== null);

    const statsRows = await db
      .select({ action: auditLogs.action, userAgent: auditLogs.userAgent, metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(
        eq(auditLogs.userId, user.id) as any,
        data.startDate ? gte(auditLogs.timestamp, data.startDate) as any : undefined,
        data.endDate ? lte(auditLogs.timestamp, data.endDate) as any : undefined,
      ))
      .orderBy(desc(auditLogs.timestamp))
      .limit(5000)
      .all();

    let totalRecalls = 0, totalCommits = 0, totalUpdates = 0, totalDeletes = 0, abacDenials = 0;
    let scoreSum = 0, scoreCount = 0;
    const toolCounts = new Map<string, number>();
    const actionCounts = new Map<string, number>();
    const factFreq = new Map<string, number>();

    for (const sr of statsRows) {
      actionCounts.set(sr.action, (actionCounts.get(sr.action) ?? 0) + 1);
      const tool = deriveToolName(sr.userAgent) ?? "Unknown";
      toolCounts.set(tool, (toolCounts.get(tool) ?? 0) + 1);
      if (sr.action === "recall_context") totalRecalls++;
      else if (sr.action === "commit_memory") totalCommits++;
      else if (sr.action === "update_memory") totalUpdates++;
      else if (sr.action === "delete_memory") totalDeletes++;
      else if (sr.action === "recall_context_abac_denied") abacDenials++;
      let m: any = null;
      try { if (sr.metadata) m = JSON.parse(sr.metadata); } catch { /* noop */ }
      const score = m?.semanticScore ?? m?.vectorScore ?? m?.score;
      if (typeof score === "number") { scoreSum += score; scoreCount++; }
      const results = m?.injectedFacts ?? m?.results;
      if (Array.isArray(results)) {
        for (const r of results as any[]) {
          if (r?.fact) {
            const t = String(r.fact).length > 80 ? String(r.fact).slice(0, 80) + "…" : String(r.fact);
            factFreq.set(t, (factFreq.get(t) ?? 0) + 1);
          }
        }
      }
    }

    return {
      entries, total, page, pageSize,
      stats: {
        totalRecalls, totalCommits, totalUpdates, totalDeletes, abacDenials,
        avgSemanticScore: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 1000) / 1000 : null,
        topTools: [...toolCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([tool, count]) => ({ tool, count })),
        topActions: [...actionCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([action, count]) => ({ action, count })),
        topInjectedFacts: [...factFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([fact, frequency]) => ({ fact, frequency })),
      },
    };
  });

// ── Audit Log Helpers ─────────────────────────────────────────────────────────

async function enrichAuditLogs(
  db: ReturnType<typeof drizzle>,
  logs: Array<{ userId: string; tokenId: string | null; memoryId: string | null; metadata: string | null; [key: string]: unknown }>
) {
  const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))] as string[];
  const tokenIds = [...new Set(logs.map((l) => l.tokenId).filter((t): t is string => !!t && t !== "session"))];
  const memoryIds = [...new Set(logs.map((l) => l.memoryId).filter((m): m is string => !!m))];

  const [userRows, tokenRows, versionRows] = await Promise.all([
    userIds.length > 0
      ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(sql`${users.id} IN (${sql.join(userIds.map((uid) => sql`${uid}`), sql`, `)})`).all()
      : Promise.resolve([] as { id: string; name: string; email: string }[]),
    tokenIds.length > 0
      ? db.select({ id: apiTokens.id, name: apiTokens.name }).from(apiTokens).where(sql`${apiTokens.id} IN (${sql.join(tokenIds.map((tid) => sql`${tid}`), sql`, `)})`).all()
      : Promise.resolve([] as { id: string; name: string }[]),
    memoryIds.length > 0
      ? db.select({ memoryId: memoryVersions.memoryId, fact: memoryVersions.fact }).from(memoryVersions).where(sql`${memoryVersions.memoryId} IN (${sql.join(memoryIds.map((mid) => sql`${mid}`), sql`, `)})`).orderBy(desc(memoryVersions.timestamp)).all()
      : Promise.resolve([] as { memoryId: string; fact: string }[]),
  ]);

  const userMap = new Map(userRows.map((u) => [u.id, u]));
  const tokenMap = new Map(tokenRows.map((t) => [t.id, t.name]));
  const memorySnippetMap = new Map<string, string>();
  for (const v of versionRows) {
    if (!memorySnippetMap.has(v.memoryId)) {
      memorySnippetMap.set(v.memoryId, v.fact.slice(0, 120) + (v.fact.length > 120 ? "…" : ""));
    }
  }

  const ENRICH_ACTION_LABELS: Record<string, string> = {
    recall_context: "Recalled Context", recall_context_abac_denied: "Recall Denied (ABAC)",
    commit_memory: "Committed Memory", update_memory: "Updated Memory",
    delete_memory: "Deleted Memory", search_memories: "Searched Memories",
    get_memory_summary: "Fetched Summary", export_memories: "Exported Memories",
    list_accessible_scopes: "Listed Scopes", jit_access_requested: "JIT Access Requested",
    jit_access_approved: "JIT Approved", jit_access_denied: "JIT Denied",
    store_credential: "Stored Credential", retrieve_credential: "Retrieved Credential",
    delete_credential: "Deleted Credential", sync_agent_configs: "Synced Agent Configs",
    create_template: "Created Template", update_template: "Updated Template",
    delete_template: "Deleted Template", import_memories: "Imported Memories",
    revert_version: "Reverted Version", approve_recommendation: "Approved Recommendation",
    reject_recommendation: "Rejected Recommendation",
  };

  return logs.map((log) => {
    const userInfo = userMap.get(log.userId);
    const tokenName = log.tokenId && log.tokenId !== "session"
      ? (tokenMap.get(log.tokenId) ?? log.tokenId.slice(0, 8) + "…")
      : (log.tokenId === "session" ? "Session" : null);
    const memorySnippet = log.memoryId ? (memorySnippetMap.get(log.memoryId) ?? null) : null;

    let query: string | null = null;
    let toolName: string | null = null;
    try {
      if (log.metadata) {
        const meta = JSON.parse(log.metadata as string) as Record<string, unknown>;
        if (typeof meta.query === "string") query = meta.query;
      }
    } catch { /* leave null */ }
    const ua = (log.userAgent as string | null | undefined) ?? "";
    if (ua) toolName = deriveToolName(ua);

    const action = log.action as string;
    return {
      ...log,
      actionLabel: ENRICH_ACTION_LABELS[action] ?? action,
      userName: userInfo?.name ?? null,
      userEmail: userInfo?.email ?? null,
      tokenName, memorySnippet, memoryFact: memorySnippet, query, toolName,
      semanticScore: null, rrfScore: null, matchCount: null, topK: null,
      filterCategory: null, filterTag: null, filterProjectKey: null, optimize: null,
      isAbacDenied: action === "recall_context_abac_denied",
      injectedFacts: [],
    };
  });
}

// ── Org Audit Logs ─────────────────────────────────────────────────────────────

const AuditLogFilterSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  memoryId: z.string().uuid().optional(),
  action: z.string().max(64).optional(),
  userId: z.string().uuid().optional(),
  dateFrom: z.number().int().min(0).optional(),
  dateTo: z.number().int().min(0).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().max(512).optional(),
}).strict();

export const getOrgAuditLogs = createServerFn({ method: "POST" })
  .inputValidator((data) => AuditLogFilterSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB);

    const orgMember = await db.select({ orgId: organizationMembers.orgId, role: organizationMembers.role }).from(organizationMembers).where(eq(organizationMembers.userId, user.id)).all();
    if (!orgMember.length) throw new Response(JSON.stringify({ error: "No organization access" }), { status: 403 });

    const adminOrgIds = orgMember.filter((m) => m.role === "admin" || m.role === "owner").map((m) => m.orgId);
    if (!adminOrgIds.length) throw new Response(JSON.stringify({ error: "Admin or owner access required" }), { status: 403 });

    const orgId = adminOrgIds[0];
    const limit = Math.min(data.limit ?? 50, 200);
    const offset = data.offset ?? 0;
    const dateFrom = data.dateFrom ?? (data.startDate ? new Date(data.startDate + "T00:00:00Z").getTime() : undefined);
    const dateTo = data.dateTo ?? (data.endDate ? new Date(data.endDate + "T23:59:59Z").getTime() : undefined);

    const conditions: ReturnType<typeof eq>[] = [eq(auditLogs.orgId, orgId)];
    if (data.memoryId) conditions.push(eq(auditLogs.memoryId, data.memoryId));
    if (data.action) conditions.push(eq(auditLogs.action, data.action));
    if (data.userId) conditions.push(eq(auditLogs.userId, data.userId));
    if (dateFrom) conditions.push(sql`${auditLogs.timestamp} >= ${dateFrom}` as any);
    if (dateTo) conditions.push(sql`${auditLogs.timestamp} <= ${dateTo}` as any);
    if (data.search) conditions.push(or(like(auditLogs.action, `%${data.search}%`), like(auditLogs.metadata, `%${data.search}%`), like(auditLogs.userAgent, `%${data.search}%`)) as any);

    const rawLogs = await db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.timestamp)).limit(limit).offset(offset).all();
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(and(...conditions)).all();
    const enriched = await enrichAuditLogs(db, rawLogs as any);

    return { logs: enriched, total: countResult[0]?.count ?? 0, limit, offset };
  });

const ExportAuditCsvSchema = z.object({
  action: z.string().max(64).optional(),
  userId: z.string().uuid().optional(),
}).strict();

export const exportAuditLogsCsv = createServerFn({ method: "POST" })
  .inputValidator((data) => ExportAuditCsvSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const user = await requireSession(env);
    const db = drizzle(env.DB);

    const orgMember = await db.select({ orgId: organizationMembers.orgId, role: organizationMembers.role }).from(organizationMembers).where(eq(organizationMembers.userId, user.id)).all();
    if (!orgMember.length) throw new Response(JSON.stringify({ error: "No organization access" }), { status: 403 });
    const adminOrgEntry = orgMember.find((m) => m.role === "admin" || m.role === "owner");
    if (!adminOrgEntry) throw new Response(JSON.stringify({ error: "Admin access required" }), { status: 403 });
    const orgId = adminOrgEntry.orgId;

    const conditions: ReturnType<typeof eq>[] = [eq(auditLogs.orgId, orgId)];
    if (data.action) conditions.push(eq(auditLogs.action, data.action));
    if (data.userId) conditions.push(eq(auditLogs.userId, data.userId));

    const rawLogs = await db.select().from(auditLogs).where(and(...conditions)).orderBy(desc(auditLogs.timestamp)).limit(5000).all();
    const enriched = await enrichAuditLogs(db, rawLogs as any);

    const headers = ["Timestamp", "Action", "User Name", "User Email", "User ID", "Token Name", "Token ID", "Memory Snippet", "Memory ID", "IP Address", "User Agent", "Metadata"];
    const rows = enriched.map((log: any) => [
      new Date(log.timestamp).toISOString(), log.action,
      log.userName || "", log.userEmail || "", log.userId,
      log.tokenName || "", log.tokenId || "", log.memorySnippet || "", log.memoryId || "",
      log.ipAddress || "", log.userAgent || "", log.metadata ? JSON.stringify(log.metadata) : "",
    ]);

    const csv = [headers.map((h) => `"${h}"`).join(","), ...rows.map((row: string[]) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");
    return { csv };
  });

// ── Site-Level Audit Logs ─────────────────────────────────────────────────────

const SiteAuditLogFilterSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
  action: z.string().max(64).optional(),
  userId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  dateFrom: z.number().int().min(0).optional(),
  dateTo: z.number().int().min(0).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  search: z.string().max(512).optional(),
}).strict();

export const getSiteAuditLogs = createServerFn({ method: "POST" })
  .inputValidator((data) => SiteAuditLogFilterSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const { requireAdmin } = await import("~/server/session");
    await requireAdmin(env);

    const db = drizzle(env.DB);
    const limit = Math.min(data.limit ?? 50, 200);
    const offset = data.offset ?? 0;
    const dateFrom = data.dateFrom ?? (data.startDate ? new Date(data.startDate + "T00:00:00Z").getTime() : undefined);
    const dateTo = data.dateTo ?? (data.endDate ? new Date(data.endDate + "T23:59:59Z").getTime() : undefined);

    const conditions: any[] = [];
    if (data.orgId) conditions.push(eq(auditLogs.orgId, data.orgId));
    if (data.action) conditions.push(eq(auditLogs.action, data.action));
    if (data.userId) conditions.push(eq(auditLogs.userId, data.userId));
    if (dateFrom) conditions.push(sql`${auditLogs.timestamp} >= ${dateFrom}`);
    if (dateTo) conditions.push(sql`${auditLogs.timestamp} <= ${dateTo}`);
    if (data.search) conditions.push(or(like(auditLogs.action, `%${data.search}%`), like(auditLogs.metadata, `%${data.search}%`), like(auditLogs.userAgent, `%${data.search}%`)));

    const rawLogs = await db.select().from(auditLogs).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(auditLogs.timestamp)).limit(limit).offset(offset).all();
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(auditLogs).where(conditions.length > 0 ? and(...conditions) : undefined).all();

    const enriched = await enrichAuditLogs(db, rawLogs as any);

    const orgIds = [...new Set(rawLogs.map((l) => l.orgId).filter((o): o is string => !!o))];
    const orgRows = orgIds.length > 0
      ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(sql`${organizations.id} IN (${sql.join(orgIds.map((o) => sql`${o}`), sql`, `)})`).all()
      : [];
    const orgNameMap = new Map(orgRows.map((o) => [o.id, o.name]));

    const logsWithOrg = (enriched as any[]).map((log) => ({ ...log, orgName: log.orgId ? (orgNameMap.get(log.orgId) ?? log.orgId) : null }));

    return { logs: logsWithOrg, total: countResult[0]?.count ?? 0, limit, offset };
  });

const ExportSiteAuditCsvSchema = z.object({
  action: z.string().max(64).optional(),
  userId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
}).strict();

export const exportSiteAuditLogsCsv = createServerFn({ method: "POST" })
  .inputValidator((data) => ExportSiteAuditCsvSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { env } = (context as unknown as CFContext).cloudflare;
    const { requireAdmin } = await import("~/server/session");
    await requireAdmin(env);

    const db = drizzle(env.DB);
    const conditions: any[] = [];
    if (data.orgId) conditions.push(eq(auditLogs.orgId, data.orgId));
    if (data.action) conditions.push(eq(auditLogs.action, data.action));
    if (data.userId) conditions.push(eq(auditLogs.userId, data.userId));

    const rawLogs = await db.select().from(auditLogs).where(conditions.length > 0 ? and(...conditions) : undefined).orderBy(desc(auditLogs.timestamp)).limit(5000).all();
    const enriched = await enrichAuditLogs(db, rawLogs as any);

    const orgIds = [...new Set(rawLogs.map((l) => l.orgId).filter((o): o is string => !!o))];
    const orgRows = orgIds.length > 0
      ? await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(sql`${organizations.id} IN (${sql.join(orgIds.map((o) => sql`${o}`), sql`, `)})`).all()
      : [];
    const orgNameMap = new Map(orgRows.map((o) => [o.id, o.name]));

    const headers = ["Timestamp", "Action", "Org Name", "Org ID", "User Name", "User Email", "User ID", "Token Name", "Token ID", "Memory Snippet", "Memory ID", "IP Address", "User Agent", "Metadata"];
    const rows = (enriched as any[]).map((log) => [
      new Date(log.timestamp).toISOString(), log.action,
      log.orgId ? (orgNameMap.get(log.orgId) ?? "") : "", log.orgId || "",
      log.userName || "", log.userEmail || "", log.userId,
      log.tokenName || "", log.tokenId || "", log.memorySnippet || "", log.memoryId || "",
      log.ipAddress || "", log.userAgent || "", log.metadata ? JSON.stringify(log.metadata) : "",
    ]);

    const csv = [headers.map((h) => `"${h}"`).join(","), ...rows.map((row: string[]) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");
    return { csv };
  });
