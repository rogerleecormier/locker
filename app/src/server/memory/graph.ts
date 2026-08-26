import { drizzle } from "drizzle-orm/d1";
import { eq, inArray, isNull } from "drizzle-orm";
import { memoryGraphNodes, memoryGraphEdges, memories } from "~/db/schema";
import type { D1Database } from "@cloudflare/workers-types";

export type GraphNode = {
  id: string;
  label: string;
  type: "service" | "file" | "concept" | "library" | "person" | "api" | "database" | "config" | "other";
  value: number;
};

export type GraphEdge = {
  source: string;
  target: string;
  relation: string;
};

export type MemoryGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodeMemories: Record<string, string[]>;
  fetchedAt: number;
};

export type GraphMemorySnippet = {
  id: string;
  fact: string;
  category: string;
  tags: string;
  timestamp: number;
};

export async function getMemoryGraph(
  d1: D1Database,
  userId: string,
  projectKey?: string
): Promise<MemoryGraph> {
  const db = drizzle(d1);
  const pkFilter = projectKey === undefined || projectKey === "personal" ? null : projectKey;

  const nodes = await db
    .select()
    .from(memoryGraphNodes)
    .where(
      pkFilter === null
        ? isNull(memoryGraphNodes.projectKey)
        : eq(memoryGraphNodes.projectKey, pkFilter)
    )
    .all();

  const userNodes = nodes.filter((n) => n.userId === userId);

  if (userNodes.length === 0) {
    return { nodes: [], edges: [], nodeMemories: {}, fetchedAt: Date.now() };
  }

  const nodeIds = userNodes.map((n) => n.id);

  // D1 caps bound parameters per query at 100 — chunk the IN clause so vaults
  // with more graph nodes than that don't hit "too many SQL variables".
  const NODE_ID_CHUNK = 100;
  const edges: Array<typeof memoryGraphEdges.$inferSelect> = [];
  for (let i = 0; i < nodeIds.length; i += NODE_ID_CHUNK) {
    const chunk = nodeIds.slice(i, i + NODE_ID_CHUNK);
    const rows = await db
      .select()
      .from(memoryGraphEdges)
      .where(inArray(memoryGraphEdges.sourceNodeId, chunk))
      .all();
    edges.push(...rows);
  }

  const nodeMemoriesMap: Record<string, Set<string>> = {};
  for (const n of userNodes) nodeMemoriesMap[n.id] = new Set();

  for (const e of edges) {
    nodeMemoriesMap[e.sourceNodeId]?.add(e.memoryId);
    if (nodeMemoriesMap[e.targetNodeId]) nodeMemoriesMap[e.targetNodeId].add(e.memoryId);
  }

  const nodeMemories: Record<string, string[]> = {};
  for (const [id, set] of Object.entries(nodeMemoriesMap)) {
    nodeMemories[id] = Array.from(set);
  }

  return {
    nodes: userNodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: (n.type as GraphNode["type"]) || "other",
      value: (nodeMemories[n.id]?.length ?? 0) + 1,
    })),
    edges: edges.map((e) => ({
      source: e.sourceNodeId,
      target: e.targetNodeId,
      relation: e.relation,
    })),
    nodeMemories,
    fetchedAt: Date.now(),
  };
}

export async function getMemoriesByIds(
  d1: D1Database,
  userId: string,
  memoryIds: string[],
  encryptionKey: string,
): Promise<GraphMemorySnippet[]> {
  if (memoryIds.length === 0) return [];
  const db = drizzle(d1);

  const CHUNK = 50;
  const rows: Array<{ id: string; fact: string; category: string; tags: string; timestamp: number; userId: string }> = [];
  for (let i = 0; i < memoryIds.length; i += CHUNK) {
    const chunk = memoryIds.slice(i, i + CHUNK);
    const fetched = await db
      .select({ id: memories.id, fact: memories.fact, category: memories.category, tags: memories.tags, timestamp: memories.timestamp, userId: memories.userId })
      .from(memories)
      .where(inArray(memories.id, chunk))
      .all();
    rows.push(...fetched);
  }

  // Only return memories the requesting user owns or has access to (basic ownership check).
  const owned = rows.filter((r) => r.userId === userId);

  const { isEncrypted, decrypt } = await import("~/server/crypto");
  const { getOrCreateVaultKey } = await import("~/server/crypto");
  const vaultKey = await getOrCreateVaultKey(d1, encryptionKey, userId);

  const results: GraphMemorySnippet[] = [];
  for (const row of owned) {
    const fact = isEncrypted(row.fact) ? await decrypt(row.fact, vaultKey) : row.fact;
    results.push({ id: row.id, fact, category: row.category, tags: row.tags, timestamp: row.timestamp });
  }
  return results;
}
